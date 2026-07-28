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
        <div className="space-y-2">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            className="w-full text-sm"
            autoFocus
          />
          <div className="flex gap-2">
            <Button size="sm" onClick={handleSave} disabled={saving}>
              {saving ? "Salvando…" : "Salvar"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => { setEditing(false); setDraft(content ?? ""); }}
            >
              Cancelar
            </Button>
          </div>
        </div>
      ) : (
        <>
          <p className="text-sm text-white/90 whitespace-pre-wrap leading-relaxed pr-7">
            {content}
          </p>
          {canEdit && (
            <button
              onClick={() => setEditing(true)}
              className="absolute top-0 right-0 h-6 w-6 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors opacity-0 group-hover/caption:opacity-100"
              title="Editar legenda"
            >
              <Pencil className="h-3 w-3 text-white/60" />
            </button>
          )}
        </>
      )}
    </div>
  );
}
