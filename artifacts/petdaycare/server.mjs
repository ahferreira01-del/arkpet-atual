import express from "express";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = join(__dirname, "dist/public");
const port = Number(process.env.PORT) || 21324;

const app = express();

// Digital Asset Links — hardcoded so it is always served correctly,
// regardless of static file resolution in the container.
const ASSET_LINKS = [
  {
    relation: ["delegate_permission/common.handle_all_urls"],
    target: {
      namespace: "android_app",
      package_name: "br.com.arkpett.twa",
      sha256_cert_fingerprints: [
        "9A:9A:BA:77:3D:49:DB:96:08:DD:A0:84:93:DD:9D:4B:02:DA:E0:B3:18:EF:71:0D:70:11:45:50:4D:F9:E3:F1",
      ],
    },
  },
];

app.get("/.well-known/assetlinks.json", (_req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.json(ASSET_LINKS);
});

// Serve static files (JS, CSS, images, etc.)
app.use(express.static(distDir, { index: false }));

// SPA fallback — must come after static middleware
app.use((_req, res) => {
  res.sendFile(join(distDir, "index.html"));
});

app.listen(port, "0.0.0.0", () => {
  console.log(`petdaycare serving on port ${port}`);
});
