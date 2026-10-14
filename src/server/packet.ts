// Loads the packet exactly as delivered (never modified, never re-serialized to disk) and builds
// read-only indexes over it. The sha256 of the raw bytes is recorded in the event log at genesis,
// so anyone can prove which packet a workpaper was built from.
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import type { ExtractedValue, PacketDocument, ReturnLine, ReturnVersion } from '../shared/types.ts';
import type { SensitiveValue } from '../shared/mask.ts';

export type RefInfo = {
  ref: string;
  kind: string;
  title: string;
  value?: unknown;
  documentId?: string;
  page?: number;
  text?: string;
  at?: string; // when this piece of evidence became available (season time)
};

export class PacketIndex {
  raw: string;
  sha256: string;
  p: any;
  docs = new Map<string, PacketDocument>();
  ev = new Map<string, ExtractedValue>();
  evByDoc = new Map<string, ExtractedValue[]>();
  versions = new Map<string, ReturnVersion>();
  lines = new Map<string, Map<string, ReturnLine>>(); // version -> key -> line
  people = new Map<string, any>();
  sensitive: SensitiveValue[] = [];
  /** ref -> line keys (any version) that cite it as a source */
  citedBy = new Map<string, { version: string; key: string }[]>();

  constructor(path?: string) {
    const candidates = [
      path,
      process.env.PACKET_PATH,
      resolve('okafor_lindqvist_2025_packet.json'),
      resolve('data/packet.json'),
    ].filter(Boolean) as string[];
    const file = candidates.find((c) => existsSync(c));
    if (!file) throw new Error('Packet JSON not found. Set PACKET_PATH or place okafor_lindqvist_2025_packet.json in the working directory.');
    this.raw = readFileSync(file, 'utf8');
    this.sha256 = createHash('sha256').update(this.raw).digest('hex');
    this.p = JSON.parse(this.raw);
    this.build();
  }

  private build() {
    const p = this.p;
    for (const d of p.documents as PacketDocument[]) this.docs.set(d.id, d);
    for (const e of p.extracted_values as ExtractedValue[]) {
      this.ev.set(e.id, e);
      if (!this.evByDoc.has(e.document_id)) this.evByDoc.set(e.document_id, []);
      this.evByDoc.get(e.document_id)!.push(e);
    }
    for (const v of p.return_versions as ReturnVersion[]) {
      this.versions.set(v.version, v);
      const m = new Map<string, ReturnLine>();
      for (const l of v.lines) {
        m.set(l.key, l);
        for (const s of l.sources || []) {
          if (!this.citedBy.has(s)) this.citedBy.set(s, []);
          this.citedBy.get(s)!.push({ version: v.version, key: l.key });
        }
      }
      this.lines.set(v.version, m);
    }
    for (const person of p.household.people) this.people.set(person.id, person);
    this.collectSensitive();
  }

  private collectSensitive() {
    const out: SensitiveValue[] = [];
    const add = (value: unknown, kind: SensitiveValue['kind'], ref: string) => {
      if (typeof value !== 'string' || !value || out.some((x) => x.value === value)) return;
      out.push({ value, kind, ref });
    };
    for (const person of this.p.household.people) {
      add(person.ssn, 'ssn', `household:${person.id}.ssn`);
      if (person.ip_pin) add(person.ip_pin, 'pin', `household:${person.id}.ip_pin`);
    }
    const bank = this.p.household.bank_account_for_refund_or_payment;
    add(bank.account, 'account', 'household:bank.account');
    add(bank.routing, 'account', 'household:bank.routing');
    for (const e of this.ev.values()) {
      if (e.value_type === 'ssn') add(String(e.value), 'ssn', e.id);
      if (e.value_type === 'account_number') add(String(e.value), String(e.value).match(/^[A-Z]{2}\d{2}/) ? 'iban' : 'account', e.id);
      if (e.field === 'ip_pin') add(String(e.value), 'pin', e.id);
    }
    // Numbers that only appear in printed text: license numbers and signature PINs.
    for (const d of this.docs.values()) {
      for (const pg of d.pages) {
        for (const m of pg.printed_content.matchAll(/license no\. (\d{6,})/g)) add(m[1], 'license', `${d.id}#page${pg.page}`);
        for (const m of pg.printed_content.matchAll(/\b(SE\d{2}(?: \d{4}){5})\b/g)) add(m[1], 'iban', `${d.id}#page${pg.page}`);
      }
    }
    for (const t of this.p.timeline) {
      if (typeof t.detail === 'string') for (const m of t.detail.matchAll(/PIN (\d{5})/g)) add(m[1], 'pin', `timeline:${t.id}`);
    }
    add(this.p.firm.firm_identity.ero_pin, 'pin', 'firm:ero_pin');
    this.sensitive = out;
  }

  get household() {
    return this.p.household;
  }
  get firm() {
    return this.p.firm;
  }
  versionList(): ReturnVersion[] {
    return this.p.return_versions;
  }
  line(version: string, key: string): ReturnLine | undefined {
    return this.lines.get(version)?.get(key);
  }

