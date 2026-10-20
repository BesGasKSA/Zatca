/* Wave 3: income tax on the non-Saudi share with advance payments and transfer
   pricing (one `corporate` doc per entity and year), e-invoicing devices (`devices`,
   one doc per entity), the VAT group (`groups`), the board's tax risk report, and
   file attachments (`attachments` for what a file is, `files` for its content).
   Arithmetic is in the engine: E.citStatus, E.tpStatus, E.egsStatus, E.vatGroupStatus. */
(function () {
  'use strict';
  var E = window.ZEngine, S = Z.S, t = Z.t, esc = Z.esc, fmt = Z.fmt;
  var cfg = function () { return S.settingsDoc ? S.settingsDoc.values : {}; };
  var ar = function () { return S.lang === 'ar'; };
  var kpi = function (icon, val, label, tone) { return '<div class="' + (tone || '') + '">' + Z.icon(icon) + '<b>' + val + '</b><span>' + esc(label) + '</span></div>'; };
  var head = function (eyebrow, icon, title, text, right) { return '<div class="pagehead"><div><p class="eyebrow">' + Z.icon(icon) + ' ' + esc(eyebrow) + '</p><h1>' + esc(title) + '</h1><p>' + esc(text) + '</p></div>' + (right ? '<div class="row">' + right + '</div>' : '') + '</div>'; };
  var entSel = function (chg, cur) { return S.entities.length > 1 ? '<select data-chg="' + chg + '" aria-label="' + esc(t('Entity')) + '">' + S.entities.map(function (x) { return '<option value="' + x.id + '"' + (x.id === cur ? ' selected' : '') + '>' + esc(Z.entName(x)) + '</option>'; }).join('') + '</select>' : ''; };
  function chk(c) {
    var figs = c.status === 'na' ? '<span>' + t('Needs') + ': <b>' + esc(t(c.missing || '')) + '</b></span>' :
      (c.aLabel ? '<span>' + esc(t(c.aLabel)) + ': <b>' + (/Expired|Devices|Members/.test(c.aLabel) ? Z.count(c.a) : fmt(c.a)) + '</b></span>' : '') + (c.bLabel ? '<span>' + esc(t(c.bLabel)) + ': <b>' + fmt(c.b) + '</b></span>' : '') + (c.exposure ? '<span class="d fail">' + t('Exposure') + ': <b>' + fmt(c.exposure) + '</b></span>' : '');
    var list = (c.exceptions && c.exceptions.list) || [];
    return '<div class="check" id="c-' + c.id + '">' + Z.tick(c.status) + '<div><h3>' + esc(c.id) + ' · ' + esc(ar() ? c.titleAr : c.title) + '</h3><div class="figs">' + figs + '</div>' +
      (c.note ? '<p class="faint" style="font-size:12.5px;margin:4px 0 0">' + esc(ar() && c.noteAr ? c.noteAr : t(c.note)) + '</p>' : '') + (list.length ? '<details><summary>' + t('Show the items') + ' (' + list.length + ')</summary>' + Z.rowsTable(list) + '</details>' : '') + '</div><div class="acts"></div></div>';
  }
  var yes = function (v) { return v === true || v === 'yes'; };
  var TPT = { services: 'Services', goods: 'Goods', loans: 'Loans and interest', royalties: 'Royalties', management: 'Management fees', other: 'Other' };

  // ================================================================ income tax and transfer pricing
  var C = {};
  Z.views.corporate = function (h) {
    var e = Z.entity(h[1]) || Z.entity(S.entityId) || S.entities[0], year = +h[2] || +Z.today().slice(0, 4);
    if (!e) return Z.setMain('<div class="empty"><h2>' + t('Add an entity first.') + '</h2></div>');
    return Z.get('corporate', e.id + '_corp_' + year).then(function (doc) {
      C.e = e; C.year = year; C.doc = doc || { id: e.id + '_corp_' + year, entityId: e.id, year: year, fyEnd: year + '-12-31', instalments: [], transactions: [], label: 'Income tax ' + year };
      C.doc.instalments = Array.isArray(C.doc.instalments) ? C.doc.instalments : []; C.doc.transactions = Array.isArray(C.doc.transactions) ? C.doc.transactions : [];
      renderCorp();
    });
  };
  function renderCorp() {
    var d = C.doc, e = C.e, can = Z.can('preparer'), cit = E.citStatus(d, cfg(), Z.today()), tp = E.tpStatus(d, cfg(), Z.today());
    var dis = can ? '' : ' disabled';
    var f = function (k, label, type, hint, attrs) { return Z.fld('c_' + k, label, d[k], type, 'data-chg="corp" data-f="' + k + '"' + (attrs || '') + dis, hint); };
    var sel = function (k, label, opts) { return '<label class="f"><span>' + esc(label) + '</span><select data-chg="corp" data-f="' + k + '"' + dis + '>' + opts.map(function (o) { return '<option value="' + o[0] + '"' + (String(d[k] == null ? '' : d[k]) === o[0] ? ' selected' : '') + '>' + esc(t(o[1])) + '</option>'; }).join('') + '</select></label>'; };
    var years = []; for (var y = +Z.today().slice(0, 4) + 1; y >= Z.FIRST_YEAR; y--) years.push(y);
    var inst = cit.required ? '<div class="zk-inst">' + cit.rows.map(function (r, i) {
      return '<div class="zk-inst-c st-' + r.state + '" style="--i:' + i + '"><span class="zk-k">' + t('Instalment') + ' ' + r.n + '</span><b class="num">' + fmt(r.amount) + '</b><span>' + t('Due') + ' ' + Z.ltr(r.due) + '</span>' +
        '<span class="zk-inst-s">' + esc(t({ paid: 'Paid on time', late: 'Paid late', overdue: 'Overdue', due: 'Not yet due' }[r.state])) + (r.fine ? ', ' + t('fine') + ' ' + fmt(r.fine) : '') + '</span>' +
        '<div class="grid g2">' + Z.fld('ip' + i, t('Paid on'), (d.instalments[i] || {}).paidOn, 'date', 'data-chg="corpinst" data-i="' + i + '" data-f="paidOn"' + dis) + Z.fld('ia' + i, t('Amount paid'), (d.instalments[i] || {}).amount, 'number', 'step="0.01" data-chg="corpinst" data-i="' + i + '" data-f="amount"' + dis) + '</div></div>';
    }).join('') + '</div>' : '<p class="muted">' + (cit.prior ? t('No advance payments are due this year.') : t('Enter last year\'s income tax to see whether advance payments are due.')) + '</p>';
    var types = Object.keys(tp.byType), maxT = Math.max.apply(null, types.map(function (k) { return tp.byType[k]; }).concat([1]));
    var gauge = '<div class="zk-gauge" role="img" aria-label="' + esc(t('Controlled transactions against the SAR 6 million threshold')) + '"><div class="zk-gauge-t"><i style="--w:' + Math.min(100, tp.total / (E.mergeSettings(cfg()).tp.fileThreshold) * 100).toFixed(1) + '%" class="' + (tp.filesRequired ? 'over' : '') + '"></i></div><span>' + fmt(tp.total) + ' / ' + fmt(E.mergeSettings(cfg()).tp.fileThreshold) + '</span></div>';
    Z.setMain(head(t('Income tax'), 'bank', t('Income tax and transfer pricing') + ': ' + Z.entName(e) + ' ' + C.year, t('Income tax on the share owned by non-Saudi shareholders, the advance payments it triggers, and the transfer pricing filings that go with the return.'),
      entSel('corpent', e.id) + '<select data-chg="corpyear" aria-label="' + esc(t('Year')) + '">' + years.map(function (y) { return '<option' + (y === C.year ? ' selected' : '') + '>' + y + '</option>'; }).join('') + '</select>') +
      '<div class="stack"><div class="kpis">' + kpi('percent', Math.round(cit.share * 100) + '%', t('Non-Saudi share')) + kpi('bank', fmt(cit.tax), t('Income tax on that share (SAR)')) +
      kpi('calendar-check', cit.required ? fmt(cit.instalment) : '-', t('Each advance payment (SAR)')) + kpi('warning', fmt(cit.exposure + 0), t('Overdue tax and fines (SAR)'), cit.exposure ? 'bad' : '') + kpi('arrows-left-right', fmt(tp.total), t('Controlled transactions (SAR)')) + '</div>' +
      '<p class="muted zk-src">' + Z.icon('info') + t('Rates and thresholds from adviser summaries of the Income Tax Law (Art. 70) and the Transfer Pricing Bylaws: 20% on the non-Saudi share, advance payments when last year\'s tax was SAR 2 million or more, files at SAR 6 million, CbCR above SAR 3.2 billion. Verify; editable in Settings.') + '</p>' +
      '<section class="paper"><h2>' + t('The year') + '</h2><div class="grid g3" style="margin-top:10px">' + f('fyEnd', t('Year end'), 'date') + f('foreignSharePct', t('Non-Saudi ownership (%)'), 'number', '', ' step="0.01" min="0" max="100"') +
      f('taxableProfit', t('Taxable profit (SAR)'), 'number', t('Estimate during the year; final figure from the return.'), ' step="0.01"') + f('priorYearTax', t('Last year\'s income tax (SAR)'), 'number', '', ' step="0.01" min="0"') +
      f('priorYearWht', t('WHT suffered last year (SAR)'), 'number', '', ' step="0.01" min="0"') + f('filedOn', t('Return filed on'), 'date') + '</div></section>' +
      '<section class="paper"><header><div><h2>' + t('Advance payments') + '</h2><p>' + t('Three instalments at the end of months 6, 9 and 12 of the tax year.') + '</p></div></header>' + inst + cit.checks.map(chk).join('') + '</section>' +
      '<section class="paper"><header><div><h2>' + t('Transfer pricing') + '</h2><p>' + t('Transactions with related parties for the year, against the documentation thresholds.') + '</p></div>' + gauge + '</header>' +
      (types.length ? '<div class="hbars" style="margin:6px 0 14px">' + types.map(function (k, i) { return '<div class="hb" style="--i:' + i + '"><span>' + esc(t(TPT[k] || k)) + '</span><div class="track"><i style="--w:' + (tp.byType[k] / maxT * 100).toFixed(1) + '%"></i></div><b class="num">' + fmt(tp.byType[k]) + '</b></div>'; }).join('') + '</div>' : '') +
      '<div class="tbl-wrap"><table class="t"><thead><tr><th>' + t('Related party') + '</th><th>' + t('Country') + '</th><th>' + t('Type') + '</th><th class="num">' + t('Amount (SAR)') + '</th>' + (can ? '<th><span class="sr-only">' + t('Remove') + '</span></th>' : '') + '</tr></thead><tbody>' +
      d.transactions.map(function (x, i) { return '<tr><td>' + esc(x.party || '') + '</td><td>' + esc(x.country || '') + '</td><td>' + esc(t(TPT[x.type] || x.type || 'Other')) + '</td><td class="num">' + fmt(x.amount) + '</td>' + (can ? '<td><button class="btn ghost small icon" data-act="tpdel" data-i="' + i + '" aria-label="' + esc(t('Remove') + ' ' + (x.party || '')) + '">' + Z.icon('x') + '</button></td>' : '') + '</tr>'; }).join('') +
      (can ? '<tr><td><input type="text" id="tp-p" aria-label="' + esc(t('Related party')) + '"></td><td><input type="text" id="tp-c" aria-label="' + esc(t('Country')) + '"></td><td><select id="tp-t" aria-label="' + esc(t('Type')) + '">' + [['services', 'Services'], ['goods', 'Goods'], ['loans', 'Loans and interest'], ['royalties', 'Royalties'], ['management', 'Management fees'], ['other', 'Other']].map(function (o) { return '<option value="' + o[0] + '">' + esc(t(o[1])) + '</option>'; }).join('') + '</select></td><td><input type="number" step="0.01" min="0" id="tp-a" aria-label="' + esc(t('Amount (SAR)')) + '"></td><td><button class="btn small" data-act="tpadd">' + t('Add') + '</button></td></tr>' : '') + '</tbody></table></div>' +
      '<div class="grid g3" style="margin-top:14px">' + f('groupRevenue', t('Group consolidated revenue (SAR)'), 'number', '', ' step="1" min="0"') + f('disclosureFiledOn', t('Disclosure form filed on'), 'date') + f('cbcrNotifiedOn', t('CbCR notification filed on'), 'date') +
      sel('localFileReady', t('Local file ready'), [['no', 'No'], ['yes', 'Yes']]) + sel('masterFileReady', t('Master file ready'), [['no', 'No'], ['yes', 'Yes']]) + '</div>' + tp.checks.map(chk).join('') + '</section></div>');
  }
  function saveCorp(msg) { return Z.save('corporate', C.doc).then(function (d) { C.doc = d; d.instalments = d.instalments || []; d.transactions = d.transactions || []; renderCorp(); if (msg) Z.toast(msg); }); }
  Z.CHG.corp = function (el) { var f = el.dataset.f; C.doc[f] = el.type === 'number' ? (el.value === '' ? null : +el.value) : el.value; saveCorp(); };
  Z.CHG.corpinst = function (el) { var i = +el.dataset.i; while (C.doc.instalments.length <= i) C.doc.instalments.push({}); C.doc.instalments[i][el.dataset.f] = el.type === 'number' ? (el.value === '' ? null : +el.value) : el.value; saveCorp(); };
  Z.CHG.corpent = function (el) { location.hash = '#/' + S.tax + '/corporate/' + el.value + '/' + C.year; };
  Z.CHG.corpyear = function (el) { location.hash = '#/' + S.tax + '/corporate/' + C.e.id + '/' + el.value; };
  Z.ACT.tpadd = function () {
    var p = document.getElementById('tp-p').value.trim(), a = +document.getElementById('tp-a').value;
    if (!p || !(a > 0)) return Z.toast(t('Enter the related party and an amount.'), true);
    C.doc.transactions.push({ party: p, country: document.getElementById('tp-c').value.trim(), type: document.getElementById('tp-t').value, amount: a }); saveCorp(t('Saved'));
  };
  Z.ACT.tpdel = function (el) { C.doc.transactions.splice(+el.dataset.i, 1); saveCorp(t('Line removed')); };

  // ================================================================ e-invoicing devices
  var G = {};
  Z.views.devices = function (h) {
    var e = Z.entity(h[1]) || Z.entity(S.entityId) || S.entities[0];
    if (!e) return Z.setMain('<div class="empty"><h2>' + t('Add an entity first.') + '</h2></div>');
    return Z.get('devices', e.id + '_egs').then(function (doc) {
      G.e = e; G.doc = doc || { id: e.id + '_egs', entityId: e.id, list: [], label: 'E-invoicing devices' }; G.doc.list = Array.isArray(G.doc.list) ? G.doc.list : [];
      // units seen in the latest e-invoicing provider export of this company
      var x = S.exercises.filter(function (z) { return z.entityId === e.id; }).sort(function (a, b) { return a.period < b.period ? 1 : -1; })[0];
      G.seen = S.ex && S.ex.entityId === e.id && S.data && S.data.einv_provider ? S.data.einv_provider.map(function (r) { return r.egs; }) : null; G.exPeriod = S.ex && S.ex.entityId === e.id ? S.ex.period : x && x.period;
      renderDev();
    });
  };
  function renderDev() {
    var r = E.egsStatus(G.doc.list, G.seen, cfg(), Z.today()), can = Z.can('preparer');
    var by = { ok: 0, renew: 0, expired: 0, unknown: 0, retired: 0 }; r.list.forEach(function (x) { by[x.state]++; });
    var cards = r.list.map(function (x, i) {
      var d = x.d, span = d.csidIssuedOn && d.csidExpiresOn ? Math.max(1, E.daysBetween(E.date(d.csidIssuedOn) || Z.today(), E.date(d.csidExpiresOn) || Z.today())) : 0, used = span ? Math.min(100, Math.max(0, (span - Math.max(0, x.left)) / span * 100)) : 100;
      return '<article class="zk-dev st-' + x.state + '" style="--i:' + i + '"><header><span class="zk-dev-ico">' + Z.icon(d.type === 'pos' ? 'cash-register' : 'hard-drives') + '</span><div><h3>' + esc(d.name || d.code) + '</h3><p class="faint">' + Z.ltr(d.code || '') + (d.location ? ', ' + esc(d.location) : '') + '</p></div>' +
        '<span class="zk-dev-st">' + esc(t({ ok: 'Valid', renew: 'Renew now', expired: 'Expired', unknown: 'No expiry date', retired: 'Retired' }[x.state])) + '</span></header>' +
        '<div class="zk-life"><i style="--w:' + used.toFixed(1) + '%"></i></div><p class="zk-life-t">' + (x.left == null ? t('Enter the CSID expiry date') : x.left < 0 ? t('Expired') + ' ' + -x.left + ' ' + t('days ago') + ': ' + t('invoices stamped since are not compliant') : x.left + ' ' + t('days left') + ', ' + Z.ltr(E.date(d.csidExpiresOn))) + '</p>' +
        (can ? '<footer><button class="btn small" data-act="devedit" data-i="' + i + '">' + t('Update') + '</button></footer>' : '') + '</article>';
    }).join('');
    Z.setMain(head(t('E-invoicing'), 'cpu', t('E-invoicing devices') + ': ' + Z.entName(G.e), t('Every unit that stamps invoices (EGS) needs its own valid cryptographic stamp (CSID) from the Fatoora portal. An expired one makes every invoice it stamps non-compliant.'),
      entSel('devent', G.e.id) + (can ? '<button class="btn primary" data-act="devedit">' + Z.icon('plus') + ' ' + t('Add a device') + '</button>' : '')) +
      '<div class="stack"><div class="kpis">' + kpi('check-circle', by.ok, t('Valid'), 'good') + kpi('clock-countdown', by.renew + by.unknown, t('To renew within 30 days'), by.renew ? 'bad' : '') + kpi('x-circle', by.expired, t('Expired'), by.expired ? 'bad' : '') + kpi('question', r.unregistered.length, t('Sending but not registered'), r.unregistered.length ? 'bad' : '') + '</div>' +
      '<section class="paper">' + r.checks.map(chk).join('') + (G.seen ? '' : '<p class="faint" style="font-size:12.5px">' + t('Open an exercise of this company with an e-invoicing provider export to compare its units with the register.') + '</p>') + '</section>' +
      (cards ? '<div class="zk-grid">' + cards + '</div>' : '<section class="paper empty"><i class="ph ph-cpu big" aria-hidden="true"></i><h2>' + t('No devices registered') + '</h2><p>' + t('Add the ERP server and each POS that stamps invoices, with its CSID expiry date from the Fatoora portal.') + '</p></section>') + '</div>');
  }
  Z.CHG.devent = function (el) { location.hash = '#/' + S.tax + '/devices/' + el.value; };
  Z.ACT.devedit = function (el) {
    var i = el && el.dataset && el.dataset.i != null ? +el.dataset.i : -1, d = i >= 0 ? G.doc.list[i] : { type: 'pos', status: 'active' }; G.editI = i;
    var sel = function (k, label, opts) { return '<label class="f"><span>' + esc(label) + '</span><select name="' + k + '">' + opts.map(function (o) { return '<option value="' + o[0] + '"' + (d[k] === o[0] ? ' selected' : '') + '>' + esc(t(o[1])) + '</option>'; }).join('') + '</select></label>'; };
    Z.modal(i >= 0 ? d.name || d.code : t('Add a device'), '<form id="devf" class="grid g2">' + Z.fld('name', t('Name'), d.name, 'text', 'required') + Z.fld('code', t('Unit code (as in the provider export)'), d.code, 'text', 'required') +
      sel('type', t('Type'), [['server', 'ERP or central server'], ['pos', 'Point of sale']]) + Z.fld('location', t('Location'), d.location, 'text') + Z.fld('csidIssuedOn', t('CSID issued on'), d.csidIssuedOn, 'date') + Z.fld('csidExpiresOn', t('CSID expires on'), d.csidExpiresOn, 'date') +
      sel('status', t('Status'), [['active', 'In use'], ['retired', 'Retired']]) + '</form>',
      (i >= 0 ? '<button class="btn danger" data-act="devdel">' + t('Delete') + '</button>' : '') + '<button class="btn" data-act="closemodal">' + t('Cancel') + '</button><button class="btn primary" data-act="devsave">' + t('Save') + '</button>');
  };
  Z.ACT.devsave = function () {
    var f = document.getElementById('devf'); if (!f.reportValidity()) return;
    var d = Object.fromEntries(new FormData(f)); Object.keys(d).forEach(function (k) { d[k] = String(d[k]).trim(); });
    if (G.editI >= 0) G.doc.list[G.editI] = Object.assign({}, G.doc.list[G.editI], d); else G.doc.list.push(d);
    Z.closeModal(); Z.save('devices', G.doc).then(function (x) { G.doc = x; x.list = x.list || []; renderDev(); Z.toast(t('Saved')); });
  };
  Z.ACT.devdel = function () { if (!confirm(t('Delete this record?'))) return; G.doc.list.splice(G.editI, 1); Z.closeModal(); Z.save('devices', G.doc).then(function (x) { G.doc = x; x.list = x.list || []; renderDev(); }); };

  // ================================================================ VAT group
  var VG = {};
  Z.views.group = function () {
    return Z.list('groups').then(function (gs) {
      VG.all = gs; VG.doc = gs[0] || null; renderGroup();
    });
  };
  function renderGroup() {
    var g = VG.doc, can = Z.can('manager');
    if (!g) return Z.setMain(head(t('VAT'), 'tree-structure', t('VAT group'), t('Companies registered together for VAT file one return. The group return must equal what each member\'s books say, added up.'), can ? '<button class="btn primary" data-act="groupnew">' + Z.icon('plus') + ' ' + t('Set up the VAT group') + '</button>' : '') +
      '<section class="paper empty"><i class="ph ph-tree-structure big" aria-hidden="true"></i><h2>' + t('No VAT group set up') + '</h2><p>' + t('VAT grouping is available since 15 October 2025 for Saudi residents under 50% common control. Set it up here if your companies file one return.') + '</p></section>');
    var members = (g.memberIds || []).map(function (id) { var e = Z.entity(id); return e ? { id: id, name: Z.entName(e), trn: e.trn, control: true, exercises: S.exercises.filter(function (x) { return x.entityId === id; }) } : null; }).filter(Boolean);
    var r = E.vatGroupStatus(g, members, cfg());
    var cell = function (v, d) { return '<td class="num">' + fmt(v) + (d && Math.abs(d) > 1 ? ' <span class="diff-bad">(' + fmt(d) + ')</span>' : '') + '</td>'; };
    Z.setMain(head(t('VAT'), 'tree-structure', g.name || t('VAT group'), t('One return for all members. Each period: the group return against the members\' own figures added up.'), can ? '<button class="btn" data-act="groupnew">' + t('Edit the group') + '</button><button class="btn primary" data-act="groupret">' + Z.icon('plus') + ' ' + t('Enter a group return') + '</button>' : '') +
      '<div class="stack"><div class="kpis">' + kpi('buildings', members.length, t('Members')) + kpi('calendar', r.lines.length, t('Group returns entered')) + kpi('warning', fmt(r.exposure), t('Exposure (SAR)'), r.exposure ? 'bad' : '') + '</div>' +
      '<section class="paper"><h2>' + t('Members') + '</h2><div class="zk-chips" style="margin-top:8px">' + members.map(function (m) { return '<span class="zk-chip">' + (m.id === g.entityId ? Z.icon('star') : '') + esc(m.name) + ' ' + Z.ltr(m.trn || '') + '</span>'; }).join('') + '</div>' + r.checks.map(chk).join('') + '</section>' +
      (r.lines.length ? '<section class="paper flush"><div class="tbl-wrap"><table class="t"><thead><tr><th>' + t('Period') + '</th><th class="num">' + t('Sales per group return') + '</th><th class="num">' + t('Members added up') + '</th><th class="num">' + t('Output VAT per group return') + '</th><th class="num">' + t('Members added up') + '</th><th class="num">' + t('Input VAT per group return') + '</th><th class="num">' + t('Members added up') + '</th><th>' + t('Status') + '</th></tr></thead><tbody>' +
        r.lines.map(function (l) { return '<tr><td>' + Z.ltr(l.period) + '</td>' + cell(l.ret.sales) + cell(l.sum.sales, l.diff.sales) + cell(l.ret.outputVat) + cell(l.sum.outputVat, l.diff.outputVat) + cell(l.ret.inputVat) + cell(l.sum.inputVat, l.diff.inputVat) + '<td>' + Z.tick(l.status) + (l.missing.length ? ' <span class="faint" style="font-size:12px">' + t('No exercise:') + ' ' + esc(l.missing.join(', ')) + '</span>' : '') + '</td></tr>'; }).join('') + '</tbody></table></div></section>' : '') + '</div>');
  }
  Z.ACT.groupnew = function () {
    var g = VG.doc || { name: '', memberIds: [] };
    Z.modal(t('VAT group'), '<form id="vgf"><label class="f"><span>' + t('Group name') + '</span><input type="text" name="name" required value="' + esc(g.name || '') + '"></label><label class="f"><span>' + t('Representative member') + '</span><select name="rep">' + S.entities.map(function (e) { return '<option value="' + e.id + '"' + (e.id === g.entityId ? ' selected' : '') + '>' + esc(Z.entName(e)) + '</option>'; }).join('') + '</select></label>' +
      '<fieldset class="zk-members"><legend>' + t('Members') + '</legend>' + S.entities.map(function (e) { return '<label class="zk-cbx"><input type="checkbox" name="m" value="' + e.id + '"' + ((g.memberIds || []).indexOf(e.id) >= 0 ? ' checked' : '') + '> ' + esc(Z.entName(e)) + '</label>'; }).join('') + '</fieldset></form>',
      '<button class="btn" data-act="closemodal">' + t('Cancel') + '</button><button class="btn primary" data-act="groupsave">' + t('Save') + '</button>');
  };
  Z.ACT.groupsave = function () {
    var f = document.getElementById('vgf'); if (!f.reportValidity()) return;
    var fd = new FormData(f), ids = fd.getAll('m'), rep = fd.get('rep'); if (ids.indexOf(rep) < 0) ids.unshift(rep);
    var g = Object.assign({ returns: {} }, VG.doc || {}, { name: fd.get('name').trim(), entityId: rep, memberIds: ids, label: fd.get('name').trim() });
    Z.save('groups', g).then(function () { Z.closeModal(); Z.toast(t('Saved')); Z.route(); });
  };
  Z.ACT.groupret = function () {
    Z.modal(t('Enter a group return'), '<form id="vgr" class="grid g2">' + Z.fld('period', t('Period'), '', 'text', 'required placeholder="2026-09"') + Z.fld('sales', t('Total sales (box 6)'), '', 'number', 'step="0.01"') + Z.fld('outputVat', t('Output VAT'), '', 'number', 'step="0.01"') + Z.fld('inputVat', t('Input VAT'), '', 'number', 'step="0.01"') + '</form>',
      '<button class="btn" data-act="closemodal">' + t('Cancel') + '</button><button class="btn primary" data-act="groupretsave">' + t('Save') + '</button>');
  };
  Z.ACT.groupretsave = function () {
    var f = document.getElementById('vgr'); if (!f.reportValidity()) return;
    var d = Object.fromEntries(new FormData(f)), p = d.period.trim();
    if (!E.periodRange(p)) return Z.toast(t('Enter the period as 2026-09 or 2026-Q3.'), true);
    VG.doc.returns = Object.assign({}, VG.doc.returns || {}); VG.doc.returns[p] = { sales: +d.sales || 0, outputVat: +d.outputVat || 0, inputVat: +d.inputVat || 0 };
    Z.save('groups', VG.doc).then(function () { Z.closeModal(); Z.toast(t('Saved')); Z.route(); });
  };

  // ================================================================ board tax risk report
  Z.views.board = function () {
    var ents = S.entities.filter(function (e) { return e.active !== false; });
    var get = function (tb, id) { return Z.get(tb, id).catch(function () { return null; }); };
    return Promise.all([Z.list('disputes').catch(function () { return []; }), Z.list('refunds').catch(function () { return []; })].concat(ents.map(function (e) { return Promise.all([get('statements', e.id + '_soa'), get('registers', e.id + '_reg'), get('corporate', e.id + '_corp_' + Z.today().slice(0, 4)), get('devices', e.id + '_egs')]); }))).then(function (r) {
      var disp = r[0], refs = r[1], today = Z.today(), V = cfg();
      var rows = ents.map(function (e, i) {
        var docs = r[i + 2], xs = S.exercises.filter(function (x) { return x.entityId === e.id; }).sort(function (a, b) { return a.period < b.period ? 1 : -1; }), sm = (xs[0] && xs[0].summary) || {};
        var vs = Z.taxScore(sm), soa = E.statementRecon(docs[0], xs, disp.filter(function (d) { return d.entityId === e.id; }), V, today), adj = E.adjustments(docs[1], V, today), cit = E.citStatus(docs[2] || {}, V, today), egs = E.egsStatus((docs[3] || {}).list, null, V, today);
        var dsp = disp.filter(function (d) { return d.entityId === e.id; }).map(function (d) { return E.disputeStatus(d, V, today); }), stake = dsp.reduce(function (s, d) { return s + d.atStake; }, 0);
        var rf = refs.filter(function (x) { return x.entityId === e.id; }).reduce(function (s, x) { return s + E.refundStatus(x, V, today).outstanding; }, 0);
        var expo = (sm.vatExposure != null ? sm.vatExposure : sm.exposure || 0) + (sm.whtExposure || 0);
        return { e: e, period: xs[0] && xs[0].period, score: vs.score, grade: vs.grade, expo: expo, soa: soa.exposure, adj: adj.exposure, rec: adj.recover, stake: stake, refund: rf, cit: cit.exposure, egs: egs.list.filter(function (x) { return x.state === 'expired'; }).length };
      });
      var tot = function (k) { return rows.reduce(function (s, x) { return s + (x[k] || 0); }, 0); };
      var risk = tot('expo') + tot('soa') + tot('adj') + tot('cit');
      var bars = [['Return and ledger exposure', tot('expo')], ['ZATCA statement', tot('soa')], ['VAT adjustments', tot('adj')], ['Income tax', tot('cit')], ['Open disputes', tot('stake')]];
      var max = Math.max.apply(null, bars.map(function (b) { return b[1]; }).concat([1]));
      Z.setMain(head(t('Report'), 'presentation-chart', t('Tax risk report for the board'), t('Every company on one page: readiness, money at risk, disputes, refunds and devices. Print it or save it as PDF for the board pack.'), '<button class="btn primary" data-act="print">' + Z.icon('file-pdf') + ' ' + t('Print / save as PDF') + '</button>') +
        '<article class="report zk-board"><div class="cover"><div><p style="margin:0;color:#555">' + t('Tax risk report for the board') + '</p><h1>' + esc(Z.orgName()) + '</h1><p style="margin:6px 0 0">' + t('As of') + ' ' + Z.ltr(today) + ', ' + ents.length + ' ' + t('companies') + '</p></div></div>' +
        '<div class="kpis">' + kpi('shield-warning', fmt(risk), t('Tax at risk (SAR)'), risk ? 'bad' : '') + kpi('gavel', fmt(tot('stake')), t('At stake in open cases (SAR)')) + kpi('hand-coins', fmt(tot('refund') + tot('rec')), t('Owed back to the companies (SAR)'), 'good') + kpi('cpu', tot('egs'), t('Expired e-invoicing devices'), tot('egs') ? 'bad' : '') + '</div>' +
        '<h2>' + t('Where the risk is') + '</h2><div class="hbars">' + bars.map(function (b, i) { return '<div class="hb" style="--i:' + i + '"><span>' + esc(t(b[0])) + '</span><div class="track"><i style="--w:' + Math.max(1, b[1] / max * 100).toFixed(1) + '%"></i></div><b class="num">' + fmt(b[1]) + '</b></div>'; }).join('') + '</div>' +
        '<h2>' + t('By company') + '</h2><div class="tbl-wrap"><table class="t"><thead><tr><th>' + t('Company') + '</th><th>' + t('Latest period') + '</th><th>' + t('Readiness') + '</th><th class="num">' + t('Exposure (SAR)') + '</th><th class="num">' + t('ZATCA statement') + '</th><th class="num">' + t('VAT adjustments') + '</th><th class="num">' + t('Income tax') + '</th><th class="num">' + t('Open disputes') + '</th><th class="num">' + t('Refunds outstanding') + '</th></tr></thead><tbody>' +
        rows.map(function (x) { return '<tr><td><a href="#/' + S.tax + '/insights/' + x.e.id + '">' + esc(Z.entName(x.e)) + '</a></td><td>' + Z.ltr(x.period || '-') + '</td><td>' + (x.score != null ? Z.pill(x.grade, x.score + '%') : '-') + '</td><td class="num">' + fmt(x.expo) + '</td><td class="num">' + fmt(x.soa) + '</td><td class="num">' + fmt(x.adj) + '</td><td class="num">' + fmt(x.cit) + '</td><td class="num">' + fmt(x.stake) + '</td><td class="num">' + fmt(x.refund) + '</td></tr>'; }).join('') +
        '<tr class="total"><td colspan="3">' + t('Total') + '</td><td class="num">' + fmt(tot('expo')) + '</td><td class="num">' + fmt(tot('soa')) + '</td><td class="num">' + fmt(tot('adj')) + '</td><td class="num">' + fmt(tot('cit')) + '</td><td class="num">' + fmt(tot('stake')) + '</td><td class="num">' + fmt(tot('refund')) + '</td></tr></tbody></table></div>' +
        '<p class="faint" style="font-size:12px;margin-top:14px">' + t('Estimates from the checks and the penalty rates in Settings. Not legal advice.') + '</p></article>');
    });
  };

  // ================================================================ attachments
  var TYPES = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', csv: 'text/csv', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', xls: 'application/vnd.ms-excel', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
  var MAX = 2 * 1024 * 1024;
  // a strip of files under a record: owner is "table:id"
  Z.attachHtml = function (owner, entityId) {
    if (!owner || !entityId) return '';
    setTimeout(function () { Z.paintAttach(owner); }, 0);
    return '<div class="zk-att" data-owner="' + esc(owner) + '" data-ent="' + esc(entityId) + '"><span class="faint">' + t('Loading…') + '</span></div>';
  };
  Z.paintAttach = function (owner) {
    var box = document.querySelector('.zk-att[data-owner="' + owner + '"]'); if (!box) return;
    Z.list('attachments').then(function (all) {
      box = document.querySelector('.zk-att[data-owner="' + owner + '"]'); if (!box) return;
      var mine = all.filter(function (a) { return a.owner === owner; });
      box.innerHTML = '<span class="zk-att-h">' + Z.icon('paperclip') + t('Evidence') + '</span>' + mine.map(function (a) { return '<span class="zk-file"><a href="#" data-act="attget" data-id="' + esc(a.id) + '">' + Z.icon(a.type === 'application/pdf' ? 'file-pdf' : /image/.test(a.type) ? 'image' : 'file-xls') + esc(a.name) + '</a><small>' + Math.max(1, Math.round(a.size / 1024)) + ' KB</small>' + (Z.can('preparer') ? '<button type="button" class="btn ghost small icon" data-act="attdel" data-id="' + esc(a.id) + '" data-owner="' + esc(owner) + '" aria-label="' + esc(t('Remove') + ' ' + a.name) + '">' + Z.icon('x') + '</button>' : '') + '</span>'; }).join('') +
        (Z.can('preparer') ? '<button type="button" class="btn small" data-act="attadd" data-owner="' + esc(owner) + '">' + Z.icon('upload-simple') + ' ' + t('Attach a file') + '</button>' : '') + (mine.length || Z.can('preparer') ? '' : '<span class="faint">' + t('No files') + '</span>');
    }).catch(function () { box.innerHTML = ''; });
  };
  Z.ACT.attadd = function (el) {
    var owner = el.dataset.owner, ent = (el.closest('.zk-att') || {}).dataset.ent;
    var inp = document.createElement('input'); inp.type = 'file'; inp.accept = Object.keys(TYPES).map(function (x) { return '.' + x; }).join(',');
    inp.onchange = function () {
      var file = inp.files[0]; if (!file) return;
      var ext = (file.name.split('.').pop() || '').toLowerCase(), type = TYPES[ext];
      if (!type) return Z.toast(t('Attach PDF, image, Excel, Word or CSV files.'), true);
      if (file.size > MAX) return Z.toast(t('Files up to 2 MB can be attached.'), true);
      var rd = new FileReader();
      rd.onload = function () {
        var data = String(rd.result).split(',')[1] || '', id = Z.uid('AT');
        Z.save('files', { id: id, entityId: ent, data: data }).then(function () {
          return Z.save('attachments', { id: id, entityId: ent, owner: owner, name: file.name, type: type, size: file.size, label: file.name });
        }).then(function () { Z.toast(t('File attached')); Z.paintAttach(owner); });
      };
      rd.readAsDataURL(file);
    };
    inp.click();
  };
  Z.ACT.attget = function (el) {
    Promise.all([Z.get('attachments', el.dataset.id), Z.get('files', el.dataset.id)]).then(function (r) {
      var a = r[0], f = r[1]; if (!a || !f) return Z.toast(t('This file is no longer available.'), true);
      var bin = atob(f.data), u8 = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      // always a download, never shown inline: the type comes from the allow-list
      var type = Object.keys(TYPES).map(function (k) { return TYPES[k]; }).indexOf(a.type) >= 0 ? a.type : 'application/octet-stream';
      var url = URL.createObjectURL(new Blob([u8], { type: type })), link = document.createElement('a');
      link.href = url; link.download = String(a.name || 'file').replace(/[\\/:*?"<>|]/g, '_'); document.body.appendChild(link); link.click();
      setTimeout(function () { URL.revokeObjectURL(url); link.remove(); }, 500);
    });
  };
  Z.ACT.attdel = function (el) { if (!confirm(t('Remove this file?'))) return; Z.call('remove', { table: 'attachments', id: el.dataset.id }).then(function () { Z.paintAttach(el.dataset.owner); }); };
})();
