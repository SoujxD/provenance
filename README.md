# Miraflores take-home — a web-native tax workpaper

A working workpaper for the Okafor-Lindqvist 2025 return (Form 1040 + California 540NR), built from the packet exactly as delivered.

**The idea in one line:** the workpaper is a *provenance graph* (the packet: documents → extracted values → return lines → summary, immutable and hash-verified) plus an *append-only, hash-chained event log* (every human act: adjustment, verification, note, question, sign-off, approval, filing). Every screen is a projection of graph + log as of a moment, so trace, replay, version compare, freeze-at-filing and amendments all fall out of one mechanism. See [docs/core-idea.md](docs/core-idea.md).

| Document | What it is |
|---|---|
| [docs/core-idea.md](docs/core-idea.md) | One page: the idea and the data model diagram |
| [docs/errors-found.md](docs/errors-found.md) | Each packet error → how the design surfaced it → evidence → fed/CA effect → resolution |
| [docs/APPROACH.md](docs/APPROACH.md) | How I framed the problem, key decisions with alternatives, what I cut, what's next |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Timestamped decision log kept while building |
| [docs/video-outline.md](docs/video-outline.md) | The 5–7 minute demo script |

## Try it

Open **https://provenance-production-7756.up.railway.app**. Each visitor gets a private workspace at `/w/<id>`; share that URL to collaborate live (open it in two browsers as two different people). A 60-second **Start here** tour runs on first load: trace a number → see a finding → switch role. `Ctrl/⌘ K` searches everything.

- **Role switcher** (top right): Priya (preparer), Daniel (reviewer), Helen (partner), Marcus (preparer, no clearance → masked), Jo (firm administrator), Sam (quality reviewer, inactive until 2027-01-04), and the clients Ngozi and Erik (client portal). It stands in for sign-in; every rule is enforced on the server.
- **Season clock**: the workpaper opens on 2026-06-23 (engine v3 is current, per the packet README). "Advance" plays the packet timeline; client approval and e-file are gates only real in-app actions can pass. Nothing is seeded — no reviews, sign-offs or answers.

## Run locally

Requires **Node 24+** (uses the built-in `node:sqlite` and native TypeScript; no native modules, no build step for the server).

```bash
npm install
npm run dev          # API on :8787 (watch) + Vite on :5173 → open http://localhost:5173
# or production-style:
npm run build && npm start   # → http://localhost:8787
npm test             # 37 tests: every check on the real packet issues, the event log, a full-season flow
npm run typecheck
```

Data lives in `data/workpaper.db` (override with `DB_PATH` or `DATA_DIR`). The packet is read from `okafor_lindqvist_2025_packet.json` in the working directory (or `PACKET_PATH`); its sha256 is recorded in every workspace's genesis event. `.gitattributes` keeps it byte-exact.

## Deploy (one app, one persistent volume)

The Docker image serves the API and the built client on port 8080 and keeps SQLite on `/data`.

**Fly.io** (config in `fly.toml`):
```bash
fly launch --copy-config --no-deploy        # pick a unique app name
fly volumes create workpaper_data --size 1
fly deploy
```

**Render**: New → Blueprint → this repo (`render.yaml`, Docker runtime, 1 GB disk at `/data`).

**Railway**: New project → Deploy from repo (`railway.json`), then add a volume mounted at `/data` and set `DATA_DIR=/data`.

Health check: `GET /api/health`.

## Map of the code

```
src/server/
  packet.ts      load the packet byte-exact, sha256, indexes, reference resolver (ev-, D.., qa-, py:/, agency:/ …)
  calc.ts        "our" version: R-SUM signs inferred from engine values, re-evaluation of arithmetic rules,
                 stale-marking below non-linear rules, tax effect at category anchors × published rates
  checks/        31 independent, generic check rules (ctx.ts helpers, rules.ts)
  events.ts      append-only, hash-chained event log (SQLite triggers forbid UPDATE/DELETE)
  state.ts       fold(events, asOf) → workpaper state; undo = "ignore this batch"
  derive.ts      everything a screen needs: findings + effects, sign-off validity, gate, documents, notifications
  commands.ts    the only way to write: validation against the firm's standards and roles, e-file simulator, freeze
  season.ts      season clock and the scripted packet timeline (with gates)
  outputs.ts     client copy, exam binder (self-contained HTML), roll-forward package
  access.ts      people, roles, permission matrix
src/client/      React app: overview, findings inbox, areas, trace drawer, documents (DocumentSource), adjustments
                 & what-if, versions, records, timeline replay, filing, notice, roll-forward, people, admin, portal
tests/           checks.test.ts · events.test.ts · flow.test.ts
```

## Deployed URL

**https://provenance-production-7756.up.railway.app** — opens a fresh private workspace with the 60-second "Start here" tour (bottom-right; restart it any time from the **Start here** button in the top bar). Health: `/api/health`.
