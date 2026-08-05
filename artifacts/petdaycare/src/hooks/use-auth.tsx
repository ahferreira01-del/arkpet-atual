import React, { createContext, useContext, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useGetMe, UserProfile, useLogin, getGetMeQueryKey, useLogout } from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { toast } from "./use-toast";
import { getMediaTokenExpiryMs } from "../features/feed/utils/media.utils";

type AuthContextType = {
  user: UserProfile | null;
  isLoading: boolean;
  login: (vars: { data: { email: string; password: string } }) => void;
  logout: () => void;
};

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  const { data: user, isLoading: isUserLoading } = useGetMe({
    query: {
      retry: false,
      refetchOnWindowFocus: false,
      enabled: !!localStorage.getItem("auth_token"),
    } as any,
  });

  const loginMutation = useLogin({
    mutation: {
      onSuccess: (data: any) => {
        if (data?.token) {
          localStorage.setItem("auth_token", data.token);
        }
        if (data?.mediaToken) {
          localStorage.setItem("media_token", data.mediaToken);
          window.dispatchEvent(new Event("media_token_refresh"));
        }
        queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
        setTimeout(() => setLocation("/"), 100);
        toast({ title: "Bem-vindo!", description: "Login realizado com sucesso." });
      },
      onError: (err: any) => {
        const status = err?.status;
        const rawData = err?.data;
        const serverMsg =
          rawData && typeof rawData === "object"
            ? (rawData.error ?? rawData.message)
            : undefined;
        let msg: string;
        if (status === 429) {
          msg = "Muitas tentativas. Aguarde alguns minutos e tente novamente.";
        } else if (status === 401) {
          msg = serverMsg || "E-mail ou senha inválidos.";
        } else if (status === 403) {
          msg = serverMsg || "Acesso negado.";
        } else if (!status || status === 404 || status === 502 || status === 503 || status >= 500) {
          // No status = network/connection failure; 404/5xx with HTML body =
          // deployment is down or restarting. Never dump raw HTML to the user.
          msg = "Servidor temporariamente indisponível. Aguarde alguns instantes e tente novamente.";
        } else if (serverMsg) {
          msg = serverMsg;
        } else {
          msg = "Não foi possível entrar. Tente novamente.";
        }
        toast({
          title: "Falha no login",
          description: msg,
          variant: "destructive"
        });
      }
    }
  });

  const logoutMutation = useLogout({
    mutation: {
      onSettled: () => {
        localStorage.removeItem("auth_token");
        localStorage.removeItem("media_token");
        queryClient.setQueryData(getGetMeQueryKey(), null);
        queryClient.clear();
        setLocation("/login");
      }
    }
  });

  // Proactively refresh the media token when it is within 2 hours of expiry.
  // Runs on mount and then every 30 minutes so a long-lived session never hits
  // broken images due to a stale ?mt= credential.
  useEffect(() => {
    const REFRESH_BEFORE_MS = 2 * 60 * 60 * 1000; // 2 h
    const CHECK_INTERVAL_MS = 30 * 60 * 1000;      // 30 min

    async function maybeRefresh() {
      const authToken = localStorage.getItem("auth_token");
      if (!authToken) return; // not logged in

      const mediaToken = localStorage.getItem("media_token");
      const expiry = getMediaTokenExpiryMs(mediaToken ?? "");

      // Refresh if: token is missing, malformed, already expired, or expiring soon
      const needsRefresh = expiry === null || Date.now() > expiry - REFRESH_BEFORE_MS;
      if (!needsRefresh) return;

      try {
        const res = await fetch("/api/auth/refresh-media-token", {
          headers: { Authorization: `Bearer ${authToken}` },
        });
        if (!res.ok) return; // silently skip — server will reject expired auth tokens too
        const data = await res.json();
        if (data?.mediaToken) {
          localStorage.setItem("media_token", data.mediaToken);
          window.dispatchEvent(new Event("media_token_refresh"));
          console.log("[media-token] refreshed, new expiry in 24 h");
        }
      } catch {
        // Network failure — ignore; images will continue loading until the
        // current token actually expires
      }
    }

    maybeRefresh();
    const interval = setInterval(maybeRefresh, CHECK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user: user || null,
        isLoading: isUserLoading,
        login: (vars) => loginMutation.mutate(vars),
        logout: () => logoutMutation.mutate()
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within an AuthProvider");
  return context;
}
