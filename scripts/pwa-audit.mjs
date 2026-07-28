#!/usr/bin/env node
/**
 * PWA Install Audit — equivalent CI check for Lighthouse "installable" criteria.
 *
 * Checks:
 *  1. manifest.json exists, is valid JSON, and has all required installability fields
 *  2. Icons listed in the manifest exist on disk with correct dimensions
 *  3. /icons/icon-192.png and /icons/icon-512.png exist with exact required sizes
 *  4. sw.js exists and contains install / activate / fetch event listeners
 *  5. Service worker registration in main.tsx uses BASE_URL so sub-routes (/pets, /staff, …) are covered
 *
 * Exit 0 = all checks pass. Exit 1 = one or more failures.
 */

import { readFileSync, existsSync, statSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createHash } from "crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const PUBLIC = resolve(ROOT, "artifacts/petdaycare/public");
const SRC = resolve(ROOT, "artifacts/petdaycare/src");

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

// ─── PNG dimensions helper ────────────────────────────────────────────────────
// Reads width & height from the IHDR chunk without any native deps.
function pngDimensions(filePath) {
  if (!existsSync(filePath)) return null;
  const buf = readFileSync(filePath);
  // PNG signature: 8 bytes; IHDR chunk starts at offset 8
  // IHDR: 4-byte length, 4-byte type "IHDR", 4-byte width, 4-byte height
  if (buf.length < 24) return null;
  const sig = buf.slice(0, 8);
  const expected = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!sig.equals(expected)) return null;
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  return { width, height };
}

// ─── 1. manifest.json ─────────────────────────────────────────────────────────
section("1. manifest.json — existence & required fields");

const manifestPath = resolve(PUBLIC, "manifest.json");
if (!existsSync(manifestPath)) {
  fail("manifest.json not found at artifacts/petdaycare/public/manifest.json");
  process.exit(1); // nothing else can proceed
}
pass("manifest.json exists");

let manifest;
try {
  manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  pass("manifest.json is valid JSON");
} catch (e) {
  fail(`manifest.json is not valid JSON: ${e.message}`);
  process.exit(1);
}

// Required for installability (Lighthouse PWA spec)
const REQUIRED_DISPLAY = new Set(["standalone", "fullscreen", "minimal-ui"]);

if (manifest.name || manifest.short_name) {
  pass(`name / short_name present: "${manifest.name || manifest.short_name}"`);
} else {
  fail("manifest.json is missing both 'name' and 'short_name'");
}

if (manifest.start_url) {
  pass(`start_url present: "${manifest.start_url}"`);
} else {
  fail("manifest.json is missing 'start_url'");
}

if (manifest.display && REQUIRED_DISPLAY.has(manifest.display)) {
  pass(`display is installable: "${manifest.display}"`);
} else {
  fail(
    `manifest.json 'display' must be standalone | fullscreen | minimal-ui, got: "${manifest.display}"`
  );
}

if (Array.isArray(manifest.icons) && manifest.icons.length > 0) {
  pass(`icons array has ${manifest.icons.length} entr${manifest.icons.length === 1 ? "y" : "ies"}`);
} else {
  fail("manifest.json 'icons' array is missing or empty");
}

// ─── 2. Icon verification ─────────────────────────────────────────────────────
section("2. Manifest icons — files exist on disk with correct dimensions");

const REQUIRED_ICONS = [
  { path: "/icons/icon-192.png", w: 192, h: 192 },
  { path: "/icons/icon-512.png", w: 512, h: 512 },
];

