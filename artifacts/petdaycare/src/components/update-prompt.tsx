import { useEffect, useRef, useState } from "react";
import { RefreshCw, X } from "lucide-react";

// Shows a "Nova versão disponível → Atualizar" banner whenever a new service
// worker has been installed and is waiting to take over. Clicking "Atualizar"
// tells the waiting SW to skipWaiting; once it takes control we reload the page
// so the user immediately runs the new version.
export function UpdatePrompt() {
  const [visible, setVisible] = useState(false);
  const [updating, setUpdating] = useState(false);
  const waitingRef = useRef<ServiceWorker | null>(null);
  const reloadedRef = useRef(false);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    let reg: ServiceWorkerRegistration | null = null;

    const promote = (sw: ServiceWorker | null | undefined) => {
      if (!sw) return;
      waitingRef.current = sw;
      setVisible(true);
    };

    navigator.serviceWorker.ready.then((registration) => {
      reg = registration;

      // An update was already downloaded while the app was closed.
      if (registration.waiting && navigator.serviceWorker.controller) {
        promote(registration.waiting);
      }

      // A new update is found while the app is open.
      registration.addEventListener("updatefound", () => {
        const installing = registration.installing;
        if (!installing) return;
        installing.addEventListener("statechange", () => {
          // Only prompt for real updates (controller exists), never first install.
          if (installing.state === "installed" && navigator.serviceWorker.controller) {
            promote(registration.waiting);
          }
        });
      });
    });

    // When the new SW takes control, reload once to run the fresh version.
    const onControllerChange = () => {
      if (reloadedRef.current) return;
      reloadedRef.current = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    // Proactively check for new releases on long-lived sessions and on refocus.
    const checkForUpdate = () => reg?.update().catch(() => {});
    const interval = window.setInterval(checkForUpdate, 60 * 60 * 1000);
    const onFocus = () => checkForUpdate();
    window.addEventListener("focus", onFocus);

    return () => {
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  const handleUpdate = () => {
    const sw = waitingRef.current;
    setUpdating(true);
    if (sw) {
      sw.postMessage({ type: "SKIP_WAITING" });
      // Fallback reload in case controllerchange doesn't fire.
      window.setTimeout(() => {
        if (!reloadedRef.current) window.location.reload();
      }, 3000);
    } else {
      window.location.reload();
    }
  };

  if (!visible) return null;

  return (
    <div
      className="fixed inset-x-0 z-[60] flex justify-center px-4"
      style={{ top: "calc(env(safe-area-inset-top, 0px) + 12px)" }}
    >
      <div className="w-full max-w-sm glass-panel rounded-2xl border border-primary/20 shadow-[0_8px_32px_rgba(139,92,246,0.25)] px-4 py-3 flex items-center gap-3 animate-in slide-in-from-top-4 fade-in duration-300">
        {/* Icon */}
        <div className="h-9 w-9 rounded-xl bg-primary/20 flex items-center justify-center flex-shrink-0">
          <RefreshCw className="h-4 w-4 text-primary" />
        </div>

        {/* Text */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white leading-tight">Nova versão disponível</p>
          <p className="text-[11px] text-muted-foreground mt-0.5 leading-tight">
            Atualize para ter as últimas melhorias.
          </p>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={handleUpdate}
            disabled={updating}
            className="text-xs font-semibold text-white bg-primary hover:bg-primary/90 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-60"
          >
            {updating ? "..." : "Atualizar"}
          </button>
          <button
            onClick={() => setVisible(false)}
            className="h-7 w-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-white hover:bg-white/10 transition-colors"
            aria-label="Agora não"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
