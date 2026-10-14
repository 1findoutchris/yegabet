import type { Metadata } from "next";
import { Suspense } from "react";
import { MiniApp } from "@/components/telegram/MiniApp";

// The Telegram Mini App's entry point — set as the bot's menu button and every
// web_app button (lib/tgBot.miniAppUrl). Not a page for search engines.
export const metadata: Metadata = {
  title: "YegaBet",
  robots: { index: false, follow: false },
};

export default function TelegramMiniAppPage() {
  // Public by nature (it's in every t.me link); used for the "open in
  // Telegram" button when this page is visited from a normal browser.
  const bot = (process.env.TELEGRAM_VERIFY_BOT_USERNAME ?? "").replace(/^@/, "") || null;
  return (
    <Suspense>
      <MiniApp botUsername={bot} />
    </Suspense>
  );
}
