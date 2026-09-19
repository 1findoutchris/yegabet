import axios from "axios";

const BASE_URL = process.env.SILENT_API_BASE_URL!;
const BEARER_TOKEN = process.env.SILENT_API_BEARER_TOKEN!;

const silentApiClient = axios.create({
  baseURL: BASE_URL,
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${BEARER_TOKEN}`,
  },
});

export interface LaunchGameParams {
  member_account: string;
  game_uid: string;
  balance: number;
  home_url: string;
}

export interface LaunchGameResponse {
  code: number;
  msg: string;
  payload: {
    game_launch_url: string;
  };
}

/**
 * Thrown when the provider declines to return a game URL (e.g. a vendor isn't
 * authorized for this account). Surfaced to the player as "temporarily
 * unavailable" rather than a generic failure.
 */
export class GameUnavailableError extends Error {
  providerMessage: string;
  constructor(providerMessage: string) {
    super(`Game unavailable: ${providerMessage}`);
    this.name = "GameUnavailableError";
    this.providerMessage = providerMessage;
  }
}

// The provider often nests a JSON status string inside `msg`; pull out the
// human-readable message when present.
function extractProviderMessage(msg: string): string {
  try {
    const parsed = JSON.parse(msg) as { status?: { message?: string } };
    return parsed?.status?.message ?? msg;
  } catch {
    return msg;
  }
}

export async function launchGame(params: LaunchGameParams): Promise<LaunchGameResponse> {
  // Kill-switch: every real GetGameUrl call bills the operator account. Calls
  // are OPT-IN via SILENT_API_LIVE="true" — anything else (unset, "false",
  // typo) returns a mock launch that bounces back to our own site, so the UI
  // flow stays testable in dev without spending credits.
  if (process.env.SILENT_API_LIVE !== "true") {
    return {
      code: 0,
      msg: "Success (mocked — SILENT_API_LIVE is not enabled)",
      payload: {
        game_launch_url: `${params.home_url}/casino?mocked_game=${encodeURIComponent(params.game_uid)}`,
      },
    };
  }

  const { data } = await silentApiClient.post<LaunchGameResponse>(
    "/api/GetGameUrl.php",
    params
  );

  if (data.code !== 0) {
    // A non-zero code means no playable URL — treat as game-unavailable.
    throw new GameUnavailableError(extractProviderMessage(data.msg));
  }

  return data;
}
