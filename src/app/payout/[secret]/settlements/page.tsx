"use client";

import { Banknote } from "lucide-react";
import { SettlementCard } from "../SettlementCard";

/* Asking to be paid, on its own page — the queue is the agent's minute-to-minute
   work and this is a once-in-a-while errand, so it doesn't belong in the way of
   it. The card carries its own balance, form and request history. */

export default function PayoutSettlementsPage() {
  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto space-y-5">
      <div>
        <h1 className="text-[20px] font-bold text-[color:var(--text-primary)] flex items-center gap-2">
          <Banknote className="w-5 h-5 text-[color:var(--gold)]" /> Request payout
        </h1>
        <p className="text-[12px] text-[color:var(--text-muted)] mt-0.5">
          Ask to be paid what the platform owes you. An admin sends the money and marks it settled —
          it clears from your balance only once they do.
        </p>
      </div>

      <SettlementCard />
    </div>
  );
}
