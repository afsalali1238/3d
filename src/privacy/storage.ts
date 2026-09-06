/**
 * Device-local persistence. No backend, no transmission.
 *
 * "Not my device" keeps the same shape in sessionStorage only.
 * One-tap clear wipes every bv.* key in both stores.
 */

export const NS = 'bv.';

export type PersistMode = 'device' | 'session';

const MODE_KEY = 'bv.persist_mode.v1';

function store(mode: PersistMode): Storage | null {
  try {
    return mode === 'session' ? sessionStorage : localStorage;
  } catch {
    return null;
  }
}

export function getPersistMode(): PersistMode {
  try {
    const m = sessionStorage.getItem(MODE_KEY) ?? localStorage.getItem(MODE_KEY);
    return m === 'session' ? 'session' : 'device';
  } catch {
    return 'device';
  }
}

export function setPersistMode(mode: PersistMode): void {
  try {
    sessionStorage.setItem(MODE_KEY, mode);
    if (mode === 'device') localStorage.setItem(MODE_KEY, mode);
    else localStorage.removeItem(MODE_KEY);
  } catch {
    /* ignore */
  }
}

export function readJson<T>(key: string): T | null {
  const mode = getPersistMode();
  const s = store(mode);
  if (!s) return null;
  try {
    const raw = s.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function writeJson(key: string, value: unknown): void {
  if (!key.startsWith(NS)) return;
  const s = store(getPersistMode());
  if (!s) return;
  try {
    s.setItem(key, JSON.stringify(value));
  } catch {
    /* quota / private mode */
  }
}

export function removeKey(key: string): void {
  try {
    localStorage.removeItem(key);
    sessionStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

/** One-tap clear. Always reachable. */
export function clearAllPatientData(): void {
  const wipe = (s: Storage) => {
    const keys: string[] = [];
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i);
      if (k?.startsWith(NS)) keys.push(k);
    }
    for (const k of keys) s.removeItem(k);
  };
  try {
    wipe(localStorage);
    wipe(sessionStorage);
  } catch {
    /* ignore */
  }
}
