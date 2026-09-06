import { describe, it, expect } from 'vitest';
import {
  normaliseAnswerPath,
  resolveOutcome,
  filterBySuitability,
  selectPublished,
  areaForRegion,
  questionsFor,
} from './routing';
import { placeholderContent as C } from './placeholder';
import { scanAll, formatHits } from './compliance';
import type { ContentBundle, Exercise } from './types';

describe('normaliseAnswerPath', () => {
  it('is order-independent', () => {
    expect(normaliseAnswerPath({ timing: 'mornings', movement: 'bending_forward' })).toBe(
      normaliseAnswerPath({ movement: 'bending_forward', timing: 'mornings' }),
    );
  });

  it('omits skipped questions', () => {
    expect(normaliseAnswerPath({ movement: 'twisting', timing: '' })).toBe('movement=twisting');
  });

  it('lowercases and trims', () => {
    expect(normaliseAnswerPath({ Movement: ' Twisting ' })).toBe('movement=twisting');
  });
});

describe('R4 — red flags win, always', () => {
  it('escalates on a red-flag answer instead of any exercise', () => {
    const out = resolveOutcome(C, 'lower_back', {
      movement: 'numbness_weakness',
      timing: 'mornings',
    });
    expect(out.kind).toBe('escalate');
    if (out.kind === 'escalate') expect(out.reason).toBe('red_flag');
  });

  it('escalates even when the other answers would have routed cleanly', () => {
    const out = resolveOutcome(C, 'lower_back', {
      movement: 'bending_forward',
      timing: 'night_pain',
    });
    expect(out.kind).toBe('escalate');
  });

  it('escalates on a red flag alone, with everything else skipped', () => {
    expect(resolveOutcome(C, 'lower_back', { timing: 'night_pain' }).kind).toBe('escalate');
  });

  it('never returns exercises for any answer set containing a red flag', () => {
    const q = questionsFor(C, 'lower_back');
    const red = q.flatMap((qq) => qq.options.filter((o) => o.redFlag).map((o) => [qq.key, o.key]));
    expect(red.length).toBeGreaterThan(0);
    for (const [k, v] of red) {
      // combine the red flag with every possible value of the other question
      for (const other of q.filter((x) => x.key !== k)) {
        for (const opt of other.options) {
          const out = resolveOutcome(C, 'lower_back', { [k]: v, [other.key]: opt.key });
          expect(out.kind, `${k}=${v} + ${other.key}=${opt.key} leaked exercises`).toBe('escalate');
        }
      }
    }
  });
});

describe('R1 — exact lookup, no inference', () => {
  it('resolves an authored route to exactly its exercises, in order', () => {
    const out = resolveOutcome(C, 'lower_back', {
      movement: 'bending_forward',
      timing: 'mornings',
    });
    expect(out.kind).toBe('exercises');
    if (out.kind !== 'exercises') return;
    expect(out.exercises.map((e) => e.id)).toEqual(['lb_ex_pelvic_tilt', 'lb_ex_cat_camel']);
    expect(out.unrouted).toBe(false);
  });

  it('falls back safely when no route matches — never guesses a near route', () => {
    // authored: bending_forward+mornings. This differs by one answer.
    const out = resolveOutcome(C, 'lower_back', {
      movement: 'leaning_back',
      timing: 'mornings',
    });
    expect(out.kind).toBe('exercises');
    if (out.kind !== 'exercises') return;
    expect(out.unrouted).toBe(true);
    // the fallback is the full published area set, not a "closest" subset
    expect(out.exercises.length).toBe(
      selectPublished(C.exercises).filter((e) => e.bodyArea === 'lower_back').length,
    );
  });

  it('treats an all-skipped questionnaire as unrouted, not as an error', () => {
    const out = resolveOutcome(C, 'lower_back', {});
    expect(out.kind).toBe('exercises');
    if (out.kind === 'exercises') expect(out.unrouted).toBe(true);
  });

  it('returns empty (not a guess) for an area with no published content', () => {
    expect(resolveOutcome(C, 'neck', {}).kind).toBe('empty');
  });
});

describe('R2 — one gate', () => {
  it('never returns draft or unsigned rows', () => {
    const bundle: ContentBundle = {
      ...C,
      exercises: C.exercises.map((e, i) =>
        i === 0 ? { ...e, status: 'draft' as const } : { ...e, reviewedBy: '' },
      ),
    };
    const out = resolveOutcome(bundle, 'lower_back', {});
    expect(out.kind).toBe('empty');
  });

  it('ignores a route that is itself unpublished', () => {
    const bundle: ContentBundle = {
      ...C,
      routes: C.routes.map((r) => ({ ...r, reviewedBy: '' })),
    };
    const out = resolveOutcome(bundle, 'lower_back', {
      movement: 'bending_forward',
      timing: 'mornings',
    });
    expect(out.kind).toBe('exercises');
    if (out.kind === 'exercises') expect(out.unrouted).toBe(true);
  });
});

