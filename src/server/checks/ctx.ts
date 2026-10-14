// Shared context and helpers for the independent checks. Checks never trust the engine: they read
// documents (printed content), extracted values, client answers and agency records and compare.
import type { PacketIndex } from '../packet.ts';
import type { ExtractedValue, Finding, ReturnLine, ReturnVersion } from '../../shared/types.ts';

export type CheckCtx = {
  P: PacketIndex;
  asOf: string;
  base: ReturnVersion; // latest engine version available at asOf
  lines: Map<string, ReturnLine>;
  params: any;
  ours?: Map<string, number | string>; // our current values, for dependent checks
};

export type Check = {
  id: string;
  title: string;
  description: string; // the generic rule in plain language
  run: (ctx: CheckCtx) => Finding[];
};

export function available(ctx: CheckCtx, ref: string): boolean {
  const at = ctx.P.availableAt(ref);
  return !at || at <= ctx.asOf;
}

export function docAvailable(ctx: CheckCtx, docId: string): boolean {
  const d = ctx.P.docs.get(docId);
  return !!d && d.received_at <= ctx.asOf;
}

export function docText(ctx: CheckCtx, docId: string): string {
  return ctx.P.docs.get(docId)?.pages.map((p) => p.printed_content).join('\n') ?? '';
}

export function pageText(ctx: CheckCtx, docId: string, page: number): string {
  return ctx.P.docs.get(docId)?.pages.find((p) => p.page === page)?.printed_content ?? '';
}

export function evOf(ctx: CheckCtx, docId: string, field: string): ExtractedValue | undefined {
  return ctx.P.evByDoc.get(docId)?.find((e) => e.field === field);
}

export function num(v: unknown): number {
  return typeof v === 'number' ? v : Number(String(v ?? '').replace(/[,$]/g, '')) || 0;
}

export function parseMoney(s: string): number {
  return Number(s.replace(/[,$]/g, ''));
}

export function linesWhere(ctx: CheckCtx, pred: (l: ReturnLine) => boolean): ReturnLine[] {
  return ctx.base.lines.filter(pred);
}

export function lineNum(ctx: CheckCtx, key: string): number | undefined {
  const v = ctx.lines.get(key)?.value;
  return typeof v === 'number' ? v : undefined;
}

export function oursNum(ctx: CheckCtx, key: string): number | undefined {
  const v = ctx.ours?.get(key) ?? ctx.lines.get(key)?.value;
  return typeof v === 'number' ? v : undefined;
}

export type LotInfo = { key: string; box: string; id: string; desc: string; acquired: string; sold: string; proceeds: number; basis: number; adjCode?: string; adj?: number; value: number; sources: string[] };

const LOT_RE = /^(.*) \(acquired ([^,]+), sold ([\d-]+); proceeds ([\d,.]+), basis ([\d,.]+)(?:, adjustment ([A-Z]) (-?[\d,.]+))?\)$/;

export function lots(ctx: CheckCtx): LotInfo[] {
  const out: LotInfo[] = [];
  for (const l of ctx.base.lines) {
    if (l.rule !== 'R-8949-LOT') continue;
    const m = l.label.match(LOT_RE);
    const [, box, id] = l.key.split('.');
    if (!m) continue;
    out.push({ key: l.key, box, id, desc: m[1], acquired: m[2], sold: m[3], proceeds: parseMoney(m[4]), basis: parseMoney(m[5]), adjCode: m[6], adj: m[7] ? parseMoney(m[7]) : undefined, value: Number(l.value), sources: l.sources });
  }
  return out;
}

export function inCaResidency(ctx: CheckCtx, isoDate: string): boolean {
  const r = ctx.P.household.residency.find((x: any) => x.state === 'CA');
  return !!r && isoDate >= r.from && isoDate <= (r.to ?? '9999');
}

export function longTerm(acquired: string, sold: string): boolean {
  const a = new Date(acquired);
  const s = new Date(sold);
  const oneYear = new Date(a);
  oneYear.setUTCFullYear(a.getUTCFullYear() + 1);
  return s > oneYear;
}

/** Severity from the size of the estimated effect, using the firm's partner threshold. */
export function severityFor(fed: number, ca: number, threshold = 1000): 'high' | 'medium' | 'low' {
  const m = Math.max(Math.abs(fed), Math.abs(ca));
  return m > threshold ? 'high' : m > 0 ? 'medium' : 'low';
}

export function maxIso(...xs: (string | undefined)[]): string {
  return xs.filter(Boolean).sort().at(-1) ?? '2026-01-01T00:00:00Z';
}

/** The latest moment any of the refs became available: when a check could first have fired. */
export function detectedAt(ctx: CheckCtx, refs: string[]): string {
  const ats = refs.map((r) => ctx.P.availableAt(r)).filter(Boolean) as string[];
  return maxIso(...ats, ctx.base.computed_at);
}

export function tokens(s: string): Set<string> {
  return new Set(s.toLowerCase().replace(/[^a-z0-9.\- ]/g, ' ').split(/\s+/).filter((t) => t.length > 1));
}

export function similarity(a: string, b: string): number {
  const A = tokens(a);
  const B = tokens(b);
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / Math.max(1, A.size + B.size - inter);
}

/** Share of the smaller page's tokens found in the other page: 1.0 when one page is a re-scan of the other plus an annotation. */
export function containment(a: string, b: string): number {
  const A = tokens(a);
  const B = tokens(b);
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / Math.max(1, Math.min(A.size, B.size));
}
