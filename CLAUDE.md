# Inspection Ready — working notes

Monthly ZATCA VAT + WHT inspection-readiness SaaS. Single-file client
(`web/` → built into `apps-script/Index.html` and `dist/index.html`) plus a
Google Apps Script backend with Google Sheets storage. Same family of
architecture as `bestgas-cash-collection/app/`, but an independent project.
See README.md for the feature map and deployment.

## Rules of the road

- **All tax logic lives in `web/engine.js`** and must stay pure (no DOM, no
  storage) so `tests/engine.test.js` can run it in Node. UI files only render
  engine output.
- **`web/demo.js` plants specific problems** (listed at the top of the file).
  `tests/engine.test.js` pins each one. If you change a check, update both, and
  keep the demo internally consistent: e.g. B2 ties exactly, and the SAR 3,510
  under-declared VAT shows identically in V1, V4 and V7.
- **Never edit `apps-script/Index.html` by hand** — run `node build.js`.
- The server owns identity, tenancy, roles, entity access and the sign-off
  lock. The client is never trusted for `entityId` on child tables.
- Any user text written to a sheet goes through `txt_()` (leading apostrophe).
  Doc ids must match `checkId_`. Don't add a new write path without both.
- Local/demo mode (`LocalBackend`, IndexedDB) serialises every action through a
  queue, because each action read-modify-writes a whole table.
- Strings go through `t('English')`; Arabic lives in `web/i18n.js` keyed by
  the English text. Dates and periods inside Arabic text use `Z.ltr()`.
- Amounts display with Latin digits and parentheses for negatives, in both languages.

## Tests

`npm test` — engine (130) + backend (22) + a 600-run random-data stress test
(`tests/fuzz.js`: messy values, bad dates, any period since 2018 — no NaN,
no negative exposure, no crash). `npm run perf` — 20,000 invoices under 4 s.
With `npm run dev` running, four browser suites drive the real UI in headless
Chrome: `npm run e2e` (journeys, every page EN/AR/phone, 1,055 checks),
`e2e:edge` (quarterly/no-WHT/2018, empty exercise, signed-off read-only,
deletes, broken links), `e2e:security` (script injection through every field),
`e2e:a11y` (axe-core WCAG 2.1 AA on 105 screens; keep it at zero). Chrome must
get an absolute `--user-data-dir`; a relative one silently fails to start.

## Domain decisions worth remembering

- RCM (box 9) VAT counts on both sides: `box13 = box6.vat + box9.vat − box12.vat`.
- V7 compares box 16 with the net closing balance of *all* VAT accounts, not the
  payable account alone, so it works with or without a settlement journal.
- B2 expected payments exclude box 9 VAT (self-assessed, never paid to a supplier).
- A finding raised from a bank check takes the VAT fraction (r / (1 + r)) of the
  difference, because bank figures include VAT.
- MUS default tolerable misstatement = max(materiality, 3% of book value);
  sample size is capped at the population.
- Reliability factors are rounded *up* (AICPA tables): 95%/0 → 3.00, 95%/1 → 4.75.
- Verified against sources on 2026-10-19: VAT IR Art. 63 correction threshold is
  **SAR 15,000** (since 23 June 2023), 20 days to notify, period-of-discovery
  route below it, 5 years for over-declarations; WHT delay fine 1% per 30 days
  with **no fine under 30 days** (IR Art. 68(2)) — counted in full 30-day steps;
  amnesty covered returns due before 1 Jan 2026 and closed 30 June 2026;
  marketplace deemed-supplier rule from 1 Jan 2026; refund minimum SAR 5,000.
