import { useEffect, useState, useCallback } from "react";
import { useAuth } from "./use-auth";

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}

export function usePush() {
  const { user } = useAuth();
  const [permission, setPermission] = useState<NotificationPermission>("default");
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!("Notification" in window)) return;
    setPermission(Notification.permission);
    checkSubscription();
  }, [user]);

  async function checkSubscription() {
    if (!("serviceWorker" in navigator) || !user) return;
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      setIsSubscribed(!!sub);
    } catch {
      setIsSubscribed(false);
    }
  }

  const subscribe = useCallback(async () => {
    if (!user || !("serviceWorker" in navigator) || !("PushManager" in window)) return;
    setIsLoading(true);
    try {
      // Request permission
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== "granted") return;

      // Get VAPID public key from server
      const keyRes = await fetch("/api/push/vapid-public-key", {
        headers: { Authorization: `Bearer ${localStorage.getItem("auth_token")}` },
      });
      if (!keyRes.ok) return;
      const { publicKey } = await keyRes.json();
      if (!publicKey) return;

      const reg = await navigator.serviceWorker.ready;

      // Unsubscribe from old subscription if exists
      const existing = await reg.pushManager.getSubscription();
      if (existing) await existing.unsubscribe();

      // Create new subscription
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });

      const p256dh = btoa(
        String.fromCharCode(...new Uint8Array(sub.getKey("p256dh")!))
      );
      const auth = btoa(
        String.fromCharCode(...new Uint8Array(sub.getKey("auth")!))
      );

      // Send subscription to server
      const token = localStorage.getItem("auth_token");
      await fetch("/api/push/subscribe", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ endpoint: sub.endpoint, p256dh, auth }),
      });

      setIsSubscribed(true);
    } catch (err) {
      console.error("[push] Falha ao ativar notificações:", err);
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  const unsubscribe = useCallback(async () => {
    if (!("serviceWorker" in navigator)) return;
    setIsLoading(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        const token = localStorage.getItem("auth_token");
        await fetch("/api/push/subscribe", {
          method: "DELETE",
          headers: {
            "content-type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setIsSubscribed(false);
    } catch (err) {
      console.error("[push] Falha ao desativar notificações:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const isSupported =
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window;

  return { isSupported, permission, isSubscribed, isLoading, subscribe, unsubscribe };
}
