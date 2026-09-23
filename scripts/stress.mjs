// Stress: maxed pipe + pushers, arena at the balloon cap, CPU throttled to approximate a mid-range phone.
// node scripts/stress.mjs [throttle=4] [seconds=20] [level=1]
import { chromium } from 'playwright';

const throttle = Number(process.argv[2] ?? 4);
const seconds = Number(process.argv[3] ?? 20);
const level = Number(process.argv[4] ?? 1);
const browser = await chromium.launch(process.env.PW_CHANNEL === 'bundled' ? {} : { channel: process.env.PW_CHANNEL || 'chrome' });
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2.75, isMobile: true, hasTouch: true })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const cdp = await page.context().newCDPSession(page);
await page.goto(`http://localhost:5173/?reset=1&test=1`);
await page.waitForTimeout(400);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
await page.evaluate((level) => {
  const g = window.popward.game;
  g.state.level = level;
  for (const id of ['pipe', 'lowerPusher', 'upperPusher', 'evolution']) g.state.upgrades[id] = 10;
  g.state.progress = -1e9;
  g.loadStage();
  g.applyUpgrades();
  g.press(); // hold the pipe open for the whole run
  window.__frames = [];
  let last = performance.now();
  const tick = (t) => {
    window.__frames.push(t - last);
    last = t;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  setInterval(() => (g.state.charges = g.upgrades.maxCharges()), 200);
}, level);
await page.waitForTimeout(seconds * 1000);
const r = await page.evaluate(() => {
  const g = window.popward.game;
  const f = window.__frames.slice(60).sort((a, b) => a - b);
  const avg = f.reduce((a, b) => a + b, 0) / f.length;
  const nan = g.balloons.some((b) => !Number.isFinite(b.x) || !Number.isFinite(b.y));
  const outside = g.balloons.filter((b) => b.x < 0 || b.x > 360 || b.y < 0 || b.y > 620).length;
  return {
    fps: +(1000 / avg).toFixed(1),
    p95ms: +f[Math.floor(f.length * 0.95)].toFixed(1),
    balloons: g.balloons.length,
    pops: g.state.stats.pops,
    popsPerSec: +(g.state.stats.pops / g.simTime).toFixed(2),
    rescues: g.rescueCount,
    recoveries: g.recoveryCount,
    nan,
    outside,
    sim: +g.simTime.toFixed(1),
  };
});
console.log(`throttle ${throttle}x level ${level}:`, JSON.stringify(r));
console.log(errors.join('\n') || 'no errors');
await page.screenshot({ path: `screenshots/stress-L${level}.png` });
await browser.close();
