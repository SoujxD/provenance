// Derives everything a screen needs from (packet, event-log state, viewer, asOf).
import { packet } from './packet.ts';
import { LineModel, computeOurs, estimateEffect } from './calc.ts';
import { runChecks } from './checks/rules.ts';
import type { State, Signoff } from './state.ts';
import { fold } from './state.ts';
import { loadEvents, canonical, sha256 } from './events.ts';
import { people, person, isActive, type Person } from './access.ts';
import { nextScript, scriptItems, seasonNow, isoSeconds } from './season.ts';
import { AREAS, areaForLine, type Finding, type ProposedChange, type ReturnVersion, type TaxEffect, type Adjustment } from '../shared/types.ts';

const models = new Map<string, LineModel>();
export function modelFor(version: string): LineModel {
  if (!models.has(version)) {
    const P = packet();
    models.set(version, new LineModel(P.versions.get(version)!, P.p.engine_reference.parameters));
  }
  return models.get(version)!;
}

export function baseVersionAt(asOf: string): ReturnVersion {
  const P = packet();
  const vs = P.versionList().filter((v) => v.computed_at <= asOf);
  return vs.at(-1) ?? P.versionList()[0];
}

/** The packet's starter standards plus the structured thresholds the app enforces (editable by the administrator). */
export function firmStandards() {
  const starter = packet().firm.starter_standards;
  return {
    ...starter,
    partner_threshold: 1000,
    low_confidence_threshold: 0.6,
    retention_years: 7,
    block_filing_on: { open_review_notes: true, high_findings: true, pending_adjustments: true, required_questions: true },
  };
}

export function stateFor(ws: string, asOf?: string): State {
  return fold(ws, loadEvents(ws), firmStandards(), asOf);
}

export type Ours = {
  base: ReturnVersion;
  model: LineModel;
  values: Map<string, number | string>;
  status: Map<string, string>;
  added: any[];
  facts: Map<string, string>; // household:theo.ssn, label:F2441.1b ...
  activeAdjustments: Adjustment[];
  summary: any;
  combinedEffect: TaxEffect & { anchors: any[] };
};

export function activeAdjustments(s: State, layer: 'return' | 'all' = 'all'): Adjustment[] {
  return [...s.adjustments.values()].filter((a) => (a.status === 'pending' || a.status === 'approved') && (layer === 'all' || a.layer === layer));
}

export function computeOursFor(s: State, asOf: string, layer: 'return' | 'all' = 'all'): Ours {
  const P = packet();
  const base = baseVersionAt(asOf);
  const model = modelFor(base.version);
  const adjs = activeAdjustments(s, layer).filter((a) => !a.whatIf || P.p.what_if.alternatives.find((w: any) => w.id === a.whatIf)?.base_version === base.version || true);
  const changes: ProposedChange[] = [];
  const facts = new Map<string, string>();
  for (const a of adjs) for (const c of a.changes) {
    if (c.target.includes(':')) facts.set(c.target, String(c.value));
    else changes.push({ target: c.target, value: c.value, addTo: c.addTo, label: c.label, caSource: c.caSource, category: c.category });
  }
  const r = computeOurs(model, changes);
  // Effect: what-if-backed adjustments use the engine's exact results; the rest are estimated together.
  const wiAdjs = adjs.filter((a) => a.whatIf);
  const rateChanges = changes.filter((c) => !wiAdjs.some((a) => a.changes.some((x) => x.target === c.target)));
  const est = estimateEffect(model, rateChanges);
  let fed = est.fed;
  let ca = est.ca;
  for (const a of wiAdjs) {
    const w = P.p.what_if.alternatives.find((x: any) => x.id === a.whatIf);
    if (w) { fed += w.federal.total_tax_change; ca += w.california.total_tax_change; }
  }
  const sum = base.summary;
  const payFed = Number(r.values.get('F1040.33')) - Number(base.lines.find((l) => l.key === 'F1040.33')?.value ?? 0);
  const payCa = Number(r.values.get('F540NR.78')) - Number(base.lines.find((l) => l.key === 'F540NR.78')?.value ?? 0);
  const fedTaxDelta = fed + payFed; // est.fed includes -Δpayments; strip it back out for tax
  const caTaxDelta = ca + payCa;
  const summary = {
    federal: {
      agi: r.values.get('F1040.11'),
      taxable_income: r.values.get('F1040.15'),
      total_tax: sum.federal.total_tax + Math.round(fedTaxDelta),
      payments: sum.federal.payments + payFed,
      balance_due: sum.federal.total_tax + Math.round(fedTaxDelta) - (sum.federal.payments + payFed),
      penalty: sum.federal.penalty,
    },
    california: {
      total_agi: r.values.get('F540NR.17'),
      ca_agi: r.values.get('F540NR.32'),
      total_tax: sum.california.total_tax + Math.round(caTaxDelta),
      payments: sum.california.payments + payCa,
      balance_due: sum.california.total_tax + Math.round(caTaxDelta) - (sum.california.payments + payCa),
      penalty: sum.california.penalty,
    },
    statuses: { agi: r.status.get('F1040.11') ?? 'engine', taxable_income: r.status.get('F1040.15') ?? 'engine', total_agi: r.status.get('F540NR.17') ?? 'engine', ca_agi: r.status.get('F540NR.32') ?? 'engine' },
    estimate: adjs.length > 0,
    effect: { fed: Math.round(fed), ca: Math.round(ca) },
  };
  return { base, model, values: r.values, status: r.status, added: r.added, facts, activeAdjustments: adjs, summary, combinedEffect: { ...est, fed: Math.round(fed), ca: Math.round(ca), method: wiAdjs.length ? 'mixed' : est.method } };
}

// ---------- Findings ----------

const SEV_ORDER: Record<string, number> = { blocking: 0, high: 1, medium: 2, low: 3, info: 4 };

