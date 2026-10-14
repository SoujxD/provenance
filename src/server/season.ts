// The season clock. The workpaper opens on 2026-06-23 (v3 is the current return, per the packet
// README). Packet timeline events after that are scripted: "Advance" plays the next one. Events
// that are really workpaper actions (client approval, e-file) are gates: the scenario cannot pass
// them until the action has happened in the app, under the firm's rules.
import { packet } from './packet.ts';
import type { State } from './state.ts';
import { SEASON_START } from './state.ts';

export type ScriptItem = {
  id: string;
  at: string;
  title: string;
  kind: 'message' | 'document' | 'gate' | 'payment' | 'agency' | 'staff' | 'rollforward' | 'notice';
  gate?: 'client_approval' | 'efile_federal' | 'efile_accepted_federal' | 'efile_accepted_california';
  refs: string[];
  detail?: string | null;
};

export function scriptItems(): ScriptItem[] {
  const P = packet();
  const items: ScriptItem[] = [];
  for (const t of P.p.timeline) {
    if (t.at <= SEASON_START) continue;
    const base = { id: t.id, at: t.at, refs: t.refs, detail: t.detail };
    switch (t.event) {
      case 'client_message': {
        const m = P.p.client.messages.find((x: any) => x.id === t.refs[0]);
        items.push({ ...base, kind: 'message', title: `Client message: "${m?.text.slice(0, 70)}…"` });
        break;
      }
      case 'client_approved_and_signed_8879':
        items.push({ ...base, kind: 'gate', gate: 'client_approval', title: 'Client approves the return and signs Form 8879 / FTB 8879' });
        break;
      case 'efile_rejected':
        items.push({ ...base, kind: 'gate', gate: 'efile_federal', title: 'Federal e-file transmitted (in the packet: rejected R0000-504-02)' });
        break;
      case 'document_received':
        items.push({ ...base, kind: 'document', title: `Document received: ${t.refs.filter((r: string) => /^D\d+/.test(r)).map((r: string) => `${r} ${P.docs.get(r)?.title}`).join(', ')}` });
        break;
      case 'efile_accepted_federal':
        items.push({ ...base, kind: 'gate', gate: 'efile_accepted_federal', title: 'Federal return accepted' });
        break;
      case 'efile_accepted_california':
        items.push({ ...base, kind: 'gate', gate: 'efile_accepted_california', title: 'California return accepted' });
        break;
      case 'federal_balance_paid':
        items.push({ ...base, kind: 'payment', title: 'Federal balance due paid by direct debit (after April 15: interest and failure-to-pay penalty)' });
        items.push({ id: 'agency-2026-08-03', at: '2026-08-03T12:00:00Z', kind: 'agency', refs: ['agency:/irs_account_transcript_2025/1'], title: 'IRS account transcript updated (return posted, interest and penalty assessed)' });
        break;
      case 'california_refund_issued':
        items.push({ ...base, kind: 'payment', title: 'California overpayment refunded by direct deposit' });
        break;
      case 'quality_review_selected_return':
        items.push({ ...base, kind: 'staff', title: 'Quality reviewer (Sam Adeyemi) selects this return for review' });
        break;
      case 'next_year_engagement_started':
        items.push({ ...base, kind: 'rollforward', title: '2026 engagement started: next preparer rolls the file forward' });
        break;
      case 'notice_received':
        items.push({ ...base, kind: 'notice', title: 'IRS Letter 566 received: examination of the 2025 return' });
        break;
      default:
        items.push({ ...base, kind: 'agency', title: t.event.replace(/_/g, ' ') });
    }
  }
  return items.sort((a, b) => a.at.localeCompare(b.at));
}

export function gateMet(s: State, gate: ScriptItem['gate']): boolean {
  const subs = s.filing.submissions;
  switch (gate) {
    case 'client_approval':
      return !!s.filing.clientApproval;
    case 'efile_federal':
      return subs.some((x) => x.jurisdiction === 'federal');
    case 'efile_accepted_federal':
      return subs.some((x) => x.jurisdiction === 'federal' && x.status === 'accepted');
    case 'efile_accepted_california':
      return subs.some((x) => x.jurisdiction === 'california' && x.status === 'accepted');
    default:
      return true;
  }
}

export function nextScript(s: State): { item: ScriptItem | null; blocked: string | null } {
  const item = scriptItems().find((i) => !s.scriptApplied.has(i.id)) ?? null;
  if (!item) return { item: null, blocked: null };
  if (item.kind === 'gate' && !gateMet(s, item.gate)) {
    const why: Record<string, string> = {
      client_approval: 'Waiting for the client to approve the return and sign Form 8879 in the client portal (the partner must first send it for approval).',
      efile_federal: 'Waiting for the partner to transmit the e-file from Filing.',
      efile_accepted_federal: 'Waiting for a federal acceptance: fix any rejection and retransmit.',
      efile_accepted_california: 'Waiting for California acceptance.',
    };
    return { item, blocked: why[item.gate!] };
  }
  return { item, blocked: null };
}

/** Season "now": the clock plus wall time worked since it was set, capped before the next scripted event. */
export function seasonNow(s: State): string {
  const elapsed = Math.max(0, Date.now() - Date.parse(s.clockWall));
  let t = Date.parse(s.clock) + elapsed;
  const next = scriptItems().find((i) => !s.scriptApplied.has(i.id));
  if (next) t = Math.min(t, Date.parse(next.at) - 60_000);
  return new Date(Math.max(t, Date.parse(s.clock))).toISOString();
}
