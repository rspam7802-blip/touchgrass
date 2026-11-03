import type { Translation } from '@touchgrass/shared';

/** "Open in app" (custom scheme fallback for when universal links are not intercepted) plus store links. */
export function AppLinks({ deepLink, t }: { deepLink: string; t: Translation['share'] }) {
  const playUrl = process.env.NEXT_PUBLIC_PLAY_STORE_URL;
  const appStoreUrl = process.env.NEXT_PUBLIC_APP_STORE_URL;
  return (
    <div className="flex flex-col gap-3">
      <a
        href={deepLink}
        className="min-h-11 rounded-full bg-primary px-6 py-3 text-center font-bold text-on-primary"
      >
        {t.openInApp}
      </a>
      <p className="text-sm text-muted">{t.getApp}</p>
      <div className="flex flex-wrap gap-3">
        {playUrl ? (
          <a
            href={playUrl}
            className="min-h-11 rounded-full border-2 border-border px-5 py-2 font-semibold"
          >
            Google Play
          </a>
        ) : null}
        {appStoreUrl ? (
          <a
            href={appStoreUrl}
            className="min-h-11 rounded-full border-2 border-border px-5 py-2 font-semibold"
          >
            App Store
          </a>
        ) : null}
      </div>
    </div>
  );
}
