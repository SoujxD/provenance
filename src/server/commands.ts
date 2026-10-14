// Commands: the only way to change a workpaper. Each validates against the firm's standards and
// the viewer's role, then appends events. Nothing is ever updated in place.
import { packet } from './packet.ts';
import { append, appendMany, newId, canonical, sha256, type NewEvent } from './events.ts';
import { getDb } from './db.ts';
import { stateFor, computeOursFor, allFindings, signoffViews, steps, gate, scopeContent, hashContent, preparersOf, adjustmentEffect, clientSummary, invalidateViews, reviewAreas } from './derive.ts';
import { person, require, Forbidden, isActive } from './access.ts';
import { nextScript, seasonNow } from './season.ts';
import type { State } from './state.ts';
import { maskValue } from '../shared/mask.ts';
import { AREAS, areaForLine } from '../shared/types.ts';

export class BadRequest extends Error {
  status = 400;
}
export class Conflict extends Error {
  status = 409;
}

type Ctx = { ws: string; actorId: string; s: State; at: string; batch: string | null };

function ev(ctx: Ctx, type: string, payload: any, subject?: string): NewEvent {
  return { actor: ctx.actorId, type, subject: subject ?? null, payload, at: ctx.at, batch: ctx.batch };
}

const need = (v: unknown, msg: string) => {
  if (v === undefined || v === null || (typeof v === 'string' && !v.trim())) throw new BadRequest(msg);
};

export function execute(ws: string, actorId: string, cmd: any): any {
  const s = stateFor(ws);
  const at = seasonNow(s);
  const viewer = person(actorId);
  if (!viewer) throw new Forbidden('Choose a person in the role switcher first.');
  if (cmd.type === 'bulk') return bulk(ws, actorId, cmd);
  const ctx: Ctx = { ws, actorId, s, at, batch: cmd.batch ?? null };
  const events = plan(ctx, cmd);
  const result: any = (events as any).result;
  if (events.length) {
    appendMany(ws, events);
    afterWrite(ws, at);
  }
  return result ?? { ok: true, events: events.length };
}

function bulk(ws: string, actorId: string, cmd: any) {
  const batch = newId('batch');
  const results: any[] = [];
  const errors: any[] = [];
  let first = true;
  for (const item of cmd.items || []) {
    try {
      const s = stateFor(ws);
      const ctx: Ctx = { ws, actorId, s, at: seasonNow(s), batch };
      const events = plan(ctx, item);
      if (first && events.length) { events[0].payload = { ...events[0].payload, batchLabel: cmd.label || 'Bulk action' }; first = false; }
      if (events.length) appendMany(ws, events);
      results.push((events as any).result ?? { ok: true });
    } catch (err: any) {
      errors.push({ item: item.type, target: item.findingId ?? item.id ?? item.target, error: err.message });
    }
  }
  afterWrite(ws, seasonNow(stateFor(ws)));
  return { ok: errors.length === 0, batch, label: cmd.label, done: results.length, errors };
}

/** After every write: detect sign-offs whose signed content changed and log that they reopened. */
function afterWrite(ws: string, at: string) {
  invalidateViews(ws);
  const s = stateFor(ws);
  const ours = computeOursFor(s, at);
  const findings = allFindings(s, ours, at);
  const sos = signoffViews(s, ours, findings);
  const events: NewEvent[] = [];
  for (const so of sos) {
    if (!so.valid && !so.reopenedAt) events.push({ actor: 'system', type: 'signoff.reopened', subject: so.scope, payload: { signoffId: so.id, scope: so.scope, level: so.level, reason: so.changes.slice(0, 3).join('; ') || 'signed content changed' }, at });
  }
  if (events.length) {
    appendMany(ws, events);
    invalidateViews(ws);
  }
}

