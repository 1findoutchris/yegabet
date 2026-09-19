import { describe, expect, test } from "vitest";
import { parseSms } from "@/lib/smsParser";

/*
 * parseSms turns the agent's payment SMS into a deposit match. Everything it
 * returns is load-bearing:
 *
 *   reference → matched against `pending:ref:<ref>` to auto-credit a deposit
 *   amount    → the credited figure (taken ONLY from the agent's copy, so a
 *               user pasting their own SMS cannot inflate it)
 *   direction → "sent" is rejected outright, which is what stops someone
 *               forwarding an outgoing-payment SMS as proof of a deposit
 *
 * A parse failure is safe (the deposit stays pending for manual review); a
 * WRONG parse credits the wrong amount or the wrong person.
 */

describe("direction — the anti-fraud gate", () => {
  test("an agent-received message is 'received'", () => {
    expect(parseSms("You have received ETB 500.00 from 251912345678. Ref: ABC12345678").direction)
      .toBe("received");
  });

  test.each([
    "You have sent ETB 500.00 to 251912345678. Ref: ABC12345678",
    "You sent 500 Br to a merchant. Ref: ABC12345678",
    "ETB 500 transferred. Ref: ABC12345678",
  ])("an outgoing message is 'sent' (%s)", (text) => {
    // /api/sms/inbound refuses these — a user must not be able to pass off
    // their own outgoing payment as an incoming one.
    expect(parseSms(text).direction).toBe("sent");
  });

  test("unrecognisable direction is null, not a guess", () => {
    expect(parseSms("Some unrelated message").direction).toBeNull();
  });
});

describe("method detection", () => {
  test.each([
    ["telebirr", "Dear customer, you have received ETB 250.00 via telebirr. Ref: TX123456789"],
    ["cbebirr", "Your CBE Birr account has been credited with 300.00 Br. Ref: FT98765432"],
    ["ebirr", "You have received ETB 100.00 through eBirr. Ref no 123456789012"],
  ])("detects %s from the body", (method, text) => {
    expect(parseSms(text).method).toBe(method);
  });

  test("falls back to the sender address when the body is ambiguous", () => {
    expect(parseSms("You have received 200.00 Br.", "8031").method).toBe("telebirr");
    expect(parseSms("You have received 200.00 Br.", "127").method).toBe("cbebirr");
  });

  test("unknown method is null", () => {
    expect(parseSms("You have received something.").method).toBeNull();
  });
});

describe("amount", () => {
  test("parses thousands separators and decimals", () => {
    expect(parseSms("You have received ETB 1,250.75 via telebirr. Ref: TX123456789").amount)
      .toBe(1250.75);
  });

  test("CBE 'credited with' phrasing", () => {
    expect(parseSms("Your CBE Birr account has been credited with 2,000.00 Br. Ref: FT98765432").amount)
      .toBe(2000);
  });

  test("eBirr ETB phrasing", () => {
    expect(parseSms("You have received ETB 750.50 through eBirr. Ref no 123456789012").amount)
      .toBe(750.5);
  });

  test("no amount when the method is unknown — never guess a figure", () => {
    // Money is credited from this number; a wrong guess is a real loss.
    expect(parseSms("You have received 500.00 from someone").amount).toBeNull();
  });
});

describe("reference", () => {
  test("extracts an explicitly labelled ref and upper-cases it", () => {
    expect(parseSms("You have received ETB 500 via telebirr. Ref: abc12345678").reference)
      .toBe("ABC12345678");
  });

  test.each([
    ["Transaction ID: FT98765432", "FT98765432"],
    ["txn no. ABC123456789", "ABC123456789"],
    ["trx id is XY9876543210", "XY9876543210"],
  ])("handles the label variant %s", (fragment, expected) => {
    expect(parseSms(`CBE Birr credited with 100.00 Br. ${fragment}`).reference).toBe(expected);
  });

  test("eBirr numeric ref", () => {
    expect(parseSms("You have received ETB 100.00 through eBirr. Ref no 123456789012").reference)
      .toBe("123456789012");
  });

  test("falls back to a standalone alphanumeric token", () => {
    expect(parseSms("telebirr received ETB 100. FT4B7X9K21Q").reference).toBe("FT4B7X9K21Q");
  });

  test("no reference rather than a wrong one", () => {
    // Without a ref the deposit falls back to amount+method matching, which is
    // deliberately weaker — but inventing a ref would match someone else's.
    expect(parseSms("hello there").reference).toBeNull();
  });
});

describe("Amharic", () => {
  test("recognises received", () => {
    expect(parseSms("500.00 ብር ተቀብለዋል። telebirr Ref: TX123456789").direction).toBe("received");
  });

  test("recognises sent", () => {
    expect(parseSms("500.00 ብር ልከዋል። telebirr Ref: TX123456789").direction).toBe("sent");
  });
});

describe("robustness", () => {
  test.each(["", "   ", "?????", "12345"])("never throws on %s", (text) => {
    expect(() => parseSms(text)).not.toThrow();
  });

  test("returns an all-null shape for junk rather than partial garbage", () => {
    expect(parseSms("")).toEqual({
      method: null, amount: null, reference: null, sender: null, direction: null,
    });
  });
});
