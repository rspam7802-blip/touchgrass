import { describe, expect, it } from 'vitest';
import { normaliseText, screenText, screenTexts } from './text-filter';

describe('text filter (F-SAF-06)', () => {
  it('lets ordinary text through, including words that merely contain a bad one', () => {
    for (const ok of [
      '',
      'Sunday run at KBR park, chai after!',
      'Scunthorpe assessment cocktail',
      'chod do yaar, kal milte hain',
      'gudda aur guddi ki shaadi',
      'బిర్యానీ తిందాం',
      'चलो पार्क चलते हैं',
    ])
      expect(screenText(ok)).toEqual({ flagged: false, severity: null, matches: [] });
  });

  it('catches profanity in English, Hinglish, Tenglish and native scripts', () => {
    expect(screenText('what the fuck')).toMatchObject({ flagged: true, severity: 'medium' });
    expect(screenText('abe chutiya')).toMatchObject({ severity: 'medium', matches: ['chutiya'] });
    expect(screenText('ఎర్రిపూకు')).toMatchObject({ severity: 'medium' });
    expect(screenText('हरामी')).toMatchObject({ severity: 'medium' });
    expect(screenText('nuvvu dengu')).toMatchObject({ severity: 'medium' });
  });

  it('defeats stretched letters, look-alike digits, case and zero-width characters', () => {
    expect(screenText('FUUUUCK')).toMatchObject({ flagged: true });
    expect(screenText('sh1t')).toMatchObject({ flagged: true });
    expect(screenText('b!tch')).toMatchObject({ flagged: true });
    expect(screenText('f​uck')).toMatchObject({ flagged: true });
    expect(normaliseText('A$$hole 4 ever')).toBe('ashole a ever');
  });

  it('slurs and threats are high severity and outrank profanity', () => {
    expect(screenText('shit, lanja')).toMatchObject({ severity: 'high' });
    expect(screenText('lanja shit')).toMatchObject({ severity: 'high' });
    expect(screenText('I will kill you tomorrow')).toMatchObject({
      severity: 'high',
      matches: ['i wil kil you'],
    });
    expect(screenText('nee champestha ra')).toMatchObject({ severity: 'high' });
    expect(screenText('skill yourself up').flagged).toBe(false);
  });

  it('catches plurals without catching ordinary words that end in s', () => {
    expect(screenText('Zero patience for haramis')).toMatchObject({
      severity: 'medium',
      matches: ['harami'],
    });
    expect(screenText('those bitches')).toMatchObject({ matches: ['bitch'] });
    expect(screenText('this is classes and buses').flagged).toBe(false);
  });

  it('reports each match once', () => {
    expect(screenText('shit shit SHIT').matches).toEqual(['shit']);
  });

  it('screens several fields with the worst severity winning', () => {
    expect(screenTexts('Board games', null, undefined)).toEqual({
      flagged: false,
      severity: null,
      matches: [],
    });
    expect(screenTexts('shit', 'nice')).toMatchObject({ severity: 'medium', matches: ['shit'] });
    expect(screenTexts('shit', 'kys')).toMatchObject({
      severity: 'high',
      matches: ['shit', 'kys'],
    });
  });
});
