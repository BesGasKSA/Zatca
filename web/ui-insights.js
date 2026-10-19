/* Company 360 and the action plan.
   One screen per company and tax section: the returns over time, the latest
   inspection result, which sources agree and which do not, what is at stake,
   and a prioritised plan of what to do, by when, and what acting now saves.
   All figures come from the engine (E.remediate via runAll -> R.plan); this
   file only lays them out. */
(function () {
  'use strict';
  var E = window.ZEngine, S = Z.S, t = Z.t, esc = Z.esc, fmt = Z.fmt;
  var reduced = function () { return window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches; };

  // ---------------------------------------------------------------- helpers
  var ROUTE = {
    amend: ['Amend the original return', 'file-arrow-up'], next: ['Correct in the next return', 'calendar-plus'], pay: ['Pay now', 'currency-circle-dollar'],
    reclaim: ['Reclaim in a later return', 'arrow-u-up-left'], einv: ['Fix on Fatoora', 'receipt'], book: ['Correct the books', 'notebook'], doc: ['Collect the evidence', 'paperclip']
  };
  var LEVEL = { critical: ['Critical', 'fail'], high: ['High', 'risk'], medium: ['Medium', 'warn'], low: ['Low', 'na'] };
  var mine = function (a) { return Z.isWht() ? a.tax === 'WHT' : a.tax !== 'WHT'; };
  var doneMap = function () { return (S.ex && S.ex.actionsDone) || {}; };
  var isDone = function (a) { return !!doneMap()[a.checkId]; };
  // true when no check in this section has anything to compare yet
  Z.sectionEmpty = function () {
    var R = S.R; if (!R) return true;
    var list = Z.isWht() ? R.wht.checks.concat(R.filing.checks.filter(function (c) { return c.id === 'C3'; }))
      : R.vat.checks.concat(R.bank.checks, R.einv.checks, R.other.checks, R.filing.checks.filter(function (c) { return c.id !== 'C3'; }));
    return !list.some(function (c) { return c.status !== 'na'; });
  };
  var noDataCard = function () {
    return '<section class="paper empty">' + Z.icon('upload-simple') + '<h2>' + t('No data to check yet') + '</h2><p>' + t('Load the return and the reports for this period; the action plan appears as soon as the checks can compare them.') + '</p>' +
      (S.ex ? '<a class="btn primary" href="#/ex/' + S.ex.id + '/data">' + t('Load the data') + '</a>' : '') + '</section>';
  };
  Z.planFor = function () {
    var acts = ((S.R && S.R.plan && S.R.plan.actions) || []).filter(mine);
    var open = acts.filter(function (a) { return !isDone(a); }), counted = open.filter(function (a) { return a.counted; });
    var sum = function (k) { return Math.round(counted.reduce(function (s, a) { return s + (a[k] || 0); }, 0) * 100) / 100; };
    return { all: acts, open: open, done: acts.length - open.length, critical: open.filter(function (a) { return a.level === 'critical'; }).length,
      impact: sum('impact'), costNow: sum('costNow'), costLater: sum('costLater'), avoided: sum('avoided'), recover: sum('recover'),
      next: open.filter(function (a) { return a.deadline; }).sort(function (a, b) { return a.deadline < b.deadline ? -1 : 1; })[0] };
  };
  function countdown(a) {
    var d = a.daysLeft;
    if (d == null) return '';
    var cls = d < 0 ? 'fail' : d <= 7 ? 'warn' : 'na';
    var txt = d < 0 ? t('Overdue by') + ' ' + -d + ' ' + t('days') : d === 0 ? t('Due today') : d + ' ' + t('days left');
    return '<span class="cd ' + cls + '" title="' + esc(t('Deadline') + ' ' + a.deadline) + '">' + Z.icon(d < 0 ? 'alarm' : 'clock') + ' ' + txt + '</span>';
  }
  var money = function (v, cls) { return '<b class="num' + (cls ? ' ' + cls : '') + '" data-count="' + (+v || 0) + '">' + fmt(v || 0, 0) + '</b>'; };

  // ---------------------------------------------------------------- charts (plain SVG, animated by CSS)
  // grouped bars with an optional line; values in SAR
  function barChart(labels, series, line, h) {
    var W = 720, H = h || 220, pl = 54, pr = 12, pt = 14, pb = 28, n = labels.length || 1;
    var all = [].concat.apply([], series.map(function (s) { return s.values; })).concat(line ? line.values : []).map(function (v) { return Math.abs(+v || 0); });
    var max = Math.max.apply(null, all.concat([1])), step = Math.pow(10, Math.floor(Math.log10(max))), top = Math.ceil(max / step) * step;
    var y = function (v) { return pt + (H - pt - pb) * (1 - Math.max(0, +v || 0) / top); };
    var gw = (W - pl - pr) / n, bw = Math.min(22, gw / (series.length + 1));
    var grid = [0, .25, .5, .75, 1].map(function (f) { var v = top * f, yy = y(v); return '<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + yy + '" y2="' + yy + '" class="gl"/><text x="' + (pl - 8) + '" y="' + (yy + 4) + '" class="ax" text-anchor="end">' + Z.fmt(v / 1000, 0) + 'k</text>'; }).join('');
    var bars = labels.map(function (l, i) {
      var x0 = pl + gw * i + (gw - bw * series.length) / 2;
      return series.map(function (s, k) { var v = +s.values[i] || 0, yy = y(v); return v ? '<rect class="cbar s' + k + '" style="--i:' + i + '" x="' + (x0 + k * bw) + '" y="' + yy + '" width="' + (bw - 3) + '" height="' + Math.max(1, H - pb - yy) + '" rx="3"><title>' + esc(s.name + ' ' + l + ': ' + fmt(v, 0)) + '</title></rect>' : ''; }).join('') +
        '<text x="' + (pl + gw * i + gw / 2) + '" y="' + (H - 8) + '" class="ax" text-anchor="middle">' + esc(l) + '</text>';
    }).join('');
    var path = '';
    if (line) {
      var pts = line.values.map(function (v, i) { return v == null ? null : [pl + gw * i + gw / 2, y(v)]; }).filter(Boolean);
      if (pts.length > 1) path = '<path class="ln draw" d="M' + pts.map(function (p) { return p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' L') + '"/>' + pts.map(function (p, i) { return '<circle class="dot" style="--i:' + i + '" cx="' + p[0] + '" cy="' + p[1] + '" r="3.5"/>'; }).join('');
    }
    var legend = series.map(function (s, k) { return '<span><i class="sw s' + k + '"></i>' + esc(s.name) + '</span>'; }).join('') + (line ? '<span><i class="sw ln"></i>' + esc(line.name) + '</span>' : '');
    return '<div class="chart"><svg direction="ltr" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(series.map(function (s) { return s.name; }).join(', ')) + '">' + grid + bars + path + '</svg><div class="legend">' + legend + '</div></div>';
  }
  function trendChart(labels, values) {
    var W = 380, H = 230, pl = 30, pr = 10, pt = 10, pb = 26, n = labels.length;
    var x = function (i) { return pl + (n < 2 ? 0 : (W - pl - pr) * i / (n - 1)); }, y = function (v) { return pt + (H - pt - pb) * (1 - v / 100); };
    var pts = values.map(function (v, i) { return v == null ? null : [x(i), y(v), v, labels[i]]; }).filter(Boolean);
    var bands = [[85, 100, 'ok'], [70, 85, 'mid'], [0, 70, 'low']].map(function (b) { return '<rect class="band ' + b[2] + '" x="' + pl + '" y="' + y(b[1]) + '" width="' + (W - pl - pr) + '" height="' + (y(b[0]) - y(b[1])) + '"/>'; }).join('');
    var axis = [0, 50, 85, 100].map(function (v) { return '<text x="' + (pl - 6) + '" y="' + (y(v) + 4) + '" class="ax" text-anchor="end">' + v + '</text>'; }).join('') +
      labels.map(function (l, i) { return (n - 1 - i) % 2 ? '' : '<text x="' + x(i) + '" y="' + (H - 8) + '" class="ax" text-anchor="middle">' + esc(l) + '</text>'; }).join('');
    var d = pts.length > 1 ? 'M' + pts.map(function (p) { return p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' L') : '';
    var area = pts.length > 1 ? '<path class="area" d="' + d + ' L' + pts[pts.length - 1][0].toFixed(1) + ' ' + y(0) + ' L' + pts[0][0].toFixed(1) + ' ' + y(0) + ' Z"/>' : '';
    return '<div class="chart"><svg direction="ltr" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(t('Readiness over time')) + '">' + bands + axis + area + (d ? '<path class="ln draw" d="' + d + '"/>' : '') +
      pts.map(function (p, i) { return '<circle class="dot" style="--i:' + i + '" cx="' + p[0] + '" cy="' + p[1] + '" r="4"><title>' + esc(p[3] + ': ' + p[2] + '%') + '</title></circle>'; }).join('') + '</svg></div>';
  }
  function hbars(rows) {
    var max = Math.max.apply(null, rows.map(function (r) { return r.v; }).concat([1]));
    return '<div class="hbars">' + rows.map(function (r, i) {
      return '<div class="hb" style="--i:' + i + '"><span>' + esc(r.label) + '</span><div class="track"><i style="--w:' + Math.max(2, r.v / max * 100).toFixed(1) + '%"></i></div><b class="num">' + fmt(r.v, 0) + '</b></div>';
    }).join('') + '</div>';
  }

  // ---------------------------------------------------------------- the action plan (shared by Company 360 and the exercise tab)
  Z.actionCard = function (a, i, opts) {
    opts = opts || {};
    var lv = LEVEL[a.level] || LEVEL.low, rt = ROUTE[a.route] || ROUTE.book, done = isDone(a), lk = Z.locked && Z.locked();
    var tab = { vat: 'vat', bank: 'bank', einv: 'einv', filing: 'filing', other: 'other', wht: 'wht', analytics: 'analytics' }[a.group] || 'overview';
    var maxCost = Math.max(a.costLater || 0, a.costNow || 0, 1);
    var cost = a.recover ? '<div class="cost good">' + Z.icon('arrow-u-up-left') + ' ' + t('Tax to reclaim') + ' <b class="num">' + fmt(a.recover, 0) + '</b></div>' :
      (a.costLater || a.costNow) ? '<div class="cost"><div class="cb"><span>' + t('If you act now') + '</span><div class="track"><i class="now" style="--w:' + (a.costNow / maxCost * 100).toFixed(1) + '%"></i></div><b class="num">' + fmt(a.costNow, 0) + '</b></div>' +
        '<div class="cb"><span>' + t('If an inspector finds it') + '</span><div class="track"><i class="later" style="--w:' + (a.costLater / maxCost * 100).toFixed(1) + '%"></i></div><b class="num">' + fmt(a.costLater, 0) + '</b></div></div>' :
      a.upTo ? '<div class="cost muted">' + t('E-invoicing violations: fines up to SAR') + ' ' + fmt(a.upTo, 0) + ' ' + t('each, usually after a warning') + '</div>' : '';
    return '<article class="act lv-' + a.level + (done ? ' done' : '') + '" style="--i:' + (i || 0) + '">' +
      '<header><span class="pill ' + lv[1] + '">' + t(lv[0]) + '</span><span class="route">' + Z.icon(rt[1]) + ' ' + t(rt[0]) + '</span>' + countdown(a) +
      (a.counted === false ? '<span class="same" title="' + esc(t('Counted once with') + ' ' + a.sameAs) + '">' + Z.icon('link') + ' ' + t('Same difference as') + ' ' + esc(a.sameAs) + '</span>' : '') + '</header>' +
      '<h3><span class="cid">' + esc(a.checkId) + '</span> ' + esc(Z.tt(a, 'title')) + '</h3>' +
      '<div class="facts">' + (a.impact ? '<span>' + t('Tax at stake') + ' <b class="num">' + fmt(a.impact, 0) + '</b></span>' : '') + (a.count ? '<span>' + t('Items') + ' <b class="num">' + a.count + '</b></span>' : '') +
      (a.match && a.match.length ? '<span class="match">' + Z.icon('arrows-left-right') + ' ' + a.match.map(function (m) { return esc(t(m)); }).join(' ↔ ') + '</span>' : '') + '</div>' + cost +
      '<details' + (opts.open ? ' open' : '') + '><summary>' + t('How to fix it') + ' (' + a.steps.length + ')</summary><ol>' + a.steps.map(function (s) { return '<li>' + esc(S.lang === 'ar' ? s.ar : s.en) + '</li>'; }).join('') + '</ol></details>' +
      '<footer>' + (S.ex ? '<a class="btn small ghost" href="#/ex/' + S.ex.id + '/' + tab + '">' + Z.icon('magnifying-glass') + ' ' + t('Open the check') + '</a>' : '') +
      (S.ex && !lk ? '<button class="btn small ' + (done ? 'ghost' : 'primary') + '" data-act="actdone" data-id="' + esc(a.checkId) + '">' + Z.icon(done ? 'arrow-counter-clockwise' : 'check') + ' ' + (done ? t('Reopen') : t('Mark as done')) + '</button>' : '') + '</footer></article>';
  };
  Z.ACT.actdone = function (el) {
    var id = el.dataset.id; S.ex.actionsDone = S.ex.actionsDone || {};
    if (S.ex.actionsDone[id]) delete S.ex.actionsDone[id]; else S.ex.actionsDone[id] = { at: new Date().toISOString(), by: S.user.name };
    Z.saveEx().then(function () { Z.toast(S.ex.actionsDone[id] ? t('Marked as done') : t('Reopened')); Z.route(); });
  };
  Z.CHG.planlevel = function (el) { S.planLevel = el.value; Z.route(); };
  Z.CHG.planshow = function (el) { S.planShow = el.value; Z.route(); };

  // exercise tab: the full plan for this section
  Z.tabs.plan = Z.tabsW.plan = function () {
    if (Z.sectionEmpty()) return noDataCard();
    var p = Z.planFor(), lv = S.planLevel || '', show = S.planShow || 'open';
    var list = (show === 'all' ? p.all : show === 'done' ? p.all.filter(isDone) : p.open).filter(function (a) { return !lv || a.level === lv; });
    var pct = p.all.length ? Math.round(p.done / p.all.length * 100) : 100;
    var opt = function (v, cur, l) { return '<option value="' + v + '"' + (v === cur ? ' selected' : '') + '>' + l + '</option>'; };
    return planHero(p) +
      '<section class="paper"><header><div><h2>' + t('Progress') + '</h2><p>' + p.done + ' / ' + p.all.length + ' ' + t('actions done') + '</p></div>' +
      '<div class="row"><select data-chg="planshow" aria-label="' + t('Show') + '">' + opt('open', show, t('Open actions')) + opt('done', show, t('Done')) + opt('all', show, t('All actions')) + '</select>' +
      '<select data-chg="planlevel" aria-label="' + t('Priority') + '">' + opt('', lv, t('All priorities')) + ['critical', 'high', 'medium', 'low'].map(function (k) { return opt(k, lv, t(LEVEL[k][0])); }).join('') + '</select></div></header>' +
      '<div class="progress"><i style="--w:' + pct + '%"></i></div></section>' +
      (list.length ? '<div class="actgrid">' + list.map(function (a, i) { return Z.actionCard(a, i); }).join('') + '</div>' :
        '<section class="paper empty">' + Z.icon('confetti') + '<h2>' + (p.open.length ? t('Nothing at this priority') : t('Every action is done')) + '</h2><p>' + t('Run the checks again after each correction to confirm the sources now agree.') + '</p></section>');
  };
  function planHero(p) {
    var nx = p.next;
    var head = p.open.length ? (p.critical ? t('Fix the critical items first.') + ' ' : '') + t('Acting now instead of waiting for an inspection avoids about SAR') + ' <b class="num">' + fmt(p.avoided, 0) + '</b> ' + t('in penalties') + (nx ? ' — ' + t('next deadline') + ' ' + Z.ltr(nx.deadline) : '') + '.' : t('No open actions in this section.');
    return '<section class="paper hero-plan"><div class="headline">' + Z.icon(p.open.length ? 'lightbulb' : 'seal-check') + '<p>' + head + '</p></div><div class="kpis">' +
      '<div class="' + (p.critical ? 'bad' : '') + '">' + Z.icon('warning-octagon') + '<b data-count="' + p.critical + '">' + p.critical + '</b><span>' + t('Critical actions') + '</span></div>' +
      '<div>' + Z.icon('scales') + money(p.impact) + '<span>' + t('Tax at stake (SAR)') + '</span></div>' +
      '<div>' + Z.icon('timer') + money(p.costNow) + '<span>' + t('Penalties if fixed now (SAR)') + '</span></div>' +
      '<div class="bad">' + Z.icon('hourglass-high') + money(p.costLater) + '<span>' + t('If found at inspection (SAR)') + '</span></div>' +
      '<div class="good">' + Z.icon('shield-check') + money(p.avoided, 'good') + '<span>' + t('Saved by acting now (SAR)') + '</span></div>' +
      (p.recover ? '<div class="good">' + Z.icon('arrow-u-up-left') + money(p.recover) + '<span>' + t('Tax to reclaim (SAR)') + '</span></div>' : '') + '</div>' +
      '<p class="faint fine">' + t('Estimates from the penalty rates in Settings: the error fine on the difference plus late-payment fines to date, versus the same if an inspector finds it') + ' ' + ((S.settings && S.settings.inspectionHorizonMonths) || 12) + ' ' + t('months from now. Not legal advice.') + '</p></section>';
  }

  // ---------------------------------------------------------------- where the sources agree
  var PAIRS = {
    vat: [['Return', 'System report', 'V1'], ['Return', 'Excel workings', 'V2'], ['System report', 'Excel workings', 'V3'], ['Return', 'General ledger', 'V7'],
      ['Revenue (TB)', 'Return box 6', 'V6'], ['Bank receipts', 'Declared sales', 'B1'], ['System sales', 'Fatoora', 'V9'], ['Card takings (POS / mada)', 'B2C sales declared', 'P1'], ['Customs declarations', 'Return box 8', 'V8']],
    wht: [['WHT return', 'WHT register', 'W1'], ['WHT return', 'Excel workings', 'W2'], ['WHT return', 'WHT payable account', 'W4'], ['Foreign transfers', 'WHT register', 'B5'],
      ['GL non-resident expenses', 'WHT register', 'W8'], ['Reverse-charge purchases', 'WHT register', 'X1'], ['WHT payments', 'Reverse-charge VAT', 'X2']]
  };
  function matchMap() {
    var R = S.R, all = [].concat(R.vat.checks, R.bank.checks, R.wht.checks, R.einv.checks);
    var rows = PAIRS[Z.isWht() ? 'wht' : 'vat'].map(function (p) {
      var c = all.filter(function (x) { return x.id === p[2]; })[0];
      return { a: p[0], b: p[1], c: c, st: c ? c.status : 'na' };
    });
    var known = rows.filter(function (r) { return r.st !== 'na'; }), agree = known.filter(function (r) { return r.st === 'pass'; }).length;
    var html = rows.map(function (r, i) {
      var tab = r.c ? ({ vat: 'vat', bank: 'bank', einv: 'einv', wht: 'wht' }[r.c.group] || 'overview') : 'data';
      return '<a class="pair st-' + r.st + '" style="--i:' + i + '" href="#/ex/' + S.ex.id + '/' + tab + '"><span class="node">' + esc(t(r.a)) + '</span><span class="link"><i></i>' + Z.tick(r.st) + '</span><span class="node">' + esc(t(r.b)) + '</span>' +
        '<span class="gap num">' + (r.st === 'na' ? t('No data') : r.st === 'pass' ? t('Agrees') : fmt(r.c.diff, 0)) + '</span></a>';
    }).join('');
    return { html: html, agree: agree, known: known.length };
  }

  // ---------------------------------------------------------------- Company 360
  Z.views.insights = function (h) {
    var wht = Z.isWht();
    var ents = S.entities.filter(function (e) { return e.active !== false && (!wht || e.whtRegistered !== false); });
    if (!ents.length) return Z.setMain('<div class="pagehead"><div><p class="eyebrow">' + Z.taxName() + '</p><h1>' + t('Company 360') + '</h1></div></div>' + (Z.getStarted ? Z.getStarted() : ''));
    var e = Z.entity(h[1]) || Z.entity(S.entityId) || ents[0];
    if (wht && e.whtRegistered === false) e = ents[0];
    S.entityId = e.id;
    var exs = S.exercises.filter(function (x) { return x.entityId === e.id; }).sort(function (a, b) { return a.period < b.period ? 1 : -1; });
    var latest = exs.filter(function (x) { return x.status !== 'closed'; })[0] || exs[0];
    var picker = '<label class="ent-pick big">' + Z.icon('buildings') + '<select data-chg="insent" aria-label="' + t('Company') + '">' + ents.map(function (x) { return '<option value="' + x.id + '"' + (x.id === e.id ? ' selected' : '') + '>' + esc(Z.entName(x)) + '</option>'; }).join('') + '</select></label>';
    var head = '<div class="pagehead"><div><p class="eyebrow">' + Z.taxName() + ' · ' + t('Company 360') + '</p><h1>' + esc(Z.entName(e)) + '</h1><p>' + t('TRN') + ' ' + esc(e.trn || '—') + ' · ' + t(Z.cap(e.vatFreq || 'monthly')) + ' ' + t('VAT filer') +
      (latest ? ' · ' + t('Latest exercise') + ' ' + Z.ltr(latest.period) : '') + '</p></div>' + picker + '</div>';
    if (!latest) return Z.setMain(head + '<section class="paper empty">' + Z.icon('folder-open') + '<h2>' + t('No exercise yet for this company') + '</h2><p>' + t('Start one to see its returns, results and action plan here.') + '</p><a class="btn primary" href="#/entity/' + e.id + '">' + t('Start an exercise') + '</a></section>');
    return Z.loadExercise(latest.id).then(function () {
      var R = S.R, p = Z.planFor(), sc = (wht ? R.whtScore : R.vatScore) || R.score;
      // twelve months of returns from the saved summaries
      var ms = [], cur = E.periodOf(Z.today(), 'monthly');
      for (var i = 0; i < 12; i++) { cur = E.prevPeriod(cur); ms.unshift(cur); }
      var exAt = function (m) { return Z.exFor(e, m); };
      var label = function (m) { return m.slice(5) + '/' + m.slice(2, 4); };
      var sm = function (m) { var x = exAt(m); return x && x.summary || {}; };
      var returns = wht
        ? barChart(ms.map(label), [{ name: t('Paid to non-residents'), values: ms.map(function (m) { return sm(m).whtGross; }) }], { name: t('WHT declared'), values: ms.map(function (m) { return sm(m).whtTax; }) })
        : barChart(ms.map(label), [{ name: t('Output VAT'), values: ms.map(function (m) { return sm(m).outputVat; }) }, { name: t('Input VAT'), values: ms.map(function (m) { return sm(m).inputVat; }) }], { name: t('Net VAT due'), values: ms.map(function (m) { return sm(m).netVat; }) });
      var trend = trendChart(ms.map(label), ms.map(function (m) { return Z.taxScore(sm(m)).score; }));
      var mm = matchMap();
      // what is at stake, by area (each difference counted once)
      var AREA = { vat: 'VAT reconciliation', bank: 'Bank', einv: 'E-invoicing', filing: 'Filing & payment', other: 'Other taxes', wht: 'Withholding tax', analytics: 'Analytics' };
      var byArea = {};
      p.open.filter(function (a) { return a.counted && a.impact; }).forEach(function (a) { var k = t(AREA[a.group] || a.group); byArea[k] = (byArea[k] || 0) + a.impact; });
      var areaRows = Object.keys(byArea).map(function (k) { return { label: k, v: byArea[k] }; }).sort(function (a, b) { return b.v - a.v; });
      var top = p.open.filter(function (a) { return a.counted !== false; }).slice(0, 6);
      var fOpen = S.findings.filter(function (f) { return f.status !== 'closed' && (f.tax === 'WHT') === wht; });
      Z.setMain(head +
        '<div class="i360">' +
        '<section class="paper hero360 reveal" style="--i:0"><div class="ringbox">' + Z.seal(sc.score, sc.grade) + '<div><span class="eyebrow">' + t('Readiness') + '</span><b class="grade g-' + sc.grade + '">' + esc(Z.gradeText(sc.grade)) + '</b><span class="faint">' + Z.ltr(latest.period) + ' · ' + esc({ in_progress: t('In progress'), review: t('Under review'), closed: t('Signed off') }[latest.status] || '') + '</span></div></div>' +
        '<div class="kpis">' +
        '<div>' + Z.icon('scales') + money(p.impact) + '<span>' + t('Tax at stake (SAR)') + '</span></div>' +
        '<div class="bad">' + Z.icon('hourglass-high') + money(p.costLater) + '<span>' + t('Penalties if left to an inspector (SAR)') + '</span></div>' +
        '<div class="good">' + Z.icon('shield-check') + money(p.avoided, 'good') + '<span>' + t('Saved by acting now (SAR)') + '</span></div>' +
        '<div class="' + (p.critical ? 'bad' : '') + '">' + Z.icon('list-checks') + '<b data-count="' + p.open.length + '">' + p.open.length + '</b><span>' + t('Open actions') + (p.critical ? ', ' + p.critical + ' ' + t('critical') : '') + '</span></div>' +
        '<div>' + Z.icon('calendar-check') + '<b>' + (p.next ? (p.next.daysLeft < 0 ? t('Overdue') : p.next.daysLeft === 0 ? t('Today') : p.next.daysLeft + ' ' + t('days')) : '—') + '</b><span>' + t('To the next deadline') + (p.next ? ' · ' + Z.ltr(p.next.deadline) : '') + '</span></div></div></section>' +

        '<section class="paper reveal span2" style="--i:1"><header><div><h2>' + (wht ? t('WHT returns, last 12 months') : t('VAT returns, last 12 months')) + '</h2><p>' + (wht ? t('Gross paid to non-residents and WHT declared, from each month\'s exercise.') : t('Output and input VAT with the net VAT due, from each month\'s exercise.')) + '</p></div></header>' + returns + '</section>' +
        '<section class="paper reveal" style="--i:2"><header><div><h2>' + t('Readiness over time') + '</h2><p>' + t('Green band: ready for an inspection.') + '</p></div></header>' + trend + '</section>' +

        '<section class="paper reveal span2" style="--i:3"><header><div><h2>' + t('Do the reports agree?') + '</h2><p>' + t('Each line compares two sources an inspector puts side by side. Click one to open its check.') + '</p></div><span class="score-chip">' + mm.agree + ' / ' + mm.known + ' ' + t('agree') + '</span></header><div class="pairs">' + mm.html + '</div></section>' +
        '<section class="paper reveal" style="--i:4"><header><div><h2>' + t('Where the tax is at stake') + '</h2><p>' + t('Open actions by area, each difference counted once.') + '</p></div></header>' + (areaRows.length ? hbars(areaRows) : '<p class="muted">' + t('Nothing at stake.') + '</p>') +
        '<div class="mini"><a href="#/ex/' + S.ex.id + '/findings">' + Z.icon('flag') + ' <b>' + fOpen.length + '</b> ' + t('open findings') + '</a><a href="#/requests">' + Z.icon('envelope-simple') + ' ' + t('ZATCA requests') + '</a><a href="#/reports/' + (wht ? 'beneficiaries' : 'corrections') + '">' + Z.icon('chart-bar') + ' ' + (wht ? t('WHT by beneficiary') : t('Corrections register')) + '</a></div></section>' +

        '<section class="span3 reveal" style="--i:5"><div class="spread" style="margin:6px 0 12px"><div><h2 style="margin:0">' + t('What to do next') + '</h2><p class="muted" style="margin:2px 0 0">' + t('Highest risk first. Each action says how to fix it, by when, and what acting now saves.') + '</p></div><a class="btn" href="#/ex/' + S.ex.id + '/plan">' + Z.icon('list-checks') + ' ' + t('Full action plan') + ' (' + p.open.length + ')</a></div>' +
        (Z.sectionEmpty() ? noDataCard() : top.length ? '<div class="actgrid">' + top.map(function (a, i) { return Z.actionCard(a, i); }).join('') + '</div>' : '<section class="paper empty">' + Z.icon('seal-check') + '<h2>' + t('Every action is done') + '</h2></section>') + '</section>' +
        '</div>');
    });
  };
  Z.CHG.insent = function (el) { S.entityId = el.value; try { localStorage.setItem('zr_entity', el.value); } catch (e) {} location.hash = '#/' + S.tax + '/insights/' + el.value; };

  // ---------------------------------------------------------------- motion: count the headline figures up once they render
  Z.animateCounts = function () {
    var els = document.querySelectorAll('#main [data-count]');
    if (!els.length || reduced()) return;
    var t0 = performance.now(), dur = 900;
    var targets = [].map.call(els, function (el) { return { el: el, v: +el.dataset.count || 0 }; });
    var tick = function (now) {
      var k = Math.min(1, (now - t0) / dur), ease = 1 - Math.pow(1 - k, 3);
      targets.forEach(function (x) { x.el.textContent = fmt(Math.round(x.v * ease), 0); });
      if (k < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };
  var setMain = Z.setMain;
  Z.setMain = function (html) { setMain(html); Z.animateCounts(); };
})();
