import { WORLD } from '../balance';

export interface Vec {
  x: number;
  y: number;
}

export interface PusherConfig {
  id: 'lower' | 'upper';
  /** Direction the ram faces: 'left' = mounted on a wall to its left, pushes right. */
  side: 'left' | 'right';
  /** Wall face the ram retracts into. Defaults to the outer border on `side`; set it for rams on interior walls. */
  wallX?: number;
  /** Top edge of the ram (flush with the terrace above it). */
  y: number;
  height: number;
  /** Stage cap: the ram face never passes the gap edge, and always stays > 2.5 balloon widths from the opposite wall. */
  maxTravel: number;
  /** Cycle offset 0..1 so the two pushers don't fire in unison. */
  phase: number;
  /** World position of the upgrade chip — must sit on solid wall. */
  chip: Vec;
}

export interface FlowZone {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Direction for stuck-balloon nudges; omitted when toSpikes is set. */
  dir?: Vec;
  toSpikes?: boolean;
}

export interface StagePalette {
  air: string;
  airDeep: string;
  wall: string;
  wallShade: string;
  wallLight: string;
}

export interface StageConfig {
  key: string;
  name: string;
  blurb: string;
  palette: StagePalette;
  floorY: number;
  pipe: { x: number; mouthY: number };
  pipeChip: Vec;
  charges: Vec;
  /** Spike strip hanging from the ceiling (y = WORLD.border). Spans the whole final shaft, so nothing parks beside it. */
  spikes: { x0: number; x1: number; depth: number };
  /** Interior solid geometry. Straight walls only: every polygon is an axis-aligned rectangle. */
  walls: Vec[][];
  pushers: [PusherConfig, PusherConfig];
  /** Checked in order; first containing zone decides the rescue-nudge direction. */
  zones: FlowZone[];
  /** Readable route for debug overlay and the faint guide chevrons. */
  path: Vec[];
}

const v = (x: number, y: number): Vec => ({ x, y });
const rect = (x0: number, y0: number, x1: number, y1: number): Vec[] => [v(x0, y0), v(x1, y0), v(x1, y1), v(x0, y1)];
const B = WORLD.border;
const R = WORLD.width - B;
const FLOOR = 574;

export function pusherWallX(cfg: PusherConfig): number {
  return cfg.wallX ?? (cfg.side === 'left' ? B : R);
}

/*
 * Layout rule for straight walls: every ceiling is either swept by a ram or covered by spikes.
 * A ram only reaches part of its terrace at level 0, so balloons past its reach wait until the pile
 * behind them is pushed (chain pushing). Reach upgrades shrink that wait.
 */

const STAGE_TERRACES: StageConfig = {
  key: 'terraces',
  name: 'Terraces',
  blurb: 'Push right, rise, push left, pop.',
  palette: { air: '#F7F7F3', airDeep: '#EEF3EF', wall: '#DCE6E2', wallShade: '#C6D5CF', wallLight: '#E9F1ED' },
  floorY: FLOOR,
  pipe: { x: 80, mouthY: 548 },
  pipeChip: v(250, 597),
  charges: v(140, 597),
  spikes: { x0: B, x1: 170, depth: 16 },
  walls: [
    // upper block: everything right of the spike shaft, down to the high ram's ceiling
    rect(170, B, R, 200),
    // lower terrace: ceiling of the low ram's corridor
    rect(B, 380, 220, 430),
  ],
  pushers: [
    { id: 'lower', side: 'left', y: 430, height: 48, maxTravel: 206, phase: 0, chip: v(104, 405) },
    { id: 'upper', side: 'right', y: 200, height: 48, maxTravel: 176, phase: 0.5, chip: v(270, 176) },
  ],
  zones: [
    { x0: B, y0: B, x1: 170, y1: 380, dir: v(0, -1) },
    { x0: 170, y0: 200, x1: R, y1: 380, dir: v(-1, -0.2) },
    { x0: 220, y0: 380, x1: R, y1: FLOOR, dir: v(0, -1) },
    { x0: B, y0: 430, x1: 220, y1: FLOOR, dir: v(1, -0.2) },
  ],
  path: [v(80, 536), v(80, 455), v(250, 455), v(250, 224), v(110, 224), v(110, 40)],
};

