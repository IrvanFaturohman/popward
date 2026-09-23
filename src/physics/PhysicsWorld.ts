import Matter from 'matter-js';
import { BALLOON, SIM, WORLD } from '../balance';
import { buildSolids } from '../config/geometry';
import type { PusherConfig, StageConfig } from '../config/stages';

const { Engine, Bodies, Body, Composite, Events, Vertices, Query, Pairs } = Matter;

/**
 * Thin wrapper around Matter.js. Gravity is disabled: each balloon gets its own buoyancy force so
 * lift, drift and speed caps are tunable per balloon without affecting static geometry.
 */
export class PhysicsWorld {
  readonly engine: Matter.Engine;
  readonly substepMs = 1000 / SIM.stepHz / SIM.substeps;
  private solids: Matter.Body[] = [];
  onCollisionStart: ((pairs: Matter.Pair[]) => void) | null = null;
  /** Called every substep with all touching pairs (new and ongoing). */
  onContacts: ((pairs: Matter.Pair[]) => void) | null = null;

  constructor() {
    this.engine = Engine.create({
      gravity: { x: 0, y: 0, scale: 0 },
      positionIterations: SIM.positionIterations,
      velocityIterations: SIM.velocityIterations,
      enableSleeping: false,
    });
    Events.on(this.engine, 'collisionStart', (e) => {
      this.onCollisionStart?.(e.pairs);
      this.onContacts?.(e.pairs);
    });
    Events.on(this.engine, 'collisionActive', (e) => this.onContacts?.(e.pairs));
  }

  buildStage(stage: StageConfig): void {
    Composite.clear(this.engine.world, false, true);
    Pairs.clear(this.engine.pairs);
    this.solids = [];
    for (const solid of buildSolids(stage)) this.solids.push(this.addStatic(solid.points, solid.kind));
    // Invisible safety frame outside the world: anything that tunnels through a border is caught here
    // and returned to the pipe by the recovery pass instead of flying away forever.
    const { width: W, height: H } = WORLD;
    const t = 200;
    const frame = [
      Bodies.rectangle(-t / 2, H / 2, t, H + t * 2, { isStatic: true, label: 'safety' }),
      Bodies.rectangle(W + t / 2, H / 2, t, H + t * 2, { isStatic: true, label: 'safety' }),
      Bodies.rectangle(W / 2, -t / 2, W + t * 2, t, { isStatic: true, label: 'safety' }),
      Bodies.rectangle(W / 2, H + t / 2, W + t * 2, t, { isStatic: true, label: 'safety' }),
    ];
    Composite.add(this.engine.world, frame);
  }

  private addStatic(points: { x: number; y: number }[], label: string): Matter.Body {
    const verts = Vertices.clockwiseSort(points.map((p) => ({ x: p.x, y: p.y })));
    const centre = Vertices.centre(verts);
    const body = Body.create({
      position: centre,
      vertices: verts,
      isStatic: true,
      label,
      friction: 0,
      frictionStatic: 0,
      restitution: 0.1,
    });
    Composite.add(this.engine.world, body);
    return body;
  }

  addBalloon(x: number, y: number): Matter.Body {
    const body = Bodies.circle(
      x,
      y,
      BALLOON.radius,
      {
        label: 'balloon',
        frictionAir: BALLOON.airFriction,
        friction: BALLOON.friction,
        frictionStatic: BALLOON.frictionStatic,
        restitution: BALLOON.restitution,
        density: BALLOON.density,
        slop: 0.03,
      },
      BALLOON.colliderSides,
    );
    // Slightly tall oval: contacts off the main axes create torque, so balloons turn, tumble and can end up upside down.
    Body.scale(body, BALLOON.shapeX, BALLOON.shapeY);
    Body.setInertia(body, body.inertia * BALLOON.inertiaScale);
    body.deltaTime = this.substepMs;
    Composite.add(this.engine.world, body);
    return body;
  }

  /**
   * Pushers are static bodies moved with setPosition(..., updateVelocity=true) every substep.
   * Matter then treats them as infinite-mass kinematic bodies: overlaps are resolved by moving the
   * balloons only, and the ram's velocity is transferred through the contact solver.
   */
  addPusher(cfg: PusherConfig, length: number): Matter.Body {
    const body = Bodies.rectangle(0, 0, length, cfg.height + 2, {
      isStatic: true,
      label: 'pusher',
      friction: 0,
      frictionStatic: 0,
      restitution: 0.05,
      chamfer: { radius: 4 },
    });
    Composite.add(this.engine.world, body);
    return body;
  }

