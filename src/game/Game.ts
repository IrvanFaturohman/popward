import type Matter from 'matter-js';
import {
  BALLOON,
  EVOLUTION,
  FX,
  RECOVERY,
  RESCUE,
  SAVE,
  SIM,
  SPAWN,
  STAGE,
  WORLD,
  type UpgradeId,
} from '../balance';
import { pipeGeometry } from '../config/geometry';
import { stageForLevel, type StageConfig } from '../config/stages';
import { Balloon } from '../entities/Balloon';
import { Pusher } from '../entities/Pusher';
import {
  applyAccelAt,
  applyRollingGrip,
  clampSpin,
  getVelocity,
  moveBody,
  PhysicsWorld,
  resetAngle,
  setVelocity,
} from '../physics/PhysicsWorld';
import { Particles } from '../render/Particles';
import { EventBus } from '../util/EventBus';
import { circleHitsRect } from '../util/math';
import { Economy } from './Economy';
import type { GameEvents, SpawnFailReason } from './events';
import { clearSave, createState, persistState, type GameState } from './GameState';
import { UpgradeSystem } from './UpgradeSystem';

export type Mode = 'playing' | 'celebrating' | 'cleared';

const STEP = 1 / SIM.stepHz;
const SUB = STEP / SIM.substeps;

/**
 * Owns the simulation: fixed-step loop, spawning, pushers, evolution, pops, stage flow and saving.
 * Rendering, UI and audio only observe it (via state reads and the event bus).
 */
export class Game {
  readonly bus = new EventBus<GameEvents>();
  readonly physics = new PhysicsWorld();
  readonly particles = new Particles();
  state: GameState;
  economy: Economy;
  upgrades: UpgradeSystem;

  stage!: StageConfig;
  balloons: Balloon[] = [];
  pushers: Pusher[] = [];
  private balloonByBody = new Map<number, Balloon>();
  private pusherByBody = new Map<number, Pusher>();

  simTime = 0;
  private acc = 0;
  alpha = 0;
  /** Simulation speed multiplier (debug only). */
  speed = 1;
  hidden = false;
  menuOpen = false;

  // Spawning
  private holding = false;
  private holdTimer = 0;
  private idleTime = 0;
  private autoTimer = 0;
  private lastFailAt = -99;
  pipeSquash = 0;
  chargeFlash = 0;

  // Evolution
  spark: { balloon: Balloon; t: number } | null = null;
  evoWaiting = false;

  // Pops
  chain = 0;
  private lastPopAt = -99;
  private recentPops: number[] = [];
  shake = 0;

  // Stage flow
  celebrateT = -1;

  // Maintenance
  private rescueTimer = 0;
  private lastRescueAt = -99;
  rescueCount = 0;
  private recoveryTimer = 0;
  recoveryCount = 0;
  private saveTimer = 0;
  private dirty = false;

  constructor(state: GameState) {
    this.state = state;
    this.economy = new Economy(state, this.bus);
    this.upgrades = new UpgradeSystem(state, this.economy, this.bus);
    this.physics.onCollisionStart = (pairs) => this.onCollisions(pairs);
    this.physics.onContacts = (pairs) => {
      for (const pair of pairs) {
        if (!pair.isActive) continue;
        const a = this.balloonByBody.has(pair.collision.parentA.id);
        const b = this.balloonByBody.has(pair.collision.parentB.id);
        if (a || b) applyRollingGrip(pair, BALLOON.gripSpin, a, b);
      }
    };
    this.bus.on('moneyChanged', () => (this.dirty = true));
    this.loadStage();
    this.state.charges = this.upgrades.maxCharges();
  }

  get mode(): Mode {
    if (!this.state.stageCleared) return 'playing';
    return this.celebrateT >= 0 && this.celebrateT < STAGE.celebrateSec ? 'celebrating' : 'cleared';
  }

  get target(): number {
    return this.economy.target();
  }

  get spawnPoint() {
    return pipeGeometry(this.stage).spawn;
  }

  // ---------------------------------------------------------------- stage setup

