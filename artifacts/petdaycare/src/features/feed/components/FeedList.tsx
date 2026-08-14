import { useRef, useEffect } from "react";
import { Loader2, Camera, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FeedCard } from "./FeedCard";
import type { FeedPost } from "../types/feed.types";

interface FeedListProps {
  posts: FeedPost[];
  isLoading: boolean;
  isError: boolean;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  crecheId: number;
  userRole: string;
  userId: number;
  onRetry: () => void;
  onLoadMore: () => void;
}

export function FeedList({
  posts,
  isLoading,
  isError,
  hasNextPage,
  isFetchingNextPage,
  crecheId,
  userRole,
  userId,
  onRetry,
  onLoadMore,
}: FeedListProps) {
  // Intersection Observer: auto-load more when the sentinel enters the viewport
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) {
          onLoadMore();
        }
      },
      { rootMargin: "300px" }, // trigger 300px before the element reaches the viewport
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, onLoadMore]);

  if (isLoading) {
    return (
      <div className="space-y-6">
        {[1, 2, 3].map((i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-20 px-6 text-center bg-card border border-border rounded-2xl shadow-sm">
        <div className="h-14 w-14 rounded-full bg-destructive/10 flex items-center justify-center">
          <RefreshCw className="h-6 w-6 text-destructive" />
        </div>
        <div>
          <p className="text-base font-semibold text-foreground">Não foi possível carregar o feed</p>
          <p className="text-sm text-muted-foreground mt-1 max-w-sm">Verifique sua conexão e tente novamente para visualizar as atualizações.</p>
        </div>
        <Button size="lg" variant="outline" onClick={onRetry} className="mt-2 min-h-11 rounded-full">
          Tentar novamente
        </Button>
      </div>
    );
  }

  if (posts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-24 px-6 text-center bg-card border border-border rounded-2xl shadow-sm">
        <div className="h-14 w-14 rounded-full bg-secondary flex items-center justify-center">
          <Camera className="h-6 w-6 text-muted-foreground" />
        </div>
        <div>
          <p className="text-base font-semibold text-foreground">Nenhuma publicação ainda</p>
          <p className="text-sm text-muted-foreground mt-1 max-w-sm">
            As novidades, fotos e vídeos dos pets da creche aparecerão aqui.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {posts.map((post) => (
        <FeedCard
          key={post.id}
          post={post}
          crecheId={crecheId}
          userRole={userRole}
          userId={userId}
        />
      ))}

      {/* Sentinel element — Intersection Observer loads next page automatically */}
      <div ref={sentinelRef} className="h-1" aria-hidden />

      {/* Visible spinner while loading next page */}
      {isFetchingNextPage && (
        <div className="flex justify-center py-6">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="bg-card border border-border rounded-2xl overflow-hidden animate-pulse shadow-sm">
      <div className="p-4 flex items-center gap-4 border-b border-border">
        <div className="h-12 w-12 rounded-full bg-secondary shrink-0" />
        <div className="flex-1 space-y-3">
          <div className="h-4 bg-secondary rounded-full w-1/3" />
          <div className="h-3 bg-secondary rounded-full w-1/4" />
        </div>
      </div>
      <div className="p-5 space-y-3">
        <div className="h-4 bg-secondary rounded-full w-full" />
        <div className="h-4 bg-secondary rounded-full w-3/4" />
        <div className="h-48 bg-secondary rounded-xl mt-4" />
      </div>
      <div className="px-5 py-4 border-t border-border">
        <div className="h-4 bg-secondary rounded-full w-1/4" />
      </div>
    </div>
  );
}
