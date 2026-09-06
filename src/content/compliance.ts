/**
 * Compliance scan — condition-name detection over all patient-visible text.
 *
 * Standing rule D-001: navigation is by BODY AREA, never by condition. The
 * app may say *where* it is and *how it moves*. It must never name, imply or
 * infer a diagnosis.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  OWNERSHIP: the SCANNER is build-side. The TERM LIST is clinical/compliance
 *  property. The list below is a build-side seed so the gate is armed from
 *  day one rather than "added later" — it is NOT the authoritative 36-rule
 *  list referenced in the brief, which does not exist in this repository.
 *  When that list arrives it replaces CONDITION_TERMS wholesale.
 *  See docs/CLINICIAN-HANDOFF.md §B8.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * This runs in tests/CI over region labels, synonyms, and (once authored)
 * questions, answer options, escalation copy and exercise text. Any hit
 * fails the build with the file, the row and the matched term.
 */
import { normalise } from '../components/body/search';

export type ConditionTerm = {
  /** normalised term or phrase */
  term: string;
  locale: 'en' | 'ar';
  /** why it's banned — surfaced in the failure message */
  note: string;
};

/**
 * Seed list. Deliberately conservative: every entry is unambiguously a
 * diagnosis, syndrome or pathology name, never an anatomical word.
 *
 * NOTE on false positives: anatomical words that merely *appear* in
 * condition names ("shoulder" in "frozen shoulder") are NOT listed — only
 * the full condition phrase is. That keeps the scan from banning anatomy.
 */
export const CONDITION_TERMS: ConditionTerm[] = [
  // spine / back
  { term: 'sciatica', locale: 'en', note: 'diagnosis' },
  { term: 'herniated disc', locale: 'en', note: 'diagnosis' },
  { term: 'slipped disc', locale: 'en', note: 'diagnosis' },
  { term: 'bulging disc', locale: 'en', note: 'diagnosis' },
  { term: 'disc prolapse', locale: 'en', note: 'diagnosis' },
  { term: 'spinal stenosis', locale: 'en', note: 'diagnosis' },
  { term: 'spondylosis', locale: 'en', note: 'diagnosis' },
  { term: 'spondylolisthesis', locale: 'en', note: 'diagnosis' },
  { term: 'scoliosis', locale: 'en', note: 'diagnosis' },
  { term: 'kyphosis', locale: 'en', note: 'diagnosis' },
  { term: 'lordosis', locale: 'en', note: 'diagnosis' },
  { term: 'whiplash', locale: 'en', note: 'diagnosis' },
  { term: 'radiculopathy', locale: 'en', note: 'diagnosis' },
  // joints / soft tissue
  { term: 'arthritis', locale: 'en', note: 'diagnosis' },
  { term: 'osteoarthritis', locale: 'en', note: 'diagnosis' },
  { term: 'rheumatoid', locale: 'en', note: 'diagnosis' },
  { term: 'osteoporosis', locale: 'en', note: 'diagnosis' },
  { term: 'bursitis', locale: 'en', note: 'diagnosis' },
  { term: 'tendinitis', locale: 'en', note: 'diagnosis' },
  { term: 'tendinopathy', locale: 'en', note: 'diagnosis' },
  { term: 'tendonitis', locale: 'en', note: 'diagnosis' },
  { term: 'frozen shoulder', locale: 'en', note: 'diagnosis' },
  { term: 'adhesive capsulitis', locale: 'en', note: 'diagnosis' },
  { term: 'impingement', locale: 'en', note: 'diagnosis' },
  { term: 'tennis elbow', locale: 'en', note: 'diagnosis' },
  { term: 'golfers elbow', locale: 'en', note: 'diagnosis' },
  { term: 'epicondylitis', locale: 'en', note: 'diagnosis' },
  { term: 'carpal tunnel', locale: 'en', note: 'diagnosis' },
  { term: 'trigger finger', locale: 'en', note: 'diagnosis' },
  { term: 'plantar fasciitis', locale: 'en', note: 'diagnosis' },
  { term: 'shin splints', locale: 'en', note: 'diagnosis' },
  { term: 'runners knee', locale: 'en', note: 'diagnosis' },
  { term: 'jumpers knee', locale: 'en', note: 'diagnosis' },
  { term: 'chondromalacia', locale: 'en', note: 'diagnosis' },
  { term: 'meniscus tear', locale: 'en', note: 'diagnosis' },
  { term: 'acl tear', locale: 'en', note: 'diagnosis' },
  { term: 'rotator cuff tear', locale: 'en', note: 'diagnosis' },
  { term: 'labral tear', locale: 'en', note: 'diagnosis' },
  { term: 'hernia', locale: 'en', note: 'diagnosis' },
  { term: 'fibromyalgia', locale: 'en', note: 'diagnosis' },
  { term: 'gout', locale: 'en', note: 'diagnosis' },
  { term: 'fracture', locale: 'en', note: 'diagnosis' },
  { term: 'dislocation', locale: 'en', note: 'diagnosis' },
  { term: 'sprain', locale: 'en', note: 'injury classification' },
  { term: 'strain', locale: 'en', note: 'injury classification' },
  // neuro / systemic
  { term: 'stroke', locale: 'en', note: 'diagnosis' },
  { term: 'parkinson', locale: 'en', note: 'diagnosis' },
  { term: 'multiple sclerosis', locale: 'en', note: 'diagnosis' },
  { term: 'neuropathy', locale: 'en', note: 'diagnosis' },
  { term: 'cancer', locale: 'en', note: 'diagnosis' },
  { term: 'tumour', locale: 'en', note: 'diagnosis' },
  { term: 'tumor', locale: 'en', note: 'diagnosis' },
  { term: 'infection', locale: 'en', note: 'diagnosis' },
  { term: 'diabetes', locale: 'en', note: 'diagnosis' },
  // treatment claims (advertising risk under DHA/MOHAP, not just D-001)
  { term: 'cure', locale: 'en', note: 'treatment claim' },
  { term: 'heal your', locale: 'en', note: 'treatment claim' },
  { term: 'guaranteed', locale: 'en', note: 'treatment claim' },
  { term: 'permanent relief', locale: 'en', note: 'treatment claim' },
  { term: 'best physiotherapist', locale: 'en', note: 'superlative advertising claim' },
  { term: 'no 1 clinic', locale: 'en', note: 'superlative advertising claim' },
  // Arabic
  { term: 'عرق النسا', locale: 'ar', note: 'diagnosis (sciatica)' },
  { term: 'انزلاق غضروفي', locale: 'ar', note: 'diagnosis (disc prolapse)' },
  { term: 'ديسك', locale: 'ar', note: 'diagnosis (disc)' },
  { term: 'خشونة', locale: 'ar', note: 'diagnosis (osteoarthritis, colloquial)' },
  { term: 'التهاب المفاصل', locale: 'ar', note: 'diagnosis (arthritis)' },
  { term: 'هشاشه العظام', locale: 'ar', note: 'diagnosis (osteoporosis)' },
  { term: 'الكتف المتجمد', locale: 'ar', note: 'diagnosis (frozen shoulder)' },
  { term: 'جنف', locale: 'ar', note: 'diagnosis (scoliosis)' },
  { term: 'كسر', locale: 'ar', note: 'diagnosis (fracture)' },
  { term: 'شفاء', locale: 'ar', note: 'treatment claim (cure)' },
  { term: 'علاج نهاءي', locale: 'ar', note: 'treatment claim (definitive cure)' },
];

