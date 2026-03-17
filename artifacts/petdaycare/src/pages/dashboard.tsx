import React from "react";
import { useAuth } from "@/hooks/use-auth";
import {
  useListTasks,
  useListPets,
  useGetCrecheStats,
  useListBookings,
  useListCreches,
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
} from "lucide-react";
import { Link } from "wouter";
import { format } from "date-fns";

export default function Dashboard() {
  const { user } = useAuth();
  if (user?.role === "staff") return <StaffDashboard user={user} />;
  if (user?.role === "master_admin") return <MasterAdminDashboard />;
  if (user?.role === "tutor") return <TutorDashboard user={user} />;
  return <CrecheDashboard crecheId={user?.crecheId || 1} />;
}

// ─── Creche Admin ─────────────────────────────────────────────────────────────
function CrecheDashboard({ crecheId }: { crecheId: number }) {
  const { data: stats } = useGetCrecheStats(crecheId);
  const { data: pets, isLoading: petsLoading } = useListPets(crecheId);
  const checkedIn = pets?.filter((p) => p.isCheckedIn) || [];

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-5">
        <StatCard
          title="Ocupação Atual"
          value={stats ? `${stats.currentOccupancy}/${stats.maxCapacity}` : "—"}
          icon={<Dog />}
          trend={`+${stats?.todayCheckIns || 0} hoje`}
        />
        <StatCard title="Check-ins Hoje" value={stats?.todayCheckIns?.toString() || "—"} icon={<Calendar />} />
        <StatCard
          title="Reservas Pendentes"
          value={stats?.pendingBookings?.toString() || "—"}
          icon={<AlertCircle />}
          alert={!!stats?.pendingBookings}
        />
        <StatCard title="Tarefas Pendentes" value={stats?.pendingTasks?.toString() || "—"} icon={<CheckSquare />} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-display font-semibold text-white">Pets Presentes</h2>
            <Link href="/pets">
              <Button variant="outline" size="sm">Ver Todos</Button>
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
                      <div className="flex items-center justify-between p-4 hover:bg-white/5 transition-colors cursor-pointer">
                        <div className="flex items-center gap-4">
                          <div className="h-12 w-12 rounded-full bg-gradient-to-tr from-primary/40 to-accent/40 flex items-center justify-center">
                            <Dog className="h-5 w-5 text-white" />
                          </div>
                          <div>
                            <p className="font-medium text-white">{pet.name}</p>
                            <p className="text-sm text-muted-foreground capitalize">{pet.breed || pet.species}</p>
                          </div>
                        </div>
                        <Badge variant="success">Presente</Badge>
                      </div>
                    </Link>
                  ))}
                </div>
              ) : (
                <EmptyState icon={Dog} title="Nenhum pet presente" description="Não há pets com check-in agora." className="py-12" />
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <h2 className="text-xl font-display font-semibold text-white">Ações Rápidas</h2>
          <Link href="/bookings">
            <Button variant="glass" className="w-full justify-start h-14 text-base">
              <Calendar className="mr-3 h-5 w-5" /> Nova Reserva
            </Button>
          </Link>
          <Link href="/pets">
            <Button variant="glass" className="w-full justify-start h-14 text-base">
              <Dog className="mr-3 h-5 w-5" /> Cadastrar Pet
            </Button>
          </Link>
          <Link href="/staff">
            <Button variant="glass" className="w-full justify-start h-14 text-base">
              <CheckSquare className="mr-3 h-5 w-5" /> Ver Tarefas
            </Button>
          </Link>
          <Link href="/staff/manage">
            <Button variant="glass" className="w-full justify-start h-14 text-base">
              <Users className="mr-3 h-5 w-5" /> Gerenciar Equipe
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}

