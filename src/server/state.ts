// Folds the event log into workpaper state. Pure function of (events, asOf): replaying the log
// up to any moment reproduces exactly what the workpaper looked like then.
// Undo is an event ("batch.undone") that tells the fold to ignore a batch; nothing is deleted.
import type { WEvent, Adjustment, FindingStatus } from '../shared/types.ts';

export const SEASON_START = '2026-06-23T09:00:00Z';

export type HumanFinding = {
  status: FindingStatus;
  owner: string | null;
  history: { at: string; actor: string; what: string; seq: number }[];
  resolution: { note: string; authority?: string; adjustments?: string[]; at: string; actor: string } | null;
};

export type Question = {
  id: string;
  from: string;
  to: string; // 'client' or a staff id
  text: string;
  refs: string[];
  findingIds: string[];
  required: boolean;
  at: string;
  answers: { id: string; by: string; at: string; text: string; attachments: string[] }[];
  status: 'open' | 'answered' | 'closed';
};

export type ReviewNote = { id: string; by: string; at: string; target: string; text: string; blocking: boolean; to: string | null; area: string };

export type Signoff = { id: string; scope: string; level: string; actor: string; at: string; hash: string; snapshot: any; seq: number; withdrawn?: boolean; reopenedAt?: string };

export type State = {
  ws: string;
  head: { seq: number; hash: string };
  clock: string;
  clockWall: string; // wall time when the clock was last set
  packetSha256: string;
  scriptApplied: Set<string>;
  findings: Map<string, HumanFinding>;
  reviewNotes: Map<string, ReviewNote>;
  questions: Map<string, Question>;
  adjustments: Map<string, Adjustment>;
  verifications: { id: string; target: string; type: string; actor: string; at: string; note: string; refs: string[]; seq: number }[];
  notes: { id: string; target: string; text: string; actor: string; at: string; seq: number }[];
  signoffs: Signoff[];
  judgments: { id: string; kind: string; title: string; decision: string; authority: string; refs: string[]; findingIds: string[]; actor: string; at: string }[];
  dueDiligence: Map<string, { answers: Record<string, string>; evidence: string[]; actor: string; at: string }>;
  areaStatus: Map<string, { status: string; note: string; actor: string; at: string }>;
  steps: Map<string, { note: string; refs: string[]; actor: string; at: string }>;
  assignments: Map<string, { preparer?: string; reviewer?: string; partner?: string; due?: string }>;
  time: { area: string; hours: number; note: string; actor: string; at: string }[];
  standards: any;
  standardsHistory: { path: string; before: any; after: any; note: string; actor: string; at: string }[];
  unmaskLog: { ref: string; kind: string; purpose: string; actor: string; at: string; recorded_at: string }[];
  seen: Map<string, number>;
  notifRead: Map<string, number>;
  attachments: { id: string; name: string; mime: string; size: number; sha256: string; targets: string[]; note: string; actor: string; at: string }[];
  links: { from: string; to: string; relation: string; note: string; actor: string; at: string }[];
  messages: { id: string; from: string; to: string; text: string; refs: string[]; at: string; source: 'packet' | 'app' }[];
  filing: {
    approvalRequested?: { at: string; actor: string; hash: string; summary: any };
    clientApproval?: { at: string; actor: string; hash: string; pinMasked: string };
    submissions: { id: string; jurisdiction: string; at: string; actor: string; status: string; errors: any[]; payloadHash: string }[];
    frozen?: { at: string; hash: string; snapshotId: string; actor: string };
    clientCopy?: { at: string; hash: string };
  };
  amendments: { id: string; reason: string; at: string; actor: string; status: 'open' | 'filed' }[];
  payments: { jurisdiction: string; amount: number; date: string; kind: string; note: string; at: string }[];
  notices: { id: string; at: string }[];
  binders: { noticeId: string; hash: string; at: string; actor: string }[];
  rollforward?: { at: string; actor: string; hash: string; pkg: any };
  undoneBatches: Set<string>;
  batches: Map<string, { actor: string; at: string; label: string; count: number; undone: boolean }>;
  events: WEvent[];
};

