/** The Telegram Mini App bridge (telegram-web-app.js), when we run inside Telegram. */
interface WebApp {
  initData: string;
  ready(): void;
  expand(): void;
  openLink(url: string): void;
  openTelegramLink(url: string): void;
}

export function miniApp(): WebApp | null {
  const w = (window as unknown as { Telegram?: { WebApp?: WebApp } }).Telegram?.WebApp;
  return w && w.initData ? w : null;
}

/** Open a URL: inside Telegram via its in-app browser, on the web in a new tab. */
export function openUrl(url: string) {
  const app = miniApp();
  if (app) {
    if (url.startsWith("https://t.me/")) app.openTelegramLink(url);
    else window.location.href = url;
  } else {
    window.open(url, "_blank", "noopener");
  }
}