  loadStage(): void {
    for (const b of this.balloons) b.popped = true;
    this.balloons = [];
    this.balloonByBody.clear();
    this.pusherByBody.clear();
    this.spark = null;
    this.particles.clear();

    this.stage = stageForLevel(this.state.level);
    this.physics.buildStage(this.stage);
    this.pushers = this.stage.pushers.map((cfg) => {
      const id = cfg.id === 'lower' ? 'lowerPusher' : 'upperPusher';
      const length = cfg.maxTravel + 60;
      const body = this.physics.addPusher(cfg, length);
      const pusher = new Pusher(
        cfg,
        body,
        length,
        this.upgrades.pusherCycleSec(id),
        this.upgrades.pusherTravel(id, cfg.maxTravel),
      );
      pusher.onPhaseChange = (phase) => {
        if (phase === 'extend' && this.mode !== 'cleared') this.bus.emit('pusherPush', { pusher });
      };
      this.pusherByBody.set(body.id, pusher);
      return pusher;
    });
    this.idleTime = 0;
    this.autoTimer = 1;
    this.celebrateT = this.state.stageCleared ? STAGE.celebrateSec : -1;
  }

  continueToNextStage(): void {
    if (!this.state.stageCleared) return;
    this.state.level += 1;
    this.state.progress = 0;
    this.state.stageCleared = false;
    this.state.stageBonus = 0;
    this.state.stageEarned = 0;
    this.state.charges = this.upgrades.maxCharges();
    this.loadStage();
    this.save();
    this.bus.emit('stageStart', { level: this.state.level });
  }

  resetProgress(): void {
    clearSave();
    const fresh = createState();
    fresh.hintDone = this.state.hintDone;
    Object.assign(this.state, fresh);
    this.state.charges = this.upgrades.maxCharges();
    this.loadStage();
    this.save();
    this.bus.emit('stageStart', { level: this.state.level });
    this.bus.emit('moneyChanged', { money: this.state.money, delta: 0 });
  }

  // ---------------------------------------------------------------- input

  press(): void {
    this.idleTime = 0;
    this.autoTimer = 0.4;
    this.holding = true;
    this.holdTimer = SPAWN.holdIntervalSec;
    this.trySpawnFromInput(true);
  }

  release(): void {
    this.holding = false;
  }

  buy(id: UpgradeId): boolean {
    const ok = this.upgrades.buy(id);
    if (ok) {
      this.applyUpgrades();
      if (id === 'pipe') this.state.charges = Math.min(this.upgrades.maxCharges(), this.state.charges + 1);
      this.save();
    }
    return ok;
  }

  applyUpgrades(): void {
    for (const p of this.pushers) {
      const id = p.cfg.id === 'lower' ? 'lowerPusher' : 'upperPusher';
      p.setParams(this.upgrades.pusherCycleSec(id), this.upgrades.pusherTravel(id, p.cfg.maxTravel));
    }
  }

  // ---------------------------------------------------------------- loop

  /** Called once per animation frame with real elapsed seconds. */
  frame(dtReal: number): void {
    const dt = Math.min(SIM.maxFrameSec, Math.max(0, dtReal));
    if (this.hidden) return;
    const paused = this.menuOpen || this.mode === 'cleared';
    if (!paused) {
      this.acc += dt * this.speed;
      const maxSteps = SIM.maxCatchUpSteps * Math.max(1, Math.ceil(this.speed));
      let steps = 0;
      while (this.acc >= STEP && steps < maxSteps) {
        this.tick(STEP);
        this.acc -= STEP;
        steps++;
      }
      if (steps >= maxSteps) this.acc = 0;
    }
    this.alpha = paused ? 1 : this.acc / STEP;
    if (!this.menuOpen) this.particles.update(dt);
    this.shake = Math.max(0, this.shake - dt * 10);
  }

  /** Resets the accumulator (after tab resume) so no burst of catch-up steps happens. */
  resetClock(): void {
    this.acc = 0;
  }

