// Telegram deep links → in-app paths. Pure and client-safe.
//
// A deep link only chooses which screen the Mini App opens on. It is never
// authority for anything: every action on that screen still goes through the
// normal session-checked API routes. That's why this is a strict allow-list
// that produces a *path on our own site* and nothing else — a crafted
// parameter can't become an open redirect, a javascript: URL, or a query
// string that pre-fills a form.
//
// Formats (Telegram limits start parameters to [A-Za-z0-9_-], ≤ 64 chars for
// /start and ≤ 512 for startapp):
//
//   ticket_T3F9K2A   → /check?code=T3F9K2A
//   game_<uid>       → /game/<uid>          (uid as in /game/[id])
//   promo_<id>       → /rewards/bonuses
//   event_<id>       → /sports              (the sportsbook iframe has no
//                                            event deep link; opens Sports)
//   sports | casino | live | games | wallet | deposit | history | tickets |
//   check | rewards | account | profile | home

import { displayCode, normalizeCode } from "./ticketCode";

const SECTIONS: Record<string, string> = {
  home: "/tg",
  sports: "/sports",
  casino: "/casino",
  live: "/casino/live",
  games: "/games",
  wallet: "/account",
  deposit: "/deposit",
  withdraw: "/withdraw",
  history: "/tickets",
  tickets: "/tickets",
  check: "/check",
  rewards: "/rewards",
  account: "/account",
  profile: "/account/settings",
};

const SAFE = /^[A-Za-z0-9_-]{1,512}$/;

/** In-app path for a start parameter, or null when it isn't one of ours. */
export function startPath(param: string | null | undefined): string | null {
  if (!param || !SAFE.test(param)) return null;

  const section = SECTIONS[param.toLowerCase()];
  if (section) return section;

  const sep = param.indexOf("_");
  if (sep <= 0) return null;
  const kind = param.slice(0, sep).toLowerCase();
  const arg = param.slice(sep + 1);
  if (!arg) return null;

  switch (kind) {
    case "ticket": {
      const code = normalizeCode(arg);
      return code ? `/check?code=${displayCode(code)}` : "/check";
    }
    case "game":
      // Charset already limited by SAFE, so no encoding surprises.
      return `/game/${arg}`;
    case "promo":
      return "/rewards/bonuses";
    case "event":
      return "/sports";
    default:
      return null;
  }
}

/** The /start or startapp parameter that opens Check Ticket on a code. */
export function ticketStartParam(code: string): string | null {
  const c = normalizeCode(code);
  return c ? `ticket_${displayCode(c)}` : null;
}
