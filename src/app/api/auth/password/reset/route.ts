import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizePhone } from "@/lib/sms";
import { verifyOtp } from "@/lib/otp";
import bcrypt from "bcryptjs";
import { z } from "zod";

const schema = z.object({
  phone: z.string().min(9, "Phone number too short"),
  code: z.string().min(1, "Verification code required"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

// Set a new password after proving control of the phone via SMS OTP issued by
// /api/auth/otp/send with purpose "reset".
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
    }

    const { code, password } = parsed.data;
    const phone = parsed.data.phone.trim();

    // No SMS rail for non-Ethiopian numbers means no way to prove ownership,
    // so there is no unverified path into this endpoint.
    if (!normalizePhone(phone)) {
      return NextResponse.json(
        { error: "Password reset is only available for Ethiopian numbers." },
        { status: 400 }
      );
    }

    const user = await prisma.user.findUnique({ where: { phone }, select: { id: true, isActive: true, role: true } });

    // Verify the code before checking the account so a wrong code always burns
    // an attempt — otherwise this becomes a phone-number oracle.
    const otp = await verifyOtp(phone, code);
    if (!otp.ok) return NextResponse.json({ error: otp.error }, { status: otp.status });

    // In-person agents' passwords are admin-managed (see otp/send).
    if (!user || !user.isActive || user.role === "IN_PERSON_AGENT") {
      return NextResponse.json({ error: "No account found for this number." }, { status: 404 });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await bcrypt.hash(password, 12) },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[auth/password/reset]", error);
    return NextResponse.json({ error: "Could not reset password" }, { status: 500 });
  }
}
