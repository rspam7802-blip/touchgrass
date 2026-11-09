import { BRAND } from '@touchgrass/shared';
import type { Metadata } from 'next';
import { companyDetails } from '../../lib/legal';
import { LegalPage } from '../../lib/legal-page';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: `Contact · ${BRAND.name}` };

/** Contact details and the Grievance Officer (IT Rules 2021, DPDP Act 2023). */
export default function ContactPage() {
  const c = companyDetails();
  const mail = (email: string) => (
    <a className="font-semibold text-primary underline" href={`mailto:${email}`}>
      {email}
    </a>
  );
  return (
    <LegalPage
      doc={{
        title: 'Contact and grievances',
        updated: '9 November 2026',
        intro: `${BRAND.name} is operated by ${c.entity}. In the app, Settings has help, reporting and safety tools; for anything else, write to us.`,
        sections: [],
      }}
    >
      <section aria-labelledby="contact-support" className="flex flex-col gap-2">
        <h2 id="contact-support" className="text-xl font-bold">
          Support
        </h2>
        {c.supportEmail ? <p data-testid="contact-support">{mail(c.supportEmail)}</p> : null}
        {c.address ? <p className="whitespace-pre-line">{c.address}</p> : null}
      </section>
      <section aria-labelledby="contact-grievance" className="flex flex-col gap-2">
        <h2 id="contact-grievance" className="text-xl font-bold">
          Grievance Officer
        </h2>
        <p>
          For complaints about content, your account, safety or your personal data. We acknowledge
          within 24 hours and resolve within 15 days.
        </p>
        {c.grievanceName ? <p data-testid="grievance-name">{c.grievanceName}</p> : null}
        {c.grievanceEmail ? <p data-testid="grievance-email">{mail(c.grievanceEmail)}</p> : null}
      </section>
    </LegalPage>
  );
}