export function effectFor(model: LineModel, f: { proposed?: ProposedChange[]; whatIf?: string }): TaxEffect | undefined {
  const P = packet();
  if (f.whatIf) {
    const w = P.p.what_if.alternatives.find((x: any) => x.id === f.whatIf);
    if (w) return { fed: w.federal.total_tax_change, ca: w.california.total_tax_change, method: 'what_if', estimate: false, note: `Engine what-if "${w.id}" (exact)` };
  }
  const lineChanges = (f.proposed || []).filter((c) => !c.target.includes(':'));
  if (!lineChanges.length) return undefined;
  const e = estimateEffect(model, lineChanges);
  return { fed: e.fed, ca: e.ca, method: e.method, estimate: e.estimate, note: e.anchors.map((a) => `${a.key} ${a.delta > 0 ? '+' : ''}${Math.round(a.delta).toLocaleString('en-US')}${a.cat ? ` × ${a.cat} rate` : ''}`).join('; ') };
}

function engineFindings(asOf: string): Finding[] {
  const P = packet();
  const vs = P.versionList().filter((v) => v.computed_at <= asOf);
  const latest = vs.at(-1);
  const out = new Map<string, Finding>();
  for (const v of vs) for (const d of v.diagnostics) {
    if (!out.has(d.code)) {
      const area = d.refs.map((r) => (P.lines.get(v.version)!.has(r) ? areaForLine(r) : null)).find(Boolean)
        ?? (d.code.includes('K1') || d.code.includes('SCORP') ? 'passthroughs' : d.code.includes('LOW_CONF') ? 'deductions' : d.code.includes('QUESTIONNAIRE') || d.code.includes('BROKER') || d.code.includes('DIGITAL') ? 'investments' : 'intake');
      out.set(d.code, {
        id: `ENGINE:${d.code}`, source: 'engine', rule: d.code, kind: d.severity === 'info' ? 'info' : 'compliance',
        title: (() => { const t = d.message.split(/[:.](s|$)/)[0]; return t.length <= 96 ? t : `${t.slice(0, 94)}…`; })(),
        summary: d.message, area, severity: d.severity === 'warning' ? 'medium' : 'info', blocksFiling: d.severity === 'warning',
        evidence: d.refs.filter((r) => !P.lines.get(v.version)!.has(r)), lines: d.refs.filter((r) => P.lines.get(v.version)!.has(r)),
        detectedAt: v.computed_at, detail: [`First reported by engine ${v.version} (${v.computed_at.slice(0, 10)}).`],
      });
    }
  }
  if (latest) for (const [code, f] of out) {
    if (!latest.diagnostics.some((d) => d.code === code)) {
      const gone = vs.find((v) => v.computed_at > f.detectedAt && !v.diagnostics.some((d) => d.code === code));
      f.resolvedByEngineAt = gone?.computed_at;
      f.blocksFiling = false;
      f.severity = 'info';
      f.detail!.push(`No longer reported from ${gone?.version} (${gone?.trigger}).`);
    }
  }
  return [...out.values()];
}

const VAR_MAP: [string, string][] = [
  ['F1040.1a', 'F1040.1a'], ['F1040.2b', 'F1040.2b'], ['F1040.3a', 'F1040.3a'], ['F1040.3b', 'F1040.3b'], ['F1040.7', 'F1040.7'], ['F1040.8', 'F1040.8'],
  ['F1040.9', 'F1040.9'], ['F1040.10', 'F1040.10'], ['F1040.11', 'F1040.11'], ['F1040.12', 'F1040.12'], ['F1040.13', 'F1040.13'], ['F1040.15', 'F1040.15'],
  ['F1040.16', 'F1040.16'], ['F1040.19', 'F1040.19'], ['F1040.23', 'F1040.23'], ['F1040.24', 'F1040.24'], ['F1040.25a', 'F1040.25a'], ['F1040.26', 'F1040.26'],
  ['F1040.33', 'F1040.33'], ['Sch1.3', 'Sch1.3'], ['Sch1.5', 'Sch1.5'], ['Sch1.15', 'Sch1.15'], ['Sch1.17', 'Sch1.17'], ['SchC.1', 'SchC.1'], ['SchC.9', 'SchC.9'],
  ['SchC.11', 'SchC.11'], ['SchC.28', 'SchC.28'], ['SchC.31', 'SchC.31'], ['SchC.44a', 'SchC.44a'], ['SchE.3A', 'SchE.3A'], ['SchE.14A', 'SchE.14A'],
  ['SchE.21A', 'SchE.21A'], ['SchE.3B', 'SchE.3B'], ['SchE.21B', 'SchE.21B'], ['SchE.28A', 'SchE.28A'], ['SchE.28B', 'SchE.28B'], ['SchSE.12', 'SchSE.12'],
  ['F8995.15', 'F8995.39'], ['F8938', 'F8938.1.max'], ['F2441.2', 'F2441.2'],
  ['CA540.13', 'F540NR.13'], ['CA540.17', 'F540NR.17'], ['CA540.19', 'F540NR.19'], ['CA540.31', 'F540NR.31'], ['CA540.64', 'F540NR.64'], ['CA540.71', 'F540NR.71'], ['CA540.72', 'F540NR.72'],
];