function plan(ctx: Ctx, cmd: any): NewEvent[] {
  const { s } = ctx;
  const P = packet();
  const viewer = person(ctx.actorId)!;
  const out: NewEvent[] = [];
  const frozen = !!s.filing.frozen;
  switch (cmd.type) {
    case 'adjustment.create': {
      require(viewer, 'adjustment.create', s);
      need(cmd.reason, 'Every adjustment needs a reason.');
      if (!Array.isArray(cmd.changes) || !cmd.changes.length) throw new BadRequest('No changes given.');
      if (cmd.judgment && !String(cmd.authority ?? '').trim()) throw new BadRequest('Firm standard: every judgment call records the authority relied on.');
      const openAmendment = s.amendments.find((a) => a.status === 'open');
      if (frozen && !openAmendment) throw new Conflict('The return is frozen at filing. A partner must open an amendment to change it.');
      const ours = computeOursFor(s, ctx.at);
      const P2 = P;
      const changes = cmd.changes.map((c: any) => {
        need(c.target, 'Change target missing.');
        let original: any = null;
        if (c.target.startsWith('household:')) {
          const [pid, field] = c.target.slice(10).split('.');
          original = ours.facts.get(c.target) ?? P2.people.get(pid)?.[field] ?? null;
        } else if (c.target.startsWith('label:')) original = ours.model.lines.get(c.target.slice(6))?.label ?? null;
        else if (ours.values.has(c.target)) original = ours.values.get(c.target) ?? null;
        else if (!c.addTo) throw new BadRequest(`Unknown line ${c.target}. New lines need the total they add to.`);
        const value = typeof original === 'number' || c.addTo ? Number(c.value) : c.value;
        if (typeof value === 'number' && !Number.isFinite(value)) throw new BadRequest(`Value for ${c.target} is not a number.`);
        return { target: c.target, original, value, label: c.label, addTo: c.addTo, caSource: !!c.caSource, category: c.category };
      });
      const id = cmd.id || `ADJ-${String(countOf(s, 'adjustment.created') + 1).padStart(3, '0')}`;
      const draft: any = { id, title: cmd.title || cmd.reason.slice(0, 60), changes, whatIf: cmd.whatIf, findingIds: cmd.findingIds || [] };
      const effect = adjustmentEffect(ours.model, draft);
      const threshold = Number(s.standards.partner_threshold ?? 1000);
      const needs = Math.max(Math.abs(effect.fed), Math.abs(effect.ca)) > threshold || cmd.judgment ? 'partner' : 'reviewer';
      out.push(ev(ctx, 'adjustment.created', { ...draft, reason: cmd.reason, authority: cmd.authority, judgment: !!cmd.judgment, effect, needs, layer: frozen ? 'amendment' : 'return', amendmentId: frozen ? openAmendment!.id : undefined, batchLabel: cmd.batchLabel }, id));
      (out as any).result = { ok: true, id, needs, effect };
      return out;
    }
    case 'adjustment.approve': {
      const a = s.adjustments.get(cmd.id);
      if (!a) throw new BadRequest(`No adjustment ${cmd.id}.`);
      require(viewer, 'adjustment.approve', s);
      if (a.createdBy === ctx.actorId) throw new Forbidden('Firm standard: a person may not review or sign off on work they prepared.', 'no_self_review');
      if (a.needs === 'partner' && viewer.role !== 'partner') throw new Forbidden(`Firm standard: adjustments with a tax effect over ${Number(s.standards.partner_threshold ?? 1000).toLocaleString()} (or judgment calls) require partner sign-off.`, 'partner_threshold');
      if (a.status !== 'pending') throw new Conflict(`${a.id} is ${a.status}.`);
      out.push(ev(ctx, 'adjustment.approved', { id: a.id }, a.id));
      return out;
    }
    case 'adjustment.reject':
    case 'adjustment.revert': {
      const a = s.adjustments.get(cmd.id);
      if (!a) throw new BadRequest(`No adjustment ${cmd.id}.`);
      require(viewer, cmd.type === 'adjustment.reject' ? 'adjustment.approve' : 'adjustment.revert', s);
      need(cmd.note, 'Say why.');
      if (frozen && a.layer === 'return') throw new Conflict('The return is frozen: amend instead of reverting a filed adjustment.');
      out.push(ev(ctx, cmd.type === 'adjustment.reject' ? 'adjustment.rejected' : 'adjustment.reverted', { id: a.id, note: cmd.note }, a.id));
      return out;
    }
    case 'batch.undo':
    case 'batch.redo': {
      require(viewer, 'staff.write', s);
      const b = s.batches.get(cmd.batch);
      if (!b) throw new BadRequest('No such batch.');
      if (b.actor !== ctx.actorId && !['partner', 'reviewer'].includes(viewer.role)) throw new Forbidden('Only the person who ran a bulk action (or a reviewer) can undo it.');
      if (frozen) throw new Conflict('The return is frozen.');
      out.push({ ...ev(ctx, cmd.type === 'batch.undo' ? 'batch.undone' : 'batch.redone', { batch: cmd.batch, label: b.label }), batch: null });
      return out;
    }
    case 'finding.status': {
      require(viewer, 'finding.update', s);
      out.push(ev(ctx, 'finding.status', { findingId: cmd.findingId, status: cmd.status, note: cmd.note }, cmd.findingId));
      return out;
    }
    case 'finding.assign': {
      require(viewer, 'finding.update', s);
      if (cmd.owner && !isActive(person(cmd.owner)!, s.clock)) throw new BadRequest(`${person(cmd.owner)?.name} is not active yet.`);
      out.push(ev(ctx, 'finding.assigned', { findingId: cmd.findingId, owner: cmd.owner ?? null }, cmd.findingId));
      return out;
    }
    case 'finding.resolve': {
      require(viewer, 'finding.update', s);
      need(cmd.note, 'Record how it was resolved.');
      const findings = allFindings(s, computeOursFor(s, ctx.at), ctx.at);
      const f = findings.find((x) => x.id === cmd.findingId);
      if (f?.judgment && !String(cmd.authority ?? '').trim()) throw new BadRequest('Firm standard: every judgment call records the authority relied on.');
      if (f?.source === 'review_note') {
        const rn = s.reviewNotes.get(f.id);
        if (rn && rn.by !== ctx.actorId && !['reviewer', 'partner'].includes(viewer.role)) {
          // The preparer answers a review note; only a reviewer clears it.
          out.push(ev(ctx, 'finding.status', { findingId: cmd.findingId, status: 'in_progress', note: `Response: ${cmd.note}` }, cmd.findingId));
          (out as any).result = { ok: true, note: 'Response recorded; the reviewer clears the note.' };
          return out;
        }
      }
      out.push(ev(ctx, 'finding.resolved', { findingId: cmd.findingId, status: cmd.status === 'no_change' ? 'no_change' : 'resolved', note: cmd.note, authority: cmd.authority, adjustments: cmd.adjustments }, cmd.findingId));
      return out;
    }
    case 'review_note.create': {
      require(viewer, 'review_note.create', s);
      need(cmd.text, 'Write the note.');
      const id = `RN-${String(countOf(s, 'review_note.created') + 1).padStart(3, '0')}`;
      const area = cmd.area || (String(cmd.target).startsWith('line:') ? areaForLine(cmd.target.slice(5)) : 'intake');
      out.push(ev(ctx, 'review_note.created', { id, target: cmd.target || 'return', text: cmd.text, blocking: cmd.blocking !== false, to: cmd.to ?? null, area }, id));
      (out as any).result = { ok: true, id };
      return out;
    }
    case 'question.ask': {
      require(viewer, 'question.ask', s);
      need(cmd.text, 'Write the question.');
      const id = `QN-${String(countOf(s, 'question.asked') + 1).padStart(3, '0')}`;
      out.push(ev(ctx, 'question.asked', { id, to: cmd.to || 'client', text: cmd.text, refs: cmd.refs || [], findingIds: cmd.findingIds || [], required: !!cmd.required }, id));
      (out as any).result = { ok: true, id };
      return out;
    }
    case 'question.answer': {
      const q = s.questions.get(cmd.id);
      if (!q) throw new BadRequest('No such question.');
      if (q.to === 'client' ? viewer.kind !== 'client' : q.to !== ctx.actorId) throw new Forbidden('This question is addressed to someone else.');
      need(cmd.text, 'Write an answer.');
      out.push(ev(ctx, 'question.answered', { id: q.id, text: cmd.text, attachments: cmd.attachments || [] }, q.id));
      return out;
    }
    case 'question.close': {
      require(viewer, 'question.ask', s);
      out.push(ev(ctx, 'question.closed', { id: cmd.id }, cmd.id));
      return out;
    }
    case 'verification.record': {
      require(viewer, 'staff.write', s);
      if (!s.standards.verification_types.includes(cmd.verificationType)) throw new BadRequest(`Verification type must be one of: ${s.standards.verification_types.join(', ')}.`);
      need(cmd.target, 'What was verified?');
      if (frozen) throw new Conflict('The return is frozen at filing.');
      out.push(ev(ctx, 'verification.recorded', { target: cmd.target, type: cmd.verificationType, note: cmd.note || '', refs: cmd.refs || [] }, cmd.target));
      return out;
    }
    case 'note.add': {
      if (viewer.kind !== 'staff') throw new Forbidden('Only staff add workpaper notes.');
      need(cmd.text, 'Write the note.');
      out.push(ev(ctx, 'note.added', { target: cmd.target, text: cmd.text }, cmd.target));
      return out;
    }
    case 'signoff': {
      const level = cmd.level as 'preparer' | 'reviewer' | 'partner';
      require(viewer, level === 'preparer' ? 'signoff.preparer' : level === 'reviewer' ? 'signoff.reviewer' : 'signoff.partner', s);
      const scope = cmd.scope as string;
      const ours = computeOursFor(s, ctx.at);
      const findings = allFindings(s, ours, ctx.at);
      if (level !== 'preparer' && preparersOf(s, scope, ours.base).has(ctx.actorId)) throw new Forbidden('Firm standard: a person may not review or sign off on work they prepared.', 'no_self_review');
      const sos = signoffViews(s, ours, findings);
      if (level === 'reviewer' && scope !== 'return' && !sos.some((x) => x.scope === scope && x.level === 'preparer' && x.valid)) throw new Conflict('A preparer must sign off this area before review.');
      if (scope === 'return') {
        if (level !== 'partner') throw new BadRequest('The return-level sign-off is the partner\'s.');
        const areas = reviewAreas(ours, findings);
        const missing = areas.filter((a) => !sos.some((x) => x.scope === `area:${a}` && x.level === 'reviewer' && x.valid));
        if (missing.length) throw new Conflict(`Reviewer sign-off missing or reopened for: ${missing.map((a) => AREAS.find((x) => x.id === a)?.name).join(', ')}.`);
        const pendingBig = ours.activeAdjustments.filter((a) => a.status === 'pending');
        if (pendingBig.length) throw new Conflict(`Approve or reject pending adjustments first: ${pendingBig.map((a) => a.id).join(', ')}.`);
      }
      const content = scopeContent(s, ours, findings, scope);
      const id = newId('SO');
      out.push(ev(ctx, 'signoff.recorded', { id, scope, level, hash: hashContent(content), snapshot: content }, scope));
      (out as any).result = { ok: true, id };
      return out;
    }
    case 'signoff.withdraw': {
      const so = s.signoffs.find((x) => x.id === cmd.signoffId);
      if (!so || so.actor !== ctx.actorId) throw new Forbidden('Only the signer can withdraw a sign-off.');
      out.push(ev(ctx, 'signoff.withdrawn', { signoffId: so.id, scope: so.scope }, so.scope));
      return out;
    }
    case 'judgment.record': {
      require(viewer, 'judgment.record', s);
      need(cmd.title, 'Title the judgment.');
      need(cmd.decision, 'Record the decision.');
      if (!String(cmd.authority ?? '').trim()) throw new BadRequest('Firm standard: every judgment call records the authority relied on.');
      const id = `J-${String(countOf(s, 'judgment.recorded') + 1).padStart(3, '0')}`;
      out.push(ev(ctx, 'judgment.recorded', { id, kind: cmd.kind || 'position', title: cmd.title, decision: cmd.decision, authority: cmd.authority, refs: cmd.refs || [], findingIds: cmd.findingIds || [] }, id));
      return out;
    }
    case 'due_diligence.record': {
      require(viewer, 'staff.write', s);
      if (!['preparer', 'reviewer', 'partner'].includes(viewer.role)) throw new Forbidden('Due diligence is completed by the preparer.');
      const answers = cmd.answers || {};
      if (Object.values(answers).some((v) => !String(v).trim())) throw new BadRequest('Answer every due diligence question.');
      out.push(ev(ctx, 'due_diligence.recorded', { credit: cmd.credit || 'ctc_odc', answers, evidence: cmd.evidence || [] }, 'F8867'));
      return out;
    }
    case 'area.status': {
      require(viewer, 'staff.write', s);
      out.push(ev(ctx, 'area.status', { area: cmd.area, status: cmd.status, note: cmd.note || '' }, cmd.area));
      return out;
    }
    case 'step.complete': {
      require(viewer, 'staff.write', s);
      out.push(ev(ctx, 'step.completed', { step: cmd.step, note: cmd.note || '', refs: cmd.refs || [] }, cmd.step));
      return out;
    }
    case 'step.reopen': {
      require(viewer, 'staff.write', s);
      out.push(ev(ctx, 'step.reopened', { step: cmd.step }, cmd.step));
      return out;
    }
    case 'assignment.set': {
      require(viewer, 'assignment.set', s);
      const u = cmd.user ? person(cmd.user) : null;
      if (u && !isActive(u, s.clock)) throw new BadRequest(`${u.name} is not active until ${u.activeFrom}.`);
      if (u && cmd.role === 'reviewer' && (s.assignments.get(cmd.area)?.preparer ?? P.firm.assignment_at_start.preparer) === u.id) throw new BadRequest('The reviewer cannot be the area\'s preparer.');
      out.push(ev(ctx, 'assignment.set', { area: cmd.area, role: cmd.role, user: cmd.user, due: cmd.due }, cmd.area));
      return out;
    }
    case 'time.log': {
      require(viewer, 'time.log', s);
      const hours = Number(cmd.hours);
      if (!(hours > 0 && hours <= 24)) throw new BadRequest('Hours must be between 0 and 24.');
      out.push(ev(ctx, 'time.logged', { area: cmd.area, hours, note: cmd.note || '' }, cmd.area));
      return out;
    }
    case 'standards.update': {
      require(viewer, 'standards.update', s);
      need(cmd.path, 'Which standard?');
      const before = cmd.path.split('.').reduce((o: any, k: string) => (o == null ? undefined : o[k]), s.standards);
      out.push(ev(ctx, 'standards.updated', { path: cmd.path, before: before ?? null, after: cmd.value, note: cmd.note || '' }, `standards.${cmd.path}`));
      return out;
    }
    case 'unmask': {
      require(viewer, 'unmask', s);
      const sv = P.sensitive.find((x) => x.ref === cmd.ref || maskValue(x) === cmd.masked);
      if (!sv) throw new BadRequest('Nothing to reveal.');
      out.push(ev(ctx, 'unmask.viewed', { ref: sv.ref, kind: sv.kind, purpose: cmd.purpose || '' }, sv.ref));
      (out as any).result = { ok: true, value: sv.value, ref: sv.ref, kind: sv.kind };
      return out;
    }
    case 'seen.mark':
      out.push({ ...ev(ctx, 'seen.marked', {}), batch: null });
      return out;
    case 'notifications.read':
      out.push({ ...ev(ctx, 'notifications.read', { upTo: s.head.seq }), batch: null });
      return out;
    case 'link.create': {
      require(viewer, 'staff.write', s);
      out.push(ev(ctx, 'link.created', { from: cmd.from, to: cmd.to, relation: cmd.relation || 'related', note: cmd.note || '' }, cmd.from));
      return out;
    }
    case 'message.send': {
      need(cmd.text, 'Write a message.');
      const to = viewer.kind === 'client' ? 'firm' : 'client';
      out.push(ev(ctx, 'message.sent', { id: newId('msg'), to, text: cmd.text, refs: cmd.refs || [] }));
      return out;
    }
    case 'filing.request_approval': {
      require(viewer, 'filing.request_approval', s);
      if (frozen) throw new Conflict('Already filed.');
      const ours = computeOursFor(s, ctx.at);
      const findings = allFindings(s, ours, ctx.at);
      const sos = signoffViews(s, ours, findings);
      const st = steps(s, ours, findings, sos).filter((x) => x.step !== 'Client approval and e-file authorization');
      const g = gate(s, ours, findings, sos, st);
      if (!g.ready) throw new Conflict(`Not ready to send for approval (${g.blockers.length} open): ${g.blockers.slice(0, 4).map((b) => b.text).join(' · ')}`);
      const summary = clientSummary(ours);
      out.push(ev(ctx, 'filing.approval_requested', { hash: hashContent(summary), summary }, 'return'));
      return out;
    }
    case 'filing.client_approve': {
      require(viewer, 'client.act', s);
      if (!s.filing.approvalRequested) throw new Conflict('The firm has not sent the return for approval yet.');
      const pin = String(cmd.pin ?? '');
      if (!/^\d{5}$/.test(pin)) throw new BadRequest('Enter a five-digit signature PIN.');
      if (!cmd.consent) throw new BadRequest('Confirm that you have reviewed the return and authorize e-filing.');
      const ours = computeOursFor(s, ctx.at);
      const hash = hashContent(clientSummary(ours));
      if (hash !== s.filing.approvalRequested.hash) throw new Conflict('The return changed after it was sent to you; the firm will send the current version.');
      out.push(ev(ctx, 'filing.client_approved', { hash, pinMasked: maskValue({ value: pin, kind: 'pin' }) }, 'F8879'));
      return out;
    }
    case 'filing.transmit':
      return transmit(ctx);
    case 'amendment.open': {
      require(viewer, 'amendment.open', s);
      if (!frozen) throw new Conflict('Nothing to amend: the return has not been filed.');
      need(cmd.reason, 'Why amend?');
      const id = `AMD-${s.amendments.length + 1}`;
      out.push(ev(ctx, 'amendment.opened', { id, reason: cmd.reason }, id));
      return out;
    }
    case 'season.advance':
      return advance(ctx);
    case 'notice.binder': {
      require(viewer, 'notice.respond', s);
      out.push(ev(ctx, 'notice.binder_generated', { noticeId: cmd.noticeId, hash: cmd.hash }, cmd.noticeId));
      return out;
    }
    case 'rollforward.start': {
      require(viewer, 'rollforward', s);
      out.push(ev(ctx, 'rollforward.started', { hash: cmd.hash, pkg: cmd.pkg }, '2026'));
      return out;
    }
    default:
      throw new BadRequest(`Unknown command ${cmd.type}`);
  }
}

