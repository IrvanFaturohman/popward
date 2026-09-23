import type Matter from 'matter-js';
import { PUSHER, WORLD } from '../balance';
import type { PusherConfig } from '../config/stages';
import { moveBody } from '../physics/PhysicsWorld';
import { easeInOutQuad, easeInOutSine, easeInSine, easeOutCubic, lerp } from '../util/math';

export type PusherPhase = 'rest' | 'windup' | 'extend' | 'hold' | 'retract';

const P = PUSHER.phases;
const T_WINDUP = P.rest;
const T_EXTEND = T_WINDUP + P.windup;
const T_HOLD = T_EXTEND + P.extend;
const T_RETRACT = T_HOLD + P.hold;

/**
 * A wall-mounted ram on a fixed cycle: rest → wind-up (small pull-back) → extend → hold → retract.
 * The collider is the whole ram block (not just the face) so nothing can slip in behind it.
 */
export class Pusher {
  readonly cfg: PusherConfig;
  readonly body: Matter.Body;
  readonly length: number;
  readonly wallX: number;
  /** +1 pushes right, -1 pushes left. */
  readonly dir: 1 | -1;

  u: number;
  cycleSec: number;
  travel: number;
  private pendingTravel: number | null = null;

  ext = 0;
  prevExt = 0;
  phase: PusherPhase = 'rest';
  impactThisCycle = false;

  /** Visual-only: purchase highlight and impact jolt, both decay to 0. */
  flash = 0;
  jolt = 0;

  onPhaseChange: ((phase: PusherPhase) => void) | null = null;

  constructor(cfg: PusherConfig, body: Matter.Body, length: number, cycleSec: number, travel: number) {
    this.cfg = cfg;
    this.body = body;
    this.length = length;
    this.dir = cfg.side === 'left' ? 1 : -1;
    this.wallX = cfg.side === 'left' ? WORLD.border : WORLD.width - WORLD.border;
    this.u = cfg.phase;
    this.cycleSec = cycleSec;
    this.travel = travel;
    const state = this.sample(this.u);
    this.ext = this.prevExt = state.ext;
    this.phase = state.phase;
    const c = this.centerFor(this.ext);
    moveBody(this.body, c.x, c.y, false);
  }

  /** Upgrades change speed immediately; travel changes wait for the next rest so the ram never jumps. */
  setParams(cycleSec: number, travel: number): void {
    this.cycleSec = cycleSec;
    if (travel !== this.travel) this.pendingTravel = travel;
  }

  beginTick(): void {
    this.prevExt = this.ext;
  }

  step(dt: number): void {
    this.u += dt / this.cycleSec;
    if (this.u >= 1) {
      this.u -= 1;
      this.impactThisCycle = false;
      if (this.pendingTravel !== null) {
        this.travel = this.pendingTravel;
        this.pendingTravel = null;
      }
    }
    const next = this.sample(this.u);
    if (next.phase !== this.phase) {
      this.phase = next.phase;
      this.onPhaseChange?.(next.phase);
    }
    this.ext = next.ext;
    const c = this.centerFor(this.ext);
    moveBody(this.body, c.x, c.y, true);
  }

  decayVisuals(dt: number): void {
    this.flash = Math.max(0, this.flash - dt * 1.6);
    this.jolt = Math.max(0, this.jolt - dt * 5);
  }

  sample(u: number): { phase: PusherPhase; ext: number } {
    const w = PUSHER.windupDist;
    if (u < T_WINDUP) return { phase: 'rest', ext: 0 };
    if (u < T_EXTEND) return { phase: 'windup', ext: -w * easeOutCubic((u - T_WINDUP) / P.windup) };
    if (u < T_HOLD) {
      // Blend of a braking stroke and one that hits the end stop at speed (see PUSHER.punch):
      // balloons far from the wall still get a real shove instead of a ram that has already stopped.
      const t = (u - T_EXTEND) / P.extend;
      const k = lerp(easeInOutSine(t), easeInSine(t), PUSHER.punch);
      return { phase: 'extend', ext: -w + (this.travel + w) * k };
    }
    if (u < T_RETRACT) return { phase: 'hold', ext: this.travel };
    return { phase: 'retract', ext: this.travel * (1 - easeInOutQuad((u - T_RETRACT) / P.retract)) };
  }

  faceX(ext = this.ext): number {
    return this.wallX + this.dir * ext;
  }

  private centerFor(ext: number): { x: number; y: number } {
    return {
      x: this.faceX(ext) - (this.dir * this.length) / 2,
      // The block overlaps 2 units into the terrace above so no crack exists for a balloon to wedge into.
      y: this.cfg.y - 2 + (this.cfg.height + 2) / 2,
    };
  }
}
