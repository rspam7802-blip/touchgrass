import { describe, expect, it } from 'vitest';
import { customerAccessFor } from './schemas/customer';

describe('Customer 360 access (D-192)', () => {
  it('admins and super admins see everything', () => {
    expect(customerAccessFor(['admin'])).toBe('full');
    expect(customerAccessFor(['super_admin'])).toBe('full');
    expect(customerAccessFor(['support', 'admin'])).toBe('full');
  });

  it('support sees the lighter view', () => {
    expect(customerAccessFor(['support'])).toBe('support');
    expect(customerAccessFor(['support', 'moderator'])).toBe('support');
  });

  it('moderators, curators and members cannot open it', () => {
    expect(customerAccessFor(['moderator'])).toBeNull();
    expect(customerAccessFor(['city_curator'])).toBeNull();
    expect(customerAccessFor([])).toBeNull();
  });
});
