import { WORLD } from '../balance';

export interface Vec {
  x: number;
  y: number;
}

export interface PusherConfig {
  id: 'lower' | 'upper';
  /** Wall the ram is mounted in; it pushes toward the opposite side. */
  side: 'left' | 'right';
  /** Top edge of the ram (flush with the terrace above it). */
  y: number;
  height: number;
  /** Stage-specific cap: the ram face always stays > 3 balloon widths from the opposite wall, so piles escape instead of being crushed. */
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
  /** Evolution gauge rectangle (drawn on the bottom-left wall block). */
  gauge: { x: number; y: number; w: number; h: number };
  /** Spike strip hanging from the ceiling (y = WORLD.border). */
  spikes: { x0: number; x1: number; depth: number };
  /** Interior solid geometry as convex polygons (outer frame, floor and pipe are generated). */
  walls: Vec[][];
  pushers: [PusherConfig, PusherConfig];
  /** Checked in order; first containing zone decides the rescue-nudge direction. */
  zones: FlowZone[];
  /** Readable route for debug overlay and the faint guide chevrons. */
  path: Vec[];
}

const v = (x: number, y: number): Vec => ({ x, y });
const B = WORLD.border;
const R = WORLD.width - B;
const FLOOR = 574;

/** Every stage keeps the evolution gauge in the same bottom-left block so players learn where to look. */
const GAUGE_BLOCK: Vec[] = [v(B, 468), v(76, 496), v(76, FLOOR), v(B, FLOOR)];
const GAUGE = { x: 20, y: 502, w: 50, h: 68 };

const STAGE_TERRACES: StageConfig = {
  key: 'terraces',
  name: 'Terraces',
  blurb: 'Push right, rise, push left, pop.',
  palette: { air: '#F7F7F3', airDeep: '#EEF3EF', wall: '#DCE6E2', wallShade: '#C6D5CF', wallLight: '#E9F1ED' },
  floorY: FLOOR,
  pipe: { x: 138, mouthY: 548 },
  pipeChip: v(300, 597),
  charges: v(210, 597),
  gauge: GAUGE,
  spikes: { x0: 108, x1: 202, depth: 16 },
  walls: [
    // upper terrace (spans right, opening on the left). Past the ram's reach the underside
    // rises gently toward the opening so nothing parks there forever.
    [v(126, 150), v(R, 150), v(R, 196), v(210, 196), v(140, 189), v(126, 178)],
    // lower terrace (spans left, shaft on the right), same idea mirrored
    [v(B, 352), v(244, 352), v(256, 364), v(256, 382), v(244, 390), v(150, 398), v(B, 398)],
    // ceiling ramps that funnel balloons into the spikes
    [v(B, B), v(104, B), v(B, 78)],
    [v(206, B), v(R, B), v(R, 104)],
    GAUGE_BLOCK,
    [v(R, 512), v(R, FLOOR), v(286, FLOOR)],
  ],
  pushers: [
    { id: 'lower', side: 'left', y: 398, height: 48, maxTravel: 218, phase: 0, chip: v(94, 375) },
    { id: 'upper', side: 'right', y: 196, height: 48, maxTravel: 206, phase: 0.5, chip: v(268, 173) },
  ],
  zones: [
    { x0: B, y0: B, x1: R, y1: 150, toSpikes: true },
    { x0: B, y0: 150, x1: 126, y1: 196, dir: v(0, -1) },
    { x0: B, y0: 196, x1: R, y1: 352, dir: v(-1, -0.25) },
    { x0: 256, y0: 352, x1: R, y1: FLOOR, dir: v(0, -1) },
    { x0: B, y0: 398, x1: 256, y1: FLOOR, dir: v(1, -0.2) },
  ],
  path: [v(138, 536), v(138, 422), v(300, 422), v(300, 222), v(70, 222), v(70, 110), v(150, 36)],
};

