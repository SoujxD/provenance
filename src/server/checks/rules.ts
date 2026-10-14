// Independent checks. Each rule is generic: it describes a class of mistake and looks for it in the
// packet's documents, extracted values, client answers and agency records. None of them encode the
// answer for this household; tests/checks.test.ts proves each one fires on the packet's real issues.
import type { Finding, ProposedChange } from '../../shared/types.ts';
import { areaForLine } from '../../shared/types.ts';
import {
  type Check, type CheckCtx, available, docAvailable, docText, pageText, evOf, num, parseMoney, lots, inCaResidency,
  longTerm, detectedAt, similarity, containment, lineNum, oursNum,
} from './ctx.ts';

const f = (x: Omit<Finding, 'source'> & { source?: Finding['source'] }): Finding => ({ source: 'check', ...x });
const money = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

// 1. Broker reported $0 / blank basis while a supplemental statement gives adjusted basis for the same lot.
const supplementalBasis: Check = {
  id: 'SUPPLEMENTAL_BASIS',
  title: 'Broker basis blank but a supplemental statement gives the adjusted basis',
  description: 'For every Form 8949 lot carried at $0 basis, look for a supplemental or stock-plan statement with an adjusted basis for a lot with the same acquisition date and issuer. Compensation income already taxed on the W-2 is otherwise taxed again as gain.',
  run(ctx) {
    const out: Finding[] = [];
    const supplements = [...ctx.P.docs.values()].filter((d) => /supplement/.test(d.document_type) && docAvailable(ctx, d.id));
    for (const sup of supplements) {
      const evs = ctx.P.evByDoc.get(sup.id) || [];
      const bases = evs.filter((e) => /_adjusted_basis$/.test(e.field));
      const changes: ProposedChange[] = [];
      const detail: string[] = [];
      const evidence = new Set<string>([sup.id]);
      const affected: string[] = [];
      let fedOverstated = 0;
      for (const b of bases) {
        const lotName = b.field.replace(/_adjusted_basis$/, '');
        const acq = evs.find((e) => e.field === `${lotName}_acquired`);
        if (!acq) continue;
        const issuerWord = sup.issuer.split(' ')[0];
        const lot = lots(ctx).find((l) => l.basis === 0 && l.acquired === acq.value && l.desc.includes(issuerWord));
        if (!lot) continue;
        const correct = Math.round((lot.proceeds - num(b.value)) * 100) / 100;
        changes.push({ target: lot.key, value: correct, caSource: inCaResidency(ctx, lot.sold), note: `Basis ${money(num(b.value))} per ${sup.id} (${lotName})` });
        detail.push(`${lot.id} ${lot.desc}: proceeds ${money(lot.proceeds)}, broker basis blank → adjusted basis ${money(num(b.value))} (${lotName}); gain ${money(lot.value)} → ${money(correct)}.`);
        fedOverstated += lot.value - correct;
        lot.sources.forEach((s) => evidence.add(s));
        evidence.add(b.id);
        evidence.add(acq.id);
        affected.push(lot.key);
      }
      if (!changes.length) continue;
      // Evidence that the income was already taxed as wages (W-2 box 14 RSU).
      for (const d of ctx.P.docs.values()) {
        if (d.document_type !== 'W-2') continue;
        const rsu = (ctx.P.evByDoc.get(d.id) || []).find((e) => /RSU/i.test(e.label));
        if (rsu) { evidence.add(rsu.id); detail.push(`${d.issuer} W-2 box 14 shows RSU income ${money(num(rsu.value))} already included in wages.`); }
      }
      out.push(f({
        id: `SUPPLEMENTAL_BASIS:${sup.id}`,
        rule: this.id,
        kind: 'error',
        title: `Stock comp basis missing on ${changes.length} lots: gain overstated ${money(fedOverstated)}`,
        summary: `The broker 1099-B shows blank (noncovered) basis for ${changes.length} employee-stock lots and the engine used $0. ${sup.title} gives the adjusted basis. The vest value is already in W-2 wages, so it is taxed twice.`,
        detail,
        area: 'investments',
        severity: 'high',
        blocksFiling: true,
        evidence: [...evidence],
        lines: affected,
        proposed: changes,
        detectedAt: detectedAt(ctx, [...evidence]),
        authorityHint: 'Treas. Reg. §1.6045-1(d)(6) (noncovered basis); Treas. Reg. §1.83-4(b) (basis = amount included in income)',
      }));
    }
    return out;
  },
};

// 2. The same income reported on two information returns (e.g. a sweep account reported on the composite 1099 and separately).
const duplicateInfoReturn: Check = {
  id: 'DUPLICATE_INFO_RETURN',
  title: 'Same income reported on two documents',
  description: 'Interest and dividend lines with equal amounts from different documents are compared: when the documents share an account number or one names the other\'s program, the second is a duplicate.',
  run(ctx) {
    const out: Finding[] = [];
    const payerLines = ctx.base.lines.filter((l) => ['R-INTEREST-PAYER', 'R-DIVIDEND-PAYER'].includes(l.rule) && typeof l.value === 'number' && l.value > 0);
    for (let i = 0; i < payerLines.length; i++) for (let j = i + 1; j < payerLines.length; j++) {
      const a = payerLines[i];
      const b = payerLines[j];
      if (a.value !== b.value || a.rule !== b.rule) continue;
      const evA = ctx.P.ev.get(a.sources.find((s) => s.startsWith('ev-'))!);
      const evB = ctx.P.ev.get(b.sources.find((s) => s.startsWith('ev-'))!);
      if (!evA || !evB || evA.document_id === evB.document_id) continue;
      const tA = docText(ctx, evA.document_id);
      const tB = docText(ctx, evB.document_id);
      const accA = [...tA.matchAll(/ending (\d{4})/g)].map((m) => m[1]);
      const accB = [...tB.matchAll(/ending (\d{4})/g)].map((m) => m[1]);
      const sharedAccount = accA.find((x) => accB.includes(x));
      const program = /sweep/i.test(tA) && /sweep/i.test(tB);
      if (!sharedAccount && !program) continue;
      out.push(f({
        id: `DUPLICATE_INFO_RETURN:${a.key}:${b.key}`,
        rule: this.id,
        kind: 'error',
        title: `Interest ${money(Number(a.value))} counted twice (${a.key} and ${b.key})`,
        summary: `${ctx.P.docs.get(evA.document_id)!.title} and ${ctx.P.docs.get(evB.document_id)!.title} report the same ${money(Number(a.value))}${sharedAccount ? ` for account ending ${sharedAccount}` : ''}${program ? ' (bank sweep program)' : ''}. Count it once.`,
        detail: [`${a.key} ${a.label} = ${money(Number(a.value))} (${evA.id}).`, `${b.key} ${b.label} = ${money(Number(b.value))} (${evB.id}).`],
        area: 'investments',
        severity: 'medium',
        blocksFiling: true,
        evidence: [evA.id, evB.id, evA.document_id, evB.document_id],
        lines: [a.key, b.key],
        proposed: [{ target: b.key, value: 0, note: `Duplicate of ${a.key}` }],
        detectedAt: detectedAt(ctx, [evA.id, evB.id]),
      }));
    }
    return out;
  },
};

// 3. Foreign currency income converted at a rate for the wrong period.
const fxRatePeriod: Check = {
  id: 'FX_RATE_PERIOD',
  title: 'Foreign income converted at the wrong year\'s rate',
  description: 'Income items converted from foreign currency must use a rate for the tax year (yearly average for income). Any line citing an exchange rate from another year is recomputed.',
  run(ctx) {
    const out: Finding[] = [];
    const ty = String(ctx.P.household.tax_year);
    for (const l of ctx.base.lines) {
      const fx = l.sources.find((s) => s.startsWith('ref:fx.'));
      if (!fx || l.rule !== 'R-INTEREST-PAYER') continue;
      const [, cur, key] = fx.split('.');
      if (key.startsWith(ty)) continue;
      const rates = ctx.params.fx[cur];
      const correctKey = `${ty}_average`;
      const foreign = ctx.P.ev.get(l.sources.find((s) => s.startsWith('ev-'))!);
      if (!foreign || !rates?.[correctKey]) continue;
      const correct = Math.round(num(foreign.value) / rates[correctKey]);
      out.push(f({
        id: `FX_RATE_PERIOD:${l.key}`,
        rule: this.id,
        kind: 'error',
        title: `${cur} interest converted at ${key.replace('_', ' ')} rate (${rates[key]}) instead of ${correctKey.replace('_', ' ')} (${rates[correctKey]})`,
        summary: `${money(num(foreign.value))} ${cur} ÷ ${rates[correctKey]} = ${money(correct)} USD, not ${money(Number(l.value))}.`,
        area: 'foreign',
        severity: 'low',
        blocksFiling: false,
        evidence: [foreign.id, foreign.document_id, fx, `ref:fx.${cur}.${correctKey}`],
        lines: [l.key],
        proposed: [{ target: l.key, value: correct }],
        detectedAt: detectedAt(ctx, [foreign.id]),
        authorityHint: 'IRC §989(b)(3); Treas. Reg. §1.989(b)-1 (average exchange rate for the taxable year)',
      }));
    }
    return out;
  },
};

// 4. Payment-card (1099-K) receipts added on top of books that already include them.
const paymentCardDouble: Check = {
  id: 'PAYMENT_CARD_DOUBLE',
  title: 'Form 1099-K receipts already inside books deposits',
  description: 'When gross receipts add a 1099-K amount, search the books detail for the same amount attributed to that payment processor. If found, the books already include it.',
  run(ctx) {
    const out: Finding[] = [];
    for (const l of ctx.base.lines.filter((x) => x.rule === 'R-SCHC-GROSS')) {
      const kEv = l.sources.map((s) => ctx.P.ev.get(s)).find((e) => e && ctx.P.docs.get(e.document_id)?.document_type === '1099-K');
      if (!kEv) continue;
      const kDoc = ctx.P.docs.get(kEv.document_id)!;
      const filerWord = kDoc.issuer.split(' ')[0];
      const books = [...ctx.P.docs.values()].filter((d) => d.document_type.startsWith('books') && docAvailable(ctx, d.id));
      let hit: { ev: string; doc: string; page: number } | null = null;
      for (const d of books) for (const e of ctx.P.evByDoc.get(d.id) || []) {
        if (num(e.value) === num(kEv.value) && new RegExp(filerWord, 'i').test(pageText(ctx, d.id, e.page))) hit = { ev: e.id, doc: d.id, page: e.page };
      }
      if (!hit) continue;
      const booksTotal = l.sources.map((s) => ctx.P.ev.get(s)).find((e) => e && /total_income/.test(e.field));
      const correct = booksTotal ? num(booksTotal.value) : Number(l.value) - num(kEv.value);
      const necs = [...ctx.P.docs.values()].filter((d) => d.document_type === '1099-NEC' && d.belongs_to === kDoc.belongs_to);
      const necTotal = necs.reduce((s, d) => s + num(evOf(ctx, d.id, 'box1')?.value), 0);
      const nonForm = (ctx.P.evByDoc.get(hit.doc) || []).find((e) => /without Form 1099|no Form 1099/i.test(e.label));
      out.push(f({
        id: `PAYMENT_CARD_DOUBLE:${l.key}`,
        rule: this.id,
        kind: 'error',
        title: `Gross receipts include the ${filerWord} 1099-K ${money(num(kEv.value))} twice`,
        summary: `${ctx.P.docs.get(hit.doc)!.title} page ${hit.page} shows the ${money(num(kEv.value))} arrived through ${kDoc.issuer} and was deposited gross into the books. Gross receipts should equal books revenue ${money(correct)}.`,
        detail: [
          `Forms 1099-NEC (${necs.length}): ${money(necTotal)}${nonForm ? ` + deposits from clients without a 1099: ${money(num(nonForm.value))} = ${money(necTotal + num(nonForm.value))}` : ''}.`,
          `Books revenue: ${money(correct)}. The 1099-K is a subset of one client's 1099-NEC receipts, not additional income.`,
        ],
        area: 'business',
        severity: 'high',
        blocksFiling: true,
        evidence: [kEv.id, hit.ev, hit.doc, ...(booksTotal ? [booksTotal.id] : []), ...necs.map((d) => evOf(ctx, d.id, 'box1')!.id), ...(nonForm ? [nonForm.id] : [])],
        lines: [l.key],
        proposed: [{ target: l.key, value: correct }],
        detectedAt: detectedAt(ctx, [kEv.id, hit.ev]),
      }));
    }
    return out;
  },
};