  private tick(dt: number): void {
    this.simTime += dt;
    const playing = this.mode === 'playing';

    if (playing) {
      this.updateSpawning(dt);
      this.updateEvolution(dt);
    }

    for (const b of this.balloons) {
      b.prevX = b.x;
      b.prevY = b.y;
      b.prevAngle = b.angle;
    }
    for (const p of this.pushers) p.beginTick();

    const maxStep = BALLOON.maxSpeed;
    for (let s = 0; s < SIM.substeps; s++) {
      for (const p of this.pushers) p.step(SUB);
      const t = this.simTime + s * SUB;
      const r = BALLOON.radius;
      for (const b of this.balloons) {
        const drift = Math.sin(t * 0.9 + b.seed * 40) * 0.7 + Math.sin(t * 2.3 + b.seed * 13) * 0.3;
        // Lift above the centre rights the balloon; drift at the knot makes it sway.
        applyAccelAt(b.body, 0, -BALLOON.liftOffset * r, 0, -BALLOON.buoyancy);
        applyAccelAt(b.body, 0, r * 0.9, BALLOON.driftAccel * drift, 0);
      }
      this.physics.step();
      for (const b of this.balloons) {
        const v = getVelocity(b.body);
        const speed = Math.hypot(v.x, v.y);
        if (speed > maxStep) setVelocity(b.body, (v.x / speed) * maxStep, (v.y / speed) * maxStep);
        clampSpin(b.body, BALLOON.maxSpin);
      }
    }

    this.checkPops();

    this.rescueTimer += dt;
    if (this.rescueTimer >= RESCUE.checkSec) {
      this.rescueTimer = 0;
      this.rescueStuck();
    }
    this.recoveryTimer += dt;
    if (this.recoveryTimer >= RECOVERY.checkSec) {
      this.recoveryTimer = 0;
      this.recoverLost();
    }

    for (const b of this.balloons) b.updateVisual(dt);
    for (const p of this.pushers) p.decayVisuals(dt);
    this.pipeSquash = Math.max(0, this.pipeSquash - dt * 4);
    this.chargeFlash = Math.max(0, this.chargeFlash - dt * 2.5);

    if (playing && this.economy.stageDone) this.completeStage();
    if (this.celebrateT >= 0 && this.celebrateT < STAGE.celebrateSec) this.celebrateT += dt;

    this.saveTimer += dt;
    if (this.dirty && this.saveTimer >= SAVE.throttleSec) this.save();
  }

  // ---------------------------------------------------------------- spawning

  private updateSpawning(dt: number): void {
    const max = this.upgrades.maxCharges();
    if (this.state.charges < max) {
      this.state.charges = Math.min(max, this.state.charges + dt / this.upgrades.rechargeSec());
    } else {
      this.state.charges = max;
    }

    if (this.holding) {
      this.idleTime = 0;
      this.holdTimer -= dt;
      if (this.holdTimer <= 0) {
        this.holdTimer += SPAWN.holdIntervalSec;
        this.trySpawnFromInput(false);
      }
      return;
    }

    this.idleTime += dt;
    if (this.idleTime >= SPAWN.idleDelaySec) {
      this.autoTimer -= dt;
      if (this.autoTimer <= 0) {
        // Idle spawns are free but obey the active cap and a clear pipe mouth.
        if (this.balloons.length < SPAWN.maxActive && !this.mouthBlocked()) {
          this.spawnBalloon(true);
          this.autoTimer = this.upgrades.autoSpawnSec();
        } else {
          this.autoTimer = 0.3;
        }
      }
    }
  }

  private spawnBlockReason(): SpawnFailReason | null {
    if (this.balloons.length >= SPAWN.maxActive) return 'full';
    if (this.state.charges < 1) return 'empty';
    if (this.mouthBlocked()) return 'blocked';
    return null;
  }

  private trySpawnFromInput(fromPress: boolean): void {
    if (this.mode !== 'playing') return;
    const reason = this.spawnBlockReason();
    if (reason) {
      // "blocked" clears itself within a few frames; only report it on a fresh tap.
      if (reason === 'blocked' && !fromPress) return;
      if (fromPress || this.simTime - this.lastFailAt >= SPAWN.failFeedbackSec) {
        this.lastFailAt = this.simTime;
        this.chargeFlash = 1;
        this.bus.emit('spawnFail', { reason });
      }
      return;
    }
    this.state.charges -= 1;
    this.spawnBalloon(false);
  }

  private mouthBlocked(): boolean {
    const sp = this.spawnPoint;
    const minD = BALLOON.radius * 2 * 0.92;
    for (const b of this.balloons) {
      const dx = b.x - sp.x;
      const dy = b.y - sp.y;
      if (dx * dx + dy * dy < minD * minD) return true;
    }
    return false;
  }

  private spawnBalloon(auto: boolean): Balloon {
    const sp = this.spawnPoint;
    const body = this.physics.addBalloon(sp.x, sp.y);
    setVelocity(body, (Math.random() - 0.5) * 20, -BALLOON.spawnSpeed);
    const balloon = new Balloon(body, this.simTime);
    this.balloons.push(balloon);
    this.balloonByBody.set(body.id, balloon);
    this.pipeSquash = 1;
    this.bus.emit('spawn', { balloon, auto });
    return balloon;
  }

  // ---------------------------------------------------------------- evolution

