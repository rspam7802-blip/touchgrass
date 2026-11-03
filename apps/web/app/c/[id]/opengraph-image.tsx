import { strings } from '../../../lib/i18n';
import { OG_SIZE, ogCard } from '../../../lib/og-card';
import { fill, publicCrew } from '../../../lib/public-api';

export const size = OG_SIZE;
export const contentType = 'image/png';
export const alt = 'TouchGrass crew';

export default async function CrewOgImage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await publicCrew(id);
  const t = strings('en').share;
  return ogCard(
    c ? c.name : t.crewNotFound,
    c ? fill(t.crewMembers, { count: c.memberCount }) : t.crewBody,
  );
}
