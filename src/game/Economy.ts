import { STAGE } from '../balance';
import type { EventBus } from '../util/EventBus';
import type { GameEvents } from './events';
import type { GameState } from './GameState';

/** All money and stage-progress mutations go through here so the numbers stay consistent. */
export class Economy {
  constructor(
    private readonly state: GameState,
    private readonly bus: EventBus<GameEvents>,
  ) {}

  /** Target for a level: rounded to a friendly number. */
  target(level = this.state.level): number {
    const raw = STAGE.baseTarget * Math.pow(STAGE.targetGrowth, level - 1);
    return niceRound(raw);
  }

  bonusFor(level = this.state.level): number {
    return Math.max(5, niceRound(this.target(level) * STAGE.bonusFrac));
  }

  /** A pop pays out money and fills stage progress by the same amount. */
  earnFromPop(value: number): void {
    this.state.money += value;
    this.state.progress += value;
    this.state.stats.earned += value;
    this.bus.emit('moneyChanged', { money: this.state.money, delta: value });
  }

  grant(value: number): void {
    this.state.money += value;
    this.state.stats.earned += value;
    this.bus.emit('moneyChanged', { money: this.state.money, delta: value });
  }

  canAfford(cost: number): boolean {
    return this.state.money >= cost;
  }

  /** Returns false (and changes nothing) if the player can't pay. */
  spend(cost: number): boolean {
    if (cost < 0 || this.state.money < cost) return false;
    this.state.money -= cost;
    this.bus.emit('moneyChanged', { money: this.state.money, delta: -cost });
    return true;
  }

  get stageDone(): boolean {
    return this.state.progress >= this.target();
  }
}

/** 12, 45, 140, 325, 1.2K … — keeps prices and targets readable. */
export function niceRound(value: number): number {
  if (value < 100) return Math.round(value);
  if (value < 1000) return Math.round(value / 5) * 5;
  const magnitude = Math.pow(10, Math.floor(Math.log10(value)) - 2);
  return Math.round(value / magnitude) * magnitude;
}
