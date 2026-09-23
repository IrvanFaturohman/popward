import { BALLOON, WORLD } from '../balance';
import type { Sfx } from '../audio/Audio';
import { COLORS } from '../render/draw';
import { formatMoney } from '../ui/format';
import type { UI } from '../ui/UI';
import type { Game } from './Game';

/** Vibrate only where supported, and never for routine events like collisions. */
function haptic(pattern: number | number[], enabled: () => boolean): void {
  if (!enabled() || typeof navigator.vibrate !== 'function') return;
  try {
    navigator.vibrate(pattern);
  } catch {
    /* some browsers throw without a user gesture */
  }
}

/**
 * Game-feel wiring: turns simulation events into particles, sound, haptics and UI flourishes.
 * Nothing here changes game state.
 */
export function wireFeedback(game: Game, sfx: Sfx, ui: UI, isReduced: () => boolean): void {
  const fx = game.particles;
  const hapticsOn = () => !sfx.muted;
  let manualSpawns = 0;
  let lastFailText = -1e9;

  game.bus.on('spawn', ({ balloon, auto }) => {
    sfx.spawn();
    fx.ring(balloon.x, game.stage.pipe.mouthY - 4, 'rgba(255,255,255,0.6)', 10, 20, 0.2);
    if (!auto && !game.state.hintDone && ++manualSpawns >= 3) {
      game.state.hintDone = true;
      game.markDirty();
      ui.hideHint();
    }
  });

  game.bus.on('spawnFail', ({ reason }) => {
    if (reason === 'blocked') return;
    sfx.fail();
    // The pip flash + sound already answer every failed tap; the label only needs to show occasionally.
    const now = performance.now();
    if (now - lastFailText < 1400) return;
    lastFailText = now;
    const c = game.stage.charges;
    fx.text(c.x, c.y - 24, reason === 'full' ? 'Arena full — upgrade pushers' : 'Recharging…', COLORS.inkSoft, 12, 1);
  });

  game.bus.on('evolveStart', () => {
    sfx.evolveStart();
    ui.pulseEvolveMeter();
  });

  game.bus.on('evolve', ({ balloon }) => {
    sfx.evolve();
    fx.ring(balloon.x, balloon.y, COLORS.teal, BALLOON.radius, BALLOON.radius * 2.6, 0.45);
    fx.sparkle(balloon.x, balloon.y, COLORS.teal, 8);
    fx.text(balloon.x, balloon.y - 26, `${formatMoney(game.upgrades.balloonValue('blue'))}`, COLORS.tealDark, 14, 0.8);
    haptic(12, hapticsOn);
  });

  game.bus.on('pop', ({ balloon, value, x, y, chain }) => {
    const teal = balloon.tier === 'blue';
    sfx.pop(teal, chain);
    fx.popBurst(x, y, teal ? COLORS.teal : COLORS.red, teal);
    if (teal) fx.sparkle(x, y, '#FFFFFF', 4);
    // Small jitter keeps a burst of labels readable instead of stacking on one spot.
    const jx = (Math.random() - 0.5) * 22;
    fx.text(x + jx, Math.max(y + 18, WORLD.border + 28) + (chain % 3) * 7, `+${formatMoney(value)}`, teal ? COLORS.tealDark : COLORS.ink, teal ? 17 : 15);
    ui.flyCoin(x, y, teal, isReduced());
    ui.showChain(chain);
  });

  game.bus.on('purchase', ({ id }) => {
    sfx.purchase();
    haptic(10, hapticsOn);
    ui.pulseChip(id);
    if (id === 'pipe') {
      game.pipeSquash = 1;
      const g = game.stage.pipe;
      fx.sparkle(g.x, g.mouthY, COLORS.gold, 6);
    } else if (id === 'lowerPusher' || id === 'upperPusher') {
      const p = game.pushers[id === 'lowerPusher' ? 0 : 1];
      p.flash = 1;
    } else if (id === 'value') {
      for (const b of game.balloons) fx.sparkle(b.x, b.y, COLORS.gold, 1);
    }
  });

  game.bus.on('purchaseFail', () => sfx.denied());

  game.bus.on('stageComplete', () => {
    sfx.stageClear();
    fx.confetti(WORLD.width, WORLD.border);
    haptic([18, 40, 18], hapticsOn);
    ui.toastCenter('Stage clear!');
  });

  game.bus.on('stageStart', ({ level }) => ui.toastCenter(`Level ${level} · ${game.stage.name}`));

  game.bus.on('pusherPush', () => sfx.push());
  game.bus.on('pusherImpact', ({ strength }) => sfx.impact(strength));
  game.bus.on('bump', ({ strength }) => sfx.bump(strength));
  game.bus.on('rescue', ({ balloon, dx, dy }) => {
    fx.puff(balloon.x, balloon.y, dx, dy);
    sfx.rescue();
  });
}
