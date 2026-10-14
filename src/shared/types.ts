// Types shared by the server and the client. Packet types mirror the packet README exactly;
// workpaper types describe what the event log projects into.

// ---------- Packet (as delivered) ----------
export type Position = { x0: number; y0: number; x1: number; y1: number };

export type ExtractedValue = {
  id: string;
  document_id: string;
  page: number;
  field: string;
  label: string;
  value: number | string | boolean | null;
  value_type: string;
  text_as_read: string;
  position: Position;
  confidence: number;
};

export type PacketDocument = {
  id: string;
  title: string;
  document_type: string;
  issuer: string;
  belongs_to: string;
  tax_year: number;
  received_at: string;
  uploaded_by: string;
  file_name: string;
  page_count: number;
  pages: { page: number; printed_content: string }[];
  marked_corrected?: boolean;
  extraction: { status: string; values: number; reason: string | null };
};

export type ReturnLine = {
  key: string;
  jurisdiction: 'federal' | 'california';
  form: string;
  line: string;
  label: string;
  value: number | string;
  rule: string;
  inputs: string[];
  sources: string[];
  note?: string;
};

export type Rate = { federal_per_dollar: number; california_per_dollar: number };

export type ReturnVersion = {
  version: string;
  computed_at: string;
  trigger: string;
  documents_used: string[];
  documents_superseded: string[];
  summary: {
    federal: { agi: number; taxable_income: number; total_tax: number; payments: number; balance_due: number; penalty: number };
    california: { total_agi: number; ca_agi: number; total_tax: number; payments: number; balance_due: number; penalty: number };
  };
  tax_effect_rates: Record<string, Rate>;
  carryovers_out: any;
  assets: any[];
  diagnostics: { code: string; severity: string; message: string; refs: string[] }[];
  changes_from_previous: { key: string; change: string; old?: any; new?: any }[];
  lines: ReturnLine[];
};

export type Packet = any; // the full packet is navigated dynamically; key parts are typed above

// ---------- Workpaper ----------
export type ActorId = string; // st-01..st-06, cu-01, cu-02, system, engine, script

export type WEvent = {
  seq: number;
  id: string;
  ws: string;
  at: string; // season time (scenario clock)
  recorded_at: string; // wall-clock time
  actor: ActorId;
  type: string;
  subject: string | null;
  payload: any;
  batch: string | null;
  prev_hash: string;
  hash: string;
};

export type Severity = 'blocking' | 'high' | 'medium' | 'low' | 'info';
export type FindingKind = 'error' | 'judgment' | 'outside_filing' | 'opportunity' | 'compliance' | 'info' | 'variance' | 'review_note' | 'question' | 'efile';
export type FindingSource = 'check' | 'engine' | 'variance' | 'review_note' | 'question' | 'efile';
export type FindingStatus = 'open' | 'in_progress' | 'waiting_client' | 'resolved' | 'no_change';

export type TaxEffect = {
  fed: number;
  ca: number;
  method: 'rate' | 'what_if' | 'payment' | 'none' | 'not_estimable' | 'mixed';
  estimate: boolean;
  note?: string;
};

export type ProposedChange = {
  target: string; // line key, or fact path such as household:theo.ssn
  value: number | string;
  category?: string; // tax effect category override
  caSource?: boolean; // item is fully California-source: use ca_source_income for CA
  addTo?: string; // for new lines: the total line that should include it
  label?: string;
  note?: string;
};

export type Finding = {
  id: string;
  source: FindingSource;
  rule?: string;
  kind: FindingKind;
  title: string;
  summary: string;
  detail?: string[];
  area: string;
  severity: Severity;
  blocksFiling: boolean;
  evidence: string[]; // refs: ev-, D.., qa-, msg-, call-, py:/, agency:/, line:, timeline:
  lines: string[];
  proposed?: ProposedChange[];
  whatIf?: string; // what_if alternative id backing the effect
  effect?: TaxEffect;
  detectedAt: string;
  resolvedByEngineAt?: string; // engine diagnostics that disappear in a later version
  authorityHint?: string;
  dependsOn?: string[];
  suggestedQuestion?: string;
  judgment?: boolean;
  // projected human state
  status?: FindingStatus;
  owner?: string | null;
  history?: { at: string; actor: string; what: string }[];
  resolution?: { note: string; authority?: string; adjustments?: string[]; at: string; actor: string } | null;
  cleared?: boolean; // the condition no longer holds on our version of the return
};

