import type { CapacitorConfig } from "@capacitor/cli";

/*
 * Native iOS/Android shell for VinnaBet (see docs/native-apps.md).
 *
 * The apps load the live site, so auth, wallet, bets, games and every API
 * route are exactly the ones Railway serves. Only the shell, icons, splash and
 * the offline page in native/www ship inside the app binary.
 *
 * CAP_SERVER_URL lets a build point at staging (or a LAN dev server) without
 * editing this file: `CAP_SERVER_URL=http://192.168.1.10:3000 npx cap sync`.
 */
const SERVER_URL = process.env.CAP_SERVER_URL ?? "https://vinna.bet";
const cleartext = SERVER_URL.startsWith("http://");

const NAVY = "#0A1222"; // viewport themeColor in src/app/layout.tsx

const config: CapacitorConfig = {
  appId: "com.vinnabet.app",
  appName: "VinnaBet",
  webDir: "native/www",
  backgroundColor: NAVY,
  // Lets the server and analytics tell app traffic from browsers.
  appendUserAgent: "VinnaBetApp",
  server: {
    url: SERVER_URL,
    cleartext,
    // Shown by the native shell when the site can't be reached at launch.
    errorPath: "offline.html",
    // Other vinna.bet hosts stay in the app; every other host opens in the
    // system browser (Telegram, ads, store links).
    allowNavigation: ["vinna.bet", "*.vinna.bet"],
  },
  ios: {
    // Web content sits below the status bar (MainViewController), so the
    // WebView must not add its own insets on top.
    contentInset: "never",
  },
  android: {
    // Chrome DevTools for the WebView only when pointed at a dev server.
    webContentsDebuggingEnabled: cleartext,
  },
  plugins: {
    SplashScreen: {
      // Hidden by the web app as soon as it mounts (NativeBridge); the timer
      // is only a fallback for when the site never loads.
      launchAutoHide: true,
      launchShowDuration: 8000,
      launchFadeOutDuration: 250,
      backgroundColor: NAVY,
      showSpinner: false,
      androidScaleType: "CENTER_CROP",
      splashFullScreen: false,
      splashImmersive: false,
    },
    SystemBars: {
      // MainActivity pads the WebView by the system bars itself, so the site's
      // fixed header and bottom nav never sit under them.
      insetsHandling: "disable",
      style: "DARK",
    },
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"],
    },
  },
};

export default config;
