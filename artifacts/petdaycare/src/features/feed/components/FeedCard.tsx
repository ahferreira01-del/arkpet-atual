import { useState, useEffect } from "react";
import { Camera } from "lucide-react";
import type { FeedPost } from "../types/feed.types";
import { FeedCardHeader } from "./FeedCardHeader";
import { FeedCardCaption } from "./FeedCardCaption";
import { FeedCardMedia } from "./FeedCardMedia";
import { FeedCardActions } from "./FeedCardActions";
import { FeedCardMenu } from "./FeedCardMenu";
import { CommentsModal } from "./CommentsModal";
import { buildMediaSrc, getMediaToken } from "../utils/media.utils";

/**
 * Lazy-loads media for posts that pre-date object storage (V1 base64 posts).
 * Those posts have mediaItems:[] because buildMediaItems() skips data: URIs.
 * We fetch the event detail, which returns the raw base64 mediaUrl, and
 * render it directly — no storage URL needed for base64.
 */
function LegacyMediaFallback({
  postId,
  crecheId,
  mediaType,
}: {
  postId: number;
  crecheId: number;
  mediaType: string;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem("auth_token") ?? "";
    fetch(`/api/creches/${crecheId}/feed/${postId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data?.mediaUrl) return;
        const url: string = data.mediaUrl;
        if (url.startsWith("/objects/")) {
          setSrc(buildMediaSrc(url, getMediaToken()));
        } else if (url.startsWith("/api/storage")) {
          const mt = encodeURIComponent(getMediaToken());
          setSrc(`${url}${url.includes("?") ? "&" : "?"}mt=${mt}`);
        } else {
          setSrc(url); // base64 — use directly
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postId, crecheId]);

  if (loading) {
    return (
      <div className="w-full flex items-center justify-center gap-2 py-8 rounded-xl bg-white/5 border border-white/10 text-sm text-muted-foreground animate-pulse">
        <Camera className="h-4 w-4" />
        Carregando mídia…
      </div>
    );
  }
  if (!src) return null;

  if (mediaType === "video") {
    return (
      <div className="w-full rounded-xl overflow-hidden bg-black">
        <video
          src={src}
          controls
          playsInline
          preload="metadata"
          className="w-full max-h-[480px] rounded-xl"
        />
      </div>
    );
  }
  return (
    <img
      src={src}
      alt="Foto do pet"
      loading="lazy"
      className="w-full rounded-xl object-cover max-h-80"
    />
  );
}

interface FeedCardProps {
  post: FeedPost;
  crecheId: number;
  userRole: string;
  userId: number;
}

export function FeedCard({ post, crecheId, userRole, userId }: FeedCardProps) {
  const [commentsOpen, setCommentsOpen] = useState(false);

  const canEdit =
    userRole === "creche_admin" ||
    userRole === "staff" ||
    post.author.id === userId;

  const canDelete =
    userRole === "creche_admin" ||
    userRole === "staff";

  return (
    <>
      <article className="bg-card border border-white/5 rounded-2xl overflow-hidden animate-in fade-in slide-in-from-bottom-3 duration-300 relative">
        {/* Header row: event meta + optional menu */}
        <div className="flex items-start">
          <div className="flex-1 min-w-0">
            <FeedCardHeader post={post} />
          </div>
          {canDelete && (
            <div className="pt-3 pr-3 shrink-0">
              <FeedCardMenu postId={post.id} crecheId={crecheId} />
            </div>
          )}
        </div>

        {/* Body: caption + media */}
        {/* Body: caption + media */}
        {(post.content || post.mediaItems.length > 0 || post.type === "photo" || post.type === "video") && (
          <div className="px-4 pb-4 space-y-3">
            {post.content && (
              <FeedCardCaption
                postId={post.id}
                crecheId={crecheId}
                content={post.content}
                canEdit={canEdit}
              />
            )}
            {post.mediaItems.length > 0 ? (
              <FeedCardMedia
                postId={post.id}
                crecheId={crecheId}
                mediaItems={post.mediaItems}
              />
            ) : (post.type === "photo" || post.type === "video") ? (
              // Legacy fallback: pre-object-storage posts have no mediaItems but
              // do have a base64 mediaUrl retrievable via the detail endpoint.
              <LegacyMediaFallback
                postId={post.id}
                crecheId={crecheId}
                mediaType={post.type}
              />
            ) : null}
          </div>
        )}

        {/* Footer: actions */}
        <FeedCardActions
          post={post}
          crecheId={crecheId}
          onOpenComments={() => setCommentsOpen(true)}
        />
      </article>

      {commentsOpen && (
        <CommentsModal
          postId={post.id}
          crecheId={crecheId}
          onClose={() => setCommentsOpen(false)}
        />
      )}
    </>
  );
}
