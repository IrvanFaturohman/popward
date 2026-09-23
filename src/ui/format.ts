const UNITS = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi'];

/** $12, $999, $1.2K, $12.5K, $125K, $1.2M … */
export function formatMoney(value: number): string {
  return '$' + formatNumber(value);
}

export function formatNumber(value: number): string {
  const v = Math.floor(value + 1e-6);
  if (v < 1000) return String(v);
  let tier = Math.floor(Math.log10(v) / 3);
  tier = Math.min(tier, UNITS.length - 1);
  const scaled = v / Math.pow(1000, tier);
  const digits = scaled < 100 ? 1 : 0;
  // Floor instead of round so a balance of 1,999 never reads as "$2K".
  const factor = digits ? 10 : 1;
  const text = (Math.floor(scaled * factor) / factor).toFixed(digits).replace(/\.0$/, '');
  return text + UNITS[tier];
}

export function formatSeconds(sec: number): string {
  return sec >= 10 ? `${Math.round(sec)}s` : `${sec.toFixed(1).replace(/\.0$/, '')}s`;
}
