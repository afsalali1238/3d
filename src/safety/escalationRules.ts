/**
 * Rule-based referral prompts. Missing thresholds refuse to fire on that axis.
 */
import { selectPublished } from '../content/routing';
import type { ContentBundle, ThresholdKey } from '../content/types';
import type { Episode } from '../episode/types';

export function thresholdValue(bundle: ContentBundle, key: ThresholdKey): number | null {
  const row = selectPublished(bundle.thresholds).find((t) => t.key === key);
  if (!row || !Number.isFinite(row.value)) return null;
  return row.value;
}

export type EscalationTrigger =
  | { reason: 'red_flag' }
  | { reason: 'unrouted' }
  | { reason: 'high_baseline' }
  | { reason: 'rising_trend' }
  | { reason: 'repeated_amber' }
  | { reason: 'no_change' }
  | { reason: 'floor_reminder' };

export function evaluateEscalationRules(
  bundle: ContentBundle,
  episode: Episode | null,
  opts: { unrouted?: boolean; nrsNow?: number; redFlag?: boolean },
): EscalationTrigger | null {
  if (opts.redFlag) return { reason: 'red_flag' };
  if (opts.unrouted) return { reason: 'unrouted' };

  const nrsRef = thresholdValue(bundle, 'nrs_referral');
  if (nrsRef != null && opts.nrsNow != null && opts.nrsNow >= nrsRef) {
    return { reason: 'high_baseline' };
  }

  if (!episode) return null;

  const risingN = thresholdValue(bundle, 'rising_sessions_n');
  if (risingN != null && episode.sessions.length >= risingN) {
    const last = episode.sessions.slice(-risingN);
    const nrs = last.map((s) => s.nrsBefore).filter((n): n is number => n != null);
    if (nrs.length === risingN) {
      let up = true;
      for (let i = 1; i < nrs.length; i++) if (nrs[i] <= nrs[i - 1]) up = false;
      if (up) return { reason: 'rising_trend' };
    }
  }

  const ambers = episode.sessions.filter((s) => s.light === 'amber').length;
  if (ambers >= 2) return { reason: 'repeated_amber' };

  const weeks = thresholdValue(bundle, 'review_weeks');
  if (weeks != null && episode.startedAt) {
    const ageMs = Date.now() - Date.parse(episode.startedAt);
    if (Number.isFinite(ageMs) && ageMs >= weeks * 7 * 24 * 3600 * 1000) {
      const first = episode.sessions[0]?.nrsBefore;
      const last = episode.sessions[episode.sessions.length - 1]?.nrsBefore;
      if (first != null && last != null && last >= first) return { reason: 'no_change' };
    }
  }

  const days = thresholdValue(bundle, 'reminder_days');
  if (days != null && episode.startedAt) {
    const ageMs = Date.now() - Date.parse(episode.startedAt);
    if (Number.isFinite(ageMs) && ageMs >= days * 24 * 3600 * 1000) {
      return { reason: 'floor_reminder' };
    }
  }

  return null;
}
