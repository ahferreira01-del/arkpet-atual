import React, { createContext, useContext, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useGetMe, UserProfile, useLogin, getGetMeQueryKey, useLogout } from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { toast } from "./use-toast";

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
    }
  });

  const loginMutation = useLogin({
    mutation: {
      onSuccess: (data: any) => {
        if (data?.token) {
          localStorage.setItem("auth_token", data.token);
        }
        queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
        setTimeout(() => setLocation("/"), 100);
        toast({ title: "Bem-vindo!", description: "Login realizado com sucesso." });
      },
      onError: () => {
        toast({
          title: "Falha no login",
          description: "Email ou senha inválidos.",
          variant: "destructive"
        });
      }
    }
  });

  const logoutMutation = useLogout({
    mutation: {
      onSettled: () => {
        localStorage.removeItem("auth_token");
        queryClient.setQueryData(getGetMeQueryKey(), null);
        queryClient.clear();
        setLocation("/login");
      }
    }
  });

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
