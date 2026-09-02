import React, { useEffect } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { FeedPage } from "@/features/feed/components/FeedPage";
import { Tabs } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import {
  CheckSquare,
  Footprints,
  Dog,
  Clock,
  ChevronRight,
  CheckCircle2,
} from "lucide-react";
import {
  useListTasks,
  useListPets,
  getListTasksQueryKey,
  getListPetsQueryKey,
  ListTasksStatus,
} from "@workspace/api-client-react";

export function StaffDashboard({ user }: { user: any }) {
  const crecheId = user?.crecheId ?? null;
  const queryClient = useQueryClient();
  const { data: tasks, isLoading } = useListTasks(crecheId ?? 0, { status: "pending" as ListTasksStatus });
  const { data: pets } = useListPets(crecheId ?? 0);

  useEffect(() => {
    const id = setInterval(() => {
      if (crecheId) {
        queryClient.invalidateQueries({ queryKey: getListTasksQueryKey(crecheId) });
        queryClient.invalidateQueries({ queryKey: getListPetsQueryKey(crecheId) });
      }
    }, 20_000);
    return () => clearInterval(id);
  }, [queryClient, crecheId]);
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
          <h1 className="text-2xl sm:text-3xl font-display font-bold text-foreground">{greeting}, {user.name.split(" ")[0]}!</h1>
          <p className="text-muted-foreground mt-1">{format(new Date(), "EEEE, d 'de' MMMM", { locale: ptBR })}</p>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex-shrink-0">
          <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">{checkedIn.length} presente{checkedIn.length !== 1 ? "s" : ""}</span>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <Link href="/staff">
          <div className="bg-card border border-border p-3 sm:p-4 rounded-2xl sm:rounded-3xl hover:bg-secondary transition-all cursor-pointer flex flex-col items-center gap-2 text-center min-h-[44px] shadow-sm">
            <div className="h-10 w-10 rounded-2xl bg-amber-400/20 flex items-center justify-center shrink-0">
              <CheckSquare className="h-5 w-5 text-amber-500 dark:text-amber-400" />
            </div>
            <p className="text-xs sm:text-sm font-semibold text-foreground">Tarefas</p>
            {activeTasks.length > 0 && (
              <Badge variant="warning" className="text-[10px] sm:text-xs px-1.5 py-0">{activeTasks.length}</Badge>
            )}
          </div>
        </Link>
        <Link href="/walks">
          <div className="bg-card border border-border p-3 sm:p-4 rounded-2xl sm:rounded-3xl hover:bg-secondary transition-all cursor-pointer flex flex-col items-center gap-2 text-center min-h-[44px] shadow-sm">
            <div className="h-10 w-10 rounded-2xl bg-emerald-500/20 flex items-center justify-center shrink-0">
              <Footprints className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
            </div>
            <p className="text-xs sm:text-sm font-semibold text-foreground">Passeios</p>
          </div>
        </Link>
        <Link href="/pets">
          <div className="bg-card border border-border p-3 sm:p-4 rounded-2xl sm:rounded-3xl hover:bg-secondary transition-all cursor-pointer flex flex-col items-center gap-2 text-center min-h-[44px] shadow-sm">
            <div className="h-10 w-10 rounded-2xl bg-primary/20 flex items-center justify-center shrink-0">
              <Dog className="h-5 w-5 text-primary" />
            </div>
            <p className="text-xs sm:text-sm font-semibold text-foreground">Pets</p>
          </div>
        </Link>
      </div>

      <Tabs
        defaultTab="timeline"
        tabs={[
          {
            id: "timeline",
            label: "Timeline",
            content: <FeedPage crecheId={crecheId} userRole={user?.role ?? ""} userId={user?.id ?? 0} />,
          },
          {
            id: "tasks",
            label: "Tarefas",
            content: (
              <Card className="border-border bg-card shadow-sm">
                <CardContent className="p-4 sm:p-6">
                  <div className="flex items-center justify-between mb-5">
                    <h2 className="text-base sm:text-lg font-display font-semibold flex items-center gap-2 text-foreground">
                      <Clock className="h-5 w-5 text-amber-500 dark:text-amber-400" /> Próximas Tarefas
                    </h2>
                    <Link href="/staff">
                      <button className="text-sm font-medium text-primary hover:text-primary/80 transition-colors min-h-[44px] px-2 -mr-2">Ver todas →</button>
                    </Link>
                  </div>
                  {isLoading ? (
                    <div className="text-center py-4 text-muted-foreground">Carregando...</div>
                  ) : activeTasks.length ? (
                    <div className="space-y-2.5">
                      {activeTasks.slice(0, 6).map((task) => (
                        <Link key={task.id} href="/staff">
                          <div className="flex items-center justify-between p-3.5 rounded-xl bg-secondary/30 border border-border hover:bg-secondary hover:border-border transition-all cursor-pointer group min-h-[44px]">
                            <div className="min-w-0 pr-3">
                              <p className="font-medium text-foreground text-sm min-w-0 break-words">{task.title}</p>
                              <p className="text-xs text-muted-foreground mt-0.5 min-w-0 break-words">
                                {task.petName && <span className="text-primary mr-2 font-medium">{task.petName}</span>}
                                {format(new Date(task.scheduledFor), "HH:mm")}
                              </p>
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              <Badge variant={task.priority === "high" ? "destructive" : "secondary"} className="text-xs">
                                {task.priority === "high" ? "Alta" : task.priority === "medium" ? "Média" : "Baixa"}
                              </Badge>
                              <ChevronRight className="h-4 w-4 text-muted-foreground opacity-50 group-hover:opacity-100 transition-opacity" />
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
            ),
          },
        ]}
      />
    </div>
  );
}
