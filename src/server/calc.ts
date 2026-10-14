// "Our" version of the return = an engine version + workpaper overrides.
//
// We cannot rerun the engine, so we do the next most honest thing:
//  1. Re-evaluate every rule that is pure arithmetic or a published formula (R-SUM with signs inferred
//     from the engine's own numbers, R-CARRY, the SALT cap, the deduction choice, California itemized,
//     standard mileage). Those lines are "recomputed" exactly.
//  2. Lines below a rule we cannot evaluate (tax tables, QBI, AMT...) keep the engine value and are
//     marked "stale" so nobody mistakes them for recomputed numbers.
//  3. The tax effect of a change is measured where it enters a tax-effect category ("anchors"),
//     multiplied by the version's published per-dollar rates. Payments and credits are 1:1.
//     Results are labelled as estimates; engine what-if results are used verbatim where they exist.
import type { ReturnLine, ReturnVersion, TaxEffect, ProposedChange } from '../shared/types.ts';

export type LineStatus = 'engine' | 'override' | 'added' | 'recomputed' | 'approx' | 'stale';

type Anchor = { key: string; cat?: string; kind: 'income' | 'deduction' | 'credit' | 'payment'; fed: boolean; ca: boolean };

export const ANCHORS: Anchor[] = [
  { key: 'F1040.1z', cat: 'wages', kind: 'income', fed: true, ca: true },
  { key: 'SchB.4', cat: 'interest', kind: 'income', fed: true, ca: true },
  { key: 'SchB.6', cat: 'interest', kind: 'income', fed: true, ca: true },
  { key: 'F1040.4b', cat: 'ordinary_income', kind: 'income', fed: true, ca: true },
  { key: 'SchC.31', cat: 'schc_profit', kind: 'income', fed: true, ca: true },
  { key: 'SchD.7', cat: 'stcg', kind: 'income', fed: true, ca: true },
  { key: 'SchD.15', cat: 'ltcg', kind: 'income', fed: true, ca: true },
  { key: 'Sch1.5', cat: 'ordinary_income', kind: 'income', fed: true, ca: true },
  { key: 'Sch1.26', cat: 'adjustment', kind: 'deduction', fed: true, ca: true },
  { key: 'SchA.17', cat: 'itemized', kind: 'deduction', fed: true, ca: false },
  { key: 'SchCA540NR.A.itemized', cat: 'itemized', kind: 'deduction', fed: false, ca: true },
  { key: 'F1040.19', kind: 'credit', fed: true, ca: false },
  { key: 'F1040.20', kind: 'credit', fed: true, ca: false },
  { key: 'ScheduleS.credit', kind: 'credit', fed: false, ca: true },
  { key: 'F1040.33', kind: 'payment', fed: true, ca: false },
  { key: 'F540NR.78', kind: 'payment', fed: false, ca: true },
];
const ANCHOR_KEYS = new Set(ANCHORS.map((a) => a.key));

export class LineModel {
  base: ReturnVersion;
  lines = new Map<string, ReturnLine>();
  inputs = new Map<string, { key: string; c: number }[]>(); // effective inputs with coefficients
  children = new Map<string, string[]>();
  params: any;

  constructor(base: ReturnVersion, params: any) {
    this.base = base;
    this.params = params;
    for (const l of base.lines) this.lines.set(l.key, l);
    for (const l of base.lines) this.inputs.set(l.key, this.inferInputs(l));
    for (const [k, ins] of this.inputs) for (const i of ins) {
      if (!this.children.has(i.key)) this.children.set(i.key, []);
      this.children.get(i.key)!.push(k);
    }
    // Dependencies that are real but not "inputs" for arithmetic (rules that read other lines).
    for (const l of base.lines) for (const i of l.inputs) {
      if (!this.children.has(i)) this.children.set(i, []);
      if (!this.children.get(i)!.includes(l.key)) this.children.get(i)!.push(l.key);
    }
  }

  num(key: string): number | undefined {
    const v = this.lines.get(key)?.value;
    return typeof v === 'number' ? v : undefined;
  }