// ---------- E-file (simulated agency) ----------

/** The agency's own records: SSNs as issued (SSA card where one exists, else third-party filings). */
function agencyTin(personId: string): string {
  const P = packet();
  const p = P.people.get(personId);
  for (const d of P.docs.values()) {
    if (d.document_type !== 'identity_document' || !/Social Security card/i.test(d.pages[0].printed_content)) continue;
    if (d.pages[0].printed_content.includes(p.name)) return d.pages[0].printed_content.match(/\d{3}-\d{2}-\d{4}/)![0];
  }
  return p.ssn;
}

function transmit(ctx: Ctx): NewEvent[] {
  const { s } = ctx;
  const P = packet();
  const viewer = person(ctx.actorId)!;
  require(viewer, 'filing.transmit', s);
  if (s.filing.frozen) throw new Conflict('Already filed and accepted.');
  if (ctx.actorId !== P.firm.firm_identity.paid_preparer_signing_returns) throw new Forbidden('Only the paid preparer who signs returns (firm identity) can transmit.');
  const ours = computeOursFor(s, ctx.at);
  const findings = allFindings(s, ours, ctx.at);
  const sos = signoffViews(s, ours, findings);
  const st = steps(s, ours, findings, sos);
  const g = gate(s, ours, findings, sos, st);
  // A rejection from a previous submission does not block a retransmission of the fix.
  const blockers = g.blockers.filter((b) => !(b.kind === 'finding' && String(b.ref).startsWith('EFILE:')));
  if (blockers.length) throw new Conflict(`Filing is gated (${blockers.length}): ${blockers.slice(0, 5).map((b) => b.text).join(' · ')}`);
  const tried = s.filing.submissions.filter((x) => x.jurisdiction === 'federal').length;
  const packetFed = P.p.tax_agency_records.efile.filter((x: any) => x.jurisdiction === 'federal');
  const packetCa = P.p.tax_agency_records.efile.filter((x: any) => x.jurisdiction === 'california');
  const fedId = packetFed[tried]?.submission_id ?? `7153042026${Date.now()}`.slice(0, 20);
  const payload = { summary: ours.summary, facts: Object.fromEntries(ours.facts), lines: [...ours.values.entries()].filter(([, v]) => typeof v === 'number') };
  const payloadHash = sha256(canonical(payload));
  const out: NewEvent[] = [ev(ctx, 'filing.transmitted', { jurisdiction: 'federal', submissionId: fedId, payloadHash }, fedId)];
  // Agency checks: every person's TIN on the return against the agency's records.
  const errors: any[] = [];
  const deps = P.household.people.filter((x: any) => x.role === 'dependent');
  for (const p of P.household.people) {
    const onReturn = ours.facts.get(`household:${p.id}.ssn`) ?? p.ssn;
    if (onReturn !== agencyTin(p.id)) {
      const template = packetFed.flatMap((x: any) => x.errors || []).find((e: any) => /TIN/.test(e.message));
      const n = deps.findIndex((d: any) => d.id === p.id) + 1;
      errors.push({ code: template?.code ?? 'R0000-504-02', message: template ? template.message.replace(/dependent \d+: [^)]+/, `dependent ${n}: ${p.name}`) : `TIN mismatch for ${p.name}` });
    }
  }
  if (errors.length) {
    out.push(ev(ctx, 'filing.result', { jurisdiction: 'federal', submissionId: fedId, status: 'rejected', errors }, fedId));
    const caId = packetCa[0]?.submission_id ?? `${fedId}1`;
    out.push(ev(ctx, 'filing.transmitted', { jurisdiction: 'california', submissionId: `${caId}-held-${tried}`, payloadHash }, caId));
    out.push(ev(ctx, 'filing.result', { jurisdiction: 'california', submissionId: `${caId}-held-${tried}`, status: 'not_transmitted', errors: packetCa[0]?.errors ?? [{ code: 'STATE-HOLD', message: 'State return held because the federal return was rejected.' }] }, caId));
    (out as any).result = { ok: false, status: 'rejected', errors };
    return out;
  }
  out.push(ev(ctx, 'filing.result', { jurisdiction: 'federal', submissionId: fedId, status: 'accepted', errors: [] }, fedId));
  const caId = packetCa.find((x: any) => x.status === 'accepted')?.submission_id ?? `${fedId}2`;
  out.push(ev(ctx, 'filing.transmitted', { jurisdiction: 'california', submissionId: caId, payloadHash }, caId));
  out.push(ev(ctx, 'filing.result', { jurisdiction: 'california', submissionId: caId, status: 'accepted', errors: [] }, caId));
  // Freeze: a content-addressed snapshot of everything that was filed and why.
  const snapshot = {
    packetSha256: P.sha256, eventHead: s.head, filedAt: ctx.at, baseVersion: ours.base.version,
    summary: ours.summary, facts: Object.fromEntries(ours.facts),
    lines: Object.fromEntries([...ours.values.entries()]), lineStatus: Object.fromEntries(ours.status),
    added: ours.added,
    adjustments: [...s.adjustments.values()].filter((a) => a.status === 'approved'),
    findings: findings.map((f) => ({ id: f.id, title: f.title, status: f.status, resolution: f.resolution, effect: f.effect })),
    signoffs: sos.map((x) => ({ scope: x.scope, level: x.level, actor: x.actor, at: x.at, hash: x.hash, valid: x.valid })),
    clientApproval: s.filing.clientApproval, judgments: s.judgments,
    submissions: [{ id: fedId, jurisdiction: 'federal', status: 'accepted' }, { id: caId, jurisdiction: 'california', status: 'accepted' }],
  };
  const json = canonical(snapshot);
  const hash = sha256(json);
  const snapshotId = `snap-${hash.slice(0, 16)}`;
  getDb().prepare('INSERT OR IGNORE INTO attachments (id, ws, name, mime, size, sha256, data, created_at) VALUES (?,?,?,?,?,?,?,?)').run(snapshotId, ctx.ws, 'filed-return-snapshot.json', 'application/json', json.length, hash, Buffer.from(json), new Date().toISOString());
  out.push(ev(ctx, 'filing.frozen', { hash, snapshotId }, 'return'));
  (out as any).result = { ok: true, status: 'accepted', hash };
  return out;
}