function varianceFindings(ours: Ours, standards: any, asOf: string): Finding[] {
  const P = packet();
  const py = P.p.prior_years.return_2024.lines;
  const vr = standards.variance_review;
  const out: Finding[] = [];
  for (const [pk, k] of VAR_MAP) {
    const prior = py[pk];
    const cur = ours.values.get(k);
    if (typeof prior !== 'number' || typeof cur !== 'number') continue;
    const d = cur - prior;
    const pctChange = prior === 0 ? Infinity : Math.abs(d / prior) * 100;
    if (!(Math.abs(d) > vr.and_over_amount && pctChange > vr.flag_if_change_over_percent)) continue;
    const line = ours.base.lines.find((l) => l.key === k);
    // Drivers: inputs with the largest values (or changes, where the prior year has the same key).
    const drivers = (ours.model.inputs.get(k) || []).map((i) => {
      const v = Number(ours.values.get(i.key) ?? 0);
      const pv = typeof py[i.key] === 'number' ? py[i.key] : 0;
      return { key: i.key, label: ours.model.lines.get(i.key)?.label ?? i.key, change: i.c * (v - pv) };
    }).sort((a, b) => Math.abs(b.change) - Math.abs(a.change)).slice(0, 4).filter((x) => Math.abs(x.change) >= 1);
    out.push({
      id: `VARIANCE:${k}`, source: 'variance', kind: 'variance', rule: 'VARIANCE_REVIEW',
      title: `${line?.label ?? k}: ${prior.toLocaleString('en-US')} → ${cur.toLocaleString('en-US')} (${pctChange === Infinity ? 'new' : `${d > 0 ? '+' : '−'}${pctChange.toFixed(0)}%`})`,
      summary: `Change of ${d.toLocaleString('en-US')} vs the 2024 return exceeds the firm standard (${vr.flag_if_change_over_percent}% and ${vr.and_over_amount.toLocaleString('en-US')}). Explain it.`,
      detail: drivers.length ? ['Largest contributors: ' + drivers.map((x) => `${x.label} ${x.change > 0 ? '+' : ''}${Math.round(x.change).toLocaleString('en-US')}`).join('; ')] : [],
      area: areaForLine(k), severity: 'low', blocksFiling: true,
      evidence: [`py:/return_2024/lines/${pk}`, ...(P.p.prior_years.return_2024.line_sources[pk] ? [P.p.prior_years.return_2024.line_sources[pk]] : [])],
      lines: [k], detectedAt: ours.base.computed_at,
    });
  }
  return out;
}

export function allFindings(s: State, ours: Ours, asOf: string): Finding[] {
  const P = packet();
  const ctx = { P, asOf, base: ours.base, lines: P.lines.get(ours.base.version)!, params: P.p.engine_reference.parameters, ours: ours.values };
  const { findings: checks } = runChecks(ctx);
  const list: Finding[] = [...checks, ...engineFindings(asOf), ...varianceFindings(ours, s.standards, asOf)];
  // Engine diagnostics explained by an independent check (shared evidence) are linked.
  for (const f of list.filter((x) => x.source === 'engine')) {
    const rel = checks.filter((c) => c.evidence.some((e) => f.evidence.includes(e)) || c.lines.some((l) => f.lines.includes(l)));
    if (rel.length) f.dependsOn = rel.map((r) => r.id);
  }
  // Due diligence engine diagnostic is cleared by the recorded checklist.
  for (const rn of s.reviewNotes.values()) {
    list.push({ id: rn.id, source: 'review_note', kind: 'review_note', title: rn.text.length > 90 ? rn.text.slice(0, 88) + '…' : rn.text, summary: rn.text, area: rn.area, severity: rn.blocking ? 'blocking' : 'medium', blocksFiling: rn.blocking || s.standards.rules.some((r: string) => /open review notes block filing/i.test(r)), evidence: rn.target.startsWith('line:') ? [] : [rn.target], lines: rn.target.startsWith('line:') ? [rn.target.slice(5)] : [], detectedAt: rn.at });
  }
  for (const q of s.questions.values()) {
    if (q.status !== 'open' && !q.required) continue;
    list.push({ id: `Q:${q.id}`, source: 'question', kind: 'question', title: `${q.to === 'client' ? 'Client question' : `Question to ${person(q.to)?.name ?? q.to}`}: ${q.text.slice(0, 80)}${q.text.length > 80 ? '…' : ''}`, summary: q.text, area: q.findingIds.length ? (list.find((x) => x.id === q.findingIds[0])?.area ?? 'intake') : 'intake', severity: q.required ? 'high' : 'low', blocksFiling: q.required && q.status === 'open', evidence: q.refs, lines: [], detectedAt: q.at });
  }
  for (const sub of s.filing.submissions.filter((x) => x.status === 'rejected')) {
    list.push({ id: `EFILE:${sub.id}`, source: 'efile', kind: 'efile', title: `E-file rejected (${sub.jurisdiction}): ${sub.errors.map((e: any) => e.code).join(', ')}`, summary: sub.errors.map((e: any) => `${e.code}: ${e.message}`).join(' '), area: 'filing', severity: 'blocking', blocksFiling: !s.filing.submissions.some((x) => x.jurisdiction === sub.jurisdiction && x.status === 'accepted'), evidence: ['agency:/efile'], lines: [], detectedAt: sub.at });
  }
  for (const n of s.notices) {
    const notice = P.p.tax_agency_records.notices.find((x: any) => x.id === n.id);
    list.push({ id: `NOTICE:${n.id}`, source: 'efile', kind: 'compliance', title: `${notice.type} for ${notice.tax_year}: respond by ${notice.response_due}`, summary: notice.items_under_examination.join(' '), area: 'filing', severity: 'high', blocksFiling: false, evidence: [notice.document], lines: [], detectedAt: n.at });
  }

  for (const f of list) {
    const h = s.findings.get(f.id);
    f.status = h?.status ?? (f.resolvedByEngineAt ? 'resolved' : 'open');
    f.owner = h?.owner ?? null;
    f.history = h?.history ?? [];
    f.resolution = h?.resolution ?? (f.resolvedByEngineAt ? { note: 'Resolved by the engine when new documents arrived.', at: f.resolvedByEngineAt, actor: 'engine' } : null);
    if (f.id === 'ENGINE:DUE_DILIGENCE_REQUIRED' && s.dueDiligence.has('ctc_odc') && f.status === 'open') {
      f.status = 'resolved';
      const dd = s.dueDiligence.get('ctc_odc')!;
      f.resolution = { note: 'Form 8867 due diligence recorded.', at: dd.at, actor: dd.actor };
    }
    if (f.source === 'review_note' && !h) f.status = 'open';
    f.effect = f.effect ?? effectFor(ours.model, f);
    // Cleared: our version of the return already reflects every proposed change.
    if (f.proposed?.length) {
      f.cleared = f.proposed.every((c) => {
        if (c.target.includes(':')) return ours.facts.get(c.target) === String(c.value);
        const v = ours.values.get(c.target);
        return typeof v === 'number' && typeof c.value === 'number' ? Math.abs(v - c.value) < 1 : String(v) === String(c.value);
      });
    }
  }
  return list.sort((a, b) => (SEV_ORDER[a.severity] - SEV_ORDER[b.severity]) || Math.max(Math.abs(b.effect?.fed ?? 0), Math.abs(b.effect?.ca ?? 0)) - Math.max(Math.abs(a.effect?.fed ?? 0), Math.abs(a.effect?.ca ?? 0)));
}

