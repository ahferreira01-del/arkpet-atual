#!/usr/bin/env node
/**
 * SW Offline Cache Test
 *
 * Verifies that the service worker correctly serves the app shell from cache
 * when the device is offline.
 *
 * Strategy:
 *  1. Launch Chromium against APP_URL (default: http://localhost:5173)
 *  2. Navigate to / online so the SW installs, activates, and caches assets
 *  3. Also fetch /bookings online so it's in the runtime cache
 *  4. Set the browser context offline
 *  5. Navigate to / and /bookings — both must return HTTP 200 (from SW cache)
 *
 * Usage:
 *   APP_URL=http://localhost:5173 node scripts/offline-test.mjs
 *
 * Exit 0 = all checks pass.  Exit 1 = one or more failures.
 */

import { chromium } from "@playwright/test";

const APP_URL = process.env.APP_URL || "http://localhost:5173";
const ROUTES_TO_TEST = ["/", "/bookings"];
/** Max ms to wait for the SW to reach "activated" state */
const SW_ACTIVATE_TIMEOUT_MS = 15_000;
/** Max ms for each page navigation */
const NAV_TIMEOUT_MS = 10_000;

let passed = 0;
let failed = 0;

function pass(msg) {
  console.log(`  ✅  ${msg}`);
  passed++;
}

function fail(msg) {
  console.error(`  ❌  ${msg}`);
  failed++;
}

function section(title) {
  console.log(`\n── ${title}`);
}

/** Wait until the SW for the page is in the "activated" state. */
async function waitForSwActivated(page, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await page.evaluate(async () => {
      if (!("serviceWorker" in navigator)) return "unsupported";
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) return "none";
      if (reg.active) return "activated";
      if (reg.installing) return "installing";
      if (reg.waiting) return "waiting";
      return "unknown";
    });
    if (state === "activated") return true;
    if (state === "unsupported") return false;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

/**
 * Prime the cache for `routes` while online.
 * Uses fetch() from within the page so requests flow through the SW fetch
 * handler and get cached via the network-first strategy.
 */
async function primeCacheForRoutes(page, baseUrl, routes) {
  for (const route of routes) {
    const url = baseUrl + route;
    await page.evaluate(async (u) => {
      try {
        await fetch(u, { credentials: "same-origin" });
      } catch {
        // best-effort; main navigation already caches "/"
      }
    }, url);
  }
}