// ---------- Season advance ----------

function advance(ctx: Ctx): NewEvent[] {
  const { s } = ctx;
  const P = packet();
  require(person(ctx.actorId), 'season.advance', s);
  const { item, blocked } = nextScript(s);
  if (!item) throw new Conflict('The season is over: nothing left to replay.');
  if (blocked) throw new Conflict(blocked);
  const at = item.at > ctx.at ? item.at : ctx.at;
  const out: NewEvent[] = [];
  if (item.at > s.clock) out.push({ actor: 'script', type: 'season.clock', payload: { to: item.at, reason: item.title }, at: item.at, batch: null });
  const payload: any = { item: item.id, title: item.title, kind: item.kind, refs: item.refs };
  const msgRef = item.refs.find((r) => /^msg-/.test(r));
  if (msgRef) {
    const m = P.p.client.messages.find((x: any) => x.id === msgRef);
    if (m && item.kind !== 'gate') payload.message = { id: m.id, from: m.from, to: m.to, text: m.text, refs: [], at: m.sent_at };
  }
  if (item.kind === 'payment') {
    const ours = computeOursFor(s, at);
    const frozenSummary = s.filing.frozen ? ours.summary : ours.summary;
    if (item.id === 'tl-25') {
      const bal = frozenSummary.federal.balance_due + (frozenSummary.federal.penalty || 0);
      if (bal > 0) {
        const days = Math.round((Date.parse('2026-07-20') - Date.parse('2026-04-15')) / 86400000);
        const interest = Math.round(bal * P.p.post_filing_rates.irs_underpayment_interest_rate_annual * days / 365);
        const ftp = Math.round(bal * P.p.post_filing_rates.irs_failure_to_pay_penalty_per_month * Math.ceil(days / 30.4));
        payload.payment = { jurisdiction: 'federal', amount: bal, date: '2026-07-20', kind: 'balance_due', note: `Paid after 2026-04-15: estimated interest ${interest} (7%, ${days} days) and failure-to-pay penalty ${ftp} (0.5%/month); the IRS computes the final amounts (transcript 2026-08-03). Consider first-time abatement for the penalty.` };
      } else payload.note = `No federal balance due on the return as filed (overpayment ${-bal}); the scripted direct debit does not apply — a refund is expected instead.`;
    } else {
      const bal = frozenSummary.california.balance_due;
      if (bal < 0) payload.payment = { jurisdiction: 'california', amount: bal, date: '2026-08-21', kind: 'refund', note: `Overpayment ${-bal} refunded by direct deposit.` };
      else payload.note = `California balance due ${bal} on the return as filed: no refund to issue.`;
    }
  }
  if (item.kind === 'notice') payload.notice = P.p.tax_agency_records.notices.find((n: any) => n.document === 'D72')?.id ?? 'N-2025-L566';
  if (item.kind === 'gate') payload.satisfied = true;
  out.push({ actor: 'script', type: 'season.scripted', subject: item.id, payload, at, batch: null });
  (out as any).result = { ok: true, item, note: payload.note };
  return out;
}

