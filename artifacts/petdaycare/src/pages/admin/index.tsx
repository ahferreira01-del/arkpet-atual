import React from "react";
import { useListCreches, useListUsers } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Building2, Users, Activity, Sparkles } from "lucide-react";
import { Link } from "wouter";
import { PageHeader } from "@/components/layout/page-header";

export default function AdminDashboard() {
  const { data: creches, isLoading } = useListCreches();
  const { data: users } = useListUsers();

  const activeCreches = creches?.filter((c) => c.status === "active") ?? [];
  const inactiveCreches = creches?.filter((c) => c.status !== "active") ?? [];
  const totalCapacity = activeCreches.reduce((s, c) => s + ((c as any).maxCapacity ?? 0), 0);
  const totalOccupied = activeCreches.reduce((s, c) => s + ((c as any).currentOccupancy ?? 0), 0);
  const totalUsers = users?.length ?? 0;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <PageHeader
        title="Administração Master"
        description="Visão global da rede ArkPet."
        icon={Sparkles}
        action={
          <Link href="/admin/creches">
            <button className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors">
              <Building2 className="h-4 w-4" /> <span className="hidden sm:inline">Gerenciar Creches</span>
            </button>
          </Link>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-5 flex items-center justify-between">
            <div className="min-w-0">
              <p className="text-xs sm:text-sm font-medium text-muted-foreground mb-1">Creches Ativas</p>
              <h3 className="text-2xl sm:text-3xl font-display font-bold text-white">{activeCreches.length}</h3>
              <p className="text-xs text-muted-foreground mt-1">{inactiveCreches.length} inativas</p>
            </div>
            <div className="h-10 w-10 sm:h-12 sm:w-12 shrink-0 rounded-xl bg-primary/20 text-primary flex items-center justify-center">
              <Building2 className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5 flex items-center justify-between">
            <div className="min-w-0">
              <p className="text-xs sm:text-sm font-medium text-muted-foreground mb-1">Pets Presentes</p>
              <h3 className="text-2xl sm:text-3xl font-display font-bold text-white">{totalOccupied}</h3>
              <p className="text-xs text-muted-foreground mt-1">cap. total: {totalCapacity}</p>
            </div>
            <div className="h-10 w-10 sm:h-12 sm:w-12 shrink-0 rounded-xl bg-emerald-400/20 text-emerald-400 flex items-center justify-center">
              <Activity className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5 flex items-center justify-between">
            <div className="min-w-0">
              <p className="text-xs sm:text-sm font-medium text-muted-foreground mb-1">Total Usuários</p>
              <h3 className="text-2xl sm:text-3xl font-display font-bold text-white">{totalUsers}</h3>
              <p className="text-xs text-muted-foreground mt-1">na plataforma</p>
            </div>
            <div className="h-10 w-10 sm:h-12 sm:w-12 shrink-0 rounded-xl bg-violet-400/20 text-violet-400 flex items-center justify-center">
              <Users className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5 flex items-center justify-between">
            <div className="min-w-0">
              <p className="text-xs sm:text-sm font-medium text-muted-foreground mb-1">Ocupação Média</p>
              <h3 className="text-2xl sm:text-3xl font-display font-bold text-white">
                {totalCapacity > 0 ? Math.round((totalOccupied / totalCapacity) * 100) : 0}%
              </h3>
              <p className="text-xs text-muted-foreground mt-1">da rede</p>
            </div>
            <div className="h-10 w-10 sm:h-12 sm:w-12 shrink-0 rounded-xl bg-amber-400/20 text-amber-400 flex items-center justify-center">
              <Sparkles className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-5 sm:p-6">
          <h2 className="text-lg font-display font-semibold text-white mb-4">Creches Cadastradas</h2>
          {isLoading ? (
            <div className="text-center py-6 text-muted-foreground text-sm">Carregando...</div>
          ) : creches?.length ? (
            <div className="space-y-3">
              {creches.map(creche => (
                <Link key={creche.id} href="/admin/creches">
                  <div className="p-4 rounded-xl bg-white/5 border border-white/10 hover:border-white/20 hover:bg-white/[0.07] transition-colors flex items-center justify-between gap-3 cursor-pointer">
                    <div className="min-w-0">
                      <p className="font-semibold text-white truncate">{creche.name}</p>
                      <p className="text-xs sm:text-sm text-muted-foreground truncate">{creche.address || "Endereço não informado"}</p>
                    </div>
                    <Badge variant={creche.status === 'active' ? 'success' : 'secondary'} className="shrink-0">
                      {creche.status === 'active' ? 'Ativa' : 'Inativa'}
                    </Badge>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="text-center py-6 text-muted-foreground text-sm">Nenhuma creche encontrada.</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
