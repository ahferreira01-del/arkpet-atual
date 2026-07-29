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
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <form
        onSubmit={handleSubmit}
        className="relative w-full sm:max-w-lg bg-card border border-white/10 rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[92dvh] sm:max-h-[85vh] animate-in slide-in-from-bottom-4 sm:zoom-in-95 duration-200"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/5 shrink-0">
          <h2 className="font-semibold text-white">Nova publicação</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            className="h-7 w-7 rounded-full flex items-center justify-center hover:bg-white/10 text-muted-foreground hover:text-white transition-colors disabled:opacity-40"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5 min-h-0">
          {/* Caption */}
          <div>
            <Textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="O que está acontecendo agora?"
              rows={3}
              disabled={isPending}
              className="w-full bg-transparent border-none resize-none focus-visible:ring-0 px-0 text-base placeholder:text-muted-foreground/60"
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
        <div className="px-5 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] border-t border-white/5 shrink-0 space-y-3">
          {/* Upload progress bar */}
          {isPending && uploadPercent !== undefined && (
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <Upload className="h-3 w-3" />
                  {stageLabel ?? "Enviando…"}
                </span>
                <span>{uploadPercent}%</span>
              </div>
              <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all duration-300"
                  style={{ width: `${uploadPercent}%` }}
                />
              </div>
            </div>
          )}

          {isPending && uploadPercent === undefined && (
            <p className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {stageLabel ?? "Processando…"}
            </p>
          )}

          <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-2">
            <p className="text-xs text-muted-foreground text-center sm:text-left">
              {selectedPets.length === 0
                ? "Selecione pelo menos um pet"
                : !content.trim() && !mediaFile
                ? "Adicione uma legenda ou mídia"
                : null}
            </p>
            <Button
              type="submit"
              disabled={!isValid || isPending}
              className="w-full sm:w-auto rounded-full px-6 shadow-lg shadow-primary/20 shrink-0"
            >
              {isPending ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {stageLabel ?? "Publicando…"}
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4" />
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
