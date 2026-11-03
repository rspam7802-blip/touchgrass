/**
 * Android App Links verification (F-EVT-17). ANDROID_SHA256_CERT_FINGERPRINTS is a comma-separated list
 * from Play Console → App integrity → App signing (plus the upload key for internal builds).
 */
export function GET(): Response {
  const fingerprints = (process.env.ANDROID_SHA256_CERT_FINGERPRINTS ?? '')
    .split(',')
    .map((f) => f.trim())
    .filter((f) => f.length > 0);
  const body =
    fingerprints.length === 0
      ? []
      : [
          {
            relation: ['delegate_permission/common.handle_all_urls'],
            target: {
              namespace: 'android_app',
              package_name: process.env.ANDROID_PACKAGE ?? 'app.touchgrass',
              sha256_cert_fingerprints: fingerprints,
            },
          },
        ];
  return Response.json(body, { headers: { 'Cache-Control': 'public, max-age=3600' } });
}
