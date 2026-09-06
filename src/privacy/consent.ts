import { readJson, writeJson, removeKey, setPersistMode, type PersistMode } from './storage';

export const CONSENT_KEY = 'bv.consent.v1';

export type ConsentRecord = {
  acceptedAt: string;
  locale: 'en' | 'ar';
  persistMode: PersistMode;
};

export function loadConsent(): ConsentRecord | null {
  return readJson<ConsentRecord>(CONSENT_KEY);
}

export function saveConsent(locale: 'en' | 'ar', persistMode: PersistMode): ConsentRecord {
  setPersistMode(persistMode);
  const rec: ConsentRecord = {
    acceptedAt: new Date().toISOString(),
    locale,
    persistMode,
  };
  writeJson(CONSENT_KEY, rec);
  return rec;
}

export function clearConsent(): void {
  removeKey(CONSENT_KEY);
}
