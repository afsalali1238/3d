export type TrafficLight = 'green' | 'amber' | 'red';

export type SessionLog = {
  at: string;
  bodyArea: string;
  exerciseIds: string[];
  nrsBefore?: number;
  nrsAfter?: number;
  light?: TrafficLight;
};

export type Episode = {
  id: string;
  startedAt: string;
  bodyArea: string;
  regionId?: string;
  answers: Record<string, string>;
  nrsNow?: number;
  nrsWorst?: number;
  sessions: SessionLog[];
};

export const EPISODE_KEY = 'bv.episode.v1';
