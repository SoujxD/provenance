// Number and date formatting used everywhere. Whole dollars by default; cents where the packet keeps cents.

export function money(v: unknown, opts: { cents?: boolean; sign?: boolean } = {}): string {
  if (typeof v !== 'number' || !Number.isFinite(v)) return v == null ? '—' : String(v);
  const abs = Math.abs(v);
  const s = abs.toLocaleString('en-US', {
    minimumFractionDigits: opts.cents ? 2 : 0,
    maximumFractionDigits: opts.cents ? 2 : 0,
  });
  if (v < 0) return `(${s})`;
  return opts.sign && v > 0 ? `+${s}` : s;
}

export function signed(v: number | null | undefined, cents = false): string {
  if (v == null || !Number.isFinite(v)) return '—';
  const r = cents ? Math.round(v * 100) / 100 : Math.round(v);
  if (r === 0) return '0';
  const s = Math.abs(r).toLocaleString('en-US', { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });
  return r > 0 ? `+${s}` : `−${s}`;
}

export function lineValue(v: unknown, key?: string): string {
  if (typeof v === 'number') {
    if (key && /^F8949\.[A-Z]\.(?!total)/.test(key)) return money(v, { cents: true });
    if (Math.abs(v) < 1 && v !== 0) return v.toFixed(4);
    return money(v);
  }
  return v == null ? '—' : String(v);
}

export function date(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export function dateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }) + ' UTC';
}

export function pct(v: number, digits = 0): string {
  return `${(v * 100).toFixed(digits)}%`;
}
