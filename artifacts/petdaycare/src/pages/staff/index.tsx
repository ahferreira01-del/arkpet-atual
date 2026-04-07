import React, { useState, useRef, useCallback } from "react";
import { useListTasks, useCompleteTask, useListPets, useAddTimelineEvent } from "@workspace/api-client-react";
import { useAuth } from "@/hooks/use-auth";
import { useSearch } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import { EmptyState } from "@/components/ui/empty-state";
import { CheckSquare, CircleDashed, CheckCircle2, Users, Filter, Camera, ImageIcon, X, Sparkles } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { compressImage } from "@/lib/utils";

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

const taskTypeToEventType: Record<string, string> = {
  feeding: "feeding",
  medication: "medication",
  walk: "walk",
  grooming: "note",
  health_check: "health",
  other: "note",
};

const eventTypes = [
  { value: "photo",    emoji: "📸", label: "Foto" },
  { value: "note",     emoji: "📝", label: "Nota" },
  { value: "play",     emoji: "🎾", label: "Brincadeira" },
  { value: "walk",     emoji: "🦮", label: "Passeio" },
  { value: "feeding",  emoji: "🍽️", label: "Alimentação" },
  { value: "medication", emoji: "💊", label: "Medicação" },
  { value: "health",   emoji: "🏥", label: "Saúde" },
];