export function emptyState(ws: string, standards: any): State {
  return {
    ws,
    head: { seq: 0, hash: 'genesis' },
    clock: SEASON_START,
    clockWall: new Date().toISOString(),
    packetSha256: '',
    scriptApplied: new Set(),
    findings: new Map(),
    reviewNotes: new Map(),
    questions: new Map(),
    adjustments: new Map(),
    verifications: [],
    notes: [],
    signoffs: [],
    judgments: [],
    dueDiligence: new Map(),
    areaStatus: new Map(),
    steps: new Map(),
    assignments: new Map(),
    time: [],
    standards: structuredClone(standards),
    standardsHistory: [],
    unmaskLog: [],
    seen: new Map(),
    notifRead: new Map(),
    attachments: [],
    links: [],
    messages: [],
    filing: { submissions: [] },
    amendments: [],
    payments: [],
    notices: [],
    binders: [],
    undoneBatches: new Set(),
    batches: new Map(),
    events: [],
  };
}

function human(s: State, id: string): HumanFinding {
  let h = s.findings.get(id);
  if (!h) {
    h = { status: 'open', owner: null, history: [], resolution: null };
    s.findings.set(id, h);
  }
  return h;
}

function setPath(obj: any, path: string, value: any) {
  const parts = path.split('.');
  let cur = obj;
  for (const p of parts.slice(0, -1)) {
    if (cur[p] == null) cur[p] = {};
    cur = cur[p];
  }
  cur[parts.at(-1)!] = value;
}

export function fold(ws: string, events: WEvent[], standards: any, asOf?: string): State {
  const s = emptyState(ws, standards);
  // First pass: which batches are undone (an undo can only refer to earlier events, but the
  // undo itself must be within asOf to count).
  for (const e of events) {
    if (asOf && e.at > asOf) break;
    if (e.type === 'batch.undone') s.undoneBatches.add(e.payload.batch);
    if (e.type === 'batch.redone') s.undoneBatches.delete(e.payload.batch);
  }
  for (const e of events) {
    if (asOf && e.at > asOf) break;
    s.events.push(e);
    s.head = { seq: e.seq, hash: e.hash };
    if (e.batch) {
      const b = s.batches.get(e.batch) || { actor: e.actor, at: e.at, label: e.payload?.batchLabel || e.type, count: 0, undone: s.undoneBatches.has(e.batch) };
      b.count++;
      s.batches.set(e.batch, b);
      if (s.undoneBatches.has(e.batch)) continue;
    }
    apply(s, e);
  }
  return s;
}

