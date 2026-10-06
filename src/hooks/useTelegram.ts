"use client";

import { useSyncExternalStore } from "react";
import { inTelegramContext, subscribeTelegram } from "@/lib/telegramWebApp";

/** True inside the Telegram Mini App. False on the server and in browsers. */
export function useInTelegram(): boolean {
  return useSyncExternalStore(subscribeTelegram, inTelegramContext, () => false);
}
