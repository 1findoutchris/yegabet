/**
 * Calls the API on the same origin. On the website the session is an
 * httpOnly cookie; inside the Telegram Mini App the token is kept in memory
 * and sent as Bearer. Nothing is stored in localStorage.
 */

let bearer: string | null = null;
export const setBearer = (token: string | null) => {
  bearer = token;
};

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** The server's message ({message: string | string[]}) or a generic one. */
export function messageOf(status: number, body: unknown): string {
  const m = (body as { message?: unknown } | null)?.message;
  if (Array.isArray(m)) return m.join(", ");
  if (typeof m === "string" && m) return m;
  if (status === 401) return "Please log in again.";
  if (status === 429) return "Too many attempts. Please wait a minute.";
  return "Something went wrong. Please try again.";
}

export async function api<T = unknown>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const res = await fetch(path, {
    method: init.method ?? (init.body === undefined ? "GET" : "POST"),
    credentials: "same-origin",
    headers: {
      ...(init.body === undefined ? {} : { "content-type": "application/json" }),
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) throw new ApiError(res.status, messageOf(res.status, data));
  return data as T;
}

export const post = <T = unknown>(path: string, body: unknown = {}) => api<T>(path, { body });
