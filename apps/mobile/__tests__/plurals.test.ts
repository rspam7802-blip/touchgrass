import { createI18n } from '../src/i18n/i18n';

describe('counts read naturally (one mutual, two mutuals)', () => {
  const en = createI18n('en');
  it.each([
    ['squad.mutuals', '1 mutual', '2 mutuals'],
    ['share.crewMembers', '1 member', '3 members'],
    ['lore.downloaded', 'Saved 1 photo', 'Saved 2 photos'],
    ['safety.sharedWith', 'Sent to 1 contact', 'Sent to 2 contacts'],
  ])('%s', (key, one, many) => {
    expect(en.t(key, { count: 1 })).toBe(one);
    expect(en.t(key, { count: Number(/\d+/.exec(many)?.[0]) })).toBe(many);
  });

  it('Telugu and Hindi have both forms too', () => {
    for (const lang of ['te', 'hi'] as const) {
      const i = createI18n(lang);
      expect(i.t('squad.mutuals', { count: 1 })).not.toContain('squad.');
      expect(i.t('squad.mutuals', { count: 4 })).toContain('4');
    }
  });
});
