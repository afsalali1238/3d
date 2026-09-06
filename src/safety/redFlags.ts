/**
 * Red-flag wall. Unskippable. Any positive answer ends the flow.
 * Rules come from clinician rows; this file only evaluates them.
 */
import { isPublished, selectPublished } from '../content/routing';
import type { ContentBundle, RedFlag } from '../content/types';

export type RedFlagAnswers = Record<string, string>;

export function publishedRedFlags(bundle: ContentBundle): RedFlag[] {
  return selectPublished(bundle.redFlags).sort((a, b) => a.order - b.order);
}

/**
 * If no published red-flag screen exists, we must not recommend exercise.
 * Safety infrastructure precedes recommendation.
 */
export function redFlagScreenReady(bundle: ContentBundle): boolean {
  return publishedRedFlags(bundle).length > 0;
}

export function evaluateRedFlags(
  bundle: ContentBundle,
  answers: RedFlagAnswers,
): { stopped: true; messageId: string; flagId: string } | { stopped: false } {
  for (const f of publishedRedFlags(bundle)) {
    const v = answers[f.id];
    if (v && v === f.positiveKey) {
      const msg = bundle.escalations.find((m) => m.id === f.messageId);
      if (msg && isPublished(msg)) {
        return { stopped: true, messageId: f.messageId, flagId: f.id };
      }
      return { stopped: true, messageId: f.messageId, flagId: f.id };
    }
  }
  return { stopped: false };
}
