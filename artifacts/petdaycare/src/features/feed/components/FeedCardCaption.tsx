import { useState } from "react";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { editPostCaption } from "../api/feed.api";
import { useQueryClient } from "@tanstack/react-query";
import type { InfiniteData } from "@tanstack/react-query";
import type { FeedPage } from "../types/feed.types";
import { FEED_QUERY_KEY } from "../hooks/use-feed";

interface FeedCardCaptionProps {
  postId: number;
  crecheId: number;
  content: string | null;
  canEdit: boolean;
}

export function FeedCardCaption({ postId, crecheId, content, canEdit }: FeedCardCaptionProps) {
  const [editing, setEditing]   = useState(false);
  const [draft,   setDraft]     = useState(content ?? "");
  const [saving,  setSaving]    = useState(false);
  const queryClient = useQueryClient();

  const handleSave = async () => {
    setSaving(true);
    try {
      const token = localStorage.getItem("auth_token") ?? "";
      await editPostCaption(crecheId, postId, draft, token);

      queryClient.setQueryData<InfiniteData<FeedPage>>(
        FEED_QUERY_KEY(crecheId),
        (old) => {
          if (!old) return old;
          return {
            ...old,
            pages: old.pages.map((page) => ({
              ...page,
              posts: page.posts.map((p) =>
                p.id === postId ? { ...p, content: draft.trim() || null } : p,
              ),
            })),
          };
        },
      );
      setEditing(false);
    } catch {
      // silent — user can retry
    } finally {
      setSaving(false);
    }
  };

  if (!content && !editing) return null;

  return (
    <div className="relative group/caption">
      {editing ? (
        <div className="space-y-3">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            className="w-full text-base bg-secondary border-none resize-none px-4 py-3 rounded-xl focus-visible:ring-1 focus-visible:ring-primary"
            autoFocus
          />
          <div className="flex gap-2">
            <Button onClick={handleSave} disabled={saving} className="h-11 rounded-full px-5 font-medium shadow-sm">
              {saving ? "Salvando…" : "Salvar"}
            </Button>
            <Button
              variant="outline"
              onClick={() => { setEditing(false); setDraft(content ?? ""); }}
              className="h-11 rounded-full px-5 font-medium"
            >
              Cancelar
            </Button>
          </div>
        </div>
      ) : (
        <>
          <p className="text-base text-foreground whitespace-pre-wrap leading-relaxed pr-10">
            {content}
          </p>
          {canEdit && (
            <button
              onClick={() => setEditing(true)}
              className="absolute -top-1.5 -right-1.5 h-11 w-11 rounded-full bg-secondary text-muted-foreground hover:text-foreground flex items-center justify-center transition-colors sm:opacity-0 sm:group-hover/caption:opacity-100"
              title="Editar legenda"
            >
              <Pencil className="h-4 w-4" />
            </button>
          )}
        </>
      )}
    </div>
  );
}
