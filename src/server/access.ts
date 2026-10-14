// People and enforced roles. Identity comes from the role switcher (x-actor header): a demo
// stand-in for SSO. Every rule below is enforced on the server, never only hidden in the UI.
import { packet } from './packet.ts';
import type { State } from './state.ts';

export type Person = {
  id: string;
  name: string;
  role: string;
  credential: string | null;
  cleared: boolean;
  activeFrom: string | null;
  kind: 'staff' | 'client';
  note?: string;
};

export function people(): Person[] {
  const P = packet();
  const staff = P.firm.staff.map((s: any) => ({ id: s.id, name: s.name, role: s.role, credential: s.credential, cleared: !!s.sensitive_data_clearance, activeFrom: s.active_from, kind: 'staff' as const, note: s.note }));
  const clients = P.firm.client_users.map((c: any) => ({ id: c.id, name: c.name, role: 'client', credential: null, cleared: false, activeFrom: null, kind: 'client' as const }));
  return [...staff, ...clients];
}

export function person(id: string): Person | undefined {
  return people().find((p) => p.id === id);
}

export function isActive(p: Person, clock: string): boolean {
  return !p.activeFrom || p.activeFrom <= clock.slice(0, 10);
}

export class Forbidden extends Error {
  status = 403;
  rule?: string;
  constructor(message: string, rule?: string) {
    super(message);
    this.rule = rule;
  }
}

type Action =
  | 'adjustment.create' | 'adjustment.approve' | 'adjustment.revert' | 'review_note.create' | 'finding.update'
  | 'signoff.preparer' | 'signoff.reviewer' | 'signoff.partner' | 'standards.update' | 'assignment.set'
  | 'judgment.record' | 'filing.request_approval' | 'filing.transmit' | 'client.act' | 'question.ask'
  | 'unmask' | 'time.log' | 'season.advance' | 'amendment.open' | 'staff.write' | 'notice.respond' | 'rollforward';

const MATRIX: Record<Action, string[]> = {
  'adjustment.create': ['preparer', 'reviewer', 'partner'],
  'adjustment.approve': ['reviewer', 'partner'],
  'adjustment.revert': ['preparer', 'reviewer', 'partner'],
  'review_note.create': ['reviewer', 'partner', 'quality_reviewer'],
  'finding.update': ['preparer', 'reviewer', 'partner', 'quality_reviewer'],
  'signoff.preparer': ['preparer'],
  'signoff.reviewer': ['reviewer', 'partner'],
  'signoff.partner': ['partner'],
  'standards.update': ['firm_administrator'],
  'assignment.set': ['firm_administrator', 'partner'],
  'judgment.record': ['preparer', 'reviewer', 'partner'],
  'filing.request_approval': ['partner'],
  'filing.transmit': ['partner'],
  'client.act': ['client'],
  'question.ask': ['preparer', 'reviewer', 'partner', 'quality_reviewer'],
  unmask: ['preparer', 'reviewer', 'partner', 'firm_administrator', 'quality_reviewer'],
  'time.log': ['preparer', 'reviewer', 'partner', 'firm_administrator', 'quality_reviewer'],
  'season.advance': ['preparer', 'reviewer', 'partner', 'firm_administrator', 'quality_reviewer'],
  'amendment.open': ['partner'],
  'staff.write': ['preparer', 'reviewer', 'partner', 'firm_administrator', 'quality_reviewer'],
  'notice.respond': ['preparer', 'reviewer', 'partner'],
  rollforward: ['preparer', 'reviewer', 'partner'],
};

export function can(p: Person | undefined, action: Action): boolean {
  return !!p && MATRIX[action].includes(p.role);
}

export function require(p: Person | undefined, action: Action, s: State): Person {
  if (!p) throw new Forbidden('Unknown user. Choose a person in the role switcher.');
  if (!isActive(p, s.clock)) throw new Forbidden(`${p.name} is not active until ${p.activeFrom} (season date ${s.clock.slice(0, 10)}).`, 'active_from');
  if (!can(p, action)) throw new Forbidden(`${p.name} (${p.role.replace('_', ' ')}) cannot ${action.replace('.', ' ').replace('_', ' ')}.`, 'role');
  if (p.kind === 'staff' && action === 'unmask' && !p.cleared) throw new Forbidden(`${p.name} has no sensitive-data clearance; values stay masked.`, 'clearance');
  return p;
}