const STAGE_CROSSOVER: StageConfig = {
  key: 'crossover',
  name: 'Crossover',
  blurb: 'Pipe on the right, rams swap sides.',
  palette: { air: '#F9F6EF', airDeep: '#F2ECE1', wall: '#E7DFD2', wallShade: '#D6CBB9', wallLight: '#F1EBE1' },
  floorY: FLOOR,
  pipe: { x: 224, mouthY: 548 },
  pipeChip: v(134, 597),
  charges: v(298, 597),
  gauge: GAUGE,
  spikes: { x0: 168, x1: 262, depth: 16 },
  walls: [
    // upper terrace (spans left, opening on the right)
    [v(B, 150), v(222, 150), v(234, 162), v(234, 180), v(224, 189), v(150, 196), v(B, 196)],
    // lower terrace (spans right) with a long slanted lip that leans balloons toward the left shaft
    [v(110, 334), v(R, 334), v(R, 382), v(210, 382), v(122, 370), v(110, 358)],
    [v(B, B), v(164, B), v(B, 112)],
    [v(266, B), v(R, B), v(R, 66)],
    GAUGE_BLOCK,
    // deep chamfer gives the lower room a lopsided V silhouette
    [v(R, 470), v(R, FLOOR), v(268, FLOOR)],
  ],
  pushers: [
    { id: 'lower', side: 'right', y: 382, height: 48, maxTravel: 214, phase: 0.15, chip: v(272, 358) },
    { id: 'upper', side: 'left', y: 196, height: 48, maxTravel: 206, phase: 0.62, chip: v(92, 173) },
  ],
  zones: [
    { x0: B, y0: B, x1: R, y1: 150, toSpikes: true },
    { x0: 234, y0: 150, x1: R, y1: 196, dir: v(0, -1) },
    { x0: B, y0: 196, x1: R, y1: 334, dir: v(1, -0.25) },
    { x0: B, y0: 334, x1: 110, y1: FLOOR, dir: v(0, -1) },
    { x0: 110, y0: 358, x1: R, y1: FLOOR, dir: v(-1, -0.2) },
  ],
  path: [v(224, 536), v(224, 406), v(62, 406), v(62, 222), v(290, 222), v(290, 100), v(214, 36)],
};

const STAGE_SWITCHBACK: StageConfig = {
  key: 'switchback',
  name: 'Switchback',
  blurb: 'Three tiers — a slanted ramp does the middle leg.',
  palette: { air: '#F6F7F9', airDeep: '#EDEFF5', wall: '#DDE0EC', wallShade: '#C8CCDD', wallLight: '#EAECF4' },
  floorY: FLOOR,
  pipe: { x: 132, mouthY: 548 },
  pipeChip: v(298, 597),
  charges: v(204, 597),
  gauge: GAUGE,
  spikes: { x0: 238, x1: 334, depth: 16 },
  walls: [
    // top terrace (spans left, opening on the right)
    [v(B, 118), v(232, 118), v(244, 130), v(244, 142), v(234, 150), v(150, 158), v(B, 158)],
    // passive ramp: its underside rises to the left, so buoyancy alone walks balloons across
    [v(126, 250), v(R, 250), v(R, 320), v(138, 264), v(126, 257)],
    // lower terrace (spans left, shaft on the right)
    [v(B, 380), v(236, 380), v(248, 392), v(248, 404), v(238, 412), v(150, 420), v(B, 420)],
    // big sloped ceiling that slides balloons right into the spikes
    [v(B, B), v(230, B), v(150, 70), v(B, 100)],
    GAUGE_BLOCK,
    [v(R, 500), v(R, FLOOR), v(282, FLOOR)],
  ],
  pushers: [
    { id: 'lower', side: 'left', y: 420, height: 44, maxTravel: 212, phase: 0.1, chip: v(94, 400) },
    { id: 'upper', side: 'left', y: 158, height: 44, maxTravel: 210, phase: 0.55, chip: v(94, 138) },
  ],
  zones: [
    { x0: B, y0: B, x1: R, y1: 118, toSpikes: true },
    { x0: 244, y0: 118, x1: R, y1: 158, dir: v(0, -1) },
    { x0: B, y0: 158, x1: R, y1: 250, dir: v(1, -0.25) },
    { x0: B, y0: 250, x1: 126, y1: 380, dir: v(0, -1) },
    { x0: 126, y0: 250, x1: R, y1: 380, dir: v(-1, -0.3) },
    { x0: 248, y0: 380, x1: R, y1: FLOOR, dir: v(0, -1) },
    { x0: B, y0: 420, x1: 248, y1: FLOOR, dir: v(1, -0.2) },
  ],
  path: [v(132, 536), v(132, 442), v(298, 442), v(298, 332), v(150, 290), v(70, 290), v(70, 180), v(292, 180), v(292, 40)],
};

export const STAGES: StageConfig[] = [STAGE_TERRACES, STAGE_CROSSOVER, STAGE_SWITCHBACK];

/** Levels cycle through the layouts; targets keep scaling (see STAGE in balance.ts). */
export function stageForLevel(level: number): StageConfig {
  return STAGES[(Math.max(1, level) - 1) % STAGES.length];
}
