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
  const [blocked, setBlocked] = useState(false);
  const [updating, setUpdating] = useState(false);
  const waitingSwRef = useRef<ServiceWorker | null>(null);
  const reloadedRef = useRef(false);

  // ── Service Worker: detecta novo SW instalado ────────────────────────────
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    let reg: ServiceWorkerRegistration | null = null;

    const triggerBlock = (sw?: ServiceWorker | null) => {
      if (sw) waitingSwRef.current = sw;
      setBlocked(true);
    };

    navigator.serviceWorker.ready.then((registration) => {
      reg = registration;

      // Já havia um SW em espera quando o app abriu.
      if (registration.waiting && navigator.serviceWorker.controller) {
        triggerBlock(registration.waiting);
      }

      // Novo SW encontrado enquanto o app está aberto.
      registration.addEventListener("updatefound", () => {
        const installing = registration.installing;
        if (!installing) return;
        installing.addEventListener("statechange", () => {
          if (installing.state === "installed" && navigator.serviceWorker.controller) {
            triggerBlock(registration.waiting);
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
        // Versão mudou → bloqueia.
        setBlocked(true);
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

  if (!blocked) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-background/95 backdrop-blur-md px-6">
      {/* Ícone */}
      <div className="h-20 w-20 rounded-3xl bg-primary/20 flex items-center justify-center mb-6 shadow-lg">
        <RefreshCw className="h-10 w-10 text-primary animate-spin" style={{ animationDuration: "3s" }} />
      </div>

      {/* Título */}
      <h1 className="text-2xl font-bold text-white text-center mb-2">
        Nova versão disponível
      </h1>

      {/* Descrição */}
      <p className="text-muted-foreground text-center text-sm mb-8 max-w-xs leading-relaxed">
        Uma atualização do ArkPet está disponível. Atualize agora para continuar usando o app com todas as melhorias e correções.
      </p>

      {/* Botão — único, sem opção de fechar */}
      <button
        onClick={handleUpdate}
        disabled={updating}
        className="w-full max-w-xs bg-primary hover:bg-primary/90 text-white font-semibold py-4 rounded-2xl transition-colors disabled:opacity-60 text-base shadow-lg shadow-primary/30"
      >
        {updating ? "Atualizando..." : "Atualizar agora"}
      </button>

      <p className="text-xs text-muted-foreground mt-4 text-center">
        É necessário atualizar para continuar usando o ArkPet.
      </p>
    </div>
  );
}
