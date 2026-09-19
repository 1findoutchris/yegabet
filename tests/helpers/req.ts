import { NextRequest } from "next/server";

/*
 * Route handlers here are plain (NextRequest) => NextResponse — no next/headers,
 * no next/cache, no revalidatePath anywhere in src/app/api (verified). So they
 * can be imported and called directly, and these helpers just build the input
 * and unwrap the output.
 */

export interface ReqOptions {
  body?: unknown;
  headers?: Record<string, string>;
  /** Serialised into a `cookie:` header — NextRequest parses cookies from it. */
  cookies?: Record<string, string>;
}

/**
 * Build a NextRequest. Paths may be relative; they're resolved against a dummy
 * origin so `req.nextUrl.searchParams` works.
 */
export function req(method: string, path: string, opts: ReqOptions = {}): NextRequest {
  const url = path.startsWith("http") ? path : `http://localhost:3000${path}`;
  const headers = new Headers(opts.headers ?? {});

  if (opts.cookies && Object.keys(opts.cookies).length > 0) {
    const existing = headers.get("cookie");
    const serialised = Object.entries(opts.cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
    headers.set("cookie", existing ? `${existing}; ${serialised}` : serialised);
  }

  // NextRequest's own RequestInit, not the DOM one — its `signal` is not nullable.
  const init: ConstructorParameters<typeof NextRequest>[1] = { method, headers };
  if (opts.body !== undefined) {
    // Pass a string through untouched so a test can sign the EXACT raw bytes
    // the handler will read — the provider callback verifies an HMAC over them.
    init.body = typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body);
    if (!headers.has("content-type")) headers.set("content-type", "application/json");
  }

  return new NextRequest(url, init);
}

/** Unwrap a handler response into something assertable. */
export async function json<T = Record<string, unknown>>(
  res: Response,
): Promise<{ status: number; body: T }> {
  const text = await res.text();
  let body: T;
  try {
    body = text ? (JSON.parse(text) as T) : ({} as T);
  } catch {
    body = { raw: text } as unknown as T;
  }
  return { status: res.status, body };
}

/** Next 15+ passes dynamic segments as a promise. */
export function params<T extends Record<string, string>>(p: T): { params: Promise<T> } {
  return { params: Promise.resolve(p) };
}