function TaskCompleteModal({
  task,
  crecheId,
  onClose,
}: {
  task: any;
  crecheId: number;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const completeTaskMutation = useCompleteTask();
  const addEventMutation = useAddTimelineEvent();

  const defaultType = taskTypeToEventType[task.type] || "note";
  const [selectedType, setSelectedType] = useState(defaultType);
  const [preview, setPreview] = useState<string | null>(null);
  const [compressing, setCompressing] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const mediaDataRef = useRef<string | null>(null);

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCompressing(true);
    try {
      const data = await compressImage(file);
      mediaDataRef.current = data;
      setPreview(data);
    } catch {
      mediaDataRef.current = null;
      setPreview(null);
    } finally {
      setCompressing(false);
    }
  }, []);

  const completeOnly = () => {
    completeTaskMutation.mutate(
      { crecheId, taskId: task.id, data: {} },
      {
        onSuccess: () => {
          queryClient.invalidateQueries();
          toast({ title: "Tarefa concluída!", description: task.title });
          onClose();
        },
        onError: () => {
          toast({ title: "Erro", description: "Não foi possível concluir a tarefa.", variant: "destructive" });
        },
      }
    );
  };

  const handlePublishAndComplete = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const content = (fd.get("content") as string) || null;

    completeTaskMutation.mutate(
      { crecheId, taskId: task.id, data: {} },
      {
        onSuccess: () => {
          addEventMutation.mutate(
            {
              crecheId,
              petId: task.petId,
              data: {
                type: selectedType as any,
                content: content || `${taskTypeLabel[task.type] || task.type} concluída.`,
                mediaUrl: mediaDataRef.current || null,
                mediaType: mediaDataRef.current ? "photo" : undefined,
              },
            },
            {
              onSuccess: () => {
                queryClient.invalidateQueries();
                toast({ title: "Publicado e concluído!", description: `Atualização enviada para o tutor de ${task.petName}.` });
                onClose();
              },
              onError: () => {
                queryClient.invalidateQueries();
                toast({ title: "Tarefa concluída", description: "Mas houve um erro ao publicar na linha do tempo.", variant: "destructive" });
                onClose();
              },
            }
          );
        },
        onError: () => {
          toast({ title: "Erro", description: "Não foi possível concluir a tarefa.", variant: "destructive" });
        },
      }
    );
  };

  const isPending = completeTaskMutation.isPending || addEventMutation.isPending;

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title={`Concluir: ${task.title}`}
      description={task.petName ? `Publicar atualização na linha do tempo de ${task.petName}` : ""}
    >
      <form onSubmit={handlePublishAndComplete} className="space-y-5 mt-4">
        {/* Task info banner */}
        <div className="flex items-center gap-3 p-3 rounded-xl bg-primary/10 border border-primary/20">
          <span className="text-2xl">{eventTypes.find(e => e.value === defaultType)?.emoji || "📋"}</span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-white truncate">{task.title}</p>
            <p className="text-xs text-muted-foreground">{taskTypeLabel[task.type]} · {task.petName}</p>
          </div>
        </div>

        {/* Event type selector */}
        <div className="space-y-2">
          <label className="text-xs font-medium text-white/60 uppercase tracking-wide">Tipo de Publicação</label>
          <div className="flex flex-wrap gap-2">
            {eventTypes.map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => setSelectedType(t.value)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                  selectedType === t.value
                    ? "bg-primary text-white border-primary shadow-[0_0_10px_rgba(139,92,246,0.4)]"
                    : "bg-white/5 text-white/60 border-white/10 hover:bg-white/10"
                }`}
              >
                {t.emoji} {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Photo upload */}
        <div className="space-y-2">
          <label className="text-xs font-medium text-white/60 uppercase tracking-wide">Foto (opcional)</label>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
          <input id="task-camera-input" type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFileChange} />

          {preview ? (
            <div className="relative rounded-xl overflow-hidden border border-white/10">
              <img src={preview} alt="Preview" className="w-full max-h-52 object-cover" />
              <button
                type="button"
                onClick={() => { setPreview(null); mediaDataRef.current = null; if (fileRef.current) fileRef.current.value = ""; }}
                className="absolute top-2 right-2 h-7 w-7 rounded-full bg-black/70 flex items-center justify-center hover:bg-black/90 transition-colors"
              >
                <X className="h-4 w-4 text-white" />
              </button>
            </div>
          ) : compressing ? (
            <div className="w-full h-24 rounded-xl border-2 border-dashed border-white/15 flex items-center justify-center">
              <div className="animate-spin h-5 w-5 rounded-full border-2 border-primary border-t-transparent" />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="h-20 rounded-xl border-2 border-dashed border-white/15 flex flex-col items-center justify-center gap-1.5 text-white/40 hover:border-primary/50 hover:text-primary/70 hover:bg-primary/5 transition-all"
              >
                <ImageIcon className="h-5 w-5" />
                <span className="text-xs">Galeria</span>
              </button>
              <button
                type="button"
                onClick={() => document.getElementById("task-camera-input")?.click()}
                className="h-20 rounded-xl border-2 border-dashed border-white/15 flex flex-col items-center justify-center gap-1.5 text-white/40 hover:border-primary/50 hover:text-primary/70 hover:bg-primary/5 transition-all"
              >
                <Camera className="h-5 w-5" />
                <span className="text-xs">Câmera</span>
              </button>
            </div>
          )}
        </div>

        {/* Caption */}
        <div className="space-y-2">
          <label className="text-xs font-medium text-white/60 uppercase tracking-wide">Mensagem para o tutor</label>
          <textarea
            name="content"
            placeholder={`Ex: ${task.petName} ${task.type === "feeding" ? "comeu tudo, tá ótimo!" : task.type === "walk" ? "adorou o passeio, muito animado!" : task.type === "medication" ? "tomou o medicamento sem problemas." : "ficou ótimo!"}`}
            rows={3}
            className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder:text-muted-foreground resize-none focus:outline-none focus:border-primary/50 transition-colors"
          />
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-2 pt-1">
          <Button type="submit" disabled={isPending} className="w-full gap-2">
            <Sparkles className="h-4 w-4" />
            {isPending ? "Publicando..." : "Publicar e Concluir"}
          </Button>
          <button
            type="button"
            onClick={completeOnly}
            disabled={isPending}
            className="w-full py-2 text-sm text-muted-foreground hover:text-white transition-colors"
          >
            Concluir sem publicar
          </button>
        </div>
      </form>
    </Modal>
  );
}

export default function StaffDashboard() {
  const { user } = useAuth();
  const crecheId = user?.crecheId || 1;
  const queryClient = useQueryClient();
  const search = useSearch();
  const params = new URLSearchParams(search);
  const [onlyPresent, setOnlyPresent] = useState(() => params.get("filter") === "present");
  const [taskToComplete, setTaskToComplete] = useState<any | null>(null);

  const { data: tasks, isLoading } = useListTasks(crecheId);
  const { data: pets } = useListPets(crecheId);
  const completeTaskMutation = useCompleteTask();
  const { toast } = useToast();

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

  const handleConcluir = (task: any) => {
    if (task.petId) {
      setTaskToComplete(task);
    } else {
      completeTaskMutation.mutate(
        { crecheId, taskId: task.id, data: {} },
        {
          onSuccess: () => {
            queryClient.invalidateQueries();
            toast({ title: "Tarefa concluída!", description: task.title });
          },
        }
      );
    }
  };

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
                      {format(new Date(task.scheduledFor), "HH:mm")} · {taskTypeLabel[task.type] || task.type}
                    </p>
                    {task.description && (
                      <p className="text-xs text-muted-foreground/70 mt-0.5 truncate max-w-xs">{task.description}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <Badge variant={task.priority === "high" ? "destructive" : "secondary"}>
                      {priorityLabel[task.priority] || task.priority}
                    </Badge>
                    <Button
                      onClick={() => handleConcluir(task)}
                      variant="glass"
                      size="sm"
                      isLoading={completeTaskMutation.isPending && !taskToComplete}
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
                    {task.petName && <span className="text-primary mr-1">{task.petName} ·</span>}
                    Concluída às {task.completedAt ? format(new Date(task.completedAt), "HH:mm") : "horário desconhecido"}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Task Complete + Timeline Modal */}
      {taskToComplete && (
        <TaskCompleteModal
          task={taskToComplete}
          crecheId={crecheId}
          onClose={() => setTaskToComplete(null)}
        />
      )}
    </div>
  );
}
