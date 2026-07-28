import React, { useState, useRef, useCallback, useEffect } from "react";
import { useListTasks, useCompleteTask, useListPets, useAddFeedPost } from "@workspace/api-client-react";
import { useAuth } from "@/hooks/use-auth";
import { useSearch } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import { EmptyState } from "@/components/ui/empty-state";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import { CheckSquare, CheckSquare as ClipboardList, CircleDashed, CheckCircle2, Users, Filter, Camera, ImageIcon, X, Sparkles } from "lucide-react";
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
    try {
      if (file.type.startsWith("video/")) {
        const token = localStorage.getItem("auth_token") ?? "";
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
        const data = await compressImage(file);
        mediaDataRef.current = data;
        mediaTypeRef.current = "photo";
        setPreview(data);
      }
    } catch {
      mediaDataRef.current = null;
      mediaTypeRef.current = null;
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
      <form onSubmit={handlePublishAndComplete} className="space-y-4 mt-4">
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

        {/* Photo / Video upload */}
        <div className="space-y-2">
          <label className="text-xs font-medium text-white/60 uppercase tracking-wide">Foto / Vídeo (opcional)</label>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
          <input id="task-camera-input" type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFileChange} />

          {preview ? (
            <div className="relative rounded-xl overflow-hidden border border-white/10">
              <img src={preview} alt="Preview" className="w-full max-h-40 sm:max-h-52 object-cover" />
              <button
                type="button"
                onClick={() => { setPreview(null); mediaDataRef.current = null; mediaTypeRef.current = null; if (fileRef.current) fileRef.current.value = ""; }}
                className="absolute top-2 right-2 h-7 w-7 rounded-full bg-black/70 flex items-center justify-center hover:bg-black/90 transition-colors"
              >
                <X className="h-4 w-4 text-white" />
              </button>
            </div>
          ) : compressing ? (
            <div className="w-full h-24 rounded-xl border-2 border-dashed border-white/15 flex items-center justify-center gap-2">
              <div className="animate-spin h-5 w-5 rounded-full border-2 border-primary border-t-transparent" />
              <span className="text-xs text-muted-foreground">Processando...</span>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="h-16 sm:h-20 rounded-xl border-2 border-dashed border-white/15 flex flex-col items-center justify-center gap-1.5 text-white/40 hover:border-primary/50 hover:text-primary/70 hover:bg-primary/5 transition-all"
              >
                <ImageIcon className="h-5 w-5" />
                <span className="text-xs">Galeria</span>
              </button>
              <button
                type="button"
                onClick={() => document.getElementById("task-camera-input")?.click()}
                className="h-16 sm:h-20 rounded-xl border-2 border-dashed border-white/15 flex flex-col items-center justify-center gap-1.5 text-white/40 hover:border-primary/50 hover:text-primary/70 hover:bg-primary/5 transition-all"
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
    try {
      if (file.type.startsWith("video/")) {
        const token = localStorage.getItem("auth_token") ?? "";
        mediaDataRef.current = await uploadFileDirect(file, token);
        mediaTypeRef.current = "video";
        setPreview(URL.createObjectURL(file));
      } else {
        const data = await compressImage(file);
        mediaDataRef.current = data;
        mediaTypeRef.current = "photo";
        setPreview(data);
      }
    } catch {
      mediaDataRef.current = null;
      mediaTypeRef.current = null;
      setPreview(null);
    } finally {
      setCompressing(false);
    }
  }, []);

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
          queryClient.invalidateQueries();
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
          <label className="text-xs font-medium text-white/60 uppercase tracking-wide">Pet</label>
          <div className="grid grid-cols-2 gap-2 max-h-40 overflow-y-auto">
            {allPetsToShow.map((pet: any) => (
              <button
                key={pet.id}
                type="button"
                onClick={() => setSelectedPetId(pet.id)}
                className={`px-3 py-2 rounded-xl text-sm font-medium border transition-all text-left ${
                  selectedPetId === pet.id
                    ? "bg-primary/20 text-primary border-primary/50"
                    : "bg-white/5 text-white/70 border-white/10 hover:bg-white/10"
                }`}
              >
                {pet.name}
                {pet.isCheckedIn && <span className="ml-1 text-emerald-400 text-xs">✓</span>}
              </button>
            ))}
          </div>
        </div>

        {/* Event type */}
        <div className="space-y-2">
          <label className="text-xs font-medium text-white/60 uppercase tracking-wide">Tipo</label>
          <div className="flex flex-wrap gap-2">
            {eventTypes.map((t) => (
              <button key={t.value} type="button" onClick={() => setSelectedType(t.value)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                  selectedType === t.value
                    ? "bg-primary text-white border-primary shadow-[0_0_10px_rgba(139,92,246,0.4)]"
                    : "bg-white/5 text-white/60 border-white/10 hover:bg-white/10"
                }`}>
                {t.emoji} {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Photo / Video */}
        <div className="space-y-2">
          <label className="text-xs font-medium text-white/60 uppercase tracking-wide">Foto / Vídeo (opcional)</label>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
          <input id="standalone-camera" type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFileChange} />
          {preview ? (
            <div className="relative rounded-xl overflow-hidden border border-white/10">
              <img src={preview} alt="Preview" className="w-full max-h-36 object-cover" />
              <button type="button" onClick={() => { setPreview(null); mediaDataRef.current = null; mediaTypeRef.current = null; if (fileRef.current) fileRef.current.value = ""; }}
                className="absolute top-2 right-2 h-7 w-7 rounded-full bg-black/70 flex items-center justify-center hover:bg-black/90 transition-colors">
                <X className="h-4 w-4 text-white" />
              </button>
            </div>
          ) : compressing ? (
            <div className="w-full h-20 rounded-xl border-2 border-dashed border-white/15 flex items-center justify-center gap-2">
              <div className="animate-spin h-5 w-5 rounded-full border-2 border-primary border-t-transparent" />
              <span className="text-xs text-muted-foreground">Processando...</span>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => fileRef.current?.click()}
                className="h-14 rounded-xl border-2 border-dashed border-white/15 flex flex-col items-center justify-center gap-1 text-white/40 hover:border-primary/50 hover:text-primary/70 transition-all">
                <ImageIcon className="h-4 w-4" /><span className="text-xs">Galeria</span>
              </button>
              <button type="button" onClick={() => document.getElementById("standalone-camera")?.click()}
                className="h-14 rounded-xl border-2 border-dashed border-white/15 flex flex-col items-center justify-center gap-1 text-white/40 hover:border-primary/50 hover:text-primary/70 transition-all">
                <Camera className="h-4 w-4" /><span className="text-xs">Câmera</span>
              </button>
            </div>
          )}
        </div>

        {/* Caption */}
        <div className="space-y-2">
          <label className="text-xs font-medium text-white/60 uppercase tracking-wide">Mensagem</label>
          <textarea name="content" placeholder="Ex: Está adorando o dia aqui!" rows={2}
            className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder:text-muted-foreground resize-none focus:outline-none focus:border-primary/50 transition-colors" />
        </div>

        <Button type="submit" disabled={addEventMutation.isPending || !selectedPetId} className="w-full gap-2">
          <Sparkles className="h-4 w-4" />
          {addEventMutation.isPending ? "Publicando..." : "Publicar na Timeline"}
        </Button>
      </form>
    </Modal>
  );
}

export default function Staff({ hideHeader }: { hideHeader?: boolean }) {
  const { user } = useAuth();
  const crecheId = user?.crecheId || 1;
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
            queryClient.invalidateQueries();
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
            <div className="flex items-center gap-2 text-sm text-muted-foreground px-3 py-1.5 rounded-full bg-white/5 border border-white/10">
              <Users className="h-4 w-4" />
              {presentCount} pet{presentCount !== 1 ? "s" : ""} presente{presentCount !== 1 ? "s" : ""}
            </div>
          }
        />
      )}

      {/* Filter toggle + publish button */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setShowPublishModal(true)}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium transition-all bg-primary/20 text-primary border border-primary/30 hover:bg-primary/30"
        >
          <Sparkles className="h-3.5 w-3.5" />
          Publicar
        </button>
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
        <CardContent className="p-4 sm:p-6">
          <h2 className="text-xl font-display font-semibold mb-6 flex items-center gap-2">
            <CircleDashed className="text-amber-400" /> Pendentes ({pendingTasks.length})
          </h2>

          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">Carregando tarefas...</div>
          ) : pendingTasks.length ? (
            <Accordion type="multiple" defaultValue={groupedPendingTasks.map(g => `tutor-${g.tutorId}`)} className="w-full space-y-3">
              {groupedPendingTasks.map(group => (
                <AccordionItem key={`tutor-${group.tutorId}`} value={`tutor-${group.tutorId}`} className="border-white/10 bg-white/5 rounded-xl px-4 data-[state=open]:bg-white/10 transition-colors">
                  <AccordionTrigger className="hover:no-underline py-4">
                    <div className="flex items-center gap-3 text-left">
                      <div className="h-10 w-10 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                        <Users className="h-5 w-5 text-primary" />
                      </div>
                      <div>
                        <p className="font-semibold text-white text-base">{group.tutorName}</p>
                        <p className="text-sm text-muted-foreground">{group.tasks.length} tarefa{group.tasks.length !== 1 && 's'} pendente{group.tasks.length !== 1 && 's'}</p>
                      </div>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="pt-2 pb-4 space-y-3">
                    {group.tasks.map(task => (
                      <div
                        key={task.id}
                        id={`task-${task.id}`}
                        className={`p-4 rounded-xl bg-black/20 border flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-black/40 transition-all group ${
                          task.petId && checkedInPetIds.has(task.petId)
                            ? "border-emerald-500/20"
                            : "border-white/10"
                        } ${highlightTaskId === task.id ? "ring-2 ring-violet-400/50 bg-violet-500/5" : ""}`}
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
                            <p className="text-xs text-muted-foreground/70 mt-0.5 truncate">{task.description}</p>
                          )}
                        </div>
                        <div className="flex items-center justify-between sm:justify-end gap-3 flex-shrink-0">
                          <Badge variant={task.priority === "high" ? "destructive" : "secondary"}>
                            {priorityLabel[task.priority] || task.priority}
                          </Badge>
                          <Button
                            onClick={() => handleConcluir(task)}
                            variant="glass"
                            size="sm"
                            isLoading={completeTaskMutation.isPending && !taskToComplete}
                            className="group-hover:bg-primary group-hover:text-white group-hover:border-primary border-white/20 transition-all w-full sm:w-auto"
                          >
                            Concluir
                          </Button>
                        </div>
                      </div>
                    ))}
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
        <div className="opacity-60 hover:opacity-100 transition-opacity">
          <h2 className="text-xl font-display font-semibold mb-4 flex items-center gap-2 px-2">
            <CheckCircle2 className="text-emerald-400" /> Concluídas ({completedTasks.length})
          </h2>
          <div className="space-y-2.5">
            {completedTasks.map(task => (
              <div key={task.id} id={`task-${task.id}`} className="p-4 rounded-xl bg-transparent border border-white/5 flex items-center justify-between">
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
