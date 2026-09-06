/**
 * Device-local patient profile.
 *
 * R5 — device-local only. One localStorage key. No accounts, no analytics,
 * no transmission. There is no backend to send this to, and that stays true.
 * Skipping stores nothing at all.
 */
import type { AgeBand, Sex } from '../../content/types';
import { readJson, writeJson, removeKey } from '../../privacy/storage';

export const PROFILE_KEY = 'bv.profile.v1';

export type StoredProfile = {
  sex?: Sex;
  ageBand?: AgeBand;
  savedAt: string;
};

export const AGE_BANDS: Array<{ id: AgeBand; label: { en: string; ar: string } }> = [
  { id: 'teen', label: { en: '13–17', ar: '١٣–١٧' } },
  { id: 'adult', label: { en: '18–49', ar: '١٨–٤٩' } },
  { id: 'older_adult', label: { en: '50–69', ar: '٥٠–٦٩' } },
  { id: 'senior', label: { en: '70+', ar: '٧٠+' } },
];

export function loadProfile(): StoredProfile | null {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as StoredProfile;
    if (p && typeof p === 'object') return p;
    return null;
  } catch {
    return null;
  }
}

export function saveProfile(p: { sex?: Sex; ageBand?: AgeBand }): void {
  try {
    // never persist an empty profile — skipping means storing nothing
    if (!p.sex && !p.ageBand) return;
    localStorage.setItem(
      PROFILE_KEY,
      JSON.stringify({ ...p, savedAt: new Date().toISOString() } satisfies StoredProfile),
    );
  } catch {
    /* private mode / quota — the app works fine without persistence */
  }
}

export function clearProfile(): void {
  try {
    localStorage.removeItem(PROFILE_KEY);
  } catch {
    /* ignore */
  }
}
