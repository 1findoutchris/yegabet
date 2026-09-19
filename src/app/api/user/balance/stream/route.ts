import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";
import { userBalanceChannel } from "@/lib/balanceEvents";
import { withdrawable } from "@/lib/wallet";

const HEARTBEAT_MS = 25_000; // keep proxies from closing the connection

/* Long-lived per-user SSE stream of wallet balance changes.
   Stays open and forwards every balance event (deposit approval, game bet/win)
   so the client wallet updates in realtime. EventSource auto-reconnects, so a
   dropped connection self-heals. */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return new Response("Unauthorized", { status: 401 });

  const userId = session.user.id;
  const encoder = new TextEncoder();
  const sse = (data: object) => encoder.encode(`data: ${JSON.stringify(data)}\n\n`);
  const comment = encoder.encode(": ping\n\n");

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const sub = redis.duplicate();

      function close() {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        sub.unsubscribe().catch(() => {});
        sub.quit().catch(() => {});
        try { controller.close(); } catch { /* already closed */ }
      }

      // Send the current balance immediately so the client is correct on connect
      try {
        const user = await prisma.user.findUnique({
          where: { id: userId },
          select: { balance: true, depositBalance: true, bonusBalance: true },
        });
        if (user) {
          controller.enqueue(sse({
            balance: Number(user.balance),
            withdrawable: withdrawable({
              balance: Number(user.balance),
              depositBalance: Number(user.depositBalance),
              bonusBalance: Number(user.bonusBalance),
            }),
            reason: "snapshot",
          }));
        }
      } catch { /* ignore — events will still flow */ }

      sub.on("error", close);
      sub.on("message", (_ch: string, msg: string) => {
        if (closed) return;
        try { controller.enqueue(sse(JSON.parse(msg))); } catch { close(); }
      });

      try {
        await sub.subscribe(userBalanceChannel(userId));
      } catch {
        close();
        return;
      }

      const heartbeat = setInterval(() => {
        if (closed) return;
        try { controller.enqueue(comment); } catch { close(); }
      }, HEARTBEAT_MS);

      req.signal.addEventListener("abort", close);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