  /** Infer +1/-1 coefficients for R-SUM lines from the engine's own values. */
  private inferInputs(l: ReturnLine): { key: string; c: number }[] {
    const m = l.key.match(/^SchCA540NR\.(\w+)\.D$/);
    if (m && l.rule === 'R-SUM') {
      // Schedule CA column D = A - B + C; the engine lists only A as input.
      const out = [{ key: `SchCA540NR.${m[1]}.A`, c: 1 }];
      if (this.lines.has(`SchCA540NR.${m[1]}.B`)) out.push({ key: `SchCA540NR.${m[1]}.B`, c: -1 });
      if (this.lines.has(`SchCA540NR.${m[1]}.C`)) out.push({ key: `SchCA540NR.${m[1]}.C`, c: 1 });
      return out;
    }
    if (l.rule === 'R-CARRY') {
      if (l.inputs.length <= 1) return l.inputs.map((k) => ({ key: k, c: 1 }));
      const match = l.inputs.find((k) => this.num(k) === l.value);
      if (match) return [{ key: match, c: 1 }];
      // Some "carries" are really sums of their inputs (e.g. Schedule D line 10 = boxes F + K).
      const sum = l.inputs.reduce((s, k) => s + (this.num(k) ?? NaN), 0);
      return Math.abs(sum - Number(l.value)) <= 1.01 ? l.inputs.map((k) => ({ key: k, c: 1 })) : [];
    }
    if (l.rule !== 'R-SUM' && l.rule !== 'R-CA-ITEMIZED') return [];
    const vals = l.inputs.map((k) => this.num(k));
    if (!l.inputs.length || vals.some((v) => v === undefined) || typeof l.value !== 'number') return [];
    if (l.rule === 'R-CA-ITEMIZED') return l.inputs.map((k) => ({ key: k, c: 1 }));
    const n = vals.length;
    const target = l.value;
    if (n > 16) return l.inputs.map((k) => ({ key: k, c: 1 }));
    // Prefer the combination with the fewest minus signs that reproduces the engine value.
    let best: number[] | null = null;
    let bestNeg = Infinity;
    for (let mask = 0; mask < 1 << n; mask++) {
      let s = 0;
      let neg = 0;
      for (let i = 0; i < n; i++) {
        if ((mask >> i) & 1) { s -= vals[i]!; neg++; } else s += vals[i]!;
      }
      if (Math.abs(s - target) <= 1.01 && neg < bestNeg) { best = Array.from({ length: n }, (_, i) => ((mask >> i) & 1 ? -1 : 1)); bestNeg = neg; }
    }
    return best ? l.inputs.map((k, i) => ({ key: k, c: best![i] })) : [];
  }

  isEvaluable(key: string): boolean {
    const l = this.lines.get(key);
    if (!l) return false;
    if (['R-SALT-CAP', 'R-DEDUCTION-CHOICE', 'R-STANDARD-MILEAGE'].includes(l.rule)) return true;
    return (this.inputs.get(key)?.length ?? 0) > 0;
  }

  evaluate(key: string, get: (k: string) => number | undefined): number | undefined {
    const l = this.lines.get(key)!;
    const P = this.params;
    if (l.rule === 'R-SALT-CAP') {
      const total = get('SchA.5d');
      const agi = get('F1040.11');
      if (total === undefined || agi === undefined) return undefined;
      const cap = Math.max(P.salt_cap_floor, P.salt_cap - P.salt_cap_phase_rate * Math.max(0, agi - P.salt_cap_phase_start));
      return Math.round(Math.min(total, cap));
    }
    if (l.rule === 'R-DEDUCTION-CHOICE') {
      const it = get('SchA.17');
      return it === undefined ? undefined : Math.max(it, P.std_deduction_mfj);
    }
    if (l.rule === 'R-STANDARD-MILEAGE') {
      const miles = get('SchC.44a');
      return miles === undefined ? undefined : Math.round(miles * P.mileage_rate);
    }
    const ins = this.inputs.get(key) || [];
    let s = 0;
    for (const i of ins) {
      const v = get(i.key);
      if (v === undefined) return undefined;
      s += i.c * v;
    }
    return Number.isInteger(l.value) ? Math.round(s) : Math.round(s * 100) / 100;
  }
}

export type OursResult = {
  values: Map<string, number | string>;
  status: Map<string, LineStatus>;
  added: ReturnLine[];
  changed: string[];
};

export function computeOurs(model: LineModel, changes: ProposedChange[]): OursResult {
  const values = new Map<string, number | string>();
  for (const [k, l] of model.lines) values.set(k, l.value);
  const status = new Map<string, LineStatus>();
  const added: ReturnLine[] = [];
  const extraInputs = new Map<string, { key: string; c: number }[]>();
  const seeds: string[] = [];

  for (const ch of changes) {
    if (!model.lines.has(ch.target)) {
      if (!ch.target.includes('.') || ch.target.includes(':')) continue; // facts (household:...) are not lines
      if (!ch.addTo) continue;
      added.push({ key: ch.target, jurisdiction: 'federal', form: ch.target.split('.')[0], line: ch.target.split('.').slice(1).join('.'), label: ch.label || ch.target, value: ch.value, rule: 'R-WORKPAPER-ADDED', inputs: [], sources: [] });
      values.set(ch.target, ch.value);
      status.set(ch.target, 'added');
      if (!extraInputs.has(ch.addTo)) extraInputs.set(ch.addTo, []);
      extraInputs.get(ch.addTo)!.push({ key: ch.target, c: 1 });
      seeds.push(ch.addTo);
      continue;
    }
    values.set(ch.target, ch.value);
    status.set(ch.target, 'override');
    seeds.push(ch.target);
  }

  const get = (k: string) => {
    const v = values.get(k);
    return typeof v === 'number' ? v : undefined;
  };
  // Process in base-line order (the engine lists lines in dependency order), repeating until stable.
  const order = model.base.lines.map((l) => l.key);
  const dirty = new Set<string>();
  const markDescendants = (k: string) => {
    for (const c of model.children.get(k) || []) dirty.add(c);
  };
  for (const s of seeds) {
    if (status.get(s) !== 'override') dirty.add(s);
    markDescendants(s);
  }
  for (let pass = 0; pass < 6 && dirty.size; pass++) {
    for (const k of order) {
      if (!dirty.has(k)) continue;
      dirty.delete(k);
      if (status.get(k) === 'override') continue;
      const evaluable = model.isEvaluable(k) || extraInputs.has(k);
      if (!evaluable) {
        status.set(k, 'stale');
        markDescendants(k);
        continue;
      }
      let v = model.evaluate(k, get);
      if (extraInputs.has(k) && v !== undefined) for (const e of extraInputs.get(k)!) v += e.c * (get(e.key) ?? 0);
      if (v === undefined) { status.set(k, 'stale'); markDescendants(k); continue; }
      const anyStale = (model.inputs.get(k) || []).some((i) => ['stale', 'approx'].includes(status.get(i.key) || ''))
        || (model.lines.get(k)!.inputs || []).some((i) => status.get(i) === 'stale');
      const prev = values.get(k);
      values.set(k, v);
      status.set(k, anyStale ? 'approx' : 'recomputed');
      if (prev !== v || anyStale) markDescendants(k);
    }
  }
  const changed = [...status.keys()];
  return { values, status, added, changed };
}

