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
    <div className="px-4 py-3 bg-white/[0.02] border-t border-white/5 flex items-center justify-between">
      {/* Left: like + comments */}
      <div className="flex items-center gap-1">
        {/* Like button */}
        <button
          onClick={handleLike}
          disabled={likeMutation.isPending}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full hover:bg-white/5 transition-colors text-sm font-medium select-none"
        >
          <Heart
            className={`h-4 w-4 transition-transform duration-200 ${
              post.isLiked
                ? "fill-rose-400 text-rose-400 scale-110"
                : "text-muted-foreground"
            }`}
          />
          <span className={post.isLiked ? "text-rose-400" : "text-muted-foreground"}>
            {post.likeCount > 0 ? post.likeCount : "Curtir"}
          </span>
        </button>

        {/* Comments button */}
        <button
          onClick={onOpenComments}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full hover:bg-white/5 transition-colors text-sm font-medium"
        >
          <MessageCircle className="h-4 w-4 text-muted-foreground" />
          <span className="text-muted-foreground">
            {post.commentCount > 0 ? post.commentCount : "Comentar"}
          </span>
        </button>
      </div>

      {/* Right: views + author */}
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        {post.viewCount > 0 && (
          <span className="flex items-center gap-1">
            <Eye className="h-3.5 w-3.5" />
            {post.viewCount}
          </span>
        )}
        <span>{post.author.name}</span>
      </div>
    </div>
  );
}