describe('R3 — filters subtract only', () => {
  const all = selectPublished(C.exercises);

  it('output is always a subset of input', () => {
    const profiles = [
      {},
      { sex: 'male' as const },
      { sex: 'female' as const },
      { ageBand: 'senior' as const },
      { ageBand: 'teen' as const },
      { sex: 'female' as const, ageBand: 'senior' as const },
    ];
    for (const p of profiles) {
      const out = filterBySuitability(all, p);
      expect(out.length).toBeLessThanOrEqual(all.length);
      for (const e of out) expect(all).toContain(e);
    }
  });

  it('empty suits_* means shown to everyone', () => {
    const e = all.find((x) => !x.suitsSex && !x.suitsAgeBands)!;
    expect(filterBySuitability([e], { sex: 'female', ageBand: 'senior' })).toEqual([e]);
  });

  it('hides an exercise outside its age bands', () => {
    const banded = all.find((x) => x.suitsAgeBands?.length)!;
    expect(banded.suitsAgeBands).not.toContain('senior');
    expect(filterBySuitability([banded], { ageBand: 'senior' })).toEqual([]);
  });

  it('never shows zero because of a filter — relaxes and flags it', () => {
    const narrow: Exercise[] = all.map((e) => ({ ...e, suitsAgeBands: ['teen'] }));
    const bundle: ContentBundle = { ...C, exercises: narrow };
    const out = resolveOutcome(bundle, 'lower_back', {}, { ageBand: 'senior' });
    expect(out.kind).toBe('exercises');
    if (out.kind !== 'exercises') return;
    expect(out.filterRelaxed).toBe(true);
    expect(out.exercises.length).toBeGreaterThan(0);
  });

  it('does not invent or substitute anything', () => {
    const ids = new Set(all.map((e) => e.id));
    const out = filterBySuitability(all, { sex: 'male', ageBand: 'adult' });
    for (const e of out) expect(ids.has(e.id)).toBe(true);
  });
});

describe('region → area mapping', () => {
  it('maps lumbar and sacrum to the lower back area', () => {
    expect(areaForRegion(C, 'lumbar_spine')).toBe('lower_back');
    expect(areaForRegion(C, 'sacrum_si')).toBe('lower_back');
  });

  it('returns null for a region with no area, rather than guessing', () => {
    expect(areaForRegion(C, 'left_thumb')).toBeNull();
  });
});

describe('content integrity', () => {
  it('every red-flag option points at a published escalation message', () => {
    const escalations = new Set(selectPublished(C.escalations).map((e) => e.id));
    for (const q of C.questions) {
      for (const o of q.options) {
        if (o.redFlag) {
          expect(o.escalationId, `${o.id} is a red flag with no escalation`).toBeTruthy();
          expect(escalations.has(o.escalationId!), `${o.id} -> missing escalation`).toBe(true);
        }
      }
    }
  });

  it('every route references exercises that exist', () => {
    const ids = new Set(C.exercises.map((e) => e.id));
    for (const r of C.routes) {
      if (r.outcome !== 'exercises') continue;
      for (const id of r.exerciseIds) expect(ids.has(id), `route ${r.id} -> ${id}`).toBe(true);
    }
  });

  it('no route maps a red-flag path to exercises', () => {
    const redKeys = C.questions.flatMap((q) =>
      q.options.filter((o) => o.redFlag).map((o) => `${q.key}=${o.key}`),
    );
    for (const r of C.routes) {
      if (r.outcome !== 'exercises') continue;
      for (const rk of redKeys) {
        expect(r.answerPath.includes(rk), `route ${r.id} routes a red flag to exercises`).toBe(
          false,
        );
      }
    }
  });

  it('every route path is already in canonical form (so it is reachable)', () => {
    for (const r of C.routes) {
      const parsed = Object.fromEntries(r.answerPath.split('&').map((p) => p.split('=')));
      expect(normaliseAnswerPath(parsed), `route ${r.id} path is not canonical`).toBe(r.answerPath);
    }
  });

  it('all patient-visible content is condition-name free', () => {
    const rec: Array<{ source: string; text: string }> = [];
    for (const q of C.questions) {
      rec.push({ source: `q:${q.id}`, text: q.prompt.en }, { source: `q:${q.id}:ar`, text: q.prompt.ar });
      for (const o of q.options) {
        rec.push({ source: `opt:${o.id}`, text: o.label.en }, { source: `opt:${o.id}:ar`, text: o.label.ar });
      }
    }
    for (const e of C.exercises) {
      rec.push(
        { source: `ex:${e.id}:name`, text: e.name.en },
        { source: `ex:${e.id}:purpose`, text: e.purpose.en },
        { source: `ex:${e.id}:safety`, text: e.safety.en },
      );
    }
    for (const m of C.escalations) {
      rec.push({ source: `esc:${m.id}`, text: m.body.en }, { source: `esc:${m.id}:ar`, text: m.body.ar });
    }
    expect(formatHits(scanAll(rec))).toBe('compliance: clean');
  });

  it('every published string has an Arabic peer', () => {
    for (const q of C.questions) {
      expect(q.prompt.ar.trim().length, `${q.id} missing AR prompt`).toBeGreaterThan(0);
      for (const o of q.options) expect(o.label.ar.trim().length, `${o.id} missing AR`).toBeGreaterThan(0);
    }
    for (const e of C.exercises) {
      expect(e.name.ar.trim().length, `${e.id} missing AR name`).toBeGreaterThan(0);
      expect(e.dosage.ar.trim().length, `${e.id} missing AR dosage`).toBeGreaterThan(0);
      for (const s of e.steps) expect(s.ar.trim().length, `${e.id} step missing AR`).toBeGreaterThan(0);
    }
  });
});
