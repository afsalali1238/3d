/**
 * Device-local minimal intake.
 *
 * Patient data stays on this device. Like consent and episode data it goes
 * through the storage helper, so "not my device" keeps the same shape in
 * sessionStorage only.
 *
 * Height and weight are captured raw; no derived body index is computed or
 * displayed anywhere.
 */
import type { Sex } from '../content/types';
import { readJson, writeJson, removeKey } from './storage';

export const INTAKE_KEY = 'bv.intake.v1';

export type LongTermCondition = 'yes' | 'no';

export type Intake = {
  sex: Sex;
  heightCm: number;
  weightKg: number;
  longTermCondition: LongTermCondition;
  /** current pain, 0–10 */
  pain: number;
  savedAt: string;
};

export function loadIntake(): Intake | null {
  return readJson<Intake>(INTAKE_KEY);
}

export function saveIntake(input: Omit<Intake, 'savedAt'>): void {
  writeJson(INTAKE_KEY, { ...input, savedAt: new Date().toISOString() } satisfies Intake);
}

export function clearIntake(): void {
  removeKey(INTAKE_KEY);
}
