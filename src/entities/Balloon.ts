import type Matter from 'matter-js';
import { BALLOON, EVOLUTION } from '../balance';
import type { Tier } from '../game/UpgradeSystem';

let nextId = 1;

/** One balloon: a Matter circle plus purely visual state (squash, wobble, colour tween). */
export class Balloon {
  readonly id = nextId++;
  readonly body: Matter.Body;
  readonly seed = Math.random();
  readonly bornAt: number;
  tier: Tier = 'red';
  popped = false;

  /** Previous-tick pose for render interpolation. */
  prevX: number;
  prevY: number;
  prevAngle = 0;

  /** 0..1 scale-in after spawning. */
  spawnT = 0;
  /** 0..1 red → teal colour tween (only moves once evolved). */
  evolveT = 0;
  /** An evolution spark is flying toward this balloon. */
  targeted = false;

  // Damped squash oscillation along the last impact normal.
  squashAmp = 0;
  squashAngle = 0;
  squashT = 0;

  // Stuck-rescue bookkeeping.
  anchorX: number;
  anchorY: number;
  anchorAt: number;
  rescues = 0;
  lastRescueAt = -99;
  insideWallFor = 0;
  zone = -1;
  zoneSince = 0;

  constructor(body: Matter.Body, simTime: number) {
    this.body = body;
    this.bornAt = simTime;
    this.prevX = this.anchorX = body.position.x;
    this.prevY = this.anchorY = body.position.y;
    this.anchorAt = simTime;
  }

  get x(): number {
    return this.body.position.x;
  }

  get y(): number {
    return this.body.position.y;
  }

  get angle(): number {
    return this.body.angle;
  }

  age(simTime: number): number {
    return simTime - this.bornAt;
  }

  /** Visual response to an impact (strength in u/s of normal relative speed). */
  hit(strength: number, normalAngle: number): void {
    const amp = Math.min(0.17, strength / 900);
    if (amp > this.squashAmp * 0.6) {
      this.squashAmp = amp;
      this.squashAngle = normalAngle;
      this.squashT = 0;
    }
  }

  /** Current squash factor (positive = compressed along the impact normal). */
  get squash(): number {
    if (this.squashAmp < 0.002) return 0;
    return this.squashAmp * Math.cos(this.squashT * 30) * Math.exp(-this.squashT * 9);
  }

  updateVisual(dt: number): void {
    if (this.spawnT < 1) this.spawnT = Math.min(1, this.spawnT + dt / BALLOON.spawnScaleSec);
    if (this.tier === 'blue' && this.evolveT < 1) this.evolveT = Math.min(1, this.evolveT + dt / EVOLUTION.tweenSec);
    if (this.squashAmp > 0) {
      this.squashT += dt;
      if (this.squashT > 0.6) this.squashAmp = 0;
    }
  }
}
