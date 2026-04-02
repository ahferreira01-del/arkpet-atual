import React, { useState } from "react";
import { useUpdateUser } from "@workspace/api-client-react";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dog, Lock, Eye, EyeOff } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetMeQueryKey } from "@workspace/api-client-react";

export default function ChangePassword() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const updateUser = useUpdateUser();

  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (newPassword.length < 6) {
      setError("A senha deve ter pelo menos 6 caracteres.");
      return;
    }
    if (newPassword !== confirm) {
      setError("As senhas não conferem.");
      return;
    }
    updateUser.mutate(
      { userId: user!.id, data: { newPassword } as any },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
        },
        onError: () => setError("Erro ao atualizar senha. Tente novamente."),
      }
    );
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center relative overflow-hidden">
      <div className="fixed top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full bg-primary/10 blur-[120px] pointer-events-none" />
      <div className="fixed bottom-[-20%] right-[-10%] w-[40%] h-[50%] rounded-full bg-accent/10 blur-[120px] pointer-events-none" />

      <div className="w-full max-w-md px-6 z-10">
        <div className="flex flex-col items-center mb-8">
          <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-primary to-accent flex items-center justify-center shadow-[0_0_30px_rgba(139,92,246,0.4)] mb-4">
            <Dog className="h-8 w-8 text-white" />
          </div>
          <h1 className="text-3xl font-display font-bold text-white">LuxePets</h1>
        </div>

        <div className="glass-panel rounded-3xl p-8 border border-white/10">
          <div className="flex items-center gap-3 mb-2">
            <div className="h-10 w-10 rounded-xl bg-amber-500/20 flex items-center justify-center">
              <Lock className="h-5 w-5 text-amber-400" />
            </div>
            <div>
              <h2 className="text-xl font-display font-semibold text-white">Troque sua senha</h2>
              <p className="text-sm text-muted-foreground">É necessário definir uma nova senha antes de continuar.</p>
            </div>
          </div>

          <div className="my-5 px-4 py-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-sm text-amber-300">
            Você está usando uma senha provisória. Por segurança, defina uma senha pessoal agora.
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-white">Nova senha</label>
              <div className="relative">
                <Input
                  type={showPw ? "text" : "password"}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Mínimo 6 caracteres"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPw(!showPw)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-white"
                >
                  {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-white">Confirmar nova senha</label>
              <Input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="Repita a senha"
                required
              />
            </div>

            {error && (
              <p className="text-sm text-destructive bg-destructive/10 border border-destructive/20 px-3 py-2 rounded-lg">
                {error}
              </p>
            )}

            <Button type="submit" className="w-full h-12 mt-2" isLoading={updateUser.isPending}>
              Definir nova senha e continuar
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
