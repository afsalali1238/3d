import { describe, it, expect } from 'vitest';
import { scanText, scanAll, formatHits } from './compliance';
import { SYNONYMS } from '../components/body/synonyms';
import { REGIONS } from '../components/body/regions.gen';

describe('compliance scanner', () => {
  it('catches condition names', () => {
    expect(scanText('t', 'sciatica').length).toBe(1);
    expect(scanText('t', 'exercises for frozen shoulder').length).toBe(1);
    expect(scanText('t', 'plantar fasciitis relief').length).toBeGreaterThan(0);
  });

  it('catches Arabic condition names', () => {
    expect(scanText('t', 'عرق النسا').length).toBe(1);
    expect(scanText('t', 'انزلاق غضروفي').length).toBe(1);
  });

  it('catches treatment and superlative advertising claims', () => {
    expect(scanText('t', 'guaranteed results').length).toBe(1);
    expect(scanText('t', 'the best physiotherapist in Dubai').length).toBe(1);
  });

  it('does not fire on plain anatomy', () => {
    expect(scanText('t', 'lower back')).toEqual([]);
    expect(scanText('t', 'outer shoulder')).toEqual([]);
    expect(scanText('t', 'أسفل الظهر')).toEqual([]);
  });

  it('respects word boundaries', () => {
    // "strain" is banned; "restrained" must not trigger it
    expect(scanText('t', 'restrained movement')).toEqual([]);
  });

  it('formats a readable report', () => {
    expect(formatHits([])).toBe('compliance: clean');
    expect(formatHits(scanText('synonyms.ts', 'sciatica'))).toContain('sciatica');
  });
});

/**
 * The real gate: everything currently patient-visible must be clean.
 * This is the test that stops "sciatica -> lower back" being added for SEO.
 */
describe('patient-visible text is condition-free', () => {
  it('region labels (EN + AR) contain no condition names', () => {
    const records = REGIONS.flatMap((r) => [
      { source: `regions.gen.ts:${r.id}:label`, text: r.label },
      ...(r.labelAr ? [{ source: `regions.gen.ts:${r.id}:labelAr`, text: r.labelAr }] : []),
    ]);
    const hits = scanAll(records);
    expect(formatHits(hits)).toBe('compliance: clean');
  });

  it('region synonyms contain no condition names', () => {
    const hits = scanAll(
      SYNONYMS.map((s) => ({ source: `synonyms.ts:${s.regionId}`, text: s.term })),
    );
    expect(formatHits(hits)).toBe('compliance: clean');
  });
});