export type EffectDetail = TaxEffect & { anchors: { key: string; delta: number; cat?: string; fed: number; ca: number }[] };

/** Estimate the effect on the amount owed (federal, California) of a set of changes vs the base version. */
export function estimateEffect(model: LineModel, changes: ProposedChange[]): EffectDetail {
  const res = computeOurs(model, changes);
  const rates = model.base.tax_effect_rates;
  const caSourceTargets = new Set(changes.filter((c) => c.caSource).map((c) => c.target));
  const caSourceAll = changes.length > 0 && changes.every((c) => c.caSource || !isNumericLine(model, c.target));
  let fed = 0;
  let ca = 0;
  const anchors: EffectDetail['anchors'] = [];
  for (const a of ANCHORS) {
    const before = model.num(a.key);
    const after = res.values.get(a.key);
    if (before === undefined || typeof after !== 'number') continue;
    const d = after - before;
    if (Math.abs(d) < 0.005) continue;
    let f = 0;
    let c = 0;
    if (a.kind === 'payment') { f = a.fed ? -d : 0; c = a.ca ? -d : 0; }
    else if (a.kind === 'credit') { f = a.fed ? -d : 0; c = a.ca ? -d : 0; }
    else {
      const cat = changes.find((x) => x.category && x.target)?.category && changes.length === 1 ? changes[0].category! : a.cat!;
      const r = rates[cat] || rates[a.cat!];
      f = a.fed ? d * r.federal_per_dollar : 0;
      if (a.ca) {
        const useSource = caSourceAll || [...caSourceTargets].some((t) => isUpstream(model, t, a.key));
        c = d * (useSource ? rates.ca_source_income.california_per_dollar : r.california_per_dollar);
      }
    }
    fed += f;
    ca += c;
    anchors.push({ key: a.key, delta: d, cat: a.cat, fed: f, ca: c });
  }
  // California-source column E changed directly (e.g. a wage split): ca_source_income rate.
  for (const ch of changes) {
    if (/^SchCA540NR\.\d+\.E$/.test(ch.target)) {
      const before = model.num(ch.target);
      if (before !== undefined && typeof ch.value === 'number') {
        const d = ch.value - before;
        const c = d * rates.ca_source_income.california_per_dollar;
        ca += c;
        anchors.push({ key: ch.target, delta: d, cat: 'ca_source_income', fed: 0, ca: c });
      }
    }
  }
  const touchesPayments = anchors.some((a) => a.key === 'F1040.33' || a.key === 'F540NR.78');
  const onlyPayments = anchors.length > 0 && anchors.every((a) => a.key === 'F1040.33' || a.key === 'F540NR.78');
  return {
    fed: Math.round(fed),
    ca: Math.round(ca),
    method: anchors.length === 0 ? 'none' : onlyPayments ? 'payment' : touchesPayments ? 'mixed' : 'rate',
    estimate: !onlyPayments && anchors.length > 0,
    anchors,
  };
}

function isNumericLine(model: LineModel, key: string) {
  return typeof model.lines.get(key)?.value === 'number' || !model.lines.has(key);
}

function isUpstream(model: LineModel, from: string, to: string): boolean {
  const seen = new Set<string>();
  const stack = [from];
  while (stack.length) {
    const k = stack.pop()!;
    if (k === to) return true;
    if (seen.has(k)) continue;
    seen.add(k);
    for (const c of model.children.get(k) || []) stack.push(c);
  }
  return false;
}

export { ANCHOR_KEYS };
