/**
 * Architectural invariants enforced by source inspection.
 *
 * These are the rules that are easy to state, easy to violate accidentally,
 * and expensive to discover in production. Grep-based tests are crude but
 * they catch the exact regression that matters: someone wiring patient data
 * to a network call, or shipping placeholder content as real.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(p)) out.push(p);
  }
  return out;
}

const SRC = walk('src');
const read = (p: string) => readFileSync(p, 'utf8');

describe('no BMI on the clinical path', () => {
  it('never computes or displays BMI', () => {
    const offenders: string[] = [];
    for (const p of SRC.filter((f) => !f.endsWith('.test.ts'))) {
      const src = read(p);
      if (/\bBMI\b|\bbmi\b/.test(src)) offenders.push(p);
    }
    expect(offenders).toEqual([]);
  });
});

describe('R5 — patient data never leaves the device', () => {
  const patientFiles = SRC.filter(
    (p) => /guided|content/.test(p) && !p.endsWith('.test.ts'),
  );

  it('no network calls in profile / content / guided-flow code', () => {
    const offenders: string[] = [];
    for (const p of patientFiles) {
      const src = read(p);
      for (const bad of ['fetch(', 'XMLHttpRequest', 'sendBeacon', 'axios', 'navigator.geolocation']) {
        if (src.includes(bad)) offenders.push(`${p} contains ${bad}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('only writes localStorage keys under the bv. namespace', () => {
    const keys: string[] = [];
    for (const p of SRC) {
      for (const m of read(p).matchAll(/localStorage\.setItem\(\s*([A-Za-z_]+|'[^']*')/g)) {
        keys.push(m[1]);
      }
    }
    // writes go through PROFILE_KEY, a 'bv.*' literal, or the storage helper's `key` param
    for (const k of keys) {
      expect(
        k === 'PROFILE_KEY' || k === 'MODE_KEY' || k === 'key' || k.startsWith("'bv."),
        `unexpected storage key: ${k}`,
      ).toBe(true);
    }
  });

  it('no analytics or tracking imports anywhere', () => {
    const banned = ['gtag', 'google-analytics', 'mixpanel', 'segment.com', 'posthog', 'hotjar'];
    const offenders: string[] = [];
    // exclude test files — this file necessarily contains the banned strings
    for (const p of SRC.filter((f) => !f.endsWith('.test.ts'))) {
      const src = read(p).toLowerCase();
      for (const b of banned) if (src.includes(b)) offenders.push(`${p}: ${b}`);
    }
    expect(offenders).toEqual([]);
  });
});

describe('placeholder containment', () => {
  it('PLACEHOLDER signatures exist in exactly one source file', () => {
    const files = SRC.filter(
      (p) => !p.endsWith('.test.ts') && read(p).includes("reviewedBy: 'PLACEHOLDER'"),
    );
    expect(files).toEqual(['src/content/placeholder.ts']);
  });

  it('placeholder.ts is clearly marked as non-clinical', () => {
    const src = read('src/content/placeholder.ts');
    expect(src).toContain('NOT CLINICAL ADVICE');
    expect(src).toContain('PLACEHOLDER');
  });

  it('the UI badges any content signed PLACEHOLDER', () => {
    const gf = read('src/components/guided/GuidedFlow.tsx');
    expect(gf).toContain('PLACEHOLDER_SIGNATURE');
    expect(gf).toContain('gf-demo');
  });
});

describe('R2 — one render gate', () => {
  it('components never import raw content bundles directly for rendering', () => {
    // GuidedFlow must go through resolveOutcome / questionsFor, never filter
    // the arrays itself.
    const gf = read('src/components/guided/GuidedFlow.tsx');
    expect(gf).toContain('resolveOutcome');
    expect(gf).not.toMatch(/bundle\.exercises\.filter/);
    expect(gf).not.toMatch(/status === 'published'/);
  });
});

describe('the sheet is the source of truth', () => {
  it('the app imports the generated bundle, not the placeholder module', () => {
    const app = read('src/components/journey/Journey.tsx');
    expect(app).toContain("from '../../content/bundle.gen'");
    expect(app).toMatch(/import \{ PLACEHOLDER_SIGNATURE \}/);
    expect(app).not.toContain('placeholderContent');
  });

  it('bundle.gen.ts is generated, not hand-edited', () => {
    const gen = read('src/content/bundle.gen.ts');
    expect(gen).toContain('AUTO-GENERATED');
    expect(gen).toContain('npm run content:build');
  });

  it('placeholder.ts is only referenced by tooling and tests, never by UI', () => {
    const ui = SRC.filter(
      (p) => /components\//.test(p) && !p.endsWith('.test.ts') && read(p).includes('content/placeholder'),
    );
    // GuidedFlow may import the SIGNATURE constant for badging, nothing else
    for (const p of ui) {
      expect(read(p)).toMatch(/import \{ PLACEHOLDER_SIGNATURE \}/);
    }
  });
});
