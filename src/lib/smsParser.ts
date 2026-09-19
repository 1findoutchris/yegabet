export type SmsMethod = "telebirr" | "cbebirr" | "ebirr";

export interface ParsedSms {
  method: SmsMethod | null;
  amount: number | null;
  reference: string | null;
  sender: string | null;
  direction: "received" | "sent" | null;
}

/**
 * Parses an Ethiopian mobile-payment SMS (TeleBirr, CBE Birr, eBirr).
 * Amount is only extracted from agent-received messages — the value from the
 * agent's copy is authoritative and cannot be manipulated by the user.
 */
export function parseSms(text: string, senderAddress?: string): ParsedSms {
  const t = text.trim();
  const from = (senderAddress ?? "").trim().toLowerCase();

  // ── Detect method ────────────────────────────────────────────────────────────
  const isCbe =
    /\bcbe\b|cbebirr|cbe\s*birr|cbepay|commercial\s*bank/i.test(t) ||
    /\bcbe\b|cbebirr|cbe\s*birr|cbepay|8112|127/i.test(from);
  const isTeleBirr =
    /telebirr|ethio\s*telecom|ብር.*DD|DD.*ብር/i.test(t) ||
    /telebirr|ethio\s*telecom|8031/i.test(from);
  const isEbirr =
    /(?<![A-Z])ebirr|\be-birr\b/i.test(t) ||
    /(?<![A-Z])ebirr|\be-birr\b|8002/i.test(from);

  const method: SmsMethod | null = isCbe
    ? "cbebirr"
    : isTeleBirr
    ? "telebirr"
    : isEbirr
    ? "ebirr"
    : null;

  // ── Extract reference ────────────────────────────────────────────────────────
  let reference: string | null = null;

  if (isEbirr) {
    const m = t.match(
      /\b(?:with\s+)?ref(?:\s+no)?[:\s](\d{9,13})\b|\bId[:\s]\s*(\d{9,13})\b/i
    );
    if (m) reference = m[1] ?? m[2];
  }

  if (!reference) {
    const m = t.match(
      /\b(?:ref|reference|txn|transaction|trx|tid)\.?(?:[\s:-]*(?:id|no|number)\.?)?[\s:=]*(?:is[\s:-]*)?([A-Z0-9]{8,15})\b/i
    );
    if (m) reference = m[1].toUpperCase();
  }

  if (!reference) {
    // Any standalone 8-15 char token containing both letters and digits
    for (const cand of t.match(/\b([A-Z0-9]{8,15})\b/gi) ?? []) {
      if (/[A-Z]/i.test(cand) && /[0-9]/.test(cand)) {
        reference = cand.toUpperCase();
        break;
      }
    }
  }

  // ── Detect direction ─────────────────────────────────────────────────────────
  const isReceived = /received|ተቀብለዋል|ደርሶዎታል|ገቢ/i.test(t);
  const isSent =
    /\bsent\s+to\b|\byou\s+have\s+sent\b|\byou\s+sent\b|transferred|ልከዋል|ላኩ|ወጪ/i.test(t);
  const direction: "received" | "sent" | null = isReceived
    ? "received"
    : isSent
    ? "sent"
    : null;

  // ── Extract amount ───────────────────────────────────────────────────────────
  let amount: number | null = null;

  if (isCbe) {
    const m =
      t.match(/(?:received|credited\s+with)\s+([\d,]+\.?\d*)\s*(?:Br\.?|ብር)/i) ??
      t.match(/([\d,]+\.?\d*)\s*(?:Br\.?|ብር)\s*(?:ተቀብለዋል|ደርሶዎታል|ገቢ)/i) ??
      t.match(/([\d,]+\.?\d*)\s*(?:Br\.?|ብር)/i);
    if (m) amount = parseFloat(m[1].replace(/,/g, ""));
  } else if (isEbirr) {
    const m = t.match(/ETB\s*([\d,]+\.?\d*)/i);
    if (m) amount = parseFloat(m[1].replace(/,/g, ""));
  } else if (isTeleBirr) {
    const m =
      t.match(/ETB\s+([\d,]+\.?\d*)/i) ?? t.match(/([\d,]+\.?\d*)\s*ብር/);
    if (m) amount = parseFloat(m[1].replace(/,/g, ""));
  }

  // ── Extract sender phone ─────────────────────────────────────────────────────
  const senderMatch =
    (isEbirr ? t.match(/\((\d{9,10})\)/) : null) ??
    t.match(/from\s+([\d*]{9,12})/i) ??
    t.match(/\b(251[\d*]{9,11})\b/);
  const sender = senderMatch ? senderMatch[1] : null;

  return { method, amount, reference, sender, direction };
}
