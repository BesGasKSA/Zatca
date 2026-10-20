/* The ZATCA side of the relationship: the statement of account ZATCA keeps for
   the company, refund applications, disputes and penalties, one tax calendar
   across every tax and company, and reviewer notes that hold sign-off.
   All arithmetic is in the engine (E.statementRecon, E.refundStatus,
   E.disputeStatus, E.complianceCalendar, E.ics); this file lays it out. */
(function () {
  'use strict';
  var E = window.ZEngine, S = Z.S, t = Z.t, esc = Z.esc, fmt = Z.fmt, D = Z.DRILL;
  var cfg = function () { return S.settingsDoc ? S.settingsDoc.values : {}; };
  var ar = function () { return S.lang === 'ar'; };
  var entName = function (id) { return Z.entName(Z.entity(id)) || '-'; };
  var sel = function (name, cur, opts, attrs) { return '<select name="' + name + '"' + (attrs || '') + '>' + opts.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (String(cur == null ? '' : cur) === String(o[0]) ? ' selected' : '') + '>' + esc(t(o[1])) + '</option>'; }).join('') + '</select>'; };
  var selF = function (name, label, cur, opts) { return '<label class="f"><span>' + esc(label) + '</span>' + sel(name, cur, opts) + '</label>'; };
  var entOpts = function () { return S.entities.map(function (e) { return [e.id, Z.entName(e)]; }); };
  var kpi = function (icon, val, label, drill, tone) { return '<div class="' + (tone || '') + '"' + (drill ? ' data-drill="' + drill + '"' : '') + '>' + Z.icon(icon) + '<b>' + val + '</b><span>' + esc(label) + '</span></div>'; };
  var head = function (eyebrow, title, text, right) { return '<div class="pagehead"><div><p class="eyebrow">' + Z.icon('bank') + ' ' + esc(eyebrow) + '</p><h1>' + esc(title) + '</h1><p>' + esc(text) + '</p></div>' + (right ? '<div class="row">' + right + '</div>' : '') + '</div>'; };
  var TAXN = { VAT: 'VAT', WHT: 'WHT', ZAKAT: 'Zakat', EXCISE: 'Excise', RETT: 'RETT', CIT: 'Income tax', ZATCA: 'ZATCA letter', OTHER: 'Other' };
  var taxName = function (k) { return t(TAXN[k] || k); };
  var KINDN = { return: 'Return', payment: 'Payment', penalty: 'Penalty', refund: 'Refund', assessment: 'Assessment', adjustment: 'Adjustment' };
  // a deadline as a chip: overdue, within a week, later, waiting on ZATCA, done
  function dueChip(state, days, due) {
    if (state === 'done' || state === 'closed') return '<span class="zk-due ok">' + Z.icon('check') + t('Done') + '</span>';
    if (!due) return '';
    if (state === 'waiting' || state === 'chase') return '<span class="zk-due wait" title="' + esc(due) + '">' + Z.icon('hourglass-medium') + (days < 0 ? t('ZATCA is past its date by') + ' ' + -days + ' ' + t('days') : t('ZATCA, by') + ' ' + esc(due)) + '</span>';
    if (days < 0) return '<span class="zk-due bad">' + Z.icon('warning') + t('Overdue by') + ' ' + -days + ' ' + t('days') + '</span>';
    if (days === 0) return '<span class="zk-due bad">' + Z.icon('alarm') + t('Due today') + '</span>';
    return '<span class="zk-due' + (days <= 7 ? ' soon' : '') + '">' + Z.icon('calendar-blank') + t('In') + ' ' + days + ' ' + t('days') + ', ' + Z.ltr(due) + '</span>';
  }
  function steps(list, idx, closed) {
    return '<ol class="zk-steps" aria-label="' + esc(t('Progress')) + '">' + list.map(function (s, i) {
      var st = closed || i < idx ? 'done' : i === idx ? 'cur' : '';
      return '<li class="' + st + '"' + (i === idx && !closed ? ' aria-current="step"' : '') + '><i aria-hidden="true"></i><span>' + esc(t(s)) + '</span></li>';
    }).join('') + '</ol>';
  }
  function download(name, text, type) {
    var b = new Blob([text], { type: type }), a = document.createElement('a');
    a.href = URL.createObjectURL(b); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function chk(c) {
    var figs = c.status === 'na' ? '<span>' + t('Needs') + ': <b>' + esc(t(c.missing || '')) + '</b>' + (c.missingHint ? ' - ' + esc(t(c.missingHint)) : '') + '</span>' :
      (c.aLabel ? '<span>' + esc(t(c.aLabel)) + ': <b>' + fmt(c.a, /Returns|Periods/.test(c.aLabel) ? 0 : 2) + '</b></span>' : '') + (c.bLabel ? '<span>' + esc(t(c.bLabel)) + ': <b>' + fmt(c.b) + '</b></span>' : '') +
      (c.diff != null ? '<span class="d ' + c.status + '">' + t('Difference') + ': <b>' + fmt(c.diff) + '</b></span>' : '') + (c.exposure ? '<span class="d fail">' + t('Exposure') + ': <b>' + fmt(c.exposure) + '</b></span>' : '');
    var list = (c.exceptions && c.exceptions.list) || [];
    return '<div class="check" id="c-' + c.id + '">' + Z.tick(c.status) + '<div><h3>' + esc(c.id) + ' · ' + esc(ar() ? c.titleAr : c.title) + '</h3><div class="figs">' + figs + '</div>' +
      (c.note ? '<p class="faint" style="font-size:12.5px;margin:4px 0 0">' + esc(ar() && c.noteAr ? c.noteAr : t(c.note)) + '</p>' : '') +
      (list.length ? '<details><summary>' + t('Show the items') + ' (' + list.length + ')</summary>' + Z.rowsTable(list) + '</details>' : '') + '</div><div class="acts"></div></div>';
  }

  // ================================================================ statement of account
  var SOA = { doc: null, rec: null, e: null };
  Z.views.account = function (h) {
    var e = Z.entity(h[1]) || Z.entity(S.entityId) || S.entities[0];
    if (!e) return Z.setMain(head(t('ZATCA account'), t('Statement of account'), t('Add an entity first.')));
    return Promise.all([Z.get('statements', e.id + '_soa'), Z.list('disputes')]).then(function (r) {
      SOA.e = e; SOA.doc = r[0] || { id: e.id + '_soa', entityId: e.id, lines: [], label: 'ZATCA statement of account' }; SOA.doc.lines = SOA.doc.lines || []; SOA.disputes = r[1];
      renderSoa();
    });
  };
  function renderSoa() {
    var e = SOA.e, doc = SOA.doc, can = Z.can('preparer');
    var rec = SOA.rec = E.statementRecon(doc, S.exercises.filter(function (x) { return x.entityId === e.id; }), SOA.disputes.filter(function (d) { return d.entityId === e.id; }), cfg(), Z.today());
    var sa = function (id) { return rec.checks.filter(function (c) { return c.id === id; })[0]; };
    var gl = doc.glBalance == null || doc.glBalance === '' ? null : +doc.glBalance;
    var right = (S.entities.length > 1 ? '<label class="f inline"><span class="sr-only">' + t('Entity') + '</span>' + sel('soaent', e.id, entOpts(), ' data-chg="soaent" aria-label="' + esc(t('Entity')) + '"') + '</label>' : '') +
      (can ? '<button class="btn" data-act="soaimport">' + Z.icon('upload-simple') + ' ' + t('Import statement') + '</button><button class="btn primary" data-act="soaline">' + Z.icon('plus') + ' ' + t('Add line') + '</button>' : '');
    var taxes = Object.keys(rec.byTax);
    var hero = '<section class="paper zk-hero"><div class="zk-bal"><span class="zk-k">' + (rec.balance >= 0 ? t('Owed to ZATCA') : t('ZATCA owes you')) + '</span><b class="num" data-count="' + Math.abs(rec.balance) + '">' + fmt(Math.abs(rec.balance)) + '</b><span class="faint">SAR' + (rec.asOf ? ', ' + t('as of') + ' ' + Z.ltr(rec.asOf) : '') + '</span>' +
      (taxes.length ? '<div class="zk-chips">' + taxes.map(function (k) { return '<span class="zk-chip"><i class="tx tx-' + k.toLowerCase() + '"></i>' + esc(taxName(k)) + ' <b class="num">' + fmt(rec.byTax[k].balance) + '</b></span>'; }).join('') + '</div>' : '') +
      '<div class="zk-gl"><label class="f"><span>' + t('Balance per general ledger') + '</span><input type="number" step="0.01" data-chg="soagl" value="' + (gl == null ? '' : gl) + '"' + (can ? '' : ' disabled') + ' placeholder="' + esc(t('Net of all ZATCA accounts')) + '"></label>' +
      '<label class="f"><span>' + t('Statement date') + '</span><input type="date" data-chg="soaasof" value="' + esc(doc.asOf || '') + '"' + (can ? '' : ' disabled') + '></label></div></div>' +
      '<div class="zk-run">' + runChart(rec.lines) + '</div></section>';
    var kp = '<div class="kpis">' + kpi('scales', fmt(rec.balance), t('Balance per ZATCA statement'), 'soa:tax') + kpi('book-open', gl == null ? '-' : fmt(gl), t('Balance per general ledger'), null) +
      kpi('gavel', fmt(rec.penalties), t('Penalties on the statement'), 'soa:pen', sa('SA3').status === 'fail' ? 'bad' : '') + kpi('alarm', fmt(rec.overdue), t('Unpaid after the due date'), 'soa:over', rec.overdue ? 'bad' : '') +
      kpi('shield-warning', fmt(rec.exposure), t('Exposure (SAR)'), 'soa:expo', rec.exposure ? 'bad' : '') + '</div>';
    var checks = '<section class="paper"><header><div><h2>' + t('What the statement says about your filings') + '</h2><p>' + t('ZATCA keeps its own ledger for the company. Inspectors start from it: every return, assessment, penalty and payment should agree with your books.') + '</p></div>' +
      '<span class="score-chip">' + rec.checks.filter(function (c) { return c.status === 'pass'; }).length + ' / ' + rec.checks.filter(function (c) { return c.status !== 'na'; }).length + ' ' + t('agree') + '</span></header>' + rec.checks.map(chk).join('') + '</section>';
    var pr = rec.periods.slice().reverse().slice(0, 18);
    var cell = function (ret, soa) { var d = ret != null && soa != null ? soa - ret : null; return '<td class="num">' + fmt(soa) + (d && Math.abs(d) > 1 ? ' <span class="diff-bad">(' + (d > 0 ? '+' : '') + fmt(d) + ')</span>' : '') + '</td>'; };
    var periods = pr.length ? '<section class="paper flush"><div style="padding:14px 18px"><h2>' + t('Period by period') + '</h2><p class="muted" style="margin:2px 0 0">' + t('Your return, what ZATCA posted, and what was paid.') + '</p></div><div class="tbl-wrap"><table class="t zk-tbl"><thead><tr><th>' + t('Period') + '</th><th class="num">' + t('VAT return') + '</th><th class="num">' + t('VAT on the statement') + '</th><th class="num">' + t('VAT paid') + '</th><th class="num">' + t('WHT return') + '</th><th class="num">' + t('WHT on the statement') + '</th><th class="num">' + t('WHT paid') + '</th></tr></thead><tbody>' +
      pr.map(function (p) { return '<tr class="clickable" data-act="openex" data-id="' + p.exId + '"><td>' + Z.ltr(p.period) + '</td><td class="num">' + fmt(p.vatReturn) + '</td>' + cell(p.vatReturn, p.vatSoa) + '<td class="num">' + fmt(p.vatPaid || null) + '</td><td class="num">' + fmt(p.whtReturn) + '</td>' + cell(p.whtReturn, p.whtSoa) + '<td class="num">' + fmt(p.whtPaid || null) + '</td></tr>'; }).join('') + '</tbody></table></div></section>' : '';
    var run = 0, sorted = rec.lines.slice().sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : a.i - b.i; });
    var lines = '<section class="paper flush"><div class="spread" style="padding:14px 18px"><div><h2>' + t('Statement lines') + '</h2><p class="muted" style="margin:2px 0 0">' + rec.lines.length + ' ' + t('lines') + (rec.first ? ', ' + Z.ltr(rec.first) + ' - ' + Z.ltr(rec.last) : '') + '</p></div>' +
      (can && rec.lines.length ? '<button class="btn small ghost" data-act="soaclear">' + Z.icon('trash') + ' ' + t('Clear the statement') + '</button>' : '') + '</div>' +
      (rec.lines.length ? '<div class="tbl-wrap" style="max-height:560px"><table class="t zk-tbl"><thead><tr><th>' + t('Date') + '</th><th>' + t('Tax') + '</th><th>' + t('Type') + '</th><th>' + t('Period') + '</th><th>' + t('Description') + '</th><th>' + t('Reference') + '</th><th class="num">' + t('Debit') + '</th><th class="num">' + t('Credit') + '</th><th class="num">' + t('Balance') + '</th>' + (can ? '<th><span class="sr-only">' + t('Remove') + '</span></th>' : '') + '</tr></thead><tbody>' +
        sorted.map(function (l) { run += l.debit - l.credit; return '<tr class="k-' + l.kind + '"><td class="nowrap">' + Z.ltr(l.date) + '</td><td><span class="zk-tx"><i class="tx tx-' + l.taxType.toLowerCase() + '"></i>' + esc(taxName(l.taxType)) + '</span></td><td>' + (l.kind === 'penalty' ? Z.pill('fail', t('Penalty')) : esc(t(KINDN[l.kind]))) + '</td><td>' + Z.ltr(l.period) + '</td><td>' + esc(l.description) + '</td><td>' + Z.ltr(l.reference) + '</td><td class="num">' + (l.debit ? fmt(l.debit) : '') + '</td><td class="num">' + (l.credit ? fmt(l.credit) : '') + '</td><td class="num">' + fmt(run) + '</td>' +
          (can ? '<td><button class="btn ghost small icon" data-act="soadel" data-i="' + l.i + '" aria-label="' + esc(t('Remove') + ' ' + l.date + ' ' + l.description) + '">' + Z.icon('x') + '</button></td>' : '') + '</tr>'; }).join('') + '</tbody></table></div>' :
        '<div class="empty"><i class="ph ph-file-arrow-down big" aria-hidden="true"></i><h2>' + t('No statement loaded yet') + '</h2><p>' + t('Download the statement of account from the ZATCA portal (Excel), then import it here. Columns are recognised in English or Arabic.') + '</p>' + (can ? '<button class="btn primary" data-act="soaimport">' + t('Import statement') + '</button>' : '') + '</div>') + '</section>';
    Z.setMain(head(t('ZATCA account'), t('Statement of account') + ': ' + Z.entName(e), t('Reconcile what ZATCA has posted for the company with your returns, payments and general ledger.'), right) +
      '<div class="stack">' + hero + kp + checks + periods + lines + '</div>');
  }
  // balance at each month end: returns and their payments cross within days, so
  // daily points swing; month ends show what is really building up
  function runChart(lines) {
    var L = lines.slice().filter(function (l) { return l.date; }).sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : a.i - b.i; });
    var months = [], b = 0;
    L.forEach(function (l) {
      b += l.debit - l.credit; var mk = l.date.slice(0, 7), last = months[months.length - 1];
      if (!last || last.m !== mk) months.push(last = { m: mk, v: 0, pen: 0, items: [] });
      last.v = b; if (l.kind === 'penalty' && l.debit) { last.pen += l.debit; last.items.push(l); }
    });
    if (months.length < 2) return '<div class="zk-run-empty faint">' + t('The balance over time appears once the statement covers two months.') + '</div>';
    var W = 560, H = 200, pl = 10, pr = 10, pt = 22, pb = 30, n = months.length;
    var lo = Math.min(0, Math.min.apply(null, months.map(function (p) { return p.v; }))), hi = Math.max(1, Math.max.apply(null, months.map(function (p) { return p.v; })));
    var x = function (i) { return pl + 18 + i * (W - pl - pr - 36) / (n - 1); }, y = function (v) { return pt + (hi - v) / (hi - lo || 1) * (H - pt - pb); };
    var d = months.map(function (p, i) { return (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(p.v).toFixed(1); }).join(' ');
    var area = d + ' L' + x(n - 1).toFixed(1) + ' ' + y(0).toFixed(1) + ' L' + x(0).toFixed(1) + ' ' + y(0).toFixed(1) + ' Z';
    var lab = function (mk) { return new Date(Date.UTC(+mk.slice(0, 4), +mk.slice(5, 7) - 1, 1)).toLocaleDateString(ar() ? 'ar-SA-u-ca-gregory-nu-latn' : 'en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' }); };
    var dots = months.map(function (p, i) {
      return '<circle class="' + (p.pen ? 'pen' : 'dot') + '" style="--i:' + i + '" cx="' + x(i).toFixed(1) + '" cy="' + y(p.v).toFixed(1) + '" r="' + (p.pen ? 6 : 4) + '"><title>' + esc(p.m + ': ' + fmt(p.v) + (p.pen ? ', ' + t('Penalty posted') + ' ' + fmt(p.pen) : '')) + '</title></circle>' +
        '<text class="ax" x="' + x(i).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle">' + esc(lab(p.m)) + '</text>' +
        (i === n - 1 || p.pen ? '<text class="vl" x="' + x(i).toFixed(1) + '" y="' + (y(p.v) - 11).toFixed(1) + '" text-anchor="middle">' + fmt(p.v) + '</text>' : '');
    }).join('');
    return '<div class="chart"><svg direction="ltr" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(t('Balance with ZATCA over time')) + '">' +
      '<line class="gl" x1="' + pl + '" x2="' + (W - pr) + '" y1="' + y(0).toFixed(1) + '" y2="' + y(0).toFixed(1) + '"/>' +
      '<path class="area" d="' + area + '"/><path class="ln draw" d="' + d + '"/>' + dots + '</svg>' +
      '<p class="zk-legend"><span><i class="k-ln"></i>' + t('Balance owed to ZATCA at month end') + '</span><span><i class="k-pen"></i>' + t('Penalty posted') + '</span></p></div>';
  }
  function saveSoa(msg) { return Z.save('statements', SOA.doc).then(function (d) { SOA.doc = d; d.lines = d.lines || []; renderSoa(); if (msg) Z.toast(msg); }); }
  Z.CHG.soaent = function (el) { location.hash = '#/' + S.tax + '/account/' + el.value; };
  Z.CHG.soagl = function (el) { SOA.doc.glBalance = el.value === '' ? null : +el.value; saveSoa(); };
  Z.CHG.soaasof = function (el) { SOA.doc.asOf = el.value; saveSoa(); };
  Z.ACT.soadel = function (el) {
    // data-i is the line's place in the stored list (E.soaLines keeps it)
    SOA.doc.lines.splice(+el.dataset.i, 1); saveSoa(t('Line removed'));
  };
  Z.ACT.soaclear = function () { if (!confirm(t('Remove every line of this statement?'))) return; SOA.doc.lines = []; saveSoa(t('Statement cleared')); };
  Z.ACT.soaline = function () {
    Z.modal(t('Add a statement line'), '<form id="sf" class="grid g2">' + Z.fld('date', t('Date'), Z.today(), 'date', 'required') +
      selF('taxType', t('Tax'), 'VAT', [['VAT', 'VAT'], ['WHT', 'WHT'], ['ZAKAT', 'Zakat'], ['EXCISE', 'Excise'], ['RETT', 'RETT'], ['CIT', 'Income tax']]) +
      selF('kind', t('Type'), 'return', Object.keys(KINDN).map(function (k) { return [k, KINDN[k]]; })) + Z.fld('period', t('Period'), '', 'text', 'placeholder="2026-09"') +
      Z.fld('debit', t('Debit (owed to ZATCA)'), '', 'number', 'step="0.01" min="0"') + Z.fld('credit', t('Credit (paid or refunded)'), '', 'number', 'step="0.01" min="0"') +
      Z.fld('reference', t('Reference'), '', 'text') + Z.fld('description', t('Description'), '', 'text') + '</form>',
      '<button class="btn" data-act="closemodal">' + t('Cancel') + '</button><button class="btn primary" data-act="soalinesave">' + t('Add line') + '</button>');
  };
  Z.ACT.soalinesave = function () {
    var f = document.getElementById('sf'); if (!f.reportValidity()) return;
    var d = Object.fromEntries(new FormData(f)); d.debit = +d.debit || 0; d.credit = +d.credit || 0;
    if (!d.debit && !d.credit) return Z.toast(t('Enter a debit or a credit.'), true);
    SOA.doc.lines.push(d); Z.closeModal(); saveSoa(t('Line added'));
  };
  Z.ACT.soaimport = function () {
    var inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.xlsx,.xls,.csv';
    inp.onchange = function () {
      var file = inp.files[0]; if (!file) return;
      if (!window.XLSX) return Z.toast(t('The spreadsheet reader did not load. Check your internet connection.'), true);
      file.arrayBuffer().then(function (buf) {
        var wb = XLSX.read(buf, { type: 'array', cellDates: true }), aoa = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: '' });
        var hd = E.detectHeader(aoa, 'soa');
        if (hd.map.date == null || (hd.map.debit == null && hd.map.credit == null)) return Z.toast(t('No date and amount columns were found in this file.'), true);
        var res = E.normalizeRows(aoa, hd.row, hd.map, 'soa');
        if (!res.rows.length) return Z.toast(t('No lines were found in this file.'), true);
        var replace = !SOA.doc.lines.length || confirm(t('Replace the lines already loaded? Cancel adds to them.'));
        SOA.doc.lines = (replace ? [] : SOA.doc.lines).concat(res.rows.map(function (r) { var o = {}; Object.keys(r).forEach(function (k) { if (k[0] !== '_') o[k] = r[k]; }); return o; }));
        SOA.doc.fileName = file.name;
        saveSoa(res.rows.length + ' ' + t('lines imported') + (res.errors.length ? ', ' + res.errors.length + ' ' + t('skipped') : ''));
      }).catch(function (e) { Z.toast(t('Could not read this file:') + ' ' + e.message, true); });
    };
    inp.click();
  };
  D.soa = function (k) {
    var rec = SOA.rec; if (!rec) return null;
    var lineRow = function (l, v) { return { label: (l.description || t(KINDN[l.kind])) , sub: l.date + ', ' + taxName(l.taxType) + (l.period ? ' ' + l.period : '') + (l.reference ? ', ' + l.reference : ''), value: v, tone: l.kind === 'penalty' ? 'fail' : '' }; };
    if (k === 'tax') return { title: t('Balance per ZATCA statement'), sub: t('By tax'), total: rec.balance, totalLabel: 'SAR', rows: Object.keys(rec.byTax).map(function (x) { var b = rec.byTax[x]; return { label: taxName(x), sub: t('Debit') + ' ' + fmt(b.debit) + ', ' + t('Credit') + ' ' + fmt(b.credit), value: b.balance, tone: b.balance > 0 ? 'warn' : 'pass' }; }) };
    if (k === 'pen') { var p = rec.lines.filter(function (l) { return l.kind === 'penalty' && l.debit; }); return { title: t('Penalties on the statement'), total: rec.penalties, totalLabel: 'SAR', rows: p.map(function (l) { return Object.assign(lineRow(l, l.debit), { href: '#/' + S.tax + '/disputes' }); }), empty: t('No penalties on the statement.'), note: t('Record each penalty in Disputes and penalties with its reference so the decision and deadline are tracked.') }; }
    if (k === 'over') { var o = (rec.checks[4].exceptions || {}).list || []; return { title: t('Unpaid after the due date'), total: rec.overdue, totalLabel: 'SAR', rows: o.map(function (x) { return { label: taxName(x.tax) + ' ' + x.period, sub: t('Due') + ' ' + x.due + ', ' + x.overdue + ' ' + t('days') + ', ' + t('estimated fine') + ' ' + fmt(x.penalty), value: x.amount, tone: 'fail' }; }), empty: t('Nothing overdue.') }; }
    if (k === 'expo') return { title: t('Exposure (SAR)'), sub: t('Each difference counted once'), total: rec.exposure, totalLabel: 'SAR', rows: rec.checks.filter(function (c) { return c.exposure; }).map(function (c) { return { label: c.id + ' ' + (ar() ? c.titleAr : c.title), value: c.exposure, tone: 'fail', href: '#c-' + c.id }; }), empty: t('Nothing exposed.') };
    return null;
  };

  // ================================================================ refunds
  var RSTEP = ['Preparing', 'Submitted', 'Documents requested', 'Approved', 'Paid'];
  Z.views.refunds = function () {
    return Z.list('refunds').then(function (rs) {
      S.refunds = rs;
      var rows = rs.map(function (r) { return { r: r, s: E.refundStatus(r, cfg(), Z.today()) }; }).sort(function (a, b) { return (a.s.state === 'closed') - (b.s.state === 'closed') || String(a.s.next && a.s.next.due || '9').localeCompare(String(b.s.next && b.s.next.due || '9')); });
      var out = rows.reduce(function (a, x) { return a + x.s.outstanding; }, 0), you = rows.filter(function (x) { return x.r.status === 'info_requested' || x.r.status === 'draft'; });
      var paid = rows.reduce(function (a, x) { return a + x.s.paid; }, 0), short = rows.reduce(function (a, x) { return a + (x.r.status === 'paid' ? Math.max(0, x.s.amount - x.s.paid) : 0); }, 0);
      var cards = rows.map(function (x, i) {
        var r = x.r, s = x.s, st = r.status === 'rejected';
        return '<article class="zk-case' + (s.state === 'closed' ? ' closed' : '') + ' st-' + s.state + '" style="--i:' + i + '"><header><div><h3>' + t('VAT refund') + ' ' + Z.ltr(r.period || '') + '</h3><p class="faint">' + esc(entName(r.entityId)) + (r.owner ? ', ' + esc(r.owner) : '') + '</p></div><b class="num zk-amt">' + fmt(s.amount) + '</b></header>' +
          (st ? '<p class="zk-rej">' + Z.icon('x-circle') + t('Rejected') + '</p>' : steps(RSTEP, Math.min(s.stepIdx, 4), r.status === 'paid')) +
          '<div class="zk-next">' + (s.next ? '<span>' + esc(t(s.next.label)) + '</span>' + dueChip(s.state, s.daysLeft, s.next.due) : r.status === 'paid' ? '<span>' + t('Received') + ' <b class="num">' + fmt(s.paid) + '</b>' + (r.paidOn ? ' ' + t('on') + ' ' + Z.ltr(r.paidOn) : '') + '</span>' : '') + '</div>' +
          (s.issues.length ? '<ul class="zk-issues">' + s.issues.map(function (q) { return '<li>' + Z.icon('warning-circle') + esc(t(q.text)) + '</li>'; }).join('') + '</ul>' : '') +
          (r.note ? '<p class="faint zk-note">' + esc(r.note) + '</p>' : '') +
          '<footer>' + (s.age != null ? '<span class="faint">' + s.age + ' ' + t('days since submission') + '</span>' : '<span></span>') + '<button class="btn small" data-act="editrefund" data-id="' + r.id + '">' + (Z.can('preparer') ? t('Update') : t('Open')) + '</button></footer></article>';
      }).join('');
      Z.setMain(head(t('ZATCA account'), t('VAT refunds'), t('Every refund application from submission to payment: what ZATCA asked for, what you owe it back, and when the money is due.'),
        Z.can('preparer') ? '<button class="btn primary" data-act="editrefund">' + Z.icon('plus') + ' ' + t('Record a refund') + '</button>' : '') +
        '<div class="stack"><div class="kpis">' + kpi('hand-coins', fmt(out), t('Refunds outstanding (SAR)'), 'rf:out', '') + kpi('user-focus', you.length, t('Waiting on you'), 'rf:you', you.length ? 'bad' : '') +
        kpi('check-circle', fmt(paid), t('Refunds received (SAR)'), 'rf:paid', 'good') + kpi('arrow-fat-line-down', fmt(short), t('Paid short of the claim (SAR)'), 'rf:short', short ? 'bad' : '') + '</div>' +
        '<p class="muted zk-src">' + Z.icon('info') + t('Minimum application SAR') + ' ' + fmt((E.mergeSettings(cfg()).refundMin || 5000), 0) + '. ' + t('ZATCA pays within 60 days of approval and expects requested documents within 20 working days (adviser summaries of VAT IR Art. 69-70; verify, editable in Settings).') + '</p>' +
        (cards ? '<div class="zk-grid">' + cards + '</div>' : '<section class="paper empty"><i class="ph ph-hand-coins big" aria-hidden="true"></i><h2>' + t('No refund applications yet') + '</h2><p>' + t('When a return shows more input VAT than output VAT, record the refund application here to follow it to payment.') + '</p></section>') + '</div>');
    });
  };
  Z.ACT.editrefund = function (el) {
    var r = (S.refunds || []).filter(function (x) { return x.id === el.dataset.id; })[0] || { status: 'draft', entityId: S.entityId || (S.entities[0] || {}).id };
    S.editRF = r; var can = Z.can('preparer');
    Z.modal(r.id ? t('VAT refund') + ' ' + (r.period || '') : t('Record a refund'), '<form id="rff" class="grid g2">' + selF('entityId', t('Entity'), r.entityId, entOpts()) + Z.fld('period', t('Return period'), r.period, 'text', 'required placeholder="2026-09"') +
      Z.fld('amount', t('Amount claimed (SAR)'), r.amount, 'number', 'step="0.01" min="0" required') + selF('status', t('Status'), r.status, E.REFUND_STEPS) +
      Z.fld('submittedOn', t('Submitted on'), r.submittedOn, 'date') + Z.fld('infoRequestedOn', t('ZATCA asked for documents on'), r.infoRequestedOn, 'date') +
      Z.fld('infoDueOn', t('Documents due by (if ZATCA gave a date)'), r.infoDueOn, 'date') + Z.fld('approvedOn', t('Approved on'), r.approvedOn, 'date') +
      Z.fld('paidOn', t('Paid on'), r.paidOn, 'date') + Z.fld('paidAmount', t('Amount received (SAR)'), r.paidAmount, 'number', 'step="0.01" min="0"') + Z.fld('owner', t('Owner'), r.owner, 'text') +
      '<label class="f" style="grid-column:1/-1"><span>' + t('Notes') + '</span><textarea name="note">' + esc(r.note || '') + '</textarea></label>' + ((r.id && 'refunds:' + r.id) ? '<div style="grid-column:1/-1">' + Z.attachHtml((r.id && 'refunds:' + r.id), r.entityId) + '</div>' : '') + '</form>',
      (r.id && can ? '<button class="btn danger" data-act="delrow" data-tb="refunds" data-id="' + r.id + '">' + t('Delete') + '</button>' : '') + '<button class="btn" data-act="closemodal">' + t('Cancel') + '</button>' + (can ? '<button class="btn primary" data-act="saverefund">' + t('Save') + '</button>' : ''));
  };
  Z.ACT.saverefund = function () {
    var f = document.getElementById('rff'); if (!f.reportValidity()) return;
    var d = Object.assign({}, S.editRF, Object.fromEntries(new FormData(f))); d.amount = +d.amount || 0; d.paidAmount = d.paidAmount === '' ? null : +d.paidAmount; d.label = d.period;
    Z.save('refunds', d).then(function () { Z.closeModal(); Z.toast(t('Saved')); Z.route(); });
  };
  Z.ACT.delrow = function (el) {
    if (!confirm(t('Delete this record?'))) return;
    Z.call('remove', { table: el.dataset.tb, id: el.dataset.id }).then(function () { Z.closeModal(); Z.toast(t('Deleted')); Z.route(); });
  };
  D.rf = function (k) {
    var rows = (S.refunds || []).map(function (r) { return { r: r, s: E.refundStatus(r, cfg(), Z.today()) }; });
    var row = function (x, v) { return { label: t('VAT refund') + ' ' + (x.r.period || ''), sub: entName(x.r.entityId) + ', ' + t((E.REFUND_STEPS.filter(function (q) { return q[0] === x.r.status; })[0] || [0, ''])[1]), value: v, act: 'editrefund', data: { id: x.r.id } }; };
    if (k === 'out') return { title: t('Refunds outstanding (SAR)'), total: rows.reduce(function (a, x) { return a + x.s.outstanding; }, 0), totalLabel: 'SAR', rows: rows.filter(function (x) { return x.s.outstanding; }).map(function (x) { return row(x, x.s.outstanding); }), empty: t('Nothing outstanding.') };
    if (k === 'you') { var y = rows.filter(function (x) { return x.r.status === 'info_requested' || x.r.status === 'draft'; }); return { title: t('Waiting on you'), total: y.length, totalLabel: t('applications'), money: false, rows: y.map(function (x) { return Object.assign(row(x, x.s.amount), { tone: x.s.state === 'overdue' ? 'fail' : 'warn' }); }), empty: t('Nothing is waiting on you.') }; }
    if (k === 'paid') return { title: t('Refunds received (SAR)'), total: rows.reduce(function (a, x) { return a + x.s.paid; }, 0), totalLabel: 'SAR', rows: rows.filter(function (x) { return x.s.paid; }).map(function (x) { return Object.assign(row(x, x.s.paid), { tone: 'pass' }); }) };
    if (k === 'short') return { title: t('Paid short of the claim (SAR)'), rows: rows.filter(function (x) { return x.r.status === 'paid' && x.s.paid < x.s.amount; }).map(function (x) { return Object.assign(row(x, x.s.amount - x.s.paid), { tone: 'fail' }); }), empty: t('Every refund was paid in full.') };
    return null;
  };

  // ================================================================ disputes and penalties
  var DSTEP = ['Notice', 'Objection', 'Committee', 'Appeal', 'Closed'];
  var stepOf = function (stage) { return { notice: 0, objection: 1, zatca_rejected: 1, committee: 2, committee_decided: 2, appeal: 3, closed: 4 }[stage] || 0; };
  Z.views.disputes = function () {
    return Z.list('disputes').then(function (ds) {
      S.disputes = ds;
      var rows = ds.map(function (d) { return { d: d, s: E.disputeStatus(d, cfg(), Z.today()) }; }).sort(function (a, b) { return (a.s.state === 'closed') - (b.s.state === 'closed') || String(a.s.next && a.s.next.due || '9').localeCompare(String(b.s.next && b.s.next.due || '9')); });
      var open = rows.filter(function (x) { return x.s.state !== 'closed'; }), stake = open.reduce(function (a, x) { return a + x.s.atStake; }, 0);
      var mine = open.filter(function (x) { return x.s.next && x.s.next.due && !x.s.next.zatca; }), soon = mine.filter(function (x) { return x.s.daysLeft <= 30; });
      var relief = rows.reduce(function (a, x) { return a + x.s.relief; }, 0);
      var cards = rows.map(function (x, i) {
        var d = x.d, s = x.s;
        return '<article class="zk-case st-' + s.state + (s.state === 'closed' ? ' closed' : '') + '" style="--i:' + i + '"><header><div><p class="zk-kind">' + Z.pill(d.kind === 'penalty' ? 'warn' : 'na', t(d.kind === 'penalty' ? 'Penalty' : 'Assessment')) + ' <span class="zk-tx"><i class="tx tx-' + String(d.tax || 'VAT').toLowerCase() + '"></i>' + esc(taxName(d.tax || 'VAT')) + '</span> ' + Z.ltr(d.reference || '') + '</p>' +
          '<h3>' + esc(d.title || d.reference || '') + '</h3><p class="faint">' + esc(entName(d.entityId)) + (d.period ? ', ' + t('period') + ' ' + Z.ltr(d.period) : '') + '</p></div><b class="num zk-amt">' + fmt(s.stake) + '</b></header>' +
          steps(DSTEP, stepOf(d.stage), d.stage === 'closed') +
          '<div class="zk-next">' + (s.next ? '<span>' + esc(t(s.next.label)) + '</span>' + dueChip(s.state, s.daysLeft, s.next.due) : '<span>' + (s.relief ? t('Relief obtained') + ' <b class="num">' + fmt(s.relief) + '</b>' : t('Closed')) + '</span>') + '</div>' +
          (d.grounds ? '<p class="faint zk-note">' + esc(d.grounds) + '</p>' : '') +
          '<footer><span class="faint">' + (s.paid ? t('Paid') + ' ' + fmt(s.paid) : t('Notice') + ' ' + Z.ltr(d.noticeOn || '-')) + '</span><button class="btn small" data-act="editdispute" data-id="' + d.id + '">' + (Z.can('preparer') ? t('Update') : t('Open')) + '</button></footer></article>';
      }).join('');
      var nd = mine[0];
      Z.setMain(head(t('ZATCA account'), t('Disputes and penalties'), t('Assessments and penalties from notice to final decision: 60 days to object to ZATCA, then the GSTC committees. Missing a deadline makes the assessment final.'),
        Z.can('preparer') ? '<button class="btn primary" data-act="editdispute">' + Z.icon('plus') + ' ' + t('Record a notice') + '</button>' : '') +
        '<div class="stack"><div class="kpis">' + kpi('scales', fmt(stake), t('At stake in open cases (SAR)'), 'dsp:stake', stake ? 'bad' : '') + kpi('folder-open', open.length, t('Open cases'), 'dsp:open') +
        kpi('alarm', nd ? (nd.s.daysLeft < 0 ? t('Overdue') : nd.s.daysLeft + ' ' + t('days')) : '-', t('To your next deadline'), 'dsp:soon', nd && nd.s.daysLeft <= 7 ? 'bad' : '') + kpi('seal-check', fmt(relief), t('Relief obtained (SAR)'), 'dsp:relief', 'good') + '</div>' +
        (soon.length ? '<section class="paper alert-bar" role="alert"><i class="ph ph-alarm" aria-hidden="true"></i><div><h3>' + soon.length + ' ' + t('deadlines in the next 30 days') + '</h3><p class="muted" style="margin:2px 0 0">' + soon.map(function (x) { return esc(x.d.reference || x.d.title) + ': ' + esc(t(x.s.next.label)) + ' ' + Z.ltr(x.s.next.due); }).join(' · ') + '</p></div></section>' : '') +
        '<p class="muted zk-src">' + Z.icon('info') + t('Deadlines from Settings: object within 60 days of the notice; ZATCA decides within 90 days; escalate to the GSTC within 30 days of a rejection; appeal within 30 days of a committee decision (verify the last three for your case).') + '</p>' +
        (cards ? '<div class="zk-grid">' + cards + '</div>' : '<section class="paper empty"><i class="ph ph-gavel big" aria-hidden="true"></i><h2>' + t('No disputes or penalties recorded') + '</h2><p>' + t('Record every assessment and penalty notice the day it arrives: the 60-day clock starts on notification.') + '</p></section>') + '</div>');
    });
  };
  Z.ACT.editdispute = function (el) {
    var d = (S.disputes || []).filter(function (x) { return x.id === el.dataset.id; })[0] || { kind: 'penalty', tax: 'VAT', stage: 'notice', decision: 'object', entityId: S.entityId || (S.entities[0] || {}).id, noticeOn: Z.today() };
    S.editDS = d; var can = Z.can('preparer');
    Z.modal(d.id ? d.reference || t('Dispute') : t('Record a notice'), '<form id="dsf" class="grid g2">' +
      selF('kind', t('Notice'), d.kind, [['assessment', 'Assessment'], ['penalty', 'Penalty']]) + selF('tax', t('Tax'), d.tax, [['VAT', 'VAT'], ['WHT', 'WHT'], ['ZAKAT', 'Zakat'], ['EXCISE', 'Excise'], ['RETT', 'RETT'], ['CIT', 'Income tax']]) +
      selF('entityId', t('Entity'), d.entityId, entOpts()) + Z.fld('reference', t('ZATCA reference'), d.reference, 'text', 'required') +
      '<label class="f" style="grid-column:1/-1"><span>' + t('What ZATCA says') + '</span><input type="text" name="title" value="' + esc(d.title || '') + '" required></label>' +
      Z.fld('period', t('Period concerned'), d.period, 'text', 'placeholder="2026-Q3"') + Z.fld('noticeOn', t('Notified on'), d.noticeOn, 'date', 'required') +
      Z.fld('amount', t('Tax assessed (SAR)'), d.amount, 'number', 'step="0.01" min="0"') + Z.fld('penalty', t('Penalty (SAR)'), d.penalty, 'number', 'step="0.01" min="0"') +
      selF('decision', t('Our position'), d.decision, [['object', 'Object'], ['waiver', 'Ask for a waiver'], ['accept', 'Accept and pay']]) + selF('stage', t('Stage'), d.stage, E.DISPUTE_STAGES) +
      Z.fld('objectionOn', t('Objection filed on'), d.objectionOn, 'date') + Z.fld('zatcaDecisionOn', t('ZATCA decision on'), d.zatcaDecisionOn, 'date') +
      Z.fld('hearingOn', t('Committee hearing on'), d.hearingOn, 'date') + Z.fld('committeeDecisionOn', t('Committee decision on'), d.committeeDecisionOn, 'date') +
      Z.fld('paidAmount', t('Paid so far (SAR)'), d.paidAmount, 'number', 'step="0.01" min="0"', t('Paying the undisputed part stops late-payment fines on it.')) + Z.fld('reliefAmount', t('Relief obtained (SAR)'), d.reliefAmount, 'number', 'step="0.01" min="0"') +
      Z.fld('owner', t('Owner'), d.owner, 'text') + Z.fld('soaRef', t('Reference on the statement of account'), d.soaRef, 'text') +
      '<label class="f" style="grid-column:1/-1"><span>' + t('Grounds and evidence') + '</span><textarea name="grounds">' + esc(d.grounds || '') + '</textarea></label>' + ((d.id && 'disputes:' + d.id) ? '<div style="grid-column:1/-1">' + Z.attachHtml((d.id && 'disputes:' + d.id), d.entityId) + '</div>' : '') + '</form>',
      (d.id && can ? '<button class="btn danger" data-act="delrow" data-tb="disputes" data-id="' + d.id + '">' + t('Delete') + '</button>' : '') + '<button class="btn" data-act="closemodal">' + t('Cancel') + '</button>' + (can ? '<button class="btn primary" data-act="savedispute">' + t('Save') + '</button>' : ''), true);
  };
  Z.ACT.savedispute = function () {
    var f = document.getElementById('dsf'); if (!f.reportValidity()) return;
    var d = Object.assign({}, S.editDS, Object.fromEntries(new FormData(f)));
    ['amount', 'penalty', 'paidAmount', 'reliefAmount'].forEach(function (k) { d[k] = d[k] === '' || d[k] == null ? null : +d[k]; }); d.label = d.reference;
    Z.save('disputes', d).then(function () { Z.closeModal(); Z.toast(t('Saved')); Z.route(); });
  };
  D.dsp = function (k) {
    var rows = (S.disputes || []).map(function (d) { return { d: d, s: E.disputeStatus(d, cfg(), Z.today()) }; });
    var row = function (x, v, disp) { return { label: x.d.title || x.d.reference, sub: (x.d.reference || '') + ', ' + entName(x.d.entityId) + (x.s.next ? ', ' + t(x.s.next.label) + ' ' + (x.s.next.due || '') : ''), value: v, display: disp, act: 'editdispute', data: { id: x.d.id }, tone: x.s.state === 'overdue' || x.s.state === 'urgent' ? 'fail' : '' }; };
    var open = rows.filter(function (x) { return x.s.state !== 'closed'; });
    if (k === 'stake') return { title: t('At stake in open cases (SAR)'), sub: t('Tax plus penalty, less what is paid'), total: open.reduce(function (a, x) { return a + x.s.atStake; }, 0), totalLabel: 'SAR', rows: open.map(function (x) { return row(x, x.s.atStake); }), empty: t('No open cases.') };
    if (k === 'open') return { title: t('Open cases'), total: open.length, totalLabel: t('cases'), money: false, rows: open.map(function (x) { return row(x, x.s.atStake); }), empty: t('No open cases.') };
    if (k === 'soon') { var m = open.filter(function (x) { return x.s.next && x.s.next.due && !x.s.next.zatca; }).sort(function (a, b) { return a.s.daysLeft - b.s.daysLeft; }); return { title: t('Your deadlines'), rows: m.map(function (x) { return row(x, Math.max(0, 120 - x.s.daysLeft), x.s.daysLeft < 0 ? t('Overdue') : x.s.daysLeft + ' ' + t('days')); }), money: false, empty: t('No deadline is waiting on you.') }; }
    if (k === 'relief') return { title: t('Relief obtained (SAR)'), total: rows.reduce(function (a, x) { return a + x.s.relief; }, 0), totalLabel: 'SAR', rows: rows.filter(function (x) { return x.s.relief; }).map(function (x) { return Object.assign(row(x, x.s.relief), { tone: 'pass' }); }), empty: t('No relief recorded yet.') };
    return null;
  };

  // ================================================================ tax calendar
  var CAL = { items: [], tax: 'all', month: null };
  var TF = [['all', 'All'], ['VAT', 'VAT'], ['WHT', 'WHT'], ['ZAKAT', 'Zakat'], ['ZATCA', 'ZATCA and disputes'], ['OTHER', 'Other taxes']];
  var inTF = function (it) { if (CAL.tax === 'all') return true; if (CAL.tax === 'ZATCA') return it.kind === 'request' || it.kind === 'dispute' || it.kind === 'refund'; if (CAL.tax === 'OTHER') return ['EXCISE', 'RETT', 'CIT', 'OTHER'].indexOf(it.tax) >= 0 && it.kind === 'custom'; return it.tax === CAL.tax && (it.kind === 'return' || it.kind === 'correction' || it.kind === 'custom'); };
  Z.views.calendar = function () {
    var today = Z.today(); CAL.month = CAL.month || today.slice(0, 7);
    var back = new Date(Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 4, 1)).toISOString().slice(0, 10), from = back, to = (+today.slice(0, 4) + 1) + '-12-31';
    return Promise.all(['requests', 'disputes', 'refunds', 'events', 'findings', 'annual'].map(function (tb) { return Z.list(tb).catch(function () { return []; }); })).then(function (r) {
      S.events = r[3];
      var exById = {}; S.exercises.forEach(function (x) { exById[x.id] = x; });
      var cor = E.corrections(r[4], cfg(), today).map(function (c) { return Object.assign(c, { entityId: (exById[c.parentId] || {}).entityId }); });
      var ids = S.entities.filter(function (e) { return e.active !== false; });
      CAL.items = E.complianceCalendar({ entities: ids, exercises: S.exercises, requests: r[0], disputes: r[1], refunds: r[2], events: r[3], corrections: cor, annual: r[5], settings: cfg(), today: today, from: from, to: to });
      renderCal();
    });
  };
  function stateText(it) { return { done: t('Done'), overdue: t('Overdue'), soon: t('This week'), upcoming: t('Upcoming'), waiting: t('Waiting for ZATCA'), untracked: t('No exercise') }[it.state]; }
  function itemHref(it) { return it.exId ? '#/' + S.tax + '/ex/' + it.exId + '/filing' : it.href ? '#/' + S.tax + '/' + it.href : ''; }
  function renderCal() {
    var today = Z.today(), all = CAL.items.filter(inTF), m = CAL.month;
    var mine = all.filter(function (i) { return i.state !== 'done'; });
    var over = mine.filter(function (i) { return i.state === 'overdue'; }), week = mine.filter(function (i) { return i.state === 'soon'; }), d30 = mine.filter(function (i) { return i.daysLeft >= 0 && i.daysLeft <= 30; });
    var doneM = all.filter(function (i) { return i.state === 'done' && i.date.slice(0, 7) === today.slice(0, 7); });
    // month grid, weeks start on Sunday
    var y = +m.slice(0, 4), mo = +m.slice(5, 7), first = new Date(Date.UTC(y, mo - 1, 1)), days = new Date(Date.UTC(y, mo, 0)).getUTCDate(), lead = first.getUTCDay();
    var byDay = {}; all.forEach(function (i) { if (i.date.slice(0, 7) === m) (byDay[i.date] = byDay[i.date] || []).push(i); });
    var wd = [t('Sun'), t('Mon'), t('Tue'), t('Wed'), t('Thu'), t('Fri'), t('Sat')];
    var cells = ''; for (var k = 0; k < lead; k++) cells += '<span class="zk-d pad"></span>';
    for (var dd = 1; dd <= days; dd++) {
      var iso = m + '-' + (dd < 10 ? '0' : '') + dd, its = byDay[iso] || [], worst = its.some(function (i) { return i.state === 'overdue'; }) ? 'overdue' : its.some(function (i) { return i.state === 'soon'; }) ? 'soon' : its.length && its.every(function (i) { return i.state === 'done'; }) ? 'done' : its.length ? 'upcoming' : '';
      cells += '<' + (its.length ? 'a href="#cal-' + iso + '" data-act="caljump" data-d="' + iso + '"' : 'span') + ' class="zk-d' + (iso === today ? ' today' : '') + (worst ? ' has ' + worst : '') + '"' + (its.length ? ' aria-label="' + esc(iso + ': ' + its.length + ' ' + t('deadlines')) + '"' : '') + '><b>' + dd + '</b>' +
        (its.length ? '<span class="dots">' + its.slice(0, 4).map(function (i) { return '<i class="tx-' + i.tax.toLowerCase() + '"></i>'; }).join('') + '</span>' : '') + '</' + (its.length ? 'a' : 'span') + '>';
    }
    var monthName = function (mk) { return new Date(Date.UTC(+mk.slice(0, 4), +mk.slice(5, 7) - 1, 1)).toLocaleDateString(ar() ? 'ar-SA-u-ca-gregory-nu-latn' : 'en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }); };
    var shift = function (n) { var d = new Date(Date.UTC(y, mo - 1 + n, 1)); return d.toISOString().slice(0, 7); };
    var grid = '<section class="paper zk-month"><header class="cal-nav-row"><button class="btn ghost icon" data-act="calmonth" data-m="' + shift(-1) + '" aria-label="' + esc(t('Previous month')) + '">' + Z.icon(ar() ? 'caret-right' : 'caret-left') + '</button><h2>' + esc(monthName(m)) + '</h2><button class="btn ghost icon" data-act="calmonth" data-m="' + shift(1) + '" aria-label="' + esc(t('Next month')) + '">' + Z.icon(ar() ? 'caret-left' : 'caret-right') + '</button></header>' +
      '<div class="zk-wd">' + wd.map(function (w) { return '<span>' + esc(w) + '</span>'; }).join('') + '</div><div class="zk-days">' + cells + '</div>' +
      '<p class="zk-legend">' + [['vat', 'VAT'], ['wht', 'WHT'], ['zakat', 'Zakat'], ['zatca', 'ZATCA'], ['other', 'Other']].map(function (l) { return '<span><i class="tx tx-' + l[0] + '"></i>' + esc(t(l[1])) + '</span>'; }).join('') + '</p></section>';
    // agenda: from the start of the shown month, the next 120 days of items, grouped by date
    var start = m + '-01', end = new Date(Date.parse(start + 'T00:00:00Z') + 120 * 86400000).toISOString().slice(0, 10);
    var list = all.filter(function (i) { return (i.date >= start && i.date <= end) || (i.state === 'overdue' && m === today.slice(0, 7)); });
    var groups = {}, order = []; list.forEach(function (i) { if (!groups[i.date]) { groups[i.date] = []; order.push(i.date); } groups[i.date].push(i); });
    var agenda = '<section class="paper zk-agenda"><header><div><h2>' + t('Agenda') + '</h2><p>' + t('From the month shown, the next 120 days, plus anything overdue.') + '</p></div></header>' + (order.length ? '<ol>' + order.map(function (d, gi) {
      var dt = new Date(d + 'T00:00:00Z');
      return '<li id="cal-' + d + '" style="--i:' + gi + '"><div class="zk-date' + (d < today ? ' past' : d === today ? ' today' : '') + '"><b>' + dt.getUTCDate() + '</b><span>' + esc(dt.toLocaleDateString(ar() ? 'ar-SA-u-ca-gregory-nu-latn' : 'en-GB', { month: 'short', timeZone: 'UTC' })) + '</span></div><ul>' + groups[d].map(function (i) {
        var href = itemHref(i), tag = href ? 'a href="' + href + '"' : i.evId ? 'a href="#" data-act="editevent" data-id="' + i.evId + '" data-d="' + i.date + '"' : 'div';
        return '<li><' + tag + ' class="zk-it st-' + i.state + '"><i class="tx tx-' + i.tax.toLowerCase() + '" aria-hidden="true"></i><span class="zk-it-t"><b>' + esc(t(i.title)) + (i.period ? ' ' + Z.ltr(i.period) : '') + '</b><small>' + esc(entName(i.entityId)) + ', ' + esc(taxName(i.tax)) + '</small></span><span class="zk-st">' + esc(stateText(i)) + '</span></' + tag.split(' ')[0] + '></li>';
      }).join('') + '</ul></li>';
    }).join('') + '</ol>' : '<div class="empty"><p>' + t('Nothing due in this window.') + '</p></div>') + '</section>';
    var chips = '<div class="zk-filter" role="group" aria-label="' + esc(t('Show')) + '">' + TF.map(function (f) { return '<button type="button" class="zk-fchip' + (CAL.tax === f[0] ? ' on' : '') + '" aria-pressed="' + (CAL.tax === f[0]) + '" data-act="caltax" data-k="' + f[0] + '">' + (f[0] === 'all' ? '' : '<i class="tx tx-' + f[0].toLowerCase() + '"></i>') + esc(t(f[1])) + '</button>'; }).join('') + '</div>';
    Z.setMain(head(t('ZATCA account'), t('Tax calendar'), t('Every filing and payment deadline across taxes and companies, with ZATCA letters, dispute and refund dates. Export it to Outlook or Google Calendar.'),
      '<button class="btn" data-act="calics">' + Z.icon('calendar-plus') + ' ' + t('Export to calendar (.ics)') + '</button>' + (Z.can('preparer') ? '<button class="btn primary" data-act="editevent">' + Z.icon('plus') + ' ' + t('Add a deadline') + '</button>' : '')) +
      '<div class="stack"><div class="kpis">' + kpi('warning', over.length, t('Overdue'), 'cal:over', over.length ? 'bad' : '') + kpi('alarm', week.length, t('Due within 7 days'), 'cal:week', week.length ? 'bad' : '') +
      kpi('calendar-dots', d30.length, t('Due in the next 30 days'), 'cal:d30') + kpi('check-circle', doneM.length, t('Done this month'), 'cal:done', 'good') + '</div>' + chips +
      '<div class="zk-cal">' + grid + agenda + '</div></div>');
  }
  Z.ACT.calmonth = function (el) { CAL.month = el.dataset.m; renderCal(); };
  Z.ACT.caltax = function (el) { CAL.tax = el.dataset.k; renderCal(); };
  Z.ACT.caljump = function (el) { var x = document.getElementById('cal-' + el.dataset.d); if (x) { x.scrollIntoView({ behavior: 'smooth', block: 'center' }); x.classList.add('flash'); setTimeout(function () { x.classList.remove('flash'); }, 1600); } };
  Z.ACT.calics = function () {
    var items = CAL.items.filter(inTF).filter(function (i) { return i.state !== 'done' && i.date >= Z.today(); }).map(function (i) {
      return { date: i.date, key: i.key, summary: t(i.title) + (i.period ? ' ' + i.period : '') + ' - ' + entName(i.entityId), description: taxName(i.tax) + '. ' + t('From Inspection Ready.') };
    });
    if (!items.length) return Z.toast(t('Nothing upcoming to export.'), true);
    download('tax-calendar-' + Z.today() + '.ics', E.ics(items, Z.orgName ? Z.orgName() + ' tax calendar' : 'Tax calendar'), 'text/calendar;charset=utf-8');
    Z.toast(items.length + ' ' + t('deadlines exported'));
  };
  Z.ACT.editevent = function (el) {
    var ev = (S.events || []).filter(function (x) { return el && el.dataset && x.id === el.dataset.id; })[0] || { tax: 'OTHER', repeat: '', entityId: S.entityId || (S.entities[0] || {}).id, date: Z.today() };
    S.editEV = ev; S.editEVDate = el && el.dataset ? el.dataset.d : ''; var can = Z.can('preparer'), done = ev.id && (ev.doneDates || []).indexOf(S.editEVDate) >= 0;
    Z.modal(ev.id ? ev.title : t('Add a deadline'), '<form id="evf" class="grid g2"><label class="f" style="grid-column:1/-1"><span>' + t('What is due') + '</span><input type="text" name="title" value="' + esc(ev.title || '') + '" required placeholder="' + esc(t('e.g. Excise return, CIT advance payment, RETT on a sale')) + '"></label>' +
      selF('entityId', t('Entity'), ev.entityId, entOpts()) + selF('tax', t('Tax'), ev.tax, [['VAT', 'VAT'], ['WHT', 'WHT'], ['ZAKAT', 'Zakat'], ['EXCISE', 'Excise'], ['RETT', 'RETT'], ['CIT', 'Income tax'], ['OTHER', 'Other']]) +
      Z.fld('date', t('Date'), ev.date, 'date', 'required') + selF('repeat', t('Repeats'), ev.repeat || '', [['', 'Once'], ['monthly', 'Every month'], ['quarterly', 'Every quarter'], ['yearly', 'Every year']]) +
      '<label class="f" style="grid-column:1/-1"><span>' + t('Notes') + '</span><textarea name="note">' + esc(ev.note || '') + '</textarea></label></form>',
      (ev.id && can ? '<button class="btn danger" data-act="delrow" data-tb="events" data-id="' + ev.id + '">' + t('Delete') + '</button>' : '') +
      (ev.id && can && S.editEVDate ? '<button class="btn" data-act="evdone">' + (done ? t('Mark as not done') : t('Mark done for') + ' ' + esc(S.editEVDate)) + '</button>' : '') +
      '<button class="btn" data-act="closemodal">' + t('Cancel') + '</button>' + (can ? '<button class="btn primary" data-act="saveevent">' + t('Save') + '</button>' : ''));
  };
  Z.ACT.saveevent = function () {
    var f = document.getElementById('evf'); if (!f.reportValidity()) return;
    var d = Object.assign({}, S.editEV, Object.fromEntries(new FormData(f))); d.label = d.title;
    Z.save('events', d).then(function () { Z.closeModal(); Z.toast(t('Saved')); Z.route(); });
  };
  Z.ACT.evdone = function () {
    var ev = Object.assign({}, S.editEV), d = S.editEVDate, l = (ev.doneDates || []).slice(), i = l.indexOf(d);
    if (i >= 0) l.splice(i, 1); else l.push(d); ev.doneDates = l;
    Z.save('events', ev).then(function () { Z.closeModal(); Z.route(); });
  };
  D.cal = function (k) {
    var all = CAL.items.filter(inTF), today = Z.today();
    var pick = { over: function (i) { return i.state === 'overdue'; }, week: function (i) { return i.state === 'soon'; }, d30: function (i) { return i.state !== 'done' && i.daysLeft >= 0 && i.daysLeft <= 30; }, done: function (i) { return i.state === 'done' && i.date.slice(0, 7) === today.slice(0, 7); } }[k];
    if (!pick) return null;
    var l = all.filter(pick);
    return { title: { over: t('Overdue'), week: t('Due within 7 days'), d30: t('Due in the next 30 days'), done: t('Done this month') }[k], total: l.length, totalLabel: t('deadlines'), money: false,
      rows: l.map(function (i) { return { label: t(i.title) + (i.period ? ' ' + i.period : ''), sub: i.date + ', ' + entName(i.entityId) + ', ' + taxName(i.tax), value: Math.abs(i.daysLeft), display: i.state === 'done' ? t('Done') : i.daysLeft < 0 ? -i.daysLeft + ' ' + t('days late') : i.daysLeft + ' ' + t('days'), tone: i.state === 'overdue' ? 'fail' : i.state === 'soon' ? 'warn' : 'pass', href: itemHref(i) || undefined }; }),
      empty: t('Nothing here.') };
  };

  // ================================================================ reviewer notes on checks
  // A manager raises a note on a check; the preparer replies; the manager clears
  // it. The server refuses sign-off while any note is open.
  var reviews = function () { return (S.ex && S.ex.reviews) || []; };
  Z.openReviews = function () { return reviews().filter(function (r) { return r.status !== 'cleared'; }); };
  Z.reviewHtml = function (checkId) {
    var list = reviews().filter(function (r) { return r.checkId === checkId; }); if (!list.length) return '';
    var closed = S.ex.status === 'closed', mgr = Z.can('manager'), prep = Z.can('preparer');
    return '<div class="zk-reviews">' + list.map(function (r) {
      var open = r.status !== 'cleared';
      return '<div class="zk-rv' + (open ? ' open' : '') + '"><p class="zk-rv-h">' + Z.icon(open ? 'chat-circle-dots' : 'check-circle') + '<b>' + esc(r.by || t('Reviewer')) + '</b><span class="faint">' + esc(String(r.at || '').slice(0, 10)) + '</span>' + (open ? Z.pill('warn', t('Open review note')) : Z.pill('pass', t('Cleared'))) + '</p><p class="zk-rv-t">' + esc(r.text) + '</p>' +
        (r.reply && (!open || closed || !prep) ? '<p class="zk-rv-r">' + Z.icon('arrow-bend-down-right') + esc(r.reply) + (r.repliedBy ? ' <span class="faint">- ' + esc(r.repliedBy) + '</span>' : '') + '</p>' : '') +
        (open && !closed && prep ? '<label class="f"><span class="sr-only">' + t('Reply') + '</span><textarea data-chg="rvreply" data-id="' + r.id + '" placeholder="' + esc(t('Reply to the reviewer: what you did or why no change is needed')) + '">' + esc(r.reply || '') + '</textarea></label>' : '') +
        (!closed && mgr ? '<div class="row">' + (open ? '<button class="btn small" data-act="rvclear" data-id="' + r.id + '">' + Z.icon('check') + ' ' + t('Clear') + '</button>' : '<button class="btn small ghost" data-act="rvclear" data-id="' + r.id + '" data-reopen="1">' + t('Reopen') + '</button>') + '<button class="btn small ghost" data-act="rvdel" data-id="' + r.id + '">' + t('Delete') + '</button></div>' : '') + '</div>';
    }).join('') + '</div>';
  };
  Z.reviewButton = function (checkId) { return S.ex && S.ex.status !== 'closed' && Z.can('manager') ? '<button class="btn small ghost" data-act="rvadd" data-id="' + checkId + '">' + Z.icon('chat-circle-text') + ' ' + t('Review note') + '</button>' : ''; };
  function saveReviews(msg) { return Z.saveEx().then(function () { Z.route(); if (msg) Z.toast(msg); }); }
  Z.ACT.rvadd = function (el) {
    S.rvCheck = el.dataset.id;
    Z.modal(t('Review note on') + ' ' + el.dataset.id, '<form id="rvf"><label class="f"><span>' + t('What should the preparer look at?') + '</span><textarea name="text" required></textarea></label><p class="faint" style="font-size:12.5px">' + t('The exercise cannot be signed off until every review note is cleared.') + '</p></form>',
      '<button class="btn" data-act="closemodal">' + t('Cancel') + '</button><button class="btn primary" data-act="rvsave">' + t('Add note') + '</button>');
  };
  Z.ACT.rvsave = function () {
    var f = document.getElementById('rvf'); if (!f.reportValidity()) return;
    S.ex.reviews = reviews().concat([{ id: Z.uid('RV'), checkId: S.rvCheck, text: f.elements.text.value.trim(), by: Z.userName(), at: new Date().toISOString(), status: 'open' }]);
    Z.closeModal(); saveReviews(t('Review note added'));
  };
  Z.ACT.rvclear = function (el) {
    var reopen = !!el.dataset.reopen;
    S.ex.reviews = reviews().map(function (r) { return r.id === el.dataset.id ? Object.assign({}, r, reopen ? { status: 'open', clearedBy: null, clearedAt: null } : { status: 'cleared', clearedBy: Z.userName(), clearedAt: new Date().toISOString() }) : r; });
    saveReviews(reopen ? t('Review note reopened') : t('Review note cleared'));
  };
  Z.ACT.rvdel = function (el) { if (!confirm(t('Delete this review note?'))) return; S.ex.reviews = reviews().filter(function (r) { return r.id !== el.dataset.id; }); saveReviews(); };
  Z.CHG.rvreply = function (el) { S.ex.reviews = reviews().map(function (r) { return r.id === el.dataset.id ? Object.assign({}, r, { reply: el.value }) : r; }); Z.saveEx(); };
  // the sign-off block on the report tab
  Z.reviewSummary = function () {
    var open = Z.openReviews(), all = reviews(); if (!all.length) return '';
    var tabOf = function (id) { if (!S.R) return 'overview'; var g = [['vat', S.R.vat.checks], ['bank', S.R.bank.checks], ['einv', S.R.einv.checks], ['filing', S.R.filing.checks], ['other', S.R.other.checks], ['wht', S.R.wht.checks]]; for (var i = 0; i < g.length; i++) if (g[i][1].some(function (c) { return c.id === id; })) return g[i][0]; return 'overview'; };
    return '<section class="paper zk-rvsum noprint' + (open.length ? ' open' : '') + '"><header><div><h2>' + Z.icon(open.length ? 'chat-circle-dots' : 'check-circle') + ' ' + t('Review notes') + '</h2><p>' + (open.length ? open.length + ' ' + t('open: clear them before signing off.') : t('Every review note is cleared.')) + '</p></div><span class="score-chip">' + (all.length - open.length) + ' / ' + all.length + ' ' + t('cleared') + '</span></header>' +
      (open.length ? '<ul>' + open.map(function (r) { return '<li><a href="#" data-act="gocheck" data-id="' + esc(r.checkId) + '" data-tab="' + tabOf(r.checkId) + '"><b>' + esc(r.checkId) + '</b> ' + esc(r.text) + '</a>' + (r.reply ? ' <span class="faint">(' + t('replied') + ')</span>' : '') + '</li>'; }).join('') + '</ul>' : '') + '</section>';
  };
})();
