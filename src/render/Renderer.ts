import { BALLOON, FX, PIPE, WORLD } from '../balance';
import { buildSolids, pipeGeometry } from '../config/geometry';
import type { PusherConfig, StageConfig, Vec } from '../config/stages';
import type { Balloon } from '../entities/Balloon';
import type { Pusher, PusherPhase } from '../entities/Pusher';
import type { Game } from '../game/Game';
import { clamp, easeInOutSine, easeOutBack, lerp, mixHex } from '../util/math';
import { centroid, COLORS, miniBalloon, roundRectPath } from './draw';

export const FONT = '"Nunito", ui-rounded, system-ui, sans-serif';

/** Maps the fixed 360×620 world into the canvas; physics never sees screen pixels. */
export class Camera {
  scale = 1;
  ox = 0;
  oy = 0;
  cssW = 0;
  cssH = 0;
  dpr = 1;

  fit(cssW: number, cssH: number, dpr: number): void {
    this.cssW = cssW;
    this.cssH = cssH;
    this.dpr = dpr;
    this.scale = Math.min(cssW / WORLD.width, cssH / WORLD.height);
    this.ox = (cssW - WORLD.width * this.scale) / 2;
    this.oy = (cssH - WORLD.height * this.scale) / 2;
  }

  toScreen(x: number, y: number): Vec {
    return { x: this.ox + x * this.scale, y: this.oy + y * this.scale };
  }

  toWorld(sx: number, sy: number): Vec {
    return { x: (sx - this.ox) / this.scale, y: (sy - this.oy) / this.scale };
  }
}

export interface DebugDrawer {
  draw(ctx: CanvasRenderingContext2D, game: Game): void;
}

