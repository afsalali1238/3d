/**
 * Region search — patient-vocabulary lookup over the 81 anatomical regions.
 *
 * Pure data + pure functions, no React, no Three.js. Imported by the app
 * layer (and by tests) without pulling in the 3D bundle.
 *
 * Ranking is lexical and deterministic. There is deliberately NO fuzzy
 * scoring, no ML, no "closest match" inference — a query either matches a
 * known term or it does not. (See IMPLEMENTATION-PLAN.md R1.)
 */
import { REGIONS } from './regions.gen';
import { SYNONYMS } from './synonyms';
import type { BodyRegion, Locale } from './types';

/* ----------------------------------------------------------- normalisation */

/**
 * Fold a query or term into its comparable form.
 *
 * Latin: lowercase, strip accents, collapse punctuation/whitespace.
 * Arabic: strip tashkeel (harakat) and tatweel, then fold the orthographic
 * variants patients actually type — alef forms (أ إ آ ا ٱ) to ا, ya/alef
 * maqsura (ي ى) to ي, ta marbuta (ة) to ه, hamza carriers (ؤ ئ) to ء.
 * Arabic-Indic digits fold to ASCII.
 *
 * Without this, "ألم" typed with a bare alef never matches a term stored
 * with hamza — the single most common Arabic search failure.
 */
export function normalise(input: string): string {
  if (!input) return '';
  let s = input.normalize('NFKD');

  // strip Latin combining marks (é -> e) and Arabic tashkeel/tatweel
  s = s.replace(/[\u0300-\u036f]/g, '');
  s = s.replace(/[\u064b-\u065f\u0670\u06d6-\u06ed\u0640]/g, '');

  s = s.toLowerCase();

  // Arabic orthographic folding
  s = s
    .replace(/[\u0622\u0623\u0625\u0671]/g, '\u0627') // آ أ إ ٱ -> ا
    .replace(/\u0649/g, '\u064a') // ى -> ي
    .replace(/\u0629/g, '\u0647') // ة -> ه
    .replace(/[\u0624\u0626]/g, '\u0621'); // ؤ ئ -> ء

  // Arabic-Indic and Eastern Arabic-Indic digits -> ASCII
  s = s.replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660));
  s = s.replace(/[\u06f0-\u06f9]/g, (d) => String(d.charCodeAt(0) - 0x06f0));

  // punctuation -> space, collapse
  s = s.replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');

  return s;
}

/* ------------------------------------------------------------------ index */

export type SearchHit = {
  region: BodyRegion;
  /** the term that matched, in its original form (shown as "matched: …") */
  matchedTerm: string;
  /** true when the hit came from a synonym rather than the region's own label */
  viaSynonym: boolean;
  score: number;
};

type IndexEntry = {
  regionId: string;
  term: string;
  norm: string;
  viaSynonym: boolean;
  /** label terms outrank synonym terms at equal match quality */
  weight: number;
};

function buildIndex(): IndexEntry[] {
  const out: IndexEntry[] = [];
  for (const r of REGIONS) {
    out.push({ regionId: r.id, term: r.label, norm: normalise(r.label), viaSynonym: false, weight: 3 });
    if (r.labelAr) {
      out.push({ regionId: r.id, term: r.labelAr, norm: normalise(r.labelAr), viaSynonym: false, weight: 3 });
    }
    // the id itself ("lower_back" -> "lower back") is a free, safe term
    out.push({
      regionId: r.id,
      term: r.label,
      norm: normalise(r.id.replace(/_/g, ' ')),
      viaSynonym: false,
      weight: 2,
    });
  }
  for (const s of SYNONYMS) {
    out.push({ regionId: s.regionId, term: s.term, norm: normalise(s.term), viaSynonym: true, weight: 1 });
  }
  return out.filter((e) => e.norm.length > 0);
}

const INDEX = buildIndex();

/** Region ids referenced by a synonym that no longer exists in the mesh. */
export function orphanSynonyms(): string[] {
  const ids = new Set(REGIONS.map((r) => r.id));
  return [...new Set(SYNONYMS.filter((s) => !ids.has(s.regionId)).map((s) => s.regionId))];
}

/* ----------------------------------------------------------------- search */

const MATCH_EXACT = 1000;
const MATCH_WORD_PREFIX = 600;
const MATCH_PREFIX = 400;
const MATCH_SUBSTRING = 200;

function matchScore(norm: string, q: string): number {
  if (norm === q) return MATCH_EXACT;
  if (norm.startsWith(q)) return MATCH_PREFIX;
  // "back" should match "lower back" strongly — word-boundary prefix
  if (norm.split(' ').some((w) => w.startsWith(q))) return MATCH_WORD_PREFIX;
  if (norm.includes(q)) return MATCH_SUBSTRING;
  return 0;
}

/**
 * Search regions by patient vocabulary.
 *
 * @param query    raw user input, any script
 * @param locale   only affects tie-breaking presentation, not matching —
 *                 an Arabic term always finds its region even in EN mode
 * @param limit    max hits returned
 */
export function searchRegions(query: string, locale: Locale = 'en', limit = 8): SearchHit[] {
  const q = normalise(query);
  if (q.length < 2) return [];

  /** best entry per region */
  const best = new Map<string, { score: number; term: string; viaSynonym: boolean }>();

  for (const e of INDEX) {
    const m = matchScore(e.norm, q);
    if (m === 0) continue;
    // shorter terms are more precise matches for the same match class
    const score = m + e.weight * 10 - Math.min(e.norm.length, 40);
    const prev = best.get(e.regionId);
    if (!prev || score > prev.score) {
      best.set(e.regionId, { score, term: e.term, viaSynonym: e.viaSynonym });
    }
  }

  const hits: SearchHit[] = [];
  for (const [regionId, v] of best) {
    const region = REGIONS.find((r) => r.id === regionId);
    if (!region) continue; // orphan synonym — never surface a region that isn't in the mesh
    hits.push({ region, matchedTerm: v.term, viaSynonym: v.viaSynonym, score: v.score });
  }

  hits.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    // stable, locale-aware alphabetical tie-break
    const al = locale === 'ar' && a.region.labelAr ? a.region.labelAr : a.region.label;
    const bl = locale === 'ar' && b.region.labelAr ? b.region.labelAr : b.region.label;
    return al.localeCompare(bl);
  });

  return hits.slice(0, limit);
}
