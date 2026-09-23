import type { Vec } from '../config/stages';

export const COLORS = {
  ink: '#27363A',
  inkSoft: '#5B6B6F',
  red: '#ED6664',
  redDark: '#C94C4B',
  teal: '#56C7D0',
  tealDark: '#3AA6AF',
  green: '#59B989',
  greenLight: '#76CDA2',
  greenDark: '#44996F',
  gold: '#F4C76D',
  goldDark: '#DDA548',
  steel: '#A9B9BD',
  steelLight: '#C3D0D3',
  steelDark: '#8C9EA3',
  spike: '#7D8E93',
  spikeLight: '#A7B6BA',
  spikeBase: '#5F7176',
  shadow: 'rgba(39,54,58,0.10)',
};

/** Polygon path with softly rounded corners (radius clamped to half of each edge). */
export function roundedPolyPath(ctx: CanvasRenderingContext2D, pts: Vec[], radius: number): void {
  const n = pts.length;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n];
    const cur = pts[i];
    const next = pts[(i + 1) % n];
    const d1 = Math.hypot(cur.x - prev.x, cur.y - prev.y);
    const d2 = Math.hypot(next.x - cur.x, next.y - cur.y);
    const r = Math.min(radius, d1 / 2, d2 / 2);
    const ax = cur.x + ((prev.x - cur.x) / d1) * r;
    const ay = cur.y + ((prev.y - cur.y) / d1) * r;
    if (i === 0) ctx.moveTo(ax, ay);
    else ctx.lineTo(ax, ay);
    ctx.arcTo(cur.x, cur.y, next.x, next.y, r);
  }
  ctx.closePath();
}

export function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

export function centroid(pts: Vec[]): Vec {
  let x = 0;
  let y = 0;
  for (const p of pts) {
    x += p.x;
    y += p.y;
  }
  return { x: x / pts.length, y: y / pts.length };
}

/** Mini balloon glyph used by the gauge and charge pips. */
export function miniBalloon(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(x, y, r * 0.92, r * 1.05, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(x - r * 0.25, y + r * 1.25);
  ctx.lineTo(x + r * 0.25, y + r * 1.25);
  ctx.lineTo(x, y + r * 0.95);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.beginPath();
  ctx.ellipse(x - r * 0.35, y - r * 0.4, r * 0.18, r * 0.28, -0.5, 0, Math.PI * 2);
  ctx.fill();
}