// ─── Staff ────────────────────────────────────────────────────────────────────
function StaffDashboard({ user }: { user: any }) {
  const crecheId = user.crecheId || 1;
  const { data: tasks, isLoading } = useListTasks(crecheId, { status: "pending" as ListTasksStatus });

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h1 className="text-3xl font-display font-bold text-white">Olá, {user.name.split(" ")[0]}!</h1>
        <p className="text-muted-foreground mt-1">{format(new Date(), "EEEE, d 'de' MMMM")}</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Link href="/staff">
          <Button variant="glass" className="w-full justify-start h-16 text-base">
            <CheckSquare className="mr-3 h-5 w-5 text-amber-400" /> Minhas Tarefas
          </Button>
        </Link>
        <Link href="/walks">
          <Button variant="glass" className="w-full justify-start h-16 text-base">
            <Footprints className="mr-3 h-5 w-5 text-emerald-400" /> Passeios
          </Button>
        </Link>
        <Link href="/pets">
          <Button variant="glass" className="w-full justify-start h-16 text-base">
            <Dog className="mr-3 h-5 w-5 text-primary" /> Diretório de Pets
          </Button>
        </Link>
      </div>
      <Card>
        <CardContent className="p-6">
          <h2 className="text-lg font-display font-semibold mb-4 flex items-center gap-2">
            <Clock className="h-5 w-5 text-amber-400" /> Próximas Tarefas Pendentes
          </h2>
          {isLoading ? (
            <div className="text-center py-4 text-muted-foreground">Carregando...</div>
          ) : tasks?.length ? (
            <div className="space-y-3">
              {tasks.slice(0, 5).map((task) => (
                <div key={task.id} className="flex items-center justify-between p-3 rounded-xl bg-white/5 border border-white/10">
                  <div>
                    <p className="font-medium text-white">{task.title}</p>
                    <p className="text-sm text-muted-foreground mt-0.5">
                      {task.petName && <span className="text-primary mr-2">{task.petName}</span>}
                      {format(new Date(task.scheduledFor), "HH:mm")} • <span className="capitalize">{task.type}</span>
                    </p>
                  </div>
                  <Badge variant={task.priority === "high" ? "destructive" : "secondary"}>{task.priority}</Badge>
                </div>
              ))}
              {tasks.length > 5 && (
                <Link href="/staff">
                  <p className="text-sm text-primary text-center pt-2 hover:underline cursor-pointer">Ver todas as {tasks.length} tarefas →</p>
                </Link>
              )}
            </div>
          ) : (
            <EmptyState icon={CheckSquare} title="Tudo em dia!" description="Não há tarefas pendentes." />
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
  const myBookings = (bookings || []).slice(0, 3);

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h1 className="text-3xl font-display font-bold text-white">Olá, {user.name.split(" ")[0]}!</h1>
        <p className="text-muted-foreground mt-1">Acompanhe seus pets em tempo real.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Link href="/pets">
          <Button variant="glass" className="w-full justify-start h-16 text-base">
            <Dog className="mr-3 h-5 w-5 text-primary" /> Meus Pets
          </Button>
        </Link>
        <Link href="/bookings">
          <Button variant="glass" className="w-full justify-start h-16 text-base">
            <Calendar className="mr-3 h-5 w-5 text-blue-400" /> Reservas
          </Button>
        </Link>
        <Link href="/chat">
          <Button variant="glass" className="w-full justify-start h-16 text-base">
            <MessageSquare className="mr-3 h-5 w-5 text-emerald-400" /> Mensagens
          </Button>
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* My Pets */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-display font-semibold text-white">Meus Pets</h2>
            <Link href="/pets"><Button variant="outline" size="sm">Ver Todos</Button></Link>
          </div>
          <Card>
            <CardContent className="p-0">
              {petsLoading ? (
                <div className="p-8 text-center text-muted-foreground">Carregando...</div>
              ) : myPets.length ? (
                <div className="divide-y divide-white/5">
                  {myPets.map((pet) => (
                    <Link key={pet.id} href={`/pets/${pet.id}`}>
                      <div className="flex items-center justify-between p-4 hover:bg-white/5 transition-colors cursor-pointer">
                        <div className="flex items-center gap-3">
                          <div className="h-11 w-11 rounded-full bg-gradient-to-tr from-primary/40 to-accent/40 flex items-center justify-center">
                            <Dog className="h-5 w-5 text-white" />
                          </div>
                          <div>
                            <p className="font-medium text-white">{pet.name}</p>
                            <p className="text-sm text-muted-foreground capitalize">{pet.breed || pet.species}</p>
                          </div>
                        </div>
                        {pet.isCheckedIn ? (
                          <Badge variant="success">Presente</Badge>
                        ) : (
                          <Badge variant="secondary">Em casa</Badge>
                        )}
                      </div>
                    </Link>
                  ))}
                </div>
              ) : (
                <EmptyState icon={Dog} title="Nenhum pet" description="Você ainda não tem pets cadastrados." className="py-10" />
              )}
            </CardContent>
          </Card>
        </div>

        {/* My Bookings */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-display font-semibold text-white">Reservas Recentes</h2>
            <Link href="/bookings"><Button variant="outline" size="sm">Ver Todas</Button></Link>
          </div>
          <Card>
            <CardContent className="p-0">
              {bookingsLoading ? (
                <div className="p-8 text-center text-muted-foreground">Carregando...</div>
              ) : myBookings.length ? (
                <div className="divide-y divide-white/5">
                  {myBookings.map((b) => (
                    <div key={b.id} className="flex items-center justify-between p-4">
                      <div>
                        <p className="font-medium text-white">{b.petName}</p>
                        <p className="text-sm text-muted-foreground capitalize">
                          {b.type.replace("_", " ")} • {format(new Date(b.startDate), "dd/MM/yyyy")}
                        </p>
                      </div>
                      <Badge variant={b.status === "active" ? "success" : b.status === "pending" ? "warning" : "secondary"}>
                        {b.status}
                      </Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState icon={Calendar} title="Nenhuma reserva" description="Você não tem reservas ainda." className="py-10" />
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

  const totalPets = 0;

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h1 className="text-3xl font-display font-bold text-white">Painel Master</h1>
        <p className="text-muted-foreground mt-1">Visão global de toda a rede LuxePets.</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-5">
        <StatCard title="Creches Ativas" value={creches?.filter((c) => c.status === "active").length.toString() || "0"} icon={<Building2 />} />
        <StatCard title="Total de Creches" value={creches?.length.toString() || "0"} icon={<Building2 />} />
        <StatCard title="MRR" value="R$ 42.500" icon={<TrendingUp />} trend="+12% este mês" />
        <StatCard title="Usuários Totais" value="1.204" icon={<Users />} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-display font-semibold text-white">Creches Cadastradas</h2>
            <Link href="/admin">
              <Button variant="outline" size="sm">Painel Completo</Button>
            </Link>
          </div>
          <Card>
            <CardContent className="p-0">
              {isLoading ? (
                <div className="p-8 text-center text-muted-foreground">Carregando...</div>
              ) : creches?.length ? (
                <div className="divide-y divide-white/5">
                  {creches.map((creche) => (
                    <div key={creche.id} className="flex items-center justify-between p-5 hover:bg-white/5 transition-colors">
                      <div className="flex items-center gap-4">
                        <div className="h-11 w-11 rounded-xl bg-primary/20 flex items-center justify-center">
                          <Building2 className="h-5 w-5 text-primary" />
                        </div>
                        <div>
                          <p className="font-semibold text-white">{creche.name}</p>
                          <p className="text-sm text-muted-foreground">{creche.address || "Endereço não informado"}</p>
                        </div>
                      </div>
                      <Badge variant={creche.status === "active" ? "success" : "secondary"}>{creche.status}</Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState icon={Building2} title="Nenhuma creche" description="Nenhuma creche cadastrada." className="py-12" />
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <h2 className="text-xl font-display font-semibold text-white">Navegação Rápida</h2>
          <Link href="/admin">
            <Button variant="glass" className="w-full justify-start h-14 text-base">
              <Building2 className="mr-3 h-5 w-5 text-primary" /> Painel de Creches
            </Button>
          </Link>
          <Link href="/admin/users">
            <Button variant="glass" className="w-full justify-start h-14 text-base">
              <Users className="mr-3 h-5 w-5 text-blue-400" /> Todos os Usuários
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}

// ─── Shared ───────────────────────────────────────────────────────────────────
function StatCard({ title, value, icon, trend, alert }: any) {
  return (
    <Card className={`relative overflow-hidden ${alert ? "border-destructive/50 shadow-[0_0_20px_rgba(220,38,38,0.15)]" : ""}`}>
      <CardContent className="p-6">
        <div className="flex justify-between items-start">
          <div>
            <p className="text-sm font-medium text-muted-foreground mb-1">{title}</p>
            <h3 className="text-3xl font-display font-bold text-white">{value}</h3>
            {trend && (
              <p className="text-sm text-emerald-400 mt-2 flex items-center gap-1">
                <TrendingUp className="h-3 w-3" /> {trend}
              </p>
            )}
          </div>
          <div className="h-12 w-12 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-primary">
            {icon}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
