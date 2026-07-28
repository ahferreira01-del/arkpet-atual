#!/usr/bin/env node
/**
 * Regenerates scripts/sw-content.hash after you have:
 *  1. Made changes to artifacts/petdaycare/public/sw.js, AND
 *  2. Bumped CACHE_NAME in that file to a new version string.
 *
 * Usage:
 *   node scripts/update-sw-hash.mjs
 *
 * Commit both sw.js and sw-content.hash together so the pwa-audit check passes.
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createHash } from "crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const swPath = resolve(__dirname, "../artifacts/petdaycare/public/sw.js");
const hashPath = resolve(__dirname, "sw-content.hash");

if (!existsSync(swPath)) {
  console.error("❌  sw.js not found at", swPath);
  process.exit(1);
}

const sw = readFileSync(swPath, "utf8");
const cacheName = (sw.match(/const CACHE_NAME = "([^"]+)"/) || [])[1];
if (!cacheName) {
  console.error('❌  Could not find CACHE_NAME = "..." in sw.js');
  process.exit(1);
}

const body = sw.replace(/^const CACHE_NAME = .+;$/m, "").trim();
const hash = createHash("sha256").update(body).digest("hex").slice(0, 16);
const line = `${hash} ${cacheName}\n`;

writeFileSync(hashPath, line, "utf8");
console.log(`✅  sw-content.hash updated: ${hash} ${cacheName}`);
console.log("    Remember to commit both sw.js and scripts/sw-content.hash together.");
