# Inspection Ready — VAT & WHT inspection readiness (KSA)

A multi-tenant SaaS for running a **monthly ZATCA inspection exercise** on every
legal entity, so the day an inspector arrives the numbers already agree and the
evidence is already on file. Bilingual (English / العربية, full RTL). Data lives
in **Google Sheets** — one private spreadsheet per organisation.

## What one monthly exercise does

| Area | What is checked |
|---|---|
| **VAT — four-way** | The return as filed (16 boxes) vs the system tax report (invoice level) vs the Excel workings, box by box, amount and VAT (V1–V3). Output VAT, input VAT and net VAT vs the general ledger (V4, V5, V7). TB revenue vs box 6 with documented reconciling items (V6). Import VAT vs customs declarations (V8). Fatoora e-invoicing vs system sales: unreported, rejected, mismatched (V9). |
| **E-invoicing chain** | Three-way reconciliation of the ERP, the third-party e-invoicing provider (the system that receives your invoices and connects to ZATCA) and ZATCA's Fatoora data: invoices never sent (E1), invoices issued outside the ERP (E2), rejected / pending / unknown to ZATCA (E3), amount mismatches (E4), clearance before sharing and the 24-hour B2C reporting limit (E5), invoice-counter (ICV) gaps per EGS unit (E6), credit/debit notes without a billing reference (E7), wrong invoice type for B2B customers (E8), accepted with warnings (E9). |
| **Filing & payment** | VAT filed by the last day of the following month (late filing 5–25%), paid in full on time (5% per month or part), WHT filed and paid by the 10th (1% per 30 days, nothing under 30 days), refund positions flagged for desk review. |
| **Input VAT recovery** | Blocked input VAT (entertainment, hospitality, restricted vehicles — Art. 50), apportionment for exempt supplies with a calculator (Art. 51), deemed supplies on gifts above SAR 200 per recipient / SAR 50,000 a year (Art. 15). |
| **Cross-tax** | Reverse-charge purchases with no WHT (X1) and WHT payments with no reverse-charge VAT (X2). |
| **Bank** | Every bank line classified (customer receipts, suppliers, ZATCA VAT, ZATCA WHT, foreign transfers, payroll, internal, financing…; editable rules + manual override). Receipts vs sales incl. VAT adjusted for Δ receivables (B1 — the classic *unreported sales* finding). Payments vs purchases adjusted for Δ payables (B2). VAT and WHT paid vs the previous returns (B3, B4). Foreign transfers missing from the WHT register (B5). Significant receipts that trace to no invoice (B6). Closing balance vs TB (B7). |
| **WHT** | Return vs payments register vs Excel by payment type (W1–W3). Return vs WHT payable credits in the GL (W4). Statutory rates per payment type, with treaty relief only when a residency certificate is on file (W5). Remittance by the 10th + 1%/30-days fines (W6). Certificates issued (W7). Non-resident expenses in the GL missing from the register (W8). |
| **Analytics (100% of invoices)** | VAT ≠ 15%; VAT on zero/exempt lines; input VAT without a valid supplier TRN; invalid customer TRNs; duplicates; out-of-period dates; numbering gaps; exports to SA; foreign suppliers not on RCM; RCM from Saudi suppliers; credit-note ratio; key items; round amounts; weekend purchases; import VAT vs customs; Benford first-digit test (Nigrini MAD). Effective VAT rate, input/output ratio, zero/exempt share. |
| **Sampling** | Sales, purchases and WHT payments. MUS (PPS, top stratum), simple random, stratified, key items, risk-based (analytics flags). AICPA/Poisson sample sizes; **seeded and reproducible**. Attribute checklists per population (tax invoice fields, QR, Fatoora, TRN, blocked input VAT, customs, RCM, bank trace…). Deviation rate with upper limit; MUS projected misstatement and upper misstatement limit. Excel export. |
| **Risk-engine trends** | Each return against the entity's last three: sales drops, input VAT surges, zero-rated/exempt share jumps, input/output ratio. |
| **Annual reconciliation** | Twelve months (or four quarters) of returns against audited FS revenue, the Zakat / income tax return, annual GL VAT and the annual WHT figure, with reconciling items, missing periods, and a WHT-by-beneficiary report. |
| **Reports centre** | Portfolio readiness, findings aging, exposure by entity and a filing compliance calendar across all entities — each exports to Excel. |
| **Inspection file** | 22 documents inspectors ask for (VAT, bank, WHT), status / owner / Drive link. |
| **Findings** | Severity, tax impact, penalty estimate (VAT 50% of difference + 5%/month; WHT 1%/30 days — rates editable), correction route (VAT IR Art. 63: amend the original return within 20 days when the net difference is SAR 15,000 or more; otherwise correct in the return for the period of discovery; over-declarations within 5 years), root cause, action, owner, due date. |
| **Score & sign-off** | Readiness score from reconciliation, bank, analytics, sampling, documents and open findings (weights editable). Preparer → reviewer → manager sign-off; a signed-off exercise is read-only on the server. Printable readiness pack (PDF) and a full Excel workbook. |
| **Portfolio** | Dashboard heatmap: every entity × last 12 months; filing deadlines; exposure. Monthly / quarterly filers. Monthly e-mail reminders. |

