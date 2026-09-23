// Pacing bot: taps like an active player and buys the cheapest affordable upgrade.
// node scripts/pacing.mjs [simSeconds] [speed] [tapEverySec] [buy=1]
import { chromium } from 'playwright';

const simSeconds = Number(process.argv[2] ?? 240);
const speed = Number(process.argv[3] ?? 4);
const tapEvery = Number(process.argv[4] ?? 0.3);
const buy = (process.argv[5] ?? '1') === '1';
const shotPrefix = process.argv[6] ?? '';

const browser = await chromium.launch(process.env.PW_CHANNEL === 'bundled' ? {} : { channel: process.env.PW_CHANNEL || 'chrome' });
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto(`http://localhost:5173/?reset=1&test=1&speed=${speed}`);
await page.waitForTimeout(500);

await page.evaluate(({ tapEvery, buy }) => {
  const g = window.popward.game;
  const log = (window.__log = []);
  let nextTap = 0;
  let lastLevel = g.state.level;
  const ids = ['pipe', 'lowerPusher', 'upperPusher', 'value', 'evolution'];
  window.__bot = setInterval(() => {
    if (g.mode === 'cleared') {
      log.push({ t: +g.simTime.toFixed(1), ev: 'clear', level: g.state.level, money: g.state.money });
      g.continueToNextStage();
    }
    if (g.state.level !== lastLevel) lastLevel = g.state.level;
    if (g.simTime >= nextTap) {
      nextTap = g.simTime + tapEvery;
      g.press();
      g.release();
    }
    if (buy) {
      // Cheapest-first, except the bot saves up for Value when it is within 2.5x of the cheapest option.
      let cheapest = null;
      for (const id of ids) {
        if (!g.upgrades.isMax(id) && (!cheapest || g.upgrades.cost(id) < g.upgrades.cost(cheapest))) cheapest = id;
      }
      let target = cheapest;
      if (!g.upgrades.isMax('value') && g.upgrades.cost('value') <= 2.5 * g.upgrades.cost(cheapest)) target = 'value';
      const best = target && g.upgrades.canBuy(target) ? target : null;
      if (best) {
        const cost = g.upgrades.cost(best);
        g.buy(best);
        log.push({ t: +g.simTime.toFixed(1), ev: 'buy', id: best, lvl: g.upgrades.level(best), cost });
      }
    }
  }, 16);
}, { tapEvery, buy });

let lastPrint = -10;
let shotN = 0;
while (true) {
  await page.waitForTimeout(250);
  const s = await page.evaluate(() => {
    const g = window.popward.game;
    return { t: g.simTime, level: g.state.level, money: g.state.money, progress: g.state.progress, target: g.target, balloons: g.balloons.length, pops: g.state.stats.pops, rescues: g.rescueCount, recov: g.recoveryCount };
  });
  if (s.t - lastPrint >= 20) {
    lastPrint = s.t;
    console.log(`t=${s.t.toFixed(0)}s L${s.level} $${s.money} prog ${s.progress}/${s.target} balloons ${s.balloons} pops ${s.pops} rescues ${s.rescues} recov ${s.recov}`);
    if (shotPrefix) await page.screenshot({ path: `screenshots/${shotPrefix}-${shotN++}.png` });
  }
  if (s.t >= simSeconds) break;
}
const log = await page.evaluate(() => window.__log);
console.log(log.map((e) => (e.ev === 'buy' ? `${e.t}s buy ${e.id}→${e.lvl} ($${e.cost})` : `${e.t}s CLEAR level ${e.level} (money $${e.money})`)).join('\n'));
console.log(errors.length ? errors.join('\n') : '(no errors)');
await browser.close();
