import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { InfiniteData } from "@tanstack/react-query";
import { toggleLike } from "../api/feed.api";
import type { FeedPage } from "../types/feed.types";
import { FEED_QUERY_KEY } from "./use-feed";

/**
 * Toggle like with optimistic update and automatic rollback on error.
 */
export function useLikePost(crecheId: number) {
  const queryClient = useQueryClient();
  const token = localStorage.getItem("auth_token") ?? "";

  return useMutation({
    mutationFn: (postId: number) => toggleLike(crecheId, postId, token),

    onMutate: async (postId) => {
      // Cancel in-flight queries so they don't overwrite optimistic update
      await queryClient.cancelQueries({ queryKey: FEED_QUERY_KEY(crecheId) });

      // Snapshot for rollback
      const previous = queryClient.getQueryData<InfiniteData<FeedPage>>(
        FEED_QUERY_KEY(crecheId),
      );

      // Apply optimistic update
      queryClient.setQueryData<InfiniteData<FeedPage>>(
        FEED_QUERY_KEY(crecheId),
        (old) => {
          if (!old) return old;
          return {
            ...old,
            pages: old.pages.map((page) => ({
              ...page,
              posts: page.posts.map((post) =>
                post.id === postId
                  ? {
                      ...post,
                      isLiked:   !post.isLiked,
                      likeCount: post.isLiked ? post.likeCount - 1 : post.likeCount + 1,
                    }
                  : post,
              ),
            })),
          };
        },
      );

      return { previous };
    },

    onError: (_err, _postId, context) => {
      // Revert optimistic update on failure
      if (context?.previous) {
        queryClient.setQueryData(FEED_QUERY_KEY(crecheId), context.previous);
      }
    },

    onSuccess: (data, postId) => {
      // Sync server truth (count may differ from optimistic guess)
      queryClient.setQueryData<InfiniteData<FeedPage>>(
        FEED_QUERY_KEY(crecheId),
        (old) => {
          if (!old) return old;
          return {
            ...old,
            pages: old.pages.map((page) => ({
              ...page,
              posts: page.posts.map((post) =>
                post.id === postId
                  ? { ...post, isLiked: data.liked, likeCount: data.likeCount }
                  : post,
              ),
            })),
          };
        },
      );
    },
  });
}
