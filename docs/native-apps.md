# VinnaBet native apps (iOS and Android)

The iOS and Android apps are Capacitor shells around the live site. They load
`https://vinna.bet` in a native WebView, so login, wallet, deposits,
withdrawals, sportsbook, bets, casino/Octhera games, tickets, Check Ticket,
rewards and every API route are the ones Railway already serves. A website
deploy updates the apps too. A store release is only needed when native code,
permissions, icons or plugins change.

| Piece | Where |
|---|---|
| Capacitor config (server URL, splash, bars, push) | `capacitor.config.ts` |
| Xcode project | `ios/App/App.xcodeproj` (Swift Package Manager, no CocoaPods) |
| Android Studio project | `android/` |
| Offline / load-error page shipped in the app | `native/www/offline.html` |
| Icon and splash sources | `assets/` (regenerate with `npm run cap:assets`) |
| Web side of the bridge | `src/components/native/NativeBridge.tsx`, `src/lib/native.ts` |
| App push sender (APNs + FCM) | `src/lib/nativePush.ts`, `POST/DELETE /api/user/push/native` |
| Deep-link verification files | `src/app/.well-known/*` |
| Update policy | `GET /api/app/version`, `src/lib/appVersion.ts` |

## Requirements

- Node 22+ (Capacitor 8 CLI).
- iOS: a Mac with Xcode 26+, an Apple Developer account. iOS 15+ devices.
- Android: Android Studio (Narwhal or newer), JDK 21, Android SDK 36. Android 7+ (API 24) devices.

## Build and run

```bash
npm install
npm run cap:ios       # syncs, then opens Xcode
npm run cap:android   # syncs, then opens Android Studio
```

In Xcode: select the **App** target, set your Team under Signing & Capabilities, pick a device, Run.
Archive (Product → Archive) to upload to App Store Connect / TestFlight.

In Android Studio: Run on a device, or Build → Generate Signed Bundle/APK for a release `.aab` (Play) or `.apk` (direct download).

Point an app build at another server (staging, or `next dev` on your LAN):

```bash
CAP_SERVER_URL=http://192.168.1.10:3000 npx cap sync
```

Run `npx cap sync` again with no variable before a release build.

## What the native layer does

- **Safe areas / system bars.** The site's header is `fixed top-0` and the sportsbook pane is pinned below it, so the apps keep web content below the status bar natively (`MainViewController` on iOS, the insets listener in `MainActivity` on Android) instead of changing the site's CSS. The iOS home indicator area is handled by the bottom nav's existing `env(safe-area-inset-bottom)`. Android pads for the status bar, navigation bar, display cutout and keyboard. Bars are navy with light icons.
- **Splash.** Navy with the V mark. It is hidden as soon as the site mounts, or after 8s if the site never loads.
- **Camera.** The Check Ticket scanner keeps using its web ZXing code. iOS has `NSCameraUsageDescription`; Android has the `CAMERA` permission, requested the first time the scanner opens.
- **Printing.** `window.print()` does nothing in WebViews. In the app it goes to the native print dialog, which renders the page with the existing print stylesheet, so the receipt still prints on its own.
- **Back button (Android).** It closes an open overlay first (scanner, login, legacy game player, search, sheets), then goes back in page history, then returns to the casino, then exits from the home tabs.
- **Offline.** If there is no connection at launch, the app shows `offline.html`, which reconnects automatically. If the connection drops mid-session, a full-screen "You're offline" cover appears and lifts when the connection returns.
- **External links.** Telegram, ads, store links and any other host open in the system browser or app. Other `vinna.bet` hosts stay in the app.
- **Third-party cookies.** Android allows them for the sportsbook and game iframes. iOS cannot (WebKit ITP).
- **Install banner.** The PWA "Add to Home Screen" banner is hidden inside the app.

## Push notifications

Web Push doesn't work in app WebViews, so the apps register native tokens.
`sendPushToUser` (deposit confirmed, etc.) now sends to browsers and apps.
Players turn it on with the existing Notifications toggle on the account page.
Tokens follow sign-in, and are removed on sign-out.

**iOS (APNs, no Firebase needed).**
1. Apple Developer → Keys → create a key with Apple Push Notifications service. Download the `.p8`.
2. In Xcode, the target already has the Push Notifications entitlement (`App.entitlements`). Make sure the App ID has Push enabled.
3. Railway variables: `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_PRIVATE_KEY` (the `.p8` contents; `\n` escapes are fine). Optional `APNS_BUNDLE_ID` (default `com.vinnabet.app`).

**Android (Firebase Cloud Messaging).**
1. Firebase console → add an Android app with package `com.vinnabet.app` → download `google-services.json` into `android/app/`.
   Without it the app still runs, and the notifications toggle is hidden.
2. Firebase → Project settings → Service accounts → Generate new private key.
3. Railway variable `FCM_SERVICE_ACCOUNT` = that JSON on one line.

Then run `npx prisma migrate deploy` (the Docker start command already does) for the `native_push_tokens` table.

## Deep links

- Universal links / App Links: `https://vinna.bet/...` and `https://www.vinna.bet/...` open the app at that page. Staff portals (`/admin`, `/payout`, `/in-person-agent`) and `/api` stay in the browser on iOS.
- Custom scheme: `vinnabet://tickets/ABC` opens `/tickets/ABC`.
- Railway variables:
  - `APPLE_TEAM_ID`: your 10-character Team ID. It is served in `/.well-known/apple-app-site-association`.
  - `ANDROID_CERT_SHA256`: the signing certificate SHA-256 fingerprint(s), comma-separated. Use the Play app-signing key and your upload key. It is served in `/.well-known/assetlinks.json`.

## Versions and updates

- Bump the native version for each store release: `MARKETING_VERSION` / `CURRENT_PROJECT_VERSION` in Xcode, and `versionName` / `versionCode` in `android/app/build.gradle`.
- On launch the app compares its version with `GET /api/app/version`:
  - Below `APP_IOS_MIN_VERSION` / `APP_ANDROID_MIN_VERSION`, a blocking "Update VinnaBet" screen is shown.
  - Below `APP_IOS_LATEST_VERSION` / `APP_ANDROID_LATEST_VERSION`, a dismissible "new version" bar is shown.
  - The "Update" button opens `APP_IOS_STORE_URL` / `APP_ANDROID_STORE_URL`. For a direct Android download, this can be the APK URL.
  - With nothing set, no check runs.

## Store notes

- Apple only accepts real-money gambling apps from the licensed operator's **organization** developer account, geo-restricted to licensed regions (App Review 5.3). Pure website wrappers risk a 4.2 "minimum functionality" rejection. Native push, scanning, printing and offline handling help there.
- Google Play lists real-money gambling apps only for licensed operators in approved countries. Where that doesn't apply, distribute the signed APK directly (Android "install unknown apps").

## Test checklist on real devices

1. Login, logout and login again. Balance shows and updates after a deposit.
2. Deposit and withdrawal flows.
3. Sportsbook tab: BetBy loads, a bet places, and the bet shows in ticket history. **On iOS check that BetBy stays logged in** (iframe cookies).
4. Open several Octhera games. Confirm they render in the iframe (framing headers) and that wins/bets hit the balance.
5. Check Ticket: the camera prompt appears, a printed barcode scans, and back closes the scanner.
6. Print ticket: the native print dialog shows the receipt only.
7. Rewards, account, push toggle, and a test deposit push. Tap the notification and it opens the dashboard.
8. Airplane mode at launch and mid-session.
9. A `https://vinna.bet/tickets/...` link from Notes/Telegram opens the app.
10. Android: back button through overlays, pages and exit. Rotate during a game.
