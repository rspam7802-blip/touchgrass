import { BRAND } from '@touchgrass/shared';
import type { Metadata } from 'next';
import { LegalPage } from '../../lib/legal-page';
import { companyDetails, privacyPolicy } from '../../lib/legal';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: `Privacy policy · ${BRAND.name}` };

export default function PrivacyPage() {
  return <LegalPage doc={privacyPolicy(companyDetails())} />;
}
