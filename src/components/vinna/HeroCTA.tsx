"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { ArrowRight } from "lucide-react";
import { useAuthModal } from "@/contexts/AuthModalContext";

/** Primary hero action: Deposit when logged in, Join (opens registration) when not. */
export function HeroCTA() {
  const { data: session } = useSession();
  const { openRegister } = useAuthModal();
  return session ? (
    <Link href="/deposit" className="v-btn v-btn-primary h-12 px-6">
      Deposit <ArrowRight className="w-4 h-4" />
    </Link>
  ) : (
    <button onClick={openRegister} className="v-btn v-btn-primary h-12 px-6">
      Join now <ArrowRight className="w-4 h-4" />
    </button>
  );
}
