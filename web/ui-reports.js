/* Reports centre (across entities) and the annual reconciliation (one entity,
   one year). Both read the headline figures each exercise saves in its summary,
   so they need no recomputation; the WHT beneficiary report loads the year's
   WHT registers on demand. */
(function () {
  'use strict';
  var E = window.ZEngine, S = Z.S, t = Z.t, esc = Z.esc, fmt = Z.fmt;

  // ---------------------------------------------------------------- reports centre
  var RTABS = [['portfolio', 'Portfolio readiness'], ['aging', 'Findings aging'], ['exposure', 'Exposure by entity'], ['calendar', 'Filing compliance']];

  Z.views.reports = function (h) {
    var tab = h[1] || 'portfolio';
    var nav = '<nav class="tabs" aria-label="' + t('Reports') + '">' + RTABS.map(function (x) { return '<a href="#/reports/' + x[0] + '"' + (tab === x[0] ? ' aria-current="page"' : '') + '>' + t(x[1]) + '</a>'; }).join('') + '</nav>';
    var head = '<div class="pagehead"><div><h1>' + t('Reports') + '</h1><p>' + t('Across every entity you can see. Each report exports to Excel.') + '</p></div><button class="btn" data-act="rexport" data-r="' + tab + '">' + t('Export to Excel') + '</button></div>';
    if (tab === 'aging' || tab === 'exposure') {
      return Z.list('findings').then(function (fs) { S.allFindings = fs; Z.setMain(head + nav + (tab === 'aging' ? aging(fs) : exposure(fs))); });
    }
    Z.setMain(head + nav + (tab === 'calendar' ? calendar() : portfolio()));
  };

  function months12() { var out = [], cur = E.periodOf(Z.today(), 'monthly'); for (var i = 0; i < 12; i++) { cur = E.prevPeriod(cur); out.unshift(cur); } return out; }
  function keyFor(e, m) { return e.vatFreq === 'quarterly' ? m.slice(0, 4) + '-Q' + Math.ceil(+m.slice(5) / 3) : m; }
  function exOf(e, p) { return S.exercises.filter(function (x) { return x.entityId === e.id && x.period === p; })[0]; }
  function ents() { return S.entities.filter(function (e) { return e.active !== false; }); }

  function portfolio() {
    var ms = months12();
    var rows = ents().map(function (e) {
      return '<tr><th scope="row" style="text-align:start"><a href="#/entity/' + e.id + '">' + esc(Z.entName(e)) + '</a></th>' + ms.map(function (m) {
        var x = exOf(e, keyFor(e, m)), sm = x && x.summary;
        return '<td class="num">' + (sm && sm.score != null ? Z.pill(sm.grade, sm.score + '%') : '<span class="faint">—</span>') + '</td>';
      }).join('') + '</tr>';
    }).join('');
    return '<section class="paper flush"><div class="tbl-wrap"><table class="t"><thead><tr><th>' + t('Entity') + '</th>' + ms.map(function (m) { return '<th class="num">' + Z.ltr(m) + '</th>'; }).join('') + '</tr></thead><tbody>' + rows + '</tbody></table></div></section>';
  }

  var BUCKETS = [['over90', 'Over 90 days overdue', 'fail'], ['d90', '61–90 days overdue', 'fail'], ['d60', '31–60 days overdue', 'warn'], ['d30', '1–30 days overdue', 'warn'], ['notDue', 'Not yet due', 'pass'], ['noDate', 'No due date', 'na']];
  function exName(id) { var x = S.exercises.filter(function (e) { return e.id === id; })[0]; return x ? Z.entName(Z.entity(x.entityId)) + ' · ' + x.period : ''; }
  function aging(fs) {
    var b = E.aging(fs, Z.today());
    var strip = '<div class="kpis">' + BUCKETS.map(function (k) { return '<div class="' + (k[2] === 'fail' && b[k[0]].length ? 'bad' : '') + '"><b>' + b[k[0]].length + '</b><span>' + t(k[1]) + '</span></div>'; }).join('') + '</div>';
    var rows = [];
    BUCKETS.forEach(function (k) { b[k[0]].forEach(function (f) { rows.push('<tr class="clickable" data-act="gofinding" data-ex="' + f.parentId + '"><td>' + Z.pill(k[2], t(k[1])) + '</td><td>' + Z.pill(f.severity, t(Z.cap(f.severity))) + '</td><td><b>' + esc(f.title) + '</b><div class="faint" style="font-size:12.5px">' + esc(exName(f.parentId)) + '</div></td><td class="num">' + fmt(f.taxImpact) + '</td><td class="num">' + fmt(f.penalty) + '</td><td>' + esc(f.owner || '—') + '</td><td class="nowrap">' + esc(f.due || '') + '</td></tr>'); }); });
    return strip + '<section class="paper flush" style="margin-top:16px"><div class="tbl-wrap"><table class="t"><thead><tr><th>' + t('Age') + '</th><th>' + t('Severity') + '</th><th>' + t('Finding') + '</th><th class="num">' + t('Tax impact') + '</th><th class="num">' + t('Penalty') + '</th><th>' + t('Owner') + '</th><th>' + t('Due') + '</th></tr></thead><tbody>' +
      (rows.join('') || '<tr><td colspan="7" class="empty">' + t('No open findings.') + '</td></tr>') + '</tbody></table></div></section>';
  }
  Z.ACT.gofinding = function (el) { location.hash = '#/ex/' + el.dataset.ex + '/findings'; };

  function exposure(fs) {
    var rows = ents().map(function (e) {
      var xs = S.exercises.filter(function (x) { return x.entityId === e.id; }).sort(function (a, b) { return a.period < b.period ? 1 : -1; });
      var latest = xs[0], sm = (latest && latest.summary) || {};
      var open = fs.filter(function (f) { return f.status !== 'closed' && xs.some(function (x) { return x.id === f.parentId; }); });
      var tax = open.reduce(function (a, f) { return a + (+f.taxImpact || 0); }, 0), pen = open.reduce(function (a, f) { return a + (+f.penalty || 0); }, 0);
      return { e: e, latest: latest, sm: sm, open: open.length, tax: tax, pen: pen };
    });
    var tot = rows.reduce(function (a, r) { return { q: a.q + (r.sm.exposure || 0), tax: a.tax + r.tax, pen: a.pen + r.pen }; }, { q: 0, tax: 0, pen: 0 });
    return '<section class="paper flush"><div class="tbl-wrap"><table class="t"><thead><tr><th>' + t('Entity') + '</th><th>' + t('Latest exercise') + '</th><th class="num">' + t('Readiness') + '</th><th class="num">' + t('Quantified exposure (SAR)') + '</th><th class="num">' + t('Open findings') + '</th><th class="num">' + t('Tax at stake (SAR)') + '</th><th class="num">' + t('Estimated penalties (SAR)') + '</th></tr></thead><tbody>' +
      rows.map(function (r) { return '<tr><td><a href="#/entity/' + r.e.id + '">' + esc(Z.entName(r.e)) + '</a></td><td>' + (r.latest ? Z.ltr(r.latest.period) : '—') + '</td><td class="num">' + (r.sm.score != null ? Z.pill(r.sm.grade, r.sm.score + '%') : '—') + '</td><td class="num">' + fmt(r.sm.exposure || 0) + '</td><td class="num">' + r.open + '</td><td class="num">' + fmt(r.tax) + '</td><td class="num">' + fmt(r.pen) + '</td></tr>'; }).join('') +
      '<tr class="total"><td colspan="3">' + t('Total') + '</td><td class="num">' + fmt(tot.q) + '</td><td></td><td class="num">' + fmt(tot.tax) + '</td><td class="num">' + fmt(tot.pen) + '</td></tr></tbody></table></div></section>';
  }

  function calendar() {
    var ms = months12();
    var cell = function (x, kind) {
      if (!x) return '<td class="num faint">—</td>';
      var F = x.filing || {}, dl = E.deadlines(x.period), filed = kind === 'vat' ? F.vatFiledOn : F.whtPaidOn || F.whtFiledOn, due = kind === 'vat' ? dl.vat : dl.wht;
      if (!filed) return '<td class="num">' + Z.tick(Z.today() > due ? 'fail' : 'na', t(Z.today() > due ? 'Not recorded and past due' : 'Not yet recorded')) + '</td>';
      var late = E.daysBetween(due, filed);
      return '<td class="num">' + Z.tick(late > 0 ? (kind === 'wht' && late < 30 ? 'warn' : 'fail') : 'pass', late > 0 ? late + ' ' + t('days late') : t('On time')) + '</td>';
    };
    return '<p class="muted">' + t('Each mark is one return: ✓ on time, ! late with no fine (WHT under 30 days), ✕ late or missing past the deadline. Dates come from each exercise\'s Filing & payment tab.') + '</p>' +
      '<section class="paper flush"><div class="tbl-wrap"><table class="t"><thead><tr><th>' + t('Entity') + '</th><th>' + t('Return') + '</th>' + ms.map(function (m) { return '<th class="num">' + Z.ltr(m.slice(2)) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      ents().map(function (e) {
        var vat = '<tr><td rowspan="' + (e.whtRegistered === false ? 1 : 2) + '"><a href="#/entity/' + e.id + '">' + esc(Z.entName(e)) + '</a></td><td>' + t('VAT') + '</td>' + ms.map(function (m) {
          var k = keyFor(e, m); if (e.vatFreq === 'quarterly' && +m.slice(5) % 3 !== 0) return '<td class="num faint">·</td>'; return cell(exOf(e, k), 'vat');
        }).join('') + '</tr>';
        var wht = e.whtRegistered === false ? '' : '<tr><td>' + t('WHT') + '</td>' + ms.map(function (m) { return cell(S.exercises.filter(function (x) { return x.entityId === e.id && (x.period === m || x.period === keyFor(e, m) && +m.slice(5) % 3 === 0); })[0], 'wht'); }).join('') + '</tr>';
        return vat + wht;
      }).join('') + '</tbody></table></div></section>';
  }

  Z.ACT.rexport = function (el) {
    var wb = XLSX.utils.book_new(), add = function (n, aoa) { XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), n); }, ms = months12(), r = el.dataset.r;
    if (r === 'portfolio') add('Portfolio', [['Entity'].concat(ms)].concat(ents().map(function (e) { return [e.name].concat(ms.map(function (m) { var x = exOf(e, keyFor(e, m)); return x && x.summary && x.summary.score != null ? x.summary.score : ''; })); })));
    if (r === 'aging') { var b = E.aging(S.allFindings || [], Z.today()), rows = [['Bucket', 'Severity', 'Finding', 'Exercise', 'Tax impact', 'Penalty', 'Owner', 'Due', 'Days overdue']]; BUCKETS.forEach(function (k) { b[k[0]].forEach(function (f) { rows.push([k[1], f.severity, f.title, exName(f.parentId), f.taxImpact, f.penalty, f.owner, f.due, f.overdue || '']); }); }); add('Findings aging', rows); }
    if (r === 'exposure') add('Exposure', [['Entity', 'Latest period', 'Readiness', 'Quantified exposure', 'Open findings']].concat(ents().map(function (e) { var x = S.exercises.filter(function (z) { return z.entityId === e.id; }).sort(function (a, b) { return a.period < b.period ? 1 : -1; })[0]; var sm = (x && x.summary) || {}; return [e.name, x ? x.period : '', sm.score, sm.exposure, (S.allFindings || []).filter(function (f) { return f.status !== 'closed' && x && f.parentId === x.id; }).length]; })));
    if (r === 'calendar') add('Filing', [['Entity', 'Period', 'VAT due', 'VAT filed', 'VAT paid', 'WHT due', 'WHT filed', 'WHT paid']].concat(S.exercises.map(function (x) { var F = x.filing || {}, dl = E.deadlines(x.period), e = Z.entity(x.entityId) || {}; return [e.name, x.period, dl.vat, F.vatFiledOn || '', F.vatPaidOn || '', dl.wht, F.whtFiledOn || '', F.whtPaidOn || '']; })));
    XLSX.writeFile(wb, 'report-' + r + '-' + Z.today() + '.xlsx');
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
    var years = []; for (var y = +Z.today().slice(0, 4); y >= +Z.today().slice(0, 4) - 4; y--) years.push(y);
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
      (can ? '<tr><td><input type="text" id="ai-d" placeholder="' + esc(t('e.g. Out-of-scope income, unbilled revenue, FX gains')) + '"></td><td style="width:160px"><input type="number" step="0.01" id="ai-a"></td><td><button class="btn small" data-act="annadd">' + t('Add') + '</button></td></tr>' : '') + '</tbody></table></section>' +
      '<section class="paper flush"><div style="padding:14px 18px" class="spread"><h2>' + t('Period by period') + '</h2><button class="btn small" data-act="whtbenef" data-e="' + e.id + '" data-y="' + year + '"' + (e.whtRegistered === false ? ' disabled' : '') + '>' + t('WHT by beneficiary for the year') + '</button></div><div class="tbl-wrap"><table class="t"><thead><tr><th>' + t('Period') + '</th><th class="num">' + t('Sales (box 6)') + '</th><th class="num">' + t('Output VAT') + '</th><th class="num">' + t('Input VAT') + '</th><th class="num">' + t('Net VAT due') + '</th><th class="num">' + t('WHT') + '</th><th>' + t('Readiness') + '</th></tr></thead><tbody>' +
      rows.map(function (r) { return '<tr class="clickable" data-act="openex" data-id="' + r.exId + '"><td>' + Z.ltr(r.period) + '</td><td class="num">' + fmt(r.sales) + '</td><td class="num">' + fmt(r.outputVat) + '</td><td class="num">' + fmt(r.inputVat) + '</td><td class="num">' + fmt(r.netVat) + '</td><td class="num">' + fmt(r.whtTax) + '</td><td>' + (r.score != null ? Z.pill(r.grade, r.score + '%') : '') + '</td></tr>'; }).join('') +
      '<tr class="total"><td>' + t('Total') + '</td><td class="num">' + fmt(rec.totals.sales) + '</td><td class="num">' + fmt(rec.totals.outputVat) + '</td><td class="num">' + fmt(rec.totals.inputVat) + '</td><td class="num">' + fmt(rec.totals.netVat) + '</td><td class="num">' + fmt(rec.totals.whtTax) + '</td><td></td></tr></tbody></table></div></section>' +
      '<div id="benef"></div></div>');
  }
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
        var k = String(r.party || '—');
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
