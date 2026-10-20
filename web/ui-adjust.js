/* VAT adjustments: capital assets, bad debts, advance payments, foreign-currency
   invoices and related-party supplies, kept per entity in one `registers` doc.
   The engine (E.adjustments) works out what each register means for the return;
   this file shows it and edits the registers. */
(function () {
  'use strict';
  var E = window.ZEngine, S = Z.S, t = Z.t, esc = Z.esc, fmt = Z.fmt, D = Z.DRILL;
  var cfg = function () { return S.settingsDoc ? S.settingsDoc.values : {}; };
  var ar = function () { return S.lang === 'ar'; };
  var YN = [['yes', 'Yes'], ['no', 'No']];
  // field: [key, label, type, options|attrs]
  var REG = {
    capital: { title: 'Capital assets', icon: 'buildings', check: 'AJ1', fields: [['name', 'Asset', 'text', 'required'], ['kind', 'Type', 'select', [['immovable', 'Building or land improvement (10 years)'], ['movable', 'Other asset (6 years)']]],
      ['acquiredOn', 'Acquired on', 'date', 'required'], ['cost', 'Cost excl. VAT (SAR)', 'number'], ['inputVat', 'Input VAT deducted (SAR)', 'number', 'required'], ['usefulYears', 'Useful life (years)', 'number'], ['initialPct', 'Taxable use in the first year (%)', 'number']] },
    baddebts: { title: 'Bad debts', icon: 'receipt-x', check: 'AJ2', fields: [['customer', 'Customer', 'text', 'required'], ['invoice', 'Invoice', 'text'], ['invoiceDate', 'Invoice date', 'date', 'required'], ['amount', 'Amount incl. VAT (SAR)', 'number'],
      ['vat', 'VAT on the invoice (SAR)', 'number', 'required'], ['writtenOffOn', 'Written off in the books on', 'date'], ['notified', 'Customer notified', 'select', YN], ['claimedPeriod', 'Relief claimed in return', 'text', 'placeholder="2026-09"'], ['recovered', 'Recovered later (SAR)', 'number']] },
    advances: { title: 'Advance payments', icon: 'hand-deposit', check: 'AJ3', fields: [['customer', 'Customer', 'text', 'required'], ['reference', 'Reference', 'text'], ['receivedOn', 'Received on', 'date', 'required'], ['amount', 'Amount received incl. VAT (SAR)', 'number', 'required'],
      ['refundable', 'Refundable security deposit', 'select', [['no', 'No, it pays for the supply'], ['yes', 'Yes, refundable deposit']]], ['declaredPeriod', 'Declared in return', 'text', 'placeholder="2026-09"'], ['invoiceOn', 'Tax invoice issued on', 'date']] },
    fx: { title: 'Foreign-currency invoices', icon: 'currency-circle-dollar', check: 'AJ4', fields: [['invoice', 'Invoice', 'text', 'required'], ['party', 'Customer or supplier', 'text'], ['date', 'Date the tax is due', 'date'], ['currency', 'Currency', 'text', 'required placeholder="EUR"'],
      ['amount', 'Amount excl. VAT (currency)', 'number', 'required'], ['rateUsed', 'Rate used in the books', 'number', 'required step="0.0001"'], ['samaRate', 'SAMA rate that day', 'number', 'step="0.0001"']] },
    related: { title: 'Related-party supplies', icon: 'users-four', check: 'AJ5', fields: [['party', 'Related party', 'text', 'required'], ['relation', 'Relationship', 'text'], ['description', 'What was supplied', 'text'], ['date', 'Date', 'date'],
      ['consideration', 'Price charged excl. VAT (SAR)', 'number', 'required'], ['marketValue', 'Market value excl. VAT (SAR)', 'number', 'required'], ['buyerFullRecovery', 'Buyer recovers all its input VAT', 'select', YN]] }
  };
  var BOOL = { notified: 1, refundable: 1, buyerFullRecovery: 1 };
  var A = { e: null, doc: null, res: null };
  var kpi = function (icon, val, label, drill, tone) { return '<div class="' + (tone || '') + '"' + (drill ? ' data-drill="' + drill + '"' : '') + '>' + Z.icon(icon) + '<b>' + val + '</b><span>' + esc(label) + '</span></div>'; };

  Z.views.adjust = function (h) {
    var e = Z.entity(h[1]) || Z.entity(S.entityId) || S.entities[0];
    if (!e) return Z.setMain('<div class="empty"><h2>' + t('Add an entity first.') + '</h2></div>');
    return Z.get('registers', e.id + '_reg').then(function (doc) {
      A.e = e; A.doc = doc || { id: e.id + '_reg', entityId: e.id, label: 'VAT adjustments' };
      E.ADJ_REGS.forEach(function (k) { A.doc[k] = Array.isArray(A.doc[k]) ? A.doc[k] : []; });
      render();
    });
  };
  function render() {
    var e = A.e, res = A.res = E.adjustments(A.doc, cfg(), Z.today()), can = Z.can('preparer');
    var items = E.ADJ_REGS.reduce(function (s, k) { return s + A.doc[k].length; }, 0);
    var right = S.entities.length > 1 ? '<label class="f inline"><span class="sr-only">' + t('Entity') + '</span><select data-chg="adjent" aria-label="' + esc(t('Entity')) + '">' + S.entities.map(function (x) { return '<option value="' + x.id + '"' + (x.id === e.id ? ' selected' : '') + '>' + esc(Z.entName(x)) + '</option>'; }).join('') + '</select></label>' : '';
    var max = Math.max.apply(null, res.checks.map(function (c) { return Math.max(c.exposure || 0, c.recover || 0); }).concat([1]));
    var chart = '<section class="paper"><header><div><h2>' + t('What the registers change in your VAT') + '</h2><p>' + t('Tax to pay grows to the right, tax to reclaim to the left. Each bar opens its register.') + '</p></div></header><div class="zk-div" role="list">' +
      res.checks.map(function (c, i) {
        return '<a class="zk-div-row" role="listitem" href="#reg-' + REG[E.ADJ_REGS[i]].check + '" data-act="adjjump" data-k="' + E.ADJ_REGS[i] + '" style="--i:' + i + '"><span class="zk-div-l">' + Z.tick(c.status) + esc(t(REG[E.ADJ_REGS[i]].title)) + '</span>' +
          '<span class="zk-div-rec"><i style="--w:' + ((c.recover || 0) / max * 100).toFixed(1) + '%"></i>' + (c.recover ? '<b class="num">' + fmt(c.recover) + '</b>' : '') + '</span><span class="zk-div-axis" aria-hidden="true"></span>' +
          '<span class="zk-div-pay"><i style="--w:' + ((c.exposure || 0) / max * 100).toFixed(1) + '%"></i>' + (c.exposure ? '<b class="num">' + fmt(c.exposure) + '</b>' : '') + '</span></a>';
      }).join('') + '<p class="zk-legend"><span><i class="k-rec"></i>' + t('To reclaim') + '</span><span><i class="k-pen"></i>' + t('To pay') + '</span></p></div></section>';
    var sections = E.ADJ_REGS.map(function (k, i) { return section(k, res.checks[i], res[k], can); }).join('');
    Z.setMain('<div class="pagehead"><div><p class="eyebrow">' + Z.icon('sliders-horizontal') + ' ' + t('VAT') + '</p><h1>' + t('VAT adjustments') + ': ' + esc(Z.entName(e)) + '</h1><p>' + t('The adjustments an inspector looks for outside the monthly ledger: capital assets, bad debts, advance payments, foreign currency and related parties.') + '</p></div>' + (right ? '<div class="row">' + right + '</div>' : '') + '</div>' +
      '<div class="stack"><div class="kpis">' + kpi('arrow-fat-line-up', fmt(res.exposure), t('VAT to pay (SAR)'), 'adj:due', res.exposure ? 'bad' : '') + kpi('arrow-u-up-left', fmt(res.recover), t('VAT to reclaim (SAR)'), 'adj:rec', res.recover ? 'good' : '') +
      kpi('warning-circle', res.issues, t('Registers with issues'), 'adj:issues', res.issues ? 'bad' : '') + kpi('list-bullets', items, t('Items in the registers'), 'adj:items') + '</div>' +
      '<p class="muted zk-src">' + Z.icon('info') + t('Capital assets follow VAT IR Art. 52 (10 years for buildings, 6 for other assets). The bad-debt conditions, the 15-day invoice rule for advances and the related-party rule come from adviser summaries: verify for your case; they are editable in Settings.') + '</p>' +
      chart + sections + '</div>');
  }
  function section(k, c, list, can) {
    var R = REG[k], rows = list.map(function (x, i) { return rowHtml(k, x.item, x.s, i, can); }).join('');
    var head = colHead(k);
    return '<section class="paper flush zk-reg" id="reg-' + R.check + '"><div class="zk-reg-h"><div class="check">' + Z.tick(c.status) + '<div><h3>' + esc(c.id) + ' · ' + esc(ar() ? c.titleAr : c.title) + '</h3><div class="figs">' +
      (c.status === 'na' ? '<span>' + t('No items yet') + '</span>' : '<span>' + t('Items') + ': <b>' + Z.count(list.length) + '</b></span>' + (c.exposure ? '<span class="d fail">' + t('To pay') + ': <b>' + fmt(c.exposure) + '</b></span>' : '') + (c.recover ? '<span class="d pass">' + t('To reclaim') + ': <b>' + fmt(c.recover) + '</b></span>' : '')) +
      '</div><p class="faint" style="font-size:12.5px;margin:4px 0 0">' + esc(ar() ? c.noteAr : c.note) + '</p></div><div class="acts">' + (can ? '<button class="btn small" data-act="adjedit" data-k="' + k + '">' + Z.icon('plus') + ' ' + t('Add') + '</button>' : '') + '</div></div></div>' +
      (rows ? '<div class="tbl-wrap"><table class="t zk-tbl"><thead><tr>' + head + '</tr></thead><tbody>' + rows + '</tbody></table></div>' : '') + '</section>';
  }
  var th = function (l, num) { return '<th' + (num ? ' class="num"' : '') + '>' + esc(t(l)) + '</th>'; };
  function colHead(k) {
    return {
      capital: th('Asset') + th('Period') + th('Input VAT', 1) + th('Year by year') + th('To pay', 1) + th('To reclaim', 1),
      baddebts: th('Customer') + th('Invoice date') + th('Months overdue', 1) + th('VAT', 1) + th('Status') + th('To pay', 1) + th('To reclaim', 1),
      advances: th('Customer') + th('Received') + th('Amount', 1) + th('VAT', 1) + th('Declared in') + th('Tax invoice') + th('To pay', 1),
      fx: th('Invoice') + th('Currency') + th('Rate used', 1) + th('SAMA rate', 1) + th('SAR difference', 1) + th('VAT difference', 1),
      related: th('Related party') + th('What was supplied') + th('Price charged', 1) + th('Market value', 1) + th('Buyer recovers all VAT') + th('VAT due', 1)
    }[k];
  }
  var REASON = { overdue: 'not overdue long enough', writeoff: 'not written off', notice: 'customer not notified' };
  var AISS = { undeclared: 'Not declared', late: 'Declared late', period: 'Declared in the wrong period', noinvoice: 'No tax invoice', lateinvoice: 'Invoice late' };
  function rowHtml(k, it, s, i, can) {
    var open = can ? ' class="clickable" data-act="adjedit" data-k="' + k + '" data-i="' + i + '"' : '';
    var who = function (a, b) { return '<td><b>' + esc(a || '-') + '</b>' + (b ? '<div class="faint" style="font-size:12.5px">' + esc(b) + '</div>' : '') + '</td>'; };
    var num = function (v, cls) { return '<td class="num' + (cls ? ' ' + cls : '') + '">' + fmt(v) + '</td>'; };
    if (k === 'capital') {
      var y0 = it.acquiredOn ? +String(E.date(it.acquiredOn) || '').slice(0, 4) : null, cells = '';
      if (y0) for (var y = y0; y < y0 + s.period; y++) {
        var r = s.rows.filter(function (x) { return x.year === y; })[0], st = y === y0 ? 'base' : r ? (r.adj < 0 ? (r.declared ? 'done' : 'pay') : r.adj > 0 ? (r.declared ? 'done' : 'rec') : 'ok') : s.missing.indexOf(y) >= 0 ? 'miss' : 'future';
        cells += '<i class="zk-yr ' + st + '" title="' + esc(y + ': ' + (y === y0 ? t('first year') : r ? r.pct + '%, ' + fmt(r.adj) : s.missing.indexOf(y) >= 0 ? t('use not recorded') : t('not yet'))) + '"></i>';
      }
      return '<tr' + open + '>' + who(it.name, t(it.kind === 'immovable' ? 'Building' : 'Other asset') + ', ' + (it.acquiredOn || '')) + '<td class="nowrap">' + s.period + ' ' + t('years') + (s.endYear ? ', ' + t('to') + ' ' + s.endYear : '') + '</td>' + num(it.inputVat) + '<td><span class="zk-yrs">' + cells + '</span></td>' + num(s.due, s.due ? 'diff-bad' : '') + num(s.recover) + '</tr>';
    }
    if (k === 'baddebts') return '<tr' + open + '>' + who(it.customer, it.invoice) + '<td class="nowrap">' + Z.ltr(it.invoiceDate || '') + '</td><td class="num">' + Z.count(s.months) + '</td>' + num(it.vat) +
      '<td>' + (s.eligible ? Z.pill('pass', t('Qualifies')) : Z.pill('warn', t('Does not qualify yet'))) + (s.reasons.length ? '<div class="faint" style="font-size:12px">' + s.reasons.map(function (x) { return esc(t(REASON[x])); }).join(', ') + '</div>' : '') + (s.claimed ? '<div class="faint" style="font-size:12px">' + t('Claimed in') + ' ' + esc(it.claimedPeriod) + '</div>' : '') + '</td>' + num(s.due, s.due ? 'diff-bad' : '') + num(s.recover) + '</tr>';
    if (k === 'advances') return '<tr' + open + '>' + who(it.customer, it.reference) + '<td class="nowrap">' + Z.ltr(it.receivedOn || '') + '</td>' + num(it.amount) + num(s.vat) + '<td>' + Z.ltr(it.declaredPeriod || '-') + '</td><td>' + Z.ltr(it.invoiceOn || '-') +
      (s.issues.length ? '<div>' + s.issues.map(function (x) { return Z.pill('fail', t(AISS[x])); }).join(' ') + '</div>' : '') + '</td>' + num(s.due, s.due ? 'diff-bad' : '') + '</tr>';
    if (k === 'fx') return '<tr' + open + '>' + who(it.invoice, it.party) + '<td>' + esc(String(it.currency || '').toUpperCase()) + ' ' + fmt(it.amount) + '</td><td class="num">' + fmt(it.rateUsed, 4) + '</td><td class="num">' + fmt(s.sama, 4) + '</td>' + num(s.diffSar) + num(s.vatDiff, s.status === 'fail' ? 'diff-bad' : '') + '</tr>';
    return '<tr' + open + '>' + who(it.party, it.relation) + '<td>' + esc(it.description || '') + '</td>' + num(it.consideration) + num(it.marketValue) + '<td>' + (it.buyerFullRecovery === true ? t('Yes') : t('No')) + '</td>' + num(s.due, s.due ? 'diff-bad' : '') + '</tr>';
  }
  function save(msg) { return Z.save('registers', A.doc).then(function (d) { A.doc = d; E.ADJ_REGS.forEach(function (k) { A.doc[k] = Array.isArray(A.doc[k]) ? A.doc[k] : []; }); render(); if (msg) Z.toast(msg); }); }
  Z.CHG.adjent = function (el) { location.hash = '#/' + S.tax + '/adjust/' + el.value; };
  Z.ACT.adjjump = function (el) { if (Z.closeDrawer) Z.closeDrawer(true); var x = document.getElementById('reg-' + REG[el.dataset.k].check); if (x) { x.scrollIntoView({ behavior: 'smooth', block: 'start' }); x.classList.add('flash'); setTimeout(function () { x.classList.remove('flash'); }, 1600); } };
  Z.ACT.adjedit = function (el) {
    if (Z.closeDrawer) Z.closeDrawer(true);
    var k = el.dataset.k, i = el.dataset.i == null ? -1 : +el.dataset.i, R = REG[k], it = i >= 0 ? A.doc[k][i] : {};
    A.edit = { k: k, i: i };
    var f = R.fields.map(function (fd) {
      var v = it[fd[0]]; if (BOOL[fd[0]]) v = v === true ? 'yes' : v === false ? 'no' : v;
      if (fd[2] === 'select') return '<label class="f"><span>' + esc(t(fd[1])) + '</span><select name="' + fd[0] + '">' + fd[3].map(function (o) { return '<option value="' + o[0] + '"' + (String(v == null ? '' : v) === o[0] ? ' selected' : '') + '>' + esc(t(o[1])) + '</option>'; }).join('') + '</select></label>';
      return Z.fld(fd[0], t(fd[1]), v, fd[2], (fd[3] || '') + (fd[2] === 'number' && !/step=/.test(fd[3] || '') ? ' step="0.01"' : ''));
    }).join('');
    var uses = '';
    if (k === 'capital' && i >= 0) {
      var s = E.capitalAdjust(it, cfg(), Z.today()), y0 = +String(E.date(it.acquiredOn) || '').slice(0, 4), last = Math.min(y0 + s.period - 1, +Z.today().slice(0, 4) - 1), byY = {};
      (it.uses || []).forEach(function (u) { if (u) byY[u.year] = u; });
      for (var y = y0 + 1; y0 && y <= last; y++) uses += '<tr><td>' + y + '</td><td><input type="number" step="0.01" min="0" max="100" name="use-' + y + '" value="' + esc(byY[y] && byY[y].pct != null ? byY[y].pct : '') + '" aria-label="' + esc(t('Taxable use') + ' ' + y) + '"></td><td><label class="zk-cbx"><input type="checkbox" name="dec-' + y + '"' + (byY[y] && byY[y].declared ? ' checked' : '') + '> ' + t('Adjusted in a return') + '</label></td></tr>';
      uses = uses ? '<h3 style="grid-column:1/-1;margin:8px 0 0">' + t('Taxable use by year (%)') + '</h3><table class="t" style="grid-column:1/-1"><tbody>' + uses + '</tbody></table>' : '';
    }
    Z.modal((i >= 0 ? t('Edit') : t('Add')) + ': ' + t(R.title), '<form id="adjf" class="grid g2">' + f + uses + '</form>',
      (i >= 0 ? '<button class="btn danger" data-act="adjdel">' + t('Delete') + '</button>' : '') + '<button class="btn" data-act="closemodal">' + t('Cancel') + '</button><button class="btn primary" data-act="adjsave">' + t('Save') + '</button>');
  };
  Z.ACT.adjsave = function () {
    var f = document.getElementById('adjf'); if (!f.reportValidity()) return;
    var k = A.edit.k, i = A.edit.i, prev = i >= 0 ? A.doc[k][i] : {}, d = Object.assign({}, prev), fd = new FormData(f);
    REG[k].fields.forEach(function (x) { var v = fd.get(x[0]); if (v == null) return; d[x[0]] = BOOL[x[0]] ? v === 'yes' : x[2] === 'number' ? (v === '' ? null : +v) : v.trim(); });
    if (k === 'capital') {
      var uses = []; fd.forEach(function (v, key) { var m = /^use-(\d{4})$/.exec(key); if (m && v !== '') uses.push({ year: +m[1], pct: +v, declared: fd.get('dec-' + m[1]) === 'on' }); });
      var keep = (prev.uses || []).filter(function (u) { return u && !fd.has('use-' + u.year); });
      if (i >= 0) d.uses = keep.concat(uses).sort(function (a, b) { return a.year - b.year; }); else d.uses = [];
    }
    if (i >= 0) A.doc[k][i] = d; else A.doc[k].push(d);
    Z.closeModal(); save(t('Saved'));
  };
  Z.ACT.adjdel = function () { if (!confirm(t('Delete this record?'))) return; A.doc[A.edit.k].splice(A.edit.i, 1); Z.closeModal(); save(t('Deleted')); };
  D.adj = function (k) {
    var res = A.res; if (!res) return null;
    var lines = [];
    E.ADJ_REGS.forEach(function (rk) { res[rk].forEach(function (x, i) {
      var label = x.item.name || x.item.customer || x.item.invoice || x.item.party || '-';
      lines.push({ label: label, sub: t(REG[rk].title), due: x.s.due || 0, rec: x.s.recover || 0, act: 'adjedit', data: { k: rk, i: i }, bad: rk === 'capital' ? x.s.missing.length || x.s.due : rk === 'advances' ? x.s.issues.length : x.s.due });
    }); });
    if (k === 'due') return { title: t('VAT to pay (SAR)'), total: res.exposure, totalLabel: 'SAR', rows: lines.filter(function (l) { return l.due; }).map(function (l) { return { label: l.label, sub: l.sub, value: l.due, tone: 'fail', act: l.act, data: l.data }; }).sort(function (a, b) { return b.value - a.value; }), empty: t('Nothing to pay.') };
    if (k === 'rec') return { title: t('VAT to reclaim (SAR)'), total: res.recover, totalLabel: 'SAR', rows: lines.filter(function (l) { return l.rec; }).map(function (l) { return { label: l.label, sub: l.sub, value: l.rec, tone: 'pass', act: l.act, data: l.data }; }), empty: t('Nothing to reclaim.') };
    if (k === 'items') return { title: t('Items in the registers'), money: false, total: E.ADJ_REGS.reduce(function (s, rk) { return s + A.doc[rk].length; }, 0), totalLabel: t('items'), rows: E.ADJ_REGS.map(function (rk) { return { label: t(REG[rk].title), value: A.doc[rk].length, act: 'adjjump', data: { k: rk } }; }) };
    if (k === 'issues') return { title: t('Registers with issues'), money: false, total: res.issues, totalLabel: t('registers'), rows: res.checks.filter(function (c) { return c.status === 'fail' || c.status === 'warn'; }).map(function (c, i) { return { label: c.id + ' ' + (ar() ? c.titleAr : c.title), value: c.exposure || 0, display: c.exposure ? fmt(c.exposure) : t('Review'), tone: c.status === 'fail' ? 'fail' : 'warn', act: 'adjjump', data: { k: E.ADJ_REGS[['AJ1','AJ2','AJ3','AJ4','AJ5'].indexOf(c.id)] } }; }), empty: t('No issues.') };
    return null;
  };
})();