function apply(s: State, e: WEvent) {
  const p = e.payload || {};
  const who = e.actor;
  switch (e.type) {
    case 'workspace.created':
      s.packetSha256 = p.packetSha256;
      break;
    case 'season.clock':
      s.clock = p.to;
      s.clockWall = e.recorded_at;
      break;
    case 'season.scripted':
      s.scriptApplied.add(p.item);
      if (p.message) s.messages.push({ ...p.message, source: 'packet' });
      if (p.payment) s.payments.push({ ...p.payment, at: e.at });
      if (p.notice) s.notices.push({ id: p.notice, at: e.at });
      break;
    case 'finding.status': {
      const h = human(s, p.findingId);
      h.status = p.status;
      if (p.status === 'open') h.resolution = null;
      h.history.push({ at: e.at, actor: who, what: `status → ${p.status}${p.note ? `: ${p.note}` : ''}`, seq: e.seq });
      break;
    }
    case 'finding.assigned': {
      const h = human(s, p.findingId);
      h.owner = p.owner;
      h.history.push({ at: e.at, actor: who, what: `assigned to ${p.owner ?? 'nobody'}`, seq: e.seq });
      break;
    }
    case 'finding.resolved': {
      const h = human(s, p.findingId);
      h.status = p.status === 'no_change' ? 'no_change' : 'resolved';
      h.resolution = { note: p.note, authority: p.authority, adjustments: p.adjustments, at: e.at, actor: who };
      h.history.push({ at: e.at, actor: who, what: `${h.status === 'no_change' ? 'closed, no change' : 'resolved'}: ${p.note}`, seq: e.seq });
      break;
    }
    case 'review_note.created':
      s.reviewNotes.set(p.id, { id: p.id, by: who, at: e.at, target: p.target, text: p.text, blocking: !!p.blocking, to: p.to ?? null, area: p.area });
      human(s, p.id).owner = p.to ?? null;
      break;
    case 'question.asked':
      s.questions.set(p.id, { id: p.id, from: who, to: p.to, text: p.text, refs: p.refs || [], findingIds: p.findingIds || [], required: !!p.required, at: e.at, answers: [], status: 'open' });
      for (const fid of p.findingIds || []) {
        const h = human(s, fid);
        if (h.status === 'open') h.status = p.to === 'client' ? 'waiting_client' : 'in_progress';
        h.history.push({ at: e.at, actor: who, what: `question ${p.id} sent to ${p.to}`, seq: e.seq });
      }
      break;
    case 'question.answered': {
      const q = s.questions.get(p.id);
      if (!q) break;
      q.answers.push({ id: `${p.id}/a${q.answers.length + 1}`, by: who, at: e.at, text: p.text, attachments: p.attachments || [] });
      q.status = 'answered';
      for (const fid of q.findingIds) {
        const h = human(s, fid);
        if (h.status === 'waiting_client') h.status = 'in_progress';
        h.history.push({ at: e.at, actor: who, what: `answer received (${p.id}) — now evidence`, seq: e.seq });
      }
      break;
    }
    case 'question.closed': {
      const q = s.questions.get(p.id);
      if (q) q.status = 'closed';
      break;
    }
    case 'adjustment.created': {
      const a: Adjustment = {
        id: p.id, title: p.title, changes: p.changes, reason: p.reason, authority: p.authority, judgment: !!p.judgment, whatIf: p.whatIf,
        findingIds: p.findingIds || [], amendmentId: p.amendmentId, effect: p.effect || { fed: 0, ca: 0, method: 'none', estimate: false },
        status: 'pending', needs: p.needs || 'reviewer', createdBy: who, createdAt: e.at, batch: e.batch, layer: p.layer || 'return',
      };
      s.adjustments.set(a.id, a);
      for (const fid of a.findingIds) {
        const h = human(s, fid);
        if (!['resolved', 'no_change'].includes(h.status)) h.status = 'in_progress';
        h.history.push({ at: e.at, actor: who, what: `adjustment ${a.id} proposed: ${a.changes.map((c) => `${c.target} → ${c.value}`).join(', ')}`, seq: e.seq });
      }
      break;
    }
    case 'adjustment.approved': {
      const a = s.adjustments.get(p.id);
      if (!a || a.status !== 'pending') break;
      a.status = 'approved';
      a.approvedBy = who;
      a.approvedAt = e.at;
      for (const fid of a.findingIds) {
        const h = human(s, fid);
        const allApproved = [...s.adjustments.values()].filter((x) => x.findingIds.includes(fid) && x.status !== 'rejected' && x.status !== 'reverted').every((x) => x.status === 'approved');
        if (allApproved && !['resolved', 'no_change'].includes(h.status)) {
          h.status = 'resolved';
          h.resolution = { note: `Adjusted: ${a.reason}`, authority: a.authority, adjustments: [a.id], at: e.at, actor: who };
        }
        h.history.push({ at: e.at, actor: who, what: `adjustment ${a.id} approved`, seq: e.seq });
      }
      break;
    }
    case 'adjustment.rejected':
    case 'adjustment.reverted': {
      const a = s.adjustments.get(p.id);
      if (!a) break;
      a.status = e.type === 'adjustment.rejected' ? 'rejected' : 'reverted';
      for (const fid of a.findingIds) {
        const h = human(s, fid);
        if (h.status === 'resolved' && h.resolution?.adjustments?.includes(a.id)) { h.status = 'in_progress'; h.resolution = null; }
        h.history.push({ at: e.at, actor: who, what: `adjustment ${a.id} ${a.status}${p.note ? `: ${p.note}` : ''}`, seq: e.seq });
      }
      break;
    }
    case 'verification.recorded':
      s.verifications.push({ id: p.id || e.id, target: p.target, type: p.type, actor: who, at: e.at, note: p.note || '', refs: p.refs || [], seq: e.seq });
      break;
    case 'note.added':
      s.notes.push({ id: e.id, target: p.target, text: p.text, actor: who, at: e.at, seq: e.seq });
      break;
    case 'signoff.recorded':
      s.signoffs.push({ id: p.id, scope: p.scope, level: p.level, actor: who, at: e.at, hash: p.hash, snapshot: p.snapshot, seq: e.seq });
      break;
    case 'signoff.reopened': {
      const so = s.signoffs.find((x) => x.id === p.signoffId);
      if (so) so.reopenedAt = e.at;
      break;
    }
    case 'signoff.withdrawn': {
      const so = s.signoffs.find((x) => x.id === p.signoffId);
      if (so) so.withdrawn = true;
      break;
    }
    case 'judgment.recorded':
      s.judgments.push({ id: p.id, kind: p.kind, title: p.title, decision: p.decision, authority: p.authority, refs: p.refs || [], findingIds: p.findingIds || [], actor: who, at: e.at });
      for (const fid of p.findingIds || []) {
        const h = human(s, fid);
        h.history.push({ at: e.at, actor: who, what: `judgment recorded: ${p.decision}`, seq: e.seq });
      }
      break;
    case 'due_diligence.recorded':
      s.dueDiligence.set(p.credit, { answers: p.answers, evidence: p.evidence || [], actor: who, at: e.at });
      break;
    case 'area.status':
      s.areaStatus.set(p.area, { status: p.status, note: p.note || '', actor: who, at: e.at });
      break;
    case 'step.completed':
      s.steps.set(p.step, { note: p.note || '', refs: p.refs || [], actor: who, at: e.at });
      break;
    case 'step.reopened':
      s.steps.delete(p.step);
      break;
    case 'assignment.set': {
      const a = s.assignments.get(p.area) || {};
      if (p.role) (a as any)[p.role] = p.user;
      if (p.due !== undefined) a.due = p.due;
      s.assignments.set(p.area, a);
      break;
    }
    case 'time.logged':
      s.time.push({ area: p.area, hours: Number(p.hours), note: p.note || '', actor: who, at: e.at });
      break;
    case 'standards.updated': {
      setPath(s.standards, p.path, p.after);
      s.standardsHistory.push({ path: p.path, before: p.before, after: p.after, note: p.note || '', actor: who, at: e.at });
      break;
    }
    case 'unmask.viewed':
      s.unmaskLog.push({ ref: p.ref, kind: p.kind, purpose: p.purpose || '', actor: who, at: e.at, recorded_at: e.recorded_at });
      break;
    case 'seen.marked':
      s.seen.set(who, e.seq);
      break;
    case 'notifications.read':
      s.notifRead.set(who, p.upTo ?? e.seq);
      break;
    case 'evidence.attached':
      s.attachments.push({ id: p.attachmentId, name: p.name, mime: p.mime, size: p.size, sha256: p.sha256, targets: p.targets || [], note: p.note || '', actor: who, at: e.at });
      break;
    case 'link.created':
      s.links.push({ from: p.from, to: p.to, relation: p.relation, note: p.note || '', actor: who, at: e.at });
      break;
    case 'message.sent':
      s.messages.push({ id: p.id, from: who, to: p.to, text: p.text, refs: p.refs || [], at: e.at, source: 'app' });
      break;
    case 'filing.approval_requested':
      s.filing.approvalRequested = { at: e.at, actor: who, hash: p.hash, summary: p.summary };
      s.filing.clientApproval = undefined;
      break;
    case 'filing.client_approved':
      s.filing.clientApproval = { at: e.at, actor: who, hash: p.hash, pinMasked: p.pinMasked };
      break;
    case 'filing.transmitted':
      s.filing.submissions.push({ id: p.submissionId, jurisdiction: p.jurisdiction, at: e.at, actor: who, status: 'transmitted', errors: [], payloadHash: p.payloadHash });
      break;
    case 'filing.result': {
      const sub = s.filing.submissions.find((x) => x.id === p.submissionId);
      if (sub) { sub.status = p.status; sub.errors = p.errors || []; }
      break;
    }
    case 'filing.frozen':
      s.filing.frozen = { at: e.at, hash: p.hash, snapshotId: p.snapshotId, actor: who };
      break;
    case 'filing.client_copy':
      s.filing.clientCopy = { at: e.at, hash: p.hash };
      break;
    case 'amendment.opened':
      s.amendments.push({ id: p.id, reason: p.reason, at: e.at, actor: who, status: 'open' });
      break;
    case 'amendment.filed': {
      const a = s.amendments.find((x) => x.id === p.id);
      if (a) a.status = 'filed';
      break;
    }
    case 'payment.recorded':
      s.payments.push({ jurisdiction: p.jurisdiction, amount: p.amount, date: p.date, kind: p.kind, note: p.note || '', at: e.at });
      break;
    case 'notice.binder_generated':
      s.binders.push({ noticeId: p.noticeId, hash: p.hash, at: e.at, actor: who });
      break;
    case 'rollforward.started':
      s.rollforward = { at: e.at, actor: who, hash: p.hash, pkg: p.pkg };
      break;
    default:
      break;
  }
}
