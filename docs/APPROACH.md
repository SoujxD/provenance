# Approach

## The problem as I framed it

A workpaper is an **argument that a return is right**, made to several audiences over a decade. The preparer needs to work through it, the reviewer and partner need to trust it, and the client needs to approve it. The next preparer has to inherit it, and an IRS examiner in 2028 has to be convinced by it. A spreadsheet stores numbers. What these readers need is *claims with evidence*, *a record of judgments*, and *the ability to see the file as it stood on any day*.

So I designed for three questions that every screen must answer instantly: **Where did this number come from? What has anyone done to it, and why? What is still open, and does it stop us filing?** I also took the packet's warning seriously ("contains confident mistakes"). Nothing the pipeline or engine says is trusted until it is checked against the document it came from.

## Core idea

**Provenance graph + append-only event log.** The packet becomes an immutable graph (document → page → extracted value → line → summary), hash-verified at load. Every human act is a hash-chained event. Every view is `fold(events ≤ t) ⊕ facts available at t`. Trace, replay, version compare, sign-off reopen, freeze-at-filing, amendments and the exam binder are all the same mechanism, not features bolted on. ([core-idea.md](core-idea.md) has the diagram.)

## Key decisions

| Decision | Alternatives considered | Why / tradeoff |
|---|---|---|
| **Event-sourced state**: append-only log, hash chain, SQLite triggers forbid UPDATE/DELETE; undo = an event that tells the fold to skip a batch | Mutable tables + audit triggers; soft deletes | History is the primary record, so replay and "changed since I last looked" are free. Cost: every read is a fold. It's fine here (hundreds of events, ~50 ms), and would need snapshots at firm scale. |
| **"Our return" without the engine**: re-evaluate pure-arithmetic rules (R-SUM signs *inferred from the engine's own numbers*, SALT cap, deduction choice…); mark lines below unevaluable rules *stale* | Show only deltas; or re-implement the tax engine | Honest: recomputed numbers are exact, approximate ones are marked "≈", and stale ones are never presented as new. Re-implementing the engine would contradict the brief ("treat the engine as given"). |
| **Tax effect at category anchors** (where a change enters wages/interest/Sch C/ST/LT/adjustments/itemized) × published rates; what-if results verbatim; payments/credits 1:1; everything labeled | Ask the user to pick a rate per adjustment | Generic and correct by construction. The SALT-cap case (property tax drops the total under the cap) comes out right with no special-casing. Estimates are always labeled as estimates. |
| **Checks are generic rules over evidence** (31 of them, each with a plain-language description, time-aware) | Hard-coded "known issues" list | A stranger can read the rule and believe it would catch the same mistake on another return. Tests prove each fires on the real packet issue. Cost: more code than a list. |
| **Season clock + scripted timeline with gates**: opens on 2026-06-23 (v3 current); approval and e-file can only be passed by real in-app actions under the firm's rules | Replay the scripted outcomes; or start at January | No fake reviews. The packet's e-file rejection is reproduced *honestly* by an agency simulator that checks TINs, so reject → fix → accept is a real flow, not a slideshow. |
| **Sign-offs store hash + snapshot** of their scope; only the latest per scope/level counts | Store a boolean; or just a hash | A reopened sign-off says *exactly* what changed ("SchB.1.6: 1,747 → 1,871; ADJ-002 added"), which is what a reviewer needs to re-review quickly. |
| **Per-visitor workspaces** at `/w/<id>`; share the URL to collaborate live (SSE + presence) | One shared demo database | Strangers on a cold link never collide, and collaboration is still one click away. |
| **Zero native dependencies**: Node 24 built-in SQLite + native TypeScript, React/Vite, no server framework | Express + better-sqlite3 + Postgres | Same code runs on Windows and in Docker with nothing to compile. `node:sqlite` is still flagged experimental. That's an accepted risk for a prototype. |
| **Server-side masking** of every response; cleared staff reveal one value at a time, each reveal is an event | Client-side hiding | Marcus is refused by the server, not by a hidden button; the view log is evidence for the firm. |

## What I deliberately cut, and why

- **Real authentication.** The role switcher stands in for SSO. Every rule (no self-review, partner threshold, authority on judgments, inactive users, clearance) is enforced server-side, so swapping in real identity changes one function.
- **Re-running the engine.** Out of scope by the brief. The workpaper marks what needs recomputation instead of guessing.
- **California AMT computation.** The packet has no CA AMT rates. The workpaper allocates the preference (≈98.7% CA-source) and flags a manual Schedule P instead of inventing a number.
- **Real PDF rendering.** No page images exist. The `DocumentSource` interface and a working `FileDocumentSource` (attach a scan to `doc:Dxx`) show the swap path.
- **Event-log snapshots, multi-tenant RBAC, retention jobs, e-signature integrations.** Each is straightforward on this design. None is needed to prove it.

## What I'd build next with real documents and a real engine

1. **Engine in the loop.** Send our overrides to the engine and replace "≈/stale" with recomputed lines. Each recompute becomes a version in the same graph, so v4 diffs against v3 like the others.
2. **Real page geometry.** OCR word boxes make `locate()` exact; the highlights and page map already consume boxes.
3. **Check library as data.** Rules with fixtures from many returns, precision/recall per rule, and a "propose a new rule from this finding" loop for reviewers.
4. **Cross-return links.** The household's related returns (Ada's 1040, the Woodworks 1120-S, Ridgeline) as linked graphs, so a K-1 change flows into basis on both sides.
5. **Firm scale.** Snapshot-plus-tail folds, Postgres, per-firm encryption keys for sensitive fields, retention and legal-hold events, and analytics across clients ("which checks fire most, which reviewers clear fastest").
