import { NextResponse } from "next/server";
import { getMergedMethods } from "@/lib/paymentConfig";

/* Public — the deposit and withdraw pages fetch this for the current agent
   number / name and whether each rail is open (admin-editable, falls back to
   defaults). The flags here drive presentation only; the deposit and withdraw
   routes enforce them independently via isMethodEnabled. */
export async function GET() {
  const methods = await getMergedMethods();
  return NextResponse.json({
    methods: methods.map((m) => ({
      id: m.id,
      agentLabel: m.agentLabel,
      agentNumber: m.agentNumber,
      agentName: m.agentName,
      depositEnabled: m.depositEnabled,
      withdrawEnabled: m.withdrawEnabled,
      minDeposit: m.minDeposit,
      maxDeposit: m.maxDeposit,
      minWithdraw: m.minWithdraw,
      maxWithdraw: m.maxWithdraw,
    })),
  });
}
