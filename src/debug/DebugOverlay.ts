import type Matter from 'matter-js';
import { BALLOON, SPAWN, WORLD } from '../balance';
import type { Game } from '../game/Game';
import type { DebugDrawer } from '../render/Renderer';

const ZONE_COLORS = ['#ED6664', '#56C7D0', '#59B989', '#F4C76D', '#9B7BD4', '#E58FB0', '#6C9BD2'];

/** ?debug=1 — colliders, spike hitbox, flow zones, route, and a live stats panel. */
export class DebugOverlay implements DebugDrawer {
  private fps = 60;
  private panelTimer = 0;

  constructor(
    private readonly game: Game,
    private readonly panel: HTMLElement,
  ) {
    panel.hidden = false;
    window.addEventListener('keydown', (e) => this.onKey(e));
  }

  private onKey(e: KeyboardEvent): void {
    const g = this.game;
    if (e.key === 'm') g.economy.grant(100);
    if (e.key === 'M') g.economy.grant(5000);
    if (e.key === 'e') g.state.evo = 1;
    if (e.key === 'c' && g.mode === 'playing') g.state.progress = g.target;
    if (e.key === 'h') this.panel.hidden = !this.panel.hidden;
  }

  update(dt: number): void {
    if (dt > 0) this.fps += (1 / dt - this.fps) * 0.08;
    this.panelTimer -= dt;
    if (this.panelTimer > 0) return;
    this.panelTimer = 0.2;
    const g = this.game;
    const u = g.upgrades;
    const evoLeft = (1 - g.state.evo) * u.evolutionSec();
    const lines = [
      `FPS ${this.fps.toFixed(0)}   sim ${g.simTime.toFixed(1)}s  x${g.speed}`,
      `mode ${g.mode}   level ${g.state.level} (${g.stage.key})`,
      `balloons ${g.balloons.length}/${SPAWN.maxActive}  red ${g.balloons.filter((b) => b.tier === 'red').length}  teal ${g.balloons.filter((b) => b.tier === 'blue').length}`,
      `charges ${g.state.charges.toFixed(2)}/${u.maxCharges()}  recharge ${u.rechargeSec().toFixed(2)}s  auto ${u.autoSpawnSec().toFixed(2)}s`,
      `evo ${(g.state.evo * 100).toFixed(0)}%  ${g.evoWaiting ? 'WAITING (no red)' : g.spark ? 'spark in flight' : `${evoLeft.toFixed(1)}s left`}  / ${u.evolutionSec().toFixed(1)}s`,
      ...g.pushers.map(
        (p) =>
          `${p.cfg.id.padEnd(5)} ${p.phase.padEnd(7)} u=${p.u.toFixed(2)} ext=${p.ext.toFixed(0).padStart(4)} travel=${p.travel} cycle=${p.cycleSec.toFixed(2)}s`,
      ),
      `money ${g.state.money.toFixed(0)}  progress ${g.state.progress}/${g.target}  pops ${g.state.stats.pops}`,
      `rescues ${g.rescueCount}  recoveries ${g.recoveryCount}`,
      `keys: m +$100  M +$5K  e evo  c clear  h panel`,
    ];
    this.panel.textContent = lines.join('\n');
  }

  draw(ctx: CanvasRenderingContext2D, game: Game): void {
    ctx.save();
    ctx.lineWidth = 1;
    // flow zones
    game.stage.zones.forEach((z, i) => {
      ctx.fillStyle = ZONE_COLORS[i % ZONE_COLORS.length] + '18';
      ctx.strokeStyle = ZONE_COLORS[i % ZONE_COLORS.length] + '88';
      ctx.fillRect(z.x0, z.y0, z.x1 - z.x0, z.y1 - z.y0);
      ctx.strokeRect(z.x0 + 1, z.y0 + 1, z.x1 - z.x0 - 2, z.y1 - z.y0 - 2);
      const cx = (z.x0 + z.x1) / 2;
      const cy = (z.y0 + z.y1) / 2;
      const d = game.flowDirection(cx, cy);
      if (d) {
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + d.x * 22, cy + d.y * 22);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(cx + d.x * 22, cy + d.y * 22, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = ZONE_COLORS[i % ZONE_COLORS.length];
        ctx.fill();
      }
    });
    // route
    ctx.strokeStyle = 'rgba(155,123,212,0.9)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    game.stage.path.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.stroke();
    ctx.setLineDash([]);
    // colliders
    const bodies = (game.physics.engine.world.bodies as Matter.Body[]) ?? [];
    for (const body of bodies) {
      if (body.label === 'safety') continue;
      ctx.strokeStyle =
        body.label === 'balloon' ? 'rgba(39,54,58,0.8)' : body.label === 'pusher' ? '#D9480F' : 'rgba(30,120,200,0.85)';
      ctx.beginPath();
      body.vertices.forEach((v, i) => (i ? ctx.lineTo(v.x, v.y) : ctx.moveTo(v.x, v.y)));
      ctx.closePath();
      ctx.stroke();
    }
    // spike hitbox
    const s = game.stage.spikes;
    ctx.fillStyle = 'rgba(237,102,100,0.3)';
    ctx.fillRect(s.x0, WORLD.border - 4, s.x1 - s.x0, s.depth + 4);
    // spawn point
    const sp = game.spawnPoint;
    ctx.strokeStyle = '#59B989';
    ctx.beginPath();
    ctx.arc(sp.x, sp.y, BALLOON.radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}
