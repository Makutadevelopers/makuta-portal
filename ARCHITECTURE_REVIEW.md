# Makuta Portal — Architecture Review, Ratings & Action Plan

**Date:** 2026-05-23
**Reviewer:** Principal-architect pass (read-only audit + prod measurements)
**Scope:** ~16k LOC client (React 18 + TS + Vite), ~13k LOC server (Node/Express + TS),
PostgreSQL on RDS (24 tables, 50 migrations), AWS S3, single EC2 host.
**Method:** Code audit across security / backend / data model / frontend / testing / ops,
plus read-only prod queries (row counts, table inventory). Headline claims were
re-verified against the code; agent over-statements corrected (noted inline).

---

## 1. Executive Summary

**Overall rating: 6.5 / 10 — "Production-running, fundamentally sound, operationally fragile."**

This is a capable, money-handling application with rigorous financial logic and solid
security fundamentals — not a prototype. The weak spots are: a few god-files, near-zero
frontend tests, a deploy pipeline with no safety rail, and a data-access pattern that
fetches whole datasets to the browser. The performance pain (hang + slow load) traces to
one root cause and is largely addressable; the first two causes were fixed during this
review.

### Measured facts
- 3,566 live invoices (3,679 incl. soft-deleted); 2,290 payments; 216 vendors.
- Per-site spread: Nirvana 2,108 · Taranga 985 · Horizon 310 · others <100.
- 24 DB tables (7 are repair/rollback snapshots, written by migrations, unread by the app).
- Response compression: **enabled**. HTTP caching/ETag: **absent**.

---

## 2. Scorecard

| Area | Rating | Verdict |
|---|---|---|
| Security | 6.5 | Strong basics (param SQL, bcrypt-12, RBAC, zod); gaps in rate-limiting + a stale diagnostic endpoint |
| Backend architecture | 6.5 | Clean layering except god controllers; import flow is N+1 + non-atomic |
| Data model | 7.2 | Best area — correct NUMERIC money, good FKs/constraints, soft-delete; denormalization debt |
| Frontend architecture | 6.5 | Good routing/caching; 2,854-line god components; ~60% duplication HO vs site |
| Type safety | 8.5 | Strict TS, effectively zero `any`, typed API layer |
| Testing | 5.0 | Server money/RBAC well tested; **zero** client tests |
| CI/CD & Ops | 6.5 | CI runs typecheck+tests; **deploy doesn't gate on CI**; no staging, no rollback |

---

## 3. What's Already Fixed (this review cycle — uncommitted)

1. **Windowed the 3 invoice tables** (InvoiceList, MyInvoices, VendorDetail) to 50 rows +
   "Show more". Eliminates the render hang (was painting all 3,566 rows = ~50k DOM nodes).
2. **Backed off polling** 20–60s → 120s across the 4 cached hooks. Stops the recurring
   ~20s freeze; data still refreshes on tab-focus and after every mutation.
3. **Dead-code cleanup**: removed 5 stub files, the abandoned offline-sync feature, and
   unused imports/locals.

Verified with `npm run typecheck` + `npm run build` (both pass). Not yet committed/deployed.

---

## 4. Why the Application Is Slow (root causes)

**The through-line:** the app fetches and processes the *entire* dataset in the browser
instead of asking the server for just what a screen needs. Compression masks transfer size,
but the server still serializes thousands of rows and the browser still parses/holds them.

| # | Cause | Status | Severity |
|---|---|---|---|
| 1 | Rendering all 3,566 rows at once → tab freeze | ✅ Fixed (windowing) | was Critical |
| 2 | 20–30s polling re-rendering/refetching everything | ✅ Fixed (120s) | was High |
| 3 | `/invoices` returns all 3,566 full-width rows on cold load (no pagination) | Open | High |
| 4 | Dashboard re-fetches the same full list + `/aging` + `/cashflow`, sums in JS | Open | High |
| 5 | Client-side aggregation in VendorMaster/SiteExpenditure/SiteDashboard/MgmtOverview | Open | Medium |
| 6 | No `AbortController` — superseded requests pile up and waste parsing | Open | Medium |
| 7 | No HTTP caching (ETag/Cache-Control) on reference data (vendors/categories/banks) | Open | Medium |
| 8 | Import is N+1 (~5,000 queries / 1,000 rows) → slow imports | Open | Medium |
| 9 | `inv.*` projection ships unused columns → wider payload | Open | Low |
| 10 | Missing indexes (`vendors(LOWER(name))`, `invoices(purpose)`) | Open | Low (latent) |
| 11 | O(n²) vendor dedup (Levenshtein) — trivial at 216 vendors today | Open | Low (latent) |
| 12 | Single EC2 box shared with CRM stack — possible resource contention | Watch | Low |
| 13 | Site-network connectivity (construction sites) magnifies large payloads | Environmental | — |

