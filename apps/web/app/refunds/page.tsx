import { BRAND } from '@touchgrass/shared';
import type { Metadata } from 'next';
import { LegalPage } from '../../lib/legal-page';
import { companyDetails, refundPolicy } from '../../lib/legal';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: `Refund policy · ${BRAND.name}` };

export default function RefundsPage() {
  return <LegalPage doc={refundPolicy(companyDetails())} />;
}
