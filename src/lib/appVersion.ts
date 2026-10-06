/*
 * Native app version policy. The apps load the live site, so most changes ship
 * without a store release; these settings are for the times a new native
 * build is needed (new plugin, permission, icon). Set on Railway:
 *
 *   APP_IOS_MIN_VERSION / APP_ANDROID_MIN_VERSION        older builds are blocked
 *   APP_IOS_LATEST_VERSION / APP_ANDROID_LATEST_VERSION  older builds get a nudge
 *   APP_IOS_STORE_URL / APP_ANDROID_STORE_URL            where "Update" goes
 *
 * Unset means no check for that platform.
 */

export type AppPlatform = "ios" | "android";

export interface AppVersionPolicy {
  minVersion: string | null;
  latestVersion: string | null;
  storeUrl: string | null;
}

export type UpdateState = "required" | "available" | "current";

/** Compares dotted numeric versions ("1.10.0" > "1.9.3"). Missing parts are 0. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

export function updateState(installed: string, policy: AppVersionPolicy): UpdateState {
  if (policy.minVersion && compareVersions(installed, policy.minVersion) < 0) return "required";
  if (policy.latestVersion && compareVersions(installed, policy.latestVersion) < 0) return "available";
  return "current";
}

export function versionPolicy(platform: AppPlatform, env: Record<string, string | undefined> = process.env): AppVersionPolicy {
  const p = platform.toUpperCase();
  return {
    minVersion: env[`APP_${p}_MIN_VERSION`] || null,
    latestVersion: env[`APP_${p}_LATEST_VERSION`] || null,
    storeUrl: env[`APP_${p}_STORE_URL`] || null,
  };
}
