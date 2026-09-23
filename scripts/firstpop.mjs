// Time to first pop and pops after 45 s per stage, with normal tapping (charge-limited).
// node scripts/firstpop.mjs [pusherLevels=0,2] [speed=4]
import { chromium } from 'playwright';
const levels = (process.argv[2] ?? '0,2').split(',').map(Number);
const speed = Number(process.argv[3] ?? 4);
const browser = await chromium.launch(process.env.PW_CHANNEL === 'bundled' ? {} : { channel: process.env.PW_CHANNEL || 'chrome' });
for (const stage of [1, 2, 3]) {
  for (const pl of levels) {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
    await page.goto(`http://localhost:5173/?reset=1&test=1&speed=${speed}`);
    await page.waitForTimeout(300);
    const r = await page.evaluate(async ({ stage, pl }) => {
      const g = window.popward.game;
      g.state.level = stage;
      g.state.upgrades.lowerPusher = pl;
      g.state.upgrades.upperPusher = pl;
      g.loadStage();
      g.applyUpgrades();
      const t0 = g.simTime;
      let first = null;
      g.bus.on('pop', () => { if (first === null) first = g.simTime - t0; });
      let next = 0;
      while (g.simTime - t0 < 45) {
        if (g.simTime >= next) { next = g.simTime + 0.3; g.press(); g.release(); }
        await new Promise((res) => setTimeout(res, 16));
      }
      return { first: first === null ? null : +first.toFixed(1), pops: g.state.stats.pops, rescues: g.rescueCount };
    }, { stage, pl });
    console.log(`stage ${stage} pushers L${pl}: first pop ${r.first}s, pops in 45s ${r.pops}, rescues ${r.rescues}`);
    await page.close();
  }
}
await browser.close();
