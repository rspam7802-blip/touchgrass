import { strings } from '../../../lib/i18n';
import { OG_SIZE, ogCard } from '../../../lib/og-card';
import { fill, formatWhen, publicEvent } from '../../../lib/public-api';

export const size = OG_SIZE;
export const contentType = 'image/png';
export const alt = 'TouchGrass plan';

/** A readable card for plans without a cover (and the teaser for invite-only ones), never the exact spot. */
export default async function PlanOgImage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const e = await publicEvent(slug);
  const t = strings('en').share;
  if (!e) return ogCard(t.notFoundTitle, t.notFoundBody);
  if (e.access === 'teaser')
    return ogCard(fill(t.privateTitle, { name: e.hostName }), formatWhen(e.startsAt, 'en'));
  const area = e.areaName ?? 'Hyderabad';
  return ogCard(
    e.title,
    `${formatWhen(e.startsAt, 'en')} · ${e.mystery ? fill(t.mysteryArea, { area }) : area}`,
  );
}
