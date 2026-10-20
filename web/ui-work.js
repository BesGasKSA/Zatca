/* Sampling, documents checklist, findings register, the printable inspection
   pack, the Excel export and the demo loader. */
(function () {
  'use strict';
  var E = window.ZEngine, S = Z.S, t = Z.t, esc = Z.esc, fmt = Z.fmt;

  // ---------------------------------------------------------------- sampling
  var POP = { S: 'Sales invoices', P: 'Purchase invoices', W: 'WHT payments' };
  function population(flow) {
    if (flow === 'W') return (S.data.wht_reg || []).map(function (x) { return { ref: x.party + ' ' + x.date, date: x.date, party: x.party, country: x.country, category: x.paymentType, net: x.gross, vat: x.wht, _k: x._k }; });
    return (S.data.sys_vat || []).filter(function (x) { return x.flow === flow; }).map(function (x) { return { ref: x.invoice, date: x.date, party: x.party, vatNo: x.vatNo, country: x.country, category: x.category, docType: x.docType, net: x.net, vat: x.vat, _k: x._k }; });
  }
  function flaggedKeys() {
    var k = {};
    S.R.analytics.tests.forEach(function (x) { if (x.severity !== 'low') x.items.forEach(function (i) { if (i._k) k[i._k] = x.id; }); });
    return k;
  }

  var FLOWS = function () { return Z.isWht() ? ['W'] : ['S', 'P']; };
  var mySamples = function () { return S.samples.filter(function (s) { return FLOWS().indexOf(s.flow) >= 0; }); };
  var myFinding = function (f) { return (f.tax === 'WHT') === Z.isWht(); };
  var myArea = function (a) { return (a === 'WHT') === Z.isWht(); };
  Z.tabs.sampling = function () {
    var lk = Z.locked();
    if (S.sampleId) return sampleDetail(S.samples.filter(function (s) { return s.id === S.sampleId; })[0]);
    var rows = mySamples().map(function (s) {
      var ev = s.eval || E.evaluateSample(s, s.confidence);
      return '<tr class="clickable" data-act="opensample" data-id="' + s.id + '"><td><b>' + esc(t(POP[s.flow])) + '</b><div class="faint">' + esc(t(METHODS[s.method])) + ' · ' + t('seed') + ' ' + s.seed + '</div></td><td class="num">' + s.items.length + '</td><td class="num">' + ev.tested + '</td><td class="num">' + ev.deviations + ' (' + ev.rate + '%)</td><td class="num">' + fmt(ev.actualMisstatement) + '</td><td class="num">' + fmt(ev.projected) + '</td><td>' + (s.conclusion ? Z.pill(s.conclusion === 'accept' ? 'pass' : 'fail', s.conclusion === 'accept' ? t('Population accepted') : t('Not accepted')) : Z.pill('na', t('Testing'))) + '</td></tr>';
    }).join('');
    return '<div class="grid g2" style="align-items:start"><section class="paper"><header><div><h2>' + t('Samples in this exercise') + '</h2><p>' + t('An inspector will ask to see invoices behind the return. Test them first.') + '</p></div></header>' +
      (rows ? '<div class="tbl-wrap"><table class="t"><thead><tr><th>' + t('Population') + '</th><th class="num">' + t('Items') + '</th><th class="num">' + t('Tested') + '</th><th class="num">' + t('Deviations') + '</th><th class="num">' + t('Misstatement') + '</th><th class="num">' + t('Projected') + '</th><th>' + t('Conclusion') + '</th></tr></thead><tbody>' + rows + '</tbody></table></div>' : '<p class="muted">' + (Z.isWht() ? t('No samples yet. Select WHT payments to test rate, certificate and payment date.') : t('No samples yet. Select one for sales and one for purchases.')) + '</p>') + '</section>' +
      (lk ? '' : newSampleForm()) + '</div>';
  };
  var METHODS = { mus: 'Monetary unit sampling (MUS)', random: 'Simple random', stratified: 'Stratified by value', key: 'Key items above a threshold', risk: 'Risk-based (flagged by analytics)' };

  function newSampleForm() {
    var f = S.sf && FLOWS().indexOf(S.sf.flow) >= 0 ? S.sf : { flow: FLOWS()[0], method: 'mus', confidence: 0.95, tolerable: 0.05, expected: 0, seed: Math.floor(Math.random() * 1e6) };
    S.sf = f;
    var pop = population(f.flow), field = f.flow === 'S' ? 'net' : 'vat';
    var bv = pop.reduce(function (a, x) { return a + Math.abs(+x[field] || 0); }, 0);
    var size;
    // default tolerable misstatement: 3% of book value (performance materiality), never below materiality
    if (f.method === 'mus') { f.tm = f.tm || Math.round(Math.max(S.settings.materiality * (field === 'vat' ? 0.15 : 1), bv * 0.03)); size = E.sampleSizeMUS(bv, f.tm, f.em || 0, f.confidence); }
    else if (f.method === 'key') size = pop.filter(function (x) { return Math.abs(+x[field] || 0) >= (f.threshold || S.settings.materiality); }).length;
    else if (f.method === 'risk') { var fk = flaggedKeys(); size = pop.filter(function (x) { return fk[x._k]; }).length; }
    else size = E.sampleSizeAttribute(f.confidence, f.tolerable, f.expected, pop.length);
    f.size = Math.min(f.sizeOverride || size, pop.length) || size;
    var opt = function (v, cur, l) { return '<option value="' + v + '"' + (String(cur) === String(v) ? ' selected' : '') + '>' + l + '</option>'; };
    return '<section class="paper"><header><div><h2>' + t('Select a new sample') + '</h2><p>' + t('Sizes follow AICPA attribute and MUS tables (Poisson). The seed makes the selection reproducible: anyone re-running it gets the same items.') + '</p></div></header><div class="grid g2">' +
      '<label class="f"><span>' + t('Population') + '</span><select data-chg="sf" data-f="flow">' + FLOWS().map(function (k) { return opt(k, f.flow, t(POP[k])); }).join('') + '</select><small>' + Z.count(pop.length) + ' ' + t('items') + ', ' + t('book value') + ' ' + fmt(bv) + ' (' + (field === 'vat' ? t('VAT / WHT') : t('net')) + ')</small></label>' +
      '<label class="f"><span>' + t('Method') + '</span><select data-chg="sf" data-f="method">' + Object.keys(METHODS).map(function (k) { return opt(k, f.method, t(METHODS[k])); }).join('') + '</select></label>' +
      '<label class="f"><span>' + t('Confidence') + '</span><select data-chg="sf" data-f="confidence">' + [0.9, 0.95, 0.99].map(function (c) { return opt(c, f.confidence, c * 100 + '%'); }).join('') + '</select></label>' +
      (f.method === 'mus' ? Z.fld('tm', t('Tolerable misstatement (SAR)'), f.tm, 'number', 'data-chg="sf" data-f="tm"') + Z.fld('em', t('Expected misstatement (SAR)'), f.em || 0, 'number', 'data-chg="sf" data-f="em"')
        : f.method === 'key' ? Z.fld('threshold', t('Threshold (SAR)'), f.threshold || S.settings.materiality, 'number', 'data-chg="sf" data-f="threshold"')
          : f.method === 'risk' ? '' : Z.fld('tolerable', t('Tolerable deviation rate %'), f.tolerable * 100, 'number', 'step="0.5" data-chg="sf" data-f="tolerable"') + Z.fld('expected', t('Expected deviation rate %'), f.expected * 100, 'number', 'step="0.5" data-chg="sf" data-f="expected"')) +
      Z.fld('seed', t('Random seed'), f.seed, 'number', 'data-chg="sf" data-f="seed"') +
      Z.fld('size', t('Sample size'), f.size == null ? '' : f.size, 'number', 'min="1" data-chg="sf" data-f="size"', f.size == null ? t('Tolerable must exceed expected × expansion factor.') : t('Calculated. You may raise it.')) + '</div>' +
      '<div class="row end" style="margin-top:14px"><button class="btn primary" data-act="makesample"' + (pop.length ? '' : ' disabled') + '>' + t('Select') + ' ' + (f.size || 0) + ' ' + t('items') + '</button></div></section>';
  }
  Z.CHG.sf = function (el) {
    var f = S.sf, k = el.dataset.f, v = el.value;
    if (k === 'flow' || k === 'method') { f[k] = v; f.sizeOverride = null; if (k === 'flow') f.tm = null; }
    else if (k === 'tolerable' || k === 'expected') { f[k] = +v / 100; f.sizeOverride = null; }
    else if (k === 'size') f.sizeOverride = +v;
    else { f[k] = +v; if (k !== 'seed') f.sizeOverride = null; }
    Z.route();
  };
  Z.ACT.makesample = function () {
    var f = S.sf, pop = population(f.flow), field = f.flow === 'S' ? 'net' : 'vat', sel, interval = 0, start = 0;
    if (f.method === 'mus') { var m = E.selectMUS(pop, f.size, f.seed, field); sel = m.items; interval = m.interval; start = m.start; }
    else if (f.method === 'random') sel = E.selectRandom(pop, f.size, f.seed);
    else if (f.method === 'stratified') sel = E.selectStratified(pop, f.size, f.seed, field, 4);
    else if (f.method === 'key') sel = E.selectKey(pop, f.threshold || S.settings.materiality, field);
    else { var fk = flaggedKeys(); sel = pop.map(function (x, i) { return { i: i, why: t('Flagged by') + ' ' + fk[x._k] }; }).filter(function (x) { return fk[pop[x.i]._k]; }); }
    if (!sel.length) return Z.toast(t('Nothing selected. Check the population and parameters.'), true);
    var doc = {
      parentId: S.ex.id, flow: f.flow, method: f.method, confidence: f.confidence, tolerable: f.tolerable, expected: f.expected, tm: f.tm, em: f.em, threshold: f.threshold,
      seed: f.seed, valueField: field, populationCount: pop.length, populationValue: E.r2(pop.reduce(function (a, x) { return a + Math.abs(+x[field] || 0); }, 0)),
      interval: interval, start: start, label: POP[f.flow] + ' ' + f.method, createdAt: new Date().toISOString(),
      items: sel.map(function (s) { var x = pop[s.i]; return Object.assign({}, x, { book: E.r2(Math.abs(+x[field] || 0)), why: s.why, tests: {}, audited: '', evidence: '', note: '' }); })
    };
    Z.save('samples', doc).then(function (d) { S.samples.push(d); S.sampleId = d.id; S.sf = null; Z.changed(); });
  };
  Z.ACT.opensample = function (el) { S.sampleId = el.dataset.id; Z.route(); };
  Z.ACT.closesample = function () { S.sampleId = null; Z.route(); };

  function sampleDetail(s) {
    if (!s) { S.sampleId = null; return Z.tabs.sampling(); }
    var A = E.ATTRIBUTES[s.flow], ev = E.evaluateSample(s, s.confidence), lk = Z.locked();
    var head = '<tr><th>#</th><th>' + t('Item') + '</th><th class="num">' + t('Book') + '</th>' + A.map(function (a, i) { return '<th title="' + esc(S.lang === 'ar' ? a[2] : a[1]) + '" style="text-align:center">' + (i + 1) + '</th>'; }).join('') + '<th class="num">' + t('Audited value') + '</th><th>' + t('Evidence / note') + '</th></tr>';
    var rows = s.items.map(function (x, i) {
      var bad = Object.keys(x.tests).some(function (k) { return x.tests[k] === 'fail'; });
      return '<tr' + (bad ? ' class="bad"' : '') + '><td class="faint">' + (i + 1) + '</td><td><b>' + esc(x.ref) + '</b><div class="faint" style="font-size:12px">' + esc([x.date, x.party, x.category].filter(Boolean).join(' · ')) + '</div><div class="faint" style="font-size:11.5px">' + esc(x.why) + '</div></td><td class="num">' + fmt(x.book) + '</td>' +
        A.map(function (a) { var v = x.tests[a[0]] || ''; return '<td style="text-align:center"><button class="attr ' + v + '" data-act="attr" data-i="' + i + '" data-a="' + a[0] + '"' + (lk ? ' disabled' : '') + ' aria-label="' + esc(a[1] + ': ' + (v || 'not tested')) + '">' + ({ pass: '✓', fail: '✕', na: '-' }[v] || '') + '</button></td>'; }).join('') +
        '<td style="width:120px"><input type="number" step="0.01" value="' + esc(x.audited) + '" data-chg="sitem" data-i="' + i + '" data-f="audited" placeholder="' + fmt(x.book) + '"' + (lk ? ' disabled' : '') + '></td><td style="min-width:180px"><input type="text" value="' + esc(x.evidence) + '" data-chg="sitem" data-i="' + i + '" data-f="evidence" placeholder="' + esc(t('Drive link or file ref')) + '"' + (lk ? ' disabled' : '') + '></td></tr>';
    }).join('');
    var legend = A.map(function (a, i) { return '<li><b>' + (i + 1) + '</b> ' + esc(S.lang === 'ar' ? a[2] : a[1]) + ' <span class="faint">(' + (ev.byAttr[i].fails) + '/' + ev.byAttr[i].tested + ')</span></li>'; }).join('');
    return '<div class="spread" style="margin-bottom:14px"><button class="btn small" data-act="closesample">‹ ' + t('All samples') + '</button><div class="row">' + (lk ? '' : '<button class="btn small" data-act="passall">' + t('Mark untested as passed') + '</button><button class="btn small danger" data-act="delsample">' + t('Delete sample') + '</button>') + '<button class="btn small" data-act="xlsample">' + t('Export to Excel') + '</button></div></div>' +
      '<div class="grid g2" style="align-items:start"><section class="paper"><header><div><h2>' + esc(t(POP[s.flow])) + ' - ' + esc(t(METHODS[s.method])) + '</h2><p>' + t('Seed') + ' ' + s.seed + ' · ' + t('population') + ' ' + Z.count(s.populationCount) + ' / ' + fmt(s.populationValue) + (s.interval ? ' · ' + t('interval') + ' ' + fmt(s.interval) + ' · ' + t('start') + ' ' + fmt(s.start) : '') + '</p></div></header>' +
      '<div class="kpis"><div data-drill="smp:tested"><b>' + ev.tested + ' / ' + ev.total + '</b><span>' + t('Items tested') + '</span></div><div class="' + (ev.deviations ? 'bad' : '') + '" data-drill="smp:dev"><b>' + ev.rate + '%</b><span>' + t('Deviation rate') + ' (' + t('upper limit') + ' ' + (ev.upperRate == null ? '-' : ev.upperRate + '%') + ')</span></div>' +
      '<div class="' + (ev.actualMisstatement ? 'bad' : '') + '" data-drill="smp:mis"><b>' + fmt(ev.actualMisstatement) + '</b><span>' + t('Misstatement found') + '</span></div><div data-drill="smp:proj"><b>' + fmt(ev.projected) + '</b><span>' + t('Projected to population') + (ev.upperLimit != null ? ' · ' + t('upper limit') + ' ' + fmt(ev.upperLimit) : '') + '</span></div></div>' +
      '<div class="grid g2" style="margin-top:14px"><label class="f"><span>' + t('Conclusion') + '</span><select data-chg="sconcl"' + (lk ? ' disabled' : '') + '><option value="">' + t('Still testing') + '</option><option value="accept"' + (s.conclusion === 'accept' ? ' selected' : '') + '>' + t('Population accepted') + '</option><option value="reject"' + (s.conclusion === 'reject' ? ' selected' : '') + '>' + t('Not accepted - extend testing or correct') + '</option></select></label>' +
      '<label class="f"><span>' + t('Reviewer note') + '</span><input type="text" value="' + esc(s.note || '') + '" data-chg="snote"' + (lk ? ' disabled' : '') + '></label></div></section>' +
      '<section class="paper"><h3>' + t('Attributes tested') + '</h3><p class="faint" style="font-size:12.5px">' + t('Click a cell: blank → ✓ passed → ✕ failed → - not applicable.') + '</p><ol style="padding-inline-start:0;list-style:none;font-size:13px;display:grid;gap:4px">' + legend + '</ol></section></div>' +
      '<section class="paper flush" style="margin-top:18px"><div class="tbl-wrap"><table class="t">' + head + '<tbody>' + rows + '</tbody></table></div></section>';
  }
  function curSample() { return S.samples.filter(function (s) { return s.id === S.sampleId; })[0]; }
  var saveT;
  function saveSample(s, rerender) {
    clearTimeout(saveT);
    saveT = setTimeout(function () { var c = Object.assign({}, s); delete c.eval; Z.save('samples', c); Z.recompute(); Z.saveSummary(); }, 600);
    if (rerender) Z.route();
  }
  Z.ACT.attr = function (el) {
    var s = curSample(), x = s.items[+el.dataset.i], a = el.dataset.a, nx = { '': 'pass', pass: 'fail', fail: 'na', na: '' }[x.tests[a] || ''];
    if (nx) x.tests[a] = nx; else delete x.tests[a];
    el.className = 'attr ' + nx; el.textContent = { pass: '✓', fail: '✕', na: '-' }[nx] || '';
    el.closest('tr').classList.toggle('bad', Object.keys(x.tests).some(function (k) { return x.tests[k] === 'fail'; }));
    saveSample(s);
  };
  Z.ACT.passall = function () {
    var s = curSample();
    s.items.forEach(function (x) { E.ATTRIBUTES[s.flow].forEach(function (a) { if (!x.tests[a[0]]) x.tests[a[0]] = 'pass'; }); });
    saveSample(s, true);
  };
  Z.CHG.sitem = function (el) { var s = curSample(); s.items[+el.dataset.i][el.dataset.f] = el.value; saveSample(s); };
  Z.CHG.sconcl = function (el) { var s = curSample(); s.conclusion = el.value; saveSample(s, true); };
  Z.CHG.snote = function (el) { var s = curSample(); s.note = el.value; saveSample(s); };
  Z.ACT.delsample = function () {
    if (!confirm(t('Delete this sample and its test results?'))) return;
    Z.call('remove', { table: 'samples', id: S.sampleId }).then(function () { S.samples = S.samples.filter(function (s) { return s.id !== S.sampleId; }); S.sampleId = null; Z.changed(); });
  };
  Z.ACT.xlsample = function () {
    var s = curSample(), A = E.ATTRIBUTES[s.flow];
    var aoa = [['#', 'Reference', 'Date', 'Party', 'Category', 'Book value', 'Selected because'].concat(A.map(function (a) { return a[1]; })).concat(['Audited value', 'Evidence'])];
    s.items.forEach(function (x, i) { aoa.push([i + 1, x.ref, x.date, x.party, x.category, x.book, x.why].concat(A.map(function (a) { return x.tests[a[0]] || ''; })).concat([x.audited, x.evidence])); });
    var wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'sample');
    XLSX.writeFile(wb, 'sample-' + S.ex.period + '-' + s.flow + '-' + s.seed + '.xlsx');
  };

  // ---------------------------------------------------------------- checklist
  Z.tabs.checklist = function () {
    var lk = Z.locked();
    var areas = [['VAT', 'VAT'], ['EINV', 'E-invoicing'], ['BANK', 'Bank'], ['WHT', 'Withholding tax'], ['OTHER', 'Other taxes']].filter(function (a) { return myArea(a[0]); });
    var items = (S.checklist.items || []).map(function (x) { return x; });
    var stOpt = function (v) { return ['available', 'requested', 'missing', 'na'].map(function (s) { return '<option value="' + s + '"' + (v === s ? ' selected' : '') + '>' + t({ available: 'On file', requested: 'Requested', missing: 'Missing', na: 'Not applicable' }[s]) + '</option>'; }).join(''); };
    var mine = items.filter(function (i) { return myArea(i.area); });
    var done = mine.filter(function (i) { return i.status === 'available'; }).length, req = mine.filter(function (i) { return i.status !== 'na'; }).length;
    return '<p class="muted">' + t('The inspection file: what ZATCA inspectors typically request. Link each document (Google Drive, SharePoint) so it can be produced the same day.') + ' <b>' + done + ' / ' + req + '</b> ' + t('on file') + '.</p>' +
      areas.map(function (a) {
        var list = items.map(function (x, i) { return [x, i]; }).filter(function (p) { return p[0].area === a[0]; });
        return '<section class="paper flush area-' + (a[0] === 'VAT' || a[0] === 'EINV' ? 'vat' : a[0] === 'BANK' ? 'bank' : a[0] === 'OTHER' ? 'ledger' : 'wht') + '" style="margin-top:16px"><div style="padding:14px 18px"><h2>' + t(a[1]) + '</h2></div><div class="tbl-wrap"><table class="t"><thead><tr><th>' + t('Document') + '</th><th style="width:150px">' + t('Status') + '</th><th style="width:150px">' + t('Owner') + '</th><th>' + t('Link') + '</th></tr></thead><tbody>' +
          list.map(function (p) {
            var x = p[0], i = p[1];
            return '<tr><td>' + esc(S.lang === 'ar' ? x.ar : x.en) + '</td><td><select data-chg="cl" data-i="' + i + '" data-f="status"' + (lk ? ' disabled' : '') + ' aria-label="' + t('Status') + '">' + stOpt(x.status) + '</select></td><td><input type="text" value="' + esc(x.owner) + '" data-chg="cl" data-i="' + i + '" data-f="owner"' + (lk ? ' disabled' : '') + ' aria-label="' + t('Owner') + '"></td><td><div class="row" style="flex-wrap:nowrap"><input type="url" value="' + esc(x.link) + '" data-chg="cl" data-i="' + i + '" data-f="link" placeholder="https://"' + (lk ? ' disabled' : '') + ' aria-label="' + t('Link') + '">' + (/^https?:\/\//i.test(x.link || '') ? '<a class="btn small ghost" href="' + esc(x.link) + '" target="_blank" rel="noopener noreferrer">' + t('Open') + '</a>' : '') + '</div></td></tr>';
          }).join('') + '</tbody></table></div></section>';
      }).join('');
  };
  Z.CHG.cl = function (el) {
    var x = S.checklist.items[+el.dataset.i];
    if (el.dataset.f === 'link' && el.value && !/^https?:\/\//i.test(el.value)) return Z.toast(t('Links must start with https://'), true);
    x[el.dataset.f] = el.value;
    Z.save('checklists', S.checklist).then(function () { Z.recompute(); Z.saveSummary(); });
  };

  // ---------------------------------------------------------------- findings
  Z.tabs.findings = function () {
    var lk = Z.locked();
    var sev = { critical: 0, high: 1, medium: 2, low: 3 };
    var list = S.findings.filter(myFinding).sort(function (a, b) { return (a.status === 'closed') - (b.status === 'closed') || sev[a.severity] - sev[b.severity]; });
    var tot = list.filter(function (f) { return f.status !== 'closed'; }).reduce(function (a, f) { return { tax: a.tax + (+f.taxImpact || 0), pen: a.pen + (+f.penalty || 0) }; }, { tax: 0, pen: 0 });
    var rows = list.map(function (f) {
      return '<tr class="clickable" data-act="editfinding" data-id="' + f.id + '"><td>' + Z.pill(f.severity, t(Z.cap(f.severity))) + '</td><td><b>' + esc(f.title) + '</b><div class="faint" style="font-size:12.5px">' + esc(f.tax) + (f.checkId ? ' · ' + esc(f.checkId) : '') + ' · ' + esc(f.route || '') + '</div></td><td class="num">' + fmt(f.taxImpact) + '</td><td class="num">' + fmt(f.penalty) + '</td><td>' + esc(f.owner || '') + '<div class="faint">' + esc(f.due || '') + '</div></td><td>' + Z.pill(f.status === 'closed' ? 'closed' : f.status === 'in_progress' ? 'review' : 'open', t({ open: 'Open', in_progress: 'In progress', closed: 'Closed' }[f.status] || 'Open')) + '</td></tr>';
    }).join('');
    return '<div class="spread" style="margin-bottom:14px"><div class="kpis" style="flex:1"><div><b>' + list.filter(function (f) { return f.status !== 'closed'; }).length + '</b><span>' + t('Open findings') + '</span></div><div class="' + (tot.tax ? 'bad' : '') + '"><b>' + fmt(tot.tax) + '</b><span>' + t('Tax at stake (SAR)') + '</span></div><div class="' + (tot.pen ? 'bad' : '') + '"><b>' + fmt(tot.pen) + '</b><span>' + t('Estimated penalties (SAR)') + '</span></div></div>' + (lk ? '' : '<button class="btn primary" data-act="editfinding">' + t('Add finding') + '</button>') + '</div>' +
      '<div class="paper flush"><div class="tbl-wrap"><table class="t"><thead><tr><th>' + t('Severity') + '</th><th>' + t('Finding') + '</th><th class="num">' + t('Tax impact') + '</th><th class="num">' + t('Penalty') + '</th><th>' + t('Owner / due') + '</th><th>' + t('Status') + '</th></tr></thead><tbody>' + (rows || '<tr><td colspan="6" class="empty">' + t('No findings. Raise one from any failed check or test.') + '</td></tr>') + '</tbody></table></div></div>';
  };
  function findCheck(id) {
    var all = S.R.vat.checks.concat(S.R.bank.checks, S.R.wht.checks, S.R.einv.checks, S.R.filing.checks, S.R.other.checks, S.R.analytics.tests);
    return all.filter(function (c) { return c.id === id; })[0];
  }
  Z.ACT.raise = function (el) {
    var c = findCheck(el.dataset.id) || {};
    // VAT at stake: a VAT difference is the tax itself; a bank difference includes
    // VAT, so its tax is the VAT fraction; a net-amount difference times the rate.
    var r = S.settings.vatRate, d = Math.abs(c.diff || 0);
    var impact = c.exposure || (c.group === 'bank' ? d * r / (1 + r) : c.group === 'vat' ? (/VAT/.test(c.aLabel || '') ? d : d * r) : d);
    if (c.group === 'einv' || c.group === 'filing' || c.group === 'other') impact = c.exposure || 0;
    findingModal({ title: Z.tt(c, 'title'), checkId: c.id, tax: c.group === 'wht' || c.id === 'C3' ? 'WHT' : c.group === 'einv' ? 'EINV' : /^R/.test(c.id) && c.group === 'other' ? 'RETT' : /^K/.test(c.id) ? 'EXCISE' : 'VAT', severity: c.status === 'fail' ? 'high' : 'medium', taxImpact: E.r2(impact), status: 'open', monthsLate: 0 });
  };
  Z.ACT.raisea = function (el) {
    var c = findCheck(el.dataset.id) || {};
    findingModal({ title: Z.tt(c, 'title') + ' (' + c.count + ')', checkId: c.id, tax: Z.isWht() ? 'WHT' : 'VAT', severity: c.severity === 'high' ? 'high' : c.severity === 'medium' ? 'medium' : 'low', taxImpact: c.amount || 0, status: 'open', monthsLate: 0 });
  };
  Z.ACT.editfinding = function (el) { findingModal(S.findings.filter(function (f) { return f.id === el.dataset.id; })[0] || { tax: Z.isWht() ? 'WHT' : 'VAT', severity: 'medium', status: 'open', monthsLate: 0 }); };
  function findingModal(f) {
    var lk = Z.locked(), sel = function (name, cur, opts) { return '<select name="' + name + '"' + (lk ? ' disabled' : '') + '>' + opts.map(function (o) { return '<option value="' + o[0] + '"' + (cur === o[0] ? ' selected' : '') + '>' + t(o[1]) + '</option>'; }).join('') + '</select>'; };
    S.editF = f;
    Z.modal(f.id ? t('Finding') : t('New finding'), '<form id="ff" class="grid g2">' +
      '<label class="f" style="grid-column:1/-1"><span>' + t('Title') + '</span><input type="text" name="title" required value="' + esc(f.title || '') + '"' + (lk ? ' disabled' : '') + '></label>' +
      '<label class="f"><span>' + t('Tax') + '</span>' + sel('tax', f.tax, [['VAT', 'VAT'], ['WHT', 'WHT'], ['EINV', 'E-invoicing'], ['RETT', 'Real estate transaction tax'], ['EXCISE', 'Excise'], ['ZAKAT', 'Zakat']]) + '</label>' +
      '<label class="f"><span>' + t('Severity') + '</span>' + sel('severity', f.severity, [['critical', 'Critical'], ['high', 'High'], ['medium', 'Medium'], ['low', 'Low']]) + '</label>' +
      Z.fld('taxImpact', t('Tax impact (SAR)'), f.taxImpact, 'number', 'step="0.01" data-chg="fcalc" data-live="1"' + (lk ? ' disabled' : '')) +
      Z.fld('monthsLate', t('Months since the tax was due'), f.monthsLate, 'number', 'min="0" data-chg="fcalc" data-live="1"' + (lk ? ' disabled' : ''), t('For VAT late-payment fines (per month or part).')) +
      Z.fld('penalty', t('Estimated penalty (SAR)'), f.penalty, 'number', 'step="0.01"' + (lk ? ' disabled' : ''), '<span id="penhint"></span>') +
      Z.fld('route', t('How to correct'), f.route, 'text', (lk ? 'disabled' : '')) +
      '<label class="f" style="grid-column:1/-1"><span>' + t('Root cause') + '</span><textarea name="cause"' + (lk ? ' disabled' : '') + '>' + esc(f.cause || '') + '</textarea></label>' +
      '<label class="f" style="grid-column:1/-1"><span>' + t('Corrective action') + '</span><textarea name="action"' + (lk ? ' disabled' : '') + '>' + esc(f.action || '') + '</textarea></label>' +
      Z.fld('owner', t('Owner'), f.owner, 'text', lk ? 'disabled' : '') + Z.fld('due', t('Due date'), f.due, 'date', lk ? 'disabled' : '') +
      '<label class="f"><span>' + t('Status') + '</span>' + sel('status', f.status, [['open', 'Open'], ['in_progress', 'In progress'], ['closed', 'Closed']]) + '</label>' +
      Z.fld('checkId', t('Linked check'), f.checkId, 'text', lk ? 'disabled' : '') +
      Z.fld('discoveredOn', t('Error discovered on'), f.discoveredOn || Z.today(), 'date', lk ? 'disabled' : '', t('Starts the 20-day clock for an amended return.')) +
      Z.fld('correctedOn', t('Amended return filed on'), f.correctedOn, 'date', lk ? 'disabled' : '') +
      Z.fld('correctedPeriod', t('Or corrected in the return for period'), f.correctedPeriod, 'text', (lk ? 'disabled ' : '') + 'placeholder="2026-10"') + ((f.id && Z.attachHtml && 'findings:' + f.id) ? '<div style="grid-column:1/-1">' + Z.attachHtml((f.id && Z.attachHtml && 'findings:' + f.id), S.ex.entityId) + '</div>' : '') + '</form>',
      (f.id && !lk ? '<button class="btn danger" data-act="delfinding" data-id="' + f.id + '">' + t('Delete') + '</button>' : '') + '<button class="btn" data-act="closemodal">' + t('Cancel') + '</button>' + (lk ? '' : '<button class="btn primary" data-act="savefinding">' + t('Save finding') + '</button>'));
    Z.CHG.fcalc();
  }
  Z.CHG.fcalc = function () {
    var form = document.getElementById('ff'); if (!form) return;
    var tax = form.tax.value, imp = +form.taxImpact.value || 0, ml = +form.monthsLate.value || 0;
    var pen = E.penaltyForFinding({ tax: tax, taxImpact: imp, monthsLate: ml, daysLate: ml * 30 }, S.settings);
    var hint = document.getElementById('penhint');
    if (hint) hint.textContent = t('Suggested') + ': ' + fmt(pen) + (tax === 'VAT' ? ' (' + Z.r(S.settings.penalties.vatErrorPct * 100) + '% ' + t('of the difference') + (ml ? ' + ' + Z.r(S.settings.penalties.vatLatePaymentPctPerMonth * 100) + '% × ' + ml + ' ' + t('months') : '') + ')' : '');
    if (!form.penalty.value || form.penalty.dataset.auto) { form.penalty.value = pen; form.penalty.dataset.auto = '1'; }
    if (!form.route.value || form.route.dataset.auto) { form.route.value = tax === 'VAT' ? E.correctionRoute(imp, S.settings) : tax === 'WHT' ? 'Pay the shortfall with the next WHT return and issue a corrected certificate' : 'Re-issue / report the invoice on Fatoora'; form.route.dataset.auto = '1'; }
  };
  Z.ACT.savefinding = function () {
    var form = document.getElementById('ff'); if (!form.reportValidity()) return;
    var d = Object.assign({}, S.editF, Object.fromEntries(new FormData(form)));
    ['taxImpact', 'penalty', 'monthsLate'].forEach(function (k) { d[k] = +d[k] || 0; });
    d.parentId = S.ex.id;
    Z.save('findings', d).then(function (x) {
      var i = S.findings.findIndex(function (f) { return f.id === x.id; });
      if (i >= 0) S.findings[i] = x; else S.findings.push(x);
      Z.closeModal(); Z.toast(t('Finding saved')); Z.changed();
    });
  };
  Z.ACT.delfinding = function (el) {
    if (!confirm(t('Delete this finding?'))) return;
    Z.call('remove', { table: 'findings', id: el.dataset.id }).then(function () { S.findings = S.findings.filter(function (f) { return f.id !== el.dataset.id; }); Z.closeModal(); Z.changed(); });
  };

  // ---------------------------------------------------------------- report & sign-off
  Z.tabs.report = function () {
    var R = S.R, ex = S.ex, ent = Z.entity(ex.entityId) || {}, b = R.vat.boxes.ret || R.vat.boxes.sys, wht = Z.isWht();
    var sc = (wht ? R.whtScore : R.vatScore) || R.score, expo = wht ? R.whtExposure || 0 : R.vatExposure || 0;
    var ctl = '<div class="spread noprint" style="margin-bottom:16px"><div class="row">' +
      (ex.status === 'in_progress' && Z.can('preparer') ? '<button class="btn" data-act="exstatus" data-s="review">' + t('Send for review') + '</button>' : '') +
      (ex.status !== 'closed' && Z.can('manager') ? (Z.openReviews && Z.openReviews().length ? '<button class="btn primary" disabled title="' + esc(t('Clear every review note before signing off.')) + '">' + t('Sign off exercise') + '</button>' : '<button class="btn primary" data-act="exstatus" data-s="closed">' + t('Sign off exercise') + '</button>') : '') +
      (ex.status === 'closed' && Z.can('manager') ? '<button class="btn" data-act="exstatus" data-s="in_progress">' + t('Reopen') + '</button>' : '') + '</div>' +
      '<div class="row"><button class="btn" data-act="exportxl">' + Z.icon('microsoft-excel-logo') + ' ' + (wht ? t('Export WHT workbook') : t('Export VAT workbook')) + '</button><button class="btn primary" data-act="print">' + Z.icon('file-pdf') + ' ' + t('Print / save as PDF') + '</button></div></div>' +
      '<p class="faint noprint" style="margin:-6px 0 14px;font-size:12.5px">' + t('Sign-off covers the whole exercise, VAT and withholding tax together.') + '</p>' + (Z.reviewSummary ? Z.reviewSummary() : '');
    var checkRows = function (list) {
      return list.map(function (c) { return '<tr><td>' + Z.tick(c.status) + '</td><td>' + esc(c.id) + '</td><td>' + esc(Z.tt(c, 'title')) + '</td><td class="num">' + (c.a != null ? fmt(c.a) : '') + '</td><td class="num">' + (c.b != null && c.bLabel ? fmt(c.b) : '') + '</td><td class="num">' + (c.diff != null ? fmt(c.diff) : '') + '</td><td style="font-size:12px">' + esc(S.ex.checkNotes[c.id] || (c.status === 'na' ? t('No data') + ': ' + t(c.missing || '') : '')) + '</td></tr>'; }).join('');
    };
    var th = '<thead><tr><th></th><th>#</th><th>' + t('Check') + '</th><th class="num">A</th><th class="num">B</th><th class="num">' + t('Difference') + '</th><th>' + t('Explanation') + '</th></tr></thead>';
    var block = function (title, list) { return list.length ? '<h2>' + title + '</h2><table class="t">' + th + '<tbody>' + checkRows(list) + '</tbody></table>' : ''; };
    var samples = mySamples().map(function (s) { var ev = s.eval || E.evaluateSample(s, s.confidence); return '<tr><td>' + esc(t(POP[s.flow])) + '</td><td>' + esc(t(METHODS[s.method])) + ' · ' + t('seed') + ' ' + s.seed + '</td><td class="num">' + ev.tested + '/' + ev.total + '</td><td class="num">' + ev.rate + '%</td><td class="num">' + fmt(ev.projected) + '</td><td>' + esc(s.conclusion === 'accept' ? t('Population accepted') : s.conclusion === 'reject' ? t('Not accepted') : t('Testing')) + '</td></tr>'; }).join('');
    var finds = S.findings.filter(myFinding).map(function (f) { return '<tr><td>' + esc(t(Z.cap(f.severity))) + '</td><td>' + esc(f.title) + '<div style="font-size:12px;color:#555">' + esc(f.action || '') + '</div></td><td class="num">' + fmt(f.taxImpact) + '</td><td class="num">' + fmt(f.penalty) + '</td><td>' + esc(f.owner || '') + ' ' + esc(f.due || '') + '</td><td>' + esc(f.status) + '</td></tr>'; }).join('');
    var docs = (S.checklist.items || []).filter(function (x) { return x.status !== 'na' && myArea(x.area); });
    var filing = R.filing.checks.filter(function (c) { return (c.id === 'C3') === wht; });
    var body;
    if (wht) {
      var name = function (k) { var w = E.WHT_TYPES.filter(function (x) { return x[0] === k; })[0]; return w ? (S.lang === 'ar' ? w[2] : w[1]) : k; };
      var lines = R.wht.lines.map(function (l) { return '<tr><td>' + esc(name(l.type)) + '</td><td class="num">' + fmt(l.ret.a) + '</td><td class="num">' + fmt(l.ret.t) + '</td><td class="num">' + fmt(l.reg.t) + '</td><td class="num">' + fmt(l.dRegTax) + '</td></tr>'; }).join('');
      body = (lines ? '<h2>' + t('WHT return by payment type') + '</h2><table class="t"><thead><tr><th>' + t('Payment type') + '</th><th class="num">' + t('Return amount') + '</th><th class="num">' + t('Return tax') + '</th><th class="num">' + t('Register WHT') + '</th><th class="num">' + t('Return − Register') + '</th></tr></thead><tbody>' + lines + '</tbody></table>' : '') +
        block(t('WHT reconciliation'), R.wht.checks) + block(t('Filing and payment'), filing) + block(t('Bank trace'), R.bank.checks.filter(function (c) { return c.id === 'B5'; }));
    } else {
      var boxRows = b ? E.BOXES.map(function (bx) { return '<tr' + (bx.total || bx.n >= 13 ? ' class="total"' : '') + '><td>' + bx.n + '</td><td>' + esc(S.lang === 'ar' ? bx.ar : bx.en) + '</td><td class="num">' + (bx.vatOnly ? '' : fmt((+b[bx.n].amount || 0) + (+b[bx.n].adj || 0))) + '</td><td class="num">' + fmt(b[bx.n].vat) + '</td></tr>'; }).join('') : '';
      var an = R.analytics.tests.filter(function (x) { return x.status === 'fail' || x.status === 'warn'; });
      body = (boxRows ? '<h2>' + t('VAT return as filed') + '</h2><table class="t"><thead><tr><th>#</th><th>' + t('Box') + '</th><th class="num">' + t('Amount') + '</th><th class="num">' + t('VAT') + '</th></tr></thead><tbody>' + boxRows + '</tbody></table>' : '') +
        block(t('VAT reconciliation'), R.vat.checks) + block(t('Filing and payment'), filing) + block(t('E-invoicing: ERP, provider and ZATCA'), R.einv.checks) +
        block(t('Bank reconciliation'), R.bank.checks) + block(t('Marketplaces, real estate and excise'), R.other.checks) +
        '<h2>' + t('Data analytics exceptions') + '</h2>' + (an.length ? '<table class="t"><tbody>' + an.map(function (x) { return '<tr><td>' + Z.tick(x.status) + '</td><td>' + esc(x.id) + '</td><td>' + esc(Z.tt(x, 'title')) + '</td><td class="num">' + Z.count(x.count) + '</td><td class="num">' + (x.amount ? fmt(x.amount) : '') + '</td></tr>'; }).join('') + '</tbody></table>' : '<p>' + t('No exceptions.') + '</p>');
    }
    return ctl + '<article class="report"><div class="cover"><div><p style="margin:0;color:#555">' + (wht ? t('Withholding tax inspection readiness pack') : t('VAT inspection readiness pack')) + '</p><h1>' + esc(ent.name) + (ent.nameAr ? ' - ' + esc(ent.nameAr) : '') + '</h1><p style="margin:6px 0 0">' + t('TRN') + ' ' + esc(ent.trn || '-') + ' · ' + t('CR') + ' ' + esc(ent.cr || '-') + ' · ' + t('Period') + ' <b>' + Z.ltr(ex.period) + '</b> (' + Z.ltr(E.periodRange(ex.period).start + ' → ' + E.periodRange(ex.period).end) + ')</p>' +
      '<p style="margin:4px 0 0;color:#555">' + t('Prepared') + ' ' + Z.ltr(Z.today()) + ' · ' + t('Status') + ': ' + esc({ in_progress: t('In progress'), review: t('Under review'), closed: t('Signed off') }[ex.status] || '') + (ex.signedOffBy ? ' - ' + esc(ex.signedOffBy) + ' ' + esc(String(ex.signedOffAt).slice(0, 10)) : '') + '</p></div>' + Z.seal(sc.score, sc.grade) + '</div>' +
      '<h2>' + t('Summary') + '</h2><table class="t"><tbody>' + Object.keys(S.settings.weights).map(function (k) { return sc.parts[k] == null ? '' : '<tr><td>' + t(Z.partName(k)) + '</td><td class="num">' + Math.round(sc.parts[k] * 100) + '%</td></tr>'; }).join('') +
      '<tr class="total"><td>' + (wht ? t('WHT exposure (SAR)') : t('VAT exposure (SAR)')) + '</td><td class="num">' + fmt(expo) + '</td></tr></tbody></table>' + body +
      '<h2>' + t('Sample testing') + '</h2>' + (samples ? '<table class="t"><thead><tr><th>' + t('Population') + '</th><th>' + t('Method') + '</th><th class="num">' + t('Tested') + '</th><th class="num">' + t('Deviation rate') + '</th><th class="num">' + t('Projected') + '</th><th>' + t('Conclusion') + '</th></tr></thead><tbody>' + samples + '</tbody></table>' : '<p>' + t('No samples selected.') + '</p>') +
      '<h2>' + t('Findings and corrective actions') + '</h2>' + (finds ? '<table class="t"><thead><tr><th>' + t('Severity') + '</th><th>' + t('Finding') + '</th><th class="num">' + t('Tax impact') + '</th><th class="num">' + t('Penalty') + '</th><th>' + t('Owner / due') + '</th><th>' + t('Status') + '</th></tr></thead><tbody>' + finds + '</tbody></table>' : '<p>' + t('No findings.') + '</p>') +
      '<h2>' + t('Inspection file') + '</h2><table class="t"><tbody>' + docs.map(function (x) { return '<tr><td>' + Z.tick(x.status === 'available' ? 'pass' : x.status === 'requested' ? 'warn' : 'fail') + '</td><td>' + esc(S.lang === 'ar' ? x.ar : x.en) + '</td><td>' + esc(x.owner || '') + '</td></tr>'; }).join('') + '</tbody></table>' +
      '<div class="sig"><div>' + t('Prepared by') + '</div><div>' + t('Reviewed and signed off by') + (ex.signedOffBy ? ': ' + esc(ex.signedOffBy) : '') + '</div></div></article>';
  };
  Z.ACT.print = function () { window.print(); };
  Z.ACT.exstatus = function (el) {
    var s = el.dataset.s;
    if (s === 'closed' && !confirm(t('Sign off this exercise? It becomes read-only until a manager reopens it.'))) return;
    Z.saveSummary().then(function () { S.ex.status = s; return Z.saveEx(); }).then(function () { Z.toast(s === 'closed' ? t('Exercise signed off') : t('Status updated')); Z.route(); })
      .catch(function () { S.loaded = false; Z.route(); });
  };
  Z.ACT.exportxl = function () {
    var R = S.R, wb = XLSX.utils.book_new(), add = function (name, aoa) { XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name); };
    var wht = Z.isWht(), sc = (wht ? R.whtScore : R.vatScore) || R.score, b = R.vat.boxes;
    var filing = R.filing.checks.filter(function (c) { return (c.id === 'C3') === wht; });
    var checks = wht ? filing.concat(R.wht.checks, R.bank.checks.filter(function (c) { return c.id === 'B5'; })) : filing.concat(R.vat.checks, R.einv.checks, R.bank.checks, R.other.checks);
    add('Summary', [['Entity', (Z.entity(S.ex.entityId) || {}).name], ['Tax', wht ? 'Withholding tax' : 'VAT'], ['Period', S.ex.period], ['Readiness %', sc.score], ['Grade', Z.gradeText(sc.grade)], ['Exposure (SAR)', wht ? R.whtExposure || 0 : R.vatExposure || 0]].concat(Object.keys(sc.parts).filter(function (k) { return sc.parts[k] != null; }).map(function (k) { return [Z.partName(k), Math.round(sc.parts[k] * 100)]; })));
    if (!wht) add('VAT boxes', [['Box', 'Description', 'Return amount', 'Return VAT', 'System amount', 'System VAT', 'Excel amount', 'Excel VAT']].concat(E.BOXES.map(function (bx) {
      var g = function (B, f) { return B ? (f === 'amount' ? (+B[bx.n].amount || 0) + (+B[bx.n].adj || 0) : B[bx.n].vat) : ''; };
      return [bx.n, bx.en, g(b.ret, 'amount'), g(b.ret, 'vat'), g(b.sys, 'amount'), g(b.sys, 'vat'), g(b.xls, 'amount'), g(b.xls, 'vat')];
    })));
    add('Checks', [['Area', 'Check', 'Title', 'Status', 'A', 'A label', 'B', 'B label', 'Difference', 'Exposure', 'Explanation']].concat(checks.map(function (c) { return [c.group, c.id, c.title, c.status, c.a, c.aLabel, c.b, c.bLabel, c.diff, c.exposure || '', S.ex.checkNotes[c.id] || '']; })));
    if (!wht) add('Analytics', [['Test', 'Title', 'Severity', 'Status', 'Items', 'Amount']].concat(R.analytics.tests.map(function (x) { return [x.id, x.title, x.severity, x.status, x.count, x.amount]; })));
    var ex = [['Check', 'Exception', 'Date', 'Reference', 'Party / description', 'Amount', 'Detail']];
    checks.forEach(function (c) { Object.keys(c.exceptions || {}).forEach(function (k) { c.exceptions[k].forEach(function (r) { ex.push([c.id, k, r.date, r.invoice || r.reference || r.doc || '', r.party || r.description || '', r.net || r.credit || r.debit || r.gross || '', r.reason || r.status || '']); }); }); });
    if (!wht) R.analytics.tests.forEach(function (x) { x.items.forEach(function (r) { ex.push([x.id, x.title, r.date, r.invoice, r.party, r.net, r.reason || '']); }); });
    add('Exceptions', ex);
    if (!wht) add('Bank lines', [['Date', 'Description', 'Reference', 'Out', 'In', 'Class']].concat(R.bank.lines.map(function (l) { return [l.date, l.description, l.reference, l.debit, l.credit, Z.bankClassName(l.cls)]; })));
    if (wht) add('WHT', [['Payment type', 'Return amount', 'Return tax', 'Register gross', 'Register WHT', 'Excel tax', 'Return - Register']].concat(R.wht.lines.map(function (l) { return [l.type, l.ret.a, l.ret.t, l.reg.a, l.reg.t, l.xls.t, l.dRegTax]; })));
    add('Samples', [['Population', 'Method', 'Seed', 'Ref', 'Date', 'Party', 'Book', 'Audited', 'Failed attributes', 'Evidence']].concat([].concat.apply([], mySamples().map(function (s) { return s.items.map(function (x) { return [POP[s.flow], s.method, s.seed, x.ref, x.date, x.party, x.book, x.audited, Object.keys(x.tests).filter(function (k) { return x.tests[k] === 'fail'; }).join(', '), x.evidence]; }); }))));
    add('Findings', [['Severity', 'Title', 'Tax', 'Tax impact', 'Penalty', 'Correction', 'Root cause', 'Action', 'Owner', 'Due', 'Status']].concat(S.findings.filter(myFinding).map(function (f) { return [f.severity, f.title, f.tax, f.taxImpact, f.penalty, f.route, f.cause, f.action, f.owner, f.due, f.status]; })));
    add('Documents', [['Area', 'Document', 'Status', 'Owner', 'Link']].concat((S.checklist.items || []).filter(function (x) { return myArea(x.area); }).map(function (x) { return [x.area, x.en, x.status, x.owner, x.link]; })));
    XLSX.writeFile(wb, (wht ? 'wht' : 'vat') + '-inspection-pack-' + ((Z.entity(S.ex.entityId) || {}).name || '').replace(/\W+/g, '-') + '-' + S.ex.period + '.xlsx');
  };

  // ---------------------------------------------------------------- demo
  Z.ACT.loaddemo = function () {
    var d = ZDemo.gen();
    Z.toast(t('Loading the demo company…'));
    var ent = Object.assign({ demo: true, active: true }, d.entity), entId;
    Z.save('entities', ent).then(function (e) {
      entId = e.id;
      var byP = {}; d.history.forEach(function (h) { byP[h.period] = h; });
      var hist = [['2026-06', 92, 7650, 96], ['2026-07', 88, 8920, 90], ['2026-08', 81, 9840, 78]].map(function (h) {
        var f = byP[h[0]] || {};
        return { entityId: e.id, period: h[0], status: 'closed', pkeys: h[0] === '2026-08' ? Object.keys(d.priorPurchaseKeys) : [], signedOffBy: 'Tax manager', signedOffAt: h[0] + '-28T10:00:00Z', label: e.name + ' ' + h[0], reconItems: [], checkNotes: {}, bankOverrides: {},
          filing: { vatFiledOn: E.deadlines(h[0]).vat, vatPaidOn: E.deadlines(h[0]).vat, whtFiledOn: E.deadlines(h[0]).wht, whtPaidOn: E.deadlines(h[0]).wht },
          summary: { score: h[1], grade: h[1] >= 85 ? 'ready' : 'mostly', exposure: h[1] > 90 ? 0 : 4200, fails: h[1] > 90 ? 0 : 1, warns: 1,
            vatScore: h[1], vatGrade: h[1] >= 85 ? 'ready' : 'mostly', vatExposure: h[1] > 90 ? 0 : 4200, vatFails: h[1] > 90 ? 0 : 1,
            whtScore: h[3], whtGrade: h[3] >= 85 ? 'ready' : 'mostly', whtExposure: h[3] >= 85 ? 0 : 980, whtFails: h[3] >= 85 ? 0 : 1, netVat: f.netVat, whtTax: h[2], openFindings: 0,
            sales: f.sales, inputVat: f.inputVat, outputVat: f.outputVat, zeroShare: f.zeroShare, vatLateDays: 0, whtLateDays: 0 } };
      });
      return Z.call('saveMany', { table: 'exercises', docs: hist });
    }).then(function () {
      return Z.save('exercises', { entityId: entId, period: d.period, status: 'in_progress', label: ent.name + ' ' + d.period, returnBoxes: d.returnBoxes, reconItems: d.reconItems.map(function (r) { return Object.assign({ id: Z.uid('RI') }, r); }), checkNotes: {}, bankOverrides: {}, filing: d.filing, recovery: d.recovery, exciseReturn: d.exciseReturn });
    }).then(function (ex) {
      var files = { tb: 'TB_Sep2026.xlsx', gl: 'GL_foreign_services.xlsx', sys_vat: 'NetSuite_VAT_Report_Sep2026.xlsx', xls_vat: 'VAT_workings_Sep2026.xlsx', einv: 'Fatoora_export_Sep2026.csv', einv_provider: 'EInvoicing_provider_log_Sep2026.xlsx', pos: 'POS_mada_settlements_Sep2026.xlsx', rett: 'RETT_register_2026.xlsx', excise: 'Excise_register_Sep2026.xlsx', excise_stock: 'Excise_stock_Sep2026.xlsx', customs: 'Customs_Bayan_Sep2026.xlsx', bank: 'SNB_statement_Sep2026.xlsx', wht_reg: 'WHT_register_Sep2026.xlsx', ret_wht: 'WHT_return_Sep2026.xlsx', xls_wht: 'WHT_workings_Sep2026.xlsx' };
      var jobs = Object.keys(d.datasets).map(function (k) {
        var rows = d.datasets[k].map(function (r, i) { return Object.assign({ _r: i + 2 }, r); });
        return Z.save('datasets', { parentId: ex.id, kind: k, fileName: files[k], rowCount: rows.length, errors: 0, uploadedAt: new Date().toISOString(), label: files[k] })
          .then(function (ds) { return Z.save('rows', Object.assign({ id: ds.id, parentId: ex.id }, Z.pack(rows))); });
      });
      var cl = { id: ex.id, parentId: ex.id, items: E.DEFAULT_CHECKLIST.map(function (c, i) { return { id: 'c' + i, area: c[0], en: c[1], ar: c[2], status: i < 7 || i === 14 || i === 17 ? 'available' : i === 9 || i === 20 ? 'requested' : 'missing', owner: i < 7 ? 'Tax team' : '', link: i < 3 ? 'https://drive.google.com/' : '', note: '' }; }) };
      jobs.push(Z.save('checklists', cl));
      d.requests.forEach(function (q) { jobs.push(Z.save('requests', Object.assign({ entityId: entId }, q))); });
      jobs.push(Z.save('annual', { id: entId + '_2025', entityId: entId, year: 2025, items: [], zakat: d.zakat2025 }));
      jobs.push(Z.save('statements', Object.assign({ id: entId + '_soa', entityId: entId, label: 'ZATCA statement of account' }, d.statement)));
      d.disputes.forEach(function (x) { jobs.push(Z.save('disputes', Object.assign({ entityId: entId, label: x.reference }, x))); });
      d.refunds.forEach(function (x) { jobs.push(Z.save('refunds', Object.assign({ entityId: entId, label: x.period }, x))); });
      jobs.push(Z.save('corporate', Object.assign({ id: entId + '_corp_2026', entityId: entId, year: 2026, label: 'Income tax 2026' }, d.corporate)));
      jobs.push(Z.save('devices', { id: entId + '_egs', entityId: entId, list: d.devices, label: 'E-invoicing devices' }));
      jobs.push(Z.save('registers', Object.assign({ id: entId + '_reg', entityId: entId, label: 'VAT adjustments' }, d.registers)));
      d.events.forEach(function (x) { jobs.push(Z.save('events', Object.assign({ entityId: entId, label: x.title }, x))); });
      var ent2 = { name: 'Al Noor Logistics LLC', nameAr: 'النور للخدمات اللوجستية', trn: '311987654300003', cr: '1010223344', vatFreq: 'quarterly', whtRegistered: false, erp: 'Odoo', active: true, demo: true, mapping: { outputVat: '2210', inputVat: '1410', revenue: '4*' } };
      jobs.push(Z.save('entities', ent2).then(function (e2) {
        return Z.call('saveMany', { table: 'exercises', docs: [['2026-Q1', 84], ['2026-Q2', 73]].map(function (h) { return { entityId: e2.id, period: h[0], status: 'closed', signedOffBy: 'Tax manager', label: e2.name + ' ' + h[0], summary: { score: h[1], grade: h[1] >= 85 ? 'ready' : h[1] >= 70 ? 'mostly' : 'risk', exposure: 0, fails: 1, netVat: 96000 }, filing: { vatFiledOn: E.deadlines(h[0]).vat, vatPaidOn: E.deadlines(h[0]).vat }, reconItems: [], checkNotes: {}, bankOverrides: {} }; }) });
      }));
      return Promise.all(jobs).then(function () { return ex; });
    }).then(function (ex) {
      S.exId = null; S.loaded = false;
      return Z.reloadAll().then(function () { location.hash = '#/ex/' + ex.id + '/overview'; });
    });
  };
})();