// ---------- Sign-offs ----------

export function areaLines(base: ReturnVersion, area: string): string[] {
  return base.lines.filter((l) => areaForLine(l.key) === area && !/^F8949\.[A-Z]\.(X|M|N|C)\d/.test(l.key)).map((l) => l.key);
}

export function scopeContent(s: State, ours: Ours, findings: Finding[], scope: string): any {
  if (scope === 'return') {
    return {
      summary: { federal: ours.summary.federal, california: ours.summary.california },
      adjustments: ours.activeAdjustments.map((a) => ({ id: a.id, changes: a.changes.map((c) => [c.target, c.value]), status: a.status })).sort((a, b) => a.id.localeCompare(b.id)),
      findings: findings.filter((f) => f.blocksFiling).map((f) => [f.id, f.status]).sort(),
      facts: [...ours.facts.entries()].sort(),
    };
  }
  const area = scope.replace(/^area:/, '');
  const keys = areaLines(ours.base, area);
  const lotKeys = area === 'investments' ? ours.base.lines.filter((l) => l.key.startsWith('F8949.')).map((l) => l.key) : [];
  const allKeys = [...keys, ...lotKeys, ...ours.added.filter((l) => areaForLine(l.key) === area).map((l) => l.key)];
  return {
    lines: allKeys.map((k) => [k, ours.values.get(k) ?? null]),
    adjustments: ours.activeAdjustments.filter((a) => a.changes.some((c) => allKeys.includes(c.target) || areaForLine(c.target) === area)).map((a) => ({ id: a.id, changes: a.changes.map((c) => [c.target, c.value]), status: a.status })),
    findings: findings.filter((f) => f.area === area).map((f) => [f.id, f.status]).sort(),
    facts: area === 'intake' ? [...ours.facts.entries()].filter(([k]) => k.startsWith('household:')).sort() : [],
  };
}

export function hashContent(c: any): string {
  return sha256(canonical(c));
}

function diffContent(a: any, b: any): string[] {
  const out: string[] = [];
  const toMap = (arr: any[]) => new Map((arr || []).map((x: any) => (Array.isArray(x) ? [x[0], x[1]] : [x.id, JSON.stringify(x)])));
  for (const key of ['lines', 'findings', 'facts']) {
    const A = toMap(a?.[key]);
    const B = toMap(b?.[key]);
    for (const [k, v] of B) if (A.get(k) !== v) out.push(`${k}: ${A.has(k) ? A.get(k) : '—'} → ${v}`);
    for (const [k] of A) if (!B.has(k)) out.push(`${k}: removed`);
  }
  const aa = toMap(a?.adjustments);
  const bb = toMap(b?.adjustments);
  for (const [k, v] of bb) if (aa.get(k) !== v) out.push(`adjustment ${k} ${aa.has(k) ? 'changed' : 'added'}`);
  for (const [k] of aa) if (!bb.has(k)) out.push(`adjustment ${k} removed`);
  if (a?.summary && b?.summary) {
    for (const j of ['federal', 'california']) for (const k of Object.keys(b.summary[j])) if (a.summary[j][k] !== b.summary[j][k]) out.push(`${j} ${k}: ${a.summary[j][k]} → ${b.summary[j][k]}`);
  }
  return out;
}

export type SignoffView = Signoff & { valid: boolean; changes: string[]; actorName: string };

export function signoffViews(s: State, ours: Ours, findings: Finding[]): SignoffView[] {
  const cache = new Map<string, any>();
  // Only the latest sign-off per scope and level counts; earlier ones are superseded (still in the log).
  const latest = new Map<string, Signoff>();
  for (const so of s.signoffs) if (!so.withdrawn) latest.set(`${so.scope}|${so.level}`, so);
  return [...latest.values()].map((so) => {
    if (!cache.has(so.scope)) cache.set(so.scope, scopeContent(s, ours, findings, so.scope));
    const cur = cache.get(so.scope);
    const valid = hashContent(cur) === so.hash;
    return { ...so, valid, changes: valid ? [] : diffContent(so.snapshot, cur).slice(0, 12), actorName: person(so.actor)?.name ?? so.actor };
  });
}

/** Who prepared work in a scope: they cannot review or sign it off. */
export function preparersOf(s: State, scope: string, base: ReturnVersion): Set<string> {
  const out = new Set<string>();
  const area = scope.replace(/^area:/, '');
  const keys = new Set(scope === 'return' ? base.lines.map((l) => l.key) : areaLines(base, area));
  for (const so of s.signoffs) if (so.scope === scope && so.level === 'preparer' && !so.withdrawn) out.add(so.actor);
  for (const a of s.adjustments.values()) {
    if (a.status === 'rejected' || a.status === 'reverted') continue;
    if (scope === 'return' || a.changes.some((c) => keys.has(c.target) || areaForLine(c.target) === area)) out.add(a.createdBy);
  }
  if (scope !== 'return') for (const v of s.verifications) if (keys.has(v.target)) out.add(v.actor);
  return out;
}

// ---------- Documents ----------

