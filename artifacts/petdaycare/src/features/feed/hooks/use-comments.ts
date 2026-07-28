import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { InfiniteData } from "@tanstack/react-query";
import { listComments, addComment } from "../api/feed.api";
import type { FeedComment, FeedPage } from "../types/feed.types";
import { FEED_QUERY_KEY } from "./use-feed";

const COMMENTS_QUERY_KEY = (crecheId: number, postId: number) =>
  ["feed-v2-comments", crecheId, postId] as const;

export function useComments(crecheId: number, postId: number, enabled: boolean) {
  const token = localStorage.getItem("auth_token") ?? "";

  return useQuery({
    queryKey: COMMENTS_QUERY_KEY(crecheId, postId),
    queryFn:  () => listComments(crecheId, postId, token),
    enabled,
    staleTime: 60 * 1000, // 1 minute
  });
}

export function useAddComment(crecheId: number, postId: number) {
  const queryClient = useQueryClient();
  const token = localStorage.getItem("auth_token") ?? "";

  return useMutation({
    mutationFn: (content: string) => addComment(crecheId, postId, content, token),

    onSuccess: ({ comment, commentCount }) => {
      // Append new comment to the cached list
      queryClient.setQueryData<FeedComment[]>(
        COMMENTS_QUERY_KEY(crecheId, postId),
        (old) => (old ? [...old, comment] : [comment]),
      );

      // Update comment count in the feed cache
      queryClient.setQueryData<InfiniteData<FeedPage>>(
        FEED_QUERY_KEY(crecheId),
        (old) => {
          if (!old) return old;
          return {
            ...old,
            pages: old.pages.map((page) => ({
              ...page,
              posts: page.posts.map((post) =>
                post.id === postId ? { ...post, commentCount } : post,
              ),
            })),
          };
        },
      );
    },
  });
}
