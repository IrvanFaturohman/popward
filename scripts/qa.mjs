// End-to-end QA against a running dev server (npm run dev). Uses the locally installed Chrome.
// node scripts/qa.mjs [baseUrl]
import { chromium } from 'playwright';

const BASE = process.argv[2] ?? 'http://localhost:5173/';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

const browser = await chromium.launch(process.env.PW_CHANNEL === 'bundled' ? {} : { channel: process.env.PW_CHANNEL || 'chrome' });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && errors.push(`${m.type()}: ${m.text()}`));

const G = (fn, arg) => page.evaluate(fn, arg);
const state = () =>
  G(() => {
    const g = window.popward.game;
    return {
      balloons: g.balloons.length,
      charges: g.state.charges,
      money: g.state.money,
      progress: g.state.progress,
      level: g.state.level,
      mode: g.mode,
      sim: g.simTime,
      pops: g.state.stats.pops,
      blues: g.state.balloons,
    };
  });

await page.goto(BASE + '?reset=1&test=1');
await page.waitForTimeout(700);
const canvas = await page.locator('#game-canvas').boundingBox();
const tapPoint = { x: canvas.x + canvas.width * 0.55, y: canvas.y + canvas.height * 0.6 };

// ---- 1. Tap spawns exactly one balloon and uses one charge
{
  const before = await state();
  await page.mouse.click(tapPoint.x, tapPoint.y);
  await page.waitForTimeout(60);
  const after = await state();
  check('tap spawns one balloon', after.balloons === before.balloons + 1, `${before.balloons} → ${after.balloons}`);
  check('tap consumes one charge', Math.abs(before.charges - after.charges - 1) < 0.2, `${before.charges.toFixed(2)} → ${after.charges.toFixed(2)}`);
}

// ---- 2. Hold spawns repeatedly but only while charges last (no frame flood)
{
  await page.waitForTimeout(3500); // let charges refill
  const before = await state();
  await page.mouse.move(tapPoint.x, tapPoint.y);
  await page.mouse.down();
  await page.waitForTimeout(1000);
  await page.mouse.up();
  const after = await state();
  const spawned = after.balloons + (after.pops - before.pops) - before.balloons;
  check('hold spawns several balloons', spawned >= 3, `spawned ${spawned}`);
  check('hold is limited by charges', spawned <= 4, `spawned ${spawned} in 1s with 3 charges`);
  const c0 = after.charges;
  await page.waitForTimeout(1600);
  const c1 = (await state()).charges;
  check('charges recover over time', c1 > c0 + 0.5, `${c0.toFixed(2)} → ${c1.toFixed(2)}`);
}

// ---- 3. Tapping UI (chips, tray, HUD) never spawns
{
  await page.waitForTimeout(500);
  const before = await state();
  await page.locator('.chip[data-up="pipe"]').click();
  await page.locator('.tray-btn[data-up="value"]').click();
  await page.locator('.chip[data-up="lowerPusher"]').click();
  await page.waitForTimeout(80);
  const after = await state();
  const spawned = after.balloons + (after.pops - before.pops) - before.balloons;
  check('UI taps do not spawn balloons', spawned === 0, `spawned ${spawned}`);
  check('unaffordable purchase leaves money unchanged', after.money === before.money, `$${before.money} → $${after.money}`);
  const toast = await page.locator('.toast').count();
  check('unaffordable purchase shows small feedback', toast > 0, `${toast} toast(s)`);
}

// ---- 4. Idle auto-spawn
{
  const before = await state();
  await page.waitForTimeout(7500);
  const after = await state();
  const spawned = after.balloons + (after.pops - before.pops) - before.balloons;
  check('idle auto-spawn keeps the pipe alive', spawned >= 1 && spawned <= 3, `spawned ${spawned} in 7.5s idle`);
}

