import { Heart, MessageCircle, Eye } from "lucide-react";
import type { FeedPost } from "../types/feed.types";
import { useLikePost } from "../hooks/use-like-post";

interface FeedCardActionsProps {
  post: FeedPost;
  crecheId: number;
  onOpenComments: () => void;
}

export function FeedCardActions({ post, crecheId, onOpenComments }: FeedCardActionsProps) {
  const likeMutation = useLikePost(crecheId);

  const handleLike = () => {
    likeMutation.mutate(post.id);
  };

  return (
    <div className="px-5 py-3 border-t border-border bg-card flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
      {/* Left: like + comments */}
      <div className="flex items-center gap-2">
        {/* Like button */}
        <button
          onClick={handleLike}
          disabled={likeMutation.isPending}
          className="flex items-center justify-center gap-2 h-11 px-4 rounded-full hover:bg-secondary transition-colors text-sm font-medium select-none disabled:opacity-50"
        >
          <Heart
            className={`h-5 w-5 transition-transform duration-200 ${
              post.isLiked
                ? "fill-primary text-primary scale-110"
                : "text-muted-foreground"
            }`}
          />
          <span className={post.isLiked ? "text-primary" : "text-muted-foreground"}>
            {post.likeCount > 0 ? post.likeCount : "Curtir"}
          </span>
        </button>

        {/* Comments button */}
        <button
          onClick={onOpenComments}
          className="flex items-center justify-center gap-2 h-11 px-4 rounded-full hover:bg-secondary transition-colors text-sm font-medium"
        >
          <MessageCircle className="h-5 w-5 text-muted-foreground" />
          <span className="text-muted-foreground">
            {post.commentCount > 0 ? post.commentCount : "Comentar"}
          </span>
        </button>
      </div>

      {/* Right: views + author */}
      <div className="flex items-center justify-between sm:justify-end gap-3 px-4 sm:px-0 text-xs text-muted-foreground">
        {post.viewCount > 0 && (
          <span className="flex items-center gap-1.5 font-medium">
            <Eye className="h-4 w-4" />
            {post.viewCount}
          </span>
        )}
        <span className="font-medium truncate max-w-[120px]">{post.author.name}</span>
      </div>
    </div>
  );
}