  private updateEvolution(dt: number): void {
    if (this.spark) {
      const s = this.spark;
      if (s.balloon.popped) {
        // Target popped while charging: refund the full meter so the evolution is never lost.
        this.spark = null;
        this.state.evo = 1;
      } else {
        s.t += dt / EVOLUTION.sparkSec;
        if (s.t >= 1) {
          this.spark = null;
          this.evolve(s.balloon);
        }
      }
    }

    if (this.state.evo < 1) {
      this.state.evo = Math.min(1, this.state.evo + dt / this.upgrades.evolutionSec());
    }
    this.evoWaiting = false;
    if (this.state.evo >= 1 && !this.spark) {
      const candidate = this.oldestRed();
      if (candidate) {
        candidate.targeted = true;
        this.spark = { balloon: candidate, t: 0 };
        this.state.evo = 0;
        this.bus.emit('evolveStart', { balloon: candidate });
      } else {
        this.evoWaiting = true;
      }
    }
  }

  private oldestRed(): Balloon | null {
    let best: Balloon | null = null;
    for (const b of this.balloons) {
      if (b.tier !== 'red' || b.popped || b.targeted) continue;
      if (b.age(this.simTime) < EVOLUTION.minAgeSec) continue;
      if (!best || b.bornAt < best.bornAt) best = b;
    }
    return best;
  }

  private evolve(b: Balloon): void {
    b.targeted = false;
    b.tier = 'blue';
    b.evolveT = 0;
    this.state.stats.blues += 1;
    this.bus.emit('evolve', { balloon: b });
  }

  // ---------------------------------------------------------------- pops

  private checkPops(): void {
    const s = this.stage.spikes;
    const B = WORLD.border;
    const r = BALLOON.radius * 0.96;
    let popped: Balloon[] | null = null;
    for (const b of this.balloons) {
      if (circleHitsRect(b.x, b.y, r, s.x0, B - 4, s.x1, B + s.depth)) (popped ??= []).push(b);
    }
    if (popped) for (const b of popped) this.pop(b);
  }

  private pop(b: Balloon): void {
    if (b.popped) return; // guard against double awards
    b.popped = true;
    this.physics.remove(b.body);
    this.balloonByBody.delete(b.body.id);
    const i = this.balloons.indexOf(b);
    if (i >= 0) this.balloons.splice(i, 1);

    const value = this.upgrades.balloonValue(b.tier);
    this.economy.earnFromPop(value);
    this.state.stats.pops += 1;

    this.chain = this.simTime - this.lastPopAt <= FX.chainWindowSec ? this.chain + 1 : 1;
    this.lastPopAt = this.simTime;
    this.recentPops.push(this.simTime);
    while (this.recentPops.length && this.simTime - this.recentPops[0] > 0.3) this.recentPops.shift();
    if (this.recentPops.length >= FX.clusterShakePops) this.shake = 1;

    this.bus.emit('pop', { balloon: b, value, x: b.x, y: b.y, chain: this.chain });
  }

  private completeStage(): void {
    const bonus = this.economy.bonusFor();
    this.state.stageCleared = true;
    this.state.stageEarned = this.state.progress;
    this.state.stageBonus = bonus;
    this.economy.grant(bonus);
    this.celebrateT = 0;
    this.holding = false;
    this.save();
    this.bus.emit('stageComplete', { level: this.state.level, bonus });
  }

  // ---------------------------------------------------------------- maintenance

  /**
   * Gentle, visible nudge along the route for balloons that are wedged (barely moving) or that have
   * wandered inside one route zone for too long. Never teleports and never pops.
   */
  private rescueStuck(): void {
    const now = this.simTime;
    let worst: Balloon | null = null;
    let worstFor = 0;
    for (const b of this.balloons) {
      const dx = b.x - b.anchorX;
      const dy = b.y - b.anchorY;
      if (dx * dx + dy * dy > RESCUE.moveTolerance * RESCUE.moveTolerance) {
        b.anchorX = b.x;
        b.anchorY = b.y;
        b.anchorAt = now;
      }
      const zone = this.zoneIndex(b.x, b.y);
      if (zone !== b.zone) {
        b.zone = zone;
        b.zoneSince = now;
      }
      const wedged = now - b.anchorAt;
      const dwelling = now - b.zoneSince;
      const stuckFor = Math.max(wedged - RESCUE.stuckSec, dwelling - RESCUE.zoneDwellSec);
      if (stuckFor < 0 || b.rescues >= RESCUE.maxPerBalloon) continue;
      if (now - b.lastRescueAt < RESCUE.cooldownSec) continue;
      if (!this.isIsolated(b)) continue;
      if (!worst || stuckFor > worstFor) {
        worst = b;
        worstFor = stuckFor;
      }
    }
    if (!worst || now - this.lastRescueAt < RESCUE.globalCooldownSec) return;
    const dir = this.flowDirection(worst.x, worst.y);
    if (!dir) return;
    const v = getVelocity(worst.body);
    setVelocity(worst.body, v.x + dir.x * RESCUE.impulse, v.y + dir.y * RESCUE.impulse);
    worst.rescues += 1;
    worst.lastRescueAt = now;
    worst.anchorAt = now;
    worst.zoneSince = now - RESCUE.zoneDwellSec * 0.5;
    this.lastRescueAt = now;
    this.rescueCount += 1;
    this.bus.emit('rescue', { balloon: worst, dx: dir.x, dy: dir.y });
  }

