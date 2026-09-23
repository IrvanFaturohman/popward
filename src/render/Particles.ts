import { FX } from '../balance';
import { rand } from '../util/math';

type Kind = 'shard' | 'dot' | 'ring' | 'confetti' | 'puff' | 'spark' | 'blob';

interface Particle {
  kind: Kind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  size1: number;
  color: string;
  rot: number;
  vr: number;
  gravity: number;
  drag: number;
}

interface FloatText {
  x: number;
  y: number;
  vy: number;
  text: string;
  color: string;
  life: number;
  max: number;
  size: number;
}

const CONFETTI = ['#ED6664', '#56C7D0', '#F4C76D', '#59B989', '#FFFFFF'];

/** World-space particles and floating labels. Pooled by simple caps rather than object reuse. */
export class Particles {
  readonly items: Particle[] = [];
  readonly texts: FloatText[] = [];
  reduced = false;

  private n(count: number): number {
    return this.reduced ? Math.max(1, Math.round(count * FX.reducedParticles)) : count;
  }

  private push(p: Partial<Particle> & Pick<Particle, 'kind' | 'x' | 'y' | 'color'>): void {
    if (this.items.length >= FX.maxParticles) this.items.shift();
    this.items.push({
      vx: 0,
      vy: 0,
      life: 0,
      max: 0.5,
      size: 3,
      size1: 3,
      rot: 0,
      vr: 0,
      gravity: 0,
      drag: 3,
      ...p,
    });
  }

