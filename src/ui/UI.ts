import { FX, UPGRADES, type UpgradeId } from '../balance';
import { stageForLevel } from '../config/stages';
import type { Sfx } from '../audio/Audio';
import type { Game } from '../game/Game';
import type { MotionPref, Settings } from '../game/GameState';
import { renderStagePreview, type Renderer } from '../render/Renderer';
import { formatMoney, formatNumber } from './format';
import { ICONS } from './icons';

type ChipId = 'pipe' | 'lowerPusher' | 'upperPusher';
const CHIP_IDS: ChipId[] = ['pipe', 'lowerPusher', 'upperPusher'];
const TRAY_IDS: UpgradeId[] = ['value', 'evolution'];

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing`);
  return el as T;
};

/**
 * DOM layer: HUD, upgrade chips pinned to machines, tray, overlays and toasts.
 * Everything is rendered from game.state each frame; DOM writes only happen when a value changes.
 */
export class UI {
  private readonly arena = $('arena');
  private readonly levelEl = $('hud-level');
  private readonly stageEl = $('hud-stage');
  private readonly progText = $('hud-progress-text');
  private readonly progFill = $('hud-progress-fill');
  private readonly moneyEl = $('hud-money');
  private readonly moneyText = $('hud-money-text');
  private readonly muteBtn = $<HTMLButtonElement>('btn-mute');
  private readonly settingsBtn = $<HTMLButtonElement>('btn-settings');
  private readonly chipsEl = $('chips');
  private readonly trayEl = $('tray');
  private readonly toastsEl = $('toasts');
  private readonly hintEl = $('hint');
  private readonly chainEl = $('chain');
  private readonly stageCard = $('stage-card');
  private readonly settingsEl = $('settings');
  private readonly coinLayer = $('coin-layer');

  private chips = new Map<UpgradeId, HTMLButtonElement>();
  private trayBtns = new Map<UpgradeId, HTMLButtonElement>();
  private cache = new Map<string, string>();
  private shownMoney: number;
  private coinsInFlight = 0;
  private chainTimer = 0;
  private stageCardShownFor = -1;

  constructor(
    private readonly game: Game,
    private readonly sfx: Sfx,
    private readonly renderer: Renderer,
    private readonly settings: Settings,
    private readonly onSettings: (s: Settings) => void,
  ) {
    this.shownMoney = game.state.money;
    this.settingsBtn.innerHTML = ICONS.gear;
    this.buildChips();
    this.buildTray();
    this.bindHud();
    this.bindSettings();
    this.bindStageCard();
    $('hint-icon').innerHTML = ICONS.tap;
    this.renderMute();
    if (game.state.hintDone) this.hintEl.hidden = true;
  }

  // ------------------------------------------------------------------ build

  private buildChips(): void {
    for (const id of CHIP_IDS) {
      const btn = document.createElement('button');
      btn.className = 'chip';
      btn.type = 'button';
      btn.dataset.up = id;
      btn.setAttribute('aria-label', `Upgrade ${UPGRADES[id].name}`);
      btn.innerHTML = `<span class="chip-ico"></span><span class="chip-lv"></span><span class="chip-price"></span>`;
      btn.addEventListener('click', () => this.tryBuy(id, btn));
      this.chipsEl.appendChild(btn);
      this.chips.set(id, btn);
    }
  }

  private buildTray(): void {
    const icons: Record<string, string> = { value: ICONS.value, evolution: ICONS.evolve };
    const labels: Record<string, string> = { value: 'Value', evolution: 'Evolve' };
    for (const id of TRAY_IDS) {
      const btn = document.createElement('button');
      btn.className = `tray-btn tray-${id}`;
      btn.type = 'button';
      btn.dataset.up = id;
      btn.innerHTML = `
        <span class="tb-ico">${icons[id]}<em class="tb-lv"></em></span>
        <span class="tb-main">
          <span class="tb-top">
            <span class="tb-title">${labels[id]}</span>
            <span class="tb-price"></span>
          </span>
          <span class="tb-desc"></span>
        </span>`;
      btn.addEventListener('click', () => this.tryBuy(id, btn));
      this.trayEl.appendChild(btn);
      this.trayBtns.set(id, btn);
    }
  }

  private bindHud(): void {
    this.muteBtn.addEventListener('click', () => {
      this.sfx.unlock();
      this.settings.muted = !this.settings.muted;
      this.sfx.setMuted(this.settings.muted);
      this.onSettings(this.settings);
      this.renderMute();
      this.sfx.click();
    });
    this.settingsBtn.addEventListener('click', () => this.openSettings(true));
  }

  private tryBuy(id: UpgradeId, btn: HTMLElement): void {
    if (this.game.upgrades.isMax(id)) return;
    const ok = this.game.buy(id);
    btn.classList.remove('bought', 'denied');
    void btn.offsetWidth; // restart CSS animation
    btn.classList.add(ok ? 'bought' : 'denied');
    if (!ok) {
      const missing = this.game.upgrades.cost(id) - this.game.state.money;
      this.toastAt(btn, `Need ${formatMoney(Math.ceil(missing))} more`);
    }
  }

  // ------------------------------------------------------------------ settings

  private bindSettings(): void {
    const soundBtn = $<HTMLButtonElement>('set-sound');
    const vol = $<HTMLInputElement>('set-volume');
    const resetBtn = $<HTMLButtonElement>('btn-reset');
    const confirmBox = $('reset-confirm');
    soundBtn.addEventListener('click', () => {
      this.settings.muted = !this.settings.muted;
      this.sfx.setMuted(this.settings.muted);
      this.onSettings(this.settings);
      this.renderMute();
      this.sfx.click();
    });
    vol.value = String(Math.round(this.settings.volume * 100));
    vol.addEventListener('input', () => {
      this.settings.volume = Number(vol.value) / 100;
      this.sfx.setVolume(this.settings.volume);
      if (this.settings.muted && this.settings.volume > 0) {
        this.settings.muted = false;
        this.sfx.setMuted(false);
        this.renderMute();
      }
      this.onSettings(this.settings);
    });
    vol.addEventListener('change', () => this.sfx.click());
    for (const b of this.settingsEl.querySelectorAll<HTMLButtonElement>('[data-motion]')) {
      b.addEventListener('click', () => {
        this.settings.motion = b.dataset.motion as MotionPref;
        this.onSettings(this.settings);
        this.renderMotion();
        this.sfx.click();
      });
    }
    resetBtn.addEventListener('click', () => {
      confirmBox.hidden = false;
      resetBtn.hidden = true;
    });
    $('reset-no').addEventListener('click', () => {
      confirmBox.hidden = true;
      resetBtn.hidden = false;
    });
    $('reset-yes').addEventListener('click', () => {
      confirmBox.hidden = true;
      resetBtn.hidden = false;
      this.game.resetProgress();
      this.shownMoney = this.game.state.money;
      this.stageCardShownFor = -1;
      this.stageCard.hidden = true;
      this.openSettings(false);
      this.toastCenter('Progress reset');
    });
    $('btn-close-settings').addEventListener('click', () => this.openSettings(false));
    this.settingsEl.addEventListener('pointerdown', (e) => {
      if (e.target === this.settingsEl) this.openSettings(false);
    });
    this.renderMotion();
  }

  openSettings(open: boolean): void {
    this.settingsEl.hidden = !open;
    this.game.menuOpen = open;
    this.game.release();
    if (open) {
      $('reset-confirm').hidden = true;
      $('btn-reset').hidden = false;
      this.renderMute();
    }
    this.sfx.click();
  }

  private renderMute(): void {
    const muted = this.settings.muted;
    this.muteBtn.innerHTML = muted ? ICONS.soundOff : ICONS.soundOn;
    this.muteBtn.setAttribute('aria-label', muted ? 'Unmute sound' : 'Mute sound');
    this.muteBtn.classList.toggle('is-off', muted);
    const soundBtn = document.getElementById('set-sound');
    if (soundBtn) {
      soundBtn.setAttribute('aria-pressed', String(!muted));
      soundBtn.textContent = muted ? 'Off' : 'On';
    }
  }

  private renderMotion(): void {
    for (const b of this.settingsEl.querySelectorAll<HTMLButtonElement>('[data-motion]')) {
      b.classList.toggle('active', b.dataset.motion === this.settings.motion);
    }
  }

  // ------------------------------------------------------------------ stage card

  private bindStageCard(): void {
    $('btn-continue').addEventListener('click', () => {
      this.sfx.unlock();
      this.sfx.click();
      this.stageCard.classList.add('leaving');
      window.setTimeout(() => {
        this.stageCard.hidden = true;
        this.stageCard.classList.remove('leaving');
        this.game.continueToNextStage();
        this.stageCardShownFor = -1;
      }, 180);
    });
  }

  private showStageCard(): void {
    const s = this.game.state;
    const next = stageForLevel(s.level + 1);
    $('sc-title').textContent = `Level ${s.level} clear!`;
    $('sc-earned').textContent = formatMoney(s.stageEarned);
    $('sc-bonus').textContent = `+${formatMoney(s.stageBonus)}`;
    $('sc-next-name').textContent = `Level ${s.level + 1} · ${next.name}`;
    $('sc-next-blurb').textContent = next.blurb;
    $('sc-next-target').textContent = `Goal ${formatMoney(this.game.economy.target(s.level + 1))}`;
    const preview = $<HTMLCanvasElement>('sc-preview');
    renderStagePreview(preview, next, 104, 179);
    this.stageCard.hidden = false;
    this.stageCardShownFor = s.level;
  }

  // ------------------------------------------------------------------ per-frame

  update(dt: number): void {
    const g = this.game;
    const s = g.state;

    // money counts toward the true value quickly (up on pops, down on purchases)
    const diff = s.money - this.shownMoney;
    if (Math.abs(diff) < 0.5) this.shownMoney = s.money;
    else this.shownMoney += diff * Math.min(1, dt * 12);
    this.set('money', this.moneyText, formatMoney(this.shownMoney));

    this.set('level', this.levelEl, String(s.level));
    this.set('stage', this.stageEl, g.stage.name);
    const target = g.target;
    this.set('prog', this.progText, `${formatNumber(s.progress)} / ${formatNumber(target)}`);
    const pct = Math.min(100, (s.progress / target) * 100);
    this.setStyle('progW', this.progFill, 'width', `${pct.toFixed(1)}%`);

    for (const [id, btn] of this.chips) this.renderUpgrade(id, btn, true);
    for (const [id, btn] of this.trayBtns) this.renderUpgrade(id, btn, false);

    if (g.mode === 'cleared' && this.stageCardShownFor !== s.level) this.showStageCard();

    if (this.chainTimer > 0) {
      this.chainTimer -= dt;
      if (this.chainTimer <= 0) this.chainEl.classList.remove('show');
    }
  }

  private renderUpgrade(id: UpgradeId, btn: HTMLButtonElement, chip: boolean): void {
    const up = this.game.upgrades;
    const max = up.isMax(id);
    const cost = up.cost(id);
    const level = up.level(id);
    const afford = !max && this.game.state.money >= cost;
    const key = `${id}|${level}|${max}|${afford}|${cost}`;
    if (this.cache.get(`up:${id}`) === key) return;
    this.cache.set(`up:${id}`, key);
    btn.classList.toggle('affordable', afford);
    btn.classList.toggle('maxed', max);
    if (chip) {
      const ico = btn.querySelector('.chip-ico')!;
      const icon = id === 'pipe' ? ICONS.pipe : this.pusherIcon(id);
      if (ico.innerHTML !== icon) ico.innerHTML = icon;
      btn.querySelector('.chip-lv')!.textContent = `Lv${level}`;
      btn.querySelector('.chip-price')!.textContent = max ? 'MAX' : formatMoney(cost);
    } else {
      const d = up.describe(id);
      btn.querySelector('.tb-lv')!.textContent = max ? 'MAX' : `Lv${level}`;
      btn.querySelector('.tb-desc')!.textContent = d.next ? `${d.now} → ${d.next}` : `${d.now} · max`;
      btn.querySelector('.tb-price')!.textContent = max ? 'MAX' : formatMoney(cost);
    }
  }

  private pusherIcon(id: UpgradeId): string {
    const cfg = this.game.stage.pushers.find((p) => (p.id === 'lower' ? 'lowerPusher' : 'upperPusher') === id);
    return cfg?.side === 'right' ? ICONS.pusherLeft : ICONS.pusher;
  }

  private set(key: string, el: HTMLElement, text: string): void {
    if (this.cache.get(key) === text) return;
    this.cache.set(key, text);
    el.textContent = text;
  }

  private setStyle(key: string, el: HTMLElement, prop: 'width', value: string): void {
    if (this.cache.get(key) === value) return;
    this.cache.set(key, value);
    el.style[prop] = value;
  }

  /** Pins the machine chips to their world anchors (call after resize or stage change). */
  layoutChips(): void {
    const cam = this.renderer.cam;
    const stage = this.game.stage;
    const anchors: Record<ChipId, { x: number; y: number }> = {
      pipe: stage.pipeChip,
      lowerPusher: stage.pushers[0].chip,
      upperPusher: stage.pushers[1].chip,
    };
    for (const id of CHIP_IDS) {
      const p = cam.toScreen(anchors[id].x, anchors[id].y);
      const btn = this.chips.get(id)!;
      btn.style.left = `${p.x}px`;
      btn.style.top = `${p.y}px`;
    }
    this.chipsEl.style.setProperty('--chip-scale', String(Math.min(1.1, Math.max(0.82, cam.scale))));
    const hint = cam.toScreen(200, stage.pipe.mouthY - 64);
    this.hintEl.style.left = `${hint.x}px`;
    this.hintEl.style.top = `${hint.y}px`;
    this.cache.delete('up:lowerPusher');
    this.cache.delete('up:upperPusher');
  }

  // ------------------------------------------------------------------ feedback helpers

  pulseChip(id: UpgradeId): void {
    const el = this.chips.get(id) ?? this.trayBtns.get(id);
    if (!el) return;
    el.classList.remove('bought');
    void el.offsetWidth;
    el.classList.add('bought');
  }

  hideHint(): void {
    if (!this.hintEl.hidden) {
      this.hintEl.classList.add('gone');
      window.setTimeout(() => (this.hintEl.hidden = true), 400);
    }
  }

  showChain(chain: number): void {
    if (chain < 3) return;
    this.chainEl.textContent = `Chain ×${chain}`;
    this.chainEl.classList.remove('show', 'bump');
    void this.chainEl.offsetWidth;
    this.chainEl.classList.add('show', 'bump');
    this.chainTimer = FX.chainWindowSec + 0.5;
  }

  bumpMoney(): void {
    this.moneyEl.classList.remove('bump');
    void this.moneyEl.offsetWidth;
    this.moneyEl.classList.add('bump');
  }

  /** A coin flies from a pop to the money counter; the counter bumps when it lands. */
  flyCoin(worldX: number, worldY: number, teal: boolean, reduced: boolean): void {
    if (this.coinsInFlight >= FX.maxCoinsInFlight) {
      this.bumpMoney();
      return;
    }
    const appRect = this.coinLayer.getBoundingClientRect();
    const arenaRect = this.arena.getBoundingClientRect();
    const start = this.renderer.cam.toScreen(worldX, worldY);
    const sx = arenaRect.left - appRect.left + start.x;
    const sy = arenaRect.top - appRect.top + start.y;
    const m = this.moneyEl.getBoundingClientRect();
    const ex = m.left - appRect.left + 14;
    const ey = m.top - appRect.top + m.height / 2;
    const coin = document.createElement('div');
    coin.className = teal ? 'fly-coin teal' : 'fly-coin';
    this.coinLayer.appendChild(coin);
    this.coinsInFlight++;
    const dur = reduced ? 380 : 560;
    const midX = sx + (ex - sx) * 0.35 + (sx < ex ? -30 : 30);
    const midY = sy + (ey - sy) * 0.55;
    const anim = coin.animate(
      [
        { transform: `translate(${sx}px, ${sy}px) scale(0.6)`, opacity: 0.9 },
        { transform: `translate(${midX}px, ${midY}px) scale(1)`, opacity: 1, offset: 0.45 },
        { transform: `translate(${ex}px, ${ey}px) scale(0.7)`, opacity: 0.95 },
      ],
      { duration: dur, easing: 'cubic-bezier(.5,0,.75,1)' },
    );
    anim.onfinish = () => {
      coin.remove();
      this.coinsInFlight--;
      this.bumpMoney();
    };
  }

  toastAt(anchor: HTMLElement, text: string): void {
    const a = anchor.getBoundingClientRect();
    const r = this.toastsEl.getBoundingClientRect();
    this.spawnToast(text, a.left - r.left + a.width / 2, a.top - r.top - 6);
  }

  toastWorld(x: number, y: number, text: string): void {
    const p = this.renderer.cam.toScreen(x, y);
    this.spawnToast(text, p.x, p.y);
  }

  toastCenter(text: string): void {
    const r = this.toastsEl.getBoundingClientRect();
    this.spawnToast(text, r.width / 2, r.height * 0.4);
  }

  private spawnToast(text: string, x: number, y: number): void {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = text;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    this.toastsEl.appendChild(el);
    while (this.toastsEl.childElementCount > 4) this.toastsEl.firstElementChild?.remove();
    window.setTimeout(() => el.remove(), 1300);
  }
}
