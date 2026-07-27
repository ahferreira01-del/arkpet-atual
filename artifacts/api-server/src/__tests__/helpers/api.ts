/**
 * Lightweight fetch wrapper for E2E tests.
 * Reads PORT from the environment (default 5000) so tests always
 * hit the live dev server.
 */

const PORT = process.env["API_TEST_PORT"] ?? process.env["PORT"] ?? "5000";
export const BASE_URL = `http://localhost:${PORT}/api`;

export type ApiResponse<T = unknown> = {
  status: number;
  body: T;
  ok: boolean;
};

export async function api<T = unknown>(
  method: string,
  path: string,
  opts: { token?: string; body?: unknown } = {},
): Promise<ApiResponse<T>> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.token) headers["Authorization"] = `Bearer ${opts.token}`;

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  let body: T;
  const text = await res.text();
  try {
    body = JSON.parse(text) as T;
  } catch {
    body = text as unknown as T;
  }

  return { status: res.status, body, ok: res.ok };
}

/** GET helper */
export const get = <T = unknown>(path: string, token?: string) =>
  api<T>("GET", path, { token });

/** POST helper */
export const post = <T = unknown>(path: string, body: unknown, token?: string) =>
  api<T>("POST", path, { body, token });

/** PUT helper */
export const put = <T = unknown>(path: string, body: unknown, token?: string) =>
  api<T>("PUT", path, { body, token });