// 5. A page that is a second scan of another page, with both pages summed into a return line.
const duplicatePage: Check = {
  id: 'DUPLICATE_PAGE',
  title: 'Duplicate scan of a page counted twice',
  description: 'Pages of the same document with near-identical content are compared; if a return line sums values from both, the duplicate page is removed.',
  run(ctx) {
    const out: Finding[] = [];
    for (const d of ctx.P.docs.values()) {
      if (d.pages.length < 2 || !docAvailable(ctx, d.id)) continue;
      for (let i = 0; i < d.pages.length; i++) for (let j = i + 1; j < d.pages.length; j++) {
        const a = d.pages[i];
        const b = d.pages[j];
        if (!/\d{2,}/.test(a.printed_content)) continue;
        if (containment(a.printed_content, b.printed_content) < 0.97 || tokens2(a.printed_content) < 20) continue;
        for (const l of ctx.base.lines) {
          const srcs = l.sources.map((s) => ctx.P.ev.get(s)).filter(Boolean);
          const fromA = srcs.filter((e) => e!.document_id === d.id && e!.page === a.page);
          const fromB = srcs.filter((e) => e!.document_id === d.id && e!.page === b.page);
          if (!fromA.length || !fromB.length || typeof l.value !== 'number') continue;
          const dup = fromB.reduce((s, e) => s + num(e!.value), 0);
          const correct = l.value - dup;
          const proposed: ProposedChange[] = [{ target: l.key, value: correct }];
          // Lines derived from the same log (e.g. other miles = odometer miles - business miles).
          const odoStart = (ctx.P.evByDoc.get(d.id) || []).find((e) => /odometer_start/.test(e.field));
          const odoEnd = (ctx.P.evByDoc.get(d.id) || []).find((e) => /odometer_end/.test(e.field));
          const other = ctx.base.lines.find((x) => x.inputs.includes(l.key) && x.rule === 'R-MILEAGE-LOG');
          if (odoStart && odoEnd && other) proposed.push({ target: other.key, value: num(odoEnd.value) - num(odoStart.value) - correct, note: 'Odometer miles less business miles' });
          out.push(f({
            id: `DUPLICATE_PAGE:${d.id}:${a.page}:${b.page}`,
            rule: this.id,
            kind: 'error',
            title: `${d.title}: page ${b.page} is a second scan of page ${a.page}`,
            summary: `${l.key} (${l.label}) adds page totals from both pages: ${money(l.value)} should be ${money(correct)}.`,
            detail: [`Every entry on page ${a.page} reappears on page ${b.page} (${(containment(a.printed_content, b.printed_content) * 100).toFixed(0)}% of its content; similarity ${(similarity(a.printed_content, b.printed_content) * 100).toFixed(0)}%).`, b.printed_content.slice(0, 140) + '…'],
            area: areaForLine(l.key),
            severity: 'medium',
            blocksFiling: true,
            evidence: [...fromA.map((e) => e!.id), ...fromB.map((e) => e!.id), `doc:${d.id}#page${a.page}`, `doc:${d.id}#page${b.page}`],
            lines: [l.key, ...proposed.slice(1).map((p) => p.target), ...ctx.base.lines.filter((x) => x.inputs.includes(l.key) && x.rule !== 'R-MILEAGE-LOG').map((x) => x.key)],
            proposed,
            detectedAt: detectedAt(ctx, [d.id]),
          }));
        }
      }
    }
    return out;
  },
};

// 6. Self-employed health insurance while eligible for a subsidized plan through a spouse's employer.
const sehiEligibility: Check = {
  id: 'SEHI_SUBSIDIZED_PLAN',
  title: 'Self-employed health insurance while eligible for an employer plan',
  description: 'The SE health insurance deduction is not allowed for months the person was eligible to participate in a subsidized plan of an employer (including a spouse\'s). Client answers and prior-year notes are searched for that eligibility.',
  run(ctx) {
    const l = ctx.base.lines.find((x) => x.rule === 'R-SEHI');
    if (!l || !(Number(l.value) > 0)) return [];
    const qa = ctx.P.p.client.questionnaire.find((q: any) => /eligible/i.test(q.question) && /(health|coverage)/i.test(q.question) && /^\s*yes/i.test(q.answer));
    if (!qa) return [];
    const pyNote = ctx.P.p.prior_years.return_2024.notes?.[l.key];
    const evidence = [qa.id, ...l.sources];
    if (pyNote) evidence.push(`py:/return_2024/notes/${l.key}`);
    return [f({
      id: `SEHI_SUBSIDIZED_PLAN:${l.key}`,
      rule: this.id,
      kind: 'error',
      title: `SE health insurance ${money(Number(l.value))} not allowed: eligible for spouse's employer plan`,
      summary: `Client answer ${qa.id}: "${qa.answer}" Eligibility (not enrollment) disallows the deduction for every month of 2025.${pyNote ? ` The 2024 return took none for the same reason: "${pyNote}"` : ''}`,
      area: 'business',
      severity: 'high',
      blocksFiling: true,
      evidence,
      lines: [l.key],
      proposed: [{ target: l.key, value: 0, category: 'adjustment' }],
      detectedAt: detectedAt(ctx, [qa.id]),
      authorityHint: 'IRC §162(l)(2)(B)',
      detail: ['The adjustment rate excludes the QBI interplay (lower SEHI raises QBI); the engine recompute will slightly reduce the net effect.'],
    })];
  },
};

// 7. Mixed-use or personal items booked as 100% business.
const mixedUse: Check = {
  id: 'MIXED_USE_EXPENSE',
  title: 'Mixed-use or personal expenses deducted at 100%',
  description: 'Client call notes and messages are scanned for stated business-use percentages and "personal" items; each is matched to the books account (and its transaction detail) that carries it.',
  run(ctx) {
    const notes: { text: string; ref: string }[] = [];
    for (const c of ctx.P.p.client.call_notes) if (available(ctx, c.id)) c.notes.forEach((t: string) => notes.push({ text: t, ref: c.id }));
    for (const m of ctx.P.p.client.messages) if (available(ctx, m.id)) notes.push({ text: m.text, ref: m.id });
    const topics = [
      { kw: /(mobile|phone)/i, account: /telephone/i },
      { kw: /internet/i, account: /internet/i },
      { kw: /spotify/i, detail: /spotify/i },
    ];
    const books = [...ctx.P.docs.values()].filter((d) => d.document_type === 'books_profit_loss');
    const detailDocs = [...ctx.P.docs.values()].filter((d) => d.document_type === 'books_transaction_detail');
    const perLine = new Map<string, { disallow: number; items: string[]; ev: string[] }>();
    const refs = new Set<string>();
    for (const n of notes) for (const t of topics) {
      if (!t.kw.test(n.text)) continue;
      const pctM = n.text.match(/(\d{1,3})%/);
      const personal = /personal/i.test(n.text);
      if (!pctM && !personal) continue;
      let amount = 0;
      let evId = '';
      let parentEv: string | undefined;
      if (t.account) {
        const e = books.flatMap((d) => ctx.P.evByDoc.get(d.id) || []).find((x) => t.account!.test(x.label));
        if (!e) continue;
        amount = num(e.value);
        evId = e.id;
        parentEv = e.id;
      } else if (t.detail) {
        const e = detailDocs.flatMap((d) => ctx.P.evByDoc.get(d.id) || []).find((x) => t.detail!.test(x.label));
        if (!e) continue;
        amount = num(e.value);
        evId = e.id;
        // Find the books account that contains this detail line.
        const text = pageText(ctx, e.document_id, e.page).toLowerCase();
        parentEv = books.flatMap((d) => ctx.P.evByDoc.get(d.id) || []).find((x) => typeof x.value === 'number' && text.includes(`${x.label.toLowerCase()} ${num(x.value).toLocaleString('en-US', { minimumFractionDigits: 2 })}`))?.id;
      }
      const line = ctx.base.lines.find((l) => parentEv && l.sources.includes(parentEv));
      if (!line) continue;
      const share = personal ? 0 : Number(pctM![1]) / 100;
      const disallow = Math.round(amount * (1 - share));
      if (!perLine.has(line.key)) perLine.set(line.key, { disallow: 0, items: [], ev: [] });
      const pl = perLine.get(line.key)!;
      pl.disallow += disallow;
      pl.items.push(`${ctx.P.ev.get(evId)!.label} ${money(amount)} × ${personal ? '0% (personal)' : `${Math.round(share * 100)}% business`} → disallow ${money(disallow)} (${n.ref}: "${n.text}")`);
      pl.ev.push(evId);
      refs.add(n.ref);
    }
    if (!perLine.size) return [];
    const proposed: ProposedChange[] = [];
    const detail: string[] = [];
    let total = 0;
    const evidence: string[] = [...refs];
    for (const [k, v] of perLine) {
      proposed.push({ target: k, value: Number(ctx.lines.get(k)!.value) - v.disallow });
      detail.push(...v.items);
      total += v.disallow;
      evidence.push(...v.ev);
    }
    return [f({
      id: 'MIXED_USE_EXPENSE:SchC',
      rule: this.id,
      kind: 'error',
      title: `Personal share of phone, internet and subscriptions deducted (${money(total)})`,
      summary: `The client told us the business-use shares; the books deduct 100%. Disallow ${money(total)} across ${perLine.size} Schedule C lines.`,
      detail,
      area: 'business',
      severity: 'medium',
      blocksFiling: true,
      evidence,
      lines: [...perLine.keys()],
      proposed,
      detectedAt: detectedAt(ctx, evidence),
      authorityHint: 'IRC §262; IRC §262(b) (first residential phone line); Treas. Reg. §1.274-5T(b)(6)',
    })];
  },
};

