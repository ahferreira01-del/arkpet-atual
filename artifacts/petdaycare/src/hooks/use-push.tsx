import { useEffect, useState, useCallback, useRef } from "react";
import { useAuth } from "./use-auth";
import { useToast } from "./use-toast";

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const output = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) output[i] = rawData.charCodeAt(i);
  return output;
}

// Safe btoa for ArrayBuffer — avoids spread RangeError on mobile
function arrayBufferToBase64(buffer: ArrayBuffer | null): string {
  if (!buffer) return "";
  const bytes = new Uint8Array(buffer);
  let str = "";
  for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
  return btoa(str);
}

function isIos() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}
function isInStandaloneMode() {
  return "standalone" in navigator && (navigator as any).standalone === true;
}

const STORAGE_KEY = "arkpet_push_subscribed";

export function usePush() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [permission, setPermission] = useState<NotificationPermission>(
    typeof window !== "undefined" && "Notification" in window
      ? Notification.permission
      : "default"
  );
  // Initialize from localStorage to avoid flicker on re-render
  const [isSubscribed, setIsSubscribed] = useState(() => {
    try { return localStorage.getItem(STORAGE_KEY) === "1"; } catch { return false; }
  });
  const [isLoading, setIsLoading] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Check actual browser subscription state once on mount (not on every user change)
  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => {
        if (!mountedRef.current) return;
        const subscribed = !!sub;
        setIsSubscribed(subscribed);
        try { localStorage.setItem(STORAGE_KEY, subscribed ? "1" : "0"); } catch {}
      })
      .catch(() => {});
  // Only run on mount — intentionally empty deps
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const subscribe = useCallback(async () => {
    if (!user || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      toast({ title: "Não suportado", description: "Seu navegador não suporta notificações push.", variant: "destructive" });
      return;
    }
    if (isLoading) return; // Guard against double-tap creating duplicate subscriptions
    setIsLoading(true);
    try {
      const perm = await Notification.requestPermission();
      if (!mountedRef.current) return;
      setPermission(perm);

      if (perm !== "granted") {
        toast({
          title: "Permissão negada",
          description: "Autorize notificações nas configurações do navegador.",
          variant: "destructive",
        });
        return;
      }

      // Fetch VAPID key
      const keyRes = await fetch("/api/push/vapid-public-key", {
        headers: { Authorization: `Bearer ${localStorage.getItem("auth_token")}` },
      });
      if (!keyRes.ok) {
        toast({ title: "Erro", description: "Não foi possível obter a chave de configuração.", variant: "destructive" });
        return;
      }
      const { publicKey } = await keyRes.json();
      if (!publicKey) {
        toast({ title: "Erro", description: "Chave VAPID não configurada no servidor.", variant: "destructive" });
        return;
      }

      let reg = await navigator.serviceWorker.ready;

      // Unsubscribe old subscription if exists (clears VAPID key binding)
      const existing = await reg.pushManager.getSubscription();
      if (existing) {
        try { await existing.unsubscribe(); } catch {}
      }

      // Subscribe — with one automatic retry on "push service error",
      // which usually means FCM has a stale binding. Unregistering the
      // SW and re-registering forces Chrome to recreate the push channel.
      let sub: PushSubscription;
      try {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        });
      } catch (err: any) {
        const msg = String(err?.message || err);
        const isPushServiceError = /push service error|registration failed/i.test(msg);
        if (!isPushServiceError) throw err;

        console.warn("[push] Subscribe falhou, recriando Service Worker:", msg);
        // Unregister ALL SWs to clear any stale FCM bindings
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister().catch(() => {})));

        // Re-register using the same base path as main.tsx (deployment-safe)
        const base = import.meta.env.BASE_URL || "/";
        const swPath = base.endsWith("/") ? `${base}sw.js` : `${base}/sw.js`;
        const scope = base.endsWith("/") ? base : `${base}/`;
        await navigator.serviceWorker.register(swPath, { scope });

        // Wait for the registration to have an active worker, not just "ready"
        reg = await navigator.serviceWorker.ready;
        if (!reg.active) {
          await new Promise<void>((resolve) => {
            const installing = reg.installing || reg.waiting;
            if (!installing) return resolve();
            const onState = () => {
              if (installing.state === "activated") {
                installing.removeEventListener("statechange", onState);
                resolve();
              }
            };
            installing.addEventListener("statechange", onState);
            // Safety timeout — don't hang forever
            setTimeout(resolve, 3000);
          });
        }

        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        });
      }

      const p256dh = arrayBufferToBase64(sub.getKey("p256dh"));
      const auth = arrayBufferToBase64(sub.getKey("auth"));
      if (!p256dh || !auth) throw new Error("Chaves de assinatura inválidas");

      // Register on server — MUST succeed, otherwise rollback browser subscription.
      const token = localStorage.getItem("auth_token");
      const saveRes = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ endpoint: sub.endpoint, p256dh, auth }),
      });
      if (!saveRes.ok) {
        // Rollback browser subscription to keep state consistent.
        let serverMsg = "";
        try { serverMsg = (await saveRes.json())?.error ?? ""; } catch {}
        try { await sub.unsubscribe(); } catch {}
        console.error("[push] Falha ao salvar assinatura no servidor:", saveRes.status, serverMsg);
        throw new Error(serverMsg || `Servidor recusou a assinatura (HTTP ${saveRes.status})`);
      }

      if (!mountedRef.current) return;
      setIsSubscribed(true);
      try { localStorage.setItem(STORAGE_KEY, "1"); } catch {}
      toast({ title: "Notificações ativadas", description: "Você receberá alertas em tempo real." });
    } catch (err: any) {
      console.error("[push] Falha ao ativar:", err);
      if (mountedRef.current) {
        toast({
          title: "Erro ao ativar notificações",
          description: err?.message || "Tente novamente.",
          variant: "destructive",
        });
      }
    } finally {
      if (mountedRef.current) setIsLoading(false);
    }
  }, [user, toast]);

  // Auto-recovery: if the user had previously granted permission but the browser
  // subscription was silently lost (Chrome update, data clear, FCM rotation), try
  // to re-subscribe automatically so they don't stop receiving notifications without
  // knowing why. Only runs when the user object becomes available.
  useEffect(() => {
    if (!user) return;
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return;
    if (Notification.permission !== "granted") return;

    // Small delay so the SW has time to register on first load
    const timer = setTimeout(async () => {
      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (!sub && mountedRef.current) {
          console.log("[push] Permission granted but subscription missing — auto-recovering...");
          subscribe();
        }
      } catch {
        // Silent fail — recovery is best-effort
      }
    }, 3000);

    return () => clearTimeout(timer);
  }, [user?.id, subscribe]);

  const unsubscribe = useCallback(async () => {
    if (!("serviceWorker" in navigator)) return;
    setIsLoading(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        const token = localStorage.getItem("auth_token");
        // Notify server
        await fetch("/api/push/subscribe", {
          method: "DELETE",
          headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        }).catch(() => {});
        // Unsubscribe in browser
        await sub.unsubscribe();
      }
      if (!mountedRef.current) return;
      setIsSubscribed(false);
      try { localStorage.setItem(STORAGE_KEY, "0"); } catch {}
      toast({ title: "Notificações desativadas", description: "Você não receberá mais alertas neste dispositivo." });
    } catch (err: any) {
      console.error("[push] Falha ao desativar:", err);
      if (mountedRef.current) {
        toast({ title: "Erro ao desativar", description: err?.message || "Tente novamente.", variant: "destructive" });
      }
    } finally {
      if (mountedRef.current) setIsLoading(false);
    }
  }, [toast]);

  const isSupported =
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window;

  // iOS requires PWA (added to home screen) for push to work
  const isIosWithoutPwa =
    typeof window !== "undefined" && isIos() && !isInStandaloneMode();

  return { isSupported, isIosWithoutPwa, permission, isSubscribed, isLoading, subscribe, unsubscribe };
}
