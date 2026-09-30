import React, { useState, useRef, useCallback, useEffect } from "react";
import {
  useListTasks,
  useCompleteTask,
  useListPets,
  useAddFeedPost,
  getListTasksQueryKey,
  getListFeedQueryKey,
} from "@workspace/api-client-react";
import { useAuth } from "@/hooks/use-auth";
import { useSearch } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import { EmptyState } from "@/components/ui/empty-state";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import { CheckSquare, CheckSquare as ClipboardList, CircleDashed, CheckCircle2, Users, Filter, Camera, ImageIcon, X, Sparkles, Video } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { compressImage, uploadFileDirect } from "@/lib/utils";
import { todayBrazil } from "@/lib/date-utils";

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
  const addEventMutation = useAddFeedPost();

  const defaultType = taskTypeToEventType[task.type] || "note";
  const [selectedType, setSelectedType] = useState(defaultType);
  const [preview, setPreview] = useState<string | null>(null);
  const [compressing, setCompressing] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const mediaDataRef = useRef<string | null>(null);
  const mediaTypeRef = useRef<"photo" | "video" | null>(null);

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCompressing(true);
    const token = localStorage.getItem("auth_token") ?? "";
    try {
      if (file.type.startsWith("video/")) {
        try {
          mediaDataRef.current = await uploadFileDirect(file, token);
        } catch {
          toast({
            title: "Upload de vídeo indisponível",
            description: "Não foi possível enviar o vídeo. Tente publicar uma foto.",
            variant: "destructive",
          });
          mediaDataRef.current = null;
          mediaTypeRef.current = null;
          setPreview(null);
          return;
        }
        mediaTypeRef.current = "video";
        setPreview(URL.createObjectURL(file));
      } else {
        // Show local preview immediately while uploading
        const localPreview = await compressImage(file);
        setPreview(localPreview);
        try {
          // Upload to storage — returns an objectPath suitable for the DB/feed
          mediaDataRef.current = await uploadFileDirect(file, token);
        } catch {
          toast({
            title: "Erro no upload da foto",
            description: "Não foi possível enviar a imagem. Verifique sua conexão e tente novamente.",
            variant: "destructive",
          });
          mediaDataRef.current = null;
          mediaTypeRef.current = null;
          setPreview(null);
          return;
        }
        mediaTypeRef.current = "photo";
      }
    } catch {
      mediaDataRef.current = null;
      mediaTypeRef.current = null;
      setPreview(null);
    } finally {
      setCompressing(false);
    }
  }, [toast]);

  const completeOnly = () => {
    completeTaskMutation.mutate(
      { crecheId, taskId: task.id, data: {} },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListTasksQueryKey(crecheId) });
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
              data: {
                petIds: [task.petId],
                type: selectedType as any,
                content: content || `${taskTypeLabel[task.type] || task.type} concluída.`,
                mediaUrl: mediaDataRef.current || null,
                mediaType: mediaDataRef.current ? (mediaTypeRef.current || "photo") : undefined,
              } as any,
            },
            {
              onSuccess: () => {
                queryClient.invalidateQueries({ queryKey: getListTasksQueryKey(crecheId) });
                queryClient.invalidateQueries({ queryKey: getListFeedQueryKey(crecheId) });
                queryClient.invalidateQueries({ queryKey: ["tutor-timeline", crecheId] });
                toast({ title: "Publicado e concluído!", description: `Atualização enviada para o tutor de ${task.petName}.` });
                onClose();
              },
              onError: () => {
                queryClient.invalidateQueries({ queryKey: getListTasksQueryKey(crecheId) });
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
      <form onSubmit={handlePublishAndComplete} className="space-y-4 mt-4">
        {/* Task info banner */}
        <div className="flex items-center gap-3 p-3 rounded-xl bg-primary/10 border border-primary/20">
          <span className="text-2xl">{eventTypes.find(e => e.value === defaultType)?.emoji || "📋"}</span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground truncate">{task.title}</p>
            <p className="text-xs text-muted-foreground">{taskTypeLabel[task.type]} · {task.petName}</p>
          </div>
        </div>

        {/* Event type selector */}
        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Tipo de Publicação</label>
          <div className="flex flex-wrap gap-2">
            {eventTypes.map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => setSelectedType(t.value)}
                className={`px-4 py-2 min-h-[44px] rounded-full text-sm font-medium border transition-all ${
                  selectedType === t.value
                    ? "bg-primary/10 text-primary border-primary ring-2 ring-primary/20"
                    : "bg-secondary text-muted-foreground border-border hover:bg-secondary/80"
                }`}
              >
                {t.emoji} {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Photo / Video upload */}
        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Foto / Vídeo (opcional)</label>
          <input ref={fileRef} type="file" accept="image/*,video/*" className="hidden" onChange={handleFileChange} />
          <input id="task-camera-input" type="file" accept="image/*,video/*" capture="environment" className="hidden" onChange={handleFileChange} />

          {preview ? (
            <div className="relative rounded-xl overflow-hidden border border-border">
              {mediaTypeRef.current === "video" ? (
                <video src={preview} className="w-full max-h-52 bg-muted" muted playsInline preload="metadata" />
              ) : (
                <img src={preview} alt="Preview" className="w-full max-h-40 sm:max-h-52 object-cover" />
              )}
              <button
                type="button"
                onClick={() => { setPreview(null); mediaDataRef.current = null; mediaTypeRef.current = null; if (fileRef.current) fileRef.current.value = ""; }}
                className="absolute top-2 right-2 h-11 w-11 rounded-full bg-background/80 border border-border flex items-center justify-center hover:bg-background transition-colors"
              >
                <X className="h-5 w-5 text-foreground" />
              </button>
            </div>
          ) : compressing ? (
            <div className="w-full h-24 min-h-[44px] rounded-xl border-2 border-dashed border-border flex items-center justify-center gap-2">
              <div className="animate-spin h-5 w-5 rounded-full border-2 border-primary border-t-transparent" />
              <span className="text-xs text-muted-foreground">Enviando...</span>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="h-20 min-h-[44px] rounded-xl border-2 border-dashed border-border flex flex-col items-center justify-center gap-1.5 text-muted-foreground hover:border-primary/50 hover:text-primary transition-all"
              >
                <ImageIcon className="h-5 w-5" />
                <span className="text-xs">Galeria</span>
              </button>
              <button
                type="button"
                onClick={() => document.getElementById("task-camera-input")?.click()}
                className="h-20 min-h-[44px] rounded-xl border-2 border-dashed border-border flex flex-col items-center justify-center gap-1.5 text-muted-foreground hover:border-primary/50 hover:text-primary transition-all"
              >
                <Camera className="h-5 w-5" />
                <span className="text-xs">Câmera</span>
              </button>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="h-20 min-h-[44px] rounded-xl border-2 border-dashed border-border flex flex-col items-center justify-center gap-1.5 text-muted-foreground hover:border-primary/50 hover:text-primary transition-all"
              >
                <Video className="h-5 w-5" />
                <span className="text-xs">Vídeo</span>
              </button>
            </div>
          )}
        </div>

        {/* Caption */}
        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Mensagem para o tutor</label>
          <textarea
            name="content"
            placeholder={`Ex: ${task.petName} ${task.type === "feeding" ? "comeu tudo, tá ótimo!" : task.type === "walk" ? "adorou o passeio, muito animado!" : task.type === "medication" ? "tomou o medicamento sem problemas." : "ficou ótimo!"}`}
            rows={3}
            className="w-full bg-background border border-border rounded-xl px-3 py-3 text-base text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:border-primary/50 transition-colors"
          />
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-2 pt-2">
          <Button type="submit" disabled={isPending} className="w-full min-h-[44px] gap-2">
            <Sparkles className="h-4 w-4" />
            {isPending ? "Publicando..." : "Publicar e Concluir"}
          </Button>
          <button
            type="button"
            onClick={completeOnly}
            disabled={isPending}
            className="w-full min-h-[44px] py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Concluir sem publicar
          </button>
        </div>
      </form>
    </Modal>
  );
}

