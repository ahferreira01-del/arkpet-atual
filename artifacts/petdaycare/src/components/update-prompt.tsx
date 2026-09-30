import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";

const CURRENT_VERSION_KEY = "arkpet-app-version";
const VERSION_CHECK_INTERVAL = 5 * 60 * 1000; // 5 minutos

// Busca a versão atual do servidor.
async function fetchServerVersion(): Promise<string | null> {
  try {
    const base = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
    const res = await fetch(`${base}/api/version`, { cache: "no-store" });
    if (!res.ok) return null;
    const data = await res.json();
    return data.version ?? null;
  } catch {
    return null;
  }
}

// Tela bloqueante obrigatória de atualização. Aparece quando:
//  1. O Service Worker detecta um novo SW instalado (SW nativo), ou
//  2. A versão da API é diferente da versão salva no localStorage.
// Não tem botão de fechar — o usuário DEVE atualizar para continuar.
export function UpdatePrompt() {
  const [hasUpdate, setHasUpdate] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [updating, setUpdating] = useState(false);
  const waitingSwRef = useRef<ServiceWorker | null>(null);
  const reloadedRef = useRef(false);

  // ── Service Worker: detecta novo SW instalado ────────────────────────────
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    let reg: ServiceWorkerRegistration | null = null;

    const triggerPrompt = (sw?: ServiceWorker | null) => {
      if (sw) waitingSwRef.current = sw;
      setHasUpdate(true);
    };

    navigator.serviceWorker.ready.then((registration) => {
      reg = registration;

      // Já havia um SW em espera quando o app abriu.
      if (registration.waiting && navigator.serviceWorker.controller) {
        triggerPrompt(registration.waiting);
      }

      // Novo SW encontrado enquanto o app está aberto.
      registration.addEventListener("updatefound", () => {
        const installing = registration.installing;
        if (!installing) return;
        installing.addEventListener("statechange", () => {
          if (installing.state === "installed" && navigator.serviceWorker.controller) {
            triggerPrompt(registration.waiting);
          }
        });
      });
    });

    // Quando o novo SW assume o controle, recarrega a página.
    const onControllerChange = () => {
      if (reloadedRef.current) return;
      reloadedRef.current = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    // Verifica update ao focar a janela / voltar do segundo plano.
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

  // ── Versão da API: detecção de mudança via polling ───────────────────────
  useEffect(() => {
    let active = true;

    const check = async () => {
      const serverVersion = await fetchServerVersion();
      if (!serverVersion || !active) return;

      const stored = localStorage.getItem(CURRENT_VERSION_KEY);

      if (!stored) {
        // Primeira vez — apenas salva.
        localStorage.setItem(CURRENT_VERSION_KEY, serverVersion);
        return;
      }

      if (stored !== serverVersion) {
        // Versão mudou → alerta atualização sem interromper operação
        setHasUpdate(true);
      }
    };

    // Checa ao iniciar.
    check();

    // Checa a cada 5 minutos.
    const interval = window.setInterval(check, VERSION_CHECK_INTERVAL);

    // Checa quando o app volta do segundo plano.
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      active = false;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  // ── Ação de atualizar ────────────────────────────────────────────────────
  const handleUpdate = () => {
    setUpdating(true);
    // Limpa versão salva para que após o reload ela seja re-registrada.
    localStorage.removeItem(CURRENT_VERSION_KEY);

    const sw = waitingSwRef.current;
    if (sw) {
      sw.postMessage({ type: "SKIP_WAITING" });
      // Fallback: se o controllerchange não disparar em 3s, recarrega mesmo assim.
      window.setTimeout(() => {
        if (!reloadedRef.current) window.location.reload();
      }, 3000);
    } else {
      window.location.reload();
    }
  };

  if (!hasUpdate || dismissed) return null;

  return (
    <aside
      role="region"
      aria-label="Atualização disponível"
      className="fixed bottom-20 md:bottom-6 right-4 left-4 md:left-auto md:max-w-md z-50 bg-card/95 border border-primary/30 shadow-2xl rounded-2xl p-4 flex items-center gap-3 backdrop-blur-md animate-in fade-in slide-in-from-bottom-4 duration-300"
    >
      <div className="h-10 w-10 rounded-xl bg-primary/15 flex items-center justify-center shrink-0">
        <RefreshCw className={`h-5 w-5 text-primary ${updating ? "animate-spin" : ""}`} />
      </div>

      <div className="flex-1 min-w-0">
        <h3 className="text-sm font-semibold text-foreground truncate">
          Nova versão disponível
        </h3>
        <p className="text-xs text-muted-foreground line-clamp-2">
          Atualize agora para carregar as melhorias e correções mais recentes.
        </p>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="text-xs text-muted-foreground hover:text-foreground px-2 py-1.5 rounded-lg transition-colors cursor-pointer"
        >
          Depois
        </button>
        <button
          type="button"
          onClick={handleUpdate}
          disabled={updating}
          className="text-xs font-medium bg-primary hover:bg-primary/90 text-primary-foreground px-3 py-1.5 rounded-lg shadow-sm transition-colors cursor-pointer disabled:opacity-50"
        >
          {updating ? "Atualizando..." : "Atualizar"}
        </button>
      </div>
    </aside>
  );
}
