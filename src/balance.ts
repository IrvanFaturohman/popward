/**
 * Popward balance sheet — every gameplay number lives here.
 *
 * Units: world units (the arena is 360 × 620, a balloon is 30 across), seconds, dollars.
 * Tuning notes explain the trade-off of a value, not what the code does with it.
 */

export const WORLD = {
  width: 360,
  height: 620,
  /** Thickness of the outer frame walls inside the world rect. */
  border: 14,
} as const;

export const SIM = {
  stepHz: 60,
  /** Two 8.3 ms solver passes per tick: stops the rams tunnelling into piles without paying for 120 Hz rendering. */
  substeps: 2,
  /** After a long hitch we drop simulated time instead of spiralling into catch-up. */
  maxCatchUpSteps: 5,
  positionIterations: 10,
  velocityIterations: 8,
  /** Frames longer than this are clamped (tab switches, debugger pauses). */
  maxFrameSec: 0.1,
};

export const BALLOON = {
  radius: 15,
  /** Collider is a slightly tall oval (radius × these); off-centre contacts make balloons turn and tumble. */
  shapeX: 0.93,
  shapeY: 1.07,
  /** Upward acceleration (u/s²). Paired with airFriction below: terminal rise ≈ buoyancy / (airFriction × 60). */
  buoyancy: 460,
  /**
   * Matter frictionAir per 1/60 s. Real balloons are mostly drag: a shove dies out within ~0.3 s instead of
   * sending the balloon across the room. Higher = shorter coasting after a push (and slower rise unless buoyancy goes up).
   */
  airFriction: 0.06,
  /**
   * Lift acts this far (× radius) above the centre, so a tilted balloon rights itself like a real one
   * (knot and string hang below). Lower = floppier, flips more easily; higher = stays upright.
   */
  liftOffset: 0.18,
  /** Multiplier on Matter's default (4× inflated) moment of inertia. Lower = spins and rights itself faster. */
  inertiaScale: 0.35,
  /**
   * Rubber grip for spin only (0..1 per substep): a balloon rubbed along a wall, ram or neighbour starts to roll,
   * without Matter's translational friction (which welds piles together). Higher = more tumbling and flips.
   */
  gripSpin: 0.3,
  /** Angular speed clamp (rad/s) so a squeezed balloon can flip but never spins like a wheel. */
  maxSpin: 9,
  /**
   * Must stay 0. Matter's friction removes a fixed amount of sliding speed per solver iteration regardless of
   * load, so even 0.005 welds a pile into a rigid clump that never creeps up a slope (stage 3 jammed at 0.27
   * pops/s with 0.005 vs 0.82 with 0). Jams come from geometry instead: short ram reach, gentle strokes, drag.
   */
  friction: 0,
  frictionStatic: 0,
  restitution: 0.25,
  density: 0.001,
  /** Hard velocity clamp (u/s). Guards against solver spikes inside dense piles. */
  maxSpeed: 420,
  /** Gentle horizontal wander (u/s²), applied at the knot so a lone balloon also sways a little. */
  driftAccel: 30,
  /** Launch speed out of the pipe (u/s). */
  spawnSpeed: 190,
  /** Scale-in time when a balloon appears (visual only). */
  spawnScaleSec: 0.16,
  /** Polygon sides for the collider; fewer = cheaper collisions on mid-range Android. */
  colliderSides: 16,
};

export const PIPE = {
  innerWidth: 36,
  wall: 8,
  rimOverhang: 5,
  rimHeight: 11,
  /** How deep the spawn channel goes below the mouth. */
  channelDepth: 38,
};

export const SPAWN = {
  /**
   * Hard cap on live balloons. Keeps mid-range Android at 60 fps, and it is where pusher speed
   * starts to matter economically: with slow rams a maxed pipe fills the arena and spawns stall.
   */
  maxActive: 34,
  /** One balloon per charge, no stockpile: every tap waits for the pipe to refill. */
  baseCharges: 1,
  chargesPerLevel: 0,
  maxCharges: 1,
  /** Seconds to refill the pipe at level 0. The pipe upgrade shortens this. */
  baseRechargeSec: 2.5,
  rechargeMul: 0.9,
  minRechargeSec: 0.7,
  /** Repeat interval while the finger is held down (a held pipe fires as soon as it refills). */
  holdIntervalSec: 0.2,
  /** Idle time before the pipe starts puffing balloons on its own. */
  idleDelaySec: 3,
  /** Auto-spawn interval while idle. Slower than tapping so input always feels worth it. */
  baseAutoSec: 4,
  autoMul: 0.95,
  minAutoSec: 2.2,
  /** Minimum time between "no charge" / "full" feedback pulses while holding. */
  failFeedbackSec: 0.45,
};

export const VALUE = {
  red: 1,
  blue: 3,
  // The value upgrade adds one base unit per level: red = 1×(1+L), teal = 3×(1+L).
  // Integer payouts stay honest on screen and teal is always exactly 3× red.
};

