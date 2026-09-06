import { describe, it, expect } from 'vitest';
import { normalise, searchRegions, orphanSynonyms } from './search';
import { SYNONYMS } from './synonyms';
import { REGIONS } from './regions.gen';

describe('normalise', () => {
  it('folds case, accents and punctuation', () => {
    expect(normalise('  Lower-Back!! ')).toBe('lower back');
    expect(normalise('Achilles’ Tendon')).toBe('achilles tendon');
  });

  it('strips Arabic tashkeel and tatweel', () => {
    // أَسْفَل الظَّهْر with harakat -> bare form
    expect(normalise('أَسْفَل الظَّهْر')).toBe(normalise('اسفل الظهر'));
    expect(normalise('كــــتف')).toBe('كتف');
  });

  it('folds Arabic alef, ya, ta-marbuta and hamza variants', () => {
    expect(normalise('أسفل')).toBe(normalise('اسفل'));
    expect(normalise('إبهام')).toBe(normalise('ابهام'));
    expect(normalise('ركبى')).toBe(normalise('ركبي'));
    expect(normalise('ربلة')).toBe(normalise('ربله'));
  });

  it('folds Arabic-Indic digits', () => {
    expect(normalise('٥')).toBe('5');
  });
});

describe('searchRegions', () => {
  it('ignores queries shorter than two characters', () => {
    expect(searchRegions('a')).toEqual([]);
    expect(searchRegions('')).toEqual([]);
  });

  it('finds the lower back by patient vocabulary', () => {
    for (const q of ['lower back', 'low back', 'small of my back', 'lumbar']) {
      const hits = searchRegions(q);
      expect(hits.length, `no hit for "${q}"`).toBeGreaterThan(0);
      expect(hits[0].region.id, `wrong top hit for "${q}"`).toBe('lumbar_spine');
    }
  });

  it('finds regions by Arabic terms even in EN mode', () => {
    expect(searchRegions('أسفل الظهر')[0].region.id).toBe('lumbar_spine');
    expect(searchRegions('ركبة')[0].region.group).toBe('lower_limb');
    expect(searchRegions('كتف').length).toBeGreaterThan(0);
  });

  it('finds Arabic terms typed without hamza (the common failure)', () => {
    expect(searchRegions('اسفل الظهر')[0].region.id).toBe('lumbar_spine');
  });

  it('resolves side-qualified queries to the correct side', () => {
    expect(searchRegions('left knee')[0].region.side).toBe('left');
    expect(searchRegions('right shoulder')[0].region.side).toBe('right');
  });

  it('matches colloquial terms the anatomical labels do not contain', () => {
    expect(searchRegions('shin')[0].region.id).toMatch(/_shin$/);
    expect(searchRegions('tailbone')[0].region.id).toBe('sacrum_si');
    expect(searchRegions('kneecap')[0].region.id).toMatch(/knee_anterior$/);
    expect(searchRegions('calf').length).toBeGreaterThan(0);
  });

  it('returns nothing for a query that matches no known term', () => {
    // R1: no fuzzy inference — an unknown word yields an honest empty result
    expect(searchRegions('zzzzqqq')).toEqual([]);
  });

  it('respects the limit and returns ranked, deduped regions', () => {
    const hits = searchRegions('shoulder', 'en', 5);
    expect(hits.length).toBeLessThanOrEqual(5);
    const ids = hits.map((h) => h.region.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (let i = 1; i < hits.length; i++) {
      expect(hits[i - 1].score).toBeGreaterThanOrEqual(hits[i].score);
    }
  });
});

describe('synonym integrity', () => {
  it('has no synonyms pointing at regions that do not exist in the mesh', () => {
    expect(orphanSynonyms()).toEqual([]);
  });

  it('covers every major body area a patient is likely to search', () => {
    const mustFind = [
      'neck', 'shoulder', 'elbow', 'wrist', 'hand', 'upper back',
      'lower back', 'hip', 'knee', 'ankle', 'foot', 'calf', 'thigh',
    ];
    for (const q of mustFind) {
      expect(searchRegions(q).length, `no region found for "${q}"`).toBeGreaterThan(0);
    }
  });

  it('gives every region at least one way to be found', () => {
    const reachable = new Set<string>();
    for (const r of REGIONS) {
      if (searchRegions(r.label).some((h) => h.region.id === r.id)) reachable.add(r.id);
    }
    const unreachable = REGIONS.filter((r) => !reachable.has(r.id)).map((r) => r.id);
    expect(unreachable).toEqual([]);
  });

  it('is seeded, not yet clinician-reviewed (guards against silent promotion)', () => {
    // Flips to 'reviewed' only when the clinician signs the list off.
    expect(SYNONYMS.every((s) => s.status === 'seed')).toBe(true);
  });
});