export function documentIndex(s: State, ours: Ours, findings: Finding[], asOf: string) {
  const P = packet();
  const base = ours.base;
  const used = new Set(base.documents_used);
  const superseded = new Set(base.documents_superseded);
  const out: any[] = [];
  for (const d of P.docs.values()) {
    if (d.received_at > asOf) continue;
    const evs = P.evByDoc.get(d.id) || [];
    const landings = new Map<string, { key: string; label: string; ev: string[] }>();
    for (const e of evs) for (const c of P.citedBy.get(e.id) || []) {
      if (c.version !== base.version) continue;
      const l = ours.model.lines.get(c.key)!;
      if (!landings.has(c.key)) landings.set(c.key, { key: c.key, label: l.label, ev: [] });
      landings.get(c.key)!.ev.push(e.id);
    }
    for (const c of P.citedBy.get(d.id) || []) if (c.version === base.version && !landings.has(c.key)) landings.set(c.key, { key: c.key, label: ours.model.lines.get(c.key)!.label, ev: [] });
    const dupOf = [...P.docs.values()].find((o) => o.id !== d.id && o.document_type === d.document_type && o.received_at < d.received_at && evs.length > 3 && evs.every((e) => (P.evByDoc.get(o.id) || []).some((x) => x.field === e.field && JSON.stringify(x.value) === JSON.stringify(e.value))));
    let status = 'used';
    let reason = '';
    if (superseded.has(d.id)) { status = 'superseded'; reason = `Replaced by the corrected document${[...P.docs.values()].filter((x) => x.marked_corrected && x.issuer === d.issuer).map((x) => ` ${x.id}`).join('')}.`; }
    else if (dupOf) { status = 'duplicate'; reason = `Second image of ${dupOf.id}; every value matches, counted once.`; }
    else if (d.extraction.status === 'not_extracted') { status = 'not_extracted'; reason = d.extraction.reason ?? ''; }
    else if (!used.has(d.id)) { status = 'not_used'; reason = d.received_at > base.computed_at ? `Received ${d.received_at.slice(0, 10)}, after engine ${base.version} was computed.` : 'Not used by the engine.'; }
    else if (!landings.size) { status = 'reference'; reason = d.tax_year < P.household.tax_year ? `Prior-year (${d.tax_year}) record used as support.` : 'Supporting evidence: no value flows to a return line.'; }
    if (d.extraction.status === 'partial' && status === 'used') { status = 'partial'; reason = d.extraction.reason ?? ''; }
    const dupPages = findings.filter((f) => f.rule === 'DUPLICATE_PAGE' && f.id.startsWith(`DUPLICATE_PAGE:${d.id}:`)).map((f) => Number(f.id.split(':')[3]));
    out.push({
      id: d.id, title: d.title, type: d.document_type, issuer: d.issuer, belongs_to: d.belongs_to, tax_year: d.tax_year, received_at: d.received_at,
      uploaded_by: d.uploaded_by, pages: d.page_count, extraction: d.extraction, corrected: !!d.marked_corrected, status, reason,
      landings: [...landings.values()], duplicatePages: dupPages, values: evs.length,
      findings: findings.filter((f) => f.evidence.some((e) => e === d.id || e.startsWith(`doc:${d.id}#`) || P.ev.get(e)?.document_id === d.id)).map((f) => f.id),
      lowConfidence: evs.filter((e) => e.confidence < 0.9).length,
    });
  }
  for (const a of s.attachments) out.push({ id: a.id, title: a.name, type: 'workpaper_attachment', issuer: person(a.actor)?.name ?? a.actor, belongs_to: 'joint', tax_year: P.household.tax_year, received_at: a.at, uploaded_by: a.actor, pages: 1, extraction: { status: 'not_extracted', values: 0, reason: 'Attached in the workpaper as evidence.' }, corrected: false, status: 'evidence', reason: a.note || `Attached to ${a.targets.join(', ')}`, landings: [], duplicatePages: [], values: 0, findings: a.targets.filter((t) => findings.some((f) => f.id === t)), lowConfidence: 0 });
  return out;
}

// ---------- Required steps & gate ----------

export function steps(s: State, ours: Ours, findings: Finding[], sos: SignoffView[]) {
  const P = packet();
  const std = s.standards.required_steps as string[];
  const verifiedBy = (key: string, types: string[]) => s.verifications.find((v) => v.target === key && types.includes(v.type));
  const auto: Record<string, () => { done: boolean; evidence: string[]; note: string }> = {
    'Engagement letter and consents signed': () => ({ done: ['D01', 'D02'].every((d) => P.docs.has(d)), evidence: [...P.docs.values()].filter((d) => /engagement_letter|consent/.test(d.document_type)).map((d) => d.id), note: 'Signed engagement letter and §7216 consent in file.' }),
    'Prior-year variances explained': () => {
      const v = findings.filter((f) => f.source === 'variance');
      const open = v.filter((f) => !['resolved', 'no_change'].includes(f.status!));
      return { done: open.length === 0, evidence: [], note: `${v.length - open.length} of ${v.length} variances explained.` };
    },
    'Carryovers agreed to prior year': () => {
      const keys = ['SchD.6', 'SchD.14', 'F8582.1c', 'F8606.2'];
      const done = keys.filter((k) => verifiedBy(k, ['agreed_to_prior_year']));
      return { done: done.length === keys.length, evidence: keys.map((k) => `line:${k}`), note: `${done.length} of ${keys.length} carryover lines verified "agreed to prior year".` };
    },
    'Estimated payments agreed to IRS and FTB records': () => {
      const keys = ['F1040.26', 'F540NR.72'];
      const done = keys.filter((k) => verifiedBy(k, ['agreed_to_third_party_record']));
      return { done: done.length === keys.length, evidence: keys.map((k) => `line:${k}`), note: `${done.length} of ${keys.length} payment lines verified "agreed to third-party record".` };
    },
    'Due diligence completed': () => ({ done: s.dueDiligence.has('ctc_odc'), evidence: [], note: s.dueDiligence.has('ctc_odc') ? 'Form 8867 checklist recorded for CTC/ODC.' : 'Form 8867 checklist for the child tax credit and credit for other dependents not yet recorded.' }),
    'Diagnostics resolved': () => {
      const eng = findings.filter((f) => f.source === 'engine' && f.blocksFiling);
      const open = eng.filter((f) => !['resolved', 'no_change'].includes(f.status!));
      return { done: open.length === 0, evidence: [], note: `${eng.length - open.length} of ${eng.length} engine warnings resolved.` };
    },
    'Reviewer sign-off': () => {
      const need = reviewAreas(ours, findings);
      const have = need.filter((a) => sos.some((x) => x.scope === `area:${a}` && x.level === 'reviewer' && x.valid));
      return { done: have.length === need.length, evidence: [], note: `${have.length} of ${need.length} areas signed off by a reviewer (valid).` };
    },
    'Partner sign-off': () => {
      const so = sos.find((x) => x.scope === 'return' && x.level === 'partner');
      return { done: !!so?.valid, evidence: [], note: so ? (so.valid ? `Signed by ${so.actorName}.` : 'Reopened: the return changed after the partner signed.') : 'Not signed.' };
    },
    'Client approval and e-file authorization': () => {
      const ap = s.filing.clientApproval;
      const cur = hashContent(clientSummary(ours));
      return { done: !!ap && ap.hash === cur, evidence: [], note: ap ? (ap.hash === cur ? `Approved and Form 8879 signed by ${person(ap.actor)?.name}.` : 'The return changed after the client approved: send it again.') : 'Not yet approved by the client.' };
    },
  };
  return std.map((step) => {
    const a = auto[step]?.();
    const manual = s.steps.get(step);
    return { step, auto: !!a, done: a ? a.done : !!manual, note: a ? a.note : manual?.note ?? '', by: manual?.actor ?? null, at: manual?.at ?? null, evidence: a?.evidence ?? manual?.refs ?? [] };
  });
}

