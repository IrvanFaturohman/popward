// Close-up of a region of the arena after some play: node scripts/zoom.mjs [level] [seconds] [x0 y0 x1 y1 (world)]
import { chromium } from 'playwright';
const level = Number(process.argv[2] ?? 1);
const secs = Number(process.argv[3] ?? 20);
const [x0, y0, x1, y1] = (process.argv[4] ?? '14,300,346,574').split(',').map(Number);
const out = process.argv[5] ?? `screenshots/zoom-L${level}.png`;
const browser = await chromium.launch(process.env.PW_CHANNEL === 'bundled' ? {} : { channel: process.env.PW_CHANNEL || 'chrome' });
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 })).newPage();
await page.goto('http://localhost:5173/?reset=1&test=1');
await page.waitForTimeout(300);
await page.evaluate((level) => {
  const g = window.popward.game;
  g.state.level = level; g.state.hintDone = true; document.getElementById('hint').hidden = true;
  g.loadStage(); g.bus.emit('stageStart', { level });
  setInterval(() => { g.state.charges = Math.max(g.state.charges, 1); g.press(); g.release(); }, 450);
}, level);
await page.waitForTimeout(secs * 1000);
const rect = await page.evaluate(([x0, y0, x1, y1]) => {
  const cam = window.popward.renderer.cam;
  const c = document.getElementById('game-canvas').getBoundingClientRect();
  const a = cam.toScreen(x0, y0), b = cam.toScreen(x1, y1);
  return { x: c.left + a.x, y: c.top + a.y, width: b.x - a.x, height: b.y - a.y };
}, [x0, y0, x1, y1]);
await page.screenshot({ path: out, clip: rect });
const stats = await page.evaluate(() => {
  const g = window.popward.game;
  const angles = g.balloons.map((b) => Math.abs(((b.angle % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI) - Math.PI));
  // angle distance from upright (0 = upright, PI = upside down)
  const tilt = g.balloons.map((b) => { let a = ((b.angle + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI; return Math.abs(a); });
  return { n: g.balloons.length, pops: g.state.stats.pops, maxTiltDeg: Math.round(Math.max(0, ...tilt) * 57.3), over45: tilt.filter((t) => t > 0.785).length, over120: tilt.filter((t) => t > 2.1).length, void: angles.length };
});
console.log(out, JSON.stringify(stats));
await browser.close();