- Three e-invoicing sources: `sys_vat` (ERP), `einv_provider` (the third-party
  system that talks to Fatoora), `einv` (ZATCA's own export). E-checks prefer the
  provider as the hub and fall back to ZATCA when there is no provider file.
- Other taxes (group `other`): marketplace payouts are found in the *bank*
  by keyword (so they also count in B1 as customer receipts — correct, they
  are); RETT 5% must be paid before the deed date; excise is tax-inclusive:
  qty × max(retail, standard) × rate ÷ (1 + rate); Zakat base = additions −
  deductions, never below adjusted net profit (then a flat 2.5%), Gregorian
  rate 2.5% × 365/354, due 120 days after year end (ZATCA guideline, Art. 17).
  Verified 2026-10-20: sweetened/carbonated drinks pay SAR 0 / 0.79 / 1.09 per
  litre by sugar (<5 g / 5–7.99 g / ≥8 g per 100 ml) from 1 Jan 2026; RETT is
  due within 30 days of the transaction (new law, April 2025). Still single-
  source, so editable and labelled "verify": RETT late 2%/month, Zakat late
  1%/30 days capped 25%, the marketplace exception's payment condition.
- Security: `Z.validApi` — the hosted build (ZR_API_URL baked) ignores `?api=`
  and stored URLs; never relax this, a crafted link would phish sign-ins.
- Periods start at `Z.FIRST_YEAR` (2018). `Z.exFor(entity, month)` finds a
  monthly *or* the covering quarterly exercise — use it, not exact matching.
- Dates: `E.cleanData` (run by `runAll`) passes every date/time field through
  `E.date`, which rejects impossible dates (30 Feb) and reads day-first Saudi
  formats and Excel serials. Never call `toISOString` on raw row values.
- Contrast: `--ink-3` is #5b6880 and `--pass` #166534 to meet WCAG AA; the report
  pack (`.report`) re-declares the light palette so it stays a white page in dark mode.
- Row packing (`Z.pack`) takes the union of keys over all rows — optional columns
  may be missing from the first row.

## VAT and WHT sections (since 2026-10-19)

- The route may start with `vat/` or `wht/`; `Z.route` strips it into `S.tax`
  (persisted as `zr_tax`) and sets `<html data-tax>`, which switches the accent
  colour. Links without the prefix keep the current section. Use `Z.isWht()`.
- The engine scores each section separately: `R.vatScore` / `R.whtScore`,
  `R.vatExposure` / `R.whtExposure`. Filing check C3 is WHT, C1–C2 VAT; bank
  B5 belongs to the VAT score but is also shown in the WHT section. Exercise
  summaries save `vatScore, vatGrade, vatExposure, vatFails` and the `wht*`
  equivalents; `Z.taxScore(summary)` falls back to the combined score only for
  summaries saved before the split.
- Findings tagged `tax: 'WHT'`, checklist area `WHT` and sample flow `W` belong
  to the WHT section; everything else to VAT. Sign-off covers both.
- UI: `Z.fitTabs()` (called by `Z.setMain`) keeps tab strips on one row with a
  More menu; `Z.exitButton()` renders Sign out (cloud) or Exit demo (demo with a
  backend available).
- Sessions: "Keep me signed in" issues a 30-day token (`rm` claim, renewed on
  each call) kept in localStorage; otherwise 12 hours in sessionStorage. A
  password change bumps `epoch` and ends every session.
- The PDF guide (`guide/`) is rebuilt once per release, not after every change.

## Action plan and Company 360

- `E.remediate(res, ctx)` (run by `runAll` as `R.plan`) turns every failed or
  flagged check into an action: playbook steps [en, ar] from `E.PLAYBOOKS`
  (fallback `E.KIND_STEPS`), route (amend ≥ SAR 15,000 within 20 days / next
  return / pay / reclaim / einv / book / doc), deadline, and cost now vs if an
  inspector finds it `inspectionHorizonMonths` (12) later.
- Never sum actions naively: `E.ACTION_FAMILIES` group checks that measure the
  same difference (the SAR 3,510 shows in V1, V4, V7); only the family lead
  (`counted`) enters totals, the rest carry `sameAs`. `E.checkImpact`: VAT
  comparison checks are already VAT (V6 revenue × rate), bank × r/(1+r), WHT
  gross differences are not tax. A higher return than ledger on V1/V4/V7 is a
  reclaim; on input checks (V5, V8) it is tax due. E-invoicing fines are shown
  as a ceiling (`upTo`), never added to totals. RETT/excise are their own taxes.
- `web/ui-insights.js`: Company 360 (`#/<tax>/insights/<entityId>`) and the
  exercise tab `plan`; done actions live in `exercise.actionsDone`. Charts are
  plain SVG; motion is CSS only and off under prefers-reduced-motion. SVG rects
  use class `cbar` — `.bar` and `.acts` are taken by older components.

## Interface components (design v3, 2026-10-19)

- `web/ui-design.js` enhances every `<select>` into a listbox popover and every
  date/month input into a calendar popover via a MutationObserver. The native
  element stays in the DOM (hidden, `aria-hidden`), so `data-chg` handlers,
  forms and the e2e tests keep using it. Add `data-native` to opt out.
- Breakdowns: any element with `data-drill="key[:arg]"` opens `Z.drawer` with
  rows from `Z.DRILL[key](arg)`. `web/ui-drills.js` recognises KPI cards by
  their label (`RULES`), so a new KPI card becomes drillable by adding one line
  there, not by editing the template.
- Class names are global: `.act` (action cards), `.mini` (360 links), `.bar`
  (readiness bars), `.acts` (check buttons) are taken. Collisions with these
  broke the dropdown, the folded sidebar and a whole tab once each. Name new
  component classes specifically.
- Folded sidebar (`.shell.folded`, `zr_mini`) is desktop only; on phones the
  sidebar is a fixed overlay. Em-dashes are banned in visible copy (taste-skill);
  `Z.revealPage()` staggers sections on each render.
- Fatoora (E12-E17): what ZATCA holds is compared with the return (E12, the
  first thing ZATCA's own engine does), by category (E13), cut-off (E14),
  duplicates (E15), buyer TRN (E16), seller TRN (E17). Checks with live
  figures in their note carry `noteAr`.

## ZATCA account (wave 1, 2026-10-20)

- Entity-scoped tables (`ENTITY_TABLES` in Code.gs): `statements` (one doc per entity,
  id `<entityId>_soa`, lines from the portal export, kind `soa` in `E.KINDS`), `refunds`,
  `disputes`, `events`. Screens in `web/ui-zatca.js`: `#/<tax>/account`, `refunds`,
  `disputes`, `calendar`; classes are prefixed `zk-`.
- `E.statementRecon`: SA1 returns posted, SA2 amounts equal, SA3 penalties recorded in
  disputes (by reference), SA4 balance vs GL, SA5 overdue with fines. Exposure is
  max(SA2+SA3, SA4, SA5+SA3): SA4 already holds the others. Demo: the GL gap 2,825 is
  exactly the unrecorded penalty 2,325 + the WHT difference 500.
- `E.disputeStatus` / `E.refundStatus` deadlines come from `settings.disputes`
  (objection 60, ZATCA 90, escalate 30, appeal 30) and `settings.refunds` (pay 60 days,
  documents 20 working days Sun-Thu). Only the 60-day objection is primary-sourced.
- `E.complianceCalendar`: a past return with no exercise is `untracked`, never overdue.
  `E.ics` writes RFC 5545 (escaped, folded at 73).
- Review notes live on the exercise (`ex.reviews`). Code.gs `guardReviews_`: managers
  add/clear; anyone else's save keeps the stored notes and takes only replies. Closing
  with an open note throws `open_review_notes` (LocalBackend mirrors it).
- Numbers use the accounting format: `Z.fmt` = 2 decimals, (negatives), `-` for zero;
  `Z.count` for whole counts. Never `fmt(x, 0)` for money.

## VAT adjustments (wave 2, 2026-10-20)

- One `registers` doc per entity (id `<entityId>_reg`): arrays `capital`, `baddebts`,
  `advances`, `fx`, `related`. `E.adjustments` gives AJ1-AJ5 with `exposure` (to pay) and
  `recover` (to reclaim); `web/ui-adjust.js` at `#/vat/adjust` (VAT section only).
- AJ1 capital assets: VAT IR Art. 52, 10 years immovable / 6 movable, shorter useful life
  wins; each later year adjusts inputVat/period x (use - first-year use). Other registers'
  rules (bad debt 12 months + write-off + notice, advance invoice 15 days after month end,
  related-party market value when the buyer cannot fully recover) are adviser summaries:
  settings `badDebt`, `advances`, `fx.usdPeg` 3.75, labelled "verify".
- Register inputs go through `pos()` / `pct()`: never negative, percentages 0-100. The fuzz
  test feeds junk to every wave 1-2 function.
- Demo: 12,000 (warehouse 80% use in 2025) + 3,000 (early bad-debt claim) + 30,000 (advance
  declared late) + 1,980 (EUR at 4.05 vs 4.38) + 7,500 (housing below market) = 54,480 to
  pay; 15,000 bad debt to reclaim.

## Deployment (backend live since 2026-10-19)

The ids and URLs live in `deploy.json` (read by `build.js`). The Google
account that owns the script is the one clasp is signed in as —
`clasp show-authorized-user` — not necessarily the Claude account.

- Client: GitHub Pages on `main` of BesGasKSA/Zatca
  (https://besgasksa.github.io/Zatca/). Pages actually serves the **repo root**:
  `build.js` writes both `index.html` and `docs/index.html` with the backend URL
  baked in; never edit them by hand. Static files (the PDF guide) must sit at
  the root to be served.
- Redeploy the backend after a code change, from `apps-script/`:
  `node ../build.js && clasp push --force && clasp update-deployment <deploymentId from deploy.json> --description "..."`
  then commit and push so Pages gets the same client.
- **The first web-app deployment must be made in the editor** (Deploy ▸ New
  deployment ▸ Web app ▸ Anyone) and its permission prompt approved. A
  deployment created by `clasp create-deployment` shows "Anyone" in the dialog
  but Google serves Drive's "access denied" (HTTP 403) to every visitor — that
  cost half a day on 2026-10-19. clasp is fine for *updating* a deployment.
- Never `clasp create-deployment` again — it makes a new URL, and a broken one.
- First-time setup: run `setup()` once in the editor (grants permissions,
  creates the Registry, adds the deployer to SUPER_ADMINS, installs the trigger).
- After any deploy, check `GET <apiUrl>?ping=1` returns
  `{"ok":true,"service":"tax-inspection-readiness"}` — CLI output alone proves nothing.
