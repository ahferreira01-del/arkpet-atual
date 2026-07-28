import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { InfiniteData } from "@tanstack/react-query";
import { deletePost } from "../api/feed.api";
import type { FeedPage } from "../types/feed.types";
import { FEED_QUERY_KEY } from "./use-feed";

/**
 * Deletes a post and immediately removes it from the feed cache.
 */
export function useDeletePost(crecheId: number) {
  const queryClient = useQueryClient();
  const token = localStorage.getItem("auth_token") ?? "";

  return useMutation({
    mutationFn: (postId: number) => deletePost(crecheId, postId, token),

    onMutate: async (postId) => {
      await queryClient.cancelQueries({ queryKey: FEED_QUERY_KEY(crecheId) });

      const previous = queryClient.getQueryData<InfiniteData<FeedPage>>(
        FEED_QUERY_KEY(crecheId),
      );

      // Remove post from cache immediately
      queryClient.setQueryData<InfiniteData<FeedPage>>(
        FEED_QUERY_KEY(crecheId),
        (old) => {
          if (!old) return old;
          return {
            ...old,
            pages: old.pages.map((page) => ({
              ...page,
              posts: page.posts.filter((p) => p.id !== postId),
            })),
          };
        },
      );

      return { previous };
    },

    onError: (_err, _postId, context) => {
      if (context?.previous) {
        queryClient.setQueryData(FEED_QUERY_KEY(crecheId), context.previous);
      }
    },
  });
}
