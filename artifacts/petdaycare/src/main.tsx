import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(<App />);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    const base = import.meta.env.BASE_URL || "/";
    const swPath = base.endsWith("/") ? `${base}sw.js` : `${base}/sw.js`;
    navigator.serviceWorker
      .register(swPath)
      .then((reg) => console.log("[PWA] Service Worker registrado:", reg.scope))
      .catch((err) => console.warn("[PWA] Registro falhou:", err));
  });
}
