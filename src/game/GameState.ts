import { AUDIO, SAVE, START, UPGRADES, UPGRADE_ORDER, type UpgradeId } from '../balance';

export interface GameStats {
  pops: number;
  blues: number;
  earned: number;
}

/**
 * The single source of truth for everything the player owns or has progressed.
 * UI, audio and FX read from here; only Game/Economy/UpgradeSystem write to it.
 */
export interface GameState {
  level: number;
  money: number;
  /** Dollars popped on the current stage (may overflow the target). */
  progress: number;
  upgrades: Record<UpgradeId, number>;
  /** Evolution gauge fill, 0..1. */
  evo: number;
  /** Spawn charges; fractional part is the recharge in progress. */
  charges: number;
  /** Target reached, waiting for Continue. */
  stageCleared: boolean;
  /** Bonus paid for the cleared stage (shown on the card, paid once). */
  stageBonus: number;
  /** Earned on the cleared stage, for the summary card. */
  stageEarned: number;
  hintDone: boolean;
  stats: GameStats;
}

export function createState(): GameState {
  const upgrades = {} as Record<UpgradeId, number>;
  for (const id of UPGRADE_ORDER) upgrades[id] = 0;
  return {
    level: 1,
    money: START.money,
    progress: 0,
    upgrades,
    evo: 0,
    charges: 0,
    stageCleared: false,
    stageBonus: 0,
    stageEarned: 0,
    hintDone: false,
    stats: { pops: 0, blues: 0, earned: 0 },
  };
}

interface SaveV1 {
  v: 1;
  level: number;
  money: number;
  progress: number;
  upgrades: Record<string, number>;
  evo: number;
  stageCleared: boolean;
  stageBonus: number;
  stageEarned: number;
  hintDone: boolean;
  stats: GameStats;
  savedAt: number;
}

function num(value: unknown, fallback: number, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

export function serialize(state: GameState): SaveV1 {
  return {
    v: 1,
    level: state.level,
    money: state.money,
    progress: state.progress,
    upgrades: { ...state.upgrades },
    evo: state.evo,
    stageCleared: state.stageCleared,
    stageBonus: state.stageBonus,
    stageEarned: state.stageEarned,
    hintDone: state.hintDone,
    stats: { ...state.stats },
    savedAt: Date.now(),
  };
}

/** Parses a save defensively; any malformed field falls back to its default. */
export function deserialize(raw: unknown): GameState | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as Partial<SaveV1>;
  if (data.v !== SAVE.version) return null;
  const state = createState();
  state.level = Math.floor(num(data.level, 1, 1, 9999));
  state.money = num(data.money, 0);
  state.progress = num(data.progress, 0);
  state.evo = num(data.evo, 0, 0, 1);
  state.stageCleared = data.stageCleared === true;
  state.stageBonus = num(data.stageBonus, 0);
  state.stageEarned = num(data.stageEarned, 0);
  state.hintDone = data.hintDone === true;
  const ups = (data.upgrades ?? {}) as Record<string, unknown>;
  for (const id of UPGRADE_ORDER) state.upgrades[id] = Math.floor(num(ups[id], 0, 0, UPGRADES[id].maxLevel));
  const stats = (data.stats ?? {}) as Partial<GameStats>;
  state.stats = { pops: num(stats.pops, 0), blues: num(stats.blues, 0), earned: num(stats.earned, 0) };
  return state;
}

export function loadState(): { state: GameState; restored: boolean } {
  try {
    const text = localStorage.getItem(SAVE.key);
    if (text) {
      const state = deserialize(JSON.parse(text));
      if (state) return { state, restored: true };
      console.warn('[Popward] Save was unreadable; starting fresh.');
    }
  } catch (err) {
    console.warn('[Popward] Could not read save; starting fresh.', err);
  }
  return { state: createState(), restored: false };
}

export function persistState(state: GameState): void {
  try {
    localStorage.setItem(SAVE.key, JSON.stringify(serialize(state)));
  } catch {
    // Storage full or blocked (private mode) — the game keeps running without persistence.
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(SAVE.key);
  } catch {
    /* ignore */
  }
}

export type MotionPref = 'auto' | 'on' | 'off';

/** Device-level preferences; deliberately kept out of the progress save so Reset Progress keeps them. */
export interface Settings {
  muted: boolean;
  volume: number;
  motion: MotionPref;
}

export function loadSettings(): Settings {
  const fallback: Settings = { muted: false, volume: AUDIO.defaultVolume, motion: 'auto' };
  try {
    const text = localStorage.getItem(SAVE.settingsKey);
    if (!text) return fallback;
    const raw = JSON.parse(text) as Partial<Settings>;
    return {
      muted: raw.muted === true,
      volume: num(raw.volume, fallback.volume, 0, 1),
      motion: raw.motion === 'on' || raw.motion === 'off' ? raw.motion : 'auto',
    };
  } catch {
    return fallback;
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(SAVE.settingsKey, JSON.stringify(settings));
  } catch {
    /* ignore */
  }
}
