/**
 * Precaution engine. Hide, warn, or stop. Never substitute or modify.
 */
import { isPublished, selectPublished } from '../content/routing';
import type { ContentBundle, Exercise, Precaution } from '../content/types';

export const NONE_KEY = 'none';
export const PREFER_NOT_KEY = 'prefer_not_to_say';

export function publishedPrecautions(bundle: ContentBundle): Precaution[] {
  return selectPublished(bundle.precautions);
}

export type PrecautionResult =
  | { kind: 'stop'; messageId: string; keys: string[] }
  | { kind: 'ok'; hideIds: Set<string>; warnIds: Set<string>; warnMessageIds: string[] };

export function evaluatePrecautions(
  bundle: ContentBundle,
  selectedKeys: string[],
): PrecautionResult {
  const rows = publishedPrecautions(bundle);
  const chosen = selectedKeys.filter((k) => k !== NONE_KEY && k !== PREFER_NOT_KEY);
  const hideIds = new Set<string>();
  const warnIds = new Set<string>();
  const warnMessageIds: string[] = [];

  for (const key of chosen) {
    const row = rows.find((r) => r.conditionKey === key);
    if (!row) continue;
    if (row.action === 'stop_and_refer') {
      const msg = bundle.escalations.find((m) => m.id === row.messageId);
      if (msg && !isPublished(msg)) continue;
      return { kind: 'stop', messageId: row.messageId, keys: chosen };
    }
    for (const id of row.restrictsIds) {
      if (row.action === 'hide') hideIds.add(id);
      if (row.action === 'warn') warnIds.add(id);
    }
    if (row.action === 'warn' && row.messageId) warnMessageIds.push(row.messageId);
  }

  return { kind: 'ok', hideIds, warnIds, warnMessageIds };
}

/** Subtractive only. Never invents a replacement. */
export function applyPrecautionHide(exercises: Exercise[], hideIds: Set<string>): Exercise[] {
  if (hideIds.size === 0) return exercises;
  return exercises.filter((e) => {
    if (hideIds.has(e.id)) return false;
    if (e.precautionTags?.some((t) => hideIds.has(t))) return false;
    return true;
  });
}
