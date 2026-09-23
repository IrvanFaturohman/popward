import { BALLOON, PIPE, WORLD } from '../balance';
import type { StageConfig, Vec } from './stages';

export interface Solid {
  kind: 'frame' | 'floor' | 'wall' | 'pipe';
  points: Vec[];
}

const rect = (x0: number, y0: number, x1: number, y1: number): Vec[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

export function pipeGeometry(stage: StageConfig) {
  const half = PIPE.innerWidth / 2;
  const outer = half + PIPE.wall;
  const channelBottom = stage.pipe.mouthY + PIPE.channelDepth;
  return {
    x: stage.pipe.x,
    mouthY: stage.pipe.mouthY,
    innerHalf: half,
    outerHalf: outer,
    rimHalf: outer + PIPE.rimOverhang,
    channelBottom,
    spawn: { x: stage.pipe.x, y: stage.pipe.mouthY + BALLOON.radius + 3 },
  };
}

/** Every solid collider of a stage: generated frame/floor/pipe plus the stage's interior walls. */
export function buildSolids(stage: StageConfig): Solid[] {
  const { width: W, height: H, border: B } = WORLD;
  const pipe = pipeGeometry(stage);
  const solids: Solid[] = [
    { kind: 'frame', points: rect(0, 0, B, H) },
    { kind: 'frame', points: rect(W - B, 0, W, H) },
    { kind: 'frame', points: rect(0, 0, W, B) },
    // Floor is split around the pipe so the spawn channel stays open.
    { kind: 'floor', points: rect(0, stage.floorY, pipe.x - pipe.outerHalf, H) },
    { kind: 'floor', points: rect(pipe.x + pipe.outerHalf, stage.floorY, W, H) },
    { kind: 'pipe', points: rect(pipe.x - pipe.outerHalf, pipe.mouthY, pipe.x - pipe.innerHalf, H) },
    { kind: 'pipe', points: rect(pipe.x + pipe.innerHalf, pipe.mouthY, pipe.x + pipe.outerHalf, H) },
    { kind: 'pipe', points: rect(pipe.x - pipe.innerHalf, pipe.channelBottom, pipe.x + pipe.innerHalf, H) },
  ];
  for (const points of stage.walls) solids.push({ kind: 'wall', points });
  return solids;
}