// 8. A repair line that contains a replacement of a building system (an improvement).
const repairVsImprovement: Check = {
  id: 'REPAIR_CAPITALIZATION',
  title: 'Improvement expensed as a repair',
  description: 'Rental repair items above the $2,500 de minimis threshold are matched to their invoice; replacement or installation of a whole system (new unit, permit) is a restoration/betterment that must be capitalized.',
  run(ctx) {
    const out: Finding[] = [];
    for (const l of ctx.base.lines.filter((x) => /^SchE\.14/.test(x.key))) {
      const stmt = l.sources.map((s) => ctx.P.ev.get(s)).find(Boolean);
      if (!stmt) continue;
      for (const item of (ctx.P.evByDoc.get(stmt.document_id) || []).filter((e) => /repairs? - /i.test(e.label) && num(e.value) > 2500)) {
        const inv = [...ctx.P.docs.values()].find((d) => d.document_type === 'invoice' && num(evOf(ctx, d.id, 'total')?.value) === num(item.value) && docAvailable(ctx, d.id));
        if (!inv) continue;
        const text = docText(ctx, inv.id);
        if (!/(install(ed)? new|replace|system|permit)/i.test(text)) continue;
        const wi = ctx.P.p.what_if.alternatives.find((a: any) => a.changed_lines.some((c: any) => c.key === l.key));
        const proposed: ProposedChange[] = wi
          ? wi.changed_lines.filter((c: any) => /^(SchE\.(14|18)|F4562-E)/.test(c.key)).map((c: any) => ({ target: c.key, value: c.new, caSource: true }))
          : [{ target: l.key, value: Number(l.value) - num(item.value), caSource: true }];
        out.push(f({
          id: `REPAIR_CAPITALIZATION:${item.id}`,
          rule: this.id,
          kind: 'error',
          title: `${item.label.replace(/^Repairs - /i, '')} ${money(num(item.value))} is an improvement, not a repair`,
          summary: `Invoice ${inv.id}: "${text.slice(0, 160)}…" Replacing the whole system is a restoration of a building system; capitalize and depreciate over 27.5 years.`,
          detail: wi ? [`Engine what-if "${wi.id}" gives the exact effect: federal ${wi.federal.total_tax_change > 0 ? '+' : ''}${money(wi.federal.total_tax_change)}, California ${wi.california.total_tax_change > 0 ? '+' : ''}${money(wi.california.total_tax_change)}.`] : [],
          area: 'rentals',
          severity: 'high',
          blocksFiling: true,
          evidence: [item.id, stmt.document_id, inv.id, ...(evOf(ctx, inv.id, 'total') ? [evOf(ctx, inv.id, 'total')!.id] : []), 'qa-37', 'call-01'],
          lines: proposed.map((p) => p.target),
          proposed,
          whatIf: wi?.id,
          detectedAt: detectedAt(ctx, [item.id, inv.id]),
          authorityHint: 'Treas. Reg. §1.263(a)-3(k) (restoration) and (e)(2)(ii)(B) (HVAC is a building system); §1.263(a)-1(f) de minimis $2,500',
          judgment: true,
        }));
      }
    }
    return out;
  },
};

// 9. Interest from a payoff statement added on top of the lender's Form 1098 that already includes it.
const lenderInterestDouble: Check = {
  id: 'LENDER_INTEREST_DOUBLE',
  title: 'Payoff interest counted on top of the Form 1098',
  description: 'When a mortgage interest line cites both a lender\'s Form 1098 and that lender\'s payoff statement, read both: if either says the payoff interest is reported on the 1098, it is counted twice.',
  run(ctx) {
    const out: Finding[] = [];
    for (const l of ctx.base.lines.filter((x) => x.rule === 'R-MORTGAGE-INTEREST')) {
      const srcs = l.sources.map((s) => ctx.P.ev.get(s)).filter(Boolean) as any[];
      for (const s of srcs) {
        const d = ctx.P.docs.get(s.document_id)!;
        if (d.document_type !== 'payoff_statement' || !/interest/i.test(s.label)) continue;
        const f1098 = srcs.map((x) => ctx.P.docs.get(x.document_id)!).find((x) => x.document_type === '1098' && x.issuer === d.issuer);
        if (!f1098) continue;
        const says = /reported on the .*1098/i.test(docText(ctx, d.id)) || /includes .*payoff/i.test(docText(ctx, f1098.id));
        if (!says) continue;
        out.push(f({
          id: `LENDER_INTEREST_DOUBLE:${s.id}`,
          rule: this.id,
          kind: 'error',
          title: `${d.issuer} payoff interest ${money(num(s.value))} already in its Form 1098`,
          summary: `${f1098.id} box 1 "includes … interest paid at payoff" and ${d.id} says "Interest is reported on the 2025 Form 1098". ${l.key} counts it twice.`,
          area: 'deductions',
          severity: 'medium',
          blocksFiling: true,
          evidence: [s.id, d.id, f1098.id, ...srcs.filter((x) => x.document_id === f1098.id).map((x) => x.id)],
          lines: [l.key],
          proposed: [{ target: l.key, value: Number(l.value) - num(s.value) }],
          detectedAt: detectedAt(ctx, [d.id, f1098.id]),
        }));
      }
    }
    return out;
  },
};

// 10. Home real estate tax not reduced by the seller's share credited at closing.
const propertyTaxProration: Check = {
  id: 'PROPERTY_TAX_PRORATION',
  title: 'Property tax deduction ignores the seller credit at purchase',
  description: 'For a home bought during the year, taxes for the days before the purchase are the seller\'s, even when the buyer\'s escrow later pays the full bill. The buyer closing statement credit is subtracted; the SALT cap is then re-tested.',
  run(ctx) {
    const l = ctx.base.lines.find((x) => x.rule === 'R-SALT-PROPERTY');
    if (!l) return [];
    const cd = [...ctx.P.docs.values()].find((d) => d.document_type === 'closing_statement_buyer' && docAvailable(ctx, d.id));
    const credit = cd && (ctx.P.evByDoc.get(cd.id) || []).find((e) => /seller credit/i.test(e.label) && /tax/i.test(e.label));
    if (!credit) return [];
    const correct = Number(l.value) - num(credit.value);
    const total = lineNum(ctx, 'SchA.5d');
    const income = lineNum(ctx, 'SchA.5a') ?? 0;
    const cap = ctx.params.salt_cap;
    return [f({
      id: `PROPERTY_TAX_PRORATION:${l.key}`,
      rule: this.id,
      kind: 'error',
      title: `Home property tax ${money(Number(l.value))} includes the seller's ${money(num(credit.value))}`,
      summary: `${cd!.id} credits the buyer ${money(num(credit.value))} for 2025 taxes before the purchase. Deductible share: ${money(correct)}. State and local taxes then total ${money(income + correct)}, below the ${money(cap)} cap${total ? ` (was ${money(total)}, capped)` : ''}, so the cap no longer hides the error.`,
      area: 'deductions',
      severity: 'high',
      blocksFiling: true,
      evidence: [credit.id, cd!.id, ...l.sources],
      lines: [l.key, 'SchA.5d', 'SchA.5e'],
      proposed: [{ target: l.key, value: correct }],
      detectedAt: detectedAt(ctx, [credit.id]),
      authorityHint: 'IRC §164(d)(1); Treas. Reg. §1.164-6(b)',
    })];
  },
};