  /** Resolve a json pointer inside prior_years (py:) or tax_agency_records (agency:). */
  pointer(root: any, ptr: string): unknown {
    const parts = ptr.replace(/^\//, '').split('/').filter((x) => x !== '').map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'));
    let cur = root;
    for (const part of parts) {
      if (cur == null) return undefined;
      cur = cur[part];
    }
    return cur;
  }

  /** Describe any reference string used in the packet or in workpaper events. */
  resolveRef(ref: string): RefInfo {
    const p = this.p;
    if (/^ev-\d+$/.test(ref)) {
      const e = this.ev.get(ref);
      if (!e) return { ref, kind: 'missing', title: ref };
      const d = this.docs.get(e.document_id)!;
      return { ref, kind: 'extracted_value', title: `${e.label} (${d.title})`, value: e.value, documentId: e.document_id, page: e.page, at: d.received_at };
    }
    if (/^D\d{2}$/.test(ref)) {
      const d = this.docs.get(ref);
      return d ? { ref, kind: 'document', title: d.title, documentId: d.id, at: d.received_at } : { ref, kind: 'missing', title: ref };
    }
    let m = ref.match(/^doc:(D\d{2})#page(\d+)$/) || ref.match(/^(D\d{2})#page(\d+)$/);
    if (m) {
      const d = this.docs.get(m[1]);
      return { ref, kind: 'page', title: `${d?.title ?? m[1]}, page ${m[2]}`, documentId: m[1], page: Number(m[2]), at: d?.received_at, text: d?.pages.find((x) => x.page === Number(m![2]))?.printed_content };
    }
    if (/^qa-\d+$/.test(ref)) {
      const q = p.client.questionnaire.find((x: any) => x.id === ref);
      return { ref, kind: 'questionnaire', title: q ? `Questionnaire: ${q.question}` : ref, value: q?.answer, text: q ? `${q.answer} — ${q.answered_by}` : undefined, at: q?.answered_at };
    }
    if (/^msg-\d+$/.test(ref)) {
      const q = p.client.messages.find((x: any) => x.id === ref);
      return { ref, kind: 'message', title: q ? `Message from ${q.from}` : ref, text: q?.text, at: q?.sent_at };
    }
    if (/^call-\d+$/.test(ref)) {
      const q = p.client.call_notes.find((x: any) => x.id === ref);
      return { ref, kind: 'call_note', title: q ? `Call notes ${q.date.slice(0, 10)} (${q.participants.join(', ')})` : ref, text: q?.notes.join('\n'), at: q?.date };
    }
    if (ref.startsWith('py:')) {
      const v = this.pointer(p.prior_years, ref.slice(3));
      return { ref, kind: 'prior_year', title: `Prior-year record ${ref.slice(3)}`, value: v, at: '2026-01-21T03:20:00Z' };
    }
    if (ref.startsWith('agency:')) {
      const v = this.pointer(p.tax_agency_records, ref.slice(7));
      return { ref, kind: 'agency', title: `Tax agency record ${ref.slice(7)}`, value: v };
    }
    if (ref.startsWith('asset:')) {
      const id = ref.slice(6);
      const a = p.return_versions[2].assets.find((x: any) => x.asset_id === id) || p.prior_years.asset_records.find((x: any) => x.asset_id === id);
      return { ref, kind: 'asset', title: a ? `Asset ${id}: ${a.description}` : ref, value: a };
    }
    if (ref.startsWith('household:')) {
      const person = this.people.get(ref.slice(10).split('.')[0]);
      return { ref, kind: 'household', title: person ? `Household: ${person.name} (${person.role})` : ref, value: person, at: p.household.entered_by ? '2026-01-20T04:00:00Z' : undefined };
    }
    if (ref.startsWith('ref:param.')) {
      const name = ref.slice(10);
      return { ref, kind: 'parameter', title: `Engine parameter ${name}`, value: p.engine_reference.parameters[name] };
    }
    if (ref.startsWith('ref:fx.')) {
      const [, cur, rate] = ref.split('.');
      return { ref, kind: 'parameter', title: `Exchange rate ${cur} ${rate.replace('_', ' ')}`, value: p.engine_reference.parameters.fx?.[cur]?.[rate] };
    }
    if (ref.startsWith('timeline:')) {
      const t = p.timeline.find((x: any) => x.id === ref.slice(9));
      return { ref, kind: 'timeline', title: t ? `Timeline: ${t.event.replace(/_/g, ' ')}` : ref, text: t?.detail ?? undefined, at: t?.at };
    }
    if (ref.startsWith('line:')) return { ref, kind: 'line', title: ref.slice(5) };
    if (/^v\d$/.test(ref)) return { ref, kind: 'version', title: `Engine version ${ref}`, at: this.versions.get(ref)?.computed_at };
    return { ref, kind: 'other', title: ref };
  }

  /** When a reference became available in season time (documents by received_at, messages by sent_at...). */
  availableAt(ref: string): string | undefined {
    return this.resolveRef(ref).at;
  }
}

let singleton: PacketIndex | null = null;
export function packet(): PacketIndex {
  if (!singleton) singleton = new PacketIndex();
  return singleton;
}