export function reviewAreas(ours: Ours, findings: Finding[]): string[] {
  return AREAS.filter((a) => a.id !== 'filing' && (areaLines(ours.base, a.id).length || findings.some((f) => f.area === a.id))).map((a) => a.id);
}

export function clientSummary(ours: Ours) {
  return { federal: ours.summary.federal, california: ours.summary.california, facts: [...ours.facts.entries()].sort() };
}

export function gate(s: State, ours: Ours, findings: Finding[], sos: SignoffView[], st: ReturnType<typeof steps>) {
  const blockers: { kind: string; text: string; ref?: string }[] = [];
  for (const f of findings) if (f.blocksFiling && !['resolved', 'no_change'].includes(f.status!)) blockers.push({ kind: 'finding', text: f.title, ref: f.id });
  for (const a of ours.activeAdjustments) if (a.status === 'pending') blockers.push({ kind: 'adjustment', text: `Adjustment ${a.id} awaiting ${a.needs} approval: ${a.title}`, ref: a.id });
  for (const x of st) if (!x.done) blockers.push({ kind: 'step', text: `${x.step}: ${x.note || 'not done'}`, ref: x.step });
  return { ready: blockers.length === 0, blockers };
}

// ---------- Notifications & changes ----------

function notificationsFor(s: State, viewer: Person | undefined) {
  if (!viewer) return { items: [], unread: 0 };
  const items: { seq: number; at: string; text: string; link: string; actor: string }[] = [];
  const name = (id: string) => person(id)?.name ?? id;
  for (const e of s.events) {
    if (e.actor === viewer.id) continue;
    const p = e.payload || {};
    let text = '';
    let link = '';
    if (e.type === 'assignment.set' && p.user === viewer.id) { text = `${name(e.actor)} assigned you as ${p.role} for ${AREAS.find((a) => a.id === p.area)?.name ?? p.area}`; link = `#/areas/${p.area}`; }
    else if (e.type === 'finding.assigned' && p.owner === viewer.id) { text = `${name(e.actor)} assigned you a finding`; link = `#/findings/${encodeURIComponent(p.findingId)}`; }
    else if (e.type === 'review_note.created' && (p.to === viewer.id || (!p.to && viewer.role === 'preparer'))) { text = `Review note from ${name(e.actor)}: ${p.text.slice(0, 80)}`; link = `#/findings/${encodeURIComponent(p.id)}`; }
    else if (e.type === 'question.answered' && s.questions.get(p.id)?.from === viewer.id) { text = `${name(e.actor)} answered your question`; link = `#/findings/${encodeURIComponent(`Q:${p.id}`)}`; }
    else if (e.type === 'question.asked' && ((p.to === 'client' && viewer.kind === 'client') || p.to === viewer.id)) { text = `New question from ${name(e.actor)}: ${p.text.slice(0, 80)}`; link = viewer.kind === 'client' ? '#/portal' : `#/findings/${encodeURIComponent(`Q:${p.id}`)}`; }
    else if (e.type === 'adjustment.created' && ((p.needs === 'partner' && viewer.role === 'partner') || (p.needs === 'reviewer' && ['reviewer', 'partner'].includes(viewer.role)))) { text = `${name(e.actor)} proposed ${p.id} (${p.title}) — needs ${p.needs} approval`; link = '#/adjustments'; }
    else if (e.type === 'signoff.reopened' && s.signoffs.find((x) => x.id === p.signoffId)?.actor === viewer.id) { text = `Your sign-off on ${p.scope} reopened: ${p.reason}`; link = p.scope === 'return' ? '#/filing' : `#/areas/${p.scope.replace('area:', '')}`; }
    else if (e.type === 'filing.client_approved' && viewer.role === 'partner') { text = `${name(e.actor)} approved the return and signed Form 8879`; link = '#/filing'; }
    else if (e.type === 'filing.approval_requested' && viewer.kind === 'client') { text = 'Your 2025 return is ready for your approval'; link = '#/portal'; }
    else if (e.type === 'filing.result' && ['partner', 'preparer'].includes(viewer.role)) { text = `E-file ${p.jurisdiction} ${p.status}${p.errors?.length ? `: ${p.errors[0].code}` : ''}`; link = '#/filing'; }
    else if (e.type === 'message.sent' && ((p.to === 'firm' && viewer.kind === 'staff') || (p.to === 'client' && viewer.kind === 'client'))) { text = `Message from ${name(e.actor)}: ${p.text.slice(0, 80)}`; link = viewer.kind === 'client' ? '#/portal' : '#/people'; }
    else if (e.type === 'note.added' && new RegExp(`@${viewer.name.split(' ')[0]}\\b`, 'i').test(p.text)) { text = `${name(e.actor)} mentioned you: ${p.text.slice(0, 80)}`; link = p.target.startsWith('line:') ? `#/trace/${p.target.slice(5)}` : '#/findings'; }
    else if (e.type === 'season.scripted' && p.notice && viewer.kind === 'staff') { text = 'IRS Letter 566 received for 2025'; link = '#/notice'; }
    if (text) items.push({ seq: e.seq, at: e.at, text, link, actor: e.actor });
  }
  const read = s.notifRead.get(viewer.id) ?? 0;
  return { items: items.reverse().slice(0, 60), unread: items.filter((i) => i.seq > read).length };
}