## Layout

```
web/                 the client (plain JS, no build step needed to develop)
  engine.js          ALL tax logic — pure functions, runs in Node and the browser
  api.js             storage: Google Sheets backend, or IndexedDB (demo mode)
  demo.js            deterministic demo company with planted problems
  ui-core.js         shell, sign-in, dashboard, entities, settings, users, audit
  ui-exercise.js     exercise workspace: overview, data upload/mapping, VAT, bank, WHT, analytics
  ui-work.js         sampling, documents, findings, report, Excel export, demo loader
  ui-reports.js      reports centre and the annual reconciliation
  i18n.js            Arabic strings
  styles.css
apps-script/         the backend (Google Apps Script)
  Code.gs            router, auth, tenancy, roles, sheet storage with chunking
  Jobs.gs            monthly reminder trigger
  Index.html         GENERATED by build.js — the client, served by the web app
tests/
  engine.test.js     70 tests: every planted problem is caught, regulatory rules pinned
  backend.test.js    18 tests: real Code.gs under a fake SpreadsheetApp
build.js             inlines web/ into dist/index.html and apps-script/Index.html
tools/serve.js       no-cache dev server
```

## Run locally

```bash
npm test
```

```bash
npm run dev
```

Open http://127.0.0.1:5181, choose **Try it on this device with demo data**, then **Load demo company**.

## Deploy the Google Sheets backend

1. Build the single-file client: `npm run build` (writes `apps-script/Index.html`).
2. Create a new Apps Script project at script.google.com and copy in `Code.gs`, `Jobs.gs`, `Index.html` and `appsscript.json` (or use `clasp push` from `apps-script/`).
3. **Deploy → New deployment → Web app**: *Execute as: Me*, *Who has access: Anyone*. Authorise.
4. Open the web app URL. The first request creates the private **Registry** spreadsheet in your Drive.
5. Script properties (Project settings → Script properties), all optional:
   - `SUPER_ADMINS` — comma-separated emails that see the Platform page (list / suspend organisations).
   - `TENANT_FOLDER_ID` — Drive folder where each organisation's spreadsheet is created.
   - `SHARE_SHEET_WITH_OWNER` — each organisation owner gets view access to their own sheet at sign-up; set `false` to turn that off.
6. In the editor run `installTriggers()` once for the monthly reminders (1st: missing exercises; 20th: exercises not signed off).
7. Organisations sign up from the web app URL. Each gets its own spreadsheet.

To host the client elsewhere (e.g. GitHub Pages), publish `dist/index.html` and open it with `?api=<web app URL>` once, or paste the URL under **Settings → Storage**.

## Data files

Every source can be uploaded as Excel or CSV. Headers in English or Arabic are matched automatically, and the mapping can be corrected before saving. Download a template from each data card. Key formats:

- **System VAT report:** flow (Sales/Purchase), invoice, date, party, VAT no, country, category (Standard / Zero / Export / Exempt / Out of scope / Import / Reverse charge / Citizens), doc type (Invoice / Credit note), net, VAT, total.
- **Bank statement:** date, description, reference, debit, credit, balance, account — one file per account.
- **WHT register:** date, beneficiary, country, payment type, gross, rate, WHT, treaty (yes/no), certificate, date paid to ZATCA.
- **E-invoicing provider export:** invoice, invoice type (standard / simplified), document type, issued at, submitted at, status, ICV, EGS unit, UUID, buyer VAT no., billing reference, net, VAT, message. Export it from your provider's portal.
- **System VAT report (optional columns):** description and account (for blocked input VAT), export declaration reference (for zero-rated exports).

## Security model

- Passwords: salted, iterated SHA-256; 5 failures lock an email for 15 minutes.
- Sessions: HMAC-signed tokens, 12-hour expiry, revoked when a password changes or a user is disabled.
- Isolation: one spreadsheet per organisation. Every read and write is checked server-side against the user's role and entity access. Child records take their entity from the exercise, never from the client.
- Roles: owner (everything) · manager (entities, settings, sign-off) · preparer (data, checks, samples, findings) · viewer (read).
- Signed-off exercises are immutable until a manager reopens them.
- Every user-typed value is written to Sheets as text (leading apostrophe), so nothing is ever evaluated as a formula. Ids are restricted to `[A-Za-z0-9_-]`.
- Audit trail per organisation, plus a platform audit in the Registry.

## Regulatory note

Rates, thresholds and penalties are defaults drawn from the KSA VAT Law, its Implementing Regulations and the Income Tax Law (WHT, Art. 68 / Implementing Regulations Art. 63). All of them are editable under Settings because ZATCA updates them. Verify them against the current rules before relying on an exposure figure. This tool supports a tax team's own review. It is not tax advice.
