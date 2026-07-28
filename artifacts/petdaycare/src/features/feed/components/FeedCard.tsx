import { useState } from "react";
import type { FeedPost } from "../types/feed.types";
import { FeedCardHeader } from "./FeedCardHeader";
import { FeedCardCaption } from "./FeedCardCaption";
import { FeedCardMedia } from "./FeedCardMedia";
import { FeedCardActions } from "./FeedCardActions";
import { FeedCardMenu } from "./FeedCardMenu";
import { CommentsModal } from "./CommentsModal";

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
        {(post.content || post.mediaItems.length > 0) && (
          <div className="px-4 pb-4 space-y-3">
            {post.content && (
              <FeedCardCaption
                postId={post.id}
                crecheId={crecheId}
                content={post.content}
                canEdit={canEdit}
              />
            )}
            {post.mediaItems.length > 0 && (
              <FeedCardMedia
                postId={post.id}
                crecheId={crecheId}
                mediaItems={post.mediaItems}
              />
            )}
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
