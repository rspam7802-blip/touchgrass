/**
 * iOS universal links (F-EVT-17): plan, profile and crew shares, +1 claim and invite links open the app when installed.
 * APPLE_TEAM_ID comes from developer.apple.com → Membership; without it no app is associated.
 */
export function GET(): Response {
  const team = process.env.APPLE_TEAM_ID;
  const bundle = process.env.IOS_BUNDLE_ID ?? 'app.touchgrass';
  const details = team
    ? [
        {
          appIDs: [`${team}.${bundle}`],
          components: [
            { '/': '/e/*' },
            { '/': '/u/*' },
            { '/': '/c/*' },
            { '/': '/claim/*' },
            { '/': '/invite/*' },
          ],
        },
      ]
    : [];
  return Response.json(
    { applinks: { details } },
    { headers: { 'Cache-Control': 'public, max-age=3600' } },
  );
}
