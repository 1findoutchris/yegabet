import { createServer, type Server } from "node:http";
import { writeFileSync, readFileSync, existsSync, unlinkSync } from "node:fs";
import path from "node:path";

/*
 * A tiny HTTP server standing in for the smsgate cloud API.
 *
 * Registration needs the OTP, and the alternatives are both bad: reading Redis
 * from the test process couples it to internals, and adding a "reveal the code"
 * hook to src/ puts test-only scaffolding in production code. Instead the app
 * under test is launched with SMSGATE_URL pointed here — sendSms() succeeds
 * (so the route returns { sent: true } rather than 502) and the message body,
 * which contains the code, is captured.
 *
 * Messages go to a file because the sink runs in Playwright's globalSetup
 * process while the specs run in workers — they do not share memory.
 */

// process.cwd(), not import.meta.dirname: Playwright transpiles this to CJS,
// where import.meta is a syntax error. Playwright always runs from the repo
// root, so cwd is stable.
const LOG = path.resolve(process.cwd(), "tests/e2e/.sms-sink.json");

export interface CapturedSms {
  to: string;
  text: string;
  at: number;
}

export function startSmsSink(port: number): Promise<Server> {
  writeFileSync(LOG, "[]", "utf-8");

  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        // smsgate's shape: { textMessage: { text }, phoneNumbers: [...] }
        const parsed = JSON.parse(body) as {
          textMessage?: { text?: string };
          phoneNumbers?: string[];
        };
        const captured: CapturedSms[] = JSON.parse(readFileSync(LOG, "utf-8"));
        captured.push({
          to: parsed.phoneNumbers?.[0] ?? "",
          text: parsed.textMessage?.text ?? "",
          at: Date.now(),
        });
        writeFileSync(LOG, JSON.stringify(captured), "utf-8");
      } catch {
        /* a malformed post is not worth failing the run over */
      }
      res.writeHead(202, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ id: "e2e", state: "Sent" }));
    });
  });

  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server)));
}

/** Every SMS the app has sent so far, newest last. */
export function capturedSms(): CapturedSms[] {
  if (!existsSync(LOG)) return [];
  try {
    return JSON.parse(readFileSync(LOG, "utf-8")) as CapturedSms[];
  } catch {
    return [];
  }
}

/**
 * The 6-digit code most recently sent to `phone`.
 * Polls, because the send happens asynchronously inside the route.
 */
export async function waitForOtp(phone: string, timeoutMs = 15_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const match = capturedSms()
      .filter((m) => m.to === phone)
      .pop();
    const code = match?.text.match(/\b(\d{6})\b/)?.[1];
    if (code) return code;
    await new Promise((r) => setTimeout(r, 250));
  }
  const seen = capturedSms().map((m) => m.to).join(", ") || "(none)";
  throw new Error(`No OTP captured for ${phone} within ${timeoutMs}ms. Sent to: ${seen}`);
}

export function clearSms(): void {
  writeFileSync(LOG, "[]", "utf-8");
}

export function stopSmsSink(server: Server): Promise<void> {
  try {
    unlinkSync(LOG);
  } catch {
    /* already gone */
  }
  return new Promise((resolve) => server.close(() => resolve()));
}