// ---- 5. Pops pay out exactly once and progress matches
{
  await G(() => {
    const g = window.popward.game;
    window.__popSum = 0;
    window.__popCount = 0;
    window.__m0 = g.state.money;
    window.__p0 = g.state.progress;
    g.bus.on('pop', (e) => {
      window.__popSum += e.value;
      window.__popCount++;
    });
  });
  for (let i = 0; i < 12; i++) {
    await page.mouse.click(tapPoint.x, tapPoint.y);
    await page.waitForTimeout(450);
  }
  await page.waitForTimeout(9000);
  const r = await G(() => {
    const g = window.popward.game;
    return { sum: window.__popSum, count: window.__popCount, dm: g.state.money - window.__m0, dp: g.state.progress - window.__p0 };
  });
  check('balloons reach the spikes and pop', r.count >= 5, `${r.count} pops`);
  check('money gained equals pop values (no double award)', r.dm === r.sum, `money +${r.dm}, pop values ${r.sum}`);
  check('progress gained equals pop values', r.dp === r.sum, `progress +${r.dp}`);
}

// ---- 6. Evolution: oldest red turns teal, bar resets, teal pays more
{
  // Judge the choice at the moment the game makes it (a pre-computed "oldest" may pop while we wait).
  const r = await G(async () => {
    const g = window.popward.game;
    g.press();
    g.release();
    await new Promise((res) => setTimeout(res, 1200));
    const pick = new Promise((res) => {
      const off = g.bus.on('evolveStart', ({ balloon }) => {
        off();
        const eligible = g.balloons.filter((b) => b.tier === 'red' && b !== balloon && !b.targeted && g.simTime - b.bornAt >= 0.8);
        res({ id: balloon.id, oldest: eligible.every((b) => b.bornAt >= balloon.bornAt) });
      });
    });
    g.state.evo = 0.999;
    const chosen = await pick;
    await new Promise((res) => setTimeout(res, 700));
    const b = g.balloons.find((x) => x.id === chosen.id);
    return { ...chosen, tier: b ? b.tier : 'popped', evo: g.state.evo };
  });
  check('evolution converts the oldest red balloon', r.oldest && (r.tier === 'blue' || r.tier === 'popped'), JSON.stringify(r));
  check('evolution bar resets after converting', r.evo < 0.2, `evo ${r.evo.toFixed(2)}`);
  const values = await G(() => {
    const u = window.popward.game.upgrades;
    return { red: u.balloonValue('red'), blue: u.balloonValue('blue') };
  });
  check('teal is worth more than red', values.blue > values.red, `red $${values.red}, teal $${values.blue}`);
  // teal pop pays teal value
  const tealPay = await G(async () => {
    const g = window.popward.game;
    return await new Promise((res) => {
      const off = g.bus.on('pop', (e) => {
        if (e.balloon.tier === 'blue') {
          off();
          res(e.value);
        }
      });
      setTimeout(() => res(null), 15000);
    });
  });
  check('teal pop pays the teal value', tealPay === values.blue, `paid $${tealPay}`);
  // no reds → bar waits full
  const waiting = await G(async () => {
    const g = window.popward.game;
    g.menuOpen = true;
    for (const b of [...g.balloons]) if (b.tier === 'red') b.tier = 'blue';
    g.menuOpen = false;
    g.state.evo = 1;
    await new Promise((res) => setTimeout(res, 400));
    const w = { waiting: g.evoWaiting, evo: g.state.evo };
    return w;
  });
  check('bar waits full when no red balloon exists', waiting.waiting === true && waiting.evo === 1, JSON.stringify(waiting));
  // Wait (up to 10 s) for an idle spawn to become old enough to evolve.
  const resumed = await G(async () => {
    const g = window.popward.game;
    for (let i = 0; i < 100 && g.state.evo >= 1; i++) await new Promise((res) => setTimeout(res, 100));
    return g.state.evo;
  });
  check('waiting bar fires once a red balloon appears', resumed < 1, `evo ${resumed.toFixed(2)}`);
}