export class Renderer {
  readonly cam = new Camera();
  private readonly ctx: CanvasRenderingContext2D;
  private readonly bgLayer = document.createElement('canvas');
  private readonly wallLayer = document.createElement('canvas');
  private layerKey = '';
  reducedMotion = false;
  debug: DebugDrawer | null = null;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas 2D not supported');
    this.ctx = ctx;
  }

  resize(cssW: number, cssH: number, dpr: number): void {
    this.canvas.width = Math.max(1, Math.round(cssW * dpr));
    this.canvas.height = Math.max(1, Math.round(cssH * dpr));
    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;
    this.cam.fit(cssW, cssH, dpr);
    this.layerKey = '';
  }

  invalidate(): void {
    this.layerKey = '';
  }

  private worldTransform(ctx: CanvasRenderingContext2D, sx = 0, sy = 0): void {
    const { dpr, scale, ox, oy } = this.cam;
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * (ox + sx), dpr * (oy + sy));
  }

  private ensureLayers(stage: StageConfig, maxCharges: number): void {
    const key = `${stage.key}|${this.canvas.width}x${this.canvas.height}|${maxCharges}`;
    if (key === this.layerKey) return;
    this.layerKey = key;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const pxPerUnit = this.cam.scale * this.cam.dpr;
    for (const layer of [this.bgLayer, this.wallLayer]) {
      layer.width = w;
      layer.height = h;
    }
    const bg = this.bgLayer.getContext('2d')!;
    bg.fillStyle = stage.palette.wall;
    bg.fillRect(0, 0, w, h);
    this.worldTransform(bg);
    drawBackground(bg, stage);

    const wl = this.wallLayer.getContext('2d')!;
    wl.clearRect(0, 0, w, h);
    this.worldTransform(wl);
    drawWalls(wl, stage, pxPerUnit);
    drawWallDetails(wl, stage, maxCharges);
  }

  render(game: Game, time: number): void {
    const { ctx } = this;
    const stage = game.stage;
    const maxCharges = game.upgrades.maxCharges();
    this.ensureLayers(stage, maxCharges);

    const amp = this.reducedMotion ? 0 : game.shake * FX.shakeAmp;
    const sx = amp ? (Math.random() * 2 - 1) * amp : 0;
    const sy = amp ? (Math.random() * 2 - 1) * amp : 0;
    const dpr = this.cam.dpr;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = stage.palette.wall;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.drawImage(this.bgLayer, sx * dpr, sy * dpr);

    this.worldTransform(ctx, sx, sy);
    for (const p of game.pushers) drawRam(ctx, p.cfg, lerp(p.prevExt, p.ext, game.alpha), p.flash, p.jolt, time);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.wallLayer, sx * dpr, sy * dpr);

    this.worldTransform(ctx, sx, sy);
    for (const p of game.pushers) drawPusherLed(ctx, p, time);
    drawPipeBack(ctx, stage);
    this.drawBalloons(ctx, game, time);
    drawPipeFront(ctx, stage, game.pipeSquash);
    drawCharges(ctx, stage, game.state.charges, maxCharges, game.chargeFlash, time);
    this.drawGauge(ctx, game, time);
    game.particles.draw(ctx, FONT);
    this.debug?.draw(ctx, game);
  }

  // ------------------------------------------------------------------ balloons

  private drawBalloons(ctx: CanvasRenderingContext2D, game: Game, time: number): void {
    const a = game.alpha;
    const list = game.balloons;
    const r = BALLOON.radius;
    const rx = r * BALLOON.shapeX * 1.02;
    const ry = r * BALLOON.shapeY;
    // Shadows and strings first so neighbouring balloons never get a string drawn over their body.
    ctx.fillStyle = COLORS.shadow;
    for (const b of list) {
      const x = lerp(b.prevX, b.x, a);
      const y = lerp(b.prevY, b.y, a);
      const s = easeOutBack(b.spawnT);
      ctx.beginPath();
      ctx.ellipse(x + 3, y + 5, rx * s, ry * s, lerp(b.prevAngle, b.angle, a), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = 'rgba(39,54,58,0.3)';
    ctx.lineWidth = 1.1;
    for (const b of list) {
      if (b.spawnT < 0.6) continue;
      const x = lerp(b.prevX, b.x, a);
      const y = lerp(b.prevY, b.y, a);
      const ang = lerp(b.prevAngle, b.angle, a);
      // The string leaves the knot along the balloon's axis, then gravity bends it downward.
      const dx = -Math.sin(ang);
      const dy = Math.cos(ang);
      const kx = x + dx * ry * 1.1;
      const ky = y + dy * ry * 1.1;
      const sway = Math.sin(time * 3 + b.seed * 20) * 3 - (b.x - b.prevX) * 3;
      ctx.beginPath();
      ctx.moveTo(kx, ky);
      ctx.bezierCurveTo(kx + dx * 8, ky + dy * 8, kx + sway, ky + 12, kx - sway * 0.5, ky + 17);
      ctx.stroke();
    }
    for (const b of list) this.drawBalloon(ctx, b, lerp(b.prevX, b.x, a), lerp(b.prevY, b.y, a), lerp(b.prevAngle, b.angle, a), time);
  }

  private drawBalloon(ctx: CanvasRenderingContext2D, b: Balloon, x: number, y: number, angle: number, time: number): void {
    const r = BALLOON.radius;
    const rx = r * BALLOON.shapeX * 1.02;
    const ry = r * BALLOON.shapeY;
    const blend = b.tier === 'blue' ? easeInOutSine(b.evolveT) : 0;
    const color = blend <= 0 ? COLORS.red : blend >= 1 ? COLORS.teal : mixHex(COLORS.red, COLORS.teal, blend);
    const dark = blend <= 0 ? COLORS.redDark : blend >= 1 ? COLORS.tealDark : mixHex(COLORS.redDark, COLORS.tealDark, blend);
    const wobble = this.reducedMotion ? 0 : Math.sin(time * 2.2 + b.seed * 30) * 0.03;
    let scale = easeOutBack(b.spawnT);
    // Evolution "gulp": a quick swell while the colour turns.
    if (b.tier === 'blue' && b.evolveT < 1) scale *= 1 + Math.sin(b.evolveT * Math.PI) * 0.16;
    const sq = this.reducedMotion ? b.squash * 0.5 : b.squash;

    ctx.save();
    ctx.translate(x, y);
    if (sq !== 0) {
      ctx.rotate(b.squashAngle);
      ctx.scale(1 - sq, 1 + sq * 0.6);
      ctx.rotate(-b.squashAngle);
    }
    // Physics owns the orientation now: balloons tilt, tumble and can hang upside down.
    ctx.rotate(angle + wobble);
    ctx.scale(scale, scale);

    // knot
    ctx.fillStyle = dark;
    ctx.beginPath();
    ctx.moveTo(-3.2, ry * 1.1);
    ctx.lineTo(3.2, ry * 1.1);
    ctx.lineTo(0, ry * 0.93);
    ctx.closePath();
    ctx.fill();

    // body + soft shade crescent for volume without outlines
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    // Shade and highlight follow a fixed top-left light, so they are drawn un-rotated inside the body clip.
    ctx.save();
    ctx.clip();
    ctx.rotate(-(angle + wobble));
    ctx.fillStyle = dark;
    ctx.globalAlpha = 0.28;
    ctx.beginPath();
    ctx.ellipse(r * 0.55, r * 0.6, r * 0.95, r * 1.0, 0, 0, Math.PI * 2);
    ctx.ellipse(-r * 0.2, -r * 0.25, r * 1.05, r * 1.12, 0, 0, Math.PI * 2, true);
    ctx.fill('evenodd');
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.beginPath();
    ctx.ellipse(-r * 0.38, -r * 0.45, r * 0.17, r * 0.3, -0.55, 0, Math.PI * 2);
    ctx.fill();
    if (b.tier === 'blue') {
      // Sparkle mark: teal balloons read differently even without colour vision.
      const k = 0.8 + Math.sin(time * 5 + b.seed * 9) * 0.2;
      ctx.fillStyle = `rgba(255,255,255,${0.9 * blend})`;
      star(ctx, r * 0.3, -r * 0.08, 4.2 * k);
    }
    ctx.restore();
    ctx.restore();

    if (b.targeted) {
      ctx.strokeStyle = COLORS.teal;
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.6 + Math.sin(time * 20) * 0.3;
      ctx.beginPath();
      ctx.arc(x, y, r + 4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  // ------------------------------------------------------------------ gauge

  private drawGauge(ctx: CanvasRenderingContext2D, game: Game, time: number): void {
    const t = gaugeTrack(game.stage);
    const fill = clamp(game.state.evo, 0, 1);
    const fh = t.h * fill;
    if (fh > 0.5) {
      const grad = ctx.createLinearGradient(0, t.y + t.h, 0, t.y);
      grad.addColorStop(0, COLORS.red);
      grad.addColorStop(1, COLORS.teal);
      ctx.save();
      roundRectPath(ctx, t.x, t.y, t.w, t.h, t.w / 2);
      ctx.clip();
      ctx.fillStyle = grad;
      ctx.fillRect(t.x, t.y + t.h - fh, t.w, fh);
      // moving sheen so the gauge visibly "breathes" while filling
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      const sy = t.y + t.h - ((time * 18) % (t.h + 10));
      if (sy > t.y + t.h - fh) ctx.fillRect(t.x, sy, t.w, 3);
      ctx.restore();
    }
    const icon = gaugeIcons(game.stage);
    if (game.evoWaiting) {
      // Full but no red balloon to convert: pulse and wait.
      const k = 0.5 + Math.sin(time * 6) * 0.5;
      ctx.strokeStyle = COLORS.teal;
      ctx.globalAlpha = 0.35 + k * 0.5;
      ctx.lineWidth = 2;
      roundRectPath(ctx, t.x - 2.5, t.y - 2.5, t.w + 5, t.h + 5, (t.w + 5) / 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    if (game.gaugePulse > 0) {
      const k = 1 - game.gaugePulse;
      ctx.strokeStyle = COLORS.teal;
      ctx.globalAlpha = game.gaugePulse;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(icon.top.x, icon.top.y, 8 + k * 14, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    if (game.spark) {
      const target = game.spark.balloon;
      const p0 = { x: t.x + t.w / 2, y: t.y };
      const p2 = { x: target.x, y: target.y };
      const c = { x: (p0.x + p2.x) / 2 - 30, y: Math.min(p0.y, p2.y) - 60 };
      for (let i = 3; i >= 0; i--) {
        const k = clamp(game.spark.t - i * 0.07, 0, 1);
        const px = (1 - k) * (1 - k) * p0.x + 2 * (1 - k) * k * c.x + k * k * p2.x;
        const py = (1 - k) * (1 - k) * p0.y + 2 * (1 - k) * k * c.y + k * k * p2.y;
        ctx.globalAlpha = i === 0 ? 1 : 0.5 - i * 0.12;
        ctx.fillStyle = COLORS.teal;
        ctx.beginPath();
        ctx.arc(px, py, i === 0 ? 5 : 4 - i * 0.7, 0, Math.PI * 2);
        ctx.fill();
        if (i === 0) {
          ctx.fillStyle = '#FFFFFF';
          ctx.beginPath();
          ctx.arc(px, py, 2.2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
    }
  }
}

// ==================================================================== static drawing

function star(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  ctx.beginPath();
  ctx.moveTo(x, y - s);
  ctx.quadraticCurveTo(x, y, x + s, y);
  ctx.quadraticCurveTo(x, y, x, y + s);
  ctx.quadraticCurveTo(x, y, x - s, y);
  ctx.quadraticCurveTo(x, y, x, y - s);
  ctx.fill();
}

/** Charge pips tighten up as capacity grows so 8 charges still fit beside the pipe. */
export function pipLayout(max: number) {
  const spacing = max > 5 ? 10 : 12;
  return { spacing, r: max > 5 ? 3.8 : 4.3, well: max > 5 ? 4.9 : 5.6 };
}

export function gaugeTrack(stage: StageConfig) {
  const g = stage.gauge;
  return { x: g.x + g.w - 22, y: g.y + 4, w: 13, h: g.h - 8 };
}

function gaugeIcons(stage: StageConfig) {
  const g = stage.gauge;
  return { top: { x: g.x + 13, y: g.y + 14 }, bottom: { x: g.x + 13, y: g.y + g.h - 16 } };
}

export function drawBackground(ctx: CanvasRenderingContext2D, stage: StageConfig): void {
  const { width: W, height: H, border: B } = WORLD;
  const pal = stage.palette;
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, pal.air);
  grad.addColorStop(1, pal.airDeep);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // faint dot grid for texture
  ctx.fillStyle = 'rgba(39,54,58,0.05)';
  for (let y = 9, row = 0; y < H; y += 18, row++) {
    for (let x = row % 2 ? 18 : 9; x < W; x += 18) {
      ctx.beginPath();
      ctx.arc(x, y, 1.1, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // warm glow under the goal
  const s = stage.spikes;
  const cx = (s.x0 + s.x1) / 2;
  const glow = ctx.createRadialGradient(cx, B, 4, cx, B, 110);
  glow.addColorStop(0, 'rgba(244,199,109,0.30)');
  glow.addColorStop(1, 'rgba(244,199,109,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(cx - 120, B, 240, 120);

  drawRouteChevrons(ctx, stage.path);
}

/** Very faint chevrons painted along the route so the intended path reads at a glance. */
function drawRouteChevrons(ctx: CanvasRenderingContext2D, path: Vec[]): void {
  ctx.strokeStyle = 'rgba(39,54,58,0.075)';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const spacing = 30;
  let carry = spacing * 0.6;
  for (let i = 1; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const ux = (b.x - a.x) / len;
    const uy = (b.y - a.y) / len;
    for (let d = carry; d < len - 8; d += spacing) {
      const x = a.x + ux * d;
      const y = a.y + uy * d;
      const s = 5;
      ctx.beginPath();
      ctx.moveTo(x - ux * s - uy * s, y - uy * s + ux * s);
      ctx.lineTo(x, y);
      ctx.lineTo(x - ux * s + uy * s, y - uy * s - ux * s);
      ctx.stroke();
      carry = d + spacing - len;
    }
    carry = Math.max(8, carry);
  }
}

function onOuterFrame(p: Vec): boolean {
  const { width: W, border: B } = WORLD;
  return p.x <= B + 0.01 || p.x >= W - B - 0.01 || p.y <= B + 0.01;
}

/** Edges on the world boundary or glued to the frame get no lip shading (it would show as a seam). */
function onWorldEdge(a: Vec, b: Vec): boolean {
  const { width: W, height: H, border: B } = WORLD;
  const same = (p: number, q: number, v: number) => Math.abs(p - v) < 0.01 && Math.abs(q - v) < 0.01;
  return (
    same(a.x, b.x, 0) ||
    same(a.x, b.x, W) ||
    same(a.y, b.y, 0) ||
    same(a.y, b.y, H) ||
    same(a.x, b.x, B) ||
    same(a.x, b.x, W - B) ||
    same(a.y, b.y, B)
  );
}

/** Walls with a soft cast shadow, a lit top lip and a shaded underside (flat, no outlines). */
export function drawWalls(ctx: CanvasRenderingContext2D, stage: StageConfig, pxPerUnit: number): void {
  const pal = stage.palette;
  const solids = buildSolids(stage).filter((s) => s.kind !== 'pipe');
  const radiusFor = (kind: string) => (kind === 'wall' ? 7 : 0);

  const path = (pts: Vec[], kind: string) => {
    const r = radiusFor(kind);
    if (r === 0) {
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath();
      return;
    }
    // Corners touching the outer frame stay sharp so no seam of air shows between wall pieces.
    const n = pts.length;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const prev = pts[(i - 1 + n) % n];
      const cur = pts[i];
      const next = pts[(i + 1) % n];
      const rr = onOuterFrame(cur) ? 0 : Math.min(r, Math.hypot(cur.x - prev.x, cur.y - prev.y) / 2, Math.hypot(next.x - cur.x, next.y - cur.y) / 2);
      if (rr === 0) {
        if (i === 0) ctx.moveTo(cur.x, cur.y);
        else ctx.lineTo(cur.x, cur.y);
        continue;
      }
      const d1 = Math.hypot(cur.x - prev.x, cur.y - prev.y);
      const ax = cur.x + ((prev.x - cur.x) / d1) * rr;
      const ay = cur.y + ((prev.y - cur.y) / d1) * rr;
      if (i === 0) ctx.moveTo(ax, ay);
      else ctx.lineTo(ax, ay);
      ctx.arcTo(cur.x, cur.y, next.x, next.y, rr);
    }
    ctx.closePath();
  };

  ctx.save();
  ctx.shadowColor = 'rgba(39,54,58,0.16)';
  ctx.shadowBlur = 9 * pxPerUnit;
  ctx.shadowOffsetY = 3 * pxPerUnit;
  ctx.fillStyle = pal.wall;
  for (const s of solids) {
    path(s.points, s.kind);
    ctx.fill();
  }
  ctx.restore();

  for (const s of solids) {
    ctx.save();
    path(s.points, s.kind);
    ctx.fillStyle = pal.wall;
    ctx.fill();
    ctx.clip();
    const c = centroid(s.points);
    const n = s.points.length;
    ctx.lineCap = 'round';
    for (let i = 0; i < n; i++) {
      const a = s.points[i];
      const b = s.points[(i + 1) % n];
      if (onWorldEdge(a, b)) continue;
      let nx = b.y - a.y;
      let ny = -(b.x - a.x);
      const len = Math.hypot(nx, ny) || 1;
      nx /= len;
      ny /= len;
      if (nx * ((a.x + b.x) / 2 - c.x) + ny * ((a.y + b.y) / 2 - c.y) < 0) {
        nx = -nx;
        ny = -ny;
      }
      if (ny < -0.45) {
        ctx.strokeStyle = pal.wallLight;
        ctx.lineWidth = 5;
      } else if (ny > 0.45) {
        ctx.strokeStyle = pal.wallShade;
        ctx.lineWidth = 9;
      } else continue;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    ctx.restore();
  }
}

/** Static machine details that live on the walls: ram sockets, LED housings, spikes, gauge well, pip wells. */
export function drawWallDetails(ctx: CanvasRenderingContext2D, stage: StageConfig, maxCharges: number): void {
  const B = WORLD.border;
  const pal = stage.palette;
  for (const cfg of stage.pushers) {
    const wallX = cfg.side === 'left' ? B : WORLD.width - B;
    const d = cfg.side === 'left' ? 1 : -1;
    // socket the ram slides out of
    ctx.fillStyle = '#6E8287';
    const sx = d > 0 ? wallX - 8 : wallX;
    roundRectPath(ctx, sx, cfg.y - 1, 8, cfg.height + 2, 2);
    ctx.fill();
    ctx.fillStyle = '#566A6F';
    ctx.fillRect(d > 0 ? wallX - 8 : wallX + 5, cfg.y - 1, 3, cfg.height + 2);
    // LED housing on the terrace just above the ram
    ctx.fillStyle = pal.wallShade;
    ctx.beginPath();
    ctx.arc(wallX + d * 13, cfg.y - 10, 6, 0, Math.PI * 2);
    ctx.fill();
  }

  // spikes
  const s = stage.spikes;
  ctx.fillStyle = COLORS.spikeBase;
  roundRectPath(ctx, s.x0 - 6, B - 3, s.x1 - s.x0 + 12, 8, 3);
  ctx.fill();
  const count = Math.max(3, Math.round((s.x1 - s.x0) / 12));
  const w = (s.x1 - s.x0) / count;
  for (let i = 0; i < count; i++) {
    const l = s.x0 + i * w;
    const mid = l + w / 2;
    const tipY = B + s.depth;
    ctx.fillStyle = COLORS.spikeLight;
    ctx.beginPath();
    ctx.moveTo(l, B + 4);
    ctx.lineTo(mid, B + 4);
    ctx.lineTo(mid, tipY);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = COLORS.spike;
    ctx.beginPath();
    ctx.moveTo(mid, B + 4);
    ctx.lineTo(l + w, B + 4);
    ctx.lineTo(mid, tipY);
    ctx.closePath();
    ctx.fill();
  }

  // evolution gauge well
  const g = stage.gauge;
  ctx.fillStyle = 'rgba(39,54,58,0.07)';
  roundRectPath(ctx, g.x, g.y, g.w, g.h, 10);
  ctx.fill();
  const t = gaugeTrack(stage);
  ctx.fillStyle = 'rgba(39,54,58,0.16)';
  roundRectPath(ctx, t.x, t.y, t.w, t.h, t.w / 2);
  ctx.fill();
  const icons = gaugeIcons(stage);
  miniBalloon(ctx, icons.top.x, icons.top.y, 6.5, COLORS.teal);
  miniBalloon(ctx, icons.bottom.x, icons.bottom.y, 6.5, COLORS.red);
  // up arrow between the two icons: red becomes teal
  ctx.strokeStyle = 'rgba(39,54,58,0.35)';
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const ax = icons.top.x;
  const ay0 = icons.bottom.y - 12;
  const ay1 = icons.top.y + 13;
  ctx.beginPath();
  ctx.moveTo(ax, ay0);
  ctx.lineTo(ax, ay1);
  ctx.moveTo(ax - 4, ay1 + 4);
  ctx.lineTo(ax, ay1);
  ctx.lineTo(ax + 4, ay1 + 4);
  ctx.stroke();

  // charge pip wells
  const c = stage.charges;
  const pip = pipLayout(maxCharges);
  ctx.fillStyle = 'rgba(39,54,58,0.12)';
  for (let i = 0; i < maxCharges; i++) {
    const x = c.x - ((maxCharges - 1) * pip.spacing) / 2 + i * pip.spacing;
    ctx.beginPath();
    ctx.arc(x, c.y, pip.well, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** The ram block is drawn under the wall layer, so only the part outside the socket is visible. */
export function drawRam(
  ctx: CanvasRenderingContext2D,
  cfg: PusherConfig,
  ext: number,
  flash: number,
  jolt: number,
  time: number,
): void {
  const B = WORLD.border;
  const d = cfg.side === 'left' ? 1 : -1;
  const wallX = cfg.side === 'left' ? B : WORLD.width - B;
  const face = wallX + d * ext + (jolt > 0 ? Math.sin(time * 90) * jolt * 1.2 : 0);
  const top = cfg.y - 2;
  const h = cfg.height + 2;
  const plate = 12;
  const back = wallX - d * 40;
  const x0 = Math.min(back, face - d * plate);
  const x1 = Math.max(back, face - d * plate);

  // telescoping body
  ctx.fillStyle = COLORS.steel;
  ctx.fillRect(x0, top + 3, x1 - x0, h - 6);
  ctx.fillStyle = COLORS.steelLight;
  ctx.fillRect(x0, top + 3, x1 - x0, 6);
  ctx.fillStyle = COLORS.steelDark;
  ctx.fillRect(x0, top + h - 9, x1 - x0, 6);
  // segment joints every 46 units back from the face plate
  ctx.fillStyle = COLORS.steelDark;
  for (let k = 1; k < 8; k++) {
    const jx = face - d * (plate + k * 46);
    if ((d > 0 && jx < wallX - 10) || (d < 0 && jx > wallX + 10)) break;
    ctx.fillRect(jx - 1.5, top + 3, 3, h - 6);
    ctx.fillStyle = COLORS.steelLight;
    ctx.beginPath();
    ctx.arc(jx + d * 6, top + h / 2, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = COLORS.steelDark;
  }

  // face plate with hazard stripes
  const px = d > 0 ? face - plate : face;
  ctx.save();
  roundRectPath(ctx, px, top, plate, h, 4);
  ctx.fillStyle = COLORS.gold;
  ctx.fill();
  ctx.clip();
  ctx.fillStyle = COLORS.goldDark;
  for (let yy = top - 12; yy < top + h + 12; yy += 12) {
    ctx.beginPath();
    ctx.moveTo(px - 2, yy);
    ctx.lineTo(px + plate + 2, yy - 8);
    ctx.lineTo(px + plate + 2, yy - 3);
    ctx.lineTo(px - 2, yy + 5);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.fillRect(d > 0 ? face - 3 : face, top, 3, h);
  ctx.restore();

  if (flash > 0) {
    ctx.globalAlpha = flash * 0.55;
    ctx.fillStyle = '#FFFFFF';
    roundRectPath(ctx, Math.min(wallX, face), top, Math.abs(face - wallX), h, 4);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

const LED: Record<PusherPhase, string> = {
  rest: COLORS.green,
  windup: COLORS.gold,
  extend: COLORS.red,
  hold: COLORS.red,
  retract: '#9DB0B5',
};

function drawPusherLed(ctx: CanvasRenderingContext2D, p: Pusher, time: number): void {
  const d = p.dir;
  const x = p.wallX + d * 13;
  const y = p.cfg.y - 10;
  let color = LED[p.phase];
  if (p.phase === 'windup' && Math.sin(time * 40) < 0) color = '#FBE3A8';
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, 3.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.beginPath();
  ctx.arc(x - 1.1, y - 1.1, 1.1, 0, Math.PI * 2);
  ctx.fill();
  if (p.flash > 0) {
    ctx.strokeStyle = COLORS.gold;
    ctx.globalAlpha = p.flash;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, 6 + (1 - p.flash) * 10, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

export function drawPipeBack(ctx: CanvasRenderingContext2D, stage: StageConfig): void {
  const g = pipeGeometry(stage);
  ctx.fillStyle = '#2F6E51';
  ctx.beginPath();
  ctx.ellipse(g.x, g.mouthY - 1, g.innerHalf + 1, 4, 0, 0, Math.PI * 2);
  ctx.fill();
}

export function drawPipeFront(ctx: CanvasRenderingContext2D, stage: StageConfig, squash: number): void {
  const g = pipeGeometry(stage);
  const H = WORLD.height;
  const t = 1 - squash;
  const s = squash > 0 ? Math.sin(t * Math.PI * 2) * (1 - t) * 0.13 : 0;
  ctx.save();
  ctx.translate(g.x, stage.floorY);
  ctx.scale(1 + s * 0.7, 1 - s);
  ctx.translate(-g.x, -stage.floorY);

  const bodyTop = g.mouthY + PIPE.rimHeight - 2;
  ctx.fillStyle = COLORS.green;
  ctx.fillRect(g.x - g.outerHalf, bodyTop, g.outerHalf * 2, H - bodyTop);
  ctx.fillStyle = COLORS.greenLight;
  ctx.fillRect(g.x - g.outerHalf + 4, bodyTop, 5, H - bodyTop);
  ctx.fillStyle = COLORS.greenDark;
  ctx.fillRect(g.x + g.outerHalf - 7, bodyTop, 7, H - bodyTop);

  // rim
  const rimTop = g.mouthY - 3;
  roundRectPath(ctx, g.x - g.rimHalf, rimTop, g.rimHalf * 2, PIPE.rimHeight + 3, 4);
  ctx.fillStyle = COLORS.greenLight;
  ctx.fill();
  ctx.fillStyle = COLORS.greenDark;
  ctx.fillRect(g.x - g.rimHalf + 2, rimTop + PIPE.rimHeight, g.rimHalf * 2 - 4, 3);
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.fillRect(g.x - g.rimHalf + 5, rimTop + 2, 8, 3);
  ctx.restore();
}

function drawCharges(
  ctx: CanvasRenderingContext2D,
  stage: StageConfig,
  charges: number,
  max: number,
  flash: number,
  time: number,
): void {
  const c = stage.charges;
  const full = Math.floor(charges + 1e-6);
  const frac = charges - full;
  const shakeX = flash > 0 ? Math.sin(time * 55) * flash * 2.2 : 0;
  const pip = pipLayout(max);
  for (let i = 0; i < max; i++) {
    const x = c.x - ((max - 1) * pip.spacing) / 2 + i * pip.spacing + shakeX;
    if (i < full) {
      miniBalloon(ctx, x, c.y - 0.5, pip.r, COLORS.red);
    } else if (i === full && frac > 0.01) {
      ctx.strokeStyle = COLORS.red;
      ctx.globalAlpha = 0.75;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, c.y, 3.6, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }
  if (flash > 0) {
    ctx.globalAlpha = flash * 0.6;
    ctx.strokeStyle = COLORS.red;
    ctx.lineWidth = 2;
    const half = ((max - 1) * pip.spacing) / 2 + 9;
    roundRectPath(ctx, c.x - half + shakeX, c.y - 9, half * 2, 18, 9);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

/** Small static rendering of a stage for the stage-clear card. */
export function renderStagePreview(canvas: HTMLCanvasElement, stage: StageConfig, cssW: number, cssH: number): void {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  const ctx = canvas.getContext('2d')!;
  const scale = Math.min(cssW / WORLD.width, cssH / WORLD.height);
  const ox = (cssW - WORLD.width * scale) / 2;
  const oy = (cssH - WORLD.height * scale) / 2;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = stage.palette.wall;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * ox, dpr * oy);
  drawBackground(ctx, stage);
  for (const p of stage.pushers) drawRam(ctx, p, p.maxTravel * 0.45, 0, 0, 0);
  drawWalls(ctx, stage, scale * dpr);
  drawWallDetails(ctx, stage, 3);
  drawPipeBack(ctx, stage);
  drawPipeFront(ctx, stage, 0);
  // route arrow
  ctx.strokeStyle = 'rgba(237,102,100,0.75)';
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.setLineDash([2, 12]);
  ctx.beginPath();
  stage.path.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.stroke();
  ctx.setLineDash([]);
}
