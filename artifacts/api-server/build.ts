import path from "path";
import { fileURLToPath } from "url";
import { build as esbuild } from "esbuild";
import { rm, readFile } from "fs/promises";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// server deps to bundle to reduce openat(2) syscalls
// which helps cold start times without risking some
// packages that are not bundle compatible
const allowlist = [
  "@google/generative-ai",
  "axios",
  "connect-pg-simple",
  "cors",
  "helmet",
  "date-fns",
  "drizzle-orm",
  "drizzle-zod",
  "express",
  "express-rate-limit",
  "express-session",
  "jsonwebtoken",
  "memorystore",
  "multer",
  "nanoid",
  "nodemailer",
  "openai",
  "passport",
  "passport-local",
  "pg",
  "stripe",
  "uuid",
  "node-cron",
  "resend",
  "web-push",
  "ws",
  "xlsx",
  "zod",
  "zod-validation-error",
];

import { writeFile } from "fs/promises";
import { execSync } from "child_process";

async function buildAll() {
  const distDir = path.resolve(__dirname, "dist");
  await rm(distDir, { recursive: true, force: true });

  console.log("building server...");

  // Resolve authoritative commit SHA
  let commitSha =
    process.env.BUILD_COMMIT_SHA ||
    process.env.ARKPET_COMMIT_SHA ||
    process.env.RENDER_GIT_COMMIT ||
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.GITHUB_SHA;

  if (!commitSha) {
    try {
      commitSha = execSync("git rev-parse HEAD", { encoding: "utf-8" }).trim();
    } catch {
      // Failed to execute git rev-parse HEAD
    }
  }

  if (!commitSha || commitSha === "unknown") {
    throw new Error(
      "PRODUCTION_BUILD_UNKNOWN_COMMIT_ALLOWED = NO: Failed to resolve Git commit SHA for production build"
    );
  }

  const buildTime = new Date().toISOString();
  console.log(`[build] Embedded provenance: commitSha=${commitSha}, buildTime=${buildTime}`);

  const pkgPath = path.resolve(__dirname, "package.json");
  const pkg = JSON.parse(await readFile(pkgPath, "utf-8"));
  const allDeps = [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
  ];
  const externals = allDeps.filter(
    (dep) =>
      !allowlist.includes(dep) &&
      !(pkg.dependencies?.[dep]?.startsWith("workspace:")),
  );

  await esbuild({
    entryPoints: [path.resolve(__dirname, "src/index.ts")],
    platform: "node",
    bundle: true,
    format: "cjs",
    outfile: path.resolve(distDir, "index.cjs"),
    define: {
      "process.env.NODE_ENV": '"production"',
      "__BUILD_COMMIT_SHA__": JSON.stringify(commitSha),
      "__BUILD_TIME__": JSON.stringify(buildTime),
    },
    minify: true,
    external: externals,
    logLevel: "info",
  });
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
