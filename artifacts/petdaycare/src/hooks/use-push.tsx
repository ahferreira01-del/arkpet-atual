import { useEffect, useState, useCallback, useRef } from "react";
import { useAuth } from "./use-auth";
import { useToast } from "./use-toast";

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
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

      const reg = await navigator.serviceWorker.ready;

      // Unsubscribe old subscription if exists
      const existing = await reg.pushManager.getSubscription();
      if (existing) await existing.unsubscribe();

      // Create new subscription
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });

      const p256dh = btoa(String.fromCharCode(...new Uint8Array(sub.getKey("p256dh")!)));
      const auth = btoa(String.fromCharCode(...new Uint8Array(sub.getKey("auth")!)));

      // Register on server
      const token = localStorage.getItem("auth_token");
      const saveRes = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ endpoint: sub.endpoint, p256dh, auth }),
      });
      if (!saveRes.ok) {
        // Server save failed but browser subscription is active — still mark as subscribed
        console.warn("[push] Falha ao salvar assinatura no servidor, mas browser está inscrito");
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

  return { isSupported, permission, isSubscribed, isLoading, subscribe, unsubscribe };
}