  popBurst(x: number, y: number, color: string, heavy: boolean, radius = 15): void {
    // The balloon swells and flattens for a few frames before it bursts.
    this.push({ kind: 'blob', x, y, color, max: 0.075, size: radius, size1: radius * 1.28 });
    const count = this.n(heavy ? FX.popShards : Math.max(4, FX.popShards - 2));
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + rand(-0.3, 0.3);
      const speed = rand(110, 210);
      this.push({
        kind: 'shard',
        x: x + Math.cos(a) * 6,
        y: y + Math.sin(a) * 6,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        max: rand(0.35, 0.55),
        size: rand(3.5, 5.5),
        color,
        rot: a,
        vr: rand(-10, 10),
        gravity: 260,
        drag: 4,
      });
    }
    this.push({ kind: 'ring', x, y, color, max: 0.28, size: 10, size1: 26 });
  }

  ring(x: number, y: number, color: string, r0: number, r1: number, life: number): void {
    this.push({ kind: 'ring', x, y, color, max: life, size: r0, size1: r1 });
  }

  sparkle(x: number, y: number, color: string, count: number): void {
    const c = this.n(count);
    for (let i = 0; i < c; i++) {
      const a = rand(0, Math.PI * 2);
      const s = rand(40, 120);
      this.push({
        kind: 'spark',
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        max: rand(0.35, 0.6),
        size: rand(2.5, 4),
        color,
        rot: rand(0, Math.PI),
        vr: rand(-4, 4),
        drag: 3,
      });
    }
  }

  puff(x: number, y: number, dx: number, dy: number): void {
    const c = this.n(3);
    for (let i = 0; i < c; i++) {
      this.push({
        kind: 'puff',
        x: x - dx * 14 + rand(-4, 4),
        y: y - dy * 14 + rand(-4, 4),
        vx: -dx * rand(20, 50),
        vy: -dy * rand(20, 50),
        max: rand(0.35, 0.5),
        size: rand(4, 6),
        size1: rand(9, 12),
        color: '#FFFFFF',
      });
    }
  }

  confetti(width: number, top: number): void {
    const c = this.n(56);
    for (let i = 0; i < c; i++) {
      this.push({
        kind: 'confetti',
        x: rand(20, width - 20),
        y: top + rand(-30, 10),
        vx: rand(-40, 40),
        vy: rand(40, 140),
        max: rand(1.4, 2.2),
        size: rand(4, 7),
        color: CONFETTI[i % CONFETTI.length],
        rot: rand(0, Math.PI),
        vr: rand(-8, 8),
        gravity: 120,
        drag: 1.2,
      });
    }
  }

  text(x: number, y: number, text: string, color: string, size = 15, life = 0.9): void {
    if (this.texts.length > 24) this.texts.shift();
    this.texts.push({ x, y, vy: -46, text, color, life: 0, max: this.reduced ? life * 0.8 : life, size });
  }

  update(dt: number): void {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const p = this.items[i];
      p.life += dt;
      if (p.life >= p.max) {
        this.items.splice(i, 1);
        continue;
      }
      const drag = Math.exp(-p.drag * dt);
      p.vx *= drag;
      p.vy = p.vy * drag + p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      if (p.kind === 'confetti') p.vx += Math.sin(p.life * 7 + p.rot) * 30 * dt;
    }
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i];
      t.life += dt;
      if (t.life >= t.max) {
        this.texts.splice(i, 1);
        continue;
      }
      t.y += t.vy * dt;
      t.vy *= Math.exp(-2.5 * dt);
    }
  }

  clear(): void {
    this.items.length = 0;
    this.texts.length = 0;
  }

  draw(ctx: CanvasRenderingContext2D, font: string): void {
    for (const p of this.items) {
      const k = p.life / p.max;
      const alpha = 1 - k;
      ctx.globalAlpha = alpha;
      switch (p.kind) {
        case 'shard': {
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.fillStyle = p.color;
          const s = p.size * (1 - k * 0.5);
          ctx.beginPath();
          ctx.moveTo(-s, -s * 0.5);
          ctx.quadraticCurveTo(0, -s * 1.1, s, -s * 0.3);
          ctx.lineTo(s * 0.3, s * 0.6);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
          break;
        }
        case 'blob': {
          const r = p.size + (p.size1 - p.size) * k;
          ctx.globalAlpha = 1 - k * k;
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.ellipse(p.x, p.y, r * 1.08, r * 0.86, 0, 0, Math.PI * 2);
          ctx.fill();
          break;
        }
        case 'dot':
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * (1 - k * 0.6), 0, Math.PI * 2);
          ctx.fill();
          break;
        case 'ring': {
          const r = p.size + (p.size1 - p.size) * (1 - Math.pow(1 - k, 3));
          ctx.strokeStyle = p.color;
          ctx.lineWidth = 2.5 * (1 - k) + 0.5;
          ctx.beginPath();
          ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
          ctx.stroke();
          break;
        }
        case 'puff': {
          ctx.globalAlpha = alpha * 0.7;
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size + (p.size1 - p.size) * k, 0, Math.PI * 2);
          ctx.fill();
          break;
        }
        case 'spark': {
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.fillStyle = p.color;
          const s = p.size * (1 - k * 0.4);
          ctx.beginPath();
          ctx.moveTo(0, -s * 1.6);
          ctx.lineTo(s * 0.45, 0);
          ctx.lineTo(0, s * 1.6);
          ctx.lineTo(-s * 0.45, 0);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
          break;
        }
        case 'confetti': {
          ctx.globalAlpha = Math.min(1, (1 - k) * 2.5);
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.scale(1, Math.cos(p.life * 9 + p.rot));
          ctx.fillStyle = p.color;
          ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
          ctx.restore();
          break;
        }
      }
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    for (const t of this.texts) {
      const k = t.life / t.max;
      const pop = k < 0.15 ? 0.7 + (k / 0.15) * 0.3 : 1;
      ctx.globalAlpha = k > 0.6 ? 1 - (k - 0.6) / 0.4 : 1;
      ctx.font = `900 ${Math.round(t.size * pop)}px ${font}`;
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.strokeText(t.text, t.x, t.y);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, t.x, t.y);
    }
    ctx.globalAlpha = 1;
  }
}