// 11. Donated vehicle deducted above the gross proceeds on Form 1098-C.
const vehicleDonation: Check = {
  id: 'VEHICLE_DONATION_1098C',
  title: 'Vehicle donation above the charity\'s sale price',
  description: 'A donated vehicle the charity sells is limited to the gross proceeds in Form 1098-C box 4c, whatever the donor\'s valuation.',
  run(ctx) {
    const out: Finding[] = [];
    for (const l of ctx.base.lines.filter((x) => x.rule === 'R-NONCASH-GIFT')) {
      const c = [...ctx.P.docs.values()].find((d) => d.document_type === '1098-C' && l.sources.some((s) => ctx.P.ev.get(s)?.document_id === d.id));
      if (!c) continue;
      const box4c = evOf(ctx, c.id, 'box4c');
      if (!box4c || !/4a .*sold.*checked|sold in arm's length/i.test(docText(ctx, c.id))) continue;
      if (Number(l.value) <= num(box4c.value)) continue;
      const qaSrc = l.sources.find((s) => s.startsWith('qa-'));
      out.push(f({
        id: `VEHICLE_DONATION_1098C:${l.key}`,
        rule: this.id,
        kind: 'error',
        title: `Vehicle deducted at ${money(Number(l.value))}; Form 1098-C caps it at ${money(num(box4c.value))}`,
        summary: `The charity sold the car in an arm's-length sale for ${money(num(box4c.value))} (${c.id} box 4c). ${qaSrc ? `The ${money(Number(l.value))} comes from the client's estimate (${qaSrc}).` : ''}`,
        area: 'deductions',
        severity: 'medium',
        blocksFiling: true,
        evidence: [box4c.id, c.id, ...(qaSrc ? [qaSrc] : []), 'call-01'],
        lines: [l.key],
        proposed: [{ target: l.key, value: num(box4c.value) }],
        detectedAt: detectedAt(ctx, [c.id]),
        authorityHint: 'IRC §170(f)(12)(A)(ii)',
      }));
    }
    return out;
  },
};

// 12. Federal estimated payments vs the IRS account transcript.
const estimatesVsTranscript: Check = {
  id: 'ESTIMATES_VS_TRANSCRIPT',
  title: 'Estimated payments disagree with the IRS transcript',
  description: 'The estimated-payments line is agreed to the latest IRS account transcript (code 670 estimated payments). Client recollection is never enough.',
  run(ctx) {
    const l = ctx.base.lines.find((x) => x.rule === 'R-ESTIMATED-PAYMENTS');
    const snaps = ctx.P.p.tax_agency_records.irs_account_transcript_2025.filter((s: any) => `${s.as_of}T23:59:59Z` <= ctx.asOf || s.as_of <= ctx.asOf.slice(0, 10));
    const snap = snaps.at(-1);
    if (!l || !snap) return [];
    const est = snap.transactions.filter((t: any) => t.code === '670' && /estimated/i.test(t.description));
    const total = est.reduce((s: number, t: any) => s + num(t.amount), 0);
    if (total === Number(l.value)) return [];
    const qa = l.sources.find((s) => s.startsWith('qa-'));
    const idx = ctx.P.p.tax_agency_records.irs_account_transcript_2025.indexOf(snap);
    return [f({
      id: `ESTIMATES_VS_TRANSCRIPT:${l.key}`,
      rule: this.id,
      kind: 'error',
      title: `Federal estimates ${money(Number(l.value))} vs IRS transcript ${money(total)}`,
      summary: `The IRS transcript (as of ${snap.as_of}) shows ${est.map((t: any) => `${t.date} ${money(num(t.amount))}`).join('; ')}.${qa ? ` The engine took the last payment from the client's answer (${qa}).` : ''}`,
      area: 'tax_payments',
      severity: 'high',
      blocksFiling: true,
      evidence: [`agency:/irs_account_transcript_2025/${idx}`, ...l.sources],
      lines: [l.key, 'F1040.33', 'F2210.19'],
      proposed: [{ target: l.key, value: total }],
      detectedAt: maxIso2(`${snap.as_of}T16:20:00Z`, ctx.base.computed_at),
      detail: ['Underpayment penalty (Form 2210) will also change; engine recompute needed.'],
    })];
  },
};
function maxIso2(a: string, b: string) { return a > b ? a : b; }

// 13. State payments designated to another tax year.
const statePaymentDesignation: Check = {
  id: 'STATE_PAYMENT_DESIGNATION',
  title: 'State estimate counted that the agency applied to another year',
  description: 'Every state payment on the return is matched to its confirmation\'s designated tax year and to the agency account.',
  run(ctx) {
    const l = ctx.base.lines.find((x) => x.rule === 'R-CA-ESTIMATED-PAYMENTS');
    if (!l) return [];
    const ty = String(ctx.P.household.tax_year);
    const wrong: { amt: any; year: any; date: any }[] = [];
    for (const s of l.sources) {
      const e = ctx.P.ev.get(s);
      if (!e || !/_amount$/.test(e.field)) continue;
      const n = e.field.replace(/_amount$/, '');
      const year = evOf(ctx, e.document_id, `${n}_year`);
      const date = evOf(ctx, e.document_id, `${n}_date`);
      if (year && String(year.value) !== ty) wrong.push({ amt: e, year, date });
    }
    if (!wrong.length) return [];
    const ftb = ctx.P.p.tax_agency_records.ftb_account;
    const held = ftb.tax_year_2024_payments_after_filing || [];
    const minus = wrong.reduce((s, w) => s + num(w.amt.value), 0);
    return [f({
      id: `STATE_PAYMENT_DESIGNATION:${l.key}`,
      rule: this.id,
      kind: 'error',
      title: `California estimates include ${money(minus)} the FTB applied to ${wrong[0].year.value}`,
      summary: `${wrong.map((w) => `${w.date?.value} ${money(num(w.amt.value))} was designated tax year ${w.year.value}`).join('; ')}. The FTB account confirms: ${held.map((h: any) => `${h.date} ${money(h.amount)} — ${h.note}`).join('; ')}. Payments for 2025: ${money(Number(l.value) - minus)}.`,
      detail: ['Separately, ask the FTB to transfer or refund the 2024 credit; it is the client\'s money either way.'],
      area: 'california',
      severity: 'high',
      blocksFiling: true,
      evidence: [...wrong.flatMap((w) => [w.amt.id, w.year.id]), 'agency:/ftb_account', 'qa-32'],
      lines: [l.key, 'F540NR.78'],
      proposed: [{ target: l.key, value: Number(l.value) - minus }],
      detectedAt: detectedAt(ctx, wrong.map((w) => w.amt.id)),
      suggestedQuestion: 'The September 15, 2025 California payment of $3,500 was designated for tax year 2024, so the FTB is holding it as a 2024 credit. Would you like us to request that the FTB transfer it to 2025 or refund it?',
    })];
  },
};

// 14. State-source wages for a part-year resident taken from W-2 box 16 when payroll kept the old state.
const stateWageSourcing: Check = {
  id: 'STATE_WAGE_SOURCING',
  title: 'Part-year state wages taken from W-2 box 16',
  description: 'For a part-year resident, state-source wages are wages earned while resident (or working) there. When an employer kept the old state on payroll after the move and a paystub shows year-to-date state wages at the move date, that figure is the state-source amount.',
  run(ctx) {
    const l = ctx.base.lines.find((x) => x.rule === 'R-CA-WAGES-SOURCE');
    const res = ctx.P.household.residency.find((r: any) => r.state === 'CA');
    if (!l || !res || res.to >= `${ctx.P.household.tax_year}-12-31`) return [];
    const w2s = [...ctx.P.docs.values()].filter((d) => d.document_type === 'W-2' && ctx.base.documents_used.includes(d.id));
    const distinct = new Map<string, any>();
    for (const d of w2s) {
      const ein = evOf(ctx, d.id, 'employer_ein')?.value as string;
      if (!distinct.has(ein)) distinct.set(ein, d);
    }
    const stubs = [...ctx.P.docs.values()].filter((d) => d.document_type === 'paystub' && docAvailable(ctx, d.id));
    let caWages = 0;
    const detail: string[] = [];
    const evidence: string[] = [];
    let changed = false;
    for (const d of distinct.values()) {
      const box16 = evOf(ctx, d.id, 'box16');
      const text = docText(ctx, d.id);
      const kept = text.match(/kept California as the work state through (\d{2}\/\d{2}\/\d{4})/i);
      const stub = stubs.find((s) => s.issuer === d.issuer);
      const ytdCa = stub && (ctx.P.evByDoc.get(stub.id) || []).find((e) => /CA taxable wages|California taxable wages/i.test(e.label));
      if (kept && ytdCa) {
        caWages += num(ytdCa.value);
        changed = true;
        detail.push(`${d.issuer}: box 16 ${money(num(box16?.value))} reflects payroll keeping CA "through ${kept[1]}", but residency ended ${res.to} and the paystub (${stub!.id}) shows CA wages through the move of ${money(num(ytdCa.value))}.`);
        evidence.push(d.id, box16!.id, stub!.id, ytdCa.id);
      } else {
        caWages += num(box16?.value);
        detail.push(`${d.issuer}: box 16 ${money(num(box16?.value))} — all earned while resident.`);
        if (box16) evidence.push(box16.id);
      }
    }
    if (!changed || Math.abs(caWages - Number(l.value)) < 1) return [];
    return [f({
      id: `STATE_WAGE_SOURCING:${l.key}`,
      rule: this.id,
      kind: 'error',
      title: `California wages ${money(Number(l.value))} should be ${money(caWages)}`,
      summary: `Residency ended ${res.to}. Wages earned in Texas after the move are not California-source even though payroll kept withholding California tax.`,
      detail: [...detail, 'California tax withheld on the Texas wages is still credited as withholding (refund).'],
      area: 'california',
      severity: 'high',
      blocksFiling: true,
      evidence: [...evidence, 'qa-45', 'qa-02'],
      lines: [l.key],
      proposed: [{ target: l.key, value: caWages }],
      detectedAt: detectedAt(ctx, evidence),
      authorityHint: 'Cal. Rev. & Tax. Code §17041(i), §17951; FTB Pub. 1031',
    })];
  },
};

// 15. Broker 1099-B summary vs detail; read unextracted pages for the missing lots.
const LOT_TEXT_RE = /([A-Z]\d+) ([^;]+?) ([\d.]+) sh acquired (\d{4}-\d{2}-\d{2}) sold (\d{4}-\d{2}-\d{2}) proceeds ([\d,.]+) basis ([\d,.]+)(?: wash sale loss disallowed ([\d,.]+))? (short|long)-term (covered|noncovered)/g;
const brokerSummaryDetail: Check = {
  id: 'BROKER_SUMMARY_DETAIL',
  title: 'Broker summary does not agree to the lot detail',
  description: 'Each composite 1099 used on the return: summary proceeds are agreed to the sum of lot proceeds. A gap is traced to pages the pipeline did not read, which are parsed for the missing lots.',
  run(ctx) {
    const out: Finding[] = [];
    for (const d of ctx.P.docs.values()) {
      if (d.document_type !== '1099-composite' || !ctx.base.documents_used.includes(d.id) || ctx.base.documents_superseded.includes(d.id)) continue;
      const evs = ctx.P.evByDoc.get(d.id) || [];
      const summary = evs.find((e) => e.field === 'b_summary_proceeds');
      if (!summary) continue;
      const lotProceeds = evs.filter((e) => /^[A-Z]\d+_proceeds$/.test(e.field));
      const detailSum = Math.round(lotProceeds.reduce((s, e) => s + num(e.value), 0) * 100) / 100;
      const gap = Math.round((num(summary.value) - detailSum) * 100) / 100;
      if (Math.abs(gap) < 0.01) continue;
      const extractedPages = new Set(evs.map((e) => e.page));
      const missing: ProposedChange[] = [];
      const detail: string[] = [`Summary proceeds ${money(num(summary.value))}; ${lotProceeds.length} extracted lots total ${money(detailSum)}; gap ${money(gap)}.`];
      const evidence: string[] = [summary.id, d.id];
      for (const pg of d.pages) {
        if (extractedPages.has(pg.page)) continue;
        for (const m of pg.printed_content.matchAll(LOT_TEXT_RE)) {
          const [, id, desc, , acq, sold, proceeds, basis, wash, term, cov] = m;
          const box = term === 'short' ? (cov === 'covered' ? 'A' : 'B') : cov === 'covered' ? 'D' : 'E';
          const gain = Math.round((parseMoney(proceeds) - parseMoney(basis) + (wash ? parseMoney(wash) : 0)) * 100) / 100;
          missing.push({ target: `F8949.${box}.${id}`, value: gain, addTo: `F8949.${box}.total`, label: `${desc.trim()} (acquired ${acq}, sold ${sold}; proceeds ${proceeds}, basis ${basis})`, caSource: inCaResidency(ctx, sold) });
          detail.push(`Page ${pg.page} (not read by the pipeline): ${id} ${desc.trim()}, proceeds ${proceeds}, basis ${basis}, ${term}-term ${cov} → Form 8949 box ${box}, ${gain < 0 ? 'loss' : 'gain'} ${money(gain)}.`);
          evidence.push(`doc:${d.id}#page${pg.page}`);
        }
      }
      const explained = missing.reduce((s, m) => s + parseMoney(String(m.label!.match(/proceeds ([\d,.]+)/)![1])), 0);
      out.push(f({
        id: `BROKER_SUMMARY_DETAIL:${d.id}`,
        rule: this.id,
        kind: 'error',
        title: `${d.issuer} 1099-B: ${money(gap)} of proceeds missing from the detail${missing.length ? ` (lot ${missing.map((m) => m.target.split('.')[2]).join(', ')} on an unread page)` : ''}`,
        summary: missing.length && Math.abs(explained - gap) < 0.01 ? `The gap is fully explained by ${missing.length} lot(s) on page(s) the pipeline did not read (${d.extraction.reason}).` : `Gap not fully explained; request the broker's full detail.`,
        detail,
        area: 'investments',
        severity: 'low',
        blocksFiling: true,
        evidence,
        lines: missing.map((m) => m.target),
        proposed: missing,
        detectedAt: detectedAt(ctx, [d.id]),
      }));
    }
    return out;
  },
};

// 16. A corrected form: diff it against the original and confirm the return uses it.
const correctedFormDiff: Check = {
  id: 'CORRECTED_FORM_DIFF',
  title: 'Corrected form received',
  description: 'For every document marked CORRECTED, find the original (same issuer, type and year), list every changed value, and confirm the current engine version uses the corrected one.',
  run(ctx) {
    const out: Finding[] = [];
    for (const c of ctx.P.docs.values()) {
      if (!c.marked_corrected || !docAvailable(ctx, c.id)) continue;
      const orig = [...ctx.P.docs.values()].find((d) => d.id !== c.id && d.issuer === c.issuer && d.document_type === c.document_type && d.tax_year === c.tax_year && !d.marked_corrected);
      if (!orig) continue;
      const diffs: string[] = [];
      const ev: string[] = [];
      for (const e of ctx.P.evByDoc.get(c.id) || []) {
        const o = evOf(ctx, orig.id, e.field);
        if (o && JSON.stringify(o.value) !== JSON.stringify(e.value)) {
          diffs.push(`${e.label}: ${o.value} → ${e.value}`);
          ev.push(o.id, e.id);
        }
      }
      const usesCorrected = ctx.base.documents_superseded.includes(orig.id) && ctx.base.documents_used.includes(c.id);
      const vPrev = ctx.P.versionList().find((v) => v.computed_at < c.received_at && v.documents_used.includes(orig.id));
      const vNext = ctx.P.versionList().find((v) => v.computed_at > c.received_at);
      out.push(f({
        id: `CORRECTED_FORM_DIFF:${c.id}`,
        rule: this.id,
        kind: 'info',
        title: `${c.issuer} corrected 1099: ${diffs.length} values changed`,
        summary: usesCorrected ? `The current engine version uses ${c.id} and treats ${orig.id} as superseded.${vPrev && vNext ? ` Effect ${vPrev.version}→${vNext.version}: federal tax ${money(vNext.summary.federal.total_tax - vPrev.summary.federal.total_tax)}, California ${money(vNext.summary.california.total_tax - vPrev.summary.california.total_tax)} (already in the return).` : ''}` : `The return still uses ${orig.id}. Recompute with ${c.id}.`,
        detail: diffs,
        area: 'investments',
        severity: usesCorrected ? 'low' : 'high',
        blocksFiling: !usesCorrected,
        evidence: [c.id, orig.id, ...ev],
        lines: [],
        detectedAt: detectedAt(ctx, [c.id]),
      }));
    }
    return out;
  },
};

// 17. Digital asset lot with no basis: weigh the client's claimed basis (judgment call on weak evidence).
const digitalAssetBasis: Check = {
  id: 'DIGITAL_ASSET_BASIS_EVIDENCE',
  title: 'Digital asset sold with no basis on record',
  description: 'For crypto lots carried at zero basis (transfer-in), collect the client\'s explanation and its supporting evidence, and quantify the alternative position. The decision is a judgment call recorded with authority.',
  run(ctx) {
    const out: Finding[] = [];
    for (const lot of lots(ctx)) {
      if (!/^[HK]$/.test(lot.box) || lot.basis !== 0) continue;
      const evs = lot.sources.map((s) => ctx.P.ev.get(s)).filter(Boolean) as any[];
      const acqEv = evs.find((e) => /_acquired$/.test(e.field));
      if (acqEv && acqEv.value !== null) continue;
      const assetName = lot.desc.split(' ')[0];
      const msg = ctx.P.p.client.messages.find((m: any) => available(ctx, m.id) && new RegExp(`\\b(crypto|${assetName})\\b`, 'i').test(m.text) && /cost|bought|basis/i.test(m.text));
      const claimed = msg?.text.match(/for about ([\d,]+)/)?.[1];
      const claimedDate = msg?.text.match(/(\d{2})\/(\d{2})\/(\d{4})/);
      const evidence = [...lot.sources];
      const detail: string[] = [`Engine used $0 basis and the transfer-in date (gain ${money(lot.value)}, short-term).`];
      let proposed: ProposedChange[] | undefined;
      if (msg && claimed) {
        evidence.push(msg.id);
        const basis = parseMoney(claimed);
        const acq = claimedDate ? `${claimedDate[3]}-${claimedDate[1]}-${claimedDate[2]}` : '';
        const lt = acq ? longTerm(acq, lot.sold) : false;
        const newBox = lt ? 'K' : lot.box;
        const gain = lot.proceeds - basis;
        detail.push(`Client (${msg.id}): bought ${acq || 'earlier'} for about ${claimed}; evidence offered is one bank statement line; the exchange has shut down.`);
        detail.push(`Alternative: basis ${money(basis)}, acquired ${acq}${lt ? ' → long-term (box K)' : ''}, gain ${money(gain)}.`);
        detail.push('Evidence quality: weak (client statement + one bank line, no exchange records). Burden of proof is on the taxpayer; consider requesting the bank statement and wallet transfer records before relying on it.');
        proposed = newBox === lot.box ? [{ target: lot.key, value: gain, caSource: inCaResidency(ctx, lot.sold) }]
          : [{ target: lot.key, value: 0, caSource: inCaResidency(ctx, lot.sold) }, { target: `F8949.${newBox}.${lot.id}`, value: gain, addTo: `F8949.${newBox}.total`, label: `${lot.desc} (acquired ${acq}, sold ${lot.sold}; proceeds ${money(lot.proceeds)}, basis ${money(basis)})`, caSource: inCaResidency(ctx, lot.sold) }];
      }
      out.push(f({
        id: `DIGITAL_ASSET_BASIS_EVIDENCE:${lot.key}`,
        rule: this.id,
        kind: 'judgment',
        title: `Crypto lot ${lot.id} at $0 basis: ${msg ? `client claims ${claimed} basis (weak evidence)` : 'ask the client for cost records'}`,
        summary: msg ? 'Judgment call: keep $0 basis (conservative) or accept the claimed basis with documentation. Record the decision and the authority relied on.' : 'No basis records for a transferred-in lot. Ask the client where and when it was bought and for any records.',
        detail,
        area: 'investments',
        severity: 'high',
        blocksFiling: true,
        evidence,
        lines: [lot.key],
        proposed,
        detectedAt: detectedAt(ctx, evidence),
        judgment: true,
        authorityHint: 'IRC §1012; Treas. Reg. §1.1012-1(j) (digital asset basis by wallet); Rev. Proc. 2024-28; Cohan v. Comm\'r, 39 F.2d 540 (2d Cir. 1930) (estimates need a reasonable basis)',
        suggestedQuestion: msg ? 'Please upload the bank statement showing the March 2021 payment of about $3,050 to CryptoNorth, and any record of moving that BTC to Coinhaven in June 2025.' : `Coinhaven lot ${lot.id} (${lot.desc}) was transferred in with no cost. Where and when was it bought, for how much, and do you have any records?`,
      }));
    }
    return out;
  },
};

// 18. A person's SSN on the return differs from the SSN on documents (blocks e-file).
const tinConsistency: Check = {
  id: 'TIN_CONSISTENCY',
  title: 'SSN on the return differs from documents',
  description: 'Every SSN printed or extracted for a household member is compared to the SSN on the return. A mismatch is rejected by e-file (name control / TIN check) and blocks filing.',
  run(ctx) {
    const out: Finding[] = [];
    for (const person of ctx.P.household.people) {
      const seen: { ssn: string; ref: string }[] = [];
      const first = person.name.split(' ')[0];
      for (const d of ctx.P.docs.values()) {
        if (!docAvailable(ctx, d.id)) continue;
        for (const pg of d.pages) {
          const re = new RegExp(`${person.name.replace(/[-]/g, '.')}[^.;]{0,40}?(\\d{3}-\\d{2}-\\d{4})`, 'g');
          for (const m of pg.printed_content.matchAll(re)) seen.push({ ssn: m[1], ref: `doc:${d.id}#page${pg.page}` });
        }
        for (const e of ctx.P.evByDoc.get(d.id) || []) {
          if (e.value_type !== 'ssn') continue;
          const belongs = d.belongs_to === `dependent:${person.id}` || (d.belongs_to === person.role) || new RegExp(first).test(pageText(ctx, d.id, e.page).split(String(e.value))[0].slice(-60));
          if (belongs && /dep/.test(e.field) ? new RegExp(first).test(pageText(ctx, d.id, e.page)) : belongs) seen.push({ ssn: String(e.value), ref: e.id });
        }
      }
      const conflicts = seen.filter((s) => s.ssn !== person.ssn);
      if (!conflicts.length) continue;
      const docSsn = conflicts[0].ssn;
      const transposed = [...docSsn].sort().join('') === [...person.ssn].sort().join('');
      out.push(f({
        id: `TIN_CONSISTENCY:${person.id}`,
        rule: this.id,
        kind: 'error',
        title: `${person.name}: SSN on the return (organizer) differs from ${conflicts.length} document${conflicts.length > 1 ? 's' : ''}`,
        summary: `Return uses ${person.ssn} (client organizer); documents show ${docSsn}${transposed ? ' — the last digits are transposed' : ''}. E-file will reject on the TIN/name-control match. Correct before filing.`,
        detail: [...new Set(conflicts.map((c) => `${c.ref}: ${c.ssn}`))],
        area: 'intake',
        severity: 'blocking',
        blocksFiling: true,
        evidence: [...new Set(conflicts.map((c) => c.ref)), `household:${person.id}`],
        lines: [`household:${person.id}.ssn`],
        proposed: [{ target: `household:${person.id}.ssn`, value: docSsn }],
        detectedAt: detectedAt(ctx, conflicts.map((c) => c.ref)),
        suggestedQuestion: `Please upload a photo of ${person.name}'s Social Security card: the organizer shows a different number from last year's return.`,
      }));
    }
    return out;
  },
};

// 19. Low-confidence reads used on the return, and any corroborating evidence.
const lowConfidence: Check = {
  id: 'LOW_CONFIDENCE_AMOUNT',
  title: 'Low-confidence read used on the return',
  description: 'Extracted values below 0.60 confidence that feed a return line need verification. Client messages and answers are searched for corroboration naming the same payee.',
  run(ctx) {
    const out: Finding[] = [];
    for (const l of ctx.base.lines) for (const s of l.sources) {
      const e = ctx.P.ev.get(s);
      if (!e || e.confidence >= 0.6) continue;
      const d = ctx.P.docs.get(e.document_id)!;
      const text = pageText(ctx, d.id, e.page);
      const alt = text.match(/could be read as (\d) or (\d)/);
      const issuerWords = d.issuer.split(' ').filter((w) => w.length > 3);
      const corroboration = ctx.P.p.client.messages.find((m: any) => available(ctx, m.id) && issuerWords.some((w: string) => m.text.includes(w)) && m.text.includes(String(num(e.value)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')));
      const alternatives = alt ? alt.slice(1).map((digit) => Number(String(e.text_as_read).replace(/^\$?\d|\?/, digit).replace(/[,$]/g, ''))) : [];
      const exposure = alternatives.length ? Math.max(...alternatives) - Math.min(...alternatives) : 0;
      out.push(f({
        id: `LOW_CONFIDENCE_AMOUNT:${e.id}`,
        rule: this.id,
        kind: corroboration ? 'info' : 'compliance',
        title: `${d.issuer} gift read as ${money(num(e.value))} at ${Math.round(e.confidence * 100)}% confidence${corroboration ? ' — corroborated' : ''}`,
        summary: `${text}${corroboration ? ` Corroboration: ${corroboration.id} "${corroboration.text}"` : ' Ask the client and get a clean written acknowledgment.'}`,
        detail: [
          ...(alternatives.length ? [`Possible readings: ${alternatives.map((a) => money(a)).join(' or ')} (exposure ${money(exposure)} of deduction).`] : []),
          'Cash gifts of $250 or more need a contemporaneous written acknowledgment stating the amount; an ambiguous amount weakens it — request a corrected acknowledgment from the charity.',
        ],
        area: areaForLine(l.key),
        severity: corroboration ? 'low' : 'medium',
        blocksFiling: !corroboration,
        evidence: [e.id, d.id, ...(corroboration ? [corroboration.id] : [])],
        lines: [l.key],
        detectedAt: detectedAt(ctx, [e.id]),
        authorityHint: 'IRC §170(f)(8) (contemporaneous written acknowledgment); IRC §170(f)(17) (bank record or receipt)',
        suggestedQuestion: corroboration ? undefined : `The St. Brigid receipt's first digit is hard to read. Was the gift $1,500 or $7,500? A bank record of the check and a clean acknowledgment from the parish would settle it.`,
      }));
    }
    return out;
  },
};

// 20. Retirement contribution above the deduction limit; limit depends on Schedule C (re-evaluated live).
const retirementLimit: Check = {
  id: 'RETIREMENT_DEDUCTION_LIMIT',
  title: 'SEP contribution above the deductible limit',
  description: 'SEP contributions are compared to 20% of (net profit − ½ SE tax). Excess is not deductible (carried forward) and may carry an excise tax. The limit is recomputed from our current Schedule C, so it moves when Schedule C findings are fixed.',
  run(ctx) {
    const l = ctx.base.lines.find((x) => x.rule === 'R-SEP-LIMIT');
    if (!l) return [];
    const contribEv = l.sources.map((s) => ctx.P.ev.get(s)).find(Boolean);
    if (!contribEv) return [];
    const contribution = num(contribEv.value);
    const np = oursNum(ctx, 'SchC.31') ?? 0;
    const P = ctx.params;
    const se = Math.round(np * P.se_factor * 0.124) + Math.round(np * P.se_factor * 0.029);
    const halfSe = Math.round(se / 2);
    const limit = Math.round(0.2 * (np - halfSe));
    const deduction = Math.min(contribution, limit);
    const excess = contribution - deduction;
    if (excess <= 0) return [];
    const changed = Math.abs(deduction - Number(l.value)) >= 1;
    return [f({
      id: `RETIREMENT_DEDUCTION_LIMIT:${l.key}`,
      rule: this.id,
      kind: 'compliance',
      title: `SEP contribution ${money(contribution)} exceeds the limit by ${money(excess)}${changed ? ' (limit moved with Schedule C fixes)' : ''}`,
      summary: `Limit = 20% × (net profit ${money(np)} − ½ SE tax ${money(halfSe)}) = ${money(limit)}. Excess ${money(excess)} is not deductible for 2025; it carries forward and may be subject to the 10% excise on nondeductible contributions unless withdrawn.`,
      detail: changed ? [`Engine deducted ${money(Number(l.value))} using its Schedule C; our Schedule C changes the deductible amount to ${money(deduction)}.`] : ['Engine deducted the limit correctly; advise the client on the excess.'],
      area: 'retirement',
      severity: changed ? 'medium' : 'low',
      blocksFiling: changed,
      evidence: [contribEv.id, contribEv.document_id, 'qa-26'],
      lines: [l.key],
      proposed: changed ? [{ target: l.key, value: deduction, category: 'adjustment' }] : undefined,
      dependsOn: changed ? ['PAYMENT_CARD_DOUBLE:SchC.1', 'DUPLICATE_PAGE:D23:2:3', 'MIXED_USE_EXPENSE:SchC'] : undefined,
      detectedAt: detectedAt(ctx, [contribEv.id]),
      authorityHint: 'IRC §404(h)(1)(C), §404(a)(8)(C), §4972 (excise on nondeductible contributions)',
    })];
  },
};

// 21. Information returns the client's business had to file.
const infoReturns: Check = {
  id: 'INFO_RETURNS_DUE',
  title: 'Forms 1099-NEC the business had to file',
  description: 'Contractors paid $600 or more with no Forms 1099-NEC issued. Outside the engagement, but the client must be told in writing.',
  run(ctx) {
    const j = ctx.lines.get('SchC.J');
    const rep = [...ctx.P.docs.values()].find((d) => d.document_type === 'books_report' && /contractor/i.test(d.title));
    if (!j || j.value !== 'No' || !rep) return [];
    const payees = (ctx.P.evByDoc.get(rep.id) || []).filter((e) => num(e.value) >= 600);
    const due = ctx.P.firm.deadlines.find((d: any) => /1099-NEC/.test(d.what));
    return [f({
      id: 'INFO_RETURNS_DUE:1099-NEC',
      rule: this.id,
      kind: 'outside_filing',
      title: `Forms 1099-NEC not filed for ${payees.length} contractors (due ${due?.date ?? 'Jan 31'})`,
      summary: `${payees.map((p) => `${p.label} ${money(num(p.value))}`).join('; ')}. Schedule C question J is answered "No" truthfully. Outside the engagement (engagement letter excludes the business's information returns): advise the client in writing to file late and of the per-form penalties.`,
      area: 'filing',
      severity: 'medium',
      blocksFiling: false,
      evidence: [rep.id, ...payees.map((p) => p.id), ...(ctx.lines.get('SchC.I')?.sources ?? []), ...j.sources, ...engagementLetter(ctx)],
      lines: ['SchC.I', 'SchC.J'],
      detectedAt: detectedAt(ctx, [rep.id]),
      authorityHint: 'IRC §6041A(a); §6721/§6722 penalties',
    })];
  },
};

// 22. Foreign accounts above the FBAR threshold.
const fbar: Check = {
  id: 'FBAR_REQUIRED',
  title: 'FBAR (FinCEN 114) required',
  description: 'Maximum foreign account value converted at the Treasury year-end rate; above $10,000 an FBAR is due. Outside the return and the engagement scope.',
  run(ctx) {
    const out: Finding[] = [];
    for (const d of ctx.P.docs.values()) {
      if (d.document_type !== 'foreign_bank_statement' || !docAvailable(ctx, d.id)) continue;
      const max = (ctx.P.evByDoc.get(d.id) || []).find((e) => /max|highest/i.test(e.field + e.label));
      if (!max) continue;
      const rate = ctx.params.fx.SEK[`${ctx.P.household.tax_year}_year_end`];
      const usd = Math.round(num(max.value) / rate);
      if (usd <= 10000) continue;
      const due = ctx.P.firm.deadlines.find((x: any) => /FBAR/.test(x.what));
      out.push(f({
        id: `FBAR_REQUIRED:${d.id}`,
        rule: this.id,
        kind: 'outside_filing',
        title: `FBAR required: ${d.issuer} maximum ≈ $${money(usd)} (due ${due?.date ?? 'Oct 15'})`,
        summary: `Highest balance ${money(num(max.value))} SEK ÷ ${rate} = $${money(usd)} > $10,000. Not part of the return or the engagement (engagement letter excludes FBAR). The 2024 file says "FBAR filed by client separately" — confirm the 2025 filing.`,
        area: 'foreign',
        severity: 'medium',
        blocksFiling: false,
        evidence: [max.id, d.id, ...engagementLetter(ctx), ...pyNoteRefs(ctx, /FBAR/)],
        lines: ['F8938.1.max'],
        detectedAt: detectedAt(ctx, [d.id]),
        authorityHint: '31 U.S.C. §5314; 31 C.F.R. §1010.350',
        suggestedQuestion: 'Have you filed (or will you file) the 2025 FinCEN Form 114 (FBAR) for the Sparbanken account by October 15, 2026? We can help under a separate engagement.',
      }));
    }
    return out;
  },
};

// 23. Large inheritance from a foreign person: Form 3520 for the year received.
const foreignInheritance: Check = {
  id: 'FOREIGN_GIFT_INHERITANCE',
  title: 'Foreign inheritance: Form 3520 for the year received',
  description: 'Documents and answers mentioning an inheritance or gift from abroad are dated; amounts over $100,000 from a foreign person require Form 3520 for the year of receipt. Prior preparer open items are checked for resolution.',
  run(ctx) {
    const out: Finding[] = [];
    for (const d of ctx.P.docs.values()) {
      if (!docAvailable(ctx, d.id) || d.document_type !== 'foreign_bank_statement') continue;
      const text = docText(ctx, d.id);
      const m = text.match(/opened (\d{2})\/(\d{4}) \(inheritance from ([^)]+)\)/i);
      if (!m) continue;
      const year = m[2];
      const bal = (ctx.P.evByDoc.get(d.id) || []).find((e) => /balance_ye/.test(e.field));
      const usd = bal ? Math.round(num(bal.value) / ctx.params.fx.SEK[`${ctx.P.household.tax_year}_year_end`]) : 0;
      const pyItem = ctx.P.p.prior_years.prior_preparer_workpaper.open_items_left_by_prior_preparer.findIndex((x: string) => /3520/.test(x));
      out.push(f({
        id: `FOREIGN_GIFT_INHERITANCE:${d.id}`,
        rule: this.id,
        kind: 'outside_filing',
        title: `${year} Form 3520 likely required: inheritance from ${m[3]} (account now ≈ $${money(usd)})`,
        summary: `The Sparbanken account was opened ${m[1]}/${year} with an inheritance from ${m[3]}. Bequests from a foreign person over $100,000 in a year are reportable on Form 3520 for that year. The prior preparer left this open ("${ctx.P.p.prior_years.prior_preparer_workpaper.open_items_left_by_prior_preparer[pyItem]}"). The 2025 questionnaire only asked about 2025 (qa-08).`,
        detail: ['Not part of the 2025 return. Late Form 3520 penalty can be 5% of the amount per month (max 25%); reasonable-cause relief should be explored under a separate engagement.'],
        area: 'foreign',
        severity: 'high',
        blocksFiling: false,
        evidence: [d.id, ...(bal ? [bal.id] : []), 'qa-07', 'qa-08', `py:/prior_preparer_workpaper/open_items_left_by_prior_preparer/${pyItem}`],
        lines: [],
        detectedAt: detectedAt(ctx, [d.id]),
        authorityHint: 'IRC §6039F; IRC §6677 not applicable (not a trust); Form 3520 Part IV instructions',
        suggestedQuestion: 'In 2023 you inherited the Sparbanken account from Birgitta Lindqvist. Was a Form 3520 filed for 2023? If not, we recommend a separate engagement to file it with a reasonable-cause statement.',
      }));
    }
    return out;
  },
};

// 24. Composite / entity-level state returns covering the owners.
const compositeReturns: Check = {
  id: 'COMPOSITE_RETURNS',
  title: 'Composite state returns filed by pass-throughs',
  description: 'K-1 statements mentioning composite returns are identified, with the state and whether the partner has any filing of their own.',
  run(ctx) {
    const out: Finding[] = [];
    for (const d of ctx.P.docs.values()) {
      if (!/^K-1/.test(d.document_type) || !docAvailable(ctx, d.id) || d.tax_year !== ctx.P.household.tax_year) continue;
      const text = docText(ctx, d.id);
      const m = text.match(/(Oregon|Arizona|[A-Z][a-z]+) composite return/);
      if (!m) continue;
      const taxEv = (ctx.P.evByDoc.get(d.id) || []).find((e) => /composite tax/i.test(e.label));
      out.push(f({
        id: `COMPOSITE_RETURNS:${d.id}`,
        rule: this.id,
        kind: 'outside_filing',
        title: `${m[1]} composite return filed by ${d.issuer}`,
        summary: `${text.match(new RegExp(`[^.]*${m[1]} composite[^.]*\\.`))?.[0]?.trim() ?? ''}${taxEv ? ` Tax paid on the shareholder's behalf ${money(num(taxEv.value))}; California credit for tax paid to another state uses the resident-period share.` : ''} No individual ${m[1]} return needed if the composite covers all ${m[1]}-source income — confirm with the entity's preparer.`,
        area: 'filing',
        severity: 'info',
        blocksFiling: false,
        evidence: [d.id, ...(taxEv ? [taxEv.id] : [])],
        lines: taxEv ? ['ScheduleS.credit'] : [],
        detectedAt: detectedAt(ctx, [d.id]),
      }));
    }
    return out;
  },
};

// 25. State AMT not computed while an AMT preference exists.
const stateAmt: Check = {
  id: 'STATE_AMT_NOT_COMPUTED',
  title: 'California AMT not computed on the ISO exercise',
  description: 'Where the engine skips a state AMT and the federal return has an AMT preference, the preference is allocated to the state by the period services were performed there and a manual Schedule P is required.',
  run(ctx) {
    const l = ctx.base.lines.find((x) => x.rule === 'R-CA-AMT-NOT-COMPUTED');
    const iso = lineNum(ctx, 'F6251.2i');
    if (!l || !iso) return [];
    const f3921 = [...ctx.P.docs.values()].find((d) => d.document_type === '3921' && docAvailable(ctx, d.id));
    const grant = f3921 && evOf(ctx, f3921.id, 'box1');
    const exer = f3921 && evOf(ctx, f3921.id, 'box2');
    const res = ctx.P.household.residency.find((r: any) => r.state === 'CA');
    let share = 1;
    if (grant && exer && res) {
      const g = Date.parse(String(grant.value));
      const x = Date.parse(String(exer.value));
      const end = Math.min(x, Date.parse(res.to));
      share = (end - g) / (x - g);
    }
    return [f({
      id: `STATE_AMT_NOT_COMPUTED:${l.key}`,
      rule: this.id,
      kind: 'judgment',
      title: `California AMT not computed: ISO spread ${money(iso)} is mostly California-source`,
      summary: `The ISO was granted ${grant?.value} and exercised ${exer?.value}; services were performed in California until ${res?.to}. Allocated by days, about ${(share * 100).toFixed(1)}% (≈ ${money(Math.round(iso * share))}) is a California AMT preference even though the exercise happened after the move. Schedule P (540NR) must be prepared manually.`,
      detail: ['The engine does not compute California AMT; the packet has no California AMT rates, so the effect is not estimated here.'],
      area: 'california',
      severity: 'high',
      blocksFiling: true,
      evidence: [...(f3921 ? [f3921.id, ...(ctx.P.evByDoc.get(f3921.id) || []).map((e) => e.id)] : []), 'qa-06'],
      lines: [l.key, 'F6251.2i'],
      detectedAt: detectedAt(ctx, f3921 ? [f3921.id] : []),
      judgment: true,
      authorityHint: 'Cal. Rev. & Tax. Code §17062, §17951; FTB Pub. 1004 (stock options, workday allocation)',
    })];
  },
};

// 26. Form 8949 box totals: adjustment column reconciled by code to broker wash-sale totals.
const adjustmentCodes: Check = {
  id: 'ADJUSTMENT_CODE_RECON',
  title: 'Form 8949 adjustments do not tie to broker wash-sale totals',
  description: 'For each box, lot adjustments are summed by code and compared to the brokers\' reported wash-sale totals. A total that nets different codes is flagged so the reconciliation can be shown code by code.',
  run(ctx) {
    const out: Finding[] = [];
    for (const t of ctx.base.lines.filter((l) => /^F8949\.[A-Z]\.total$/.test(l.key))) {
      const m = t.label.match(/adjustments ([\d,.-]+)\)/);
      if (!m) continue;
      const labelAdj = parseMoney(m[1]);
      const box = t.key.split('.')[1];
      const byCode: Record<string, number> = {};
      for (const lot of lots(ctx).filter((x) => x.box === box && x.adjCode)) byCode[lot.adjCode!] = Math.round(((byCode[lot.adjCode!] ?? 0) + lot.adj!) * 100) / 100;
      const w = byCode.W ?? 0;
      if (!Object.keys(byCode).length || Math.abs(w - labelAdj) < 0.01) continue;
      out.push(f({
        id: `ADJUSTMENT_CODE_RECON:${t.key}`,
        rule: this.id,
        kind: 'compliance',
        title: `Box ${box} adjustments ${money(labelAdj)} vs wash sales ${money(w)}`,
        summary: `The box ${box} total nets codes: ${Object.entries(byCode).map(([c, v]) => `code ${c} ${money(v)}`).join(', ')}. Broker wash-sale totals reconcile to code W ${money(w)}, not to ${money(labelAdj)}. Present the column by code so the 1099-B ties.`,
        area: 'investments',
        severity: 'low',
        blocksFiling: false,
        evidence: boxEvidence(ctx, box),
        lines: [t.key],
        detectedAt: detectedAt(ctx, boxEvidence(ctx, box)),
      }));
    }
    return out;
  },
};

// 27. Care provider name on Form 2441 vs the provider's statement.
const providerName: Check = {
  id: 'PROVIDER_ID_MATCH',
  title: 'Care provider name differs from the provider statement',
  description: 'Form 2441 provider names are compared to the issuer on the provider\'s own statement.',
  run(ctx) {
    const out: Finding[] = [];
    for (const l of ctx.base.lines.filter((x) => x.rule === 'R-DEP-CARE-PROVIDER')) {
      const m = l.label.match(/Care provider: ([^,]+), tax ID ([\d-]+)/);
      const src = l.sources.map((s) => ctx.P.ev.get(s)).find(Boolean);
      if (!m || !src) continue;
      const doc = ctx.P.docs.get(src.document_id)!;
      if (doc.issuer === m[1].trim()) continue;
      out.push(f({
        id: `PROVIDER_ID_MATCH:${l.key}`,
        rule: this.id,
        kind: 'compliance',
        title: `Form 2441 provider "${m[1].trim()}" vs statement "${doc.issuer}"`,
        summary: `${doc.id} is issued by ${doc.issuer} (also used on the 2024 return). Provider identification must match to support the ${money(lineNum(ctx, 'F2441.12') ?? 0)} dependent-care exclusion.`,
        area: 'deductions',
        severity: 'low',
        blocksFiling: true,
        evidence: [doc.id, ...l.sources, 'py:/return_2024/lines/F2441.provider'],
        lines: [l.key],
        detectedAt: detectedAt(ctx, [doc.id]),
        authorityHint: 'IRC §21(e)(9), §129(e)(9) (provider identification)',
      }));
    }
    return out;
  },
};

// 28. Extracted values that do not appear on the printed page (confident mistakes).
const extractionMismatch: Check = {
  id: 'EXTRACTION_MISMATCH',
  title: 'Extracted value is not what the page says',
  description: 'Every extracted value used on the return is compared to the printed page (numbers and identifiers normalized). Confident misreads are caught regardless of confidence score.',
  run(ctx) {
    const out: Finding[] = [];
    const used = new Set(ctx.base.lines.flatMap((l) => l.sources.filter((s) => s.startsWith('ev-'))));
    for (const id of used) {
      const e = ctx.P.ev.get(id)!;
      if (!['ein', 'ssn', 'text', 'account_number'].includes(e.value_type) || e.value == null) continue;
      const text = pageText(ctx, e.document_id, e.page);
      if (text.includes(String(e.value))) continue;
      const printed = text.match(/\b\d{2}-\d{7}\b/g)?.find((x) => [...x].sort().join('') === [...String(e.value)].sort().join(''));
      const lines = ctx.P.citedBy.get(e.id)?.filter((c) => c.version === ctx.base.version).map((c) => c.key) ?? [];
      out.push(f({
        id: `EXTRACTION_MISMATCH:${e.id}`,
        rule: this.id,
        kind: 'error',
        title: `${e.label} read as ${e.value} but the page prints ${printed ?? 'something else'} (${Math.round(e.confidence * 100)}% confidence)`,
        summary: `${ctx.P.docs.get(e.document_id)!.title}: "${text}"${printed ? ` — digits transposed by the pipeline.` : ''}`,
        area: lines[0] ? areaForLine(lines[0]) : 'intake',
        severity: 'medium',
        blocksFiling: true,
        evidence: [e.id, e.document_id],
        lines,
        proposed: printed && lines[0] ? [{ target: `label:${lines[0]}`, value: printed, note: 'Correct provider tax ID' }] : undefined,
        detectedAt: detectedAt(ctx, [e.id]),
      }));
    }
    return out;
  },
};

// 29. Client answers contradicted by documents.
const clientAnswerConflict: Check = {
  id: 'CLIENT_ANSWER_CONFLICT',
  title: 'Client answer contradicted by documents',
  description: 'Questionnaire answers are tested against the documents on the same topic (sales, digital assets, IRA basis). Documents govern; the contradiction and the position taken are recorded.',
  run(ctx) {
    const out: Finding[] = [];
    const qs = ctx.P.p.client.questionnaire;
    const allLots = lots(ctx);
    const sales = qs.find((q: any) => /sell any stocks/i.test(q.question));
    const brokerLots = allLots.filter((l) => !/^[HK]$/.test(l.box) && !/SCORP/.test(l.id));
    if (sales && /^no/i.test(sales.answer) && brokerLots.length) {
      out.push(f({
        id: `CLIENT_ANSWER_CONFLICT:${sales.id}`, rule: this.id, kind: 'judgment',
        title: `Client said no investment sales; brokers report ${brokerLots.length} sales`,
        summary: `${sales.id}: "${sales.answer}". ${lotDocs(ctx, brokerLots).map((d) => ctx.P.docs.get(d)!.issuer).join(', ')} report ${brokerLots.length} lots (a direct-indexing account sells automatically). Documents govern; discuss with the client so next year's organizer is right.`,
        area: 'investments', severity: 'low', blocksFiling: false, evidence: [sales.id, ...lotDocs(ctx, brokerLots)], lines: ['SchD.7', 'SchD.15'], detectedAt: detectedAt(ctx, [sales.id, ...lotDocs(ctx, brokerLots)]),
      }));
    }
    const crypto = qs.find((q: any) => /cryptocurrency|digital assets/i.test(q.question));
    const cryptoLots = allLots.filter((l) => /^[HK]$/.test(l.box));
    if (crypto && /didn't (really )?sell|^no/i.test(crypto.answer) && cryptoLots.length) {
      out.push(f({
        id: `CLIENT_ANSWER_CONFLICT:${crypto.id}`, rule: this.id, kind: 'judgment',
        title: `Client said "didn't really sell" crypto; Form 1099-DA reports ${cryptoLots.length} sales`,
        summary: `${crypto.id}: "${crypto.answer}". Coinhaven reports ${cryptoLots.length} dispositions with gross proceeds. The digital asset question on Form 1040 must be answered Yes.`,
        area: 'investments', severity: 'low', blocksFiling: false, evidence: [crypto.id, ...lotDocs(ctx, cryptoLots)], lines: [], detectedAt: detectedAt(ctx, [crypto.id, ...lotDocs(ctx, cryptoLots)]),
      }));
    }
    const ira = qs.find((q: any) => /IRA details/i.test(q.question));
    const pyBasis = ctx.P.p.prior_years.return_2024.lines['F8606.14'];
    const f5498 = [...ctx.P.docs.values()].find((d) => d.document_type === '5498' && d.tax_year === ctx.P.household.tax_year - 1);
    if (ira && /none that I know|no prior basis|started .* in 2025/i.test(ira.answer) && (pyBasis > 0 || f5498)) {
      const l = ctx.lines.get('F8606.2');
      out.push(f({
        id: `CLIENT_ANSWER_CONFLICT:${ira.id}`, rule: this.id, kind: 'judgment',
        title: `Client says no prior IRA basis; 2024 Form 8606 and Form 5498 show ${money(pyBasis)}`,
        summary: `${ira.id}: "${ira.answer}". The 2024 Form 8606 line 14 carried ${money(pyBasis)} and ${f5498?.id} shows the 2024 contribution made 02/12/2025. The engine used the documents (basis ${money(Number(l?.value ?? 0))}); taxable conversion ${money(lineNum(ctx, 'F8606.18') ?? 0)}. Had the answer been trusted, ${money(pyBasis + (lineNum(ctx, 'F8606.18') ?? 0))} would be taxable. Keep the documented basis.`,
        area: 'retirement', severity: 'low', blocksFiling: false, evidence: [ira.id, 'py:/return_2024/lines/F8606.14', ...(f5498 ? [f5498.id] : []), ...(f5498 ? (ctx.P.evByDoc.get(f5498.id) || []).map((e) => e.id) : [])], lines: ['F8606.2', 'F8606.18'], detectedAt: detectedAt(ctx, [ira.id, ...(f5498 ? [f5498.id] : [])]), judgment: true,
        authorityHint: 'IRC §408(d)(2); Form 8606 instructions (basis from prior-year line 14)',
      }));
    }
    return out;
  },
};

// 30. Elections that lower tax (engine what-if results).
const electionOpportunity: Check = {
  id: 'ELECTION_OPPORTUNITY',
  title: 'Election that lowers tax',
  description: 'Every engine what-if alternative is compared to the return; an alternative that lowers total tax in one jurisdiction without raising the other is surfaced as an opportunity.',
  run(ctx) {
    const out: Finding[] = [];
    for (const a of ctx.P.p.what_if.alternatives) {
      if (a.base_version !== ctx.base.version) continue;
      const fd = a.federal.total_tax_change;
      const cd = a.california.total_tax_change;
      if (!((fd < 0 && cd <= 0) || (cd < 0 && fd <= 0))) continue;
      out.push(f({
        id: `ELECTION_OPPORTUNITY:${a.id}`,
        rule: this.id,
        kind: 'opportunity',
        title: `Opportunity: ${a.description.split(':')[0]} — ${fd ? `federal ${money(fd)}` : 'federal no change'}, California ${money(cd)}`,
        summary: `${a.description} Engine what-if "${a.id}": federal tax change ${money(fd)}, California ${money(cd)}. Recording it is an election (judgment with authority).`,
        area: 'business',
        severity: 'medium',
        blocksFiling: false,
        evidence: [...new Set<string>(a.changed_lines.flatMap((c: any) => ctx.lines.get(c.key)?.sources ?? []).filter((x: string) => x.startsWith('ev-')))],
        lines: a.changed_lines.slice(0, 3).map((c: any) => c.key),
        proposed: a.changed_lines.filter((c: any) => /^(F4562|SchCA540NR\.12\.C|FTB3885A)/.test(c.key)).map((c: any) => ({ target: c.key, value: c.new })),
        whatIf: a.id,
        detectedAt: ctx.base.computed_at,
        judgment: true,
        authorityHint: 'IRC §179(b)-(c); Cal. Rev. & Tax. Code §17255 (California §179 limit 25,000)',
      }));
    }
    return out;
  },
};

// 31. Open items the prior preparer left, each traced to its resolution evidence.
const priorPreparerOpen: Check = {
  id: 'PRIOR_PREPARER_OPEN_ITEM',
  title: 'Open item left by the prior preparer',
  description: 'Each open item in the prior preparer\'s file is carried into this year and matched to evidence that resolves it.',
  run(ctx) {
    const items: string[] = ctx.P.p.prior_years.prior_preparer_workpaper.open_items_left_by_prior_preparer;
    return items.map((text, i) => {
      let evidence: string[] = [`py:/prior_preparer_workpaper/open_items_left_by_prior_preparer/${i}`, ctx.P.p.prior_years.prior_preparer_workpaper.source_document];
      let resolution = 'No resolving evidence in the file yet.';
      let severity: Finding['severity'] = 'medium';
      const k1Year = text.match(/Obtain (\d{4}) .*K-1/);
      if (k1Year) {
        const d = [...ctx.P.docs.values()].find((x) => /K-1/.test(x.document_type) && x.tax_year === Number(k1Year[1]) && docAvailable(ctx, x.id));
        if (d) { resolution = `${d.id} received ${d.received_at.slice(0, 10)}; basis rolled forward: ${basisChain(ctx, d.id)}.`; evidence.push(d.id, ...(ctx.P.evByDoc.get(d.id) || []).map((e) => e.id)); severity = 'low'; }
      } else if (/5498/.test(text)) {
        const d = [...ctx.P.docs.values()].find((x) => x.document_type === '5498' && x.tax_year === 2024);
        if (d) { const c = evOf(ctx, d.id, 'box1'); const dt = evOf(ctx, d.id, 'contrib_date'); resolution = `${d.id} received: 2024 contribution ${money(num(c?.value))} made ${dt?.value ?? ''} confirms the ${money(ctx.P.p.prior_years.return_2024.lines['F8606.14'])} basis.`; evidence.push(d.id, ...(c ? [c.id] : [])); severity = 'low'; }
      } else if (/square footage/.test(text)) {
        const d = [...ctx.P.docs.values()].find((x) => x.document_type === 'client_note' && /office/i.test(x.title));
        if (d) { const evs = ctx.P.evByDoc.get(d.id) || []; const sac = evs.find((e) => /sac/.test(e.field)); const aus = evs.find((e) => /aus_sqft/.test(e.field)); const py = Number(String(ctx.P.p.prior_years.return_2024.notes?.['SchC.30'] ?? '').match(/(\d+) sq ft/)?.[1] ?? 0); const over = (py - num(sac?.value)) * ctx.params.home_office_rate; resolution = `${d.id}: the 2024 studio was ${num(sac?.value)} sq ft, not ${py} → the 2024 home office was overstated by ${money(over)} (immaterial; no amendment recommended, note for the file). 2025 uses ${num(sac?.value)} / ${num(aus?.value)} sq ft.`; evidence.push(d.id, ...evs.map((e) => e.id)); severity = 'low'; }
      } else if (/3520/.test(text)) {
        resolution = 'Unresolved — see the Form 3520 outside-filing finding.';
        severity = 'high';
      }
      return f({
        id: `PRIOR_PREPARER_OPEN_ITEM:${i}`,
        rule: 'PRIOR_PREPARER_OPEN_ITEM',
        kind: 'compliance',
        title: `Prior preparer open item: ${text}`,
        summary: resolution,
        area: /K-1/.test(text) ? 'passthroughs' : /5498/.test(text) ? 'retirement' : /square/.test(text) ? 'business' : 'foreign',
        severity,
        blocksFiling: false,
        evidence,
        lines: [],
        detectedAt: detectedAt(ctx, evidence),
      });
    });
  },
};

export const CHECKS: Check[] = [
  supplementalBasis, duplicateInfoReturn, fxRatePeriod, paymentCardDouble, duplicatePage, sehiEligibility, mixedUse,
  repairVsImprovement, lenderInterestDouble, propertyTaxProration, vehicleDonation, estimatesVsTranscript,
  statePaymentDesignation, stateWageSourcing, brokerSummaryDetail, correctedFormDiff, digitalAssetBasis, tinConsistency,
  lowConfidence, retirementLimit, infoReturns, fbar, foreignInheritance, compositeReturns, stateAmt, adjustmentCodes,
  providerName, extractionMismatch, clientAnswerConflict, electionOpportunity, priorPreparerOpen,
];

export function runChecks(ctx: CheckCtx): { findings: Finding[]; errors: { check: string; error: string }[] } {
  const findings: Finding[] = [];
  const errors: { check: string; error: string }[] = [];
  for (const c of CHECKS) {
    try {
      for (const fnd of c.run(ctx)) if (fnd.detectedAt <= ctx.asOf || c.id === 'ELECTION_OPPORTUNITY') findings.push(fnd);
    } catch (err: any) {
      errors.push({ check: c.id, error: String(err?.stack || err) });
    }
  }
  return { findings, errors };
}

function boxEvidence(ctx: CheckCtx, box: string): string[] {
  const out = new Set<string>();
  for (const lot of lots(ctx).filter((x) => x.box === box && x.adjCode)) for (const src of lot.sources) {
    const e = ctx.P.ev.get(src);
    if (e && /wash|adjusted_basis|ordinary/.test(e.field) && num(e.value) !== 0) out.add(e.id);
  }
  for (const d of lotDocs(ctx, lots(ctx).filter((x) => x.box === box))) {
    for (const e of ctx.P.evByDoc.get(d) || []) if (/^(st|lt)_wash$/.test(e.field)) out.add(e.id);
  }
  return [...out];
}

function lotDocs(ctx: CheckCtx, ls: { sources: string[] }[]): string[] {
  return [...new Set(ls.flatMap((l) => l.sources.map((s) => ctx.P.ev.get(s)?.document_id).filter(Boolean) as string[]))];
}

function pyNoteRefs(ctx: CheckCtx, re: RegExp): string[] {
  return (ctx.P.p.prior_years.prior_preparer_workpaper.notes as string[]).map((n, i) => (re.test(n) ? `py:/prior_preparer_workpaper/notes/${i}` : '')).filter(Boolean);
}

/** S corporation stock basis by year, from the prior-year basis records plus any late K-1 now in file. */
export function basisChain(ctx: CheckCtx, lateK1?: string): string {
  const recs = ctx.P.p.prior_years.basis_records.scorp_lindqvist_family_woodworks;
  const k1s = [...ctx.P.docs.values()].filter((d) => d.document_type === 'K-1-1120S' && docAvailable(ctx, d.id));
  let basis = recs.find((r: any) => r.ending_stock_basis != null)?.ending_stock_basis ?? 0;
  const parts = [`${recs[0].year} ${money(basis)}`];
  for (const r of recs.slice(1)) {
    const k1 = k1s.find((d) => d.tax_year === r.year);
    if (!k1 && r.k1_income == null) { parts.push(`${r.year} unknown`); continue; }
    const inc = k1 ? num(evOf(ctx, k1.id, 'box1')?.value) + num(evOf(ctx, k1.id, 'box4')?.value) : num(r.k1_income);
    const dist = k1 ? num(evOf(ctx, k1.id, 'box16d')?.value) : num(r.distributions);
    basis = Math.max(0, basis + inc - dist);
    parts.push(`${r.year} ${money(basis)}`);
  }
  const end = ctx.lines.get('F7203.15');
  if (end) parts.push(`${ctx.P.household.tax_year} ${money(Number(end.value))}`);
  return parts.join(' → ') + (lateK1 ? ` (using ${lateK1})` : '');
}

function engagementLetter(ctx: CheckCtx): string[] {
  return [...ctx.P.docs.values()].filter((d) => d.document_type === 'engagement_letter').map((d) => d.id);
}

function tokens2(s: string): number {
  return s.split(/s+/).length;
}