function StandalonePublishModal({
  crecheId,
  pets,
  onClose,
}: {
  crecheId: number;
  pets: any[];
  onClose: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const addEventMutation = useAddFeedPost();
  const [selectedPetId, setSelectedPetId] = useState<number | null>(null);
  const [selectedType, setSelectedType] = useState("note");
  const [preview, setPreview] = useState<string | null>(null);
  const [compressing, setCompressing] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const mediaDataRef = useRef<string | null>(null);
  const mediaTypeRef = useRef<"photo" | "video" | null>(null);

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCompressing(true);
    const token = localStorage.getItem("auth_token") ?? "";
    try {
      if (file.type.startsWith("video/")) {
        mediaDataRef.current = await uploadFileDirect(file, token);
        mediaTypeRef.current = "video";
        setPreview(URL.createObjectURL(file));
      } else {
        // Mostra preview local imediatamente, depois faz upload para object storage
        const localPreview = await compressImage(file);
        setPreview(localPreview);
        try {
          mediaDataRef.current = await uploadFileDirect(file, token);
        } catch {
          toast({
            title: "Erro no upload da foto",
            description: "Não foi possível enviar a imagem. Verifique sua conexão e tente novamente.",
            variant: "destructive",
          });
          mediaDataRef.current = null;
          mediaTypeRef.current = null;
          setPreview(null);
          return;
        }
        mediaTypeRef.current = "photo";
      }
    } catch {
      mediaDataRef.current = null;
      mediaTypeRef.current = null;
      setPreview(null);
    } finally {
      setCompressing(false);
    }
  }, [toast]);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!selectedPetId) {
      toast({ title: "Atenção", description: "Selecione um pet.", variant: "destructive" });
      return;
    }
    const fd = new FormData(e.currentTarget);
    const content = (fd.get("content") as string) || null;

    addEventMutation.mutate(
      {
        crecheId,
        data: {
          petIds: [selectedPetId],
          type: selectedType as any,
          content: content || `${eventTypes.find(t => t.value === selectedType)?.label || "Atualização"}.`,
          mediaUrl: mediaDataRef.current || null,
          mediaType: mediaDataRef.current ? (mediaTypeRef.current || "photo") : undefined,
        } as any,
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListFeedQueryKey(crecheId) });
          queryClient.invalidateQueries({ queryKey: ["tutor-timeline", crecheId] });
          toast({ title: "Publicado!", description: "Atualização enviada para o tutor." });
          onClose();
        },
        onError: () => {
          toast({ title: "Erro", description: "Não foi possível publicar na linha do tempo.", variant: "destructive" });
        },
      }
    );
  };

  const checkedInPets = pets.filter((p: any) => p.isCheckedIn);
  const allPetsToShow = checkedInPets.length > 0 ? checkedInPets : pets;

  return (
    <Modal isOpen={true} onClose={onClose} title="Publicar na Timeline" description="Envie uma atualização direto para o tutor">
      <form onSubmit={handleSubmit} className="space-y-4 mt-4">
        {/* Pet selector */}
        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Pet</label>
          <div className="grid grid-cols-2 gap-2 max-h-40 overflow-y-auto pr-1">
            {allPetsToShow.map((pet: any) => (
              <button
                key={pet.id}
                type="button"
                onClick={() => setSelectedPetId(pet.id)}
                className={`px-3 py-2 min-h-[44px] rounded-xl text-sm font-medium border transition-all text-left flex items-center justify-between ${
                  selectedPetId === pet.id
                    ? "bg-primary/10 text-primary border-primary ring-1 ring-primary/30"
                    : "bg-secondary text-muted-foreground border-border hover:bg-secondary/80"
                }`}
              >
                <span className="truncate">{pet.name}</span>
                {pet.isCheckedIn && <span className="text-success text-xs flex-shrink-0 ml-1">✓</span>}
              </button>
            ))}
          </div>
        </div>

        {/* Event type */}
        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Tipo</label>
          <div className="flex flex-wrap gap-2">
            {eventTypes.map((t) => (
              <button key={t.value} type="button" onClick={() => setSelectedType(t.value)}
                className={`px-4 py-2 min-h-[44px] rounded-full text-sm font-medium border transition-all ${
                  selectedType === t.value
                    ? "bg-primary/10 text-primary border-primary ring-2 ring-primary/20"
                    : "bg-secondary text-muted-foreground border-border hover:bg-secondary/80"
                }`}>
                {t.emoji} {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Photo / Video */}
        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Foto / Vídeo (opcional)</label>
          <input ref={fileRef} type="file" accept="image/*,video/*" className="hidden" onChange={handleFileChange} />
          <input id="standalone-camera" type="file" accept="image/*,video/*" capture="environment" className="hidden" onChange={handleFileChange} />
          {preview ? (
            <div className="relative rounded-xl overflow-hidden border border-border">
              {mediaTypeRef.current === "video" ? (
                <video src={preview} className="w-full max-h-36 bg-muted" muted playsInline preload="metadata" />
              ) : (
                <img src={preview} alt="Preview" className="w-full max-h-36 object-cover" />
              )}
              <button type="button" onClick={() => { setPreview(null); mediaDataRef.current = null; mediaTypeRef.current = null; if (fileRef.current) fileRef.current.value = ""; }}
                className="absolute top-2 right-2 h-11 w-11 rounded-full bg-background/80 border border-border flex items-center justify-center hover:bg-background transition-colors">
                <X className="h-5 w-5 text-foreground" />
              </button>
            </div>
          ) : compressing ? (
            <div className="w-full h-20 min-h-[44px] rounded-xl border-2 border-dashed border-border flex items-center justify-center gap-2">
              <div className="animate-spin h-5 w-5 rounded-full border-2 border-primary border-t-transparent" />
              <span className="text-xs text-muted-foreground">Enviando...</span>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              <button type="button" onClick={() => fileRef.current?.click()}
                className="h-20 min-h-[44px] rounded-xl border-2 border-dashed border-border flex flex-col items-center justify-center gap-1 text-muted-foreground hover:border-primary/50 hover:text-primary transition-all">
                <ImageIcon className="h-5 w-5" /><span className="text-xs">Galeria</span>
              </button>
              <button type="button" onClick={() => document.getElementById("standalone-camera")?.click()}
                className="h-20 min-h-[44px] rounded-xl border-2 border-dashed border-border flex flex-col items-center justify-center gap-1 text-muted-foreground hover:border-primary/50 hover:text-primary transition-all">
                <Camera className="h-5 w-5" /><span className="text-xs">Câmera</span>
              </button>
              <button type="button" onClick={() => fileRef.current?.click()}
                className="h-20 min-h-[44px] rounded-xl border-2 border-dashed border-border flex flex-col items-center justify-center gap-1 text-muted-foreground hover:border-primary/50 hover:text-primary transition-all">
                <Video className="h-5 w-5" /><span className="text-xs">Vídeo</span>
              </button>
            </div>
          )}
        </div>

        {/* Caption */}
        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Mensagem</label>
          <textarea name="content" placeholder="Ex: Está adorando o dia aqui!" rows={3}
            className="w-full bg-background border border-border rounded-xl px-3 py-3 text-base text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:border-primary/50 transition-colors" />
        </div>

        <div className="pt-2">
          <Button type="submit" disabled={addEventMutation.isPending || !selectedPetId} className="w-full min-h-[44px] gap-2">
            <Sparkles className="h-4 w-4" />
            {addEventMutation.isPending ? "Publicando..." : "Publicar na Timeline"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export default function Staff({ hideHeader }: { hideHeader?: boolean }) {
  const { user } = useAuth();
  const crecheId = user?.crecheId as number;
  const queryClient = useQueryClient();
  const search = useSearch();
  const params = new URLSearchParams(search);
  const highlightTaskId = params.get("t") ? parseInt(params.get("t")!) : null;
  // When navigating from a notification with a specific task, show all tasks so it's visible
  const [onlyPresent, setOnlyPresent] = useState(() => {
    if (highlightTaskId) return false;
    return params.get("filter") !== "all";
  });
  const [taskToComplete, setTaskToComplete] = useState<any | null>(null);
  const [showPublishModal, setShowPublishModal] = useState(false);

  useEffect(() => {
    if (!highlightTaskId) return;
    const timer = setTimeout(() => {
      document.getElementById(`task-${highlightTaskId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 400);
    return () => clearTimeout(timer);
  }, [highlightTaskId]);

  const { data: tasks, isLoading } = useListTasks(crecheId, { date: todayBrazil() });
  const { data: petsResponse } = useListPets(crecheId);
  const pets = (petsResponse as any)?.items;
  const completeTaskMutation = useCompleteTask();
  const { toast } = useToast();

  const checkedInPetIds = new Set(
    (pets || []).filter((p: any) => p.isCheckedIn).map((p: any) => p.id)
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

  const groupedPendingTasks = React.useMemo(() => {
    const groups: Record<string, { tutorName: string, tutorId: number, tasks: any[] }> = {};
    pendingTasks.forEach(task => {
      let tutorId = 0;
      let tutorName = "Tarefas Gerais / Sem Pet";
      
      if (task.petId && pets) {
        const pet = pets.find((p: any) => p.id === task.petId);
        if (pet) {
          tutorId = pet.tutorId;
          tutorName = pet.tutorName || "Tutor Desconhecido";
        }
      }
      
      const key = `${tutorId}-${tutorName}`;
      if (!groups[key]) {
        groups[key] = { tutorName, tutorId, tasks: [] };
      }
      groups[key].tasks.push(task);
    });
    return Object.values(groups).sort((a, b) => {
      if (a.tutorId === 0) return 1;
      if (b.tutorId === 0) return -1;
      return a.tutorName.localeCompare(b.tutorName);
    });
  }, [pendingTasks, pets]);

  const handleConcluir = (task: any) => {
    if (task.petId) {
      setTaskToComplete(task);
    } else {
      completeTaskMutation.mutate(
        { crecheId, taskId: task.id, data: {} },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getListTasksQueryKey(crecheId) });
            toast({ title: "Tarefa concluída!", description: task.title });
          },
        }
      );
    }
  };

  return (
    <div className={hideHeader ? "space-y-6" : "space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-4xl mx-auto"}>
      {!hideHeader && (
        <PageHeader
          title="Tarefas do Dia"
          description={format(new Date(), "EEEE, d 'de' MMMM 'de' yyyy", { locale: ptBR })}
          icon={ClipboardList}
          action={
            <div className="flex items-center gap-2 text-sm text-muted-foreground px-3 py-1.5 rounded-full bg-secondary border border-border">
              <Users className="h-4 w-4" />
              {presentCount} pet{presentCount !== 1 ? "s" : ""} presente{presentCount !== 1 ? "s" : ""}
            </div>
          }
        />
      )}

      {/* Filter toggle + publish button */}
      <div className="flex flex-wrap gap-2">
        <Button
          onClick={() => setShowPublishModal(true)}
          variant="outline"
          className="min-h-[44px] flex items-center gap-1.5 rounded-xl border-primary/30 text-primary hover:bg-primary/10"
        >
          <Sparkles className="h-4 w-4" />
          Publicar
        </Button>
        <button
          onClick={() => setOnlyPresent(true)}
          className={`flex items-center gap-1.5 px-4 py-2 min-h-[44px] rounded-xl text-sm font-medium transition-all ${
            onlyPresent
              ? "bg-primary/10 text-primary border border-primary/30 ring-1 ring-primary/20"
              : "text-muted-foreground bg-secondary/50 hover:bg-secondary border border-transparent"
          }`}
        >
          <span className="h-2 w-2 rounded-full bg-success animate-pulse" />
          Pets Presentes
        </button>
        <button
          onClick={() => setOnlyPresent(false)}
          className={`flex items-center gap-1.5 px-4 py-2 min-h-[44px] rounded-xl text-sm font-medium transition-all ${
            !onlyPresent
              ? "bg-primary/10 text-primary border border-primary/30 ring-1 ring-primary/20"
              : "text-muted-foreground bg-secondary/50 hover:bg-secondary border border-transparent"
          }`}
        >
          <Filter className="h-4 w-4" />
          Todas as Tarefas
        </button>
      </div>

      <Card>
        <CardContent className="p-4 sm:p-6">
          <h2 className="text-xl font-display font-semibold mb-6 flex items-center gap-2">
            <CircleDashed className="text-warning" /> Pendentes ({pendingTasks.length})
          </h2>

          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">Carregando tarefas...</div>
          ) : pendingTasks.length ? (
            <Accordion type="multiple" defaultValue={groupedPendingTasks.map(g => `tutor-${g.tutorId}`)} className="w-full space-y-4">
              {groupedPendingTasks.map(group => (
                <AccordionItem key={`tutor-${group.tutorId}`} value={`tutor-${group.tutorId}`} className="border-border bg-card rounded-2xl px-2 sm:px-4 data-[state=open]:bg-card transition-colors">
                  <AccordionTrigger className="hover:no-underline py-4">
                    <div className="flex items-center gap-3 text-left">
                      <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                        <Users className="h-6 w-6 text-primary" />
                      </div>
                      <div>
                        <p className="font-semibold text-foreground text-base">{group.tutorName}</p>
                        <p className="text-sm text-muted-foreground">{group.tasks.length} tarefa{group.tasks.length !== 1 && 's'} pendente{group.tasks.length !== 1 && 's'}</p>
                      </div>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="pt-2 pb-4 space-y-3">
                    {group.tasks.map(task => {
                      const petsList = Array.isArray(pets) ? pets : (pets as any)?.items || [];
                      const taskPet = petsList.find((p: any) => p.id === task.petId);
                      const hasAllergy = Boolean(taskPet?.allergies && taskPet.allergies.trim().length > 0);
                      const hasSpecialNeeds = Boolean(taskPet?.specialNeeds && taskPet.specialNeeds.trim().length > 0);
                      return (
                      <div
                        key={task.id}
                        id={`task-${task.id}`}
                        className={`p-4 rounded-xl bg-card border flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-all group ${
                          task.petId && checkedInPetIds.has(task.petId)
                            ? "border-primary/40 shadow-sm"
                            : "border-border shadow-sm hover:border-primary/30"
                        } ${highlightTaskId === task.id ? "ring-2 ring-primary/50 bg-primary/5" : ""}`}
                      >
                        <div className="flex flex-col min-w-0 w-full">
                          <div className="flex flex-wrap items-center gap-2 mb-2">
                            <span className="text-sm font-medium text-muted-foreground">
                              {format(new Date(task.scheduledFor), "HH:mm")}
                            </span>
                            <Badge variant="outline" className="text-xs bg-secondary/30">
                              {taskTypeLabel[task.type] || task.type}
                            </Badge>
                            {task.priority && (
                              <Badge variant={task.priority === "high" ? "destructive" : "secondary"} className="text-xs">
                                {priorityLabel[task.priority] || task.priority}
                              </Badge>
                            )}
                            {hasAllergy && (
                              <Badge variant="destructive" className="text-xs">
                                Alergia
                              </Badge>
                            )}
                            {hasSpecialNeeds && (
                              <Badge variant="warning" className="text-xs">
                                Cuidados especiais
                              </Badge>
                            )}
                          </div>
                          
                          <p className="font-semibold text-foreground text-base break-words">
                            {task.petName && (
                              <span className={`font-medium mr-2 ${
                                task.petId && checkedInPetIds.has(task.petId)
                                  ? "text-success"
                                  : "text-primary"
                              }`}>
                                {task.petName}
                                {task.petId && checkedInPetIds.has(task.petId) && " ✓"}
                              </span>
                            )}
                            {task.title}
                          </p>
                          
                          {task.description && (
                            <p className="text-sm text-muted-foreground mt-1.5 break-words">
                              {task.description}
                            </p>
                          )}
                        </div>
                        <div className="flex-shrink-0 w-full sm:w-auto mt-2 sm:mt-0">
                          <Button
                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleConcluir(task); }}
                            size="default"
                            isLoading={completeTaskMutation.isPending && !taskToComplete}
                            className="min-h-[44px] w-full sm:w-auto text-base sm:text-sm shadow-sm"
                          >
                            Concluir
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
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
        <div className="mt-8 transition-opacity">
          <h2 className="text-xl font-display font-semibold mb-4 flex items-center gap-2 px-2 text-muted-foreground/80">
            <CheckCircle2 className="text-success opacity-80" /> Concluídas ({completedTasks.length})
          </h2>
          <div className="space-y-3">
            {completedTasks.map(task => (
              <div key={task.id} id={`task-${task.id}`} className="p-4 rounded-xl bg-muted/20 border border-transparent flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium text-muted-foreground line-through break-words">
                    {task.petName && <span className="mr-1">{task.petName} ·</span>}
                    {task.title}
                  </p>
                  <p className="text-xs text-muted-foreground/70 mt-1">
                    Concluída às {task.completedAt ? format(new Date(task.completedAt), "HH:mm") : "horário desconhecido"} · {taskTypeLabel[task.type] || task.type}
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

      {/* Standalone Publish Modal */}
      {showPublishModal && (
        <StandalonePublishModal
          crecheId={crecheId}
          pets={pets || []}
          onClose={() => setShowPublishModal(false)}
        />
      )}
    </div>
  );
}
