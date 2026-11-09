import { BRAND } from '@touchgrass/shared';
import type { Metadata } from 'next';
import { LegalPage } from '../../lib/legal-page';
import { companyDetails, termsOfUse } from '../../lib/legal';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: `Terms of use · ${BRAND.name}` };

export default function TermsPage() {
  return <LegalPage doc={termsOfUse(companyDetails())} />;
}
