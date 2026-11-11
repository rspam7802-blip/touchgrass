/** Store buttons, each shown only when its URL is configured (NEXT_PUBLIC_PLAY_STORE_URL / _APP_STORE_URL). */
export function StoreLinks({
  playUrl,
  appStoreUrl,
}: {
  playUrl: string | null;
  appStoreUrl: string | null;
}) {
  if (!playUrl && !appStoreUrl) return null;
  return (
    <div className="flex flex-wrap gap-3">
      {playUrl ? (
        <a
          href={playUrl}
          className="inline-flex min-h-11 items-center rounded-full bg-primary px-6 py-3 font-bold text-on-primary"
        >
          Google Play
        </a>
      ) : null}
      {appStoreUrl ? (
        <a
          href={appStoreUrl}
          className="inline-flex min-h-11 items-center rounded-full bg-accent px-6 py-3 font-bold text-on-accent"
        >
          App Store
        </a>
      ) : null}
    </div>
  );
}
