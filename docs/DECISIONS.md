# Decision log

One line per decision, newest last. Times are local (2026-10-13 build day).

- 20:58 — Read the brief and the whole packet before writing code; mapped every packet error to a generic rule before designing screens.
- 21:20 — Core idea: provenance graph (packet, immutable) + append-only, hash-chained event log (every human act). Every screen is a projection of graph + log "as of" a moment. Rejected: mutable tables with audit triggers (history becomes a second-class copy; replay and freeze get bolted on).
- 21:24 — Load the packet file byte-for-byte and record its sha256 in the genesis event of every workspace. Never re-serialize or normalize it.
- 21:26 — Server on Node 24 with built-in `node:sqlite` and native TypeScript (type stripping): zero native dependencies, no build step for the server, same code on Windows and in Docker. Rejected: better-sqlite3 (native build), Postgres (extra service for a single-tenant demo).
- 21:30 — "Our version" of the return = engine version + overrides, recomputed through every rule that is pure arithmetic (R-SUM with signs inferred from the engine's own numbers, R-CARRY, SALT cap, deduction choice, CA itemized, standard mileage). Lines below rules we cannot evaluate are marked "stale", never silently wrong.
- 21:34 — Tax effect measured at category "anchor" lines (wages, interest, Sch C profit, ST/LT gains, ordinary, adjustments, itemized; payments and credits 1:1) × the version's published rates; engine what-if results used verbatim where they exist; everything else labeled "estimate". This makes the SALT-cap crossing (property tax finding) come out right without special cases.
- 21:40 — Independent checks are generic rules over documents/extracted values/answers/agency records (31 rules), each with a plain-language description. They never contain an answer for this household; evidence is found by document type, field and text.
- 21:52 — Checks are time-aware: a finding's "detected at" is when its evidence became available; corroboration (msg-07, msg-08) only appears once the message has arrived in season time.
- 21:55 — Sign-offs store the hash *and* the snapshot of what was signed, so a reopened sign-off shows exactly what changed (line-level diff), not just "something changed".
- 21:58 — Undo is an event (`batch.undone`) that the fold honors by skipping the batch; nothing is deleted. SQLite triggers forbid UPDATE/DELETE on events.
- 22:00 — Per-visitor workspaces (URL `/w/<id>`): strangers on the shared link never collide; sharing the URL is how two people collaborate live. Rejected: one global workspace (first evaluator to file the return ruins it for everyone).
- 22:02 — Season clock starts 2026-06-23 (v3 current, per the README). Later packet timeline events are a script; approval and e-file are gates that only real in-app actions can pass. No reviews, sign-offs or answers are seeded.
- 22:04 — E-file is simulated honestly: the agency compares each TIN on the return to the agency's records (SSA card / third-party filings). If the organizer SSN is still on the return, the packet's exact rejection R0000-504-02 comes back; fix → retransmit → accepted → freeze.
- 22:05 — Freeze at federal acceptance: canonical snapshot of lines, adjustments, findings, sign-offs and approvals stored content-addressed; after that only an amendment layer accepts changes.
- 22:06 — Masking is server-side on every response (known sensitive values from the packet + any SSN-shaped string). Cleared staff reveal one value at a time; each reveal is an event. Marcus (no clearance) is refused by the server, not by a hidden button.
- 22:08 — Identity is a role switcher (x-actor header) — a stand-in for SSO, stated as a tradeoff. All rules (no self-review, partner threshold, authority on judgments, inactive users) are enforced in the command layer.
- 22:40 — Client split into small views over one store; every number is a `Num` that opens the trace drawer; computed lines follow their inputs down to extracted values so every trace ends at a document page.
- 23:05 — `DocumentSource` interface: simulated source highlights the exact text span from `printed_content` (positions are synthetic, shown on a page map); `FileDocumentSource` renders an uploaded scan/PDF with the same boxes.
- 23:30 — Added an end-to-end season test through the command layer. It found three real bugs: ISO times compared as strings with and without milliseconds (season times now always whole seconds), an old reopened sign-off shadowing a newer one (only the latest per scope/level counts), and a prior rejection blocking re-approval.
- 23:45 — Duplicate-page detection switched from similarity to containment: a re-scan is the original plus an annotation, so similarity under-scores it.
- 23:50 — Some engine "carries" are sums (Schedule D line 10 = boxes F + K); sign inference now recognizes them, so new long-term lots propagate.
- 00:20 — Browser-driven walkthrough (UI only, as each person) found the most important bug: masked values in responses were sent back as data (Theo's SSN became "•••-••-3390"). The server now resolves masked tokens to the unique sensitive value, or refuses; regression test added.
- 00:35 — Bulk actions added where the real workflow needs them (sign off all my areas, resolve/close selected, verify carryovers and payments) — every bulk action is one undoable batch.
- 00:45 — Gated "Advance" is disabled with the reason as tooltip (no dead buttons); phone-width layout verified with no horizontal scroll.