const STAGE_CROSSOVER: StageConfig = {
  key: 'crossover',
  name: 'Crossover',
  blurb: 'Pipe on the right, rams swap sides.',
  palette: { air: '#F9F6EF', airDeep: '#F2ECE1', wall: '#E7DFD2', wallShade: '#D6CBB9', wallLight: '#F1EBE1' },
  floorY: FLOOR,
  pipe: { x: 272, mouthY: 548 },
  pipeChip: v(130, 597),
  charges: v(212, 597),
  spikes: { x0: 200, x1: R, depth: 16 },
  walls: [
    // upper block on the left, down to the high ram's ceiling
    rect(B, B, 200, 230),
    // lower terrace on the right (higher than stage 1)
    rect(130, 360, R, 410),
  ],
  pushers: [
    { id: 'lower', side: 'right', y: 410, height: 48, maxTravel: 216, phase: 0.15, chip: v(262, 385) },
    { id: 'upper', side: 'left', y: 230, height: 48, maxTravel: 186, phase: 0.62, chip: v(96, 206) },
  ],
  zones: [
    { x0: 200, y0: B, x1: R, y1: 360, dir: v(0, -1) },
    { x0: B, y0: 230, x1: 200, y1: 360, dir: v(1, -0.2) },
    { x0: B, y0: 360, x1: 130, y1: FLOOR, dir: v(0, -1) },
    { x0: 130, y0: 410, x1: R, y1: FLOOR, dir: v(-1, -0.2) },
  ],
  path: [v(272, 536), v(272, 435), v(80, 435), v(80, 254), v(262, 254), v(262, 40)],
};

const STAGE_SWITCHBACK: StageConfig = {
  key: 'switchback',
  name: 'Switchback',
  blurb: 'A pillar splits the room — the high ram lives inside it.',
  palette: { air: '#F6F7F9', airDeep: '#EDEFF5', wall: '#DDE0EC', wallShade: '#C8CCDD', wallLight: '#EAECF4' },
  floorY: FLOOR,
  pipe: { x: 282, mouthY: 548 },
  pipeChip: v(150, 597),
  charges: v(226, 597),
  spikes: { x0: 230, x1: R, depth: 16 },
  walls: [
    // solid pillar on the left, full height: the high ram is mounted in its right face
    rect(B, B, 84, FLOOR),
    // upper block right of the pillar, down to the high ram's ceiling
    rect(84, B, 230, 240),
    // lower terrace on the right
    rect(170, 380, R, 430),
  ],
  pushers: [
    { id: 'lower', side: 'right', y: 430, height: 48, maxTravel: 176, phase: 0.1, chip: v(262, 405) },
    { id: 'upper', side: 'left', wallX: 84, y: 240, height: 48, maxTravel: 146, phase: 0.55, chip: v(130, 216) },
  ],
  zones: [
    { x0: 230, y0: B, x1: R, y1: 380, dir: v(0, -1) },
    { x0: 84, y0: 240, x1: 230, y1: 380, dir: v(1, -0.2) },
    { x0: 84, y0: 380, x1: 170, y1: FLOOR, dir: v(0, -1) },
    { x0: 170, y0: 430, x1: R, y1: FLOOR, dir: v(-1, -0.2) },
  ],
  path: [v(282, 536), v(282, 455), v(127, 455), v(127, 264), v(288, 264), v(288, 40)],
};

export const STAGES: StageConfig[] = [STAGE_TERRACES, STAGE_CROSSOVER, STAGE_SWITCHBACK];

/** Levels cycle through the layouts; targets keep scaling (see STAGE in balance.ts). */
export function stageForLevel(level: number): StageConfig {
  return STAGES[(Math.max(1, level) - 1) % STAGES.length];
}
