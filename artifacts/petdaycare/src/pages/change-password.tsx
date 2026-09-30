import React, { useState } from "react";
import { useUpdateUser } from "@workspace/api-client-react";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Lock, Eye, EyeOff, AlertCircle } from "lucide-react";
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
    <div className="min-h-svh w-full flex flex-col bg-background font-sans">
      <div className="flex-1 flex flex-col items-center justify-center w-full max-w-md mx-auto px-6 py-12">
        
        {/* Header */}
        <div className="mb-8 w-full flex flex-col items-center text-center">
          <div className="h-16 w-16 bg-primary/10 rounded-2xl flex items-center justify-center mb-6">
            <Lock className="h-8 w-8 text-primary" />
          </div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight mb-2">Troque sua senha</h1>
          <p className="text-sm text-muted-foreground px-4">
            É necessário definir uma nova senha antes de continuar.
          </p>
        </div>

        {/* Card do Formulário */}
        <div className="w-full bg-card rounded-2xl border border-border p-6 shadow-sm">
          
          <div className="mb-6 p-4 rounded-xl border border-warning/30 bg-warning/10 text-warning">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 flex-shrink-0 mt-0.5" />
              <p className="text-sm leading-relaxed font-medium">
                Você está usando uma senha provisória. Por segurança, defina uma senha pessoal agora.
              </p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            {error && (
              <div className="flex items-start gap-3 p-3 rounded-xl border border-destructive/20 bg-destructive/5 text-destructive">
                <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                <p className="text-sm">{error}</p>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="newPassword" className="pl-1 text-sm font-medium text-foreground">
                Nova senha
              </Label>
              <div className="relative">
                <Input
                  id="newPassword"
                  type={showPw ? "text" : "password"}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Mínimo 6 caracteres"
                  required
                  className="pr-12 h-12 text-base md:text-sm"
                />
                <button
                  type="button"
                  onClick={() => setShowPw(!showPw)}
                  className="absolute inset-y-0 right-0 w-12 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors touch-manipulation"
                  aria-label={showPw ? "Ocultar senha" : "Mostrar senha"}
                >
                  {showPw ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirm" className="pl-1 text-sm font-medium text-foreground">
                Confirmar nova senha
              </Label>
              <Input
                id="confirm"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="Repita a senha"
                required
                className="h-12 text-base md:text-sm"
              />
            </div>

            <Button 
              type="submit" 
              className="w-full h-12 text-base font-medium mt-2" 
              isLoading={updateUser.isPending}
            >
              Definir nova senha e continuar
            </Button>
          </form>
        </div>
        
      </div>
    </div>
  );
}
