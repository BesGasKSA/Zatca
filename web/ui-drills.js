/* What sits behind each figure. Every KPI card, readiness bar and "where the
   tax is" bar opens a breakdown drawer listing the parts that make the number,
   largest first, each part linking to where it is fixed.
   Z.autoDrill() recognises the cards by their label, so screens need no
   changes to become drillable. */
(function () {
  'use strict';
  var E = window.ZEngine, S = Z.S, t = Z.t, D = Z.DRILL;
  var isW = function () { return Z.isWht(); };
  var desc = function (a, b) { return (Math.abs(+b.value || 0)) - (Math.abs(+a.value || 0)); };
  var tone = function (g) { return { ready: 'pass', mostly: 'pass', risk: 'warn', not: 'fail' }[g] || ''; };
  var ents = function () { return S.entities.filter(function (e) { return e.active !== false && (!isW() || e.whtRegistered !== false); }); };
  var exsOf = function (e) { return S.exercises.filter(function (x) { return x.entityId === e.id; }).sort(function (a, b) { return a.period < b.period ? 1 : -1; }); };
  var sm = function (x) { return (x && x.summary) || {}; };
  var expo = function (s) { return isW() ? s.whtExposure || 0 : s.vatExposure != null ? s.vatExposure : s.exposure || 0; };
  var fails = function (s) { return isW() ? s.whtFails || 0 : s.vatFails != null ? s.vatFails : s.fails || 0; };
  var TAB = { vat: 'vat', bank: 'bank', einv: 'einv', filing: 'filing', other: 'other', wht: 'wht', analytics: 'analytics', zakat: 'other' };
  var exHref = function (tab) { return S.ex ? '#/ex/' + S.ex.id + '/' + tab : '#/dashboard'; };
  var sec = function () { return Z.taxName(); };

  // ---------------------------------------------------------------- dashboard: across companies
  D.ents = function () {
    var rows = ents().map(function (e) { var x = exsOf(e)[0], s = Z.taxScore(sm(x)); return { label: Z.entName(e), sub: x ? t('Latest exercise') + ' ' + x.period : t('No exercise yet'), value: s.score || 0, display: s.score == null ? '-' : s.score + '%', tone: tone(s.grade), href: '#/insights/' + e.id }; });
    return { title: t('Companies'), sub: sec() + ': ' + t('readiness of the latest exercise'), total: rows.length, totalLabel: t('Companies'), rows: rows.sort(desc) };
  };
  D.open = function () {
    var ids = ents().map(function (e) { return e.id; });
    var rows = S.exercises.filter(function (x) { return x.status !== 'closed' && ids.indexOf(x.entityId) >= 0; }).map(function (x) {
      var s = Z.taxScore(sm(x)); return { label: Z.entName(Z.entity(x.entityId)) + ' ' + x.period, sub: { in_progress: t('In progress'), review: t('Under review') }[x.status] || '', value: s.score || 0, display: s.score == null ? '-' : s.score + '%', tone: tone(s.grade), href: '#/ex/' + x.id + '/overview' };
    });
    return { title: t('Exercises not signed off'), total: rows.length, totalLabel: t('exercises'), rows: rows.sort(desc), empty: t('Every exercise is signed off.') };
  };
  D.avg = function () {
    var rows = ents().map(function (e) {
      var sc = exsOf(e).slice(0, 12).map(function (x) { return Z.taxScore(sm(x)).score; }).filter(function (v) { return v != null; });
      var a = sc.length ? Math.round(sc.reduce(function (p, v) { return p + v; }, 0) / sc.length) : null;
      return { label: Z.entName(e), sub: sc.length + ' ' + t('exercises'), value: a || 0, display: a == null ? '-' : a + '%', tone: a == null ? '' : a >= 85 ? 'pass' : a >= 50 ? 'warn' : 'fail', href: '#/insights/' + e.id };
    });
    return { title: t('Average readiness, last 12 months'), sub: sec(), rows: rows.sort(desc) };
  };
  D.fails = function () {
    var rows = ents().map(function (e) { var x = exsOf(e)[0]; return { label: Z.entName(e), sub: x ? x.period : t('No exercise yet'), value: fails(sm(x)), display: String(fails(sm(x))), tone: 'fail', href: x ? '#/ex/' + x.id + '/plan' : '#/entity/' + e.id }; });
    var tot = rows.reduce(function (a, r) { return a + r.value; }, 0);
    return { title: t('Failed checks in latest exercises'), sub: sec(), total: tot, totalLabel: t('failed checks'), rows: rows.sort(desc) };
  };
  D.expo = function () {
    var rows = ents().map(function (e) { var x = exsOf(e)[0]; return { label: Z.entName(e), sub: x ? x.period : t('No exercise yet'), value: expo(sm(x)), tone: 'fail', href: x ? '#/ex/' + x.id + '/plan' : '#/entity/' + e.id }; });
    return { title: isW() ? t('WHT exposure (SAR)') : t('VAT exposure (SAR)'), sub: t('Latest exercise of each company'), total: rows.reduce(function (a, r) { return a + r.value; }, 0), totalLabel: 'SAR', rows: rows.sort(desc) };
  };

  // ---------------------------------------------------------------- the action plan (Company 360 and the plan tab)
  function plan() { return Z.planFor ? Z.planFor() : { open: [], all: [] }; }
  function actRows(list, field, opt) {
    opt = opt || {};
    return list.map(function (a) {
      var v = field ? +a[field] || 0 : 0;
      return { label: a.checkId + '  ' + Z.tt(a, 'title'), sub: (opt.sub ? opt.sub(a) : t({ critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' }[a.level] || '') + ', ' + t('due') + ' ' + a.deadline) + (a.counted === false ? ', ' + t('same difference as') + ' ' + a.sameAs : ''),
        value: v, display: opt.display ? opt.display(a) : undefined, tone: a.level === 'critical' ? 'fail' : a.level === 'high' ? 'warn' : '', href: exHref(TAB[a.group] || 'plan') };
    });
  }
  var counted = function (k) { return plan().open.filter(function (a) { return a.counted !== false && (+a[k] || 0) > 0; }); };
  D.pimpact = function () { var l = counted('impact'); return { title: t('Tax at stake'), sub: sec() + ': ' + t('each difference counted once'), total: plan().impact, totalLabel: 'SAR', rows: actRows(l, 'impact').sort(desc) }; };
  D.plater = function () { var l = counted('costLater'); return { title: t('Penalties if an inspector finds it'), sub: t('Error fine plus late-payment fines 12 months from now'), total: plan().costLater, totalLabel: 'SAR', rows: actRows(l, 'costLater').sort(desc), note: t('Estimates from the penalty rates in Settings. Not legal advice.') }; };
  D.pnow = function () { var l = counted('costNow'); return { title: t('Penalties if fixed now'), sub: t('What has already accrued'), total: plan().costNow, totalLabel: 'SAR', rows: actRows(l, 'costNow').sort(desc), empty: t('Nothing has accrued yet.') }; };
  D.pavoided = function () { var l = counted('avoided'); return { title: t('Saved by acting now'), sub: t('The fines that keep growing while an error stays open'), total: plan().avoided, totalLabel: 'SAR', rows: actRows(l, 'avoided').sort(desc) }; };
  D.precover = function () { var l = counted('recover'); return { title: t('Tax to reclaim'), total: plan().recover, totalLabel: 'SAR', rows: actRows(l, 'recover').sort(desc) }; };
  D.pcritical = function () { var l = plan().open.filter(function (a) { return a.level === 'critical'; }); return { title: t('Critical actions'), total: l.length, totalLabel: t('actions'), rows: actRows(l, 'impact').sort(desc), empty: t('No critical actions.') }; };
  D.popen = function () {
    var rank = { critical: 0, high: 1, medium: 2, low: 3 }, l = plan().open.slice().sort(function (a, b) { return rank[a.level] - rank[b.level] || b.impact - a.impact; });
    return { title: t('Open actions'), sub: sec(), total: l.length, totalLabel: t('actions'), rows: actRows(l, 'impact') };
  };
  D.pnext = function () {
    var l = plan().open.filter(function (a) { return a.deadline; }).sort(function (a, b) { return a.deadline < b.deadline ? -1 : 1; });
    return { title: t('Deadlines'), sub: t('Soonest first'), money: false, rows: actRows(l, null, { display: function (a) { return a.daysLeft < 0 ? t('Overdue') : a.daysLeft === 0 ? t('Today') : a.daysLeft + ' ' + t('days'); }, sub: function (a) { return a.deadline; } }) };
  };
  D.area = function (label) {
    var l = plan().open.filter(function (a) { return a.counted !== false && a.impact && t(({ vat: 'VAT reconciliation', bank: 'Bank', einv: 'E-invoicing', filing: 'Filing & payment', other: 'Other taxes', wht: 'Withholding tax', analytics: 'Analytics' })[a.group] || a.group) === label; });
    return { title: label, sub: t('Tax at stake by action'), total: l.reduce(function (s, a) { return s + a.impact; }, 0), totalLabel: 'SAR', rows: actRows(l, 'impact').sort(desc) };
  };

  // ---------------------------------------------------------------- one exercise
  function secChecks() {
    var R = S.R; if (!R) return [];
    return isW() ? R.wht.checks.concat(R.filing.checks.filter(function (c) { return c.id === 'C3'; }), R.bank.checks.filter(function (c) { return c.id === 'B5'; }))
      : R.vat.checks.concat(R.bank.checks, R.einv.checks, R.other.checks, R.filing.checks.filter(function (c) { return c.id !== 'C3'; }));
  }
  var checkRow = function (c, v) { return { label: c.id + '  ' + Z.tt(c, 'title'), sub: c.status === 'fail' ? t('Failed') : c.status === 'warn' ? t('Needs explanation') : c.status === 'na' ? t('No data') : t('Passed'), value: v, tone: c.status === 'fail' ? 'fail' : c.status === 'warn' ? 'warn' : 'pass', href: exHref(TAB[c.group] || 'overview') }; };
  D.xexpo = function () { var l = secChecks().filter(function (c) { return c.exposure; }); return { title: isW() ? t('WHT exposure (SAR)') : t('VAT exposure (SAR)'), sub: t('By check'), total: l.reduce(function (s, c) { return s + c.exposure; }, 0), totalLabel: 'SAR', rows: l.map(function (c) { return checkRow(c, c.exposure); }).sort(desc) }; };
  D.xfails = function () {
    var l = secChecks().filter(function (c) { return c.status === 'fail'; });
    return { title: t('Checks failed'), sub: sec(), total: l.length, totalLabel: t('of') + ' ' + secChecks().length, money: false, rows: l.map(function (c) { var r = checkRow(c, Math.abs(c.diff || c.exposure || 0)); r.display = c.diff != null && c.bLabel ? Z.fmt(c.diff) : (c.a != null ? String(c.a) : ''); return r; }).sort(desc) };
  };
  D.xsamples = function () {
    var flows = isW() ? ['W'] : ['S', 'P'], l = (S.samples || []).filter(function (s) { return flows.indexOf(s.flow) >= 0; });
    return { title: t('Samples'), total: l.length, totalLabel: t('samples'), money: false, rows: l.map(function (s) { var ev = s.eval || E.evaluateSample(s, s.confidence); return { label: t({ S: 'Sales invoices', P: 'Purchase invoices', W: 'WHT payments' }[s.flow] || s.flow) + ', ' + t('seed') + ' ' + s.seed, sub: ev.tested + ' / ' + ev.total + ' ' + t('tested'), value: ev.total ? ev.tested / ev.total * 100 : 0, display: ev.rate + '% ' + t('deviation'), tone: ev.deviations ? 'fail' : 'pass', href: exHref('sampling') }; }), empty: t('No samples yet.') };
  };
  D.part = function (k) {
    var R = S.R; if (!R) return null;
    var name = t(Z.partName(k)), groups = { recon: isW() ? ['wht'] : ['vat'], bank: ['bank'], einv: ['einv'], filing: ['filing'], other: ['other'] }[k];
    if (groups) {
      var l = secChecks().filter(function (c) { return groups.indexOf(c.group) >= 0; }).sort(function (a, b) { var o = { fail: 0, warn: 1, na: 2, pass: 3 }; return o[a.status] - o[b.status]; });
      return { title: name, sub: t('Every check in this part'), money: false, rows: l.map(function (c) { var r = checkRow(c, c.status === 'pass' ? 100 : c.status === 'warn' ? 50 : c.status === 'fail' ? 15 : 0); r.display = r.sub; r.sub = c.diff != null && c.bLabel ? t('Difference') + ' ' + Z.fmt(c.diff) : ''; return r; }) };
    }
    if (k === 'analytics') return { title: name, money: false, rows: R.analytics.tests.filter(function (x) { return x.status !== 'pass'; }).map(function (x) { return { label: x.id + '  ' + Z.tt(x, 'title'), sub: x.count + ' ' + t('items'), value: x.count, display: String(x.count), tone: x.status === 'fail' ? 'fail' : 'warn', href: exHref('analytics') }; }).sort(desc), empty: t('No exceptions.') };
    if (k === 'checklist') { var cl = (S.checklist && S.checklist.items || []).filter(function (x) { return (x.area === 'WHT') === isW() && x.status !== 'na'; }); return { title: name, total: cl.filter(function (x) { return x.status === 'available'; }).length, totalLabel: t('of') + ' ' + cl.length + ' ' + t('on file'), money: false, rows: cl.map(function (x) { return { label: S.lang === 'ar' ? x.ar : x.en, sub: x.owner || '', value: x.status === 'available' ? 100 : x.status === 'requested' ? 50 : 10, display: t({ available: 'On file', requested: 'Requested', missing: 'Missing' }[x.status] || x.status), tone: x.status === 'available' ? 'pass' : x.status === 'requested' ? 'warn' : 'fail', href: exHref('checklist') }; }) }; }
    if (k === 'findings') return D.fopen();
    if (k === 'sampling') return D.xsamples();
    return null;
  };
  var findings = function () { return (S.findings || []).filter(function (f) { return (f.tax === 'WHT') === isW(); }); };
  var fRow = function (f, v) { return { label: f.title, sub: t(Z.cap(f.severity)) + (f.owner ? ', ' + f.owner : '') + (f.due ? ', ' + t('due') + ' ' + f.due : ''), value: v, tone: f.severity === 'critical' || f.severity === 'high' ? 'fail' : 'warn', href: exHref('findings') }; };
  D.fopen = function () { var l = findings().filter(function (f) { return f.status !== 'closed'; }); return { title: t('Open findings'), total: l.length, totalLabel: t('findings'), rows: l.map(function (f) { return fRow(f, +f.taxImpact || 0); }).sort(desc), empty: t('No open findings.') }; };
  D.ftax = function () { var l = findings().filter(function (f) { return f.status !== 'closed'; }); return { title: t('Tax at stake'), sub: t('Open findings'), total: l.reduce(function (s, f) { return s + (+f.taxImpact || 0); }, 0), totalLabel: 'SAR', rows: l.map(function (f) { return fRow(f, +f.taxImpact || 0); }).sort(desc) }; };
  D.fpen = function () { var l = findings().filter(function (f) { return f.status !== 'closed'; }); return { title: t('Estimated penalties'), total: l.reduce(function (s, f) { return s + (+f.penalty || 0); }, 0), totalLabel: 'SAR', rows: l.map(function (f) { return fRow(f, +f.penalty || 0); }).sort(desc) }; };

  // ---------------------------------------------------------------- e-invoicing
  var invRow = function (x, why) { return { label: x.invoice, sub: [x.date, x.party || x.buyerVat, why || x.message || ''].filter(Boolean).join(', '), value: Math.abs(+x.vat || 0), display: Z.fmt(+x.vat || 0), href: exHref('einv') }; };
  D.einvsrc = function (k) {
    var d = S.data || {}, l = k === 'erp' ? (d.sys_vat || []).filter(function (x) { return x.flow === 'S'; }) : k === 'provider' ? d.einv_provider || [] : d.einv || [];
    return { title: { erp: t('Sales documents in the ERP'), provider: t('Received by the e-invoicing provider'), zatca: t('Held by ZATCA (Fatoora export)') }[k], sub: t('Largest VAT first, up to 200'), total: l.length, totalLabel: t('documents'), money: false, rows: l.slice().sort(function (a, b) { return Math.abs(+b.vat || 0) - Math.abs(+a.vat || 0); }).slice(0, 200).map(function (x) { return invRow(x); }) };
  };
  D.einvstatus = function (st) {
    var l = ((S.data || {}).einv_provider || []).filter(function (x) { return (x.status || '-') === st; });
    return { title: t('Status') + ': ' + st, total: l.length, totalLabel: t('documents'), money: false, rows: l.slice(0, 200).map(function (x) { return invRow(x); }) };
  };

  // ---------------------------------------------------------------- reports and users
  D.age = function (bucket) {
    var asOf = Z.reportAsOf ? Z.reportAsOf() : Z.today(), b = E.aging(S.allFindings || [], asOf), l = b[bucket] || [];
    return { title: t('Findings aging'), sub: t('As of') + ' ' + asOf, total: l.length, totalLabel: t('findings'), rows: l.map(function (f) { var x = S.exercises.filter(function (e) { return e.id === f.parentId; })[0]; return { label: f.title, sub: (x ? Z.entName(Z.entity(x.entityId)) + ' ' + x.period : '') + (f.owner ? ', ' + f.owner : ''), value: +f.taxImpact || 0, tone: 'fail', href: '#/ex/' + f.parentId + '/findings' }; }).sort(desc), empty: t('No findings in this group.') };
  };
  D.corr = function (state) {
    var rows = E.corrections(S.allFindings || [], S.settingsDoc ? S.settingsDoc.values : {}, Z.today()).filter(function (r) { return r.state === state; });
    return { title: t('Corrections register'), total: rows.length, totalLabel: t('corrections'), rows: rows.map(function (r) { return { label: r.title, sub: t('due') + ' ' + r.dueBy + (r.daysLeft != null && r.state !== 'done' ? ', ' + r.daysLeft + ' ' + t('days') : ''), value: +r.taxImpact || 0, tone: state === 'overdue' ? 'fail' : state === 'done' ? 'pass' : 'warn', href: '#/ex/' + r.parentId + '/findings' }; }).sort(desc) };
  };
  D.benef = function (k) {
    var l = (S.benef || []).filter(function (b) { return k !== 'nocert' || b.missingCert; });
    var f = k === 'wht' ? 'wht' : 'gross';
    return { title: { all: t('Beneficiaries'), gross: t('Paid to non-residents'), wht: t('WHT withheld'), nocert: t('Payments without a certificate') }[k], total: k === 'nocert' ? l.reduce(function (s, b) { return s + b.missingCert; }, 0) : k === 'all' ? l.length : l.reduce(function (s, b) { return s + b[f]; }, 0), totalLabel: k === 'nocert' ? t('payments') : k === 'all' ? t('beneficiaries') : 'SAR',
      rows: l.map(function (b) { return { label: b.party, sub: [b.country, Z.entName(Z.entity(b.entityId))].filter(Boolean).join(', '), value: k === 'nocert' ? b.missingCert : b[f], display: k === 'nocert' ? String(b.missingCert) : undefined, tone: k === 'nocert' ? 'fail' : '' }; }).sort(desc) };
  };
  D.users = function (k) {
    var l = (S.users || []).filter(function (u) { return u.active !== false; });
    var all = function (u) { return u.role === 'owner' || (u.entityIds || []).indexOf('*') >= 0; };
    if (k === 'signoff') l = l.filter(function (u) { return u.role === 'owner' || u.role === 'manager'; });
    if (k === 'none') l = l.filter(function (u) { return !all(u) && !(u.entityIds || []).length; });
    if (k === 'companies') return { title: t('Companies'), money: false, rows: S.entities.map(function (e) { var n = l.filter(function (u) { return all(u) || (u.entityIds || []).indexOf(e.id) >= 0; }).length; return { label: Z.entName(e), sub: n + ' ' + t('people'), value: n, display: String(n), href: '#/users' }; }).sort(desc) };
    return { title: { active: t('Active users'), signoff: t('Can sign off'), none: t('Without any company') }[k], total: l.length, totalLabel: t('people'), money: false, rows: l.map(function (u) { var n = all(u) ? S.entities.length : (u.entityIds || []).length; return { label: Z.userLabel ? Z.userLabel(u) : u.name, sub: t(Z.cap(u.role)) + ', ' + u.email, value: n, display: all(u) ? t('All companies') : n + ' ' + t('companies'), href: '#/users' }; }).sort(desc) };
  };

  // ---------------------------------------------------------------- recognise cards by their label
  var view = function () { return (S.route || [])[0] || 'dashboard'; }, tab = function () { return (S.route || [])[2] || 'overview'; };
  var RULES = [
    ['Entities', function () { return view() === 'dashboard' ? 'ents' : null; }],
    ['Exercises not signed off', 'open'], ['Average readiness, last 12 months', 'avg'], ['Failed checks in latest exercises', 'fails'],
    ['VAT exposure (SAR)', function () { return view() === 'dashboard' ? 'expo' : 'xexpo'; }], ['WHT exposure (SAR)', function () { return view() === 'dashboard' ? 'expo' : 'xexpo'; }],
    ['Tax at stake (SAR)', function () { return view() === 'ex' && tab() === 'findings' ? 'ftax' : 'pimpact'; }],
    ['Penalties if left to an inspector (SAR)', 'plater'], ['If found at inspection (SAR)', 'plater'], ['Penalties if fixed now (SAR)', 'pnow'],
    ['Saved by acting now (SAR)', 'pavoided'], ['Tax to reclaim (SAR)', 'precover'], ['Critical actions', 'pcritical'], ['Open actions', 'popen'], ['To the next deadline', 'pnext'],
    ['Checks failed', 'xfails'], ['Samples', 'xsamples'], ['Open findings', 'fopen'], ['Estimated penalties (SAR)', 'fpen'],
    ['Sales documents in the ERP', 'einvsrc:erp'], ['Received by the e-invoicing provider', 'einvsrc:provider'], ['Held by ZATCA (Fatoora export)', 'einvsrc:zatca'],
    ['Over 90 days overdue', 'age:over90'], ['61-90 days overdue', 'age:d90'], ['31-60 days overdue', 'age:d60'], ['1-30 days overdue', 'age:d30'], ['Not yet due', 'age:notDue'], ['No due date', 'age:noDate'],
    ['Overdue corrections', 'corr:overdue'], ['Open, still in time', 'corr:open'], ['Corrected', 'corr:done'],
    ['Beneficiaries', 'benef:all'], ['Paid to non-residents', function () { return view() === 'reports' ? 'benef:gross' : null; }], ['WHT withheld', 'benef:wht'], ['Payments without a certificate', 'benef:nocert'],
    ['Active users', 'users:active'], ['Companies', function () { return view() === 'users' ? 'users:companies' : null; }], ['Can sign off', 'users:signoff'], ['Without any company', 'users:none']
  ];
  var EST = { 'Cleared by ZATCA': 'CLEARED', 'Reported to ZATCA': 'REPORTED', 'Rejected': 'REJECTED', 'Pending at provider': 'PENDING', 'Accepted with warnings': 'WARNING', 'Not sent': 'NOT_SUBMITTED' };
  Z.autoDrill = function () {
    var main = document.getElementById('main'); if (!main) return;
    main.querySelectorAll('.kpis > div:not([data-drill])').forEach(function (tile) {
      var sp = tile.querySelector(':scope > span'); if (!sp) return;
      var label = sp.textContent.trim(), key = null;
      RULES.some(function (r) { var en = t(r[0]); if (label === en || label.indexOf(en + ',') === 0) { key = typeof r[1] === 'function' ? r[1]() : r[1]; return true; } return false; });
      if (!key) Object.keys(EST).some(function (en) { if (label === t(en)) { key = 'einvstatus:' + EST[en]; return true; } return false; });
      if (!key && view() === 'ex' && tab() === 'einv' && /^[A-Z_]+$/.test(label)) key = 'einvstatus:' + label;
      if (key) tile.setAttribute('data-drill', key);
    });
    main.querySelectorAll('.parts .p:not([data-drill])').forEach(function (p) {
      var label = (p.querySelector('span') || {}).textContent;
      ['recon', 'bank', 'einv', 'filing', 'other', 'analytics', 'sampling', 'checklist', 'findings'].some(function (k) { if (t(Z.partName(k)) === label) { p.setAttribute('data-drill', 'part:' + k); return true; } return false; });
    });
    main.querySelectorAll('.hbars .hb:not([data-drill])').forEach(function (h) { var label = (h.querySelector('span') || {}).textContent; if (label && view() === 'insights') h.setAttribute('data-drill', 'area:' + label); });
  };
  new MutationObserver(function () { Z.autoDrill(); }).observe(document.documentElement, { childList: true, subtree: true });

})();
