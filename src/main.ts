import '@fontsource/nunito/700.css';
import '@fontsource/nunito/800.css';
import '@fontsource/nunito/900.css';
import './style.css';

import * as balance from './balance';
import { Sfx } from './audio/Audio';
import { DebugOverlay } from './debug/DebugOverlay';
import { wireFeedback } from './game/Feedback';
import { Game } from './game/Game';
import { clearSave, loadSettings, loadState, saveSettings, type Settings } from './game/GameState';
import { Renderer } from './render/Renderer';
import { UI } from './ui/UI';

const params = new URLSearchParams(location.search);
const debugMode = params.has('debug');
if (params.has('reset')) clearSave();

const { state } = loadState();
const settings = loadSettings();
const game = new Game(state);
if (debugMode || params.has('test')) {
  const speed = Number(params.get('speed'));
  if (Number.isFinite(speed) && speed > 0) game.speed = Math.min(16, speed);
}

const sfx = new Sfx(settings.muted, settings.volume);
const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const arena = document.getElementById('arena') as HTMLElement;
const app = document.getElementById('app') as HTMLElement;
const renderer = new Renderer(canvas);

const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
const isReduced = () => (settings.motion === 'auto' ? motionQuery.matches : settings.motion === 'on');

function applySettings(s: Settings): void {
  saveSettings(s);
  const reduced = isReduced();
  renderer.reducedMotion = reduced;
  game.particles.reduced = reduced;
  document.documentElement.classList.toggle('reduce-motion', reduced);
}

const ui = new UI(game, sfx, renderer, settings, applySettings);
applySettings(settings);
motionQuery.addEventListener('change', () => applySettings(settings));
wireFeedback(game, sfx, ui, isReduced);

const debug = debugMode ? new DebugOverlay(game, document.getElementById('debug-panel')!) : null;
renderer.debug = debug;

// Stage palette tints the HUD/tray chrome so the whole screen reads as one machine.
function applyStageChrome(): void {
  app.style.setProperty('--wall', game.stage.palette.wall);
  app.style.backgroundColor = game.stage.palette.wall;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', game.stage.palette.wall);
  renderer.invalidate();
  ui.layoutChips();
}
game.bus.on('stageStart', applyStageChrome);

// ------------------------------------------------------------------ sizing

function resize(): void {
  const rect = arena.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  renderer.resize(Math.round(rect.width), Math.round(rect.height), dpr);
  ui.layoutChips();
}
new ResizeObserver(resize).observe(arena);
window.addEventListener('orientationchange', resize);

// ------------------------------------------------------------------ input

const pointers = new Set<number>();
canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 && e.pointerType === 'mouse') return;
  e.preventDefault();
  sfx.unlock();
  try {
    canvas.setPointerCapture(e.pointerId);
  } catch {
    /* synthetic events can't be captured */
  }
  pointers.add(e.pointerId);
  game.press();
});
const endPointer = (e: PointerEvent) => {
  pointers.delete(e.pointerId);
  if (pointers.size === 0) game.release();
};
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('lostpointercapture', endPointer);
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

let spaceDown = false;
window.addEventListener('keydown', (e) => {
  if (e.code !== 'Space' || e.repeat) return;
  if (document.activeElement instanceof HTMLButtonElement) return;
  e.preventDefault();
  sfx.unlock();
  spaceDown = true;
  if (!game.menuOpen) game.press();
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'Space' && spaceDown) {
    spaceDown = false;
    if (pointers.size === 0) game.release();
  }
});

// Any first interaction (including UI buttons) unlocks audio.
window.addEventListener('pointerdown', () => sfx.unlock(), { capture: true });
// Block pinch-zoom and double-tap zoom gestures that slip past touch-action on iOS.
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault());

// ------------------------------------------------------------------ lifecycle

let last = performance.now();
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    game.hidden = true;
    game.release();
    pointers.clear();
    sfx.suspend();
    game.save();
  } else {
    game.hidden = false;
    game.resetClock();
    last = performance.now();
    sfx.resume();
  }
});
window.addEventListener('pagehide', () => game.save());
window.addEventListener('blur', () => {
  pointers.clear();
  game.release();
});

function loop(now: number): void {
  const dt = (now - last) / 1000;
  last = now;
  game.frame(dt);
  renderer.render(game, now / 1000);
  ui.update(Math.min(dt, 0.1));
  debug?.update(dt);
  requestAnimationFrame(loop);
}

applyStageChrome();
resize();
void document.fonts?.ready.then(() => renderer.invalidate());
requestAnimationFrame((t) => {
  last = t;
  requestAnimationFrame(loop);
});

if (debugMode || params.has('test')) {
  (window as unknown as { popward: unknown }).popward = { game, ui, sfx, renderer, balance };
}
