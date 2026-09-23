// Measures pops/s and crowding for given upgrade levels while the "player" holds the pipe open.
// node scripts/throughput.mjs [level=1] [pipeLv=8] [pusherLevels=0,3,6] [simSec=60] [speed=6]
import { chromium } from 'playwright';

const level = Number(process.argv[2] ?? 1);
const pipeLv = Number(process.argv[3] ?? 8);
const pusherLevels = (process.argv[4] ?? '0,3,6').split(',').map(Number);
const simSec = Number(process.argv[5] ?? 60);
const speed = Number(process.argv[6] ?? 6);
const tweak = JSON.parse(process.argv[7] ?? '{}');

const browser = await chromium.launch(process.env.PW_CHANNEL === 'bundled' ? {} : { channel: process.env.PW_CHANNEL || 'chrome' });
for (const pl of pusherLevels) {
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await page.goto(`http://localhost:5173/?reset=1&test=1&speed=${speed}`);
  await page.waitForTimeout(400);
  await page.evaluate(({ level, pipeLv, pl, tweak }) => {
    const g = window.popward.game;
    for (const [group, values] of Object.entries(tweak)) Object.assign(window.popward.balance[group], values);
    g.state.level = level;
    g.state.upgrades.pipe = pipeLv;
    g.state.upgrades.lowerPusher = pl;
    g.state.upgrades.upperPusher = pl;
    g.state.progress = -1e9; // never clear the stage during the measurement
    g.loadStage();
    g.applyUpgrades();
    g.state.charges = g.upgrades.maxCharges();
    g.press(); // hold
    window.__samples = [];
    window.__t0 = g.simTime;
    window.__p0 = g.state.stats.pops;
    setInterval(() => window.__samples.push(g.balloons.length), 100);
  }, { level, pipeLv, pl, tweak });
  let r;
  while (true) {
    await page.waitForTimeout(300);
    r = await page.evaluate(() => {
      const g = window.popward.game;
      const s = window.__samples;
      return { t: g.simTime - window.__t0, pops: g.state.stats.pops - window.__p0, avg: s.reduce((a, b) => a + b, 0) / Math.max(1, s.length), max: Math.max(...s, 0), rescues: g.rescueCount, recov: g.recoveryCount };
    });
    if (r.t >= simSec) break;
  }
  console.log(`level ${level} pipe L${pipeLv} pushers L${pl}: ${(r.pops / r.t).toFixed(2)} pops/s, balloons avg ${r.avg.toFixed(1)} max ${r.max}, rescues ${r.rescues}, recoveries ${r.recov}`);
  await page.close();
}
await browser.close();