// ---- 7. Purchases: exact cost, level up, price up, never negative
{
  const ids = ['pipe', 'lowerPusher', 'upperPusher', 'value', 'evolution'];
  for (const id of ids) {
    const r = await G((id) => {
      const g = window.popward.game;
      g.economy.grant(1000);
      const m0 = g.state.money;
      const c0 = g.upgrades.cost(id);
      const l0 = g.upgrades.level(id);
      const ok = g.buy(id);
      return { ok, spent: m0 - g.state.money, c0, c1: g.upgrades.cost(id), l0, l1: g.upgrades.level(id) };
    }, id);
    check(`buy ${id}: charged exactly once`, r.ok && r.spent === r.c0, `spent $${r.spent} of $${r.c0}`);
    check(`buy ${id}: level and price increase`, r.l1 === r.l0 + 1 && r.c1 > r.c0, `Lv${r.l0}→${r.l1}, $${r.c0}→$${r.c1}`);
  }
  const effects = await G(() => {
    const g = window.popward.game;
    return {
      pusherCycle: g.pushers.map((p) => p.cycleSec),
      baseCycle: window.popward.balance.PUSHER.baseCycleSec,
      charges: g.upgrades.maxCharges(),
      recharge: g.upgrades.rechargeSec(),
      evoSec: g.upgrades.evolutionSec(),
      red: g.upgrades.balloonValue('red'),
    };
  });
  check('pusher upgrade takes effect immediately', effects.pusherCycle.every((c) => c < effects.baseCycle), JSON.stringify(effects.pusherCycle));
  check('pipe/evolution/value upgrades change stats', effects.recharge < 1.5 && effects.evoSec < 12 && effects.red === 2, JSON.stringify(effects));
  const neg = await G(() => {
    const g = window.popward.game;
    g.state.money = 3;
    const ok = g.buy('value');
    return { ok, money: g.state.money };
  });
  check('cannot buy without money (no negative balance)', !neg.ok && neg.money === 3, JSON.stringify(neg));
}

// ---- 8. Stage complete → card → Continue → layout 2
{
  const before = await G(() => {
    const g = window.popward.game;
    g.state.money = 50;
    g.state.progress = g.target - 1;
    return { money: g.state.money, level: g.state.level, ups: { ...g.state.upgrades } };
  });
  for (let i = 0; i < 4; i++) {
    await page.mouse.click(tapPoint.x, tapPoint.y);
    await page.waitForTimeout(400);
  }
  await page.waitForFunction(() => window.popward.game.mode === 'cleared', null, { timeout: 30000 });
  await page.waitForTimeout(400);
  const card = await page.locator('#stage-card').isVisible();
  check('stage clear card appears', card);
  const cleared = await G(() => {
    const g = window.popward.game;
    return { money: g.state.money, bonus: g.state.stageBonus, progress: g.state.progress, target: g.target };
  });
  check('clear bonus paid', cleared.bonus > 0 && cleared.money >= before.money + cleared.bonus, JSON.stringify(cleared));
  await page.screenshot({ path: 'screenshots/qa-stage-card.png' });
  // tapping arena while card is up must not spawn
  const b0 = (await state()).balloons;
  await page.mouse.click(tapPoint.x, canvas.y + 20);
  check('no spawns while stage card is open', (await state()).balloons === b0);
  await page.locator('#btn-continue').click();
  await page.waitForTimeout(500);
  const after = await G(() => {
    const g = window.popward.game;
    return { level: g.state.level, stage: g.stage.key, balloons: g.balloons.length, money: g.state.money, progress: g.state.progress, ups: { ...g.state.upgrades } };
  });
  check('Continue loads the next layout', after.level === before.level + 1 && after.stage === 'crossover', `${after.level} ${after.stage}`);
  check('old balloons are cleared on new stage', after.balloons === 0, `${after.balloons}`);
  check('money and upgrades carry over', after.money === cleared.money && JSON.stringify(after.ups) === JSON.stringify(before.ups), `$${after.money}`);
  check('progress resets for the new stage', after.progress === 0);
}

// ---- 9. Save + reload, mute persistence
{
  await page.locator('#btn-mute').click();
  await page.waitForTimeout(200);
  const saved = await G(() => {
    const g = window.popward.game;
    g.save();
    return { level: g.state.level, money: g.state.money, ups: { ...g.state.upgrades } };
  });
  await page.goto(BASE + '?test=1');
  await page.waitForTimeout(700);
  const loaded = await G(() => {
    const g = window.popward.game;
    return { level: g.state.level, money: g.state.money, ups: { ...g.state.upgrades }, muted: window.popward.sfx.muted };
  });
  check('reload restores level, money and upgrades', loaded.level === saved.level && loaded.money === saved.money && JSON.stringify(loaded.ups) === JSON.stringify(saved.ups), JSON.stringify(loaded));
  check('mute state persists across reload', loaded.muted === true);
  const label = await page.locator('#btn-mute').getAttribute('aria-label');
  check('mute button reflects state', label === 'Unmute sound', label);
  await page.locator('#btn-mute').click();
}

