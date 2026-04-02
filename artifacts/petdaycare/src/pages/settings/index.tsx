import React, { useState } from "react";
import { useGetCreche, useUpdateCreche } from "@workspace/api-client-react";
import { useAuth } from "@/hooks/use-auth";
import { usePush } from "@/hooks/use-push";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Building2, MapPin, Phone, Globe, Save, Users, Bell, BellOff, BellRing, ShieldCheck } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";

export default function Settings() {
  const { user } = useAuth();
  const crecheId = user?.crecheId || 1;
  const queryClient = useQueryClient();
  const { data: creche, isLoading } = useGetCreche(crecheId);
  const updateMutation = useUpdateCreche();
  const [saved, setSaved] = useState(false);
  const { isSupported, permission, isSubscribed, isLoading: pushLoading, subscribe, unsubscribe } = usePush();

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    updateMutation.mutate(
      {
        crecheId,
        data: {
          name: formData.get("name") as string,
          address: formData.get("address") as string,
          phone: formData.get("phone") as string,
          maxCapacity: Number(formData.get("maxCapacity")),
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries();
          setSaved(true);
          setTimeout(() => setSaved(false), 3000);
        },
      }
    );
  };

  if (isLoading) return <div className="p-8 text-center text-muted-foreground">Carregando...</div>;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-2xl">
      <div>
        <h1 className="text-3xl font-display font-bold text-white">Configurações</h1>
        <p className="text-muted-foreground mt-1">Gerencie o perfil da creche e suas preferências.</p>
      </div>

      {/* Push Notifications Card */}
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center gap-3 mb-5 pb-4 border-b border-white/10">
            <div className={cn(
              "h-10 w-10 rounded-xl flex items-center justify-center transition-all duration-300",
              isSubscribed ? "bg-primary/20" : "bg-white/5"
            )}>
              {isSubscribed ? (
                <BellRing className="h-5 w-5 text-primary animate-pulse" />
              ) : (
                <Bell className="h-5 w-5 text-muted-foreground" />
              )}
            </div>
            <div>
              <h2 className="text-lg font-display font-semibold text-white">Notificações Push</h2>
              <p className="text-xs text-muted-foreground">Receba alertas mesmo com o app fechado</p>
            </div>
          </div>

          {!isSupported ? (
            <div className="flex items-center gap-3 p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-sm text-amber-300">
              <BellOff className="h-5 w-5 flex-shrink-0" />
              <p>Seu navegador não suporta notificações push. Use Chrome no Android ou Safari no iOS 16+.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Status indicator */}
              <div className={cn(
                "flex items-center justify-between p-4 rounded-xl border transition-all duration-300",
                isSubscribed
                  ? "bg-primary/5 border-primary/20"
                  : "bg-white/3 border-white/10"
              )}>
                <div className="flex items-center gap-3">
                  <div className={cn(
                    "h-2.5 w-2.5 rounded-full transition-all duration-300",
                    isSubscribed ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]" : "bg-muted-foreground/40"
                  )} />
                  <div>
                    <p className="text-sm font-medium text-white">
                      {isSubscribed ? "Notificações ativadas" : "Notificações desativadas"}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {permission === "denied"
                        ? "Permissão bloqueada — altere nas configurações do navegador"
                        : isSubscribed
                        ? "Este dispositivo receberá alertas em tempo real"
                        : "Ative para receber alertas de reservas, tarefas e mensagens"}
                    </p>
                  </div>
                </div>
                {permission !== "denied" && (
                  <Button
                    variant={isSubscribed ? "ghost" : "default"}
                    size="sm"
                    onClick={isSubscribed ? unsubscribe : subscribe}
                    isLoading={pushLoading}
                    className={cn(
                      "ml-4 shrink-0",
                      isSubscribed && "hover:bg-destructive/10 hover:text-destructive"
                    )}
                  >
                    {isSubscribed ? "Desativar" : "Ativar"}
                  </Button>
                )}
              </div>

              {/* What you'll get */}
              {!isSubscribed && permission !== "denied" && (
                <div className="grid grid-cols-1 gap-2">
                  {[
                    { icon: "🐾", label: "Check-in e check-out do seu pet" },
                    { icon: "📅", label: "Confirmação e mudanças de reserva" },
                    { icon: "📋", label: "Tarefas atribuídas a você" },
                    { icon: "💬", label: "Novas mensagens no chat" },
                  ].map((item) => (
                    <div key={item.label} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-white/3 text-sm text-muted-foreground">
                      <span>{item.icon}</span>
                      <span>{item.label}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Creche Info */}
      {user?.role !== "tutor" && (
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-3 mb-6 pb-4 border-b border-white/10">
              <div className="h-10 w-10 rounded-xl bg-primary/20 flex items-center justify-center">
                <Building2 className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h2 className="text-lg font-display font-semibold text-white">Dados da Creche</h2>
                {user?.role === "staff" && (
                  <p className="text-xs text-muted-foreground">Apenas visualização</p>
                )}
              </div>
            </div>

            {user?.role === "staff" ? (
              <div className="space-y-5 text-sm">
                <div className="flex items-start gap-3 py-3 border-b border-white/5">
                  <Building2 className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-muted-foreground text-xs mb-0.5">Nome</p>
                    <p className="font-medium text-white">{creche?.name || "—"}</p>
                  </div>
                </div>
                <div className="flex items-start gap-3 py-3 border-b border-white/5">
                  <MapPin className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-muted-foreground text-xs mb-0.5">Endereço</p>
                    <p className="font-medium text-white">{creche?.address || "—"}</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="flex items-start gap-3 py-3">
                    <Phone className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="text-muted-foreground text-xs mb-0.5">Telefone</p>
                      <p className="font-medium text-white">{creche?.phone || "—"}</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 py-3">
                    <Users className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="text-muted-foreground text-xs mb-0.5">Capacidade</p>
                      <p className="font-medium text-white">{creche?.maxCapacity || "—"} pets</p>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-5">
                <div className="space-y-2">
                  <label className="text-sm font-medium flex items-center gap-2">
                    <Building2 className="h-4 w-4 text-muted-foreground" /> Nome
                  </label>
                  <Input name="name" defaultValue={creche?.name || ""} required />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-muted-foreground" /> Endereço
                  </label>
                  <Input name="address" defaultValue={creche?.address || ""} placeholder="Rua das Flores, 123 - São Paulo" />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium flex items-center gap-2">
                      <Phone className="h-4 w-4 text-muted-foreground" /> Telefone
                    </label>
                    <Input name="phone" defaultValue={creche?.phone || ""} placeholder="(11) 99999-9999" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium flex items-center gap-2">
                      <Users className="h-4 w-4 text-muted-foreground" /> Capacidade
                    </label>
                    <Input name="maxCapacity" type="number" min={1} max={200} defaultValue={creche?.maxCapacity || 15} />
                  </div>
                </div>

                <div className="pt-2 flex items-center gap-4">
                  <Button type="submit" isLoading={updateMutation.isPending}>
                    <Save className="mr-2 h-4 w-4" /> Salvar Alterações
                  </Button>
                  {saved && (
                    <p className="text-sm text-emerald-400 flex items-center gap-1">
                      <ShieldCheck className="h-4 w-4" /> Salvo com sucesso
                    </p>
                  )}
                </div>
              </form>
            )}
          </CardContent>
        </Card>
      )}

      {/* Account Info */}
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center gap-3 mb-4 pb-4 border-b border-white/10">
            <div className="h-10 w-10 rounded-xl bg-white/5 flex items-center justify-center">
              <Globe className="h-5 w-5 text-muted-foreground" />
            </div>
            <h2 className="text-lg font-display font-semibold text-white">Minha Conta</h2>
          </div>
          <div className="grid grid-cols-2 gap-6 text-sm">
            <div>
              <p className="text-muted-foreground mb-1">Nome</p>
              <p className="font-medium text-white">{user?.name}</p>
            </div>
            <div>
              <p className="text-muted-foreground mb-1">Email</p>
              <p className="font-medium text-white">{user?.email}</p>
            </div>
            <div>
              <p className="text-muted-foreground mb-1">Perfil</p>
              <p className="font-medium text-white capitalize">
                {{ master_admin: "Master Admin", creche_admin: "Admin de Creche", staff: "Funcionário", tutor: "Tutor" }[user?.role || ""] || user?.role}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground mb-1">Creche</p>
              <p className="font-medium text-white">#{crecheId}</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
