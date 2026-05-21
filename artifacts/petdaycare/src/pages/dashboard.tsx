import React, { useEffect } from "react";
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
} from "lucide-react";
import { Link, useLocation } from "wouter";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

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
  const { data: tasks, isLoading: tasksLoading } = useListTasks(crecheId, { status: "pending" as ListTasksStatus });
  const { data: walks } = (useListWalks as any)(crecheId);
  const { data: staff } = useListCrecheStaff(crecheId);

  const updateBookingMutation = useUpdateBooking();
  const completeTaskMutation = useCompleteTask();

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";
  const firstName = user?.name?.split(" ")[0] || "Admin";

  const checkedIn = pets?.filter((p) => p.isCheckedIn) || [];
  const checkedInIds = new Set(checkedIn.map((p) => p.id).filter((id): id is number => id != null));
  const pendingBookings = bookings?.filter((b) => b.status === "pending") || [];
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
          <h1 className="text-3xl font-display font-bold text-white">{greeting}, {firstName}!</h1>
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
                                {bookingTypeLabel[b.type] || b.type} · {format(new Date(b.startDate), "dd/MM", { locale: ptBR })}
                                {b.endDate && ` → ${format(new Date(b.endDate), "dd/MM", { locale: ptBR })}`}
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
                        <div className="flex items-center justify-between p-4 hover:bg-white/5 transition-colors cursor-pointer group">
                          <div className="flex items-center gap-4">
                            <div className="h-12 w-12 rounded-full overflow-hidden bg-gradient-to-tr from-primary/40 to-accent/40 flex-shrink-0">
                              {pet.photoUrl ? (
                                <img src={pet.photoUrl} alt={pet.name} className="h-full w-full object-cover" />
                              ) : (
                                <div className="h-full w-full flex items-center justify-center">
                                  <Dog className="h-5 w-5 text-white/60" />
                                </div>
                              )}
                            </div>
                            <div>
                              <p className="font-medium text-white group-hover:text-primary transition-colors">{pet.name}</p>
                              <p className="text-sm text-muted-foreground capitalize">{pet.breed || pet.species}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
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
  const checkedIn = pets?.filter((p) => p.isCheckedIn) || [];
  const checkedInIds = new Set(checkedIn.map((p) => p.id).filter((id): id is number => id != null));
  const activeTasks = (tasks || []).filter((t) => t.petId != null && checkedInIds.has(t.petId));
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold text-white">{greeting}, {user.name.split(" ")[0]}!</h1>
          <p className="text-muted-foreground mt-1">{format(new Date(), "EEEE, d 'de' MMMM", { locale: ptBR })}</p>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex-shrink-0">
          <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-xs text-emerald-400 font-medium">{checkedIn.length} presente{checkedIn.length !== 1 ? "s" : ""}</span>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
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
function TutorDashboard({ user }: { user: any }) {
  const crecheId = user.crecheId || 1;
  const { data: pets, isLoading: petsLoading } = useListPets(crecheId);
  const { data: bookings, isLoading: bookingsLoading } = useListBookings(crecheId);

  const myPets = pets || [];
  const checkedInPets = myPets.filter((p) => p.isCheckedIn);
  const myBookings = (bookings || []).slice(0, 4);
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";

  const bookingStatusLabel: Record<string, string> = {
    active: "Ativo", pending: "Pendente", confirmed: "Confirmado",
    cancelled: "Cancelado", completed: "Concluído",
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold text-white">{greeting}, {user.name.split(" ")[0]}!</h1>
          <p className="text-muted-foreground mt-1">Acompanhe seus pets em tempo real.</p>
        </div>
        {checkedInPets.length > 0 && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex-shrink-0">
            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-xs text-emerald-400 font-medium">
              {checkedInPets.length} pet{checkedInPets.length !== 1 ? "s" : ""} na creche
            </span>
          </div>
        )}
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Link href="/pets">
          <div className="glass-panel p-4 rounded-2xl hover:bg-white/10 transition-all cursor-pointer flex flex-col items-center gap-2 text-center">
            <div className="h-10 w-10 rounded-xl bg-primary/20 flex items-center justify-center">
              <Dog className="h-5 w-5 text-primary" />
            </div>
            <p className="text-sm font-semibold text-white">Meus Pets</p>
            <p className="text-xs text-muted-foreground">{myPets.length} cadastrado{myPets.length !== 1 ? "s" : ""}</p>
          </div>
        </Link>
        <Link href="/bookings">
          <div className="glass-panel p-4 rounded-2xl hover:bg-white/10 transition-all cursor-pointer flex flex-col items-center gap-2 text-center">
            <div className="h-10 w-10 rounded-xl bg-blue-500/20 flex items-center justify-center">
              <Calendar className="h-5 w-5 text-blue-400" />
            </div>
            <p className="text-sm font-semibold text-white">Reservas</p>
          </div>
        </Link>
        <Link href="/chat">
          <div className="glass-panel p-4 rounded-2xl hover:bg-white/10 transition-all cursor-pointer flex flex-col items-center gap-2 text-center">
            <div className="h-10 w-10 rounded-xl bg-emerald-500/20 flex items-center justify-center">
              <MessageSquare className="h-5 w-5 text-emerald-400" />
            </div>
            <p className="text-sm font-semibold text-white">Mensagens</p>
          </div>
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* My Pets */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-display font-semibold text-white">Meus Pets</h2>
            <Link href="/pets"><button className="text-xs text-primary hover:text-primary/80 transition-colors">Ver todos →</button></Link>
          </div>
          <Card>
            <CardContent className="p-0">
              {petsLoading ? (
                <div className="p-8 text-center text-muted-foreground">Carregando...</div>
              ) : myPets.length ? (
                <div className="divide-y divide-white/5">
                  {myPets.map((pet) => (
                    <Link key={pet.id} href={`/pets/${pet.id}`}>
                      <div className="flex items-center justify-between p-4 hover:bg-white/5 transition-colors cursor-pointer group">
                        <div className="flex items-center gap-3">
                          <div className="h-12 w-12 rounded-full overflow-hidden bg-gradient-to-tr from-primary/40 to-accent/40 flex-shrink-0">
                            {pet.photoUrl ? (
                              <img src={pet.photoUrl} alt={pet.name} className="h-full w-full object-cover" />
                            ) : (
                              <div className="h-full w-full flex items-center justify-center">
                                <Dog className="h-5 w-5 text-white/60" />
                              </div>
                            )}
                          </div>
                          <div>
                            <p className="font-medium text-white group-hover:text-primary transition-colors">{pet.name}</p>
                            <p className="text-sm text-muted-foreground capitalize">{pet.breed || pet.species}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {pet.isCheckedIn ? (
                            <Badge variant="success">Na creche</Badge>
                          ) : (
                            <Badge variant="secondary">Em casa</Badge>
                          )}
                          <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              ) : (
                <EmptyState icon={Dog} title="Nenhum pet" description="Seus pets aparecerão aqui." className="py-10" />
              )}
            </CardContent>
          </Card>
        </div>

        {/* My Bookings */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-display font-semibold text-white">Reservas</h2>
            <Link href="/bookings"><button className="text-xs text-primary hover:text-primary/80 transition-colors">Ver todas →</button></Link>
          </div>
          <Card>
            <CardContent className="p-0">
              {bookingsLoading ? (
                <div className="p-8 text-center text-muted-foreground">Carregando...</div>
              ) : myBookings.length ? (
                <div className="divide-y divide-white/5">
                  {myBookings.map((b) => (
                    <Link key={b.id} href="/bookings">
                      <div className="flex items-center justify-between p-4 hover:bg-white/5 transition-colors cursor-pointer">
                        <div className="flex items-center gap-3">
                          <div className="h-10 w-10 rounded-full bg-blue-500/20 flex items-center justify-center flex-shrink-0">
                            <Calendar className="h-4 w-4 text-blue-400" />
                          </div>
                          <div>
                            <p className="font-medium text-white text-sm">{b.petName}</p>
                            <p className="text-xs text-muted-foreground capitalize">
                              {b.type.replace("_", " ")} · {format(new Date(b.startDate), "dd/MM/yyyy")}
                            </p>
                          </div>
                        </div>
                        <Badge variant={b.status === "active" || b.status === "confirmed" ? "success" : b.status === "pending" ? "warning" : "secondary"}>
                          {bookingStatusLabel[b.status] || b.status}
                        </Badge>
                      </div>
                    </Link>
                  ))}
                </div>
              ) : (
                <EmptyState icon={Calendar} title="Nenhuma reserva" description="Faça sua primeira reserva." className="py-10" />
              )}
            </CardContent>
          </Card>
        </div>
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
          <h1 className="text-3xl font-display font-bold text-white">{greeting}, Master!</h1>
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