---

## 5. Detailed Findings by Area

### 5.1 Security — 6.5/10
**Strong:** 100% parameterized queries (no injection surface found); bcrypt cost 12; zod
validation on every endpoint; RBAC middleware + SQL site-scoping; secrets via env with
prod-strength checks; S3 upload whitelist + `path.basename` sanitization.
**Gaps:**
- **High** — no rate-limiting on login / change-password (global 200/min only). Add per-email login throttle.
- **Medium** — stale temp endpoint `GET /api/admin/import-audit`. *Correction:* it is behind `authenticate` + `requireRole(['ho'])`, so **not** the "critical open hole" first flagged — it's HO-gated dead weight. Remove once repairs are signed off.
- **Medium** — `getPayments` doesn't re-check the invoice's site; safe today (route is HO/mgmt-only) but an IDOR risk if ever opened to site role.
- **Low** — JWT accepted via query param for downloads; S3 presigned URLs 15 min (tighten to 5).

### 5.2 Backend — 6.5/10
**Strong:** correct layering (routes→controllers→services→db) in most code; transactions used
where it matters (payment writes lock the invoice row); money handling rigorous.
**Gaps:**
- **High** — import flow (`import.controller.ts:719–871`) is N+1 and per-row transactional; a mid-import crash leaves partial data. Batch inserts + one transaction per batch.
- **High** — `/invoices` unbounded (cap 5,000), no pagination params.
- **Medium** — god-files: `import.controller.ts` (1,396), `vendor.service.ts` (1,053) mix parsing/business/DB.
- **Medium** — observability: 133 `console.*`, no structured logging or request IDs.
- *Correction:* the O(n²) vendor dedup is **not** a current problem (216 vendors ≈ 23k cheap comparisons); it's a scaling note only.

### 5.3 Data Model — 7.2/10 (best area)
**Strong:** `NUMERIC(14,2)` money everywhere; UUID PKs; well-chosen FK `ON DELETE` (CASCADE/SET NULL);
thorough CHECK constraints; partial soft-delete indexes; payment status recomputed in SQL from
source rows; idempotent append-only migrations; every destructive repair snapshots first.
**Gaps:**
- **Medium** — denormalization debt: `invoices.vendor_name` / `invoices.purpose` are copies that drift from `vendors`. Cleanup partly done (migrations 044/046); finish backfill, then `vendor_id NOT NULL` + drop copies — **but only under the two data rules below**.
- **Medium** — 7 repair snapshot tables persist with no retention policy.
- **Low** — missing indexes (above); migrations run *after* container restart (no pre-deploy validation).

### 5.4 Frontend — 6.5/10 (Testing 5.0, CI/Ops 6.5)
**Strong:** route-based lazy loading; elegant custom SWR cache (`useCachedQuery`); strict TS, zero `any`.
**Gaps:**
- **High** — god components: `InvoiceList.tsx` (2,854) and `MyInvoices.tsx` (1,358) are ~60% duplicated. Extract shared `InvoiceTable` + `FilterBar` + `useInvoiceFilters`.
- **High** — zero client tests (money/RBAC is covered server-side; UI/filter logic is not).
- **Medium** — no global error boundary on lazy routes (failed chunk = blank screen on flaky networks).
- **Medium** — a11y: missing aria-labels on icon buttons, no modal focus traps.

### 5.5 CI/CD & Ops — 6.5/10
- **High** — `deploy-prod.yml` triggers on push to main with **no link to `ci.yml`** (verified: no `workflow_run`/`needs`). A red typecheck/test still ships. Cheapest high-value fix in the repo.
- **High** — no staging environment; push = prod in ~60s; no auto-rollback.
- **Medium** — CI runs no linter; eslint isn't even installed locally.
- **Good** — health check on deploy; daily off-AWS DB + file backups (but restore is untested).

---

## 6. Wastage
- **Duplicate network**: dashboard pulls the full 3,566-row `/invoices` in addition to the list's own fetch.
- **Repair-table sprawl**: 7 snapshot tables in prod with no retention policy (correct as rollback insurance now; needs an archive-and-drop policy).
- **Dead code**: removed this cycle (5 stubs, offline-sync, unused imports).
- **CI runs no lint** → style/quality drift goes unnoticed.

---

## 7. Guardrails — the two data-integrity rules (must hold for every change)
1. **Human edits are final.** A value a person typed/edited by hand is the source of truth;
   no repair/import/backfill/recompute/merge may overwrite it (enforced via the `audit_logs`
   "Edited …" guard; see migration 046).