  remove(body: Matter.Body): void {
    Composite.remove(this.engine.world, body);
  }

  step(): void {
    Engine.update(this.engine, this.substepMs);
  }

  pointInSolid(x: number, y: number): boolean {
    return Query.point(this.solids, { x, y }).length > 0;
  }
}

/** Velocity in world units per second (Matter stores it per step). */
export function getVelocity(body: Matter.Body): { x: number; y: number } {
  const k = 1000 / (body.deltaTime || 1000 / 60);
  return { x: (body.position.x - body.positionPrev.x) * k, y: (body.position.y - body.positionPrev.y) * k };
}

export function setVelocity(body: Matter.Body, vx: number, vy: number): void {
  const k = (body.deltaTime || 1000 / 60) / 1000;
  body.positionPrev.x = body.position.x - vx * k;
  body.positionPrev.y = body.position.y - vy * k;
  body.velocity.x = vx * k;
  body.velocity.y = vy * k;
}

const setPositionRaw = Body.setPosition as unknown as (
  body: Matter.Body,
  position: Matter.Vector,
  updateVelocity?: boolean,
) => void;

/** Moves a body; with updateVelocity the displacement becomes its velocity (used for kinematic rams). */
export function moveBody(body: Matter.Body, x: number, y: number, updateVelocity: boolean): void {
  setPositionRaw(body, { x, y }, updateVelocity);
}

/** Applies an acceleration in u/s² for the next Matter update (force = m·a, Matter works in ms). */
export function applyAccel(body: Matter.Body, ax: number, ay: number): void {
  body.force.x += body.mass * ax * 1e-6;
  body.force.y += body.mass * ay * 1e-6;
}

/**
 * Same as applyAccel, but the force acts at a point given in body-local coordinates (x right, y down),
 * so it also produces torque.
 */
export function applyAccelAt(body: Matter.Body, localX: number, localY: number, ax: number, ay: number): void {
  const c = Math.cos(body.angle);
  const s = Math.sin(body.angle);
  const ox = localX * c - localY * s;
  const oy = localX * s + localY * c;
  const fx = body.mass * ax * 1e-6;
  const fy = body.mass * ay * 1e-6;
  body.force.x += fx;
  body.force.y += fy;
  body.torque += ox * fy - oy * fx;
}

/** Clamps angular speed (rad/s) using the same position-based bookkeeping Matter integrates with. */
export function clampSpin(body: Matter.Body, maxRadPerSec: number): void {
  const max = maxRadPerSec * ((body.deltaTime || 1000 / 60) / 1000);
  const w = body.angle - body.anglePrev;
  if (w > max) body.anglePrev = body.angle - max;
  else if (w < -max) body.anglePrev = body.angle + max;
}

/**
 * Spin-only rubber grip. Nudges the angular velocity of each dynamic body so the contact points stop slipping
 * along the tangent, but leaves linear velocity alone — balloons roll and tumble without piles welding together.
 */
export function applyRollingGrip(pair: Matter.Pair, grip: number, dynamicA: boolean, dynamicB: boolean): void {
  const col = pair.collision;
  const n = col.supportCount ?? 0;
  if (!n) return;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < n; i++) {
    cx += col.supports[i].x;
    cy += col.supports[i].y;
  }
  cx /= n;
  cy /= n;
  const A = col.parentA;
  const B = col.parentB;
  const t = col.tangent;
  const pointVel = (b: Matter.Body) => {
    const w = b.angle - b.anglePrev;
    return {
      x: b.position.x - b.positionPrev.x - w * (cy - b.position.y),
      y: b.position.y - b.positionPrev.y + w * (cx - b.position.x),
    };
  };
  const va = pointVel(A);
  const vb = pointVel(B);
  const slip = (va.x - vb.x) * t.x + (va.y - vb.y) * t.y;
  const share = dynamicA && dynamicB ? 0.5 : 1;
  const spin = (b: Matter.Body, dv: number) => {
    const ox = cx - b.position.x;
    const oy = cy - b.position.y;
    const cross = ox * t.y - oy * t.x;
    if (Math.abs(cross) < 1e-3) return;
    b.anglePrev -= (grip * dv) / cross;
  };
  if (dynamicA) spin(A, -slip * share);
  if (dynamicB) spin(B, slip * share);
}

/** Puts a body upright with no spin (used when a lost balloon is returned to the pipe). */
export function resetAngle(body: Matter.Body): void {
  Body.setAngle(body, 0);
  body.anglePrev = body.angle;
}
