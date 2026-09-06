/**
 * Post-exercise traffic light. Thresholds are clinician-authored.
 * Missing threshold → do not classify on that axis (return null).
 */
import { thresholdValue } from '../safety/escalationRules';
import type { ContentBundle } from '../content/types';
import type { TrafficLight } from './types';

export function resolveTrafficLight(
  bundle: ContentBundle,
  nrsBefore: number,
  nrsAfter: number,
): TrafficLight | null {
  const windowHours = thresholdValue(bundle, 'amber_window_hours');
  // Without her amber definition we refuse to colour the response.
  if (windowHours == null) return null;

  const delta = nrsAfter - nrsBefore;
  if (delta <= 0) return 'green';
  if (delta <= 2) return 'amber';
  return 'red';
}
