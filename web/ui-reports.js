/* Reports centre (across entities) and the annual reconciliation (one entity,
   one year). Both read the headline figures each exercise saves in its summary,
   so they need no recomputation; the WHT beneficiary report loads the year's
   WHT registers on demand. */
(function () {
  'use strict';
  var E = window.ZEngine, S = Z.S, t = Z.t, esc = Z.esc, fmt = Z.fmt;

  // ---------------------------------------------------------------- reports centre
  var VAT_RTABS = [['summary', 'VAT summary'], ['portfolio', 'Portfolio readiness'], ['aging', 'Findings aging'], ['exposure', 'Exposure by entity'], ['corrections', 'Corrections register'], ['calendar', 'Filing compliance']];
  var WHT_RTABS = [['summary', 'WHT summary'], ['beneficiaries', 'WHT by beneficiary'], ['portfolio', 'Portfolio readiness'], ['aging', 'Findings aging'], ['exposure', 'Exposure by entity'], ['calendar', 'Filing compliance']];
  // what belongs to the section on screen
  var W = function () { return Z.isWht(); };
  var mineF = function (f) { return (f.tax === 'WHT') === W(); };
  var sc = function (sm) { return Z.taxScore(sm); };
  var expo = function (sm) { sm = sm || {}; return W() ? sm.whtExposure || 0 : sm.vatExposure != null ? sm.vatExposure : sm.exposure || 0; };
  var fails = function (sm) { sm = sm || {}; return W() ? sm.whtFails || 0 : sm.vatFails != null ? sm.vatFails : sm.fails || 0; };

  // ---- the date range every report follows (months, inclusive)
  function nextMonth(p) { var y = +p.slice(0, 4), m = +p.slice(5) + 1; if (m > 12) { y++; m = 1; } return y + '-' + (m < 10 ? '0' : '') + m; }
  function defaultRange() { var to = E.prevPeriod(E.periodOf(Z.today(), 'monthly')), from = to; for (var i = 0; i < 11; i++) from = E.prevPeriod(from); return { from: from, to: to }; }
  function range() {
    if (!S.rf) { try { S.rf = JSON.parse(localStorage.getItem('zr_rf') || 'null'); } catch (e) {} }
    if (!S.rf || !/^\d{4}-\d{2}$/.test(S.rf.from) || !/^\d{4}-\d{2}$/.test(S.rf.to)) S.rf = defaultRange();
    return S.rf;
  }
  function setRange(from, to) {
    if (from > to) { var x = from; from = to; to = x; }
    S.rf = { from: from, to: to };
    try { localStorage.setItem('zr_rf', JSON.stringify(S.rf)); } catch (e) {}
    Z.route();
  }
  function inRange(period) { var r = E.periodRange(period), R = range(); return !!r && r.end.slice(0, 7) >= R.from && r.start.slice(0, 7) <= R.to; }
  Z.reportAsOf = function () { return asOf(); };
  function asOf() { var end = E.periodRange(range().to).end; return end < Z.today() ? end : Z.today(); }
  function exercisesInRange(e) { return S.exercises.filter(function (x) { return (!e || x.entityId === e.id) && inRange(x.period); }); }
  Z.CHG.rfrom = function (el) { if (el.value) setRange(el.value, range().to); };
  Z.CHG.rto = function (el) { if (el.value) setRange(range().from, el.value); };
  Z.ACT.rquick = function (el) {
    var q = el.dataset.q, y = +Z.today().slice(0, 4), cur = E.periodOf(Z.today(), 'monthly');
    if (q === '12m') { var d = defaultRange(); setRange(d.from, d.to); }
    else if (q === 'ytd') setRange(y + '-01', cur);
    else if (q === 'last') setRange((y - 1) + '-01', (y - 1) + '-12');
    else if (q === 'all') setRange(Z.FIRST_YEAR + '-01', cur);
    else if (q === 'q') { var qs = Math.floor((+cur.slice(5) - 1) / 3) * 3 + 1, from = y + '-' + (qs < 10 ? '0' : '') + qs; setRange(from, cur); }
  };
  function rangeBar() {
    var R = range(), n = months12().length;
    return '<section class="paper" style="display:flex;gap:14px;align-items:flex-end;flex-wrap:wrap;margin-bottom:16px">' +
      '<label class="f" style="width:170px"><span>' + t('From') + '</span><input type="month" min="' + Z.FIRST_YEAR + '-01" value="' + R.from + '" data-chg="rfrom"></label>' +
      '<label class="f" style="width:170px"><span>' + t('To') + '</span><input type="month" min="' + Z.FIRST_YEAR + '-01" value="' + R.to + '" data-chg="rto"></label>' +
      '<div class="row">' + [['12m', 'Last 12 months'], ['q', 'This quarter'], ['ytd', 'This year'], ['last', 'Last year'], ['all', 'Since 2018']].map(function (b) { return '<button class="btn small" data-act="rquick" data-q="' + b[0] + '">' + t(b[1]) + '</button>'; }).join('') + '</div>' +
      '<p class="faint" style="margin:0;font-size:12.5px;flex-basis:100%">' + n + ' ' + t('months') + ' · ' + t('findings aged as of') + ' ' + Z.ltr(asOf()) + '</p></section>';
  }

  Z.views.reports = function (h) {
    var RTABS = W() ? WHT_RTABS : VAT_RTABS, tab = h[1] || 'summary';
    if (!RTABS.some(function (x) { return x[0] === tab; })) tab = 'summary';
    var nav = '<nav class="tabs" aria-label="' + t('Reports') + '">' + RTABS.map(function (x) { return '<a href="#/reports/' + x[0] + '"' + (tab === x[0] ? ' aria-current="page"' : '') + '>' + t(x[1]) + '</a>'; }).join('') + '</nav>';
    var head = '<div class="pagehead"><div><p class="eyebrow">' + Z.taxName() + '</p><h1>' + (W() ? t('Withholding tax reports') : t('VAT reports')) + '</h1><p>' + t('Across every entity you can see, for the months you choose. Each report exports to Excel.') + '</p></div><button class="btn" data-act="rexport" data-r="' + tab + '">' + Z.icon('microsoft-excel-logo') + ' ' + t('Export to Excel') + '</button></div>';
    if (tab === 'aging' || tab === 'exposure' || tab === 'corrections') {
      return Z.list('findings').then(function (fs) { fs = fs.filter(mineF); S.allFindings = fs; Z.setMain(head + rangeBar() + nav + (tab === 'aging' ? aging(fs) : tab === 'corrections' ? corrections(fs) : exposure(fs))); });
    }
    if (tab === 'beneficiaries') {
      Z.setMain(head + rangeBar() + nav + '<section class="paper"><p class="muted">' + t('Loading the WHT registers…') + '</p></section>');
      return beneficiaryRows().then(function (rows) { S.benef = rows; Z.setMain(head + rangeBar() + nav + beneficiaries(rows)); });
    }
    Z.setMain(head + rangeBar() + nav + (tab === 'calendar' ? calendar() : tab === 'portfolio' ? portfolio() : summary()));
  };

  function months12() { var out = [], R = range(), cur = R.from; while (cur <= R.to && out.length < 240) { out.push(cur); cur = nextMonth(cur); } return out; }
  function findingsInRange(fs) { var ids = {}; exercisesInRange().forEach(function (x) { ids[x.id] = 1; }); return fs.filter(function (f) { return ids[f.parentId]; }); }

  // ---- tax summary: totals per entity over the range
  function summaryRows() {
    return ents().map(function (e) {
      var xs = exercisesInRange(e).filter(function (x) { return x.summary; }), sum = function (k) { return xs.reduce(function (a, x) { return a + (+x.summary[k] || 0); }, 0); };
      var scored = xs.map(function (x) { return sc(x.summary).score; }).filter(function (v) { return v != null; });
      return { e: e, n: xs.length, sales: sum('sales'), outputVat: sum('outputVat'), inputVat: sum('inputVat'), netVat: sum('netVat'), whtTax: sum('whtTax'), whtGross: sum('whtGross'), lateDays: sum('whtLateDays'),
        exposure: xs.reduce(function (a, x) { return a + expo(x.summary); }, 0), fails: xs.reduce(function (a, x) { return a + fails(x.summary); }, 0),
        avg: scored.length ? Math.round(scored.reduce(function (a, v) { return a + v; }, 0) / scored.length) : null, signed: xs.filter(function (x) { return x.status === 'closed'; }).length };
    });
  }
  function summary() {
    if (W()) return whtSummary();
    var rows = summaryRows(), tot = rows.reduce(function (a, r) { ['n', 'sales', 'outputVat', 'inputVat', 'netVat', 'whtTax', 'exposure', 'fails', 'signed'].forEach(function (k) { a[k] = (a[k] || 0) + r[k]; }); return a; }, {});
    return '<section class="paper flush"><div class="tbl-wrap"><table class="t"><thead><tr><th>' + t('Entity') + '</th><th class="num">' + t('Exercises') + '</th><th class="num">' + t('Signed off') + '</th><th class="num">' + t('Sales (box 6)') + '</th><th class="num">' + t('Output VAT') + '</th><th class="num">' + t('Input VAT') + '</th><th class="num">' + t('Net VAT due') + '</th><th class="num">' + t('Failed checks') + '</th><th class="num">' + t('VAT exposure (SAR)') + '</th><th class="num">' + t('Average readiness') + '</th></tr></thead><tbody>' +
      rows.map(function (r) { return '<tr><td><a href="#/entity/' + r.e.id + '">' + esc(Z.entName(r.e)) + '</a></td><td class="num">' + r.n + '</td><td class="num">' + r.signed + '</td><td class="num">' + fmt(r.sales) + '</td><td class="num">' + fmt(r.outputVat) + '</td><td class="num">' + fmt(r.inputVat) + '</td><td class="num">' + fmt(r.netVat) + '</td><td class="num">' + r.fails + '</td><td class="num">' + fmt(r.exposure) + '</td><td class="num">' + (r.avg == null ? '-' : r.avg + '%') + '</td></tr>'; }).join('') +
      '<tr class="total"><td>' + t('Total') + '</td><td class="num">' + (tot.n || 0) + '</td><td class="num">' + (tot.signed || 0) + '</td><td class="num">' + fmt(tot.sales || 0) + '</td><td class="num">' + fmt(tot.outputVat || 0) + '</td><td class="num">' + fmt(tot.inputVat || 0) + '</td><td class="num">' + fmt(tot.netVat || 0) + '</td><td class="num">' + (tot.fails || 0) + '</td><td class="num">' + fmt(tot.exposure || 0) + '</td><td></td></tr></tbody></table></div></section>' +
      '<p class="faint" style="font-size:12.5px">' + t('Totals come from each exercise\'s saved figures. An exercise counts when its period overlaps the range; quarterly filers count in full.') + '</p>';
  }
  function whtSummary() {
    var rows = summaryRows(), tot = rows.reduce(function (a, r) { ['n', 'signed', 'whtGross', 'whtTax', 'lateDays', 'fails', 'exposure'].forEach(function (k) { a[k] = (a[k] || 0) + r[k]; }); return a; }, {});
    var cells = function (r) { return '<td class="num">' + (r.n || 0) + '</td><td class="num">' + (r.signed || 0) + '</td><td class="num">' + fmt(r.whtGross || 0) + '</td><td class="num">' + fmt(r.whtTax || 0) + '</td><td class="num">' + (r.whtGross ? Z.r((r.whtTax || 0) / r.whtGross * 100) + '%' : '-') + '</td><td class="num">' + (r.lateDays || 0) + '</td><td class="num">' + (r.fails || 0) + '</td><td class="num">' + fmt(r.exposure || 0) + '</td>'; };
    return '<section class="paper flush"><div class="tbl-wrap"><table class="t"><thead><tr><th>' + t('Entity') + '</th><th class="num">' + t('Exercises') + '</th><th class="num">' + t('Signed off') + '</th><th class="num">' + t('Paid to non-residents') + '</th><th class="num">' + t('WHT declared') + '</th><th class="num">' + t('Effective rate') + '</th><th class="num">' + t('Days late, total') + '</th><th class="num">' + t('Failed checks') + '</th><th class="num">' + t('WHT exposure (SAR)') + '</th><th class="num">' + t('Average readiness') + '</th></tr></thead><tbody>' +
      rows.map(function (r) { return '<tr><td><a href="#/entity/' + r.e.id + '">' + esc(Z.entName(r.e)) + '</a></td>' + cells(r) + '<td class="num">' + (r.avg == null ? '-' : r.avg + '%') + '</td></tr>'; }).join('') +
      '<tr class="total"><td>' + t('Total') + '</td>' + cells(tot) + '<td></td></tr></tbody></table></div></section>' +
      '<p class="faint" style="font-size:12.5px">' + t('From the WHT return figures each exercise saved. WHT is monthly; a quarterly VAT exercise carries the three months of WHT inside it.') + '</p>';
  }

  // ---- WHT by beneficiary: every non-resident paid in the range, once
  function beneficiaryRows() {
    var xs = exercisesInRange();
    return Promise.all(xs.map(function (x) { return Z.list('datasets', x.id).then(function (ds) { return ds.filter(function (d) { return d.kind === 'wht_reg'; }); }); })).then(function (lists) {
      var ds = [].concat.apply([], lists);
      return Promise.all(ds.map(function (d) { return Z.get('rows', d.id); })).then(function (rs) {
        var by = {};
        rs.forEach(function (r, i) {
          var x = xs.filter(function (e) { return e.id === ds[i].parentId; })[0] || {};
          E.unpackRows(r).forEach(function (w) {
            if (w.date && (String(w.date).slice(0, 7) < range().from || String(w.date).slice(0, 7) > range().to)) return;
            var k = x.entityId + '|' + String(w.party || '').trim().toLowerCase();
            var b = by[k] = by[k] || { entityId: x.entityId, party: w.party, country: w.country || '', types: {}, n: 0, gross: 0, wht: 0, missingCert: 0, treaty: 0 };
            b.n++; b.gross += +w.gross || 0; b.wht += +w.wht || 0; b.types[w.paymentType || 'other'] = 1;
            if (!w.certificate) b.missingCert++;
            if (w.dtt) b.treaty++;
            if (!b.country && w.country) b.country = w.country;
          });
        });
        return Object.keys(by).map(function (k) { return by[k]; }).sort(function (a, b) { return b.gross - a.gross; });
      });
    });
  }
  function beneficiaries(rows) {
    var tot = rows.reduce(function (a, r) { return { g: a.g + r.gross, w: a.w + r.wht, m: a.m + r.missingCert }; }, { g: 0, w: 0, m: 0 });
    return '<div class="kpis"><div><b>' + rows.length + '</b><span>' + t('Beneficiaries') + '</span></div><div><b>' + fmt(tot.g) + '</b><span>' + t('Paid to non-residents') + '</span></div><div><b>' + fmt(tot.w) + '</b><span>' + t('WHT withheld') + '</span></div><div class="' + (tot.m ? 'bad' : '') + '"><b>' + tot.m + '</b><span>' + t('Payments without a certificate') + '</span></div></div>' +
      '<p class="muted" style="margin-top:12px">' + t('Use it to check certificates and the annual WHT figures; every beneficiary paid during the year appears once.') + '</p>' +
      '<section class="paper flush"><div class="tbl-wrap"><table class="t"><thead><tr><th>' + t('Beneficiary') + '</th><th>' + t('Entity') + '</th><th>' + t('Country') + '</th><th>' + t('Payment types') + '</th><th class="num">' + t('Payments') + '</th><th class="num">' + t('Gross paid') + '</th><th class="num">' + t('WHT') + '</th><th class="num">' + t('Effective rate') + '</th><th class="num">' + t('Treaty relief') + '</th><th class="num">' + t('No certificate') + '</th></tr></thead><tbody>' +
      (rows.map(function (r) { return '<tr><td><b>' + esc(r.party || '-') + '</b></td><td>' + esc(Z.entName(Z.entity(r.entityId))) + '</td><td>' + esc(r.country) + '</td><td style="font-size:12.5px">' + esc(Object.keys(r.types).map(function (k) { var w = E.WHT_TYPES.filter(function (x) { return x[0] === k; })[0]; return w ? (S.lang === 'ar' ? w[2] : w[1]) : k; }).join(', ')) + '</td><td class="num">' + r.n + '</td><td class="num">' + fmt(r.gross) + '</td><td class="num">' + fmt(r.wht) + '</td><td class="num">' + (r.gross ? Z.r(r.wht / r.gross * 100) + '%' : '-') + '</td><td class="num">' + (r.treaty || '') + '</td><td class="num ' + (r.missingCert ? 'diff-bad' : '') + '">' + (r.missingCert || '') + '</td></tr>'; }).join('') || '<tr><td colspan="10" class="empty">' + t('No WHT registers loaded for this range.') + '</td></tr>') + '</tbody></table></div></section>';
  }

  function keyFor(e, m) { return e.vatFreq === 'quarterly' ? m.slice(0, 4) + '-Q' + Math.ceil(+m.slice(5) / 3) : m; }
  function exOf(e, p) { return /Q/.test(p) || p.length !== 7 ? S.exercises.filter(function (x) { return x.entityId === e.id && x.period === p; })[0] : Z.exFor(e, p); }
  function ents() { return S.entities.filter(function (e) { return e.active !== false && (!W() || e.whtRegistered !== false); }); }

  function portfolio() {
    var ms = months12();
    var rows = ents().map(function (e) {
      return '<tr><th scope="row" style="text-align:start"><a href="#/entity/' + e.id + '">' + esc(Z.entName(e)) + '</a></th>' + ms.map(function (m) {
        var x = exOf(e, keyFor(e, m)), s2 = x && sc(x.summary);
        return '<td class="num">' + (s2 && s2.score != null ? Z.pill(s2.grade, s2.score + '%') : '<span class="faint">-</span>') + '</td>';
      }).join('') + '</tr>';
    }).join('');
    return '<section class="paper flush"><div class="tbl-wrap"><table class="t"><thead><tr><th>' + t('Entity') + '</th>' + ms.map(function (m) { return '<th class="num">' + Z.ltr(m) + '</th>'; }).join('') + '</tr></thead><tbody>' + rows + '</tbody></table></div></section>';
  }

  var BUCKETS = [['over90', 'Over 90 days overdue', 'fail'], ['d90', '61-90 days overdue', 'fail'], ['d60', '31-60 days overdue', 'warn'], ['d30', '1-30 days overdue', 'warn'], ['notDue', 'Not yet due', 'pass'], ['noDate', 'No due date', 'na']];
  function exName(id) { var x = S.exercises.filter(function (e) { return e.id === id; })[0]; return x ? Z.entName(Z.entity(x.entityId)) + ' · ' + x.period : ''; }
  function aging(fs) {
    var b = E.aging(findingsInRange(fs), asOf());
    var strip = '<div class="kpis">' + BUCKETS.map(function (k) { return '<div class="' + (k[2] === 'fail' && b[k[0]].length ? 'bad' : '') + '"><b>' + b[k[0]].length + '</b><span>' + t(k[1]) + '</span></div>'; }).join('') + '</div>';
    var rows = [];
    BUCKETS.forEach(function (k) { b[k[0]].forEach(function (f) { rows.push('<tr class="clickable" data-act="gofinding" data-ex="' + f.parentId + '"><td>' + Z.pill(k[2], t(k[1])) + '</td><td>' + Z.pill(f.severity, t(Z.cap(f.severity))) + '</td><td><b>' + esc(f.title) + '</b><div class="faint" style="font-size:12.5px">' + esc(exName(f.parentId)) + '</div></td><td class="num">' + fmt(f.taxImpact) + '</td><td class="num">' + fmt(f.penalty) + '</td><td>' + esc(f.owner || '-') + '</td><td class="nowrap">' + esc(f.due || '') + '</td></tr>'); }); });
    return strip + '<section class="paper flush" style="margin-top:16px"><div class="tbl-wrap"><table class="t"><thead><tr><th>' + t('Age') + '</th><th>' + t('Severity') + '</th><th>' + t('Finding') + '</th><th class="num">' + t('Tax impact') + '</th><th class="num">' + t('Penalty') + '</th><th>' + t('Owner') + '</th><th>' + t('Due') + '</th></tr></thead><tbody>' +
      (rows.join('') || '<tr><td colspan="7" class="empty">' + t('No open findings.') + '</td></tr>') + '</tbody></table></div></section>';
  }
  Z.ACT.gofinding = function (el) { location.hash = '#/ex/' + el.dataset.ex + '/findings'; };

  function corrections(fs) {
    var rows = E.corrections(findingsInRange(fs), S.settingsDoc ? S.settingsDoc.values : {}, Z.today());
    var by = { overdue: 0, open: 0, done: 0 }; rows.forEach(function (r) { by[r.state]++; });
    var pill = function (r) { return Z.pill(r.state === 'done' ? 'pass' : r.state === 'overdue' ? 'fail' : 'warn', t({ done: 'Corrected', overdue: 'Overdue', open: 'Open' }[r.state])); };
    return '<div class="kpis"><div class="' + (by.overdue ? 'bad' : '') + '"><b>' + by.overdue + '</b><span>' + t('Overdue corrections') + '</span></div><div><b>' + by.open + '</b><span>' + t('Open, still in time') + '</span></div><div><b>' + by.done + '</b><span>' + t('Corrected') + '</span></div></div>' +
      '<p class="muted" style="margin-top:12px">' + t('Every VAT finding with a tax impact is an error to correct: at or above the threshold, amend the original return within 20 days of discovery; below it, include it in the return for the period of discovery.') + '</p>' +
      '<section class="paper flush"><div class="tbl-wrap"><table class="t"><thead><tr><th>' + t('Status') + '</th><th>' + t('Finding') + '</th><th class="num">' + t('Tax impact') + '</th><th>' + t('How to correct') + '</th><th>' + t('Discovered') + '</th><th>' + t('Due by') + '</th><th>' + t('Corrected') + '</th></tr></thead><tbody>' +
      (rows.map(function (r) { return '<tr class="clickable" data-act="gofinding" data-ex="' + r.parentId + '"><td>' + pill(r) + '</td><td><b>' + esc(r.title) + '</b><div class="faint" style="font-size:12.5px">' + esc(exName(r.parentId)) + '</div></td><td class="num">' + fmt(r.taxImpact) + '</td><td>' + t(r.route === 'amend' ? 'Amended return' : 'Return for the period of discovery') + '</td><td class="nowrap">' + Z.ltr(r.discoveredOn) + '</td><td class="nowrap">' + Z.ltr(r.dueBy) + (r.state !== 'done' ? ' <span class="' + (r.daysLeft < 0 ? 'diff-bad' : 'faint') + '">(' + r.daysLeft + ')</span>' : '') + '</td><td class="nowrap">' + esc(r.correctedOn || r.correctedPeriod || '') + '</td></tr>'; }).join('') || '<tr><td colspan="7" class="empty">' + t('No VAT findings with a tax impact in this range.') + '</td></tr>') + '</tbody></table></div></section>';
  }

  // ---------------------------------------------------------------- ZATCA requests and assessments
  var QTYPES = [['information', 'Information request'], ['visit', 'Field visit'], ['assessment', 'Assessment'], ['decision', 'Committee decision']];
  Z.views.requests = function () {
    return Z.list('requests').then(function (qs) {
      S.requests = qs;
      var cfg = S.settingsDoc ? S.settingsDoc.values : {};
      var rows = qs.map(function (q) { return Object.assign({}, q, E.requestDue(q, cfg, Z.today())); }).sort(function (a, b) { return (a.state === 'closed') - (b.state === 'closed') || String(a.due || '9').localeCompare(String(b.due || '9')); });
      var pill = function (r) { return Z.pill(r.state === 'closed' ? 'pass' : r.state === 'overdue' ? 'fail' : r.state === 'urgent' ? 'risk' : 'na', t({ closed: 'Closed', overdue: 'Overdue', urgent: 'Due within 7 days', open: 'Open' }[r.state])); };
      Z.setMain('<div class="pagehead"><div><h1>' + t('ZATCA requests and assessments') + '</h1><p>' + t('Every letter from ZATCA with its deadline: information requests, field visits, assessments (60 days to object) and committee decisions (30 days to appeal).') + '</p></div>' +
        (Z.can('preparer') ? '<button class="btn primary" data-act="editreq">' + t('Record a request') + '</button>' : '') + '</div>' +
        '<section class="paper flush"><div class="tbl-wrap"><table class="t"><thead><tr><th>' + t('Status') + '</th><th>' + t('Type') + '</th><th>' + t('Entity') + '</th><th>' + t('Reference') + '</th><th>' + t('Received') + '</th><th>' + t('Deadline') + '</th><th class="num">' + t('Amount') + '</th><th>' + t('Owner') + '</th></tr></thead><tbody>' +
        (rows.map(function (r) { return '<tr class="clickable" data-act="editreq" data-id="' + r.id + '"><td>' + pill(r) + '</td><td>' + esc(t((QTYPES.filter(function (x) { return x[0] === r.type; })[0] || [0, r.type])[1])) + '</td><td>' + esc(Z.entName(Z.entity(r.entityId))) + '</td><td><b>' + esc(r.reference || '') + '</b><div class="faint" style="font-size:12.5px">' + esc(r.items || '') + '</div></td><td class="nowrap">' + Z.ltr(r.receivedOn || '') + '</td><td class="nowrap">' + Z.ltr(r.due || '-') + (r.state !== 'closed' && r.daysLeft != null ? ' <span class="' + (r.daysLeft <= 7 ? 'diff-bad' : 'faint') + '">(' + r.daysLeft + ' ' + t('days') + ')</span>' : '') + '</td><td class="num">' + (r.amount ? fmt(r.amount) : '') + '</td><td>' + esc(r.owner || '') + '</td></tr>'; }).join('') || '<tr><td colspan="8" class="empty">' + t('No requests recorded. When ZATCA writes, record it here so nobody misses the deadline.') + '</td></tr>') + '</tbody></table></div></section>');
    });
  };
  Z.ACT.editreq = function (el) {
    var q = (S.requests || []).filter(function (x) { return x.id === el.dataset.id; })[0] || { type: 'information', status: 'open', entityId: S.entityId, receivedOn: Z.today() };
    S.editQ = q;
    var sel = function (name, cur, opts) { return '<select name="' + name + '">' + opts.map(function (o) { return '<option value="' + o[0] + '"' + (cur === o[0] ? ' selected' : '') + '>' + esc(t(o[1])) + '</option>'; }).join('') + '</select>'; };
    Z.modal(q.id ? q.reference || t('Request') : t('Record a request'), '<form id="qf" class="grid g2">' +
      '<label class="f"><span>' + t('Type') + '</span>' + sel('type', q.type, QTYPES) + '</label>' +
      '<label class="f"><span>' + t('Entity') + '</span>' + sel('entityId', q.entityId, S.entities.map(function (e) { return [e.id, Z.entName(e)]; })) + '</label>' +
      Z.fld('reference', t('ZATCA reference'), q.reference, 'text', 'required') + Z.fld('period', t('Period concerned'), q.period, 'text', 'placeholder="2026-Q3"') +
      Z.fld('receivedOn', t('Received on'), q.receivedOn, 'date', 'required') + Z.fld('dueOn', t('Deadline given by ZATCA'), q.dueOn, 'date', '', t('Leave empty for assessments and decisions: 60 / 30 days are applied.')) +
      Z.fld('amount', t('Amount assessed (SAR)'), q.amount, 'number', 'step="0.01"') + Z.fld('owner', t('Owner'), q.owner, 'text') +
      '<label class="f" style="grid-column:1/-1"><span>' + t('What is requested / assessed') + '</span><textarea name="items">' + esc(q.items || '') + '</textarea></label>' +
      '<label class="f"><span>' + t('Status') + '</span>' + sel('status', q.status, [['open', 'Open'], ['responded', 'Responded'], ['closed', 'Closed']]) + '</label>' + Z.fld('respondedOn', t('Responded on'), q.respondedOn, 'date') + ((q.id && Z.attachHtml && 'requests:' + q.id) ? '<div style="grid-column:1/-1">' + Z.attachHtml((q.id && Z.attachHtml && 'requests:' + q.id), q.entityId) + '</div>' : '') + '</form>',
      (q.id && Z.can('preparer') ? '<button class="btn danger" data-act="delreq" data-id="' + q.id + '">' + t('Delete') + '</button>' : '') + '<button class="btn" data-act="closemodal">' + t('Cancel') + '</button>' + (Z.can('preparer') ? '<button class="btn primary" data-act="savereq">' + t('Save') + '</button>' : ''));
  };
  Z.ACT.savereq = function () {
    var f = document.getElementById('qf'); if (!f.reportValidity()) return;
    var d = Object.assign({}, S.editQ, Object.fromEntries(new FormData(f))); d.amount = d.amount === '' ? null : +d.amount; d.label = d.reference;
    Z.save('requests', d).then(function () { Z.closeModal(); Z.toast(t('Saved')); Z.route(); });
  };
  Z.ACT.delreq = function (el) { if (!confirm(t('Delete this request?'))) return; Z.call('remove', { table: 'requests', id: el.dataset.id }).then(function () { Z.closeModal(); Z.route(); }); };
  // dashboard alert: deadlines within 7 days
  Z.requestAlert = function () {
    var box = document.getElementById('reqalert'); if (!box) return;
    Z.list('requests').then(function (qs) {
      var cfg = S.settingsDoc ? S.settingsDoc.values : {}, hot = qs.map(function (q) { return Object.assign({}, q, E.requestDue(q, cfg, Z.today())); }).filter(function (r) { return r.state === 'urgent' || r.state === 'overdue'; });
      if (!hot.length || !document.getElementById('reqalert')) return;
      box.innerHTML = '<section class="paper alert-bar" role="alert"><i class="ph ph-alarm" aria-hidden="true"></i><div><h3>' + hot.length + ' ' + t('ZATCA deadlines within 7 days or overdue') + '</h3><p class="muted" style="margin:2px 0 0">' + hot.map(function (r) { return esc(r.reference) + ' - ' + Z.ltr(r.due); }).join(' · ') + '</p></div><a class="btn primary" href="#/requests">' + t('Open requests') + '</a></section>';
    }).catch(function () {});
  };

  function exposure(fs) {
    var rows = ents().map(function (e) {
      var xs = exercisesInRange(e).sort(function (a, b) { return a.period < b.period ? 1 : -1; });
      var latest = xs[0], sm = (latest && latest.summary) || {};
      var open = fs.filter(function (f) { return f.status !== 'closed' && xs.some(function (x) { return x.id === f.parentId; }); });
      var tax = open.reduce(function (a, f) { return a + (+f.taxImpact || 0); }, 0), pen = open.reduce(function (a, f) { return a + (+f.penalty || 0); }, 0);
      return { e: e, latest: latest, sm: sm, open: open.length, tax: tax, pen: pen };
    });
    var tot = rows.reduce(function (a, r) { return { q: a.q + expo(r.sm), tax: a.tax + r.tax, pen: a.pen + r.pen }; }, { q: 0, tax: 0, pen: 0 });
    return '<section class="paper flush"><div class="tbl-wrap"><table class="t"><thead><tr><th>' + t('Entity') + '</th><th>' + t('Latest exercise') + '</th><th class="num">' + t('Readiness') + '</th><th class="num">' + (W() ? t('WHT exposure (SAR)') : t('VAT exposure (SAR)')) + '</th><th class="num">' + t('Open findings') + '</th><th class="num">' + t('Tax at stake (SAR)') + '</th><th class="num">' + t('Estimated penalties (SAR)') + '</th></tr></thead><tbody>' +
      rows.map(function (r) { return '<tr><td><a href="#/entity/' + r.e.id + '">' + esc(Z.entName(r.e)) + '</a></td><td>' + (r.latest ? Z.ltr(r.latest.period) : '-') + '</td><td class="num">' + (sc(r.sm).score != null ? Z.pill(sc(r.sm).grade, sc(r.sm).score + '%') : '-') + '</td><td class="num">' + fmt(expo(r.sm)) + '</td><td class="num">' + r.open + '</td><td class="num">' + fmt(r.tax) + '</td><td class="num">' + fmt(r.pen) + '</td></tr>'; }).join('') +
      '<tr class="total"><td colspan="3">' + t('Total') + '</td><td class="num">' + fmt(tot.q) + '</td><td></td><td class="num">' + fmt(tot.tax) + '</td><td class="num">' + fmt(tot.pen) + '</td></tr></tbody></table></div></section>';
  }

  function calendar() {
    var ms = months12();
    var cell = function (x, kind) {
      if (!x) return '<td class="num faint">-</td>';
      var F = x.filing || {}, dl = E.deadlines(x.period), filed = kind === 'vat' ? F.vatFiledOn : F.whtPaidOn || F.whtFiledOn, due = kind === 'vat' ? dl.vat : dl.wht;
      if (!filed) return '<td class="num">' + Z.tick(Z.today() > due ? 'fail' : 'na', t(Z.today() > due ? 'Not recorded and past due' : 'Not yet recorded')) + '</td>';
      var late = E.daysBetween(due, filed);
      return '<td class="num">' + Z.tick(late > 0 ? (kind === 'wht' && late < 30 ? 'warn' : 'fail') : 'pass', late > 0 ? late + ' ' + t('days late') : t('On time')) + '</td>';
    };
    return '<p class="muted">' + (W() ? t('Each mark is one WHT return: on time, late with no fine (under 30 days), or late or missing past the 10th. Dates come from each exercise\'s Filing & payment tab.') : t('Each mark is one VAT return: on time, or late or missing past the deadline. Dates come from each exercise\'s Filing & payment tab.')) + '</p>' +
      '<section class="paper flush"><div class="tbl-wrap"><table class="t"><thead><tr><th>' + t('Entity') + '</th><th>' + t('Return') + '</th>' + ms.map(function (m) { return '<th class="num">' + Z.ltr(m.slice(2)) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      ents().map(function (e) {
        var name = '<td><a href="#/entity/' + e.id + '">' + esc(Z.entName(e)) + '</a></td>';
        if (W()) return '<tr>' + name + '<td>' + t('WHT') + '</td>' + ms.map(function (m) { return cell(S.exercises.filter(function (x) { return x.entityId === e.id && (x.period === m || x.period === keyFor(e, m) && +m.slice(5) % 3 === 0); })[0], 'wht'); }).join('') + '</tr>';
        return '<tr>' + name + '<td>' + t('VAT') + '</td>' + ms.map(function (m) {
          var k = keyFor(e, m); if (e.vatFreq === 'quarterly' && +m.slice(5) % 3 !== 0) return '<td class="num faint">·</td>'; return cell(exOf(e, k), 'vat');
        }).join('') + '</tr>';
      }).join('') + '</tbody></table></div></section>';
  }

  Z.ACT.rexport = function (el) {
    var wb = XLSX.utils.book_new(), add = function (n, aoa) { XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), n); }, ms = months12(), r = el.dataset.r;
    if (r === 'portfolio') add('Portfolio', [['Entity'].concat(ms)].concat(ents().map(function (e) { return [e.name].concat(ms.map(function (m) { var x = exOf(e, keyFor(e, m)), v = x && sc(x.summary).score; return v == null ? '' : v; })); })));
    if (r === 'summary' && W()) add('WHT summary', [['Range', range().from + ' to ' + range().to], [], ['Entity', 'Exercises', 'Signed off', 'Paid to non-residents', 'WHT declared', 'Days late', 'Failed checks', 'WHT exposure', 'Average readiness']].concat(summaryRows().map(function (x) { return [x.e.name, x.n, x.signed, x.whtGross, x.whtTax, x.lateDays, x.fails, x.exposure, x.avg]; })));
    if (r === 'beneficiaries') add('WHT by beneficiary', [['Range', range().from + ' to ' + range().to], [], ['Beneficiary', 'Entity', 'Country', 'Payment types', 'Payments', 'Gross paid', 'WHT', 'Treaty relief', 'No certificate']].concat((S.benef || []).map(function (b) { return [b.party, (Z.entity(b.entityId) || {}).name, b.country, Object.keys(b.types).join(', '), b.n, E.r2(b.gross), E.r2(b.wht), b.treaty, b.missingCert]; })));
    if (r === 'summary' && !W()) add('VAT summary', [['Range', range().from + ' to ' + range().to], [], ['Entity', 'Exercises', 'Signed off', 'Sales', 'Output VAT', 'Input VAT', 'Net VAT', 'Failed checks', 'VAT exposure', 'Average readiness']].concat(summaryRows().map(function (x) { return [x.e.name, x.n, x.signed, x.sales, x.outputVat, x.inputVat, x.netVat, x.fails, x.exposure, x.avg]; })));
    if (r === 'aging') { var b = E.aging(findingsInRange(S.allFindings || []), asOf()), rows = [['Bucket', 'Severity', 'Finding', 'Exercise', 'Tax impact', 'Penalty', 'Owner', 'Due', 'Days overdue']]; BUCKETS.forEach(function (k) { b[k[0]].forEach(function (f) { rows.push([k[1], f.severity, f.title, exName(f.parentId), f.taxImpact, f.penalty, f.owner, f.due, f.overdue || '']); }); }); add('Findings aging', rows); }
    if (r === 'exposure') add('Exposure', [['Entity', 'Latest period', 'Readiness', 'Quantified exposure', 'Open findings']].concat(ents().map(function (e) { var x = exercisesInRange(e).sort(function (a, b) { return a.period < b.period ? 1 : -1; })[0]; var sm = (x && x.summary) || {}; return [e.name, x ? x.period : '', sc(sm).score, expo(sm), (S.allFindings || []).filter(function (f) { return f.status !== 'closed' && x && f.parentId === x.id; }).length]; })));
    if (r === 'calendar') add('Filing', [['Entity', 'Period'].concat(W() ? ['WHT due', 'WHT filed', 'WHT paid'] : ['VAT due', 'VAT filed', 'VAT paid'])].concat(exercisesInRange().map(function (x) { var F = x.filing || {}, dl = E.deadlines(x.period), e = Z.entity(x.entityId) || {}; return [e.name, x.period].concat(W() ? [dl.wht, F.whtFiledOn || '', F.whtPaidOn || ''] : [dl.vat, F.vatFiledOn || '', F.vatPaidOn || '']); })));
    XLSX.writeFile(wb, (W() ? 'wht' : 'vat') + '-report-' + r + '-' + range().from + '-to-' + range().to + '.xlsx');
  };

  // ---------------------------------------------------------------- annual reconciliation
  Z.views.annual = function (h) {
    var e = Z.entity(h[1]), year = +h[2] || +Z.today().slice(0, 4);
    if (!e) return Z.setMain('<div class="empty"><h2>' + t('Entity not found') + '</h2></div>');
    var id = e.id + '_' + year;
    return Z.get('annual', id).then(function (doc) {
      S.annual = doc || { id: id, entityId: e.id, year: year, items: [] };
      S.annual.items = S.annual.items || [];
      renderAnnual(e, year);
    });
  };
  // only periods that have already ended can be "missing"
  function closedPeriods(e, year) { return E.periodsOfYear(year, e.vatFreq || 'monthly').filter(function (p) { return E.periodRange(p).end < Z.today(); }); }
  function annualRows(e, year) {
    return E.periodsOfYear(year, e.vatFreq || 'monthly').map(function (p) { var x = exOf(e, p); return x && x.summary ? Object.assign({ period: p, exId: x.id, status: x.status }, x.summary) : null; }).filter(Boolean);
  }
  function renderAnnual(e, year) {
    var A = S.annual, rows = annualRows(e, year), expected = closedPeriods(e, year);
    var rec = E.annualRecon(rows, A, S.settingsDoc ? S.settingsDoc.values : {}, expected), can = Z.can('preparer');
    var f = function (k, label, hint) { return Z.fld(k, label, A[k], 'number', 'step="0.01" data-chg="annual" data-f="' + k + '"' + (can ? '' : ' disabled'), hint); };
    var years = []; for (var y = +Z.today().slice(0, 4); y >= Z.FIRST_YEAR; y--) years.push(y);
    Z.setMain('<div class="pagehead"><div><p class="muted" style="margin:0"><a href="#/entity/' + e.id + '">' + esc(Z.entName(e)) + '</a></p><h1>' + t('Annual reconciliation') + ' ' + year + '</h1><p>' + t('ZATCA cross-checks a year of VAT returns against the audited financial statements and the Zakat / income tax return. Differences need a documented explanation.') + '</p></div>' +
      '<div class="row"><select data-chg="annyear" data-e="' + e.id + '" aria-label="' + t('Year') + '" style="width:auto">' + years.map(function (y) { return '<option' + (y === year ? ' selected' : '') + '>' + y + '</option>'; }).join('') + '</select><button class="btn" data-act="annxl" data-e="' + e.id + '" data-y="' + year + '">' + t('Export to Excel') + '</button></div></div>' +
      '<div class="stack"><section class="paper area-vat"><header><div><h2>' + t('Reconciliation') + '</h2><p>' + (rec.missing.length ? '<span class="diff-bad">' + rec.missing.length + ' ' + t('periods have no exercise yet:') + '</span> ' + rec.missing.map(function (p) { return Z.ltr(p); }).join(', ') : t('Every period of the year has an exercise.')) + '</p></div>' + Z.pill(rec.status, rec.status === 'pass' ? t('Reconciled') : rec.status === 'na' ? t('No data') : t('Differences to explain')) + '</header>' +
      '<div class="tbl-wrap"><table class="t"><thead><tr><th></th><th>' + t('Check') + '</th><th class="num">' + t('Per VAT returns') + '</th><th class="num">' + t('Other source') + '</th><th class="num">' + t('Difference') + '</th></tr></thead><tbody>' +
      rec.lines.map(function (l) { return '<tr><td>' + Z.tick(l.status) + '</td><td>' + esc(S.lang === 'ar' ? l.labelAr : l.label) + '<div class="faint" style="font-size:12px">' + esc(t(l.bLabel)) + '</div></td><td class="num">' + fmt(l.a) + '</td><td class="num">' + (l.b == null ? '<span class="faint">' + t('enter below') + '</span>' : fmt(l.b)) + '</td><td class="num ' + (l.status === 'fail' ? 'diff-bad' : l.status === 'warn' ? 'diff-warn' : 'faint') + '">' + (l.diff == null ? '' : fmt(l.diff)) + '</td></tr>'; }).join('') + '</tbody></table></div>' +
      (rec.explained ? '<p class="faint" style="font-size:12.5px">' + t('Sales per returns include explained reconciling items of') + ' ' + fmt(rec.explained) + '</p>' : '') + '</section>' +
      '<section class="paper"><h2 style="margin-bottom:12px">' + t('Annual figures from outside the returns') + '</h2><div class="grid g3">' +
      f('fsRevenue', t('Revenue per audited financial statements')) + f('zakatRevenue', t('Revenue per Zakat / income tax return')) + f('glOutputVat', t('Output VAT per GL for the year')) + f('glInputVat', t('Input VAT per GL for the year')) + f('whtAnnual', t('WHT per annual statement / GL')) + '</div>' +
      '<h3 style="margin:16px 0 6px">' + t('Reconciling items (revenue not in VAT returns, or returns not in revenue)') + '</h3><table class="t"><tbody>' +
      A.items.map(function (i) { return '<tr><td>' + esc(i.description) + '</td><td class="num">' + fmt(i.amount) + '</td><td>' + (can ? '<a href="#" data-act="anndel" data-id="' + i.id + '">' + t('Remove') + '</a>' : '') + '</td></tr>'; }).join('') +
      (can ? '<tr><td><input type="text" id="ai-d" aria-label="' + esc(t('Description')) + '" placeholder="' + esc(t('e.g. Out-of-scope income, unbilled revenue, FX gains')) + '"></td><td style="width:160px"><input type="number" step="0.01" id="ai-a" aria-label="' + esc(t('Amount')) + '"></td><td><button class="btn small" data-act="annadd">' + t('Add') + '</button></td></tr>' : '') + '</tbody></table></section>' +
      '<section class="paper flush"><div style="padding:14px 18px" class="spread"><h2>' + t('Period by period') + '</h2><button class="btn small" data-act="whtbenef" data-e="' + e.id + '" data-y="' + year + '"' + (e.whtRegistered === false ? ' disabled' : '') + '>' + t('WHT by beneficiary for the year') + '</button></div><div class="tbl-wrap"><table class="t"><thead><tr><th>' + t('Period') + '</th><th class="num">' + t('Sales (box 6)') + '</th><th class="num">' + t('Output VAT') + '</th><th class="num">' + t('Input VAT') + '</th><th class="num">' + t('Net VAT due') + '</th><th class="num">' + t('WHT') + '</th><th>' + t('Readiness') + '</th></tr></thead><tbody>' +
      rows.map(function (r) { return '<tr class="clickable" data-act="openex" data-id="' + r.exId + '"><td>' + Z.ltr(r.period) + '</td><td class="num">' + fmt(r.sales) + '</td><td class="num">' + fmt(r.outputVat) + '</td><td class="num">' + fmt(r.inputVat) + '</td><td class="num">' + fmt(r.netVat) + '</td><td class="num">' + fmt(r.whtTax) + '</td><td>' + (r.score != null ? Z.pill(r.grade, r.score + '%') : '') + '</td></tr>'; }).join('') +
      '<tr class="total"><td>' + t('Total') + '</td><td class="num">' + fmt(rec.totals.sales) + '</td><td class="num">' + fmt(rec.totals.outputVat) + '</td><td class="num">' + fmt(rec.totals.inputVat) + '</td><td class="num">' + fmt(rec.totals.netVat) + '</td><td class="num">' + fmt(rec.totals.whtTax) + '</td><td></td></tr></tbody></table></div></section>' +
      zakatSection(e) +
      '<div id="benef"></div></div>');
  }

  // Zakat worksheet: the preparer classifies the balances, the engine does the
  // arithmetic and applies the two hard rules (base ≥ adjusted net profit; rate).
  var ZF = [
    ['add', 'capital', 'Paid-up capital'], ['add', 'reserves', 'Statutory and other reserves'], ['add', 'retainedEarnings', 'Retained earnings (opening)'],
    ['add', 'provisions', 'Provisions (opening, not deducted)'], ['add', 'longTermFinancing', 'Long-term loans and financing'], ['add', 'otherAdditions', 'Other additions'],
    ['add', 'adjustedNetProfit', 'Adjusted net profit for the year'],
    ['ded', 'netFixedAssets', 'Net fixed assets'], ['ded', 'longTermInvestments', 'Long-term investments'], ['ded', 'accumulatedLosses', 'Accumulated losses'], ['ded', 'otherDeductions', 'Other deductions']
  ];
  function zakatSection(e) {
    var z = S.annual.zakat || {}, can = Z.can('preparer'), dis = can ? '' : ' disabled';
    var res = E.zakat(Object.assign({ today: Z.today() }, z), S.settingsDoc ? S.settingsDoc.values : {});
    var zm = S.annual.zakatMap || {};
    var f = function (row) {
      return '<div class="grid" style="grid-template-columns:minmax(0,2fr) minmax(0,1fr);gap:8px;align-items:end">' + Z.fld('z_' + row[1], t(row[2]), z[row[1]], 'number', 'step="0.01" data-chg="zak" data-f="' + row[1] + '"' + dis) +
        (row[1] === 'adjustedNetProfit' ? '<span></span>' : Z.fld('zm_' + row[1], t('TB accounts'), zm[row[1]], 'text', 'placeholder="31*" data-chg="zmap" data-f="' + row[1] + '"' + dis)) + '</div>';
    };
    return '<section class="paper area-ledger"><header><div><h2>' + t('Zakat worksheet') + ' ' + S.annual.year + '</h2><p>' + t('Classify each balance as your Zakat adviser does; the worksheet adds them up, applies the floor of adjusted net profit and the rate for the length of the year.') + '</p></div></header>' +
      '<div class="grid g2"><div><h3 style="margin-bottom:8px">' + t('Additions') + '</h3><div class="grid">' + ZF.filter(function (r) { return r[0] === 'add'; }).map(f).join('') + '</div></div>' +
      '<div><h3 style="margin-bottom:8px">' + t('Deductions') + '</h3><div class="grid">' + ZF.filter(function (r) { return r[0] === 'ded'; }).map(f).join('') + '</div>' +
      '<h3 style="margin:16px 0 8px">' + t('Return') + '</h3><div class="grid g2">' +
      '<label class="f"><span>' + t('Financial year') + '</span><select data-chg="zak" data-f="yearType"' + dis + '><option value="gregorian"' + (z.yearType !== 'hijri' ? ' selected' : '') + '>' + t('Gregorian (365 days)') + '</option><option value="hijri"' + (z.yearType === 'hijri' ? ' selected' : '') + '>' + t('Hijri (354 days)') + '</option></select></label>' +
      Z.fld('z_fyEnd', t('Year end'), z.fyEnd, 'date', 'data-chg="zak" data-f="fyEnd"' + dis) + Z.fld('z_filedOn', t('Filed and paid on'), z.filedOn, 'date', 'data-chg="zak" data-f="filedOn"' + dis) +
      Z.fld('z_declared', t('Zakat declared in the return'), z.declared, 'number', 'step="0.01" data-chg="zak" data-f="declared"' + dis) + '</div></div></div>' +
      (can ? '<div class="row" style="margin-top:12px"><button class="btn" data-act="zakfill" data-e="' + e.id + '">' + t('Fill from trial balance') + '</button><span class="faint" style="font-size:12.5px">' + t('Uses the TB of the last exercise of the year. Adjusted net profit stays manual: it needs your tax adjustments.') + '</span></div>' : '') +
      '<div class="kpis" style="margin-top:16px"><div data-drill="zk:base"><b>' + fmt(res.base) + '</b><span>' + t('Computed Zakat base') + '</span></div><div data-drill="zk:used"><b>' + fmt(res.baseUsed) + '</b><span>' + t('Base used (not below adjusted net profit)') + '</span></div>' +
      '<div data-drill="zk:rate"><b>' + Z.r(res.rate * 100) + '%</b><span>' + t('Rate applied') + '</span></div><div data-drill="zk:due"><b>' + fmt(res.zakat) + '</b><span>' + t('Zakat due (SAR)') + '</span></div>' + (res.dueDate ? '<div data-drill="zk:when"><b>' + Z.ltr(res.dueDate) + '</b><span>' + t('Return due') + '</span></div>' : '') + '</div>' +
      '<div style="margin-top:12px">' + res.checks.map(function (c) { return '<div class="row" style="flex-wrap:nowrap;padding:7px 0;border-top:1px solid var(--rule-2)">' + Z.tick(c.status) + '<span style="flex:1">' + esc(c.id) + ' · ' + esc(Z.tt(c, 'title')) + (c.note ? '<span class="faint" style="display:block;font-size:12.5px">' + esc(t(c.note)) + '</span>' : '') + '</span>' + (c.diff != null && c.bLabel ? '<b class="num ' + (c.status === 'fail' ? 'diff-bad' : '') + '">' + fmt(c.diff) + '</b>' : '') + '</div>'; }).join('') + '</div></section>';
  }
  Z.CHG.zmap = function (el) { S.annual.zakatMap = S.annual.zakatMap || {}; S.annual.zakatMap[el.dataset.f] = el.value.trim(); saveAnnual(); };
  Z.ACT.zakfill = function (el) {
    var e = Z.entity(el.dataset.e), year = String(S.annual.year), map = S.annual.zakatMap || {};
    if (!Object.keys(map).some(function (k) { return map[k]; })) return Z.toast(t('Enter the TB accounts for at least one line first.'), true);
    var ex = S.exercises.filter(function (x) { return x.entityId === e.id && String(x.period).slice(0, 4) === year; }).sort(function (a, b) { return a.period < b.period ? 1 : -1; })[0];
    if (!ex) return Z.toast(t('No exercise in this year has a trial balance. Start one for the last period of the year.'), true);
    Z.list('datasets', ex.id).then(function (ds) {
      var tbs = ds.filter(function (d) { return d.kind === 'tb'; });
      if (!tbs.length) throw new Error(t('The exercise for') + ' ' + ex.period + ' ' + t('has no trial balance loaded.'));
      return Promise.all(tbs.map(function (d) { return Z.get('rows', d.id); })).then(function (docs) {
        var rows = [];
        docs.forEach(function (doc) { (doc && doc.data || []).forEach(function (a) { var o = {}; doc.cols.forEach(function (c, i) { o[c] = a[i]; }); rows.push(o); }); });
        var vals = E.zakatFromTb(rows, map);
        S.annual.zakat = Object.assign(S.annual.zakat || {}, vals);
        Z.toast(t('Filled from the trial balance of') + ' ' + ex.period);
        return saveAnnual();
      });
    }).catch(function (err) { Z.toast(err.message, true); });
  };
  Z.CHG.zak = function (el) {
    S.annual.zakat = S.annual.zakat || {};
    var f = el.dataset.f; S.annual.zakat[f] = /yearType|fyEnd|filedOn/.test(f) ? el.value : (el.value === '' ? null : +el.value);
    saveAnnual();
  };
  function saveAnnual() { return Z.save('annual', S.annual).then(function (d) { S.annual = d; S.annual.items = S.annual.items || []; renderAnnual(Z.entity(d.entityId), d.year); }); }
  Z.CHG.annual = function (el) { S.annual[el.dataset.f] = el.value === '' ? null : +el.value; saveAnnual(); };
  Z.CHG.annyear = function (el) { location.hash = '#/annual/' + el.dataset.e + '/' + el.value; };
  Z.ACT.annadd = function () {
    var d = document.getElementById('ai-d').value.trim(), a = +document.getElementById('ai-a').value;
    if (!d || !a) return Z.toast(t('Enter a description and an amount.'), true);
    S.annual.items.push({ id: Z.uid('AI'), description: d, amount: a }); saveAnnual();
  };
  Z.ACT.anndel = function (el) { S.annual.items = S.annual.items.filter(function (i) { return i.id !== el.dataset.id; }); saveAnnual(); };

  // WHT by beneficiary: loads every WHT register of the year
  function loadWhtYear(e, year) {
    var exs = S.exercises.filter(function (x) { return x.entityId === e.id && String(x.period).slice(0, 4) === String(year); });
    return Promise.all(exs.map(function (x) { return Z.list('datasets', x.id); })).then(function (lists) {
      var ds = [].concat.apply([], lists).filter(function (d) { return d.kind === 'wht_reg'; });
      return Promise.all(ds.map(function (d) { return Z.get('rows', d.id); }));
    }).then(function (docs) {
      var rows = [];
      docs.forEach(function (doc) { if (!doc) return; (doc.data || []).forEach(function (a) { var o = {}; doc.cols.forEach(function (c, i) { o[c] = a[i]; }); rows.push(o); }); });
      var by = {};
      rows.forEach(function (r) {
        var k = String(r.party || '-');
        var b = by[k] = by[k] || { party: k, country: r.country, types: {}, count: 0, gross: 0, wht: 0, noCert: 0 };
        b.count++; b.gross += +r.gross || 0; b.wht += +r.wht || 0; b.types[r.paymentType] = 1; if (!r.certificate) b.noCert++;
      });
      return Object.keys(by).map(function (k) { return by[k]; }).sort(function (a, b) { return b.wht - a.wht; });
    });
  }
  Z.ACT.whtbenef = function (el) {
    var e = Z.entity(el.dataset.e), year = +el.dataset.y, box = document.getElementById('benef');
    box.innerHTML = '<div class="paper faint">' + t('Loading…') + '</div>';
    loadWhtYear(e, year).then(function (list) {
      S.benef = list;
      box.innerHTML = '<section class="paper flush"><div style="padding:14px 18px"><h2>' + t('WHT by beneficiary') + ' ' + year + '</h2><p class="muted">' + t('Use it to check certificates and the annual WHT figures; every beneficiary paid during the year appears once.') + '</p></div><div class="tbl-wrap"><table class="t"><thead><tr><th>' + t('Beneficiary') + '</th><th>' + t('Country') + '</th><th>' + t('Payment type') + '</th><th class="num">' + t('Payments') + '</th><th class="num">' + t('Gross') + '</th><th class="num">' + t('WHT') + '</th><th class="num">' + t('Without certificate') + '</th></tr></thead><tbody>' +
        (list.map(function (b) { return '<tr' + (b.noCert ? ' class="bad"' : '') + '><td>' + esc(b.party) + '</td><td>' + esc(b.country || '') + '</td><td>' + esc(Object.keys(b.types).map(function (k) { var w = E.WHT_TYPES.filter(function (x) { return x[0] === k; })[0]; return w ? (S.lang === 'ar' ? w[2] : w[1]) : k; }).join(', ')) + '</td><td class="num">' + b.count + '</td><td class="num">' + fmt(b.gross) + '</td><td class="num">' + fmt(b.wht) + '</td><td class="num">' + (b.noCert || '') + '</td></tr>'; }).join('') || '<tr><td colspan="7" class="empty">' + t('No WHT registers loaded for this year.') + '</td></tr>') + '</tbody></table></div></section>';
    });
  };
  Z.ACT.annxl = function (el) {
    var e = Z.entity(el.dataset.e), year = +el.dataset.y, rows = annualRows(e, year), rec = E.annualRecon(rows, S.annual, S.settingsDoc ? S.settingsDoc.values : {}, closedPeriods(e, year));
    var wb = XLSX.utils.book_new(), add = function (n, aoa) { XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), n); };
    add('Reconciliation', [['Check', 'Per VAT returns', 'Other source', 'Value', 'Difference', 'Status']].concat(rec.lines.map(function (l) { return [l.label, l.a, l.bLabel, l.b, l.diff, l.status]; })).concat([[], ['Missing periods', rec.missing.join(', ')]]).concat((S.annual.items || []).map(function (i) { return ['Reconciling item: ' + i.description, i.amount]; })));
    add('Periods', [['Period', 'Sales', 'Output VAT', 'Input VAT', 'Net VAT', 'WHT', 'Readiness']].concat(rows.map(function (r) { return [r.period, r.sales, r.outputVat, r.inputVat, r.netVat, r.whtTax, r.score]; })));
    if (S.benef) add('WHT beneficiaries', [['Beneficiary', 'Country', 'Payments', 'Gross', 'WHT', 'Without certificate']].concat(S.benef.map(function (b) { return [b.party, b.country, b.count, b.gross, b.wht, b.noCert]; })));
    XLSX.writeFile(wb, 'annual-reconciliation-' + e.name.replace(/\W+/g, '-') + '-' + year + '.xlsx');
  };
})();
// the dashboard shows ZATCA deadlines that are close
(function () { var dash = Z.views.dashboard; Z.views.dashboard = function (h) { var r = dash(h); setTimeout(Z.requestAlert, 0); return r; }; })();