2. **Never assume to fill unknowns.** No fabricating/guessing/defaulting/coercing a value, and
   never *using* a guessed value downstream. Unknown → reject / leave blank / surface it.

**Impact on this plan:** all items below are pure reads or change *how* data is written/transferred,
never *what*. The vendor_name cleanup (5.3) is the one item gated by these rules: link `vendor_id`
only on *unambiguous* matches, never overwrite a human-edited name, and do not drop
`invoices.vendor_name` until every row is confidently linked without guessing.

---

## 8. Prioritized Implementation Plan

Effort is rough dev-time. "Rule-safe" = compliant with §7.

### Wave 1 — cheap smoothness wins (this week, ~1–1.5 days, all rule-safe)
| Item | Why | Effort | Verify |
|---|---|---|---|
| Gate deploy on CI passing | A red build currently still deploys | 30 min | Push a branch with a deliberate type error → deploy must not run |
| `AbortController` in `apiFetch` | Cancel superseded requests; snappier filtering/nav | 0.5 day | Network tab: stale requests show "canceled" on fast filter changes |
| `Cache-Control`/`ETag` on `/vendors`,`/categories`,`/banks` | 304s instead of full re-download | 0.5 day | Repeat request returns `304`; payload ~0 |
| Add eslint to CI | Catch quality drift | 30 min | CI fails on a lint error |

### Wave 2 — kill the big payloads (this month, the real fetch-latency fix)
| Item | Why | Effort | Verify |
|---|---|---|---|
| `GET /api/dashboard/summary` (aggregate KPIs in SQL) | Dashboard stops downloading 3,566 rows to sum in JS | 1–2 days | Dashboard payload drops from ~MBs to ~KBs; KPIs match old values exactly |
| Server-side pagination + filtering for `/invoices` (after the above) | List fetches 50 rows, not 3,566 — fixes cold load | 3–4 days | Cold load time drops; list still searches/sorts/filters; dashboards/VendorMaster totals unchanged |
| Move VendorMaster/SiteExpenditure aggregation to SQL endpoints | Stop client-side full-array sums | 1–2 days | Same totals, smaller payloads |

### Wave 3 — maintainability & resilience (next quarter)
| Item | Why | Effort | Verify |
|---|---|---|---|
| Extract shared `InvoiceTable`/`FilterBar`/`useInvoiceFilters` | Removes ~60% duplication, shrinks god-files | 2–3 days | InvoiceList + MyInvoices both use it; behavior unchanged |
| Batch + single-transaction the import | Fix N+1 + atomicity | 1–2 days | 1,000-row import uses ~tens of queries; crash mid-import leaves no partial rows |
| Vitest client test harness + starter suite | Catch UI/filter regressions | 1 day setup | `npm test` runs; filter/cache tests pass |
| Structured logging (pino) + request IDs | Debuggable prod | 1–2 days | Each request log carries an id; errors include user/endpoint |
| Staging env + rollback runbook | Stop pushing straight to prod | 2–3 days | A bad change is caught in staging; documented 1-command rollback |
| Route error boundary | No blank screen on chunk-load failure | 0.5 day | Simulated chunk failure shows a retry UI |
| Login rate-limiting | Brute-force protection | 0.5 day | N failed logins/email get throttled |
| Two missing indexes + snapshot retention policy | Latent scaling + storage hygiene | 1 hr + 0.5 day | `EXPLAIN` uses the index; documented archive-and-drop schedule |

---

## 9. How to Verify Outcomes
- **No hang:** open the HO invoice list; only 50 rows render; sitting on it ≥2 min produces no periodic freeze. (Already true after Wave-0 fixes.)
- **Faster cold load (after Wave 2):** measure time-to-first-row on the list and dashboard before/after; dashboard JSON should shrink from megabytes to kilobytes.
- **Correctness preserved:** every aggregation/pagination change must produce identical KPI totals to the current client-side computation — diff the numbers on a known data set before shipping.
- **Rule compliance:** any migration touching `payments`/`invoices` carries the human-edit exclusion guard and imputes nothing (review the `WHERE` clause).
- **Static gates:** `npm run typecheck` + `npm run build` pass; once eslint is installed, `npm run lint` too.

---

## 10. Bottom Line
Ship the already-done perf fix (evening window). Then do **Wave 1** (a day, high comfort) and
**Wave 2** (the dashboard SQL aggregate → list pagination), which together remove the
multi-thousand-row fetches that are the root of "slow to load." Everything here respects the two
data-integrity rules; nothing invents or overwrites data.
