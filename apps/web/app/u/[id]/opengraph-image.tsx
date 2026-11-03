import { strings } from '../../../lib/i18n';
import { OG_SIZE, ogCard } from '../../../lib/og-card';
import { fill, publicProfile } from '../../../lib/public-api';

export const size = OG_SIZE;
export const contentType = 'image/png';
export const alt = 'TouchGrass profile';

export default async function ProfileOgImage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = await publicProfile(id);
  const t = strings('en').share;
  return ogCard(
    p ? fill(t.profileTitle, { name: p.displayName }) : t.profileNotFound,
    t.profileBody,
  );
}
