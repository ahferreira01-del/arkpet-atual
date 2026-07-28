import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { InfiniteData } from "@tanstack/react-query";
import { publishPost, type CreatePostInput, type ProgressCallback } from "../services/post.service";
import type { FeedPost, FeedPage } from "../types/feed.types";
import { FEED_QUERY_KEY } from "./use-feed";

/**
 * Creates a new post and immediately prepends the returned DTO to the top of
 * the feed cache — no additional GET request required.
 */
export function useCreatePost(crecheId: number) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      input,
      token,
      onProgress,
    }: {
      input: CreatePostInput;
      token: string;
      onProgress?: ProgressCallback;
    }) => publishPost(crecheId, input, token, onProgress),

    onSuccess: (newPost: FeedPost) => {
      // Prepend the new post to the first page without re-fetching
      queryClient.setQueryData<InfiniteData<FeedPage>>(
        FEED_QUERY_KEY(crecheId),
        (old) => {
          if (!old) return old;
          const firstPage = old.pages[0];
          return {
            ...old,
            pages: [
              { ...firstPage, posts: [newPost, ...firstPage.posts] },
              ...old.pages.slice(1),
            ],
          };
        },
      );
    },
  });
}
