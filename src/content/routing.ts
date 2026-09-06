/**
 * Routing — exact lookup, never inference.
 *
 * Invariants (see docs/IMPLEMENTATION-PLAN.md):
 *  R1  No scoring, ranking, similarity or "closest route". A path either has
 *      a route row or it does not.
 *  R3  Filters may only SUBTRACT. Nothing here creates or substitutes content.
 *  R4  Red flags short-circuit before any route lookup.
 */
import type {
  AgeBand,
  ContentBundle,
  Exercise,
  Question,
  Route,
  Sex,
} from './types';

/* -------------------------------------------------------- answer paths */

export type Answers = Record<string, string>;

/**
 * Canonical string form of a set of answers.
 * Sorted by question key so authoring order can never make a row unreachable.
 * Skipped questions are simply absent.
 */
export function normaliseAnswerPath(answers: Answers): string {
  return Object.entries(answers)
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => [k.trim().toLowerCase(), String(v).trim().toLowerCase()] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
}

/* ------------------------------------------------------------- the gate */

/** The single render gate. Nothing reaches a patient except through this. */
export function isPublished(row: { status: string; reviewedBy: string }): boolean {
  return row.status === 'published' && row.reviewedBy.trim().length > 0;
}

/** R2: one gate, used by both guided flow and plain browsing. */
export function selectPublished<T extends { status: string; reviewedBy: string }>(
  rows: T[],
): T[] {
  return rows.filter(isPublished);
}

/* ------------------------------------------------------------- filtering */

export type Profile = {
  sex?: Sex;
  ageBand?: AgeBand;
  irritability?: import('./types').Irritability;
};

/**
 * R3: subtractive only. The return value is always a subset of the input.
 * An empty `suitsSex` / `suitsAgeBands` means "suits everyone".
 */
export function filterBySuitability(exercises: Exercise[], profile: Profile): Exercise[] {
  return exercises.filter((e) => {
    if (e.suitsSex && profile.sex && e.suitsSex !== profile.sex) return false;
    if (e.suitsAgeBands?.length && profile.ageBand && !e.suitsAgeBands.includes(profile.ageBand)) {
      return false;
    }
    if (e.irritabilityMax && profile.irritability) {
      const rank = { quick: 0, hours: 1, day: 2 } as const;
      if (rank[profile.irritability] > rank[e.irritabilityMax]) return false;
    }
    return true;
  });
}

/* --------------------------------------------------------------- outcome */

export type Outcome =
  | { kind: 'escalate'; escalationId: string; reason: 'red_flag' | 'routed' }
  | {
      kind: 'exercises';
      exercises: Exercise[];
      /** true when no route row matched and we fell back to the whole area */
      unrouted: boolean;
      /** true when suitability filtering emptied the set, so we showed it unfiltered */
      filterRelaxed: boolean;
    }
  | { kind: 'empty'; bodyArea: string };

/**
 * Resolve a completed (or partially completed) questionnaire to an outcome.
 *
 * Order matters and is the safety property:
 *   1. red flag in ANY answer  -> escalate immediately (R4)
 *   2. exact route row         -> its outcome
 *   3. no route row            -> everything published for the area (safe fallback)
 */
export function resolveOutcome(
  bundle: ContentBundle,
  bodyArea: string,
  answers: Answers,
  profile: Profile = {},
): Outcome {
  const questions = selectPublished(bundle.questions).filter((q) => q.bodyArea === bodyArea);

  // 1 — red flags win, before any routing
  for (const q of questions) {
    const chosen = answers[q.key];
    if (!chosen) continue;
    const opt = q.options.find((o) => o.key === chosen);
    if (opt?.redFlag && opt.escalationId) {
      return { kind: 'escalate', escalationId: opt.escalationId, reason: 'red_flag' };
    }
  }

  const areaExercises = selectPublished(bundle.exercises).filter((e) => e.bodyArea === bodyArea);

  // 2 — exact route lookup
  const path = normaliseAnswerPath(answers);
  const route: Route | undefined = selectPublished(bundle.routes).find(
    (r) => r.bodyArea === bodyArea && r.answerPath === path,
  );

  if (route) {
    if (route.outcome === 'escalate') {
      return { kind: 'escalate', escalationId: route.escalationId, reason: 'routed' };
    }
    const byId = new Map(areaExercises.map((e) => [e.id, e]));
    const picked = route.exerciseIds.map((id) => byId.get(id)).filter((e): e is Exercise => !!e);
    return finish(picked, false);
  }

  // 3 — unrouted is a safe state by construction
  return finish(areaExercises, true);

  function finish(list: Exercise[], unrouted: boolean): Outcome {
    if (list.length === 0) return { kind: 'empty', bodyArea };
    const filtered = filterBySuitability(list, profile);
    // never show zero because of a filter — relax and say so
    if (filtered.length === 0) {
      return { kind: 'exercises', exercises: list, unrouted, filterRelaxed: true };
    }
    return { kind: 'exercises', exercises: filtered, unrouted, filterRelaxed: false };
  }
}

/** Questions for an area, published only, in author order. */
export function questionsFor(bundle: ContentBundle, bodyArea: string): Question[] {
  return selectPublished(bundle.questions)
    .filter((q) => q.bodyArea === bodyArea)
    .sort((a, b) => a.order - b.order);
}

/** Which body area (if any) a viewer region belongs to. */
export function areaForRegion(bundle: ContentBundle, regionId: string): string | null {
  return bundle.bodyAreas.find((a) => a.regionIds.includes(regionId))?.id ?? null;
}