export const EVOLUTION = {
  baseSec: 12,
  mul: 0.87,
  minSec: 3.5,
  /** Duration of the red → teal colour tween. */
  tweenSec: 0.5,
  /** Charge-up time: a teal ring closes in on the chosen balloon before it turns. */
  sparkSec: 0.35,
  /** Balloons younger than this are still in the pipe and can't be chosen. */
  minAgeSec: 0.8,
};

export const PUSHER = {
  /** Slow, deliberate strokes at level 0; speed upgrades take it down toward minCycleSec. */
  baseCycleSec: 4,
  cycleMul: 0.9,
  minCycleSec: 1.6,
  /**
   * Short base reach: the ram only just clears the pipe, so balloons pile up and need several pushes (and the
   * pile behind them) to reach the next shaft. Reach upgrades are what un-jam the route.
   */
  baseTravel: 90,
  travelPerLevel: 10,
  /** Small pull-back before each push (anticipation). */
  windupDist: 7,
  /**
   * Stroke shape: 0 = eases to a stop (gentle nudge), 1 = hits the end stop at full speed (launch).
   * ~0.5 shoves a pile as a group so its front spills into the next shaft while the rest queues.
   */
  punch: 0.05,
  /** Share of one cycle spent in each phase (sums to 1). Longer rest = more balloons gather before a push. */
  phases: { rest: 0.26, windup: 0.07, extend: 0.32, hold: 0.1, retract: 0.25 },
};

export type UpgradeId = 'pipe' | 'lowerPusher' | 'upperPusher' | 'value' | 'evolution';

export interface UpgradeDef {
  name: string;
  baseCost: number;
  /** Cost multiplier per level. ~1.5 feels generous; above 2 makes each level a milestone. */
  growth: number;
  maxLevel: number;
}

export const UPGRADES: Record<UpgradeId, UpgradeDef> = {
  // Balloons jam before the rams, so the first pop takes ~20 s; cheap first levels keep a purchase inside the first minute.
  pipe: { name: 'Pipe', baseCost: 12, growth: 1.5, maxLevel: 12 },
  lowerPusher: { name: 'Low pusher', baseCost: 14, growth: 1.55, maxLevel: 10 },
  upperPusher: { name: 'High pusher', baseCost: 17, growth: 1.55, maxLevel: 10 },
  // Doubles income at L1, so it is priced as the milestone purchase.
  value: { name: 'Balloon value', baseCost: 55, growth: 2.3, maxLevel: 12 },
  evolution: { name: 'Evolution', baseCost: 28, growth: 1.6, maxLevel: 10 },
};

export const UPGRADE_ORDER: UpgradeId[] = ['pipe', 'lowerPusher', 'upperPusher', 'value', 'evolution'];

export const STAGE = {
  /**
   * Progress (dollars popped) needed on level 1. The brief suggested 40-60; with one charge, slow rams and
   * balloons jamming at each terrace, active play earns ~$0.5-1/s, so 130 lands around 3-4 minutes.
   */
  baseTarget: 130,
  /** Target multiplier per level; roughly tracks how much faster upgrades make income. */
  targetGrowth: 2.2,
  /** Stage-clear bonus as a share of the target. Small on purpose: pops are the main income. */
  bonusFrac: 0.25,
  /** Pause between reaching the target and the Continue card (celebration beat). */
  celebrateSec: 1.4,
};

export const START = {
  money: 0,
};

export const RESCUE = {
  checkSec: 0.25,
  /** A balloon that moves less than moveTolerance for stuckSec gets one gentle nudge along the route. */
  stuckSec: 5,
  moveTolerance: 16,
  /** A balloon that wanders but stays in one route zone this long also counts as stuck. */
  zoneDwellSec: 15,
  /**
   * Only lone balloons get nudged. A pile waiting for the next push is the intended jam, so any balloon with a
   * neighbour closer than this (× diameter) is left alone.
   */
  isolationDiameters: 1.25,
  /** Velocity added by a nudge (u/s). Visible but never enough to throw a balloon to the spikes. */
  impulse: 130,
  cooldownSec: 3,
  maxPerBalloon: 6,
  globalCooldownSec: 0.6,
};

export const RECOVERY = {
  checkSec: 0.5,
  /** Out-of-bounds margin around the world rect before a balloon is considered lost. */
  margin: 24,
  /** Time a centre may stay inside solid geometry before the balloon is returned to the pipe. */
  insideWallSec: 1,
};

export const FX = {
  maxParticles: 260,
  popShards: 7,
  /** Multiplier on particle counts when reduced motion is active. */
  reducedParticles: 0.4,
  /** Pops within this window count toward the same chain (cosmetic only — no hidden multiplier). */
  chainWindowSec: 0.7,
  clusterShakePops: 3,
  shakeAmp: 2.2,
  maxCoinsInFlight: 8,
};

export const AUDIO = {
  defaultVolume: 0.65,
  /** At most this many pop voices per window — bursts stay crisp instead of turning to mush. */
  maxPopsPerWindow: 4,
  popWindowSec: 0.1,
  bumpCooldownSec: 0.12,
  /** Normal impact speed (u/s) below which balloon-on-balloon contact stays silent. */
  bumpThreshold: 170,
};

export const SAVE = {
  key: 'popward.save',
  settingsKey: 'popward.settings',
  version: 1,
  throttleSec: 3,
};
