import { useState, useEffect } from "react";
import { onlineManager, useQueryClient } from "@tanstack/react-query";

/**
 * Configure TanStack Query onlineManager to use window online/offline events.
 */
if (typeof window !== "undefined") {
  onlineManager.setEventListener((setOnline) => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  });
}

export function useNetworkStatus() {
  const queryClient = useQueryClient();
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== "undefined" ? navigator.onLine : true
  );
  const [wasOffline, setWasOffline] = useState(false);
  const [showRestoredNotice, setShowRestoredNotice] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    let timer: NodeJS.Timeout | number | null = null;

    const onOnline = () => {
      setIsOnline(true);
      if (wasOffline) {
        setShowRestoredNotice(true);
        // Automatically revalidate active queries to restore fresh data
        queryClient.refetchQueries({ type: "active" }).catch(() => {});
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          setShowRestoredNotice(false);
          setWasOffline(false);
        }, 3500);
      }
    };

    const onOffline = () => {
      setIsOnline(false);
      setWasOffline(true);
      setShowRestoredNotice(false);
      if (timer) clearTimeout(timer);
    };

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);

    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [wasOffline, queryClient]);

  const checkConnection = () => {
    const online = typeof navigator !== "undefined" ? navigator.onLine : true;
    setIsOnline(online);
    if (online && wasOffline) {
      setShowRestoredNotice(true);
      queryClient.refetchQueries({ type: "active" }).catch(() => {});
      setTimeout(() => {
        setShowRestoredNotice(false);
        setWasOffline(false);
      }, 3500);
    }
    return online;
  };

  return {
    isOnline,
    wasOffline,
    showRestoredNotice,
    checkConnection,
  };
}
