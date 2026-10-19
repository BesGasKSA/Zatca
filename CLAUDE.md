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

`npm test` — engine (94) + backend (19). `npm run e2e` (dev server running) drives the real UI in headless Chrome: a full first-month journey incl. a real file upload, then every page in both sections, EN/AR and phone width — 823 checks, fails on any JS error, overflow, NaN/undefined or English left in Arabic. `npm run dev` serves `web/` with
no-cache headers on 127.0.0.1:5181 (Python's http.server caused stale-JS
confusion during development; don't go back to it).

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
