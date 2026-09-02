import React from "react";
import { Link, useLocation } from "wouter";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { StatCard } from "./stat-card";
import { useListCreches, useListUsers } from "@workspace/api-client-react";
import {
  Building2,
  BarChart2,
  Users,
  Dog,
  Sparkles,
  ChevronRight,
  Activity,
  Database,
  Bell,
  Shield,
  ArrowRight,
} from "lucide-react";

export function MasterAdminDashboard() {
  const { data: creches, isLoading } = useListCreches();
  const { data: allUsers } = useListUsers();
  const [, navigate] = useLocation();

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";

  const activeCreches = creches?.filter((c) => c.status === "active") ?? [];
  const inactiveCreches = creches?.filter((c) => c.status !== "active") ?? [];
  const totalCapacity = activeCreches.reduce((s, c) => s + ((c as any).maxCapacity ?? 0), 0);
  const totalOccupied = activeCreches.reduce((s, c) => s + ((c as any).currentOccupancy ?? 0), 0);
  const avgOccupancy = totalCapacity > 0 ? Math.round((totalOccupied / totalCapacity) * 100) : 0;

  const totalUsers = allUsers?.length ?? 0;
  const totalTutors = allUsers?.filter((u: any) => u.role === "tutor").length ?? 0;
  const totalStaff = allUsers?.filter((u: any) => u.role === "staff" || u.role === "creche_admin").length ?? 0;

  const systemServices = [
    { label: "API & Backend", icon: <Activity className="h-4 w-4" />, status: "online" },
    { label: "Banco de Dados", icon: <Database className="h-4 w-4" />, status: "online" },
    { label: "Notificações Push", icon: <Bell className="h-4 w-4" />, status: "online" },
    { label: "Segurança & Auth", icon: <Shield className="h-4 w-4" />, status: "online" },
  ];

  // Sort by occupancy % desc
  const sortedCreches = [...(creches ?? [])].sort((a, b) => {
    const pctA = (a as any).maxCapacity > 0 ? ((a as any).currentOccupancy / (a as any).maxCapacity) : 0;
    const pctB = (b as any).maxCapacity > 0 ? ((b as any).currentOccupancy / (b as any).maxCapacity) : 0;
    return pctB - pctA;
  });

  return (
    <div className="space-y-6 sm:space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground mb-1">
            {format(new Date(), "EEEE, d 'de' MMMM 'de' yyyy", { locale: ptBR })}
          </p>
          <h1 className="text-2xl sm:text-3xl font-display font-bold text-foreground">{greeting}, Master!</h1>
          <p className="text-muted-foreground mt-1">Visão global de toda a rede ArkPet.</p>
        </div>
        <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-500/10 border border-emerald-500/20 self-start sm:self-auto">
          <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-sm text-emerald-600 dark:text-emerald-400 font-medium">Rede Operacional</span>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <Link href="/admin?status=active">
          <StatCard
            title="Creches Ativas"
            value={activeCreches.length.toString()}
            subValue={`${inactiveCreches.length} inativas`}
            icon={<Building2 className="h-5 w-5" />}
            iconColor="text-primary"
            iconBg="bg-primary/20"
            clickable
          />
        </Link>
        <StatCard
          title="Ocupação Média"
          value={`${avgOccupancy}%`}
          subValue={`${totalOccupied} pets presentes`}
          icon={<BarChart2 className="h-5 w-5" />}
          iconColor={avgOccupancy > 80 ? "text-amber-500 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"}
          iconBg={avgOccupancy > 80 ? "bg-amber-400/20" : "bg-emerald-400/20"}
        />
        <Link href="/admin/users?role=tutor">
          <StatCard
            title="Usuários Totais"
            value={totalUsers.toString()}
            subValue={`${totalTutors} tutores · ${totalStaff} equipe`}
            icon={<Users className="h-5 w-5" />}
            iconColor="text-violet-500 dark:text-violet-400"
            iconBg="bg-violet-400/20"
            clickable
          />
        </Link>
        <StatCard
          title="Pets na Rede"
          value={totalOccupied.toString()}
          subValue={`cap. total: ${totalCapacity}`}
          icon={<Dog className="h-5 w-5" />}
          iconColor="text-blue-500 dark:text-blue-400"
          iconBg="bg-blue-400/20"
        />
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Creches list */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-display font-semibold text-foreground">Creches da Rede</h2>
            <Link href="/admin">
              <Button variant="outline" size="sm" className="gap-1.5 min-h-[44px] sm:min-h-0">
                <Sparkles className="h-3.5 w-3.5" /> Painel Completo
              </Button>
            </Link>
          </div>
          <Card className="shadow-sm">
            <CardContent className="p-0">
              {isLoading ? (
                <div className="p-8 text-center text-muted-foreground">Carregando...</div>
              ) : sortedCreches.length ? (
                <div className="divide-y divide-border">
                  {sortedCreches.map((creche) => {
                    const occ = (creche as any).currentOccupancy ?? 0;
                    const cap = (creche as any).maxCapacity ?? 0;
                    const pct = cap > 0 ? Math.round((occ / cap) * 100) : 0;
                    const isActive = creche.status === "active";
                    const barColor = pct >= 90 ? "bg-red-500" : pct >= 70 ? "bg-amber-400" : "bg-emerald-400";
                    return (
                      <Link key={creche.id} href="/admin">
                        <div className="p-4 sm:p-5 hover:bg-secondary transition-colors cursor-pointer group min-h-[44px]">
                          <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-3 sm:gap-4 min-w-0">
                              <div className="h-10 w-10 sm:h-11 sm:w-11 rounded-xl bg-primary/10 dark:bg-primary/20 flex items-center justify-center shrink-0 group-hover:bg-primary/20 dark:group-hover:bg-primary/30 transition-colors">
                                <Building2 className="h-4 w-4 sm:h-5 sm:w-5 text-primary" />
                              </div>
                              <div className="min-w-0 pr-2">
                                <p className="font-semibold text-foreground group-hover:text-primary transition-colors min-w-0 break-words">{creche.name}</p>
                                <p className="text-xs sm:text-sm text-muted-foreground truncate">
                                  {creche.address || "Endereço não informado"}
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <Badge variant={isActive ? "success" : "secondary"} className="text-[10px] sm:text-xs">
                                {isActive ? "Ativa" : "Inativa"}
                              </Badge>
                              <ChevronRight className="h-4 w-4 text-muted-foreground opacity-50 group-hover:opacity-100 transition-opacity hidden sm:block" />
                            </div>
                          </div>
                          {cap > 0 ? (
                            <div className="pl-[52px] sm:pl-[60px]">
                              <div className="flex items-center justify-between text-xs text-muted-foreground mb-1.5">
                                <span>Ocupação atual</span>
                                <span className="font-medium text-foreground">{occ}/{cap} pets · {pct}%</span>
                              </div>
                              <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
                                <div className={`h-full rounded-full transition-all duration-700 ${barColor}`} style={{ width: `${pct}%` }} />
                              </div>
                            </div>
                          ) : (
                            <div className="pl-[52px] sm:pl-[60px]">
                              <p className="text-xs text-muted-foreground">Capacidade não configurada</p>
                            </div>
                          )}
                        </div>
                      </Link>
                    );
                  })}
                </div>
              ) : (
                <EmptyState icon={Building2} title="Nenhuma creche" description="Nenhuma creche cadastrada ainda." className="py-12" />
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right sidebar */}
        <div className="space-y-5">

          {/* System health */}
          <div>
            <h2 className="text-lg font-display font-semibold text-foreground mb-3">Saúde do Sistema</h2>
            <Card className="shadow-sm">
              <CardContent className="p-4 sm:p-5 space-y-4">
                {systemServices.map(({ label, icon, status }) => (
                  <div key={label} className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-muted-foreground">{icon}</span>
                      <span className="text-sm text-muted-foreground">{label}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`h-2 w-2 rounded-full ${status === "online" ? "bg-emerald-400 animate-pulse" : "bg-red-400"}`} />
                      <span className={`text-xs font-semibold ${status === "online" ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                        {status === "online" ? "Online" : "Offline"}
                      </span>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          {/* Quick actions */}
          <div>
            <h2 className="text-lg font-display font-semibold text-foreground mb-3">Ações Rápidas</h2>
            <div className="space-y-2">
              {[
                { href: "/admin", icon: <Building2 className="h-4 w-4" />, bg: "bg-primary/10 dark:bg-primary/20", color: "text-primary", label: "Gerenciar Creches", desc: "Editar, adicionar ou desativar" },
                { href: "/admin/users", icon: <Users className="h-4 w-4" />, bg: "bg-blue-500/10 dark:bg-blue-500/20", color: "text-blue-600 dark:text-blue-400", label: "Todos os Usuários", desc: "Gerir contas e permissões" },
              ].map(({ href, icon, bg, color, label, desc }) => (
                <Link key={href} href={href}>
                  <div className="flex items-center gap-3 p-3.5 rounded-xl bg-card hover:bg-secondary border border-border hover:border-border transition-all cursor-pointer group min-h-[44px] shadow-sm">
                    <div className={`h-9 w-9 rounded-lg flex items-center justify-center flex-shrink-0 ${bg} ${color}`}>
                      {icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-foreground min-w-0 break-words">{label}</p>
                      <p className="text-xs text-muted-foreground truncate">{desc}</p>
                    </div>
                    <ArrowRight className="h-3.5 w-3.5 text-muted-foreground opacity-50 group-hover:opacity-100 transition-opacity" />
                  </div>
                </Link>
              ))}
            </div>
          </div>

          {/* Network summary */}
          <Card className="bg-primary/5 dark:bg-primary/10 border-primary/20 shadow-sm">
            <CardContent className="p-4 sm:p-5">
              <p className="text-xs text-muted-foreground uppercase tracking-widest mb-4">Resumo da Rede</p>
              <div className="grid grid-cols-2 gap-4">
                {[
                  { label: "Total Creches", value: creches?.length ?? 0 },
                  { label: "Ativas", value: activeCreches.length },
                  { label: "Pets Presentes", value: totalOccupied },
                  { label: "Capacidade Total", value: totalCapacity || "—" },
                  { label: "Total Usuários", value: totalUsers },
                  { label: "Tutores", value: totalTutors },
                ].map(({ label, value }) => (
                  <div key={label} className="min-w-0">
                    <p className="text-xl font-display font-bold text-foreground min-w-0 break-words">{value}</p>
                    <p className="text-xs text-muted-foreground truncate">{label}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
