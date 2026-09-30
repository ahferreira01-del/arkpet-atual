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
  FileSignature,
  Megaphone,
  UserCog,
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
    <div className="space-y-6 sm:space-y-8 animate-in fade-in duration-300">
      {/* ── Executive Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 pb-1 border-b border-border/40">
        <div>
          <p className="text-xs sm:text-sm text-muted-foreground font-medium mb-1">
            {format(new Date(), "EEEE, d 'de' MMMM 'de' yyyy", { locale: ptBR })}
          </p>
          <h1 className="text-2xl sm:text-3xl font-display font-bold tracking-tight text-foreground">
            {greeting}, Master!
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Visão global de toda a rede ArkPet.</p>
        </div>
        <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-success/15 border border-success/30 self-start sm:self-auto select-none">
          <span className="h-2 w-2 rounded-full bg-success animate-pulse" />
          <span className="text-xs text-success font-semibold tracking-tight">Rede Operacional</span>
        </div>
      </div>

      {/* ── Primary KPI Cards (Backed by real query data) ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <Link href="/admin/creches?status=active">
          <StatCard
            title="Creches Ativas"
            value={activeCreches.length.toString()}
            subValue={`${inactiveCreches.length} inativas`}
            icon={<Building2 className="h-5 w-5" />}
            iconColor="text-primary"
            iconBg="bg-primary/15"
            clickable
          />
        </Link>
        <StatCard
          title="Ocupação Média"
          value={`${avgOccupancy}%`}
          subValue={`${totalOccupied} pets presentes`}
          icon={<BarChart2 className="h-5 w-5" />}
          iconColor={avgOccupancy > 80 ? "text-warning" : "text-success"}
          iconBg={avgOccupancy > 80 ? "bg-warning/15" : "bg-success/15"}
        />
        <Link href="/admin/users?role=tutor">
          <StatCard
            title="Usuários Totais"
            value={totalUsers.toString()}
            subValue={`${totalTutors} tutores · ${totalStaff} equipe`}
            icon={<Users className="h-5 w-5" />}
            iconColor="text-info"
            iconBg="bg-info/15"
            clickable
          />
        </Link>
        <StatCard
          title="Pets na Rede"
          value={totalOccupied.toString()}
          subValue={`cap. total: ${totalCapacity}`}
          icon={<Dog className="h-5 w-5" />}
          iconColor="text-primary"
          iconBg="bg-primary/15"
        />
      </div>

      {/* ── Main Command Grid ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Creches da Rede (2 columns on lg) */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg sm:text-xl font-display font-semibold text-foreground tracking-tight">
                Creches da Rede
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Status operacional e ocupação por unidade
              </p>
            </div>
            <Link href="/admin">
              <Button variant="outline" size="sm" className="gap-1.5 min-h-[36px]">
                <Sparkles className="h-3.5 w-3.5" /> Painel Completo
              </Button>
            </Link>
          </div>

          <Card className="shadow-xs overflow-hidden">
            <CardContent className="p-0">
              {isLoading ? (
                <div className="p-8 text-center text-sm text-muted-foreground">Carregando...</div>
              ) : sortedCreches.length ? (
                <div className="divide-y divide-border/70">
                  {sortedCreches.map((creche) => {
                    const occ = (creche as any).currentOccupancy ?? 0;
                    const cap = (creche as any).maxCapacity ?? 0;
                    const pct = cap > 0 ? Math.round((occ / cap) * 100) : 0;
                    const isActive = creche.status === "active";
                    const barColor =
                      pct >= 90
                        ? "bg-destructive"
                        : pct >= 70
                        ? "bg-warning"
                        : "bg-success";

                    return (
                      <Link key={creche.id} href="/admin">
                        <div className="p-4 sm:p-5 hover:bg-secondary/60 transition-colors cursor-pointer group min-h-[44px]">
                          <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-3 sm:gap-4 min-w-0">
                              <div className="h-10 w-10 sm:h-11 sm:w-11 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0 group-hover:bg-primary/20 transition-colors">
                                <Building2 className="h-5 w-5 text-primary" />
                              </div>
                              <div className="min-w-0 pr-2">
                                <p className="font-semibold text-foreground group-hover:text-primary transition-colors truncate">
                                  {creche.name}
                                </p>
                                <p className="text-xs text-muted-foreground truncate">
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
                                <span className="font-medium text-foreground">
                                  {occ}/{cap} pets · {pct}%
                                </span>
                              </div>
                              <div className="h-2 rounded-full bg-secondary overflow-hidden">
                                <div
                                  className={`h-full rounded-full transition-all duration-500 ${barColor}`}
                                  style={{ width: `${pct}%` }}
                                />
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
                <EmptyState
                  icon={Building2}
                  title="Nenhuma creche"
                  description="Nenhuma creche cadastrada ainda."
                  className="py-12"
                />
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right Sidebar (Health, Quick Actions, Network Summary) */}
        <div className="space-y-6">
          {/* Saúde do Sistema */}
          <div>
            <h2 className="text-base font-display font-semibold text-foreground mb-3 tracking-tight">
              Saúde do Sistema
            </h2>
            <Card className="shadow-xs">
              <CardContent className="p-4 sm:p-5 space-y-3.5">
                {systemServices.map(({ label, icon, status }) => (
                  <div key={label} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-3">
                      <span className="text-muted-foreground">{icon}</span>
                      <span className="text-foreground/90 font-medium">{label}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className={`h-2 w-2 rounded-full ${
                          status === "online" ? "bg-success animate-pulse" : "bg-destructive"
                        }`}
                      />
                      <span
                        className={`text-xs font-semibold ${
                          status === "online" ? "text-success" : "text-destructive"
                        }`}
                      >
                        {status === "online" ? "Online" : "Offline"}
                      </span>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          {/* Ações Rápidas */}
          <div>
            <h2 className="text-base font-display font-semibold text-foreground mb-3 tracking-tight">
              Ações Rápidas
            </h2>
            <div className="space-y-2">
              {[
                {
                  href: "/admin/creches",
                  icon: <Building2 className="h-4 w-4" />,
                  bg: "bg-primary/10 text-primary border border-primary/20",
                  label: "Gerenciar Creches",
                  desc: "Editar, adicionar ou desativar",
                },
                {
                  href: "/admin/proposals",
                  icon: <FileSignature className="h-4 w-4" />,
                  bg: "bg-success/15 text-success border border-success/30",
                  label: "Propostas & Serviços",
                  desc: "Contratos e propostas comerciais",
                },
                {
                  href: "/admin/campaigns",
                  icon: <Megaphone className="h-4 w-4" />,
                  bg: "bg-warning/15 text-warning border border-warning/30",
                  label: "Campanhas Comerciais",
                  desc: "Descontos e condições SaaS",
                },
                {
                  href: "/admin/users",
                  icon: <UserCog className="h-4 w-4" />,
                  bg: "bg-info/15 text-info border border-info/30",
                  label: "Todos os Usuários",
                  desc: "Gerir contas e permissões",
                },
              ].map(({ href, icon, bg, label, desc }) => (
                <Link key={href} href={href}>
                  <div className="flex items-center gap-3 p-3.5 rounded-xl bg-card hover:bg-secondary border border-border transition-all cursor-pointer group min-h-[44px] shadow-xs">
                    <div className={`h-9 w-9 rounded-lg flex items-center justify-center shrink-0 ${bg}`}>
                      {icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors truncate">
                        {label}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">{desc}</p>
                    </div>
                    <ArrowRight className="h-3.5 w-3.5 text-muted-foreground opacity-50 group-hover:opacity-100 transition-opacity shrink-0" />
                  </div>
                </Link>
              ))}
            </div>
          </div>

          {/* Resumo da Rede */}
          <Card className="bg-primary/5 border-primary/20 shadow-xs">
            <CardContent className="p-4 sm:p-5">
              <p className="text-[11px] text-muted-foreground uppercase font-semibold tracking-wider mb-3">
                Resumo da Rede
              </p>
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
                    <p className="text-xl font-display font-bold text-foreground truncate">{value}</p>
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