export type AdjustmentChange = {
  target: string;
  original: number | string | null;
  value: number | string;
  label?: string;
  addTo?: string;
  caSource?: boolean;
  category?: string;
};

export type Adjustment = {
  id: string;
  title: string;
  changes: AdjustmentChange[];
  reason: string;
  authority?: string;
  judgment?: boolean;
  whatIf?: string;
  findingIds: string[];
  amendmentId?: string;
  effect: TaxEffect;
  status: 'pending' | 'approved' | 'rejected' | 'reverted';
  needs: 'reviewer' | 'partner';
  createdBy: string;
  createdAt: string;
  approvedBy?: string;
  approvedAt?: string;
  batch?: string | null;
  layer: 'return' | 'amendment';
};

export const AREAS: { id: string; name: string; budgetKey?: string; forms: RegExp }[] = [
  { id: 'intake', name: 'Intake, identity & household', budgetKey: 'intake_and_engagement', forms: /^(household|F8867)/ },
  { id: 'wages', name: 'Wages & stock compensation', budgetKey: 'wages_and_stock_compensation', forms: /^(F1040\.1|F8959|Sch3\.11)/ },
  { id: 'investments', name: 'Investments & digital assets', budgetKey: 'investments_and_digital_assets', forms: /^(SchB|F8949|SchD|F1040\.(2|3|7)|F8960|Sch3\.1$|F6251\.8)/ },
  { id: 'business', name: 'Schedule C business', budgetKey: 'business', forms: /^(SchC|SchSE|F4562-C|F8995|F1040\.13|Sch1\.(3|15|16|17))/ },
  { id: 'rentals', name: 'Rentals, passive & Form 4797', budgetKey: 'rentals_and_sale', forms: /^(SchE\.(1|2|3|9|11|12|14|16|18|19|20|21|22|26)|F4562-E|F4797|F8582)/ },
  { id: 'passthroughs', name: 'S corporation & partnership', budgetKey: 'pass_throughs_and_basis', forms: /^(F7203|SchE\.(28|32|41)|Sch1\.5)/ },
  { id: 'retirement', name: 'Retirement, IRA & HSA', budgetKey: 'deductions_and_credits', forms: /^(F8606|F8889|F1040\.4|Sch1\.13)/ },
  { id: 'foreign', name: 'Foreign accounts & reporting', budgetKey: 'investments_and_digital_assets', forms: /^(F8938|SchB\.7|SchB\.8)/ },
  { id: 'deductions', name: 'Deductions & credits', budgetKey: 'deductions_and_credits', forms: /^(SchA|F8283|F1040\.(12|19|20)|F8812|F8863|F2441|Sch3\.8)/ },
  { id: 'tax_payments', name: 'Tax, AMT & payments', budgetKey: 'partner_review', forms: /^(F1040\.(14|15|16|17|18|22|23|24|25|26|31|33|37|38)|F6251|Sch2|Sch3\.(10|15)|F2210)/ },
  { id: 'california', name: 'California part-year', budgetKey: 'california', forms: /^(SchCA540NR|F540NR|ScheduleS|FTB)/ },
  { id: 'filing', name: 'Filing & outside filings', forms: /^$/ },
];

export function areaForLine(key: string): string {
  // Explicit overrides first: lines whose form prefix belongs to a different review area.
  if (/^(F1040\.(8|9|10|11))$/.test(key) || /^Sch1\.(10|26)$/.test(key)) return 'tax_payments';
  if (/^SchE\.(28|32|41)/.test(key) || key === 'Sch1.5') return 'passthroughs';
  for (const a of AREAS) if (a.forms.test(key)) return a.id;
  return 'tax_payments';
}

export const ROLE_LABEL: Record<string, string> = {
  preparer: 'Preparer',
  reviewer: 'Reviewer',
  partner: 'Partner',
  firm_administrator: 'Firm administrator',
  quality_reviewer: 'Quality reviewer',
  client: 'Client',
};