function changesSince(s: State, viewer: Person | undefined) {
  if (!viewer) return { since: 0, events: [], targets: [] };
  const since = s.seen.get(viewer.id) ?? 0;
  const evs = s.events.filter((e) => e.seq > since && e.actor !== viewer.id && !['seen.marked', 'notifications.read', 'unmask.viewed', 'season.clock', 'workspace.created'].includes(e.type));
  const targets = new Set<string>();
  for (const e of evs) {
    const p = e.payload || {};
    if (p.changes) for (const c of p.changes) targets.add(c.target);
    if (p.target) targets.add(String(p.target).replace(/^line:/, ''));
    if (p.findingId) targets.add(p.findingId);
    for (const fid of p.findingIds || []) targets.add(fid);
    if (p.scope) targets.add(p.scope);
  }
  return { since, events: evs.slice(-50).map((e) => ({ seq: e.seq, at: e.at, actor: e.actor, type: e.type, subject: e.subject, summary: summarize(e) })), targets: [...targets] };
}

export function summarize(e: { type: string; payload: any; actor: string }): string {
  const p = e.payload || {};
  const n = person(e.actor)?.name ?? e.actor;
  switch (e.type) {
    case 'adjustment.created': return `${n} proposed ${p.id}: ${p.title}`;
    case 'adjustment.approved': return `${n} approved ${p.id}`;
    case 'adjustment.rejected': return `${n} rejected ${p.id}`;
    case 'adjustment.reverted': return `${n} reverted ${p.id}`;
    case 'finding.resolved': return `${n} ${p.status === 'no_change' ? 'closed (no change)' : 'resolved'} ${p.findingId}`;
    case 'finding.status': return `${n} set ${p.findingId} to ${p.status}`;
    case 'finding.assigned': return `${n} assigned ${p.findingId} to ${person(p.owner)?.name ?? p.owner}`;
    case 'review_note.created': return `${n} added review note: ${p.text.slice(0, 60)}`;
    case 'question.asked': return `${n} asked ${p.to === 'client' ? 'the client' : person(p.to)?.name}: ${p.text.slice(0, 60)}`;
    case 'question.answered': return `${n} answered ${p.id}`;
    case 'verification.recorded': return `${n} verified ${p.target} (${p.type.replace(/_/g, ' ')})`;
    case 'note.added': return `${n} noted on ${p.target}: ${p.text.slice(0, 60)}`;
    case 'signoff.recorded': return `${n} signed off ${p.scope} as ${p.level}`;
    case 'signoff.reopened': return `Sign-off on ${p.scope} reopened: ${p.reason}`;
    case 'judgment.recorded': return `${n} recorded ${p.kind}: ${p.title}`;
    case 'batch.undone': return `${n} undid "${p.label ?? p.batch}"`;
    case 'batch.redone': return `${n} redid "${p.label ?? p.batch}"`;
    case 'season.scripted': return `Season: ${p.title}`;
    case 'filing.transmitted': return `${n} transmitted ${p.jurisdiction} e-file ${p.submissionId}`;
    case 'filing.result': return `E-file ${p.jurisdiction} ${p.status}${p.errors?.length ? ` (${p.errors.map((x: any) => x.code).join(', ')})` : ''}`;
    case 'filing.frozen': return `Return frozen at filing (hash ${String(p.hash).slice(0, 12)}…)`;
    case 'filing.client_approved': return `${n} approved the return and signed Form 8879`;
    case 'filing.approval_requested': return `${n} sent the return to the client for approval`;
    case 'standards.updated': return `${n} changed standard ${p.path}`;
    case 'assignment.set': return `${n} assigned ${person(p.user)?.name ?? p.user} as ${p.role} for ${p.area}`;
    case 'time.logged': return `${n} logged ${p.hours} h on ${p.area}`;
    case 'unmask.viewed': return `${n} revealed ${p.kind} (${p.ref})`;
    case 'evidence.attached': return `${n} attached ${p.name}`;
    case 'message.sent': return `${n} → ${p.to}: ${p.text.slice(0, 60)}`;
    case 'due_diligence.recorded': return `${n} recorded due diligence (${p.credit})`;
    case 'area.status': return `${n} marked ${p.area} ${p.status.replace('_', ' ')}`;
    case 'step.completed': return `${n} completed step: ${p.step}`;
    case 'amendment.opened': return `${n} opened amendment ${p.id}: ${p.reason}`;
    case 'notice.binder_generated': return `${n} generated the exam binder for ${p.noticeId}`;
    case 'rollforward.started': return `${n} rolled the file forward to 2026`;
    case 'payment.recorded': return `Payment recorded: ${p.jurisdiction} ${p.amount}`;
    case 'link.created': return `${n} linked ${p.from} ↔ ${p.to}`;
    default: return `${n}: ${e.type}`;
  }
}

// ---------- The view ----------

const viewCache = new Map<string, any>();