// ---- 10. Corrupt save falls back safely
{
  await G(() => {
    window.popward.game.save = () => {}; // stop the pagehide autosave from overwriting the corrupt data
    localStorage.setItem('popward.save', '{not json');
  });
  await page.goto(BASE + '?test=1');
  await page.waitForTimeout(500);
  const s = await state();
  check('corrupt save starts a clean game', s.level === 1 && s.money === 0, JSON.stringify({ level: s.level, money: s.money }));
}

// ---- 11. Stage 3 loads and flows
{
  await G(() => {
    const g = window.popward.game;
    g.state.level = 3;
    g.loadStage();
    g.bus.emit('stageStart', { level: 3 });
  });
  for (let i = 0; i < 10; i++) {
    await page.mouse.click(tapPoint.x, tapPoint.y);
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(12000);
  const r = await G(() => ({ key: window.popward.game.stage.key, pops: window.popward.game.state.stats.pops }));
  check('stage 3 (switchback) loads and balloons pop', r.key === 'switchback' && r.pops > 0, JSON.stringify(r));
  await page.screenshot({ path: 'screenshots/qa-stage3.png' });
}

// ---- 12. Page hidden pauses simulation
{
  const t0 = await G(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
    return window.popward.game.simTime;
  });
  await page.waitForTimeout(1500);
  const t1 = await G(() => window.popward.game.simTime);
  check('simulation pauses while hidden', Math.abs(t1 - t0) < 0.05, `${t0.toFixed(2)} → ${t1.toFixed(2)}`);
  await G(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(500);
  const t2 = await G(() => window.popward.game.simTime);
  check('resume continues without a time jump', t2 > t1 && t2 - t1 < 0.8, `${t1.toFixed(2)} → ${t2.toFixed(2)}`);
}

// ---- 13. Active cap under stress
{
  const r = await G(async () => {
    const g = window.popward.game;
    g.state.upgrades.pipe = 12;
    g.applyUpgrades();
    const cap = window.popward.balance.SPAWN.maxActive;
    let max = 0;
    for (let i = 0; i < 450; i++) {
      g.state.charges = 8;
      g.press();
      g.release();
      await new Promise((res) => setTimeout(res, 40));
      max = Math.max(max, g.balloons.length);
    }
    return { max, cap };
  });
  check('active balloon cap is enforced', r.max <= r.cap, `max ${r.max} / cap ${r.cap}`);
}

// ---- 14. Settings → reset progress with confirmation
{
  await page.locator('#btn-settings').click();
  await page.waitForTimeout(200);
  const paused = await G(() => window.popward.game.menuOpen);
  check('settings pauses the game', paused === true);
  await page.locator('#btn-reset').click();
  const confirmVisible = await page.locator('#reset-confirm').isVisible();
  check('reset asks for confirmation', confirmVisible);
  await page.screenshot({ path: 'screenshots/qa-settings.png' });
  await page.locator('#reset-yes').click();
  await page.waitForTimeout(300);
  const s = await G(() => {
    const g = window.popward.game;
    return { level: g.state.level, money: g.state.money, ups: Object.values(g.state.upgrades).reduce((a, b) => a + b, 0), menu: g.menuOpen };
  });
  check('reset returns to level 1 with no money or upgrades', s.level === 1 && s.money === 0 && s.ups === 0 && !s.menu, JSON.stringify(s));
}

// ---- 15. Resize keeps working
{
  await page.setViewportSize({ width: 360, height: 780 });
  await page.waitForTimeout(400);
  await page.setViewportSize({ width: 430, height: 932 });
  await page.waitForTimeout(400);
  const chip = await page.locator('.chip[data-up="pipe"]').boundingBox();
  const cv = await page.locator('#game-canvas').boundingBox();
  check('chips stay inside the arena after resize', chip.x >= cv.x && chip.x + chip.width <= cv.x + cv.width + 1, JSON.stringify({ chip, cv }));
}

// The corrupt-save step intentionally triggers one "[Popward] Could not read save" warning.
const unexpected = errors.filter((e) => !e.includes('[Popward] Could not read save'));
check('no unexpected console errors or warnings', unexpected.length === 0, unexpected.slice(0, 5).join(' | '));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
await browser.close();
process.exit(failed.length ? 1 : 0);
