import { describe, expect, it } from 'vitest';
import { companyDetails, privacyPolicy, refundPolicy, termsOfUse } from './legal';

describe('legal pages', () => {
  it('reads company details from the environment, treating blanks as unset', () => {
    const c = companyDetails({
      SUPPORT_EMAIL: 'help@example.in',
      LEGAL_ENTITY_NAME: '  ',
      GRIEVANCE_OFFICER_NAME: 'A. Officer',
    });
    expect(c.entity).toBe('TouchGrass');
    expect(c.grievanceName).toBe('A. Officer');
    // Without a dedicated address, grievances go to support.
    expect(c.grievanceEmail).toBe('help@example.in');
  });

  it('every document has sections with text, and the policy names the grievance contact', () => {
    const c = companyDetails({ GRIEVANCE_OFFICER_EMAIL: 'grievance@example.in' });
    for (const doc of [privacyPolicy(c), termsOfUse(c), refundPolicy(c)]) {
      expect(doc.sections.length).toBeGreaterThan(0);
      for (const s of doc.sections) expect(s.paragraphs.join('').length).toBeGreaterThan(0);
    }
    expect(JSON.stringify(privacyPolicy(c))).toContain('grievance@example.in');
  });
});
