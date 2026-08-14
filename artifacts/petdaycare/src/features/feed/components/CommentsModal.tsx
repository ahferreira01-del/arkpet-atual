import { useState, useRef, useEffect } from "react";
import { X, Send, Loader2, MessageCircle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useComments, useAddComment } from "../hooks/use-comments";

interface CommentsModalProps {
  postId: number;
  crecheId: number;
  onClose: () => void;
}

export function CommentsModal({ postId, crecheId, onClose }: CommentsModalProps) {
  const [draft, setDraft]     = useState("");
  const listRef               = useRef<HTMLDivElement>(null);

  const { data: comments = [], isLoading } = useComments(crecheId, postId, true);
  const addMutation = useAddComment(crecheId, postId);

  // Scroll to bottom when new comment appears
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [comments.length]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text || addMutation.isPending) return;
    setDraft("");
    await addMutation.mutateAsync(text).catch(() => setDraft(text));
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4 pb-[calc(72px+env(safe-area-inset-bottom,0px))] sm:pb-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/80" onClick={onClose} />

      {/* Sheet */}
      <div className="relative w-full sm:max-w-lg bg-background sm:border sm:border-border rounded-t-3xl sm:rounded-2xl shadow-xl flex flex-col max-h-[85svh] sm:max-h-[70vh] mb-[calc(72px+env(safe-area-inset-bottom,0px))] sm:mb-0 animate-in slide-in-from-bottom-4 sm:zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between pl-6 pr-4 py-3 border-b border-border shrink-0 bg-background rounded-t-3xl sm:rounded-t-2xl">
          <h2 className="font-semibold text-foreground text-sm">
            Comentários {comments.length > 0 && `(${comments.length})`}
          </h2>
          <button
            onClick={onClose}
            className="h-11 w-11 rounded-full flex items-center justify-center text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
            title="Fechar"
            aria-label="Fechar comentários"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Comment list */}
        <div ref={listRef} className="flex-1 overflow-y-auto px-6 py-5 space-y-5 min-h-0">
          {isLoading && (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )}

          {!isLoading && comments.length === 0 && (
            <div className="flex flex-col items-center justify-center text-center py-12 space-y-3">
              <div className="h-12 w-12 rounded-full bg-secondary flex items-center justify-center">
                <MessageCircle className="h-5 w-5 text-muted-foreground" />
              </div>
              <p className="text-sm font-medium text-muted-foreground">
                Nenhum comentário ainda. Seja o primeiro!
              </p>
            </div>
          )}

          {comments.map((comment) => (
            <div key={comment.id} className="flex gap-3">
              <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0 text-sm font-bold text-primary">
                {(comment.userName ?? "?")[0].toUpperCase()}
              </div>
              <div className="flex-1 min-w-0 bg-card border border-border rounded-2xl rounded-tl-none p-3 shadow-sm">
                <div className="flex items-baseline justify-between gap-2 flex-wrap mb-1">
                  <span className="text-sm font-semibold text-foreground truncate pr-2">
                    {comment.userName ?? "Usuário"}
                  </span>
                  <span className="text-xs font-medium text-muted-foreground shrink-0">
                    {formatDistanceToNow(new Date(comment.createdAt), { addSuffix: true, locale: ptBR })}
                  </span>
                </div>
                <p className="text-sm text-foreground/90 whitespace-pre-wrap leading-relaxed">{comment.content}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Input */}
        <div className="p-4 border-t border-border shrink-0 bg-background">
          <form onSubmit={handleSubmit} className="flex gap-2">
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Escreva um comentário…"
              className="flex-1 h-12 bg-secondary border border-transparent rounded-full px-5 text-base text-foreground placeholder:text-muted-foreground focus:outline-none focus:bg-background focus:border-primary transition-colors"
              maxLength={500}
            />
            <button
              type="submit"
              disabled={!draft.trim() || addMutation.isPending}
              className="h-12 w-12 rounded-full bg-primary flex items-center justify-center shrink-0 disabled:opacity-50 shadow-sm"
              aria-label="Enviar comentário"
            >
              {addMutation.isPending
                ? <Loader2 className="h-5 w-5 animate-spin text-primary-foreground" />
                : <Send className="h-5 w-5 text-primary-foreground -ml-0.5" />
              }
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
