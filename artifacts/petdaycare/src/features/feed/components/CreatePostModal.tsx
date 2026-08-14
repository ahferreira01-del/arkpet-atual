import { useState, useCallback } from "react";
import { X, Loader2, CheckCircle2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { MediaPicker } from "./MediaPicker";
import { PetSelector } from "./PetSelector";
import { validateMediaFile } from "../services/upload.service";
import { useCreatePost } from "../hooks/use-create-post";
import type { TaggablePet } from "../types/feed.types";
import type { CreatePostProgress } from "../services/post.service";

interface CreatePostModalProps {
  crecheId: number;
  checkedInPets: TaggablePet[];
  onClose: () => void;
}

const STAGE_LABEL: Record<CreatePostProgress["stage"], string> = {
  validating: "Validando…",
  uploading:  "Enviando mídia…",
  saving:     "Publicando…",
  done:       "Publicado!",
};

export function CreatePostModal({ crecheId, checkedInPets, onClose }: CreatePostModalProps) {
  const [content,     setContent]     = useState("");
  const [mediaFile,   setMediaFile]   = useState<File | null>(null);
  const [mediaError,  setMediaError]  = useState<string | null>(null);
  const [selectedPets, setSelected]   = useState<number[]>([]);
  const [progress,    setProgress]    = useState<CreatePostProgress | null>(null);

  const createMutation = useCreatePost(crecheId);

  const handleMediaSelect = useCallback(async (file: File) => {
    setMediaError(null);
    const result = await validateMediaFile(file);
    if (!result.valid) {
      setMediaError(result.error ?? "Arquivo inválido");
      return;
    }
    setMediaFile(file);
  }, []);

  const handleMediaRemove = useCallback(() => {
    setMediaFile(null);
    setMediaError(null);
  }, []);

  const handleTogglePet = useCallback((petId: number) => {
    setSelected((prev) =>
      prev.includes(petId) ? prev.filter((id) => id !== petId) : [...prev, petId],
    );
  }, []);

  const isValid =
    selectedPets.length > 0 && (content.trim().length > 0 || mediaFile !== null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid || createMutation.isPending) return;

    const token = localStorage.getItem("auth_token") ?? "";

    try {
      await createMutation.mutateAsync({
        input: { content, mediaFile, petIds: selectedPets },
        token,
        onProgress: setProgress,
      });
      onClose();
    } catch (err) {
      setProgress(null);
      setMediaError(err instanceof Error ? err.message : "Erro ao publicar. Tente novamente.");
    }
  };

  const isPending = createMutation.isPending;
  const stageLabel = progress ? STAGE_LABEL[progress.stage] : null;
  const uploadPercent = progress?.uploadPercent;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4 pb-[calc(72px+env(safe-area-inset-bottom,0px))] sm:pb-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/80" onClick={onClose} />

      {/* Modal */}
      <form
        onSubmit={handleSubmit}
        className="relative w-full sm:max-w-lg bg-card sm:border sm:border-border rounded-t-3xl sm:rounded-2xl shadow-xl flex flex-col max-h-[88svh] sm:max-h-[85vh] mb-[calc(72px+env(safe-area-inset-bottom,0px))] sm:mb-0 animate-in slide-in-from-bottom-4 sm:zoom-in-95 duration-200"
      >
        {/* Header */}
        <div className="flex items-center justify-between pl-6 pr-4 py-3 border-b border-border shrink-0">
          <h2 className="font-semibold text-foreground">Nova publicação</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            className="h-11 w-11 rounded-full flex items-center justify-center text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors disabled:opacity-50"
            title="Fechar"
            aria-label="Fechar modal"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6 min-h-0">
          {/* Caption */}
          <div>
            <Textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="O que está acontecendo agora?"
              disabled={isPending}
              className="w-full min-h-[100px] bg-transparent border-none resize-none focus-visible:ring-0 px-0 text-base placeholder:text-muted-foreground/60 text-foreground"
              maxLength={1000}
            />
          </div>

          {/* Media */}
          <MediaPicker
            file={mediaFile}
            error={mediaError}
            onSelect={handleMediaSelect}
            onRemove={handleMediaRemove}
          />

          {/* Pets */}
          <PetSelector
            pets={checkedInPets}
            selectedIds={selectedPets}
            onToggle={handleTogglePet}
          />
        </div>

        {/* Footer */}
        <div className="px-6 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] border-t border-border shrink-0 space-y-4 bg-card rounded-b-2xl">
          {/* Upload progress bar */}
          {isPending && uploadPercent !== undefined && (
            <div className="space-y-1.5">
              <div className="flex justify-between text-sm font-medium text-muted-foreground">
                <span className="flex items-center gap-2">
                  <Upload className="h-4 w-4" />
                  {stageLabel ?? "Enviando…"}
                </span>
                <span>{uploadPercent}%</span>
              </div>
              <div className="h-2 rounded-full bg-secondary overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all duration-300 ease-out"
                  style={{ width: `${uploadPercent}%` }}
                />
              </div>
            </div>
          )}

          {isPending && uploadPercent === undefined && (
            <p className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              {stageLabel ?? "Processando…"}
            </p>
          )}

          <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3">
            <p className="text-sm font-medium text-muted-foreground text-center sm:text-left">
              {selectedPets.length === 0
                ? "Selecione pelo menos um pet"
                : !content.trim() && !mediaFile
                ? "Adicione legenda ou mídia"
                : null}
            </p>
            <Button
              type="submit"
              disabled={!isValid || isPending}
              className="w-full sm:w-auto h-12 rounded-full px-8 shadow-sm shrink-0 text-base font-medium"
            >
              {isPending ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  {stageLabel ?? "Publicando…"}
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5" />
                  Publicar
                </span>
              )}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
