import { NextResponse } from 'next/server';
import { liveView } from '../../../../lib/public-api';

/** Fresh live-location data for the viewer page's polling; never cached anywhere. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  const { token } = await params;
  const view = await liveView(token);
  return NextResponse.json(view, {
    status: view ? 200 : 404,
    headers: { 'cache-control': 'no-store', 'x-robots-tag': 'noindex' },
  });
}
