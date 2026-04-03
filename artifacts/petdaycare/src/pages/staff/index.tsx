import React, { useState } from "react";
import { useListTasks, useCompleteTask, useListPets } from "@workspace/api-client-react";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { CheckSquare, CircleDashed, CheckCircle2, Users, Filter } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useQueryClient } from "@tanstack/react-query";

const priorityLabel: Record<string, string> = {
  high: "Alta",
  medium: "Média",
  low: "Baixa",
};

const taskTypeLabel: Record<string, string> = {
  feeding: "Alimentação",
  medication: "Medicação",
  walk: "Passeio",
  grooming: "Banho/Tosa",
  health_check: "Verificação de Saúde",
  other: "Outro",
};

export default function StaffDashboard() {
  const { user } = useAuth();
  const crecheId = user?.crecheId || 1;
  const queryClient = useQueryClient();
  const [onlyPresent, setOnlyPresent] = useState(true);

  const { data: tasks, isLoading } = useListTasks(crecheId);
  const { data: pets } = useListPets(crecheId);
  const completeTaskMutation = useCompleteTask();

  const handleComplete = (taskId: number) => {
    completeTaskMutation.mutate({ crecheId, taskId, data: {} }, {
      onSuccess: () => queryClient.invalidateQueries(),
    });
  };

  const checkedInPetIds = new Set(
    (pets || []).filter((p) => p.isCheckedIn).map((p) => p.id)
  );
  const presentCount = checkedInPetIds.size;

  const allPending = tasks?.filter((t) => t.status === "pending") || [];
  const allCompleted = tasks?.filter((t) => t.status === "completed") || [];

  const pendingTasks = onlyPresent
    ? allPending.filter((t) => !t.petId || checkedInPetIds.has(t.petId) || (t as any).petIsCheckedIn)
    : allPending;

  const completedTasks = onlyPresent
    ? allCompleted.filter((t) => !t.petId || checkedInPetIds.has(t.petId) || (t as any).petIsCheckedIn)
    : allCompleted;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-4xl mx-auto">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold text-white">Tarefas do Dia</h1>
          <p className="text-muted-foreground mt-1">
            {format(new Date(), "EEEE, d 'de' MMMM 'de' yyyy", { locale: ptBR })}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Users className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">{presentCount} pet{presentCount !== 1 ? "s" : ""} presente{presentCount !== 1 ? "s" : ""}</span>
        </div>
      </div>

      {/* Filter toggle */}
      <div className="flex gap-2">
        <button
          onClick={() => setOnlyPresent(true)}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
            onlyPresent
              ? "bg-primary/20 text-primary border border-primary/30"
              : "text-muted-foreground hover:bg-white/5 hover:text-white border border-transparent"
          }`}
        >
          <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
          Pets Presentes
        </button>
        <button
          onClick={() => setOnlyPresent(false)}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
            !onlyPresent
              ? "bg-primary/20 text-primary border border-primary/30"
              : "text-muted-foreground hover:bg-white/5 hover:text-white border border-transparent"
          }`}
        >
          <Filter className="h-3.5 w-3.5" />
          Todas as Tarefas
        </button>
      </div>

      <Card>
        <CardContent className="p-6">
          <h2 className="text-xl font-display font-semibold mb-6 flex items-center gap-2">
            <CircleDashed className="text-amber-400" /> Pendentes ({pendingTasks.length})
          </h2>

          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">Carregando tarefas...</div>
          ) : pendingTasks.length ? (
            <div className="space-y-3">
              {pendingTasks.map(task => (
                <div
                  key={task.id}
                  className={`p-4 rounded-xl bg-white/5 border flex items-center justify-between hover:bg-white/10 transition-all group ${
                    task.petId && checkedInPetIds.has(task.petId)
                      ? "border-emerald-500/20"
                      : "border-white/10"
                  }`}
                >
                  <div className="flex flex-col min-w-0">
                    <p className="font-semibold text-white text-base">{task.title}</p>
                    <p className="text-sm text-muted-foreground mt-0.5">
                      {task.petName && (
                        <span className={`font-medium mr-2 ${
                          task.petId && checkedInPetIds.has(task.petId)
                            ? "text-emerald-400"
                            : "text-primary"
                        }`}>
                          {task.petName}
                          {task.petId && checkedInPetIds.has(task.petId) && " ✓"}
                        </span>
                      )}
                      {format(new Date(task.scheduledFor), "HH:mm")} • {taskTypeLabel[task.type] || task.type}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <Badge variant={task.priority === "high" ? "destructive" : "secondary"}>
                      {priorityLabel[task.priority] || task.priority}
                    </Badge>
                    <Button
                      onClick={() => handleComplete(task.id)}
                      variant="glass"
                      size="sm"
                      isLoading={completeTaskMutation.isPending}
                      className="group-hover:bg-primary group-hover:text-white group-hover:border-primary border-white/20 transition-all"
                    >
                      Concluir
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={CheckSquare}
              title={onlyPresent ? "Nenhuma tarefa para pets presentes" : "Tudo em dia!"}
              description={onlyPresent ? "Ative 'Todas as Tarefas' para ver tarefas de outros pets." : "Você completou todas as tarefas."}
            />
          )}
        </CardContent>
      </Card>

      {completedTasks.length > 0 && (
        <div className="opacity-60 hover:opacity-100 transition-opacity">
          <h2 className="text-xl font-display font-semibold mb-4 flex items-center gap-2 px-2">
            <CheckCircle2 className="text-emerald-400" /> Concluídas ({completedTasks.length})
          </h2>
          <div className="space-y-2.5">
            {completedTasks.map(task => (
              <div key={task.id} className="p-4 rounded-xl bg-transparent border border-white/5 flex items-center justify-between">
                <div>
                  <p className="font-medium text-white line-through">{task.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {task.petName && <span className="text-primary mr-1">{task.petName} •</span>}
                    Concluída às {task.completedAt ? format(new Date(task.completedAt), "HH:mm") : "horário desconhecido"}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