const NORMALISED = CONDITION_TERMS.map((t) => ({ ...t, norm: normalise(t.term) })).filter(
  (t) => t.norm.length > 0,
);

export type ComplianceHit = {
  /** where it came from, e.g. "synonyms.ts:lumbar_spine" */
  source: string;
  /** the offending text */
  text: string;
  matchedTerm: string;
  note: string;
};

/** Scan one string. Returns every banned term found. */
export function scanText(source: string, text: string): ComplianceHit[] {
  const norm = normalise(text);
  if (!norm) return [];
  const hits: ComplianceHit[] = [];
  for (const t of NORMALISED) {
    // word-boundary match on the normalised (single-space-separated) form,
    // so "strain" does not fire inside "restrained"
    if (` ${norm} `.includes(` ${t.norm} `)) {
      hits.push({ source, text, matchedTerm: t.term, note: t.note });
    }
  }
  return hits;
}

/** Scan many `{source, text}` records at once. */
export function scanAll(records: Array<{ source: string; text: string }>): ComplianceHit[] {
  return records.flatMap((r) => scanText(r.source, r.text));
}

/** Human-readable failure report for CI. */
export function formatHits(hits: ComplianceHit[]): string {
  if (hits.length === 0) return 'compliance: clean';
  return [
    `compliance: ${hits.length} banned term(s) in patient-visible text`,
    ...hits.map((h) => `  ${h.source}\n    text:    "${h.text}"\n    matched: "${h.matchedTerm}" (${h.note})`),
  ].join('\n');
}
