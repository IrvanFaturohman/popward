// Automated play session: taps the arena and reports game state over time.
// node scripts/play.mjs [seconds] [tapIntervalMs] [speed] [prefix]
import { chromium } from 'playwright';

const seconds = Number(process.argv[2] ?? 20);
const tapMs = Number(process.argv[3] ?? 300);
const speed = Number(process.argv[4] ?? 1);
const prefix = process.argv[5] ?? 'play';
const shots = (process.argv[6] ?? '').split(',').filter(Boolean).map(Number);

const browser = await chromium.launch(process.env.PW_CHANNEL === 'bundled' ? {} : { channel: process.env.PW_CHANNEL || 'chrome' });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && errors.push(`${m.type()}: ${m.text()}`));
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
await page.goto(`http://localhost:5173/?reset=1&${process.env.DEBUG ? 'debug=1' : 'test=1'}&speed=${speed}`);
await page.waitForTimeout(600);
const box = await page.locator('#game-canvas').boundingBox();
const tapAt = { x: box.x + box.width * 0.5, y: box.y + box.height * 0.62 };

const snap = () =>
  page.evaluate(() => {
    const g = window.popward.game;
    return {
      t: +g.simTime.toFixed(1),
      balloons: g.balloons.length,
      money: g.state.money,
      progress: g.state.progress,
      pops: g.state.stats.pops,
      blues: g.state.stats.blues,
      charges: +g.state.charges.toFixed(2),
      rescues: g.rescueCount,
      recoveries: g.recoveryCount,
      mode: g.mode,
      evo: +g.state.evo.toFixed(2),
    };
  });

const start = Date.now();
let nextShot = 0;
let lastLog = 0;
while ((Date.now() - start) / 1000 < seconds) {
  await page.mouse.click(tapAt.x, tapAt.y);
  await page.waitForTimeout(tapMs);
  const el = (Date.now() - start) / 1000;
  if (el - lastLog >= 2) {
    lastLog = el;
    console.log(JSON.stringify(await snap()));
  }
  if (nextShot < shots.length && el >= shots[nextShot]) {
    await page.screenshot({ path: `screenshots/${prefix}-${shots[nextShot]}s.png` });
    nextShot++;
  }
}
console.log('final', JSON.stringify(await snap()));
console.log(errors.length ? errors.join('\n') : '(no console errors)');
await browser.close();
