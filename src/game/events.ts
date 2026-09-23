import type { UpgradeId } from '../balance';
import type { Balloon } from '../entities/Balloon';
import type { Pusher } from '../entities/Pusher';

export type SpawnFailReason = 'empty' | 'full' | 'blocked';

export interface GameEvents {
  spawn: { balloon: Balloon; auto: boolean };
  spawnFail: { reason: SpawnFailReason };
  evolveStart: { balloon: Balloon };
  evolve: { balloon: Balloon };
  pop: { balloon: Balloon; value: number; x: number; y: number; chain: number };
  purchase: { id: UpgradeId; level: number; cost: number };
  purchaseFail: { id: UpgradeId; missing: number };
  stageComplete: { level: number; bonus: number };
  stageStart: { level: number };
  pusherPush: { pusher: Pusher };
  pusherImpact: { pusher: Pusher; strength: number };
  bump: { x: number; y: number; strength: number };
  rescue: { balloon: Balloon; dx: number; dy: number };
  moneyChanged: { money: number; delta: number };
}
