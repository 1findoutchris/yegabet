/**
 * Octhera API v2 calls we make (catalog, launch). Wallet calls come the
 * other way (adapter.ts). Bearer API key; JSON `{status, …}` answers.
 */

export interface OctheraGame {
  gameUid: string;
  name: string;
  providerName?: string;
  provider?: string;
  type?: string;
  img?: string;
}

export class OctheraError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(`Octhera ${status}: ${message}`);
    this.name = "OctheraError";
  }
}

export class OctheraClient {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl = "https://api.octhera.org/api/v2",
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl.replace(/\/+$/, "")}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text();
    let data: { status?: string; message?: string } & Record<string, unknown>;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      throw new OctheraError(res.status, `non-JSON answer: ${text.slice(0, 120)}`);
    }
    if (!res.ok || data.status === "fail" || data.status === "error") {
      throw new OctheraError(res.status, String(data.message ?? "request failed"));
    }
    return data as T;
  }

  /** One page of the catalog. */
  listGames(page: number, perPage: number): Promise<{ total?: number; games?: OctheraGame[] }> {
    return this.call("GET", `/games?page=${page}&perPage=${perPage}`);
  }

  /** A single-use launch URL, to open within 60 s. */
  async launch(params: { playerId: string; balance: number; gameUid: string; device: "mobile" | "desktop" }) {
    const d = await this.call<{ launchUrl?: string }>("POST", "/players/launch", { ...params, lang: "en" });
    if (!d.launchUrl) throw new OctheraError(502, "no launchUrl in the answer");
    return d.launchUrl;
  }
}
