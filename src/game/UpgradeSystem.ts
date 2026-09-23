import { EVOLUTION, PUSHER, SPAWN, UPGRADES, VALUE, type UpgradeId } from '../balance';
import { formatMoney, formatSeconds } from '../ui/format';
import type { EventBus } from '../util/EventBus';
import { niceRound, type Economy } from './Economy';
import type { GameEvents } from './events';
import type { GameState } from './GameState';

export type Tier = 'red' | 'blue';

/** Upgrade prices, purchases and the gameplay effect of every level. */
export class UpgradeSystem {
  constructor(
    private readonly state: GameState,
    private readonly economy: Economy,
    private readonly bus: EventBus<GameEvents>,
  ) {}

  level(id: UpgradeId): number {
    return this.state.upgrades[id];
  }

  isMax(id: UpgradeId): boolean {
    return this.level(id) >= UPGRADES[id].maxLevel;
  }

  cost(id: UpgradeId, level = this.level(id)): number {
    const def = UPGRADES[id];
    return niceRound(def.baseCost * Math.pow(def.growth, level));
  }

  canBuy(id: UpgradeId): boolean {
    return !this.isMax(id) && this.economy.canAfford(this.cost(id));
  }

  buy(id: UpgradeId): boolean {
    if (this.isMax(id)) return false;
    const cost = this.cost(id);
    if (!this.economy.spend(cost)) {
      this.bus.emit('purchaseFail', { id, missing: cost - this.state.money });
      return false;
    }
    this.state.upgrades[id] += 1;
    this.bus.emit('purchase', { id, level: this.state.upgrades[id], cost });
    return true;
  }

  // ---- effects -------------------------------------------------------------

  maxCharges(level = this.level('pipe')): number {
    return Math.min(SPAWN.maxCharges, Math.floor(SPAWN.baseCharges + level * SPAWN.chargesPerLevel));
  }

  rechargeSec(level = this.level('pipe')): number {
    return Math.max(SPAWN.minRechargeSec, SPAWN.baseRechargeSec * Math.pow(SPAWN.rechargeMul, level));
  }

  autoSpawnSec(level = this.level('pipe')): number {
    return Math.max(SPAWN.minAutoSec, SPAWN.baseAutoSec * Math.pow(SPAWN.autoMul, level));
  }

  evolutionSec(level = this.level('evolution')): number {
    return Math.max(EVOLUTION.minSec, EVOLUTION.baseSec * Math.pow(EVOLUTION.mul, level));
  }

  balloonValue(tier: Tier, level = this.level('value')): number {
    const base = tier === 'blue' ? VALUE.blue : VALUE.red;
    return base * (1 + level);
  }

  pusherCycleSec(id: 'lowerPusher' | 'upperPusher', level = this.level(id)): number {
    return Math.max(PUSHER.minCycleSec, PUSHER.baseCycleSec * Math.pow(PUSHER.cycleMul, level));
  }

  pusherTravel(id: 'lowerPusher' | 'upperPusher', stageMax: number, level = this.level(id)): number {
    return Math.min(stageMax, PUSHER.baseTravel + level * PUSHER.travelPerLevel);
  }

  /** Human-readable "now → next" line for the tray buttons. */
  describe(id: UpgradeId): { now: string; next: string | null } {
    const L = this.level(id);
    const max = this.isMax(id);
    switch (id) {
      case 'value': {
        const now = `${formatMoney(this.balloonValue('red', L))}/${formatMoney(this.balloonValue('blue', L))}`;
        const next = max ? null : `${formatMoney(this.balloonValue('red', L + 1))}/${formatMoney(this.balloonValue('blue', L + 1))}`;
        return { now, next };
      }
      case 'evolution':
        return {
          now: formatSeconds(this.evolutionSec(L)),
          next: max ? null : formatSeconds(this.evolutionSec(L + 1)),
        };
      case 'pipe':
        return {
          now: `${this.maxCharges(L)} × ${formatSeconds(this.rechargeSec(L))}`,
          next: max ? null : `${this.maxCharges(L + 1)} × ${formatSeconds(this.rechargeSec(L + 1))}`,
        };
      default:
        return {
          now: formatSeconds(this.pusherCycleSec(id, L)),
          next: max ? null : formatSeconds(this.pusherCycleSec(id, L + 1)),
        };
    }
  }
}
