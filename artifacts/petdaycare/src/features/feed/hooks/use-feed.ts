import { useInfiniteQuery } from "@tanstack/react-query";
import { listFeed } from "../api/feed.api";

export const FEED_QUERY_KEY = (crecheId: number) => ["feed-v2", crecheId] as const;

/**
 * Paginated feed using cursor-based pagination.
 * Returns pages of posts; call fetchNextPage() to load more.
 */
export function useFeed(crecheId: number) {
  const token = localStorage.getItem("auth_token") ?? "";

  return useInfiniteQuery({
    queryKey: FEED_QUERY_KEY(crecheId),
    queryFn: ({ pageParam }) =>
      listFeed(crecheId, token, pageParam as number | null),
    initialPageParam: null as number | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    staleTime: 5 * 60 * 1000,  // 5 minutes — reduced background refetches
    gcTime:    60 * 60 * 1000, // 1 hour   — keep pages in memory longer
  });
}
