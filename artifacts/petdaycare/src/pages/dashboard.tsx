import React, { useEffect, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import {
  useListTasks,
  useListPets,
  useGetCrecheStats,
  useListBookings,
  useListCreches,
  useListWalks,
  useListCrecheStaff,
  useUpdateBooking,
  useCompleteTask,
  useListUsers,
  ListTasksStatus,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import {
  CheckSquare,
  Dog,
  TrendingUp,
  Calendar,
  AlertCircle,
  Building2,
  Users,
  Clock,
  MessageSquare,
  Footprints,
  BarChart2,
  Activity,
  Shield,
  Bell,
  Database,
  ArrowRight,
  CheckCircle2,
  XCircle,
  Sparkles,
  QrCode,
  ChevronRight,
  UserCheck,
  LogIn,
  LogOut,
  UtensilsCrossed,
  Pill,
  Camera,
  Video,
  FileText,
  Heart,
  Gamepad2,
  RefreshCw,
} from "lucide-react";
import { Link, useLocation } from "wouter";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { parseUTC, todayBrazil, parseLocalDate } from "@/lib/date-utils";
import { resolvePhotoUrl } from "@/lib/utils";
import { usePush } from "@/hooks/use-push";

// ─── Componente de Prompt de Notificação ──────────────────────────────────────
function NotificationPrompt() {
  const { isSupported, permission, isSubscribed, isLoading, subscribe } = usePush();
  const [dismissed, setDismissed] = useState(false);

  if (!isSupported || permission !== "default" || isSubscribed || dismissed) {
    return null;
  }

  return (
    <div className="mb-6 p-4 rounded-2xl bg-gradient-to-r from-primary/20 to-accent/20 border border-primary/30 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 animate-in fade-in slide-in-from-top-4">
      <div className="flex items-start sm:items-center gap-3">
        <div className="h-10 w-10 rounded-xl bg-primary/20 flex items-center justify-center shrink-0 mt-1 sm:mt-0">
          <Bell className="h-5 w-5 text-primary animate-pulse" />
        </div>
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-white">Ative as Notificações</h3>
          <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">Receba alertas de reservas, check-in e mensagens em tempo real.</p>
        </div>
      </div>
      <div className="flex items-center gap-2 w-full sm:w-auto justify-end shrink-0">
        <Button variant="ghost" size="sm" onClick={() => setDismissed(true)} className="text-muted-foreground hover:text-white">
          Agora não
        </Button>
        <Button size="sm" onClick={subscribe} isLoading={isLoading} className="bg-primary hover:bg-primary/90 text-white">
          Ativar
        </Button>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  if (user?.role === "staff") return <StaffDashboard user={user} />;
  if (user?.role === "master_admin") return <MasterAdminDashboard />;
  if (user?.role === "tutor") return <TutorDashboard user={user} />;
  return <CrecheDashboard crecheId={user?.crecheId || 1} user={user} />;
}

// ─── Creche Admin ──────────────────────────────────────────────────────────────
function CrecheDashboard({ crecheId, user }: { crecheId: number; user: any }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [, navigate] = useLocation();

  useEffect(() => {
    const id = setInterval(() => queryClient.invalidateQueries(), 20_000);
    return () => clearInterval(id);
  }, [queryClient]);

  const { data: stats } = useGetCrecheStats(crecheId);
  const { data: pets, isLoading: petsLoading } = useListPets(crecheId);
  const { data: bookings, isLoading: bookingsLoading } = useListBookings(crecheId);
  const { data: tasks, isLoading: tasksLoading } = useListTasks(crecheId, { status: "pending" as ListTasksStatus, date: todayBrazil() });
  const { data: walks } = (useListWalks as any)(crecheId);
  const { data: staff } = useListCrecheStaff(crecheId);

  const updateBookingMutation = useUpdateBooking();
  const completeTaskMutation = useCompleteTask();

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";
  const firstName = user?.name?.split(" ")[0] || "Admin";

  const petsArray = Array.isArray(pets) ? pets : (pets as any)?.items || [];
  const bookingsArray = Array.isArray(bookings) ? bookings : (bookings as any)?.items || [];

  const checkedIn = petsArray.filter((p: any) => p.isCheckedIn) || [];
  const checkedInIds = new Set(checkedIn.map((p: any) => p.id).filter((id: any): id is number => id != null));
  const pendingBookings = bookingsArray.filter((b: any) => b.status === "pending") || [];
  const activeWalks = (walks || []).filter((w: any) => w.status === "in_progress");
  const activeTasks = (tasks || []).filter((t) => t.petId != null && checkedInIds.has(t.petId));
  const todayTasks = activeTasks.slice(0, 4);
  const staffCount = (staff || []).filter((s: any) => s.isActive !== false).length;

  const confirmBooking = (bookingId: number) => {
    updateBookingMutation.mutate(
      { crecheId, bookingId, data: { status: "confirmed" } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries();
          toast({ title: "Reserva confirmada!" });
        },
      }
    );
  };

  const cancelBooking = (bookingId: number) => {
    updateBookingMutation.mutate(
      { crecheId, bookingId, data: { status: "cancelled" } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries();
          toast({ title: "Reserva cancelada." });
        },
      }
    );
  };

  const bookingTypeLabel: Record<string, string> = {
    daycare: "Creche",
    overnight: "Pernoite",
    grooming: "Banho/Tosa",
    visita: "Visita",
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground mb-1">
            {format(new Date(), "EEEE, d 'de' MMMM 'de' yyyy", { locale: ptBR })}
          </p>
          <h1 className="text-2xl sm:text-3xl font-display font-bold text-white">{greeting}, {firstName}!</h1>
          <p className="text-muted-foreground mt-1">Veja o que está acontecendo na sua creche hoje.</p>
        </div>
        <Link href="/staff/qr-scanner">
          <Button variant="glass" className="gap-2 self-start sm:self-auto">
            <QrCode className="h-4 w-4" /> Check-in QR
          </Button>
        </Link>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Link href="/pets?filter=present">
          <StatCard
            title="Pets Presentes"
            value={checkedIn.length.toString()}
            subValue={`de ${pets?.length || 0} cadastrados`}
            icon={<Dog className="h-5 w-5" />}
            iconBg="bg-primary/20"
            iconColor="text-primary"
            clickable
          />
        </Link>
        <Link href="/bookings?status=pending">
          <StatCard
            title="Reservas Pendentes"
            value={stats?.pendingBookings?.toString() ?? pendingBookings.length.toString()}
            subValue="aguardando confirmação"
            icon={<Calendar className="h-5 w-5" />}
            iconBg={pendingBookings.length > 0 ? "bg-amber-400/20" : "bg-blue-500/20"}
            iconColor={pendingBookings.length > 0 ? "text-amber-400" : "text-blue-400"}
            alert={pendingBookings.length > 0}
            clickable
          />
        </Link>
        <Link href="/staff?filter=present">
          <StatCard
            title="Tarefas Pendentes"
            value={activeTasks.length.toString()}
            subValue="para hoje"
            icon={<CheckSquare className="h-5 w-5" />}
            iconBg={activeTasks.length > 0 ? "bg-red-500/20" : "bg-emerald-500/20"}
            iconColor={activeTasks.length > 0 ? "text-red-400" : "text-emerald-400"}
            clickable
          />
        </Link>
        <Link href="/staff/manage">
          <StatCard
            title="Equipe Ativa"
            value={staffCount.toString()}
            subValue="membros"
            icon={<Users className="h-5 w-5" />}
            iconBg="bg-violet-500/20"
            iconColor="text-violet-400"
            clickable
          />
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Left col: pets + bookings */}
        <div className="lg:col-span-2 space-y-6">

          {/* Pending bookings */}
          {pendingBookings.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-lg font-display font-semibold text-white flex items-center gap-2">
                  <AlertCircle className="h-5 w-5 text-amber-400" />
                  Reservas Aguardando Confirmação
                  <Badge variant="warning">{pendingBookings.length}</Badge>
                </h2>
                <Link href="/bookings">
                  <button className="text-xs text-primary hover:text-primary/80 transition-colors">Ver todas →</button>
                </Link>
              </div>
              <Card className="border-amber-400/20">
                <CardContent className="p-0">
                  {bookingsLoading ? (
                    <div className="p-6 text-center text-muted-foreground">Carregando...</div>
                  ) : (
                    <div className="divide-y divide-white/5">
                      {pendingBookings.slice(0, 4).map((b) => (
                        <div key={b.id} className="p-4 flex items-center justify-between gap-3">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="h-10 w-10 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                              <Dog className="h-4 w-4 text-primary" />
                            </div>
                            <div className="min-w-0">
                              <p className="font-semibold text-white text-sm truncate">{b.petName}</p>
                              <p className="text-xs text-muted-foreground">
                                {bookingTypeLabel[b.type] || b.type} · {format(parseLocalDate(b.startDate), "dd/MM", { locale: ptBR })}
                                {b.endDate && ` → ${format(parseLocalDate(b.endDate), "dd/MM", { locale: ptBR })}`}
                              </p>
                            </div>
                          </div>
                          <div className="flex gap-2 flex-shrink-0">
                            <button
                              onClick={() => cancelBooking(b.id)}
                              className="h-8 w-8 rounded-lg border border-red-500/30 text-red-400 hover:bg-red-500/10 flex items-center justify-center transition-colors"
                              title="Cancelar"
                            >
                              <XCircle className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => confirmBooking(b.id)}
                              className="h-8 px-3 rounded-lg border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 flex items-center gap-1 text-xs font-medium transition-colors"
                              title="Confirmar"
                            >
                              <CheckCircle2 className="h-3.5 w-3.5" /> Confirmar
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          )}

          {/* Pets presentes */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-display font-semibold text-white flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                Pets Presentes
                {checkedIn.length > 0 && <span className="text-muted-foreground text-sm font-normal">({checkedIn.length})</span>}
              </h2>
              <Link href="/pets">
                <button className="text-xs text-primary hover:text-primary/80 transition-colors">Ver todos →</button>
              </Link>
            </div>
            <Card>
              <CardContent className="p-0">
                {petsLoading ? (
                  <div className="p-8 text-center text-muted-foreground">Carregando...</div>
                ) : checkedIn.length ? (
                  <div className="divide-y divide-white/5">
                    {checkedIn.map((pet) => (
                      <Link key={pet.id} href={`/pets/${pet.id}`}>
                        <div className="flex items-center justify-between gap-3 p-4 hover:bg-white/5 transition-colors cursor-pointer group">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="h-12 w-12 rounded-full overflow-hidden bg-gradient-to-tr from-primary/40 to-accent/40 flex-shrink-0">
                              {pet.photoUrl ? (
                                <img src={resolvePhotoUrl(pet.photoUrl)!} alt={pet.name} className="h-full w-full object-cover" />
                              ) : (
                                <div className="h-full w-full flex items-center justify-center">
                                  <Dog className="h-5 w-5 text-white/60" />
                                </div>
                              )}
                            </div>
                            <div className="min-w-0">
                              <p className="font-medium text-white group-hover:text-primary transition-colors truncate">{pet.name}</p>
                              <p className="text-sm text-muted-foreground capitalize truncate">{pet.breed || pet.species}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <Badge variant="success">Presente</Badge>
                            <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                          </div>
                        </div>
                      </Link>
                    ))}
                  </div>
                ) : (
                  <EmptyState
                    icon={Dog}
                    title="Nenhum pet com check-in"
                    description="Use o leitor QR para registrar a chegada dos pets."
                    action={{ label: "Abrir QR Scanner", onClick: () => navigate("/staff/qr-scanner") }}
                    className="py-10"
                  />
                )}
              </CardContent>
            </Card>
          </div>

          {/* Active walks */}
          {activeWalks.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-lg font-display font-semibold text-white flex items-center gap-2">
                  <Footprints className="h-5 w-5 text-emerald-400" /> Passeios em Andamento
                  <Badge variant="success">{activeWalks.length}</Badge>
                </h2>
                <Link href="/walks">
                  <button className="text-xs text-primary hover:text-primary/80 transition-colors">Ver todos →</button>
                </Link>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {activeWalks.map((w: any) => (
                  <Link key={w.id} href="/walks">
                    <div className="glass-panel p-4 rounded-xl hover:bg-white/10 transition-all cursor-pointer">
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-full bg-emerald-500/20 flex items-center justify-center flex-shrink-0">
                          <Footprints className="h-4 w-4 text-emerald-400" />
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium text-white text-sm truncate">{w.petName || "Pet"}</p>
                          <p className="text-xs text-emerald-400">Em andamento</p>
                        </div>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right sidebar */}
        <div className="space-y-6">

          {/* Pending tasks */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-display font-semibold text-white flex items-center gap-2">
                <Clock className="h-5 w-5 text-amber-400" /> Tarefas Hoje
              </h2>
              <Link href="/staff">
                <button className="text-xs text-primary hover:text-primary/80 transition-colors">Ver todas →</button>
              </Link>
            </div>
            <Card>
              <CardContent className="p-0">
                {tasksLoading ? (
                  <div className="p-5 text-center text-muted-foreground text-sm">Carregando...</div>
                ) : todayTasks.length ? (
                  <div className="divide-y divide-white/5">
                    {todayTasks.map((task) => (
                      <div key={task.id} className="p-3.5 flex items-center gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-white text-sm truncate">{task.title}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {task.petName && <span className="text-primary mr-1">{task.petName} ·</span>}
                            {format(new Date(task.scheduledFor), "HH:mm")}
                          </p>
                        </div>
                        <Badge variant={task.priority === "high" ? "destructive" : "secondary"} className="text-xs flex-shrink-0">
                          {task.priority === "high" ? "Alta" : task.priority === "medium" ? "Média" : "Baixa"}
                        </Badge>
                      </div>
                    ))}
                    {(tasks?.length || 0) > 4 && (
                      <Link href="/staff">
                        <div className="p-3 text-center text-xs text-primary hover:bg-white/5 transition-colors cursor-pointer">
                          +{(tasks?.length || 0) - 4} tarefas pendentes →
                        </div>
                      </Link>
                    )}
                  </div>
                ) : (
                  <div className="p-5 flex items-center gap-3">
                    <CheckCircle2 className="h-5 w-5 text-emerald-400 flex-shrink-0" />
                    <p className="text-sm text-emerald-400 font-medium">Todas as tarefas concluídas!</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Quick actions */}
          <div>
            <h2 className="text-lg font-display font-semibold text-white mb-3">Ações Rápidas</h2>
            <div className="space-y-2">
              {[
                { href: "/bookings", icon: <Calendar className="h-4 w-4" />, bg: "bg-blue-500/20", color: "text-blue-400", label: "Nova Reserva", desc: "Agendar estadia ou serviço" },
                { href: "/pets", icon: <Dog className="h-4 w-4" />, bg: "bg-primary/20", color: "text-primary", label: "Cadastrar Pet", desc: "Adicionar novo pet ao sistema" },
                { href: "/staff", icon: <CheckSquare className="h-4 w-4" />, bg: "bg-amber-400/20", color: "text-amber-400", label: "Ver Tarefas", desc: "Checklist de tarefas do dia" },
                { href: "/staff/manage", icon: <Users className="h-4 w-4" />, bg: "bg-violet-500/20", color: "text-violet-400", label: "Gerenciar Equipe", desc: "Membros e permissões" },
                { href: "/tutors", icon: <UserCheck className="h-4 w-4" />, bg: "bg-emerald-500/20", color: "text-emerald-400", label: "Tutores", desc: "Tutores e seus pets" },
                { href: "/chat", icon: <MessageSquare className="h-4 w-4" />, bg: "bg-pink-500/20", color: "text-pink-400", label: "Chat Interno", desc: "Mensagens da equipe" },
              ].map(({ href, icon, bg, color, label, desc }) => (
                <Link key={href} href={href}>
                  <div className="flex items-center gap-3 p-3 rounded-xl hover:bg-white/5 border border-transparent hover:border-white/10 transition-all cursor-pointer group">
                    <div className={`h-9 w-9 rounded-lg flex items-center justify-center flex-shrink-0 ${bg} ${color} group-hover:scale-105 transition-transform`}>
                      {icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-white">{label}</p>
                      <p className="text-xs text-muted-foreground truncate">{desc}</p>
                    </div>
                    <ArrowRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Staff ────────────────────────────────────────────────────────────────────
function StaffDashboard({ user }: { user: any }) {
  const crecheId = user.crecheId || 1;
  const queryClient = useQueryClient();
  const { data: tasks, isLoading } = useListTasks(crecheId, { status: "pending" as ListTasksStatus });
  const { data: pets } = useListPets(crecheId);

  useEffect(() => {
    const id = setInterval(() => queryClient.invalidateQueries(), 20_000);
    return () => clearInterval(id);
  }, [queryClient]);
  const petsArray = Array.isArray(pets) ? pets : (pets as any)?.items || [];
  const checkedIn = petsArray.filter((p: any) => p.isCheckedIn) || [];
  const checkedInIds = new Set(checkedIn.map((p: any) => p.id).filter((id: any): id is number => id != null));
  const activeTasks = (tasks || []).filter((t: any) => t.petId != null && checkedInIds.has(t.petId));
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-display font-bold text-white">{greeting}, {user.name.split(" ")[0]}!</h1>
          <p className="text-muted-foreground mt-1">{format(new Date(), "EEEE, d 'de' MMMM", { locale: ptBR })}</p>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex-shrink-0">
          <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-xs text-emerald-400 font-medium">{checkedIn.length} presente{checkedIn.length !== 1 ? "s" : ""}</span>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <Link href="/staff">
          <div className="glass-panel p-4 rounded-2xl hover:bg-white/10 transition-all cursor-pointer flex flex-col items-center gap-2 text-center">
            <div className="h-10 w-10 rounded-xl bg-amber-400/20 flex items-center justify-center">
              <CheckSquare className="h-5 w-5 text-amber-400" />
            </div>
            <p className="text-sm font-semibold text-white">Tarefas</p>
            {activeTasks.length > 0 && (
              <Badge variant="warning" className="text-xs">{activeTasks.length}</Badge>
            )}
          </div>
        </Link>
        <Link href="/walks">
          <div className="glass-panel p-4 rounded-2xl hover:bg-white/10 transition-all cursor-pointer flex flex-col items-center gap-2 text-center">
            <div className="h-10 w-10 rounded-xl bg-emerald-500/20 flex items-center justify-center">
              <Footprints className="h-5 w-5 text-emerald-400" />
            </div>
            <p className="text-sm font-semibold text-white">Passeios</p>
          </div>
        </Link>
        <Link href="/pets">
          <div className="glass-panel p-4 rounded-2xl hover:bg-white/10 transition-all cursor-pointer flex flex-col items-center gap-2 text-center">
            <div className="h-10 w-10 rounded-xl bg-primary/20 flex items-center justify-center">
              <Dog className="h-5 w-5 text-primary" />
            </div>
            <p className="text-sm font-semibold text-white">Pets</p>
          </div>
        </Link>
      </div>

      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-lg font-display font-semibold flex items-center gap-2">
              <Clock className="h-5 w-5 text-amber-400" /> Próximas Tarefas
            </h2>
            <Link href="/staff">
              <button className="text-xs text-primary hover:text-primary/80 transition-colors">Ver todas →</button>
            </Link>
          </div>
          {isLoading ? (
            <div className="text-center py-4 text-muted-foreground">Carregando...</div>
          ) : activeTasks.length ? (
            <div className="space-y-2.5">
              {activeTasks.slice(0, 6).map((task) => (
                <Link key={task.id} href="/staff">
                  <div className="flex items-center justify-between p-3.5 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 hover:border-primary/30 transition-all cursor-pointer group">
                    <div className="min-w-0">
                      <p className="font-medium text-white text-sm">{task.title}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {task.petName && <span className="text-primary mr-2">{task.petName}</span>}
                        {format(new Date(task.scheduledFor), "HH:mm")}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <Badge variant={task.priority === "high" ? "destructive" : "secondary"} className="text-xs">
                        {task.priority === "high" ? "Alta" : task.priority === "medium" ? "Média" : "Baixa"}
                      </Badge>
                      <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <EmptyState icon={CheckCircle2} title="Tudo em dia!" description="Sem tarefas pendentes." />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Tutor ────────────────────────────────────────────────────────────────────

type TutorTimelineEvent = {
  id: number;
  petId: number;
  petName: string;
  petPhotoUrl: string | null;
  authorName: string | null;
  type: string;
  content: string | null;
  mediaUrl: string | null;
  mediaType: string | null;
  createdAt: string;
  likeCount: number;
  isLikedByUser: boolean;
};

function useTutorTimeline(crecheId: number, tutorId: number) {
  return useQuery<TutorTimelineEvent[]>({
    queryKey: ["tutor-timeline", crecheId, tutorId],
    queryFn: async () => {
      const token = localStorage.getItem("auth_token");
      const r = await fetch(
        `/api/creches/${crecheId}/tutor-timeline?tutorId=${tutorId}&limit=50`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!r.ok) throw new Error("Erro ao carregar timeline");
      return r.json();
    },
    enabled: !!crecheId && !!tutorId,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

const eventConfig: Record<string, { icon: React.ReactNode; label: string; color: string }> = {
  check_in:   { icon: <LogIn className="h-3.5 w-3.5" />,         label: "Check-in",    color: "text-emerald-400 bg-emerald-500/15 border-emerald-500/25" },
  check_out:  { icon: <LogOut className="h-3.5 w-3.5" />,        label: "Check-out",   color: "text-amber-400 bg-amber-500/15 border-amber-500/25" },
  feeding:    { icon: <UtensilsCrossed className="h-3.5 w-3.5" />, label: "Alimentação", color: "text-orange-400 bg-orange-500/15 border-orange-500/25" },
  medication: { icon: <Pill className="h-3.5 w-3.5" />,          label: "Medicação",   color: "text-red-400 bg-red-500/15 border-red-500/25" },
  walk:       { icon: <Footprints className="h-3.5 w-3.5" />,    label: "Passeio",     color: "text-violet-400 bg-violet-500/15 border-violet-500/25" },
  play:       { icon: <Gamepad2 className="h-3.5 w-3.5" />,      label: "Brincadeira", color: "text-pink-400 bg-pink-500/15 border-pink-500/25" },
  photo:      { icon: <Camera className="h-3.5 w-3.5" />,        label: "Foto",        color: "text-sky-400 bg-sky-500/15 border-sky-500/25" },
  video:      { icon: <Video className="h-3.5 w-3.5" />,         label: "Vídeo",       color: "text-blue-400 bg-blue-500/15 border-blue-500/25" },
  note:       { icon: <FileText className="h-3.5 w-3.5" />,      label: "Anotação",    color: "text-slate-300 bg-slate-500/15 border-slate-500/25" },
  health:     { icon: <Heart className="h-3.5 w-3.5" />,         label: "Saúde",       color: "text-rose-400 bg-rose-500/15 border-rose-500/25" },
};

function TutorDashboard({ user }: { user: any }) {
  const crecheId = user.crecheId || 1;
  const queryClient = useQueryClient();
  const { data: pets } = useListPets(crecheId);
  const { data: timeline, isLoading: timelineLoading, refetch } = useTutorTimeline(crecheId, user.id);

  const myPets = Array.isArray(pets) ? pets : (pets as any)?.items || [];
  const checkedInPets = myPets.filter((p: any) => p.isCheckedIn);
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";
  const events = timeline || [];

  const handleLike = async (ev: TutorTimelineEvent) => {
    const token = localStorage.getItem("auth_token");
    await fetch(
      `/api/creches/${crecheId}/pets/${ev.petId}/timeline/${ev.id}/like`,
      { method: "POST", headers: { Authorization: `Bearer ${token}` } }
    );
    queryClient.invalidateQueries({ queryKey: ["tutor-timeline"] });
  };

  return (
    <div className="space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-2xl mx-auto">
      <NotificationPrompt />

      {/* ── Greeting ── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-display font-bold text-white">
            {greeting}, {user.name.split(" ")[0]}!
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {myPets.length > 0
              ? `${myPets.length} pet${myPets.length !== 1 ? "s" : ""} cadastrado${myPets.length !== 1 ? "s" : ""}`
              : "Acompanhe seus pets em tempo real."}
          </p>
        </div>
        {checkedInPets.length > 0 && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex-shrink-0">
            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-xs text-emerald-400 font-medium">
              {checkedInPets.length} na creche
            </span>
          </div>
        )}
      </div>

      {/* ── Quick actions ── */}
      <div className="grid grid-cols-3 gap-2">
        <Link href="/pets">
          <div className="glass-panel px-3 py-3 rounded-2xl hover:bg-white/10 transition-all cursor-pointer flex flex-col items-center gap-1.5 text-center">
            <div className="h-9 w-9 rounded-xl bg-primary/20 flex items-center justify-center">
              <Dog className="h-4 w-4 text-primary" />
            </div>
            <p className="text-xs font-semibold text-white">Meus Pets</p>
            <p className="text-[10px] text-muted-foreground leading-tight">
              {myPets.length} cadastrado{myPets.length !== 1 ? "s" : ""}
            </p>
          </div>
        </Link>
        <Link href="/bookings">
          <div className="glass-panel px-3 py-3 rounded-2xl hover:bg-white/10 transition-all cursor-pointer flex flex-col items-center gap-1.5 text-center">
            <div className="h-9 w-9 rounded-xl bg-blue-500/20 flex items-center justify-center">
              <Calendar className="h-4 w-4 text-blue-400" />
            </div>
            <p className="text-xs font-semibold text-white">Reservas</p>
          </div>
        </Link>
        <Link href="/chat">
          <div className="glass-panel px-3 py-3 rounded-2xl hover:bg-white/10 transition-all cursor-pointer flex flex-col items-center gap-1.5 text-center">
            <div className="h-9 w-9 rounded-xl bg-emerald-500/20 flex items-center justify-center">
              <MessageSquare className="h-4 w-4 text-emerald-400" />
            </div>
            <p className="text-xs font-semibold text-white">Mensagens</p>
          </div>
        </Link>
      </div>

      {/* ── Timeline ── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-display font-semibold text-white">
            Atividades dos seus pets
          </h2>
          <button
            onClick={() => refetch()}
            className="text-xs text-primary hover:text-primary/80 transition-colors flex items-center gap-1"
          >
            <RefreshCw className="h-3 w-3" />
            Atualizar
          </button>
        </div>

        {/* Loading skeleton */}
        {timelineLoading && (
          <div className="flex flex-col gap-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="glass-panel rounded-2xl p-4 flex gap-3 animate-pulse">
                <div className="h-8 w-8 rounded-full bg-white/10 flex-shrink-0" />
                <div className="flex-1 space-y-2 pt-1">
                  <div className="h-3 bg-white/10 rounded w-1/3" />
                  <div className="h-3 bg-white/10 rounded w-2/3" />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Empty state */}
        {!timelineLoading && events.length === 0 && (
          <EmptyState
            icon={Sparkles}
            title="Nenhuma atividade ainda"
            description="Quando a creche registrar algo sobre seus pets, aparecerá aqui."
            className="py-12"
          />
        )}

        {/* Events */}
        {!timelineLoading && events.length > 0 && (
          <div className="flex flex-col gap-3">
            {events.map((ev) => {
              const cfg = eventConfig[ev.type] ?? {
                icon: <Sparkles className="h-3.5 w-3.5" />,
                label: ev.type,
                color: "text-muted-foreground bg-white/5 border-white/10",
              };
              return (
                <div key={`${ev.id}-${ev.petId}`} className="glass-panel rounded-2xl overflow-hidden">
                  {/* Header */}
                  <div className="flex items-center gap-2.5 px-4 pt-4 pb-2">
                    {/* Pet avatar */}
                    <div className="h-9 w-9 rounded-full overflow-hidden bg-gradient-to-tr from-primary/40 to-accent/40 flex-shrink-0">
                      {ev.petPhotoUrl ? (
                        <img src={ev.petPhotoUrl} alt={ev.petName} className="h-full w-full object-cover" />
                      ) : (
                        <div className="h-full w-full flex items-center justify-center">
                          <Dog className="h-4 w-4 text-white/60" />
                        </div>
                      )}
                    </div>
                    {/* Name + badge + time */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-white leading-tight">{ev.petName}</p>
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-medium flex-shrink-0 ${cfg.color}`}>
                          {cfg.icon}
                          {cfg.label}
                        </span>
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {ev.authorName ? `${ev.authorName} · ` : ""}
                        {format(parseUTC(ev.createdAt), "dd/MM · HH:mm", { locale: ptBR })}
                      </p>
                    </div>
                  </div>

                  {/* Text content */}
                  {ev.content && (
                    <p className="text-sm text-white/80 px-4 pb-3 leading-relaxed">{ev.content}</p>
                  )}

                  {/* Media — full width, no side margins */}
                  {ev.mediaUrl && ev.mediaType === "photo" && (
                    <img
                      src={ev.mediaUrl}
                      alt="foto"
                      className="w-full object-cover max-h-80"
                    />
                  )}
                  {ev.mediaUrl && ev.mediaType === "video" && (
                    <video src={ev.mediaUrl} controls className="w-full max-h-64" />
                  )}

                  {/* Like */}
                  <div className="px-4 py-2.5">
                    <button
                      onClick={() => handleLike(ev)}
                      className={`flex items-center gap-1.5 text-xs transition-colors ${
                        ev.isLikedByUser
                          ? "text-rose-400"
                          : "text-muted-foreground hover:text-rose-400"
                      }`}
                    >
                      <Heart className={`h-3.5 w-3.5 ${ev.isLikedByUser ? "fill-rose-400" : ""}`} />
                      {ev.likeCount > 0 && <span>{ev.likeCount}</span>}
                      <span>{ev.isLikedByUser ? "Curtido" : "Curtir"}</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Master Admin ─────────────────────────────────────────────────────────────
function MasterAdminDashboard() {
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
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground mb-1">
            {format(new Date(), "EEEE, d 'de' MMMM 'de' yyyy", { locale: ptBR })}
          </p>
          <h1 className="text-2xl sm:text-3xl font-display font-bold text-white">{greeting}, Master!</h1>
          <p className="text-muted-foreground mt-1">Visão global de toda a rede ArkPet.</p>
        </div>
        <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-500/10 border border-emerald-500/20 self-start sm:self-auto">
          <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-sm text-emerald-400 font-medium">Rede Operacional</span>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
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
          iconColor={avgOccupancy > 80 ? "text-amber-400" : "text-emerald-400"}
          iconBg={avgOccupancy > 80 ? "bg-amber-400/20" : "bg-emerald-400/20"}
        />
        <Link href="/admin/users?role=tutor">
          <StatCard
            title="Usuários Totais"
            value={totalUsers.toString()}
            subValue={`${totalTutors} tutores · ${totalStaff} equipe`}
            icon={<Users className="h-5 w-5" />}
            iconColor="text-violet-400"
            iconBg="bg-violet-400/20"
            clickable
          />
        </Link>
        <StatCard
          title="Pets na Rede"
          value={totalOccupied.toString()}
          subValue={`cap. total: ${totalCapacity}`}
          icon={<Dog className="h-5 w-5" />}
          iconColor="text-blue-400"
          iconBg="bg-blue-400/20"
        />
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Creches list */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-display font-semibold text-white">Creches da Rede</h2>
            <Link href="/admin">
              <Button variant="outline" size="sm" className="gap-1.5">
                <Sparkles className="h-3.5 w-3.5" /> Painel Completo
              </Button>
            </Link>
          </div>
          <Card>
            <CardContent className="p-0">
              {isLoading ? (
                <div className="p-8 text-center text-muted-foreground">Carregando...</div>
              ) : sortedCreches.length ? (
                <div className="divide-y divide-white/5">
                  {sortedCreches.map((creche) => {
                    const occ = (creche as any).currentOccupancy ?? 0;
                    const cap = (creche as any).maxCapacity ?? 0;
                    const pct = cap > 0 ? Math.round((occ / cap) * 100) : 0;
                    const isActive = creche.status === "active";
                    const barColor = pct >= 90 ? "bg-red-500" : pct >= 70 ? "bg-amber-400" : "bg-emerald-400";
                    return (
                      <Link key={creche.id} href="/admin">
                        <div className="p-5 hover:bg-white/5 transition-colors cursor-pointer group">
                          <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-4">
                              <div className="h-11 w-11 rounded-xl bg-primary/20 flex items-center justify-center shrink-0 group-hover:bg-primary/30 transition-colors">
                                <Building2 className="h-5 w-5 text-primary" />
                              </div>
                              <div>
                                <p className="font-semibold text-white group-hover:text-primary transition-colors">{creche.name}</p>
                                <p className="text-sm text-muted-foreground line-clamp-1">
                                  {creche.address || "Endereço não informado"}
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <Badge variant={isActive ? "success" : "secondary"}>
                                {isActive ? "Ativa" : "Inativa"}
                              </Badge>
                              <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                            </div>
                          </div>
                          {cap > 0 ? (
                            <div className="pl-[60px]">
                              <div className="flex items-center justify-between text-xs text-muted-foreground mb-1.5">
                                <span>Ocupação atual</span>
                                <span className="font-medium">{occ}/{cap} pets · {pct}%</span>
                              </div>
                              <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                                <div className={`h-full rounded-full transition-all duration-700 ${barColor}`} style={{ width: `${pct}%` }} />
                              </div>
                            </div>
                          ) : (
                            <div className="pl-[60px]">
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
            <h2 className="text-lg font-display font-semibold text-white mb-3">Saúde do Sistema</h2>
            <Card>
              <CardContent className="p-5 space-y-4">
                {systemServices.map(({ label, icon, status }) => (
                  <div key={label} className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-muted-foreground">{icon}</span>
                      <span className="text-sm text-muted-foreground">{label}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`h-2 w-2 rounded-full ${status === "online" ? "bg-emerald-400 animate-pulse" : "bg-red-400"}`} />
                      <span className={`text-xs font-semibold ${status === "online" ? "text-emerald-400" : "text-red-400"}`}>
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
            <h2 className="text-lg font-display font-semibold text-white mb-3">Ações Rápidas</h2>
            <div className="space-y-2">
              {[
                { href: "/admin", icon: <Building2 className="h-4 w-4" />, bg: "bg-primary/20", color: "text-primary", label: "Gerenciar Creches", desc: "Editar, adicionar ou desativar" },
                { href: "/admin/users", icon: <Users className="h-4 w-4" />, bg: "bg-blue-500/20", color: "text-blue-400", label: "Todos os Usuários", desc: "Gerir contas e permissões" },
              ].map(({ href, icon, bg, color, label, desc }) => (
                <Link key={href} href={href}>
                  <div className="flex items-center gap-3 p-3.5 rounded-xl hover:bg-white/5 border border-transparent hover:border-white/10 transition-all cursor-pointer group">
                    <div className={`h-9 w-9 rounded-lg flex items-center justify-center flex-shrink-0 ${bg} ${color}`}>
                      {icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-white">{label}</p>
                      <p className="text-xs text-muted-foreground">{desc}</p>
                    </div>
                    <ArrowRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                </Link>
              ))}
            </div>
          </div>

          {/* Network summary */}
          <Card className="bg-gradient-to-br from-primary/10 to-violet-500/5 border-primary/20">
            <CardContent className="p-5">
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
                  <div key={label}>
                    <p className="text-xl font-display font-bold text-white">{value}</p>
                    <p className="text-xs text-muted-foreground">{label}</p>
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

// ─── Shared components ────────────────────────────────────────────────────────
function StatCard({
  title,
  value,
  subValue,
  trend,
  icon,
  iconColor = "text-primary",
  iconBg = "bg-primary/20",
  alert,
  clickable,
}: {
  title: string;
  value: string;
  subValue?: string;
  trend?: string;
  icon: React.ReactNode;
  iconColor?: string;
  iconBg?: string;
  alert?: boolean;
  clickable?: boolean;
}) {
  return (
    <Card className={`relative overflow-hidden transition-all duration-200 ${
      alert ? "border-amber-400/40 shadow-[0_0_20px_rgba(251,191,36,0.1)]" : ""
    } ${clickable ? "hover:-translate-y-0.5 hover:shadow-lg hover:border-primary/30 cursor-pointer" : ""}`}>
      <CardContent className="p-5">
        <div className="flex justify-between items-start gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-muted-foreground mb-1 truncate">{title}</p>
            <h3 className="text-2xl lg:text-3xl font-display font-bold text-white leading-none">{value}</h3>
            {trend && (
              <p className="text-xs text-emerald-400 mt-2 flex items-center gap-1">
                <TrendingUp className="h-3 w-3 shrink-0" /> {trend}
              </p>
            )}
            {subValue && !trend && (
              <p className="text-xs text-muted-foreground mt-2">{subValue}</p>
            )}
          </div>
          <div className={`h-11 w-11 rounded-xl flex items-center justify-center shrink-0 ${iconBg} ${iconColor}`}>
            {icon}
          </div>
        </div>
        {clickable && (
          <div className="mt-3 flex items-center gap-1 text-xs text-muted-foreground/60">
            <ArrowRight className="h-3 w-3" /> Ver detalhes
          </div>
        )}
      </CardContent>
    </Card>
  );
}
