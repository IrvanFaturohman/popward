// Quick visual check: node scripts/shot.mjs [url] [out.png] [w] [h] [waitMs]
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://localhost:5173/?reset=1';
const out = process.argv[3] ?? 'screenshots/shot.png';
const w = Number(process.argv[4] ?? 390);
const h = Number(process.argv[5] ?? 844);
const wait = Number(process.argv[6] ?? 1500);

const browser = await chromium.launch(process.env.PW_CHANNEL === 'bundled' ? {} : { channel: process.env.PW_CHANNEL || 'chrome' });
const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: w < 700, hasTouch: w < 700 });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && errors.push(`${m.type()}: ${m.text()}`));
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
await page.goto(url);
await page.waitForTimeout(wait);
await page.screenshot({ path: out });
console.log('saved', out, errors.length ? '\n' + errors.join('\n') : '(no console errors)');
await browser.close();
