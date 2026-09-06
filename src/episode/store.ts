import { EPISODE_KEY, type Episode, type SessionLog } from './types';
import { readJson, writeJson, removeKey } from '../privacy/storage';

export function loadEpisode(): Episode | null {
  return readJson<Episode>(EPISODE_KEY);
}

export function saveEpisode(e: Episode): void {
  writeJson(EPISODE_KEY, e);
}

export function clearEpisode(): void {
  removeKey(EPISODE_KEY);
}

export function startEpisode(partial: Omit<Episode, 'id' | 'startedAt' | 'sessions'>): Episode {
  const e: Episode = {
    ...partial,
    id: `ep-${Date.now()}`,
    startedAt: new Date().toISOString(),
    sessions: [],
  };
  saveEpisode(e);
  return e;
}

export function appendSession(log: SessionLog): Episode | null {
  const e = loadEpisode();
  if (!e) return null;
  const next = { ...e, sessions: [...e.sessions, log] };
  saveEpisode(next);
  return next;
}