export function attach(ws: string, actorId: string, body: { name: string; mime: string; dataBase64: string; targets: string[]; note?: string }) {
  const s = stateFor(ws);
  const viewer = person(actorId);
  if (!viewer) throw new Forbidden('Choose a person first.');
  if (viewer.kind === 'staff') require(viewer, 'staff.write', s);
  const buf = Buffer.from(body.dataBase64 || '', 'base64');
  if (!buf.length) throw new BadRequest('Empty file.');
  if (buf.length > 8 * 1024 * 1024) throw new BadRequest('Files are limited to 8 MB here.');
  const hash = sha256(buf.toString('binary'));
  const id = `att-${hash.slice(0, 12)}`;
  getDb().prepare('INSERT OR IGNORE INTO attachments (id, ws, name, mime, size, sha256, data, created_at) VALUES (?,?,?,?,?,?,?,?)').run(id, ws, body.name, body.mime || 'application/octet-stream', buf.length, hash, buf, new Date().toISOString());
  append(ws, { actor: actorId, type: 'evidence.attached', subject: id, payload: { attachmentId: id, name: body.name, mime: body.mime, size: buf.length, sha256: hash, targets: body.targets || [], note: body.note || '' }, at: seasonNow(s) });
  invalidateViews(ws);
  return { ok: true, id, sha256: hash };
}

/** Ids count every event of a type, including undone ones, so an id is never reused. */
function countOf(s: State, type: string): number {
  return s.events.filter((e) => e.type === type).length;
}