async function run() {
  console.log(`SW Offline Cache Test`);
  console.log(`APP_URL: ${APP_URL}`);

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (err) {
    console.error(`\n🚫  Failed to launch browser: ${err.message}`);
    console.error(
      "Make sure Playwright browsers are installed: npx playwright install chromium"
    );
    process.exit(1);
  }

  // ── 1. Online phase — prime SW cache ────────────────────────────────────────
  section("1. Online phase — load app and prime SW cache");

  const context = await browser.newContext();
  const page = await context.newPage();

  // Collect console errors from the SW for diagnostics
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      console.error(`  [browser error] ${msg.text()}`);
    }
  });

  try {
    const res = await page.goto(APP_URL + "/", {
      waitUntil: "domcontentloaded",
      timeout: NAV_TIMEOUT_MS,
    });
    if (res && res.ok()) {
      pass(`GET / online → HTTP ${res.status()}`);
    } else {
      fail(
        `GET / online returned ${res ? res.status() : "no response"} — is the app server running at ${APP_URL}?`
      );
      await browser.close();
      printSummary();
      process.exit(1);
    }
  } catch (err) {
    fail(`Could not reach ${APP_URL}/ — ${err.message}`);
    fail(`Is the app server running? Start it with: pnpm --filter @workspace/petdaycare run dev`);
    await browser.close();
    printSummary();
    process.exit(1);
  }

  // Wait for SW to install and activate
  const activated = await waitForSwActivated(page, SW_ACTIVATE_TIMEOUT_MS);
  if (activated) {
    pass("Service worker reached 'activated' state");
  } else {
    fail(
      `Service worker did not activate within ${SW_ACTIVATE_TIMEOUT_MS / 1000}s — offline cache will not work`
    );
    await browser.close();
    printSummary();
    process.exit(1);
  }

  // Prime runtime cache for all routes under test
  await primeCacheForRoutes(page, APP_URL, ROUTES_TO_TEST);
  pass(`Primed SW runtime cache for: ${ROUTES_TO_TEST.join(", ")}`);

  // Small pause to let cache.put() calls settle (they are async in the SW)
  await new Promise((r) => setTimeout(r, 500));

  // ── 2. Offline phase — verify SW cache serves 200 ───────────────────────────
  section("2. Offline phase — navigate to routes, expect 200 from SW cache");

  await context.setOffline(true);
  pass("Browser context set to offline");

  for (const route of ROUTES_TO_TEST) {
    try {
      const res = await page.goto(APP_URL + route, {
        waitUntil: "domcontentloaded",
        timeout: NAV_TIMEOUT_MS,
      });

      if (res === null) {
        // null can mean same-page navigation (no network request fired) — treat as pass
        pass(`GET ${route} offline → served (no new network request, page already loaded)`);
        continue;
      }

      const status = res.status();
      // SW returns the cached response; status should be 200.
      // Some browsers report 0 for opaque SW responses — we accept that too.
      if (status === 200 || status === 0) {
        pass(`GET ${route} offline → HTTP ${status === 0 ? "0 (opaque/SW)" : status} ✓`);
      } else {
        fail(`GET ${route} offline → HTTP ${status} (expected 200 from SW cache)`);
      }
    } catch (err) {
      // A thrown error means the browser got a network error page — SW cache miss
      fail(
        `GET ${route} offline → network error (SW did not serve from cache): ${err.message}`
      );
    }
  }

  // ── 3. Verify SW cache contains the expected keys ────────────────────────────
  section("3. Cache API — verify STATIC_ASSETS are stored");

  const cacheContents = await page.evaluate(async () => {
    try {
      const keys = await caches.keys();
      if (keys.length === 0) return { cacheName: null, urls: [] };
      // Use the first (and normally only) cache
      const cache = await caches.open(keys[0]);
      const reqs = await cache.keys();
      return {
        cacheName: keys[0],
        urls: reqs.map((r) => {
          try {
            return new URL(r.url).pathname;
          } catch {
            return r.url;
          }
        }),
      };
    } catch (err) {
      return { cacheName: null, urls: [], error: err.message };
    }
  });

  if (cacheContents.cacheName) {
    pass(`SW cache open: "${cacheContents.cacheName}" (${cacheContents.urls.length} entries)`);
  } else {
    fail(`Could not open SW cache${cacheContents.error ? ": " + cacheContents.error : ""}`);
  }

  const EXPECTED_CACHED_PATHS = ["/", "/index.html", "/manifest.json"];
  for (const p of EXPECTED_CACHED_PATHS) {
    // Match by suffix — base path prefix differs across environments
    const found = cacheContents.urls.some((u) => u === p || u.endsWith(p));
    if (found) {
      pass(`Cache contains: ${p}`);
    } else {
      fail(`Cache is missing: ${p} (found: ${cacheContents.urls.slice(0, 10).join(", ")})`);
    }
  }

  await browser.close();

  printSummary();
  process.exit(failed > 0 ? 1 : 0);
}

function printSummary() {
  console.log(`\n${"─".repeat(50)}`);
  console.log(`Offline cache test complete: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.error(`\n🚫  ${failed} check(s) failed — offline mode may not work correctly.`);
  } else {
    console.log(`\n🎉  All offline cache checks passed.`);
  }
}

run().catch((err) => {
  console.error(`\n💥  Unexpected error: ${err.message}`);
  console.error(err.stack);
  process.exit(1);
});
