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
    <div className="space-y-6 sm:space-y-8 animate-in fade-in duration-300">
      {/* ── Operational Execution Header ── */}
      <div className="flex items-start justify-between gap-4 pb-1 border-b border-border/40">
        <div>
          <h1 className="text-2xl sm:text-3xl font-display font-bold tracking-tight text-foreground">
            {greeting}, {user.name.split(" ")[0]}!
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {format(new Date(), "EEEE, d 'de' MMMM", { locale: ptBR })}
          </p>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-success/15 border border-success/30 flex-shrink-0 select-none">
          <span className="h-2 w-2 rounded-full bg-success animate-pulse" />
          <span className="text-xs text-success font-semibold tracking-tight">
            {checkedIn.length} presente{checkedIn.length !== 1 ? "s" : ""}
          </span>
        </div>
      </div>

      {/* ── Quick Action Cards (Tarefas, Passeios, Pets) ── */}
      <div className="grid grid-cols-3 gap-2.5 sm:gap-4">
        <Link href="/staff">
          <div className="bg-card border border-border p-3.5 sm:p-5 rounded-2xl hover:bg-secondary/60 transition-all cursor-pointer flex flex-col items-center gap-2 text-center min-h-[44px] shadow-xs group">
            <div className="h-10 w-10 sm:h-12 sm:w-12 rounded-xl bg-warning/15 border border-warning/30 flex items-center justify-center shrink-0 group-hover:bg-warning/25 transition-colors">
              <CheckSquare className="h-5 w-5 text-warning" />
            </div>
            <p className="text-xs sm:text-sm font-semibold text-foreground group-hover:text-primary transition-colors">
              Tarefas
            </p>
            {activeTasks.length > 0 && (
              <Badge variant="warning" className="text-[10px] sm:text-xs px-1.5 py-0">
                {activeTasks.length}
              </Badge>
            )}
          </div>
        </Link>
        <Link href="/walks">
          <div className="bg-card border border-border p-3.5 sm:p-5 rounded-2xl hover:bg-secondary/60 transition-all cursor-pointer flex flex-col items-center gap-2 text-center min-h-[44px] shadow-xs group">
            <div className="h-10 w-10 sm:h-12 sm:w-12 rounded-xl bg-success/15 border border-success/30 flex items-center justify-center shrink-0 group-hover:bg-success/25 transition-colors">
              <Footprints className="h-5 w-5 text-success" />
            </div>
            <p className="text-xs sm:text-sm font-semibold text-foreground group-hover:text-primary transition-colors">
              Passeios
            </p>
          </div>
        </Link>
        <Link href="/pets">
          <div className="bg-card border border-border p-3.5 sm:p-5 rounded-2xl hover:bg-secondary/60 transition-all cursor-pointer flex flex-col items-center gap-2 text-center min-h-[44px] shadow-xs group">
            <div className="h-10 w-10 sm:h-12 sm:w-12 rounded-xl bg-primary/15 border border-primary/30 flex items-center justify-center shrink-0 group-hover:bg-primary/25 transition-colors">
              <Dog className="h-5 w-5 text-primary" />
            </div>
            <p className="text-xs sm:text-sm font-semibold text-foreground group-hover:text-primary transition-colors">
              Pets
            </p>
          </div>
        </Link>
      </div>

      {/* ── Tabs (Timeline / Tarefas) ── */}
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
              <Card className="border-border bg-card shadow-xs">
                <CardContent className="p-4 sm:p-6">
                  <div className="flex items-center justify-between mb-5">
                    <h2 className="text-base sm:text-lg font-display font-semibold flex items-center gap-2 text-foreground tracking-tight">
                      <Clock className="h-5 w-5 text-warning" /> Próximas Tarefas
                    </h2>
                    <Link href="/staff">
                      <button className="text-sm font-medium text-primary hover:text-primary/80 transition-colors min-h-[44px] px-2 -mr-2 cursor-pointer">
                        Ver todas →
                      </button>
                    </Link>
                  </div>

                  {isLoading ? (
                    <div className="text-center py-6 text-sm text-muted-foreground">Carregando...</div>
                  ) : activeTasks.length ? (
                    <div className="space-y-2.5">
                      {activeTasks.slice(0, 6).map((task) => (
                        <Link key={task.id} href="/staff">
                          <div className="flex items-center justify-between p-3.5 rounded-xl bg-secondary/40 border border-border/80 hover:bg-secondary hover:border-border transition-all cursor-pointer group min-h-[44px]">
                            <div className="min-w-0 pr-3">
                              <p className="font-semibold text-foreground text-sm group-hover:text-primary transition-colors truncate">
                                {task.title}
                              </p>
                              <p className="text-xs text-muted-foreground mt-0.5 truncate">
                                {task.petName && (
                                  <span className="text-primary mr-2 font-medium">{task.petName}</span>
                                )}
                                {format(new Date(task.scheduledFor), "HH:mm")}
                              </p>
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              <Badge
                                variant={task.priority === "high" ? "destructive" : "secondary"}
                                className="text-xs"
                              >
                                {task.priority === "high" ? "Alta" : task.priority === "medium" ? "Média" : "Baixa"}
                              </Badge>
                              <ChevronRight className="h-4 w-4 text-muted-foreground opacity-50 group-hover:opacity-100 transition-opacity" />
                            </div>
                          </div>
                        </Link>
                      ))}
                    </div>
                  ) : (
                    <EmptyState
                      icon={CheckCircle2}
                      title="Tudo em dia!"
                      description="Sem tarefas pendentes."
                      className="py-10"
                    />
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