  private isIsolated(b: Balloon): boolean {
    const d = BALLOON.radius * 2 * RESCUE.isolationDiameters;
    for (const o of this.balloons) {
      if (o === b) continue;
      const dx = o.x - b.x;
      const dy = o.y - b.y;
      if (dx * dx + dy * dy < d * d) return false;
    }
    return true;
  }

  private zoneIndex(x: number, y: number): number {
    const zones = this.stage.zones;
    for (let i = 0; i < zones.length; i++) {
      const z = zones[i];
      if (x >= z.x0 && x <= z.x1 && y >= z.y0 && y <= z.y1) return i;
    }
    return -1;
  }

  flowDirection(x: number, y: number): { x: number; y: number } | null {
    for (const z of this.stage.zones) {
      if (x < z.x0 || x > z.x1 || y < z.y0 || y > z.y1) continue;
      let dx: number;
      let dy: number;
      if (z.toSpikes) {
        const s = this.stage.spikes;
        dx = (s.x0 + s.x1) / 2 - x;
        dy = WORLD.border - y;
      } else {
        dx = z.dir!.x;
        dy = z.dir!.y;
      }
      const len = Math.hypot(dx, dy) || 1;
      return { x: dx / len, y: dy / len };
    }
    return null;
  }

  /** Returns tunnelled or escaped balloons to the pipe (no reward, not lost). */
  private recoverLost(): void {
    const { width: W, height: H } = WORLD;
    const m = RECOVERY.margin;
    for (const b of this.balloons) {
      const { x, y } = b.body.position;
      const out = !Number.isFinite(x) || !Number.isFinite(y) || x < -m || x > W + m || y < -m || y > H + m;
      if (!out) {
        b.insideWallFor = this.physics.pointInSolid(x, y) ? b.insideWallFor + RECOVERY.checkSec : 0;
      }
      if (out || b.insideWallFor >= RECOVERY.insideWallSec) {
        if (!out && this.mouthBlocked()) continue;
        const sp = this.spawnPoint;
        this.teleportBalloon(b, sp.x, sp.y);
        this.recoveryCount += 1;
      }
    }
  }

  private teleportBalloon(b: Balloon, x: number, y: number): void {
    const body = b.body;
    moveBody(body, x, y, false);
    resetAngle(body);
    setVelocity(body, 0, -BALLOON.spawnSpeed * 0.5);
    b.prevX = x;
    b.prevY = y;
    b.prevAngle = 0;
    b.insideWallFor = 0;
    b.spawnT = 0;
    b.anchorAt = this.simTime;
  }

  // ---------------------------------------------------------------- collisions

  private onCollisions(pairs: Matter.Pair[]): void {
    const k = 1000 / this.physics.substepMs;
    for (const pair of pairs) {
      const a = pair.bodyA.parent;
      const c = pair.bodyB.parent;
      const ba = this.balloonByBody.get(a.id);
      const bb = this.balloonByBody.get(c.id);
      if (!ba && !bb) continue;
      const n = pair.collision.normal;
      const rvx = (a.position.x - a.positionPrev.x - (c.position.x - c.positionPrev.x)) * k;
      const rvy = (a.position.y - a.positionPrev.y - (c.position.y - c.positionPrev.y)) * k;
      const strength = Math.abs(rvx * n.x + rvy * n.y);
      const angle = Math.atan2(n.y, n.x);
      ba?.hit(strength, angle);
      bb?.hit(strength, angle);

      const pusher = this.pusherByBody.get(a.id) ?? this.pusherByBody.get(c.id);
      if (pusher && pusher.phase === 'extend' && !pusher.impactThisCycle) {
        pusher.impactThisCycle = true;
        pusher.jolt = 1;
        this.bus.emit('pusherImpact', { pusher, strength });
      } else if (ba && bb) {
        this.bus.emit('bump', { x: (a.position.x + c.position.x) / 2, y: (a.position.y + c.position.y) / 2, strength });
      }
    }
  }

  // ---------------------------------------------------------------- persistence

  save(): void {
    this.dirty = false;
    this.saveTimer = 0;
    persistState(this.state);
  }

  markDirty(): void {
    this.dirty = true;
  }
}
