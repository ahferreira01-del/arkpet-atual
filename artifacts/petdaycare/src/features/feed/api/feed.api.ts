import type { FeedPage, FeedPost, FeedComment, CreatePostPayload } from "../types/feed.types";

const BASE = (crecheId: number) => `/api/creches/${crecheId}/feed`;

function authHeaders(token: string) {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as any).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Queries
// ─────────────────────────────────────────────────────────────────────────────

export async function listFeed(
  crecheId: number,
  token: string,
  cursor?: number | null,
): Promise<FeedPage> {
  const url = cursor
    ? `${BASE(crecheId)}?after=${cursor}`
    : BASE(crecheId);
  const res = await fetch(url, { headers: authHeaders(token) });
  return handleResponse<FeedPage>(res);
}

export async function listComments(
  crecheId: number,
  postId: number,
  token: string,
): Promise<FeedComment[]> {
  const res = await fetch(`${BASE(crecheId)}/${postId}/comments`, {
    headers: authHeaders(token),
  });
  return handleResponse<FeedComment[]>(res);
}

// ─────────────────────────────────────────────────────────────────────────────
// Mutations
// ─────────────────────────────────────────────────────────────────────────────

export async function createPost(
  crecheId: number,
  payload: CreatePostPayload,
  token: string,
): Promise<{ post: FeedPost }> {
  const res = await fetch(BASE(crecheId), {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(payload),
  });
  return handleResponse<{ post: FeedPost }>(res);
}

export async function editPostCaption(
  crecheId: number,
  postId: number,
  content: string,
  token: string,
): Promise<void> {
  const res = await fetch(`${BASE(crecheId)}/${postId}`, {
    method: "PATCH",
    headers: authHeaders(token),
    body: JSON.stringify({ content }),
  });
  await handleResponse<unknown>(res);
}

export async function deletePost(
  crecheId: number,
  postId: number,
  token: string,
): Promise<void> {
  const res = await fetch(`${BASE(crecheId)}/${postId}`, {
    method: "DELETE",
    headers: authHeaders(token),
  });
  await handleResponse<unknown>(res);
}

export async function toggleLike(
  crecheId: number,
  postId: number,
  token: string,
): Promise<{ liked: boolean; likeCount: number }> {
  const res = await fetch(`${BASE(crecheId)}/${postId}/like`, {
    method: "POST",
    headers: authHeaders(token),
  });
  return handleResponse<{ liked: boolean; likeCount: number }>(res);
}

export async function recordView(
  crecheId: number,
  postId: number,
  token: string,
): Promise<void> {
  await fetch(`${BASE(crecheId)}/${postId}/view`, {
    method: "POST",
    headers: authHeaders(token),
  }).catch(() => {
    // View recording is best-effort — silently ignore failures
  });
}

export async function addComment(
  crecheId: number,
  postId: number,
  content: string,
  token: string,
): Promise<{ comment: FeedComment; commentCount: number }> {
  const res = await fetch(`${BASE(crecheId)}/${postId}/comments`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ content }),
  });
  return handleResponse<{ comment: FeedComment; commentCount: number }>(res);
}
