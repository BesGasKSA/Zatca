/* The inspection exercise workspace: loading, the readiness overview, data
   uploads with column mapping, and the VAT, bank, WHT and analytics tabs. */
(function () {
  'use strict';
  var E = window.ZEngine, S = Z.S, t = Z.t, esc = Z.esc, fmt = Z.fmt;

  // ---------------------------------------------------------------- loading
  // one implementation, shared with the data-cycle test (tests/backend.test.js)
  var pack = E.packRows, unpack = E.unpackRows;
  Z.pack = pack;

  Z.loadExercise = function (id) {
    if (S.exId === id && S.ex && S.loaded) return Promise.resolve();
    S.loaded = false;
    return Z.get('exercises', id).then(function (ex) {
      if (!ex) throw Object.assign(new Error(t('Exercise not found')), { notFound: true });
      S.ex = ex; S.exId = id;
      ex.reconItems = ex.reconItems || []; ex.checkNotes = ex.checkNotes || {}; ex.bankOverrides = ex.bankOverrides || {};
      return Promise.all([Z.list('datasets', id), Z.list('samples', id), Z.list('findings', id), Z.get('checklists', id)]);
    }).then(function (r) {
      S.datasets = r[0].sort(function (a, b) { return a.uploadedAt < b.uploadedAt ? -1 : 1; });
      S.samples = r[1]; S.findings = r[2];
      S.checklist = r[3] || { id: id, parentId: id, items: [] };
      return Promise.all(S.datasets.map(function (d) { return Z.get('rows', d.id); }));
    }).then(function (rows) {
      S.data = {};
      S.datasets.forEach(function (d, i) {
        unpack(rows[i]).forEach(function (x) { x._f = d.id; x._k = d.id + ':' + x._r; (S.data[d.kind] = S.data[d.kind] || []).push(x); });
      });
      S.loaded = true;
      Z.recompute();
    });
  };

  Z.ctx = function () {
    var ent = Z.entity(S.ex.entityId) || {};
    var prev = S.exercises.filter(function (x) { return x.entityId === S.ex.entityId && x.period === E.prevPeriod(S.ex.period); })[0];
    var prevWht = S.exercises.filter(function (x) { return x.entityId === S.ex.entityId && x.period === E.prevPeriod(E.periodOf(E.periodRange(S.ex.period).end, 'monthly')); })[0];
    var pn = S.ex.prevNetVat != null && S.ex.prevNetVat !== '' ? +S.ex.prevNetVat : prev && prev.summary ? prev.summary.netVat : null;
    var pw = S.ex.prevWhtTax != null && S.ex.prevWhtTax !== '' ? +S.ex.prevWhtTax : prevWht && prevWht.summary ? prevWht.summary.whtTax : null;
    return {
      entity: ent, periodKey: S.ex.period, settings: S.settingsDoc ? S.settingsDoc.values : {}, data: S.data,
      returnBoxes: S.ex.returnBoxes, reconItems: S.ex.reconItems, bankOverrides: S.ex.bankOverrides,
      prevNetVat: pn, prevWhtTax: pw, samples: S.samples, checklist: S.checklist.items, findings: S.findings,
      filing: S.ex.filing || {}, recovery: S.ex.recovery || {}, today: Z.today(), exciseReturn: S.ex.exciseReturn, mktException: S.ex.mktException || {},
      // the same entity's earlier periods, newest first, for the risk-engine trends
      priorPurchaseKeys: (function () { var o = {}; S.exercises.forEach(function (x) { if (x.entityId === S.ex.entityId && x.period < S.ex.period && x.pkeys) x.pkeys.forEach(function (k) { o[k] = x.period; }); }); return o; })(),
      prevNetVatBox16: prev && prev.summary && prev.summary.netVat != null ? prev.summary.netVat : null, prevRefunded: !!(prev && prev.refundClaimed),
      history: S.exercises.filter(function (x) { return x.entityId === S.ex.entityId && x.period < S.ex.period && x.summary; })
        .sort(function (a, b) { return a.period < b.period ? 1 : -1; }).map(function (x) { return Object.assign({ period: x.period }, x.summary); })
    };
  };

  Z.recompute = function () {
    S.R = E.runAll(Z.ctx());
    S.R.samples = S.samples.map(function (s) { var ev = E.evaluateSample(s, s.confidence); s.eval = ev; return s; });
  };

  // Saves the exercise's headline figures so the dashboard and trends need no recomputation.
  Z.saveSummary = function () {
    var R = S.R, ret = R.vat.boxes.ret || R.vat.boxes.sys;
    var all = R.vat.checks.concat(R.wht.checks, R.bank.checks, R.einv.checks, R.filing.checks, R.other.checks), fg = R.figures || {};
    var sm = {
      score: R.score.score, grade: R.score.grade, exposure: R.exposure,
      fails: all.filter(function (c) { return c.status === 'fail'; }).length, warns: all.filter(function (c) { return c.status === 'warn'; }).length,
      netVat: ret ? ret[16].vat : null, sales: ret ? ret[6].amount : null, purchases: ret ? ret[12].amount : null,
      whtTax: (S.data.ret_wht || []).reduce(function (a, x) { return a + (+x.tax || 0); }, 0) || null,
      whtGross: (S.data.ret_wht || []).reduce(function (a, x) { return a + (+x.amount || 0); }, 0) || null,
      outputVat: fg.outputVat == null ? null : fg.outputVat, inputVat: fg.inputVat == null ? null : fg.inputVat, zeroShare: fg.zeroShare == null ? null : fg.zeroShare,
      vatLateDays: ((R.filing.checks.filter(function (c) { return c.id === 'C1'; })[0] || {}).a) || 0,
      whtLateDays: ((R.filing.checks.filter(function (c) { return c.id === 'C3'; })[0] || {}).a) || 0,
      openFindings: S.findings.filter(function (f) { return f.status !== 'closed'; }).length
    };
    var nFail = function (l) { return l.filter(function (c) { return c.status === 'fail'; }).length; };
    var vf = R.filing.checks.filter(function (c) { return c.id !== 'C3'; }), wf = R.filing.checks.filter(function (c) { return c.id === 'C3'; });
    sm.vatScore = R.vatScore ? R.vatScore.score : null; sm.vatGrade = R.vatScore ? R.vatScore.grade : null; sm.vatExposure = R.vatExposure || 0;
    sm.vatFails = nFail(R.vat.checks.concat(R.bank.checks, R.einv.checks, vf, R.other.checks));
    sm.whtScore = R.whtScore ? R.whtScore.score : null; sm.whtGrade = R.whtScore ? R.whtScore.grade : null; sm.whtExposure = R.whtExposure || 0;
    sm.whtFails = R.whtScore ? nFail(R.wht.checks.concat(wf)) : 0;
    var pk = E.purchaseKeys(S.data.sys_vat || []);
    if ((JSON.stringify(sm) === JSON.stringify(S.ex.summary || {}) && JSON.stringify(pk) === JSON.stringify(S.ex.pkeys || [])) || S.ex.status === 'closed') return Promise.resolve();
    S.ex.summary = sm; S.ex.pkeys = pk;
    return Z.saveEx();
  };
  Z.saveEx = function () {
    return Z.save('exercises', S.ex).then(function (d) {
      S.ex = Object.assign(S.ex, d);
      var i = S.exercises.findIndex(function (x) { return x.id === d.id; });
      if (i >= 0) S.exercises[i] = S.ex; else S.exercises.push(S.ex);
    });
  };
  Z.changed = function () { Z.recompute(); Z.saveSummary(); Z.route(); };

  // ---------------------------------------------------------------- exercise view
  var VAT_TABS = [['overview', 'Overview'], ['plan', 'Action plan'], ['data', 'Data'], ['filing', 'Filing & payment'], ['vat', 'VAT reconciliation'], ['einv', 'E-invoicing'], ['bank', 'Bank'], ['other', 'Other taxes'], ['analytics', 'Analytics'], ['sampling', 'Sampling'], ['checklist', 'Documents'], ['findings', 'Findings'], ['report', 'Report & sign-off']];
  var WHT_TABS = [['overview', 'Overview'], ['plan', 'Action plan'], ['data', 'Data'], ['filing', 'Filing & payment'], ['wht', 'WHT reconciliation'], ['sampling', 'Sampling'], ['checklist', 'Documents'], ['findings', 'Findings'], ['report', 'Report & sign-off']];
  // the readiness of the section on screen
  Z.secScore = function () { var R = S.R; return (Z.isWht() ? R.whtScore : R.vatScore) || R.score; };
  Z.secExposure = function () { return Z.isWht() ? S.R.whtExposure || 0 : S.R.vatExposure || 0; };

  Z.views.ex = function (h) {
    return Z.loadExercise(h[1]).then(function () {
      var tab = h[2] || 'overview', ex = S.ex, ent = Z.entity(ex.entityId) || {}, R = S.R, wht = Z.isWht(), TABS = wht ? WHT_TABS : VAT_TABS;
      if (!TABS.some(function (x) { return x[0] === tab; })) tab = 'overview';
      if (S.entityId !== ex.entityId) { S.entityId = ex.entityId; localStorage.setItem('zr_entity', ex.entityId); }
      Z.paintChrome('ex');
      var count = function (list) { return list.filter(function (c) { return c.status === 'fail'; }).length; };
      var isW = function (f) { return f.tax === 'WHT'; };
      var badges = { vat: count(R.vat.checks), bank: count(R.bank.checks), einv: count(R.einv.checks), filing: count(R.filing.checks.filter(function (c) { return (c.id === 'C3') === wht; })), other: count(R.other.checks), wht: ent.whtRegistered === false ? 0 : count(R.wht.checks), analytics: R.analytics.tests.filter(function (x) { return x.status === 'fail'; }).length, findings: S.findings.filter(function (f) { return f.status !== 'closed' && isW(f) === wht; }).length, plan: Z.planFor ? Z.planFor().critical : 0 };
      var sc = Z.secScore();
      if (wht && ent.whtRegistered === false) {
        Z.setMain('<div class="pagehead"><div><p class="eyebrow">' + Z.taxName() + '</p><h1>' + esc(Z.entName(ent)) + ' · ' + Z.ltr(ex.period) + '</h1></div></div><section class="paper empty"><i class="ph ph-info big" aria-hidden="true"></i><h2>' + t('This entity is not registered for withholding tax') + '</h2><p>' + t('Turn it on in the entity settings if it pays non-residents.') + '</p><a class="btn primary" href="#/vat/ex/' + ex.id + '/overview">' + t('Open the VAT exercise') + '</a></section>');
        return;
      }
      var tabs = '<nav class="tabs" aria-label="' + t('Exercise sections') + '">' + TABS.map(function (x) {
        return '<a href="#/ex/' + ex.id + '/' + x[0] + '"' + (tab === x[0] ? ' aria-current="page"' : '') + '>' + t(x[1]) + (badges[x[0]] ? '<span class="count">' + badges[x[0]] + '</span>' : '') + '</a>';
      }).join('') + '</nav>';
      var head = '<div class="pagehead"><div><p class="muted" style="margin:0"><a href="#/entity/' + ent.id + '">' + esc(Z.entName(ent)) + '</a> · ' + t('TRN') + ' ' + esc(ent.trn || '-') + '</p><p class="eyebrow">' + Z.taxName() + '</p><h1>' + (wht ? t('WHT inspection') : t('VAT inspection')) + ' ' + Z.ltr(ex.period) + '</h1>' +
        '<p>' + Z.statusPill(ex.status) + ' ' + (ex.signedOffBy ? t('Signed off by') + ' ' + esc(ex.signedOffBy) + ' ' + esc(String(ex.signedOffAt).slice(0, 10)) : t('Period') + ' ' + Z.ltr(E.periodRange(ex.period).start + ' → ' + E.periodRange(ex.period).end)) + '</p></div>' +
        Z.seal(sc.score, sc.grade, true) + '</div>';
      Z.setMain(head + tabs + '<div id="tab"></div>');
      var html = (wht && Z.tabsW[tab] || Z.tabs[tab] || Z.tabs.overview)();
      document.getElementById('tab').innerHTML = html;
      Z.scrollables(); if (Z.revealPage) Z.revealPage(); if (Z.animateCounts) Z.animateCounts();
      if (Z.after[tab]) Z.after[tab]();
      Z.saveSummary();
    });
  };
  Z.tabs = {}; Z.tabsW = {}; Z.after = {};
  var locked = function () { return S.ex.status === 'closed' || !Z.can('preparer'); };
  Z.locked = locked;

  // ---------------------------------------------------------------- overview
  Z.tabs.overview = function () {
    var R = S.R, sc = R.vatScore || R.score, ent = Z.entity(S.ex.entityId) || {};
    var parts = Object.keys(S.settings.weights).map(function (k) {
      var v = sc.parts[k]; if (v == null) return '';
      return '<div class="p"><span>' + t(Z.partName(k)) + '</span><div class="bar ' + (v >= 0.85 ? '' : v >= 0.5 ? 'warn' : 'fail') + '"><i style="width:' + Math.round(v * 100) + '%"></i></div><b class="num">' + Math.round(v * 100) + '%</b></div>';
    }).join('');
    var checks = R.filing.checks.filter(function (c) { return c.id !== 'C3'; }).concat(R.vat.checks, R.einv.checks, R.bank.checks, R.other.checks);
    var attention = checks.filter(function (c) { return c.status === 'fail' || c.status === 'warn'; }).sort(function (a, b) { return (a.status === 'fail' ? 0 : 1) - (b.status === 'fail' ? 0 : 1) || Math.abs(b.diff || 0) - Math.abs(a.diff || 0); });
    var tabOf = function (c) { return { vat: 'vat', bank: 'bank', einv: 'einv', filing: 'filing', other: 'other' }[c.group] || 'other'; };
    var missing = Object.keys(E.KINDS).filter(function (k) { return E.KINDS[k].required && E.KINDS[k].group !== 'wht' && !(S.data[k] || []).length; });
    if (!S.ex.returnBoxes) missing.unshift('return');
    var ret = R.vat.boxes.ret, sys = R.vat.boxes.sys, xls = R.vat.boxes.xls;
    var bankIn = (R.bank.summary || {}).customer_receipt, fz = R.einv.summary;
    var fzCol = function (v) { return fz ? '<td class="num">' + fmt(v) + '</td>' : ''; };
    var four = '<table class="t"><thead><tr><th></th><th class="num">' + t('Return') + '</th><th class="num">' + t('System report') + '</th><th class="num">' + t('Excel workings') + '</th><th class="num">' + t('General ledger') + '</th><th class="num">' + t('Bank') + '</th>' + (fz ? '<th class="num" title="' + esc(t('Accepted e-invoices for the period, net of credit notes')) + '">' + t('Fatoora') + '</th>' : '') + '</tr></thead><tbody>' +
      '<tr><td>' + t('Total sales (box 6)') + '</td><td class="num">' + fmt(ret && ret[6].amount + ret[6].adj) + '</td><td class="num">' + fmt(sys && sys[6].amount) + '</td><td class="num">' + fmt(xls && xls[6].amount + xls[6].adj) + '</td><td class="num">' + fmt(R.vat.ledger.revenue) + '</td><td class="num" title="' + esc(t('Customer receipts incl. VAT')) + '">' + fmt(bankIn) + '</td>' + fzCol(fz && fz.fatNet) + '</tr>' +
      '<tr><td>' + t('Output VAT') + '</td><td class="num">' + fmt(ret && ret[6].vat + ret[9].vat) + '</td><td class="num">' + fmt(sys && sys[6].vat + sys[9].vat) + '</td><td class="num">' + fmt(xls && xls[6].vat + xls[9].vat) + '</td><td class="num">' + fmt(R.vat.ledger.output ? -R.vat.ledger.output.v : null) + '</td><td></td>' + fzCol(fz && fz.fatVat) + '</tr>' +
      '<tr><td>' + t('Input VAT (box 12)') + '</td><td class="num">' + fmt(ret && ret[12].vat) + '</td><td class="num">' + fmt(sys && sys[12].vat) + '</td><td class="num">' + fmt(xls && xls[12].vat) + '</td><td class="num">' + fmt(R.vat.ledger.input ? R.vat.ledger.input.v : null) + '</td><td></td>' + (fz ? '<td></td>' : '') + '</tr>' +
      '<tr class="total"><td>' + t('Net VAT due') + '</td><td class="num">' + fmt(ret && ret[16].vat) + '</td><td class="num">' + fmt(sys && sys[13].vat) + '</td><td class="num">' + fmt(xls && xls[13].vat) + '</td><td></td><td class="num">' + fmt(-((R.bank.summary || {}).zatca_vat || 0) || null) + '</td>' + (fz ? '<td></td>' : '') + '</tr></tbody></table>';
    return '<div class="grid g2" style="align-items:start"><section class="paper"><header><div><h2>' + t('Readiness') + '</h2><p>' + t('Weighted from every check, sample, document and open finding in this exercise.') + '</p></div></header>' +
      '<div class="row ready-row">' + Z.seal(sc.score, sc.grade) + '<div class="parts" style="flex:1">' + parts + '</div></div>' +
      '<div class="kpis" style="margin-top:18px"><div class="' + (R.vatExposure ? 'bad' : '') + '"><b>' + fmt(R.vatExposure || 0) + '</b><span>' + t('VAT exposure (SAR)') + '</span></div><div><b>' + checks.filter(function (c) { return c.status === 'fail'; }).length + ' / ' + checks.length + '</b><span>' + t('Checks failed') + '</span></div><div><b>' + S.samples.filter(function (x) { return x.flow !== 'W'; }).length + '</b><span>' + t('Samples') + '</span></div></div></section>' +
      '<section class="paper"><header><div><h2>' + t('What needs attention') + '</h2><p>' + t('Failures first, largest differences first.') + '</p></div></header>' +
      (missing.length ? '<p><b>' + t('Missing data:') + '</b> ' + missing.map(function (k) { return '<a href="#/ex/' + S.ex.id + '/data">' + esc(k === 'return' ? t('VAT return as filed') : t(E.KINDS[k].en)) + '</a>'; }).join(', ') + '</p>' : '') +
      (attention.slice(0, 9).map(function (c) {
        return '<div class="row" style="flex-wrap:nowrap;padding:7px 0;border-top:1px solid var(--line)">' + Z.tick(c.status) + '<a href="#/ex/' + S.ex.id + '/' + tabOf(c) + '" style="flex:1;color:var(--ink)">' + esc(Z.tt(c, 'title')) + '</a><span class="num ' + (c.status === 'fail' ? 'diff-bad' : 'diff-warn') + '" style="font-weight:600">' + (c.diff != null ? fmt(c.diff) : '') + '</span></div>';
      }).join('') || '<p class="muted">' + t('Nothing failing. Finish the samples and documents to reach full readiness.') + '</p>') + '</section></div>' +
      '<section class="paper area-vat" style="margin-top:18px"><header><div><h2>' + (fz ? t('Six sources, one picture') : t('Five sources, one picture')) + '</h2><p>' + t('The figures an inspector compares first. Every column must tell the same story.') + '</p></div></header><div class="tbl-wrap">' + four + '</div></section>';
  };

  Z.tabsW.overview = function () {
    var R = S.R, sc = R.whtScore || R.score, W = R.wht;
    var parts = Object.keys(S.settings.weights).map(function (k) {
      var v = sc.parts[k]; if (v == null) return '';
      return '<div class="p"><span>' + t(Z.partName(k)) + '</span><div class="bar ' + (v >= 0.85 ? '' : v >= 0.5 ? 'warn' : 'fail') + '"><i style="width:' + Math.round(v * 100) + '%"></i></div><b class="num">' + Math.round(v * 100) + '%</b></div>';
    }).join('');
    var b5 = R.bank.checks.filter(function (c) { return c.id === 'B5'; });
    var checks = R.filing.checks.filter(function (c) { return c.id === 'C3'; }).concat(W.checks, b5);
    var attention = checks.filter(function (c) { return c.status === 'fail' || c.status === 'warn'; }).sort(function (a, b) { return (a.status === 'fail' ? 0 : 1) - (b.status === 'fail' ? 0 : 1) || Math.abs(b.diff || 0) - Math.abs(a.diff || 0); });
    var missing = ['ret_wht', 'wht_reg'].filter(function (k) { return !(S.data[k] || []).length; });
    var sum = function (l, f) { return l.reduce(function (a, x) { return a + (x[f] || 0); }, 0); };
    var ret = W.lines.map(function (l) { return l.ret; }), reg = W.lines.map(function (l) { return l.reg; }), xls = W.lines.map(function (l) { return l.xls; });
    var paid = -((R.bank.summary || {}).zatca_wht || 0), foreign = -((R.bank.summary || {}).foreign_transfer || 0);
    var figs = '<table class="t"><thead><tr><th></th><th class="num">' + t('WHT return') + '</th><th class="num">' + t('Payments register') + '</th><th class="num">' + t('Excel workings') + '</th><th class="num">' + t('Bank') + '</th></tr></thead><tbody>' +
      '<tr><td>' + t('Gross paid to non-residents') + '</td><td class="num">' + fmt(sum(ret, 'a')) + '</td><td class="num">' + fmt(sum(reg, 'a')) + '</td><td class="num">' + fmt(sum(xls, 'a')) + '</td><td class="num" title="' + esc(t('Foreign transfers in the bank statements')) + '">' + fmt(foreign || null) + '</td></tr>' +
      '<tr class="total"><td>' + t('WHT due') + '</td><td class="num">' + fmt(sum(ret, 't')) + '</td><td class="num">' + fmt(sum(reg, 't')) + '</td><td class="num">' + fmt(sum(xls, 't')) + '</td><td class="num" title="' + esc(t('Paid to ZATCA for withholding tax')) + '">' + fmt(paid || null) + '</td></tr></tbody></table>';
    return '<div class="grid g2" style="align-items:start"><section class="paper"><header><div><h2>' + t('WHT readiness') + '</h2><p>' + t('Weighted from the WHT checks, WHT samples, WHT documents and open WHT findings only.') + '</p></div></header>' +
      '<div class="row ready-row">' + Z.seal(sc.score, sc.grade) + '<div class="parts" style="flex:1">' + parts + '</div></div>' +
      '<div class="kpis" style="margin-top:18px"><div class="' + (R.whtExposure ? 'bad' : '') + '"><b>' + fmt(R.whtExposure || 0) + '</b><span>' + t('WHT exposure (SAR)') + '</span></div><div><b>' + checks.filter(function (c) { return c.status === 'fail'; }).length + ' / ' + checks.length + '</b><span>' + t('Checks failed') + '</span></div><div><b>' + S.samples.filter(function (x) { return x.flow === 'W'; }).length + '</b><span>' + t('Samples') + '</span></div></div></section>' +
      '<section class="paper"><header><div><h2>' + t('What needs attention') + '</h2><p>' + t('Failures first, largest differences first.') + '</p></div></header>' +
      (missing.length ? '<p><b>' + t('Missing data:') + '</b> ' + missing.map(function (k) { return '<a href="#/ex/' + S.ex.id + '/data">' + esc(t(E.KINDS[k].en)) + '</a>'; }).join(', ') + '</p>' : '') +
      (attention.slice(0, 9).map(function (c) {
        return '<div class="row" style="flex-wrap:nowrap;padding:7px 0;border-top:1px solid var(--line)">' + Z.tick(c.status) + '<a href="#/ex/' + S.ex.id + '/' + (c.id === 'C3' ? 'filing' : 'wht') + '" style="flex:1;color:var(--ink)">' + esc(Z.tt(c, 'title')) + '</a><span class="num ' + (c.status === 'fail' ? 'diff-bad' : 'diff-warn') + '" style="font-weight:600">' + (c.diff != null ? fmt(c.diff) : '') + '</span></div>';
      }).join('') || '<p class="muted">' + t('Nothing failing. Finish the samples and documents to reach full readiness.') + '</p>') + '</section></div>' +
      '<section class="paper area-wht" style="margin-top:18px"><header><div><h2>' + t('Four sources, one picture') + '</h2><p>' + t('What the inspector compares for withholding tax: the return, the register of payments to non-residents, your workings and the bank.') + '</p></div></header><div class="tbl-wrap">' + figs + '</div></section>';
  };

  // ---------------------------------------------------------------- data
  var GROUPS = [['ledger', 'Ledger', 'area-ledger'], ['vat', 'VAT', 'area-vat'], ['bank', 'Bank', 'area-bank'], ['wht', 'Withholding tax', 'area-wht'], ['other', 'Other taxes - load only what applies', 'area-ledger']];
  Z.tabs.data = function () {
    var ent = Z.entity(S.ex.entityId) || {}, lk = locked();
    var cards = function (g) {
      return Object.keys(E.KINDS).filter(function (k) { return E.KINDS[k].group === g && !(g === 'wht' && ent.whtRegistered === false); }).map(function (k) {
        var K = E.KINDS[k], files = S.datasets.filter(function (d) { return d.kind === k; });
        return '<div class="paper"><div class="spread" style="align-items:flex-start"><h3>' + esc(S.lang === 'ar' ? K.ar : K.en) + '</h3>' + (K.required ? '<span class="req">' + (files.length ? Z.tick('pass') : t('Required')) + '</span>' : '') + '</div>' +
          '<div class="files">' + (files.map(function (d) { return '<div><span>' + esc(d.fileName) + '</span><span class="nowrap">' + Z.count(d.rowCount) + ' ' + t('rows') + (lk ? '' : ' <a href="#" data-act="deldata" data-id="' + d.id + '" aria-label="' + t('Remove') + ' ' + esc(d.fileName) + '">✕</a>') + '</span></div>'; }).join('') || '<span class="faint">' + t('Nothing loaded') + '</span>') + '</div>' +
          '<div class="row" style="margin-top:auto">' + (lk ? '' : '<button class="btn small primary" data-act="upload" data-k="' + k + '">' + t('Upload Excel / CSV') + '</button>') + '<button class="btn small ghost" data-act="template" data-k="' + k + '">' + t('Template') + '</button>' + (files.length ? '<button class="btn small ghost" data-act="viewdata" data-k="' + k + '">' + t('View') + '</button>' : '') + '</div></div>';
      }).join('');
    };
    var wht = Z.isWht();
    var html = '<p class="muted">' + t('Load each source for the period. Columns are matched automatically (English or Arabic headers) and you can correct the mapping before saving. Several files of the same kind add up - load one statement per bank account.') + '</p>';
    if (!wht) html += returnForm();
    GROUPS.forEach(function (g) {
      if (wht ? g[0] === 'vat' || g[0] === 'other' : g[0] === 'wht') return;
      var c = cards(g[0]); if (!c) return;
      html += '<h2 style="margin:22px 0 10px">' + t(g[1]) + '</h2><div class="ds">' + c + '</div>';
    });
    html += '<section class="paper" style="margin-top:22px"><h2>' + t('Previous period payments to trace') + '</h2><p class="muted">' + t('Taken from the previous exercise when there is one. Override here if not.') + '</p><div class="grid g3">' +
      (wht ? Z.fld('prevWhtTax', t('Previous month WHT return tax'), S.ex.prevWhtTax, 'number', 'step="0.01" data-chg="exnum"' + (lk ? ' disabled' : ''))
        : Z.fld('prevNetVat', t('Previous VAT return net due (box 16)'), S.ex.prevNetVat, 'number', 'step="0.01" data-chg="exnum"' + (lk ? ' disabled' : ''))) + '</div></section>';
    return html;
  };
  Z.CHG.exnum = function (el) { S.ex[el.name] = el.value === '' ? null : +el.value; Z.saveEx().then(Z.changed); };

  function returnForm() {
    var b = S.ex.returnBoxes ? E.completeBoxes(JSON.parse(JSON.stringify(S.ex.returnBoxes)), true) : E.emptyBoxes(), lk = locked();
    var rows = E.BOXES.map(function (bx) {
      var v = b[bx.n], derived = bx.total || bx.n === 13 || bx.n === 16;
      var inp = function (f, show) {
        if (!show) return '<td></td>';
        if (derived || lk) return '<td class="num">' + fmt(v[f]) + '</td>';
        return '<td><input type="number" step="0.01" value="' + (v[f] || '') + '" data-chg="box" data-n="' + bx.n + '" data-f="' + f + '" aria-label="' + esc('Box ' + bx.n + ' ' + f) + '" style="text-align:end"></td>';
      };
      return '<tr' + (derived ? ' class="total"' : '') + '><td class="num faint">' + bx.n + '</td><td>' + esc(S.lang === 'ar' ? bx.ar : bx.en) + '</td>' + inp('amount', !bx.vatOnly) + inp('adj', !bx.vatOnly && !bx.total) + inp('vat', true) + '</tr>';
    }).join('');
    return '<section class="paper area-vat" style="margin-top:16px"><header><div><h2>' + t('VAT return as filed') + ' ' + (S.ex.returnBoxes ? Z.tick('pass') : '<span class="req">' + t('Required') + '</span>') + '</h2><p>' + t('Copy the figures from the return submitted on the ZATCA portal. Totals and net VAT are computed; box 9 VAT counts as both due and deductible.') + '</p></div>' +
      (lk ? '' : '<div class="row"><button class="btn small" data-act="upload" data-k="xls_vat" data-ret="1">' + t('Import from Excel') + '</button><button class="btn small ghost" data-act="retfromsys">' + t('Prefill from system report') + '</button></div>') + '</header>' +
      '<details' + (S.ex.returnBoxes ? '' : ' open') + '><summary class="btn small ghost">' + t('Show the 16 boxes') + '</summary><div class="tbl-wrap" style="margin-top:10px"><table class="t"><thead><tr><th class="num">#</th><th>' + t('Box') + '</th><th class="num">' + t('Amount (SAR)') + '</th><th class="num">' + t('Adjustment') + '</th><th class="num">' + t('VAT') + '</th></tr></thead><tbody>' + rows + '</tbody></table></div></details></section>';
  }
  Z.CHG.box = function (el) {
    var b = S.ex.returnBoxes ? JSON.parse(JSON.stringify(S.ex.returnBoxes)) : E.emptyBoxes();
    b[el.dataset.n][el.dataset.f] = el.value === '' ? 0 : E.r2(+el.value);
    [6, 12, 13, 16].forEach(function (n) { b[n] = { amount: 0, adj: 0, vat: 0 }; });
    S.ex.returnBoxes = E.completeBoxes(b);
    Z.saveEx().then(function () { Z.recompute(); Z.saveSummary(); });
  };
  Z.ACT.retfromsys = function () {
    if (!(S.data.sys_vat || []).length) return Z.toast(t('Load the system VAT report first.'), true);
    if (S.ex.returnBoxes && !confirm(t('Replace the return figures with the system report totals? Only do this if the return was filed from this report.'))) return;
    S.ex.returnBoxes = E.boxesFromSystem(S.data.sys_vat);
    Z.saveEx().then(Z.changed);
  };

  // ---------------------------------------------------------------- upload with mapping
  var UP = {};
  Z.ACT.upload = function (el) {
    UP = { kind: el.dataset.k, toReturn: !!el.dataset.ret };
    var inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.xlsx,.xls,.xlsm,.csv,.txt';
    inp.onchange = function () { if (inp.files[0]) readFile(inp.files[0]); };
    inp.click();
  };
  function readFile(file) {
    if (!window.XLSX) return Z.toast(t('The spreadsheet reader did not load. Check your internet connection.'), true);
    UP.fileName = file.name;
    file.arrayBuffer().then(function (buf) {
      UP.wb = XLSX.read(buf, { type: 'array', cellDates: true });
      UP.sheet = UP.wb.SheetNames[0];
      // a column layout saved for this company and file type is applied when it fits
      return Z.get('profiles', S.ex.entityId + '_' + UP.kind).catch(function () { return null; }).then(function (pf) { UP.profile = pf; prepSheet(); mapModal(); });
    }).catch(function (e) { Z.toast(t('Could not read this file:') + ' ' + e.message, true); });
  }
  function prepSheet() {
    UP.aoa = XLSX.utils.sheet_to_json(UP.wb.Sheets[UP.sheet], { header: 1, raw: true, defval: '' });
    var d = E.detectHeader(UP.aoa, UP.kind), pf = UP.profile && E.applyProfile(UP.aoa, UP.profile.headers);
    UP.headerRow = pf ? pf.row : d.row; UP.map = pf ? Object.assign({}, d.map, pf.map) : d.map; UP.usedProfile = !!pf;
  }
  function mapModal() {
    var K = E.KINDS[UP.kind], hdr = UP.aoa[UP.headerRow] || [];
    var colOpts = function (sel) { return '<option value="">' + t('(not in file)') + '</option>' + hdr.map(function (h, i) { return '<option value="' + i + '"' + (sel === i ? ' selected' : '') + '>' + esc(String.fromCharCode(65 + (i % 26)) + (i >= 26 ? Math.floor(i / 26) : '') + ': ' + (h === '' ? t('(blank)') : h)) + '</option>'; }).join(''); };
    var res = E.normalizeRows(UP.aoa, UP.headerRow, UP.map, UP.kind);
    UP.result = res;
    var missingReq = K.fields.filter(function (f) { return f.req && UP.map[f.k] == null; });
    var prev = res.rows.slice(0, 8);
    var body = '<div class="grid g3"><label class="f"><span>' + t('Sheet') + '</span><select data-chg="upsheet">' + UP.wb.SheetNames.map(function (n) { return '<option' + (n === UP.sheet ? ' selected' : '') + '>' + esc(n) + '</option>'; }).join('') + '</select></label>' +
      '<label class="f"><span>' + t('Header row') + '</span><input type="number" min="1" value="' + (UP.headerRow + 1) + '" data-chg="uphdr"></label><div class="f"><span class="muted" style="font-size:13px">' + t('File') + '</span><p style="margin:6px 0 0">' + esc(UP.fileName) + '</p></div></div>' +
      (UP.usedProfile ? '<p class="zk-profile">' + Z.icon('bookmark-simple') + t('Columns matched with the layout saved for this company.') + (UP.profile.erp ? ' (' + esc(UP.profile.erp) + ')' : '') + '</p>' : '') +
      '<h3 style="margin:16px 0 8px">' + t('Match the columns') + '</h3><div class="grid g3">' + K.fields.map(function (f) {
        return '<label class="f"><span>' + esc(fieldLabel(f.k)) + (f.req ? ' *' : '') + '</span><select data-chg="upmap" data-f="' + f.k + '">' + colOpts(UP.map[f.k]) + '</select></label>';
      }).join('') + '</div>' +
      '<h3 style="margin:18px 0 8px">' + t('Preview') + ' - ' + Z.count(res.rows.length) + ' ' + t('rows') + (res.errors.length ? ' · <span class="diff-bad">' + res.errors.length + ' ' + t('with missing required values') + '</span>' : '') + '</h3>' +
      '<div class="tbl-wrap"><table class="t"><thead><tr>' + K.fields.map(function (f) { return '<th>' + esc(fieldLabel(f.k)) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      prev.map(function (r) { return '<tr>' + K.fields.map(function (f) { return '<td' + (f.t === 'n' ? ' class="num"' : '') + '>' + esc(f.t === 'n' ? fmt(r[f.k]) : r[f.k]) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>' +
      (res.errors.length ? '<p class="diff-bad" style="margin-top:8px">' + t('Rows') + ' ' + res.errors.slice(0, 12).map(function (e) { return e.row; }).join(', ') + (res.errors.length > 12 ? '…' : '') + ' ' + t('are missing required values. They are kept and will show in the checks.') + '</p>' : '');
    Z.modal(t('Load') + ' - ' + (S.lang === 'ar' ? K.ar : K.en), body,
      '<button class="btn" data-act="closemodal">' + t('Cancel') + '</button><button class="btn primary" data-act="upsave"' + (missingReq.length || !res.rows.length ? ' disabled title="' + esc(t('Map every required column')) + '"' : '') + '>' + (UP.toReturn ? t('Use as VAT return') : t('Save') + ' ' + Z.count(res.rows.length) + ' ' + t('rows')) + '</button>', true);
  }
  Z.CHG.upsheet = function (el) { UP.sheet = el.value; prepSheet(); mapModal(); };
  Z.CHG.uphdr = function (el) { UP.headerRow = Math.max(0, +el.value - 1); UP.map = E.autoMap(UP.aoa[UP.headerRow] || [], UP.kind); mapModal(); };
  Z.CHG.upmap = function (el) { if (el.value === '') delete UP.map[el.dataset.f]; else UP.map[el.dataset.f] = +el.value; mapModal(); };
  Z.ACT.upsave = function () {
    var rows = UP.result.rows;
    if (UP.toReturn) {
      S.ex.returnBoxes = E.boxesFromRows(rows); Z.closeModal();
      return Z.saveEx().then(function () { Z.toast(t('VAT return figures loaded')); Z.changed(); });
    }
    var ds = { parentId: S.ex.id, kind: UP.kind, fileName: UP.fileName, sheet: UP.sheet, headerRow: UP.headerRow, mapping: UP.map, rowCount: rows.length, errors: UP.result.errors.length, uploadedAt: new Date().toISOString(), label: UP.fileName };
    var ent = Z.entity(S.ex.entityId) || {};
    if (Z.can('preparer')) Z.save('profiles', { id: S.ex.entityId + '_' + UP.kind, entityId: S.ex.entityId, kind: UP.kind, erp: ent.erp || '', headers: E.profileFrom(UP.aoa[UP.headerRow], UP.map), label: (ent.erp || '') + ' ' + UP.kind }).catch(function () {});
    Z.save('datasets', ds).then(function (d) {
      return Z.save('rows', Object.assign({ id: d.id, parentId: S.ex.id }, pack(rows))).then(function () {
        Z.closeModal(); Z.toast(Z.count(rows.length) + ' ' + t('rows saved')); S.loaded = false; Z.route();
      });
    });
  };
  Z.ACT.deldata = function (el) {
    if (!confirm(t('Remove this file and its rows from the exercise?'))) return;
    Z.call('remove', { table: 'datasets', id: el.dataset.id }).then(function () { S.loaded = false; Z.route(); });
  };
  Z.ACT.template = function (el) {
    var K = E.KINDS[el.dataset.k];
    var head = K.fields.map(function (f) { return f.syn[0]; });
    var eg = { sys_vat: ['Sales', 'INV-1001', '2026-09-01', 'Customer name', '310000000000003', 'SA', 'Standard', 'Invoice', 1000, 150, 1150], bank: ['2026-09-01', 'Customer transfer INV-1001', 'TRF123', 0, 1150, 51150, 'SA00 0000'], wht_reg: ['2026-09-05', 'Consultant Ltd', 'GB', 'Consulting services', 10000, 5, 500, 'no', 'WC-001', '2026-10-08'], ret_wht: ['Consulting services', 10000, 5, 500], xls_wht: ['Royalties', 20000, 15, 3000], xls_vat: [1, 100000, 0, 15000], tb: ['4000', 'Sales revenue', 0, 0, 100000, -100000] }[el.dataset.k];
    var ws = XLSX.utils.aoa_to_sheet(eg ? [head, eg] : [head]);
    var wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'data');
    XLSX.writeFile(wb, 'template-' + el.dataset.k + '.xlsx');
  };
  Z.ACT.viewdata = function (el) {
    var k = el.dataset.k, rows = S.data[k] || [], K = E.KINDS[k];
    Z.modal(S.lang === 'ar' ? K.ar : K.en, '<p class="muted">' + Z.count(rows.length) + ' ' + t('rows') + (rows.length > 300 ? ' - ' + t('first 300 shown') : '') + '</p>' + Z.rowsTable(rows.slice(0, 300), K.fields.map(function (f) { return f.k; })), '', true);
  };

  var FIELD_LABELS = { account: 'Account', name: 'Account name', opening: 'Opening', debit: 'Debit', credit: 'Credit', closing: 'Closing', date: 'Date', doc: 'Document', description: 'Description', party: 'Counterparty', country: 'Country', flow: 'Sales / purchase', invoice: 'Invoice no.', vatNo: 'VAT no.', category: 'Tax category', docType: 'Document type', net: 'Net', vat: 'VAT', total: 'Total', box: 'Box', amount: 'Amount', adj: 'Adjustment', uuid: 'UUID', status: 'Status', declaration: 'Declaration no.', value: 'Customs value', reference: 'Reference', balance: 'Balance', paymentType: 'Payment type', gross: 'Gross', rate: 'Rate', wht: 'WHT', dtt: 'Treaty relief', certificate: 'Certificate', paidDate: 'Paid to ZATCA', tax: 'Tax', cls: 'Class', reason: 'Why', expected: 'Expected', statutory: 'Statutory rate', applied: 'Applied rate', shortfall: 'Shortfall', due: 'Due', daysLate: 'Days late', penalty: 'Fine', missing: 'Missing',
    type: 'Invoice type', issuedAt: 'Issued', submittedAt: 'Sent to ZATCA', egs: 'EGS unit', icv: 'Counter', buyerVat: 'Buyer VAT no.', ref: 'Original invoice', message: 'ZATCA message',
    property: 'Property', deed: 'Deed no.', buyer: 'Buyer', paidOn: 'Paid on', exemption: 'Exemption', product: 'Product', qty: 'Quantity', retailPrice: 'Retail price', standardPrice: 'Standard price',
    excise: 'Excise', litres: 'Litres', sugar: 'Sugar g/100 ml', opening: 'Opening', received: 'Received', released: 'Released', exported: 'Exported', seller: 'Seller', sellerVat: 'Seller VAT no.', terminal: 'Terminal', fees: 'Fees', qr: 'QR', sellerResident: 'Resident', order: 'Order', channel: 'Channel',
    other: 'Compared with', otherNet: 'Their net', otherVat: 'Their VAT', exportRef: 'Export declaration', period: 'Period', average: 'Average', overdue: 'Days overdue', owner: 'Owner', title: 'Finding', severity: 'Severity', taxImpact: 'Tax impact', entity: 'Entity' };
  function fieldLabel(k) { return t(FIELD_LABELS[k] || k); }
  Z.fieldLabel = fieldLabel;
  var NUMF = { opening: 1, debit: 1, credit: 1, closing: 1, net: 1, vat: 1, total: 1, amount: 1, adj: 1, value: 1, balance: 1, gross: 1, wht: 1, tax: 1, expected: 1, shortfall: 1, penalty: 1, otherNet: 1, otherVat: 1, average: 1, taxImpact: 1, retailPrice: 1, standardPrice: 1, excise: 1, rett: 1 };
  Z.rowsTable = function (rows, cols) {
    if (!rows.length) return '<p class="faint">' + t('None.') + '</p>';
    cols = cols || Object.keys(rows[0]).filter(function (k) { return k[0] !== '_'; });
    return '<div class="tbl-wrap" style="max-height:420px"><table class="t"><thead><tr>' + cols.map(function (c) { return '<th' + (NUMF[c] ? ' class="num"' : '') + '>' + esc(fieldLabel(c)) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      rows.map(function (r) { return '<tr>' + cols.map(function (c) { var v = r[c]; return '<td' + (NUMF[c] ? ' class="num"' : '') + '>' + esc(NUMF[c] ? fmt(v) : c === 'rate' || c === 'statutory' || c === 'applied' ? (v ? Z.r(v * 100) + '%' : '') : c === 'cls' ? t(Z.bankClassName(v)) : v) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>';
  };

  // ---------------------------------------------------------------- checks list (shared)
  Z.checkHtml = function (c, extra) {
    var note = S.ex.checkNotes[c.id] || '', lk = locked();
    var figs = c.status === 'na' ? '<span>' + t('Needs') + ': <b>' + esc(t(c.missing || '')) + '</b>' + (c.missingHint ? ' - ' + esc(t(c.missingHint)) : '') + '</span>'
      : (c.aLabel ? '<span>' + esc(t(c.aLabel)) + ': <b>' + fmt(c.a, /^(Exceptions|Days late|Lines without)/.test(c.aLabel) ? 0 : 2) + '</b></span>' : '') + (c.bLabel ? '<span>' + esc(t(c.bLabel)) + ': <b>' + fmt(c.b) + '</b></span>' : '') +
        (c.diff != null && c.bLabel ? '<span class="d ' + c.status + '">' + t('Difference') + ': <b>' + fmt(c.diff) + '</b></span>' : '') + (c.exposure ? '<span class="d fail">' + t('Exposure') + ': <b>' + fmt(c.exposure) + '</b></span>' : '') + (c.source ? '<span class="faint">' + esc(c.source) + '</span>' : '');
    return '<div class="check" id="c-' + c.id + '">' + Z.tick(c.status) + '<div><h3>' + esc(c.id) + ' · ' + esc(Z.tt(c, 'title')) + '</h3><div class="figs">' + figs + '</div>' +
      (c.note ? '<p class="faint" style="font-size:12.5px;margin:4px 0 0">' + esc(S.lang === 'ar' && c.noteAr ? c.noteAr : t(c.note)) + '</p>' : '') + (extra || '') +
      (c.status !== 'pass' && c.status !== 'na' || note ? '<textarea data-chg="cnote" data-id="' + c.id + '" placeholder="' + esc(t('Explanation for the inspector (what causes the difference, evidence reference)')) + '"' + (lk ? ' disabled' : '') + '>' + esc(note) + '</textarea>' : '') +
      (Z.reviewHtml ? Z.reviewHtml(c.id) : '') +
      '</div><div class="acts">' + (c.status === 'fail' || c.status === 'warn' ? (lk ? '' : '<button class="btn small" data-act="raise" data-id="' + c.id + '">' + t('Raise finding') + '</button>') : '') + (Z.reviewButton ? Z.reviewButton(c.id) : '') + '</div></div>';
  };
  Z.CHG.cnote = function (el) { S.ex.checkNotes[el.dataset.id] = el.value; Z.saveEx(); };
  Z.exceptionsHtml = function (c) {
    if (!c.exceptions) return '';
    return Object.keys(c.exceptions).filter(function (k) { return c.exceptions[k].length; }).map(function (k) {
      return '<details><summary>' + esc(t(EXC[k] || k)) + ' (' + Z.count((c.counts || {})[k] || c.exceptions[k].length) + ')</summary>' + Z.rowsTable(c.exceptions[k].slice(0, 200), excCols(k, c.exceptions[k][0])) + '</details>';
    }).join('');
  };
  var EXC = { notReported: 'Sales invoices not reported to Fatoora', notInSystem: 'Fatoora invoices not in the system', rejected: 'Rejected by Fatoora', mismatch: 'VAT differs from Fatoora', unmatched: 'Unmatched lines', rate: 'Rate exceptions', late: 'Late remittances', noCert: 'Lines without a certificate', missing: 'Not in the WHT register', list: 'Exceptions' };
  function excCols(k, r) {
    if (!r) return [];
    var pickCols = function (cands) { return cands.filter(function (c) { return r[c] !== undefined && r[c] !== ''; }).concat(r.reason ? ['reason'] : []); };
    if (r.icv !== undefined || r.egs !== undefined || r.submittedAt !== undefined) return pickCols(['invoice', 'type', 'docType', 'issuedAt', 'submittedAt', 'status', 'egs', 'icv', 'ref', 'net', 'vat', 'message']);
    if (r.otherVat !== undefined) return ['invoice', 'date', 'party', 'vat', 'other', 'otherVat', 'reason'];
    if (r.property !== undefined) return pickCols(['date', 'deed', 'property', 'buyer', 'value', 'rett', 'expected', 'shortfall', 'paidOn', 'daysLate']);
    if (r.product !== undefined) return pickCols(['product', 'category', 'opening', 'received', 'released', 'exported', 'closing', 'qty', 'litres', 'sugar', 'retailPrice', 'standardPrice', 'excise', 'expected', 'shortfall']);
    if (r.seller !== undefined) return pickCols(['date', 'order', 'seller', 'sellerVat', 'sellerResident', 'category', 'gross', 'vat']);
    if (r.party !== undefined && r.total !== undefined && r.gross !== undefined && r.flow === undefined) return ['party', 'gross', 'total', 'reason'];
    if (r.flow !== undefined) return pickCols(['invoice', 'date', 'party', 'vatNo', 'country', 'category', 'description', 'net', 'vat']);
    if (r.period !== undefined && r.value !== undefined) return ['period', 'value', 'average'];
    if (r.description !== undefined && r.cls !== undefined) return ['date', 'description', 'reference', 'debit', 'credit', 'cls'];
    if (r.paymentType !== undefined) return ['date', 'party', 'country', 'paymentType', 'gross'].concat(k === 'rate' ? ['statutory', 'applied', 'wht', 'expected', 'shortfall', 'reason'] : k === 'late' ? ['wht', 'due', 'paidDate', 'daysLate', 'penalty'] : ['wht', 'certificate']);
    if (r.account !== undefined) return ['date', 'account', 'doc', 'description', 'party', 'country', 'debit'];
    return ['invoice', 'date', 'party', 'net', 'vat', 'status'].filter(function (c) { return r[c] !== undefined; });
  }

  // ---------------------------------------------------------------- VAT
  Z.tabs.vat = function () {
    var R = S.R.vat, b = R.boxes, mode = S.vatMode || 'amount';
    var cell = function (B, n) { if (!B) return '-'; var v = mode === 'vat' ? B[n].vat : (+B[n].amount || 0) + (+B[n].adj || 0); return fmt(v); };
    var dcell = function (A, B, n) {
      if (!A || !B) return '<td class="num bl faint">-</td>';
      var d = mode === 'vat' ? A[n].vat - B[n].vat : (+A[n].amount || 0) + (+A[n].adj || 0) - (+B[n].amount || 0) - (+B[n].adj || 0);
      var st = E.status(d, Math.abs(mode === 'vat' ? A[n].vat : A[n].amount), S.settings);
      return '<td class="num bl ' + (st === 'fail' ? 'diff-bad' : st === 'warn' ? 'diff-warn' : 'faint') + '">' + (Math.abs(d) < 0.005 ? '✓' : fmt(d)) + '</td>';
    };
    var rows = E.BOXES.filter(function (x) { return mode === 'vat' || !x.vatOnly; }).map(function (bx) {
      var n = bx.n;
      return '<tr' + (bx.total || n === 13 || n === 16 ? ' class="total"' : '') + '><td class="faint num">' + n + '</td><td>' + esc(S.lang === 'ar' ? bx.ar : bx.en) + '</td><td class="num">' + cell(b.ret, n) + '</td><td class="num">' + cell(b.sys, n) + '</td><td class="num">' + cell(b.xls, n) + '</td>' +
        dcell(b.ret, b.sys, n) + dcell(b.ret, b.xls, n) + dcell(b.sys, b.xls, n) + '</tr>';
    }).join('');
    var v6 = R.checks.filter(function (c) { return c.id === 'V6'; })[0];
    var items = S.ex.reconItems.filter(function (i) { return i.check === 'V6'; }), lk = locked();
    var v6extra = '<details' + (items.length ? ' open' : '') + '><summary>' + t('Reconciling items between revenue and declared sales') + ' (' + items.length + ')</summary><table class="t" style="margin-top:6px"><tbody>' +
      items.map(function (i) { return '<tr><td>' + esc(i.description) + '</td><td class="num">' + fmt(i.amount) + '</td><td>' + (lk ? '' : '<a href="#" data-act="delitem" data-id="' + i.id + '">' + t('Remove') + '</a>') + '</td></tr>'; }).join('') +
      (lk ? '' : '<tr><td><input type="text" id="ri-d" placeholder="' + esc(t('e.g. Out-of-scope income, unbilled revenue, FX gains')) + '"></td><td style="width:160px"><input type="number" step="0.01" id="ri-a" placeholder="0.00"></td><td><button class="btn small" data-act="additem">' + t('Add') + '</button></td></tr>') + '</tbody></table>' +
      (v6 && v6.tbRevenue != null ? '<p class="faint" style="font-size:12.5px">' + t('TB revenue') + ' ' + fmt(v6.tbRevenue) + ' − ' + t('explained') + ' ' + fmt(v6.explained) + '</p>' : '') + '</details>';
    return '<section class="paper area-vat"><header><div><h2>' + t('Box-by-box: return, system report, Excel workings') + '</h2><p>' + t('Return amounts include the adjustment column. Differences beyond tolerance are red.') + '</p></div>' +
      '<div class="row" role="group" aria-label="' + t('Show') + '"><button class="btn small' + (mode === 'amount' ? ' primary' : '') + '" data-act="vatmode" data-m="amount">' + t('Amounts') + '</button><button class="btn small' + (mode === 'vat' ? ' primary' : '') + '" data-act="vatmode" data-m="vat">' + t('VAT') + '</button></div></header>' +
      '<div class="tbl-wrap"><table class="t matrix"><thead><tr><th></th><th>' + t('Box') + '</th><th class="num">' + t('Return') + '</th><th class="num">' + t('System') + '</th><th class="num">' + t('Excel') + '</th><th class="num grp">' + t('Return − System') + '</th><th class="num grp">' + t('Return − Excel') + '</th><th class="num grp">' + t('System − Excel') + '</th></tr></thead><tbody>' + rows + '</tbody></table></div></section>' +
      '<section class="paper" style="margin-top:18px"><header><div><h2>' + t('VAT checks') + '</h2><p>' + t('Each failed or unexplained check needs an explanation an inspector would accept, or a finding.') + '</p></div></header>' +
      R.checks.map(function (c) { return Z.checkHtml(c, c.id === 'V6' ? v6extra : c.id === 'V11' ? recoveryForm(c) : Z.exceptionsHtml(c)); }).join('') + '</section>';
  };
  function recoveryForm(c) {
    if (!c.exemptSales) return '';
    var rc = S.ex.recovery || {}, lk = locked(), dis = lk ? ' disabled' : '';
    var opt = function (v, l) { return '<option value="' + v + '"' + ((rc.method || 'none') === v ? ' selected' : '') + '>' + t(l) + '</option>'; };
    return '<details' + (rc.method && rc.method !== 'none' ? '' : ' open') + '><summary>' + t('Apportionment applied this period') + '</summary><div class="grid g4" style="margin-top:8px">' +
      '<label class="f"><span>' + t('Method') + '</span><select data-chg="recov" data-f="method"' + dis + '>' + opt('none', 'Not applied') + opt('standard', 'Standard (value of supplies)') + opt('special', 'Special method approved by ZATCA') + '</select></label>' +
      Z.fld('directExemptVat', t('Input VAT directly on exempt supplies'), rc.directExemptVat, 'number', 'step="0.01" data-chg="recov" data-f="directExemptVat"' + dis) +
      Z.fld('commonVat', t('Input VAT on common costs'), rc.commonVat, 'number', 'step="0.01" data-chg="recov" data-f="commonVat"' + dis) +
      Z.fld('ratioUsed', t('Recoverable % applied'), rc.ratioUsed, 'number', 'step="0.01" data-chg="recov" data-f="ratioUsed"' + dis, t('Computed') + ': ' + c.a + '%') + '</div></details>';
  }
  Z.CHG.recov = function (el) { S.ex.recovery = S.ex.recovery || {}; S.ex.recovery[el.dataset.f] = el.value; Z.saveEx().then(Z.changed); };

  // ---------------------------------------------------------------- filing & payment
  Z.tabs.filing = function () {
    var F = S.ex.filing || {}, lk = locked(), dis = lk ? ' disabled' : '', dl = E.deadlines(S.ex.period), ent = Z.entity(S.ex.entityId) || {};
    var ret = S.R.vat.boxes.ret, due = ret ? ret[16].vat : null;
    var f = function (k, label, type, hint) { return Z.fld(k, label, F[k], type, (type === 'number' ? 'step="0.01" ' : '') + 'data-chg="filing" data-f="' + k + '"' + dis, hint); };
    var wht = Z.isWht(), mine = S.R.filing.checks.filter(function (c) { return (c.id === 'C3') === wht; });
    if (wht) return '<div class="grid g2" style="align-items:start"><section class="paper area-wht"><header><div><h2>' + t('WHT return') + '</h2><p>' + t('Due by') + ' ' + Z.ltr(dl.wht) + '</p></div></header><div class="grid g2">' +
        f('whtFiledOn', t('Filed on'), 'date') + f('whtPaidOn', t('Paid on (SADAD)'), 'date') + f('whtPaidAmount', t('Amount paid'), 'number') + f('whtSadad', t('SADAD / payment reference'), 'text') + '</div></section>' +
      '<section class="paper"><header><div><h2>' + t('Filing and payment checks') + '</h2><p>' + t('WHT is due by the 10th of the following month. The fine is 1% of the unpaid tax for each 30 days late, and nothing under 30 days.') + '</p></div></header>' + mine.map(function (c) { return Z.checkHtml(c); }).join('') + '</section></div>';
    return '<div class="grid g2" style="align-items:start"><section class="paper area-vat"><header><div><h2>' + t('VAT return') + '</h2><p>' + t('Due by') + ' ' + Z.ltr(dl.vat) + ' · ' + t('Net VAT due') + ' ' + fmt(due) + '</p></div></header><div class="grid g2">' +
      f('vatFiledOn', t('Filed on'), 'date') + f('vatPaidOn', t('Paid on (SADAD)'), 'date') + f('vatPaidAmount', t('Amount paid'), 'number', t('Leave blank if equal to box 16')) + f('vatSadad', t('SADAD / payment reference'), 'text') + '</div></section>' +
      '<section class="paper"><header><div><h2>' + t('Filing and payment checks') + '</h2><p>' + t('Late filing: 5%-25% of the tax due. Late payment: 5% of unpaid VAT per month or part. The fine-cancellation initiative covered returns due before 1 January 2026 and closed on 30 June 2026.') + '</p></div></header>' +
      mine.map(function (c) { return Z.checkHtml(c); }).join('') + '</section></div>';
  };
  Z.CHG.filing = function (el) { S.ex.filing = S.ex.filing || {}; S.ex.filing[el.dataset.f] = el.value; Z.saveEx().then(Z.changed); };

  // ---------------------------------------------------------------- other taxes
  Z.tabs.other = function () {
    var lk = locked(), O = S.R.other;
    return '<section class="paper area-ledger"><header><div><h2>' + t('Marketplaces, real estate and excise') + '</h2><p>' + t('Load the registers that apply to this entity on the Data tab: marketplace sales if you run a platform, property disposals, excise goods. Marketplace payouts are found in the bank statements automatically.') + '</p></div>' +
      '<a class="btn small" href="#/annual/' + S.ex.entityId + '/' + (+S.ex.period.slice(0, 4) - 1) + '">' + t('Zakat worksheet') + '</a></header>' +
      '<div class="grid g3">' + Z.fld('exciseReturn', t('Excise declared in the excise return'), S.ex.exciseReturn, 'number', 'step="0.01" data-chg="exnum"' + (lk ? ' disabled' : '')) + '</div>' +
      mktQuestions(lk) + '</section>' +
      '<section class="paper" style="margin-top:18px"><header><div><h2>' + t('Checks') + '</h2></div></header>' +
      (O.checks.length ? O.checks.map(function (c) { return Z.checkHtml(c, Z.exceptionsHtml(c)); }).join('') : '<p class="muted">' + t('Nothing to check yet: no marketplace payouts in the bank, and no marketplace, RETT or excise registers loaded.') + '</p>') + '</section>';
  };

  var MQ = [['named', 'Contracts, tax invoices and receipts name the seller as the supplier'], ['noTerms', 'The platform does not set the terms and conditions of the supply'],
    ['noPrice', 'The platform does not set the price'], ['noPayment', 'The platform does not collect payment from customers'],
    ['noComplaints', 'The platform does not handle customer complaints'], ['noPromos', 'The platform offers no promotions or compensation to customers']];
  function mktQuestions(lk) {
    var q = S.ex.mktException || {}, opt = function (k, v, l) { return '<option value="' + v + '"' + (q[k] === v ? ' selected' : '') + '>' + t(l) + '</option>'; };
    return '<details style="margin-top:12px"' + ((S.data.mkt_sales || []).length ? ' open' : '') + '><summary>' + t('If you operate a marketplace: deemed-supplier exception test') + '</summary>' +
      '<p class="faint" style="font-size:12.5px;margin:8px 0">' + t('The platform is not the deemed supplier only if every answer is yes (VAT IR Art. 47, ZATCA guide of 25 Dec 2025). Sources differ on payment collection; this test treats it as disqualifying.') + '</p><div class="grid g2">' +
      MQ.map(function (m) { return '<label class="f"><span>' + t(m[1]) + '</span><select data-chg="mktq" data-k="' + m[0] + '"' + (lk ? ' disabled' : '') + '>' + opt(m[0], '', '-') + opt(m[0], 'yes', 'Yes') + opt(m[0], 'no', 'No') + '</select></label>'; }).join('') + '</div></details>';
  }
  Z.CHG.mktq = function (el) { S.ex.mktException = S.ex.mktException || {}; S.ex.mktException[el.dataset.k] = el.value; Z.saveEx().then(Z.changed); };

  // ---------------------------------------------------------------- e-invoicing (ERP ↔ provider ↔ ZATCA)
  var EST = { CLEARED: 'Cleared by ZATCA', REPORTED: 'Reported to ZATCA', REJECTED: 'Rejected', PENDING: 'Pending at provider', WARNING: 'Accepted with warnings', NOT_SUBMITTED: 'Not sent' };
  // what ZATCA holds on the Fatoora portal, set against every other source
  var FMAP = [['E12', 'VAT return', 'einv'], ['V9', 'ERP sales', 'vat'], ['E3', 'E-invoicing provider', 'einv'], ['E4', 'Amounts in the ERP and at the provider', 'einv'],
    ['E13', 'Return boxes by VAT category', 'einv'], ['E14', 'Return period (cut-off)', 'einv'], ['E15', 'Itself (duplicates)', 'einv'], ['E16', 'Buyer TRN in the ERP', 'einv'], ['E17', 'Entity TRN', 'einv'], ['E11', 'QR codes', 'einv']];
  function fatooraMap() {
    var all = S.R.einv.checks.concat(S.R.vat.checks), rows = FMAP.map(function (m) { return { m: m, c: all.filter(function (x) { return x.id === m[0]; })[0] }; }).filter(function (r) { return r.c; });
    if (!rows.length || !S.R.einv.summary) return '';
    var ok = rows.filter(function (r) { return r.c.status === 'pass'; }).length, known = rows.filter(function (r) { return r.c.status !== 'na'; }).length;
    return '<section class="paper" style="margin-top:18px"><header><div><h2>' + t('Fatoora against everything') + '</h2><p>' + t('What ZATCA holds on the e-invoicing portal compared with each of your sources. ZATCA runs these comparisons itself.') + '</p></div><span class="score-chip">' + ok + ' / ' + known + ' ' + t('agree') + '</span></header><div class="pairs">' +
      rows.map(function (r, i) {
        var c = r.c, figure = c.status === 'na' ? t('No data') : c.status === 'pass' ? t('Agrees') : c.bLabel ? fmt(c.diff) : c.a + ' ' + (c.a === 1 ? t('item') : t('items'));
        return '<a class="pair st-' + c.status + '" style="--i:' + i + '" href="#" data-act="gocheck" data-id="' + c.id + '" data-tab="' + r.m[2] + '"><span class="node">' + t('Fatoora') + '</span><span class="link"><i></i>' + Z.tick(c.status) + '</span><span class="node">' + esc(t(r.m[1])) + '</span><span class="gap num">' + figure + '</span></a>';
      }).join('') + '</div></section>';
  }
  // jump to a check, on this tab or another
  Z.ACT.gocheck = function (el) {
    var id = el.dataset.id, tab = el.dataset.tab, go = function () { var c = document.getElementById('c-' + id); if (c) { c.scrollIntoView({ behavior: 'smooth', block: 'center' }); c.classList.add('flash'); setTimeout(function () { c.classList.remove('flash'); }, 1600); } };
    if (tab && (S.route || [])[2] !== tab) { location.hash = '#/ex/' + S.ex.id + '/' + tab; setTimeout(go, 600); } else go();
  };
  Z.tabs.einv = function () {
    var EI = S.R.einv, sm = EI.summary;
    var counts = sm ? '<div class="kpis"><div><b>' + Z.count(sm.erp) + '</b><span>' + t('Sales documents in the ERP') + '</span></div><div><b>' + Z.count(sm.provider) + '</b><span>' + t('Received by the e-invoicing provider') + '</span></div><div><b>' + Z.count(sm.zatca) + '</b><span>' + t('Held by ZATCA (Fatoora export)') + '</span></div>' +
      Object.keys(sm.byStatus).map(function (k) { return '<div class="' + (/REJECT|PEND|NOT_/.test(k) ? 'bad' : '') + '"><b>' + Z.count(sm.byStatus[k]) + '</b><span>' + esc(t(EST[k] || k)) + '</span></div>'; }).join('') + '</div>' : '';
    return '<section class="paper area-vat"><header><div><h2>' + t('Three-way e-invoicing reconciliation') + '</h2><p>' + t('Your ERP issues the invoice, the e-invoicing provider signs it and sends it to Fatoora, ZATCA clears or records it. An inspector compares all three: an invoice missing anywhere along the chain is a finding.') + '</p></div>' +
      '<a class="btn small" href="#/ex/' + S.ex.id + '/data">' + t('Load provider or Fatoora export') + '</a></header>' + counts + '</section>' + fatooraMap() +
      '<section class="paper" style="margin-top:18px"><header><div><h2>' + t('E-invoicing checks') + '</h2></div></header>' + EI.checks.map(function (c) { return Z.checkHtml(c, Z.exceptionsHtml(c)); }).join('') + '</section>';
  };

  Z.ACT.vatmode = function (el) { S.vatMode = el.dataset.m; Z.route(); };
  Z.ACT.additem = function () {
    var d = document.getElementById('ri-d').value.trim(), a = +document.getElementById('ri-a').value;
    if (!d || !a) return Z.toast(t('Enter a description and an amount.'), true);
    S.ex.reconItems.push({ id: Z.uid('RI'), check: 'V6', description: d, amount: a });
    Z.saveEx().then(Z.changed);
  };
  Z.ACT.delitem = function (el) { S.ex.reconItems = S.ex.reconItems.filter(function (i) { return i.id !== el.dataset.id; }); Z.saveEx().then(Z.changed); };

  // ---------------------------------------------------------------- bank
  Z.tabs.bank = function () {
    var B = S.R.bank, sum = B.summary || {}, lk = locked();
    var classes = E.BANK_CLASSES;
    var sumRows = classes.filter(function (k) { return sum[k]; }).map(function (k) {
      var n = B.lines.filter(function (l) { return l.cls === k; }).length;
      return '<tr><td>' + esc(t(Z.bankClassName(k))) + '</td><td class="num">' + n + '</td><td class="num">' + (sum[k] > 0 ? fmt(sum[k]) : '') + '</td><td class="num">' + (sum[k] < 0 ? fmt(-sum[k]) : '') + '</td></tr>';
    }).join('');
    var f = S.bankFilter || '', lines = B.lines.filter(function (l) { return !f || l.cls === f; });
    var pg = S.bankPage || 0, per = 60, shown = lines.slice(pg * per, pg * per + per);
    var lineRows = shown.map(function (l) {
      return '<tr><td class="nowrap">' + esc(l.date) + '</td><td>' + esc(l.description) + '<div class="faint" style="font-size:12px">' + esc(l.reference || '') + '</div></td><td class="num">' + (l.debit ? fmt(l.debit) : '') + '</td><td class="num">' + (l.credit ? fmt(l.credit) : '') + '</td><td>' +
        (lk ? esc(t(Z.bankClassName(l.cls))) : '<select data-chg="bankcls" data-k="' + esc(l._k) + '" aria-label="' + t('Class') + '">' + classes.map(function (k) { return '<option value="' + k + '"' + (l.cls === k ? ' selected' : '') + '>' + esc(t(Z.bankClassName(k))) + '</option>'; }).join('') + '</select>') + (l.manual ? ' <span class="faint" title="' + t('Set by hand') + '">✎</span>' : '') + '</td></tr>';
    }).join('');
    var pages = Math.ceil(lines.length / per);
    return '<div class="grid g2" style="align-items:start"><section class="paper area-bank"><header><div><h2>' + t('Where the money went') + '</h2><p>' + t('Bank lines grouped by what they are. Reclassify any line below; the checks update immediately.') + '</p></div></header>' +
      (B.lines.length ? '<table class="t"><thead><tr><th>' + t('Class') + '</th><th class="num">' + t('Lines') + '</th><th class="num">' + t('In') + '</th><th class="num">' + t('Out') + '</th></tr></thead><tbody>' + sumRows + '</tbody></table>' : '<p class="muted">' + t('Load the bank statements for every account for the full period.') + '</p>') + '</section>' +
      '<section class="paper"><header><div><h2>' + t('Why inspectors start with the bank') + '</h2></div></header><p class="muted">' + t('Money received that is not in declared sales is the most common basis for a VAT assessment. Receipts are compared with sales including VAT, adjusted for the change in receivables; payments with purchases, adjusted for payables. VAT and WHT payments are traced to the previous returns, and every foreign transfer must appear in the WHT register.') + '</p></section></div>' +
      '<section class="paper" style="margin-top:18px"><header><div><h2>' + t('Bank checks') + '</h2></div></header>' + B.checks.map(function (c) { return Z.checkHtml(c, Z.exceptionsHtml(c)); }).join('') + '</section>' +
      (B.lines.length ? '<section class="paper flush" style="margin-top:18px"><div style="padding:14px 18px" class="spread"><h2>' + t('Statement lines') + '</h2><select data-chg="bankfilter" style="width:auto" aria-label="' + t('Filter') + '"><option value="">' + t('All classes') + ' (' + B.lines.length + ')</option>' + classes.map(function (k) { var n = B.lines.filter(function (l) { return l.cls === k; }).length; return n ? '<option value="' + k + '"' + (f === k ? ' selected' : '') + '>' + esc(t(Z.bankClassName(k))) + ' (' + n + ')</option>' : ''; }).join('') + '</select></div>' +
        '<div class="tbl-wrap"><table class="t"><thead><tr><th>' + t('Date') + '</th><th>' + t('Description') + '</th><th class="num">' + t('Out') + '</th><th class="num">' + t('In') + '</th><th>' + t('Class') + '</th></tr></thead><tbody>' + lineRows + '</tbody></table></div>' +
        (pages > 1 ? '<div class="row" style="padding:10px 18px"><button class="btn small" data-act="bankpg" data-d="-1"' + (pg ? '' : ' disabled') + '>‹</button><span class="muted">' + (pg + 1) + ' / ' + pages + '</span><button class="btn small" data-act="bankpg" data-d="1"' + (pg + 1 < pages ? '' : ' disabled') + '>›</button></div>' : '') + '</section>' : '');
  };
  Z.CHG.bankcls = function (el) { S.ex.bankOverrides[el.dataset.k] = el.value; Z.saveEx().then(Z.changed); };
  Z.CHG.bankfilter = function (el) { S.bankFilter = el.value; S.bankPage = 0; Z.route(); };
  Z.ACT.bankpg = function (el) { S.bankPage = (S.bankPage || 0) + +el.dataset.d; Z.route(); };

  // ---------------------------------------------------------------- WHT
  Z.tabs.wht = function () {
    var W = S.R.wht;
    var name = function (k) { var w = E.WHT_TYPES.filter(function (x) { return x[0] === k; })[0]; return w ? (S.lang === 'ar' ? w[2] : w[1]) : k; };
    var rows = W.lines.map(function (l) {
      var rate = S.settings.whtRates[l.type];
      return '<tr><td>' + esc(name(l.type)) + ' <span class="faint">' + (rate != null ? Z.r(rate * 100) + '%' : '') + '</span></td><td class="num">' + fmt(l.ret.a) + '</td><td class="num">' + fmt(l.reg.a) + '</td><td class="num bl">' + fmt(l.ret.t) + '</td><td class="num">' + fmt(l.reg.t) + '</td><td class="num">' + fmt(l.xls.t) + '</td><td class="num ' + (l.status === 'fail' ? 'diff-bad' : l.status === 'warn' ? 'diff-warn' : 'faint') + '">' + (Math.abs(l.dRegTax) < 0.005 ? '✓' : fmt(l.dRegTax)) + '</td></tr>';
    }).join('');
    return '<section class="paper area-wht"><header><div><h2>' + t('WHT by payment type') + '</h2><p>' + t('The monthly WHT return against the payments register and the Excel workings. Due by the 10th of the following month; 1% fine per 30 days late.') + '</p></div></header>' +
      (rows ? '<div class="tbl-wrap"><table class="t matrix"><thead><tr><th>' + t('Payment type') + '</th><th class="num">' + t('Return amount') + '</th><th class="num">' + t('Register gross') + '</th><th class="num grp">' + t('Return tax') + '</th><th class="num">' + t('Register WHT') + '</th><th class="num">' + t('Excel tax') + '</th><th class="num">' + t('Return − Register') + '</th></tr></thead><tbody>' + rows + '</tbody></table></div>' : '<p class="muted">' + t('Load the WHT return and the payments register.') + '</p>') + '</section>' +
      '<section class="paper" style="margin-top:18px"><header><div><h2>' + t('WHT checks') + '</h2></div></header>' + W.checks.map(function (c) { return Z.checkHtml(c, Z.exceptionsHtml(c)); }).join('') + '</section>' +
      '<section class="paper" style="margin-top:18px"><header><div><h2>' + t('Bank trace') + '</h2><p>' + t('Every transfer abroad in the bank statements must be in the WHT register, or have a reason it is not subject to WHT.') + '</p></div></header>' +
      S.R.bank.checks.filter(function (c) { return c.id === 'B5'; }).map(function (c) { return Z.checkHtml(c, Z.exceptionsHtml(c)); }).join('') + '</section>';
  };

  // ---------------------------------------------------------------- analytics
  Z.tabs.analytics = function () {
    var A = S.R.analytics, ra = A.ratios;
    var tiles = '<div class="kpis"><div class="' + (ra.effectiveRate != null && Math.abs(ra.effectiveRate - S.settings.vatRate * 100) >= 0.001 ? 'bad' : '') + '"><b>' + (ra.effectiveRate == null ? '-' : ra.effectiveRate + '%') + '</b><span>' + t('Effective VAT rate on standard sales') + '</span></div>' +
      '<div><b>' + (ra.inputToOutput == null ? '-' : ra.inputToOutput + '%') + '</b><span>' + t('Input VAT as % of output VAT') + '</span></div><div><b>' + (ra.zeroExemptShare == null ? '-' : ra.zeroExemptShare + '%') + '</b><span>' + t('Zero-rated, export and exempt share of sales') + '</span></div>' +
      '<div><b>' + Z.count((S.data.sys_vat || []).length) + '</b><span>' + t('Invoices analysed') + '</span></div></div>';
    var list = A.tests.map(function (x) {
      var extra = x.dist ? benford(x.dist) : x.items.length ? '<details><summary>' + t('Show') + ' ' + Z.count(x.count) + '</summary>' + Z.rowsTable(x.items.slice(0, 200), ['invoice', 'date', 'party', 'vatNo', 'country', 'category', 'net', 'vat', 'reason'].filter(function (c) { return x.items[0][c] !== undefined; })) + '</details>' : '';
      return '<div class="check">' + Z.tick(x.status) + '<div><h3>' + esc(x.id) + ' · ' + esc(Z.tt(x, 'title')) + ' ' + Z.pill(x.severity, t(Z.cap(x.severity))) + '</h3><div class="figs">' + (x.status === 'na' ? '' : '<span>' + t('Items') + ': <b>' + Z.count(x.count) + '</b></span>' + (x.amount ? '<span>' + t('Amount') + ': <b>' + fmt(x.amount) + '</b></span>' : '')) + '</div><p class="faint" style="font-size:12.5px;margin:4px 0 0">' + esc(t(x.desc || '')) + '</p>' + extra + '</div>' +
        '<div class="acts">' + (x.count && !locked() ? '<button class="btn small" data-act="raisea" data-id="' + x.id + '">' + t('Raise finding') + '</button>' : '') + '</div></div>';
    }).join('');
    return tiles + '<section class="paper" style="margin-top:18px"><header><div><h2>' + t('Tests on every invoice') + '</h2><p>' + t('Run over the full system VAT report, not a sample. Flagged items are good candidates for risk-based samples.') + '</p></div></header>' + list + '</section>';
  };
  function benford(dist) {
    var W = 460, H = 150, bw = (W - 30) / 9, max = Math.max.apply(null, dist.map(function (d) { return Math.max(d.actual, d.expected); }));
    var g = dist.map(function (d, i) {
      var x = 20 + i * bw, ha = d.actual / max * (H - 30), he = d.expected / max * (H - 30);
      return '<rect x="' + (x + bw * 0.2) + '" y="' + (H - 18 - ha) + '" width="' + (bw * 0.6) + '" height="' + ha + '" fill="var(--tick)" opacity=".75"><title>' + d.digit + ': ' + d.actual + '% (' + t('expected') + ' ' + d.expected + '%)</title></rect>' +
        '<line x1="' + (x + bw * 0.1) + '" x2="' + (x + bw * 0.9) + '" y1="' + (H - 18 - he) + '" y2="' + (H - 18 - he) + '" stroke="var(--red)" stroke-width="2"/>' +
        '<text x="' + (x + bw / 2) + '" y="' + (H - 4) + '" text-anchor="middle" font-size="11" fill="var(--ink-2)">' + d.digit + '</text>';
    }).join('');
    return '<div class="bench"><svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + t('First-digit distribution against Benford\'s law') + '">' + g + '</svg><p class="faint" style="font-size:12px">' + t('Bars: actual share. Red lines: Benford expectation.') + '</p></div>';
  }
})();