export function deriveView(ws: string, viewerId: string, asOfParam?: string) {
  const live = stateFor(ws);
  const now = seasonNow(live);
  const asOfNorm = asOfParam ? isoSeconds(asOfParam) : undefined;
  const asOf = asOfNorm && asOfNorm < now ? asOfNorm : now;
  const isReplay = !!asOfNorm && asOfNorm < live.clock;
  const key = `${ws}|${live.head.seq}|${viewerId}|${isReplay ? asOf : 'live'}`;
  const hit = viewCache.get(key);
  if (hit && !isReplay && Date.now() - hit.t < 30_000) return hit.v;
  const s = isReplay ? stateFor(ws, asOf) : live;
  const P = packet();
  const viewer = person(viewerId);
  const ours = computeOursFor(s, asOf);
  const findings = allFindings(s, ours, asOf);
  const sos = signoffViews(s, ours, findings);
  const st = steps(s, ours, findings, sos);
  const g = gate(s, ours, findings, sos, st);
  const docs = documentIndex(s, ours, findings, asOf);
  const ns = nextScript(live);
  const adjustments = [...s.adjustments.values()].map((a) => ({ ...a, effect: adjustmentEffect(ours.model, a) }));
  const areas = AREAS.map((a) => {
    const fs = findings.filter((f) => f.area === a.id);
    const asg = s.assignments.get(a.id) || {};
    return {
      id: a.id, name: a.name, budgetKey: a.budgetKey,
      budget: a.budgetKey ? P.firm.budget_hours[a.budgetKey] ?? 0 : 0,
      actual: s.time.filter((t) => t.area === a.id).reduce((x, t) => x + t.hours, 0),
      lines: areaLines(ours.base, a.id).length,
      open: fs.filter((f) => !['resolved', 'no_change'].includes(f.status!)).length,
      blocking: fs.filter((f) => f.blocksFiling && !['resolved', 'no_change'].includes(f.status!)).length,
      total: fs.length,
      signoffs: sos.filter((x) => x.scope === `area:${a.id}`).map((x) => ({ id: x.id, level: x.level, actor: x.actor, actorName: x.actorName, at: x.at, valid: x.valid, changes: x.changes })),
      preparer: asg.preparer ?? P.firm.assignment_at_start.preparer,
      reviewer: asg.reviewer ?? P.firm.assignment_at_start.reviewer,
      partner: asg.partner ?? P.firm.assignment_at_start.partner,
      due: asg.due ?? (a.id === 'filing' ? '2026-10-15' : '2026-07-01'),
      status: s.areaStatus.get(a.id) ?? null,
    };
  });
  const v = {
    meta: {
      ws, packetSha256: P.sha256, recordedPacketSha256: s.packetSha256, head: s.head, clock: live.clock, now, asOf, isReplay,
      frozen: s.filing.frozen ?? null, events: s.events.length, generatedAt: new Date().toISOString(),
    },
    viewer: viewer ? { ...viewer, active: isActive(viewer, live.clock) } : null,
    people: people().map((p) => ({ ...p, active: isActive(p, live.clock) })),
    versions: P.versionList().filter((x) => x.computed_at <= asOf).map((x) => ({ version: x.version, computed_at: x.computed_at, trigger: x.trigger, summary: x.summary, diagnostics: x.diagnostics.length, changes: x.changes_from_previous.length })),
    baseVersion: ours.base.version,
    ours: {
      summary: ours.summary,
      lines: Object.fromEntries([...ours.status.entries()].map(([k, st2]) => [k, { value: ours.values.get(k), status: st2 }])),
      added: ours.added,
      facts: Object.fromEntries(ours.facts),
      combinedEffect: ours.combinedEffect,
    },
    findings,
    adjustments,
    signoffs: sos,
    steps: st,
    gate: g,
    areas,
    documents: docs,
    questions: [...s.questions.values()],
    reviewNotes: [...s.reviewNotes.values()],
    messages: [
      ...P.p.client.messages.filter((m: any) => m.sent_at <= asOf && m.sent_at <= '2026-06-23T09:00:00Z').map((m: any) => ({ id: m.id, from: m.from, to: m.to, text: m.text, refs: [], at: m.sent_at, source: 'packet' })),
      ...s.messages,
    ],
    judgments: s.judgments,
    dueDiligence: Object.fromEntries(s.dueDiligence),
    verifications: s.verifications,
    notes: s.notes,
    areaStatus: Object.fromEntries(s.areaStatus),
    time: s.time,
    standards: s.standards,
    standardsHistory: s.standardsHistory,
    unmaskLog: viewer && ['partner', 'firm_administrator', 'quality_reviewer'].includes(viewer.role) ? s.unmaskLog : s.unmaskLog.filter((u) => u.actor === viewerId),
    attachments: s.attachments,
    links: s.links,
    filing: s.filing,
    amendments: s.amendments,
    payments: s.payments,
    notices: s.notices,
    binders: s.binders,
    rollforward: s.rollforward ?? null,
    script: { next: ns.item, blocked: ns.blocked, applied: [...live.scriptApplied], items: scriptItems() },
    notifications: notificationsFor(s, viewer),
    changes: changesSince(s, viewer),
    batches: [...s.batches.entries()].map(([id, b]) => ({ id, ...b })).reverse().slice(0, 20),
    timeline: timelineFor(s, asOf),
  };
  if (!isReplay) viewCache.set(key, { t: Date.now(), v });
  if (viewCache.size > 200) viewCache.delete(viewCache.keys().next().value!);
  return v;
}

export function adjustmentEffect(model: LineModel, a: Adjustment): TaxEffect {
  const lineChanges = a.changes.filter((c) => !c.target.includes(':')).map((c) => ({ target: c.target, value: c.value, addTo: c.addTo, label: c.label, caSource: c.caSource, category: c.category }));
  return effectFor(model, { proposed: lineChanges, whatIf: a.whatIf }) ?? { fed: 0, ca: 0, method: 'none', estimate: false };
}

function timelineFor(s: State, asOf: string) {
  const P = packet();
  const items: { at: string; kind: string; title: string; actor: string | null; refs: string[]; seq?: number }[] = [];
  for (const t of P.p.timeline) if (t.at <= asOf && (t.at <= '2026-06-23T09:00:00Z' || s.scriptApplied.has(t.id))) items.push({ at: t.at, kind: 'packet', title: t.event.replace(/_/g, ' ') + (t.detail ? ` — ${t.detail}` : ''), actor: t.actor, refs: t.refs });
  for (const d of P.docs.values()) if (d.received_at <= asOf) items.push({ at: d.received_at, kind: 'document', title: `${d.id} received: ${d.title}`, actor: d.uploaded_by === 'firm' ? 'firm' : 'client', refs: [d.id] });
  for (const e of s.events) {
    if (['seen.marked', 'notifications.read', 'workspace.created', 'season.clock', 'season.scripted'].includes(e.type)) continue;
    items.push({ at: e.at, kind: 'workpaper', title: summarize(e), actor: e.actor, refs: e.subject ? [e.subject] : [], seq: e.seq });
  }
  return items.sort((a, b) => a.at.localeCompare(b.at) || (a.seq ?? 0) - (b.seq ?? 0));
}

export function invalidateViews(ws: string) {
  for (const k of viewCache.keys()) if (k.startsWith(`${ws}|`)) viewCache.delete(k);
}
