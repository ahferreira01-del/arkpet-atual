import { useState, useRef, useEffect } from "react";
import { X, Send, Loader2 } from "lucide-react";
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
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Sheet */}
      <div className="relative w-full sm:max-w-lg bg-card border border-white/10 rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[85dvh] sm:max-h-[70vh] animate-in slide-in-from-bottom-4 sm:zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/5 shrink-0">
          <h2 className="font-semibold text-white text-sm">
            Comentários {comments.length > 0 && `(${comments.length})`}
          </h2>
          <button
            onClick={onClose}
            className="h-7 w-7 rounded-full flex items-center justify-center hover:bg-white/10 text-muted-foreground hover:text-white transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Comment list */}
        <div ref={listRef} className="flex-1 overflow-y-auto px-5 py-4 space-y-4 min-h-0">
          {isLoading && (
            <div className="flex justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}

          {!isLoading && comments.length === 0 && (
            <p className="text-center text-sm text-muted-foreground py-8">
              Nenhum comentário ainda. Seja o primeiro!
            </p>
          )}

          {comments.map((comment) => (
            <div key={comment.id} className="flex gap-3">
              <div className="h-7 w-7 rounded-full bg-primary/20 flex items-center justify-center shrink-0 text-xs font-bold text-primary">
                {(comment.userName ?? "?")[0].toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="text-xs font-semibold text-white">{comment.userName ?? "Usuário"}</span>
                  <span className="text-xs text-muted-foreground">
                    {formatDistanceToNow(new Date(comment.createdAt), { addSuffix: true, locale: ptBR })}
                  </span>
                </div>
                <p className="text-sm text-white/80 mt-0.5 leading-relaxed">{comment.content}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Input */}
        <form onSubmit={handleSubmit} className="px-4 py-3 border-t border-white/5 flex gap-2 shrink-0">
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Escreva um comentário…"
            className="flex-1 bg-white/5 border border-white/10 rounded-full px-4 py-2 text-sm text-white placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            maxLength={500}
            autoFocus
          />
          <button
            type="submit"
            disabled={!draft.trim() || addMutation.isPending}
            className="h-9 w-9 rounded-full bg-primary flex items-center justify-center shrink-0 disabled:opacity-40 hover:bg-primary/90 transition-colors"
          >
            {addMutation.isPending
              ? <Loader2 className="h-4 w-4 animate-spin text-white" />
              : <Send className="h-4 w-4 text-white" />
            }
          </button>
        </form>
      </div>
    </div>
  );
}
