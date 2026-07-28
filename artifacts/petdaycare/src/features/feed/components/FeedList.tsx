import { useRef, useEffect } from "react";
import { Loader2, Camera, RefreshCw, ChevronDown } from "lucide-react";
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
  if (isLoading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <div className="h-12 w-12 rounded-full bg-red-500/10 flex items-center justify-center">
          <RefreshCw className="h-5 w-5 text-red-400" />
        </div>
        <p className="text-sm font-medium text-white">Não foi possível carregar o feed</p>
        <p className="text-xs text-muted-foreground">Verifique sua conexão e tente novamente.</p>
        <Button size="sm" variant="ghost" onClick={onRetry} className="mt-1">
          Tentar novamente
        </Button>
      </div>
    );
  }

  if (posts.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <div className="h-12 w-12 rounded-full bg-white/5 flex items-center justify-center">
          <Camera className="h-5 w-5 text-muted-foreground" />
        </div>
        <p className="text-sm font-medium text-white">Nenhuma publicação ainda</p>
        <p className="text-xs text-muted-foreground">
          As novidades da creche aparecerão aqui.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {posts.map((post) => (
        <FeedCard
          key={post.id}
          post={post}
          crecheId={crecheId}
          userRole={userRole}
          userId={userId}
        />
      ))}

      {/* Load more */}
      {hasNextPage && (
        <div className="flex justify-center pt-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={onLoadMore}
            disabled={isFetchingNextPage}
            className="gap-2 text-muted-foreground hover:text-white rounded-full"
          >
            {isFetchingNextPage ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
            {isFetchingNextPage ? "Carregando…" : "Carregar mais"}
          </Button>
        </div>
      )}
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="bg-card border border-white/5 rounded-2xl overflow-hidden animate-pulse">
      <div className="p-4 flex items-center gap-3 border-b border-white/5">
        <div className="h-10 w-10 rounded-full bg-white/10 shrink-0" />
        <div className="flex-1 space-y-2">
          <div className="h-3 bg-white/10 rounded w-1/3" />
          <div className="h-3 bg-white/10 rounded w-1/4" />
        </div>
      </div>
      <div className="p-4 space-y-2">
        <div className="h-3 bg-white/10 rounded w-full" />
        <div className="h-3 bg-white/10 rounded w-3/4" />
        <div className="h-40 bg-white/5 rounded-xl mt-3" />
      </div>
      <div className="px-4 py-3 border-t border-white/5">
        <div className="h-3 bg-white/10 rounded w-1/4" />
      </div>
    </div>
  );
}
