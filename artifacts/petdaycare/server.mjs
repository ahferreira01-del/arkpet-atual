import express from "express";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = join(__dirname, "dist/public");
const port = Number(process.env.PORT) || 21324;

const app = express();

// Serve static files — Express resolves files before the SPA catch-all,
// so /.well-known/assetlinks.json is served with the correct content-type.
app.use(
  express.static(distDir, {
    index: false, // disable auto-index so the SPA catch-all controls it
    setHeaders(res, filePath) {
      if (filePath.endsWith(".json")) {
        res.setHeader("Content-Type", "application/json");
      }
    },
  })
);

// SPA fallback — must come after static middleware
app.get("*", (_req, res) => {
  res.sendFile(join(distDir, "index.html"));
});

app.listen(port, "0.0.0.0", () => {
  console.log(`petdaycare serving on port ${port}`);
});