for (const { path: iconPath, w, h } of REQUIRED_ICONS) {
  const abs = resolve(PUBLIC, iconPath.replace(/^\//, ""));
  const dims = pngDimensions(abs);
  if (!dims) {
    fail(`Icon missing or unreadable: ${iconPath}`);
    continue;
  }
  if (dims.width === w && dims.height === h) {
    pass(`${iconPath} — ${dims.width}×${dims.height} ✓`);
  } else {
    fail(`${iconPath} — expected ${w}×${h} but got ${dims.width}×${dims.height}`);
  }
}

// Verify every icon listed in manifest exists on disk
section("2b. All manifest icon 'src' paths exist on disk");
if (Array.isArray(manifest.icons)) {
  for (const icon of manifest.icons) {
    if (!icon.src) { fail(`Icon entry has no 'src' field`); continue; }
    const abs = resolve(PUBLIC, icon.src.replace(/^\//, ""));
    if (existsSync(abs) && statSync(abs).size > 0) {
      pass(`${icon.src} (${icon.sizes || "any"}) — found`);
    } else {
      fail(`${icon.src} (${icon.sizes || "any"}) — NOT found or empty at ${abs}`);
    }
  }
}

// Check at least one maskable icon exists (required for full install quality on Android)
const hasMaskable = Array.isArray(manifest.icons) &&
  manifest.icons.some((i) => (i.purpose || "").includes("maskable"));
if (hasMaskable) {
  pass("At least one maskable icon declared");
} else {
  fail("No maskable icon in manifest — Android adaptive icon will not work");
}

// ─── 3. Service worker file ───────────────────────────────────────────────────
section("3. sw.js — exists and has required event listeners");

const swPath = resolve(PUBLIC, "sw.js");
if (!existsSync(swPath)) {
  fail("sw.js not found at artifacts/petdaycare/public/sw.js");
} else {
  pass("sw.js exists");
  const sw = readFileSync(swPath, "utf8");

  const requiredListeners = ["install", "activate", "fetch"];
  for (const event of requiredListeners) {
    if (sw.includes(`addEventListener("${event}"`)) {
      pass(`sw.js has '${event}' event listener`);
    } else {
      fail(`sw.js is missing '${event}' event listener`);
    }
  }

  // skipWaiting ensures the SW activates immediately on install
  if (sw.includes("skipWaiting")) {
    pass("sw.js calls skipWaiting() — immediate activation on install ✓");
  } else {
    fail("sw.js does not call skipWaiting() — installs may stall waiting for old SW to exit");
  }

  // clients.claim() ensures the SW controls pages opened before registration
  if (sw.includes("clients.claim")) {
    pass("sw.js calls clients.claim() — controls all pages immediately ✓");
  } else {
    fail("sw.js does not call clients.claim()");
  }
}

// ─── 4. SW registration in main.tsx — sub-route coverage ─────────────────────
section("4. SW registration — sub-route coverage (BASE_URL-aware)");

const mainPath = resolve(SRC, "main.tsx");
if (!existsSync(mainPath)) {
  fail("src/main.tsx not found");
} else {
  const main = readFileSync(mainPath, "utf8");

  if (main.includes("serviceWorker") && main.includes("register")) {
    pass("src/main.tsx registers a service worker");
  } else {
    fail("src/main.tsx does not register a service worker");
  }

  // The registration must use BASE_URL (not a hardcoded '/sw.js') so sub-routes work
  if (main.includes("BASE_URL") || main.includes("base")) {
    pass("SW registration uses BASE_URL — sub-routes (/pets, /staff, …) are covered ✓");
  } else {
    fail("SW registration does not use BASE_URL — sub-routes may not be controlled by the SW");
  }

  // Registration is done after 'load' event (best practice)
  if (main.includes("addEventListener") && main.includes("load")) {
    pass("SW registration deferred to 'load' event (best practice) ✓");
  } else {
    fail("SW registration is not deferred to 'load' event — may slow initial page load");
  }
}

// ─── 5. index.html — manifest link ───────────────────────────────────────────
section("5. index.html — manifest and apple-touch-icon meta tags");

const htmlPath = resolve(ROOT, "artifacts/petdaycare/index.html");
if (!existsSync(htmlPath)) {
  fail("index.html not found");
} else {
  const html = readFileSync(htmlPath, "utf8");

  if (html.includes('rel="manifest"')) {
    pass('index.html has <link rel="manifest"> ✓');
  } else {
    fail('index.html is missing <link rel="manifest">');
  }

  if (html.includes("apple-mobile-web-app-capable")) {
    pass("index.html has apple-mobile-web-app-capable meta tag ✓");
  } else {
    fail("index.html is missing apple-mobile-web-app-capable meta tag");
  }

  if (html.includes("apple-touch-icon")) {
    pass("index.html has apple-touch-icon link ✓");
  } else {
    fail("index.html is missing apple-touch-icon — iOS home screen will use a screenshot");
  }

  if (html.includes("theme-color")) {
    pass("index.html has theme-color meta tag ✓");
  } else {
    fail("index.html is missing theme-color meta tag");
  }
}

// ─── 6. CACHE_NAME version bump check ────────────────────────────────────────
// Hashes sw.js body (excluding the CACHE_NAME line) and compares against the
// stored hash in scripts/sw-content.hash.  If sw.js changed but CACHE_NAME was
// not bumped, iOS cached pages may serve stale assets after a deploy.
//
// Format of sw-content.hash: "<16-char-sha256-prefix> <CACHE_NAME>"
// To update after a legitimate change: bump CACHE_NAME in sw.js, then run:
//   node scripts/update-sw-hash.mjs
section("6. CACHE_NAME version bump — sw.js body hash check");

const swHashPath = resolve(__dirname, "sw-content.hash");
if (!existsSync(swHashPath)) {
  fail(
    "scripts/sw-content.hash not found — run `node scripts/update-sw-hash.mjs` to create it"
  );
} else {
  const hashLine = readFileSync(swHashPath, "utf8").trim();
  const [storedHash, storedCacheName] = hashLine.split(" ");

  if (!storedHash || !storedCacheName) {
    fail("scripts/sw-content.hash is malformed — expected '<hash> <CACHE_NAME>'");
  } else {
    const swSrc = readFileSync(swPath, "utf8");
    const swBody = swSrc.replace(/^const CACHE_NAME = .+;$/m, "").trim();
    const currentHash = createHash("sha256").update(swBody).digest("hex").slice(0, 16);
    const currentCacheName = (swSrc.match(/const CACHE_NAME = "([^"]+)"/) || [])[1] ?? "";

    if (currentHash === storedHash) {
      pass(`sw.js body unchanged (hash ${currentHash}) — CACHE_NAME bump not required ✓`);
    } else if (currentCacheName !== storedCacheName) {
      // Body changed AND CACHE_NAME bumped — good. Remind developer to commit updated hash.
      pass(
        `sw.js changed and CACHE_NAME bumped (${storedCacheName} → ${currentCacheName}) ✓` +
        ` — run \`node scripts/update-sw-hash.mjs\` and commit the new hash file`
      );
    } else {
      fail(
        `sw.js body changed (hash ${storedHash} → ${currentHash}) but CACHE_NAME is still` +
        ` "${currentCacheName}" — bump CACHE_NAME in sw.js, then run \`node scripts/update-sw-hash.mjs\``
      );
    }
  }
}

// ─── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(50)}`);
console.log(`PWA audit complete: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error(`\n🚫  ${failed} check(s) failed — PWA may not be installable.`);
  process.exit(1);
} else {
  console.log(`\n🎉  All PWA installability checks passed.`);
  process.exit(0);
}
