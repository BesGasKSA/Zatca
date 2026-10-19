/* UI core: state, helpers, shell, sign-in, routing, dashboard, entities,
   settings, users, audit, platform. Exercise screens live in ui-exercise.js
   and ui-work.js; all three share the global Z. */
var Z = window.Z = { S: {}, ACT: {}, CHG: {}, views: {} };
(function () {
  'use strict';
  var E = window.ZEngine, S = Z.S;

  // ---------------------------------------------------------------- helpers
  Z.esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var esc = Z.esc;
  Z.t = function (en) { return S.lang === 'ar' && window.ZI18N && ZI18N[en] ? ZI18N[en] : en; };
  var t = Z.t;
  Z.tt = function (o, base) { return S.lang === 'ar' && o[base + 'Ar'] ? o[base + 'Ar'] : o[base]; };
  var NF = {};
  Z.fmt = function (n, dp) {
    if (n == null || n === '' || isNaN(n)) return '—';
    dp = dp == null ? 2 : dp;
    NF[dp] = NF[dp] || new Intl.NumberFormat('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
    var s = NF[dp].format(Math.abs(n));
    return n < 0 ? '(' + s + ')' : s;
  };
  // dates, periods and codes stay left-to-right inside Arabic text
  Z.ltr = function (s) { return '<bdi dir="ltr">' + esc(s) + '</bdi>'; };
  Z.pct = function (x) { return x == null ? '—' : Math.round(x * 100) + '%'; };
  Z.tick = function (st, title) {
    var ch = { pass: '✓', warn: '!', fail: '✕', na: '–' }[st] || '–';
    var lab = { pass: t('Passed'), warn: t('Needs explanation'), fail: t('Failed'), na: t('No data') }[st];
    return '<span class="tk ' + (st || 'na') + '" role="img" aria-label="' + esc(title || lab) + '" title="' + esc(title || lab) + '">' + ch + '</span>';
  };
  Z.pill = function (cls, text) { return '<span class="pill ' + esc(cls) + '">' + esc(text) + '</span>'; };
  Z.toast = function (msg, err) {
    var el = document.createElement('div'); el.className = 'toast' + (err ? ' err' : ''); el.setAttribute('role', 'status'); el.textContent = msg;
    document.body.appendChild(el); setTimeout(function () { el.remove(); }, err ? 5200 : 2600);
  };
  Z.can = function (role) { var R = { owner: 4, manager: 3, preparer: 2, viewer: 1 }; return (R[(S.user || {}).role] || 0) >= R[role]; };
  Z.uid = function (p) { return p + '-' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4); };
  Z.today = function () { return new Date().toISOString().slice(0, 10); };
  Z.gradeText = function (g) { return { ready: t('Ready for inspection'), mostly: t('Mostly ready'), risk: t('At risk'), not: t('Not ready') }[g] || '—'; };

  var ERR = {
    bad_credentials: 'Email or password is not correct.', email_taken: 'An account with this email already exists.',
    weak_password: 'Use at least 10 characters for the password.', forbidden: 'Your role does not allow this.',
    exercise_closed: 'This exercise is signed off. A manager must reopen it before changes.', auth_required: 'Your session ended. Sign in again.',
    tenant_suspended: 'This organisation is suspended. Contact the platform administrator.', cloud_only: 'Available when connected to the Google Sheets backend.',
    missing_fields: 'Fill in every field.', too_many_attempts: 'Too many wrong passwords. Try again in 15 minutes.', bad_email: 'Enter a valid email address.', server_error: 'The server hit an error. Try again; if it repeats, check the Apps Script logs.'
  };
  Z.call = function (action, payload) {
    return S.api.call(action, payload).catch(function (e) {
      var code = e.code || e.message;
      if (code === 'auth_required') { S.user = null; Z.renderAuth(); }
      var m = ERR[code] || ('Error: ' + code);
      Z.toast(t(m), true);
      throw e;
    });
  };
  Z.list = function (table, parentId) { return Z.call('list', { table: table, parentId: parentId }).then(function (r) { return r.docs; }); };
  Z.save = function (table, doc) { return Z.call('save', { table: table, doc: doc }).then(function (r) { return r.doc; }); };
  Z.get = function (table, id) { return Z.call('get', { table: table, id: id }).then(function (r) { return r.doc; }); };

  // ---------------------------------------------------------------- seal
  Z.seal = function (score, grade, small, animate) {
    var id = 'sp' + Math.random().toString(36).slice(2, 7);
    var top = S.lang === 'ar' ? 'جاهزية الفحص الضريبي' : 'TAX INSPECTION READINESS';
    var bottom = S.lang === 'ar' ? 'ضريبة القيمة المضافة · الاستقطاع' : 'VAT · WITHHOLDING TAX';
    return '<svg class="seal ' + (grade || 'not') + (small ? ' small' : '') + (animate ? ' seal-in' : '') + '" viewBox="0 0 200 200" role="img" aria-label="' + esc(t('Readiness') + ' ' + score + '% — ' + Z.gradeText(grade)) + '">' +
      '<defs><path id="' + id + 'a" d="M 30 100 A 70 70 0 0 1 170 100"/><path id="' + id + 'b" d="M 28 100 A 72 72 0 0 0 172 100"/></defs>' +
      '<circle class="ring" cx="100" cy="100" r="94" stroke-width="3"/><circle class="ring" cx="100" cy="100" r="86" stroke-width="1"/><circle class="ring" cx="100" cy="100" r="56" stroke-width="1.5"/>' +
      '<text font-size="12.5" font-weight="600" letter-spacing="2.2"><textPath href="#' + id + 'a" startOffset="50%" text-anchor="middle">' + top + '</textPath></text>' +
      '<text font-size="10.5" font-weight="500" letter-spacing="1.6" dy="9"><textPath href="#' + id + 'b" startOffset="50%" text-anchor="middle">' + bottom + '</textPath></text>' +
      '<text x="100" y="108" text-anchor="middle" font-size="40" font-weight="700">' + (score == null ? '—' : score) + '<tspan font-size="18" dy="-14">%</tspan></text>' +
      '<text x="100" y="132" text-anchor="middle" font-size="11" font-weight="600">' + esc(Z.gradeText(grade)) + '</text>' +
      '<text x="27" y="104" font-size="12">★</text><text x="163" y="104" font-size="12">★</text></svg>';
  };

  // ---------------------------------------------------------------- boot
  Z.boot = function () {
    S.lang = localStorage.getItem('zr_lang') || 'en';
    applyLang();
    var q = new URLSearchParams(location.search);
    if (q.get('api')) localStorage.setItem('zr_api_url', q.get('api'));
    // A hosted copy (GitHub Pages) has its backend URL baked in by build.js;
    // "try it on this device" opts out of it for the rest of the browser session.
    var demo = false;
    try { demo = sessionStorage.getItem('zr_local') === '1'; } catch (e) {}
    var url = demo ? '' : localStorage.getItem('zr_api_url') || window.ZR_API_URL || '';
    var hosted = !!(window.google && google.script && google.script.run);
    S.api = hosted || url ? new ZApi.CloudBackend(url) : new ZApi.LocalBackend();
    document.addEventListener('click', function (e) {
      var el = e.target.closest('[data-act]');
      if (el && Z.ACT[el.dataset.act]) { e.preventDefault(); Z.ACT[el.dataset.act](el, e); }
    });
    ['change', 'input'].forEach(function (ev) {
      document.addEventListener(ev, function (e) {
        var el = e.target.closest('[data-chg]');
        if (el && Z.CHG[el.dataset.chg] && (ev === 'change' || el.dataset.live)) Z.CHG[el.dataset.chg](el, e);
      });
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') Z.closeModal(); });
    window.addEventListener('hashchange', Z.route);
    if (S.api.mode === 'local') return start({});
    if (S.api.token) Z.call('me').then(start).catch(function () { Z.renderAuth(); });
    else Z.renderAuth();
  };

  function start(r) {
    return (r.user ? Promise.resolve(r) : S.api.call('me')).then(function (me) {
      S.user = me.user; S.tenant = me.tenant;
      return Promise.all([Z.list('entities'), Z.list('exercises'), Z.get('settings', 'tenant')]);
    }).then(function (x) {
      S.entities = x[0].sort(function (a, b) { return a.name < b.name ? -1 : 1; });
      S.exercises = x[1];
      S.settingsDoc = x[2] || { id: 'tenant' };
      S.settings = E.mergeSettings(S.settingsDoc.values);
      S.entityId = localStorage.getItem('zr_entity');
      if (!S.entities.some(function (e) { return e.id === S.entityId; })) S.entityId = S.entities[0] ? S.entities[0].id : '';
      Z.route();
    });
  }
  Z.reloadAll = function () { return start({ user: S.user, tenant: S.tenant }); };

  function applyLang() {
    document.documentElement.lang = S.lang;
    document.documentElement.dir = S.lang === 'ar' ? 'rtl' : 'ltr';
  }
  Z.ACT.lang = function () { S.lang = S.lang === 'ar' ? 'en' : 'ar'; localStorage.setItem('zr_lang', S.lang); applyLang(); S.user ? Z.route() : Z.renderAuth(); };
  Z.ACT.theme = function () {
    var cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    document.documentElement.dataset.theme = cur === 'dark' ? 'light' : 'dark';
    localStorage.setItem('zr_theme', document.documentElement.dataset.theme);
  };
  Z.ACT.menu = function () { document.querySelector('.shell').classList.toggle('open'); };

  // ---------------------------------------------------------------- auth
  Z.renderAuth = function (mode) {
    mode = mode || 'login';
    var pts = [
      t('Return, system tax report, Excel workings and the ledger reconciled box by box'),
      t('Bank statements traced to declared sales and purchases — unreported cash surfaces before the inspector finds it'),
      t('Withholding tax: rates, treaty relief, the 10th-of-month deadline, certificates and foreign transfers'),
      t('Reproducible statistical samples of sales, purchases and WHT payments, tested attribute by attribute'),
      t('Every entity, every month, one readiness score — stored in your own Google Sheets')
    ];
    document.body.innerHTML = '<div class="auth"><section class="side"><div class="brand">' + logo(36) + '<div><b>Inspection Ready</b><span>' + t('VAT & WHT inspection readiness') + '</span></div></div>' +
      '<div><h1>' + t('Be ready the day ZATCA asks.') + '</h1><p style="margin-top:12px;color:#cfe5dc">' + t('A monthly inspection exercise for every legal entity: reconcile, sample, document, sign off.') + '</p></div>' +
      '<ul>' + pts.map(function (p) { return '<li>' + Z.tick('pass') + '<span>' + esc(p) + '</span></li>'; }).join('') + '</ul></section>' +
      '<section class="form"><div><div class="spread" style="margin-bottom:22px"><h2>' + (mode === 'login' ? t('Sign in') : t('Create your organisation')) + '</h2><button class="btn ghost small" data-act="lang">' + (S.lang === 'ar' ? 'English' : 'العربية') + '</button></div>' +
      '<form id="authf" class="grid">' +
      (mode === 'signup' ? '<label class="f"><span>' + t('Organisation name') + '</span><input type="text" name="orgName" required autocomplete="organization"></label><label class="f"><span>' + t('Your name') + '</span><input type="text" name="name" required autocomplete="name"></label>' : '') +
      '<label class="f"><span>' + t('Email') + '</span><input type="email" name="email" required autocomplete="email"></label>' +
      '<label class="f"><span>' + t('Password') + '</span><input type="password" name="password" required minlength="' + (mode === 'signup' ? 10 : 1) + '" autocomplete="' + (mode === 'signup' ? 'new-password' : 'current-password') + '">' + (mode === 'signup' ? '<small>' + t('At least 10 characters.') + '</small>' : '') + '</label>' +
      '<button class="btn primary" type="submit">' + (mode === 'login' ? t('Sign in') : t('Create organisation')) + '</button></form>' +
      '<p class="muted" style="margin-top:18px">' + (mode === 'login' ? t('New here?') + ' <a href="#" data-act="authmode" data-m="signup">' + t('Create an organisation') + '</a>' : '<a href="#" data-act="authmode" data-m="login">' + t('I already have an account') + '</a>') + '</p>' +
      '<p class="faint" style="font-size:13px">' + t('Want to look around first?') + ' <a href="#" data-act="localmode">' + t('Try it on this device with demo data') + '</a></p></div></section></div>';
    document.getElementById('authf').addEventListener('submit', function (e) {
      e.preventDefault();
      var f = Object.fromEntries(new FormData(e.target));
      Z.call(mode, f).then(function (r) { start(r); });
    });
  };
  Z.ACT.authmode = function (el) { Z.renderAuth(el.dataset.m); };
  Z.ACT.localmode = function () { try { sessionStorage.setItem('zr_local', '1'); } catch (e) {} S.api = new ZApi.LocalBackend(); start({}); };
  Z.ACT.logout = function () { S.api.logout(); S.user = null; location.hash = ''; Z.renderAuth(); };

  function logo(sz) {
    return '<svg width="' + sz + '" height="' + sz + '" viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="18" fill="none" stroke="#9fe0c6" stroke-width="2"/><circle cx="20" cy="20" r="13.5" fill="none" stroke="#9fe0c6" stroke-width="1"/><path d="M13 20.5l4.6 4.6L27.5 15" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }

  // ---------------------------------------------------------------- shell & routing
  Z.route = function () {
    if (!S.user) return;
    var h = location.hash.replace(/^#\/?/, '').split('/');
    S.route = h;
    var view = h[0] || 'dashboard';
    if (!document.querySelector('.shell')) shell();
    paintRail(view);
    paintTop();
    var main = document.getElementById('main');
    main.innerHTML = '<div class="empty faint">' + t('Loading…') + '</div>';
    var fn = Z.views[view] || Z.views.dashboard;
    Promise.resolve(fn(h)).catch(function (e) { console.error(e); main.innerHTML = '<div class="empty"><h2>' + t('This page could not load') + '</h2><p>' + esc(e.message) + '</p></div>'; });
    document.querySelector('.shell').classList.remove('open');
    window.scrollTo(0, 0);
  };
  Z.paintChrome = function (view) { paintRail(view); paintTop(); };
  Z.setMain = function (html) { document.getElementById('main').innerHTML = html; };

  function shell() {
    document.body.innerHTML = '<div class="shell"><nav class="rail" aria-label="' + t('Main') + '"></nav><div><div class="top"></div>' +
      (S.api.mode === 'local' ? '<div class="banner">' + t('Demo mode: data stays in this browser only.') + ' <a href="#/settings">' + t('Connect your Google Sheets backend') + '</a></div>' : '') +
      '<main id="main" class="main" tabindex="-1"></main></div></div>';
  }
  function paintRail(view) {
    var ex = S.exId && S.ex ? S.ex : null;
    var items = [['dashboard', t('Dashboard'), '▦'], ['entities', t('Entities'), '▤']];
    var h = '<div class="brand">' + logo(30) + '<div><b>Inspection Ready</b><span>' + esc(S.tenant ? S.tenant.name : '') + '</span></div></div>';
    items.forEach(function (i) { h += '<a class="nav" href="#/' + i[0] + '"' + (view === i[0] ? ' aria-current="page"' : '') + '><span aria-hidden="true">' + i[2] + '</span>' + i[1] + '</a>'; });
    if (ex) {
      var ent = Z.entity(ex.entityId) || {};
      h += '<div class="sep"></div><a class="nav" href="#/ex/' + ex.id + '/overview"' + (view === 'ex' ? ' aria-current="page"' : '') + '><span aria-hidden="true">◉</span>' + esc(ent.name || '') + ' · ' + esc(ex.period) + '</a>';
    }
    h += '<div class="sep"></div>';
    [['settings', t('Settings'), '⚙', 'manager'], ['users', t('Users'), '◍', 'owner'], ['audit', t('Audit trail'), '≡', 'manager']].forEach(function (i) {
      if (Z.can(i[3])) h += '<a class="nav" href="#/' + i[0] + '"' + (view === i[0] ? ' aria-current="page"' : '') + '><span aria-hidden="true">' + i[2] + '</span>' + i[1] + '</a>';
    });
    if (S.api.mode === 'cloud') h += '<a class="nav" href="#/platform"' + (view === 'platform' ? ' aria-current="page"' : '') + '><span aria-hidden="true">⌂</span>' + t('Platform') + '</a>';
    h += '<div class="foot">' + esc(S.user.name) + ' — ' + esc(t(cap(S.user.role))) + '<br>' + (S.api.mode === 'cloud' ? '<button data-act="logout">' + t('Sign out') + '</button>' : t('Stored on this device')) + '</div>';
    document.querySelector('.rail').innerHTML = h;
  }
  function cap(s) { return s ? s[0].toUpperCase() + s.slice(1) : ''; }
  Z.cap = cap;
  function paintTop() {
    var opts = S.entities.map(function (e) { return '<option value="' + e.id + '"' + (e.id === S.entityId ? ' selected' : '') + '>' + esc(S.lang === 'ar' && e.nameAr ? e.nameAr : e.name) + '</option>'; }).join('');
    document.querySelector('.top').innerHTML = '<button class="btn ghost menu-btn" data-act="menu" aria-label="' + t('Menu') + '">☰</button>' +
      (S.entities.length ? '<label class="row" style="gap:8px"><span class="muted">' + t('Entity') + '</span><select data-chg="entity" aria-label="' + t('Entity') + '">' + opts + '</select></label>' : '') +
      '<span class="grow"></span><button class="btn ghost small" data-act="theme" aria-label="' + t('Switch light/dark') + '">◐</button><button class="btn ghost small" data-act="lang">' + (S.lang === 'ar' ? 'English' : 'العربية') + '</button>';
  }
  Z.CHG.entity = function (el) { S.entityId = el.value; localStorage.setItem('zr_entity', el.value); location.hash = '#/entity/' + el.value; };
  Z.entity = function (id) { return S.entities.filter(function (e) { return e.id === id; })[0]; };
  Z.entName = function (e) { return e ? (S.lang === 'ar' && e.nameAr ? e.nameAr : e.name) : ''; };

  // ---------------------------------------------------------------- dashboard
  Z.views.dashboard = function () {
    if (!S.entities.length) {
      return Z.setMain('<div class="paper empty"><h2>' + t('Start with your first legal entity') + '</h2><p style="margin:0 auto 18px">' + t('Add each company or branch registered for VAT. Every month you run an inspection exercise for it.') + '</p>' +
        '<div class="row" style="justify-content:center"><a class="btn primary" href="#/entities/new">' + t('Add entity') + '</a>' + (S.api.mode === 'local' ? '<button class="btn" data-act="loaddemo">' + t('Load demo company') + '</button>' : '') + '</div></div>');
    }
    var months = [], cur = E.periodOf(Z.today(), 'monthly');
    for (var i = 0; i < 12; i++) { cur = E.prevPeriod(cur); months.unshift(cur); }
    var exs = S.exercises, open = exs.filter(function (x) { return x.status !== 'closed'; });
    var scores = exs.filter(function (x) { return x.summary && x.summary.score != null && months.indexOf(x.period) >= 0 || /Q/.test(x.period); }).map(function (x) { return x.summary ? x.summary.score : null; }).filter(function (x) { return x != null; });
    var avg = scores.length ? Math.round(scores.reduce(function (a, b) { return a + b; }, 0) / scores.length) : null;
    var latest = {};
    exs.forEach(function (x) { if (!latest[x.entityId] || x.period > latest[x.entityId].period) latest[x.entityId] = x; });
    var exposure = Object.keys(latest).reduce(function (a, k) { return a + ((latest[k].summary || {}).exposure || 0); }, 0);
    var fails = Object.keys(latest).reduce(function (a, k) { return a + ((latest[k].summary || {}).fails || 0); }, 0);

    var heat = '<table class="heat"><thead><tr><th></th>' + months.map(function (m) { return '<th scope="col">' + m.slice(2).replace('-', '/') + '</th>'; }).join('') + '</tr></thead><tbody>' +
      S.entities.filter(function (e) { return e.active !== false; }).map(function (e) {
        return '<tr><th class="ent" scope="row"><a href="#/entity/' + e.id + '">' + esc(Z.entName(e)) + '</a></th>' + months.map(function (m) {
          var key = e.vatFreq === 'quarterly' ? m.slice(0, 4) + '-Q' + Math.ceil(+m.slice(5) / 3) : m;
          var x = exs.filter(function (z) { return z.entityId === e.id && z.period === key; })[0];
          if (!x) return '<td data-act="newex" data-e="' + e.id + '" data-p="' + key + '" title="' + esc(t('Start exercise') + ' ' + key) + '">+</td>';
          var sm = x.summary || {}, g = sm.grade || 'not';
          return '<td class="s-' + g + (x.status === 'closed' ? ' closed' : '') + '" data-act="openex" data-id="' + x.id + '" title="' + esc(key + ' — ' + (sm.score != null ? sm.score + '% ' : '') + Z.gradeText(g) + (x.status === 'closed' ? ' — ' + t('signed off') : '')) + '">' + (sm.score != null ? sm.score : '·') + '</td>';
        }).join('') + '</tr>';
      }).join('') + '</tbody></table>';

    var dl = S.entities.filter(function (e) { return e.active !== false; }).map(function (e) {
      var p = E.periodOf(Z.today(), e.vatFreq || 'monthly'), prev = E.prevPeriod(p), d = E.deadlines(prev), w = E.deadlines(E.prevPeriod(E.periodOf(Z.today(), 'monthly')));
      var left = E.daysBetween(Z.today(), d.vat), lw = E.daysBetween(Z.today(), w.wht);
      return '<tr><td>' + esc(Z.entName(e)) + '</td><td>' + esc(prev) + '</td><td class="nowrap">' + d.vat + ' <span class="' + (left < 7 ? 'diff-bad' : 'faint') + '">(' + left + ' ' + t('days') + ')</span></td><td class="nowrap">' + (e.whtRegistered === false ? '—' : w.wht + ' <span class="' + (lw < 4 ? 'diff-bad' : 'faint') + '">(' + lw + ' ' + t('days') + ')</span>') + '</td></tr>';
    }).join('');

    Z.setMain('<div class="pagehead"><div><h1>' + t('Inspection readiness across your entities') + '</h1><p>' + t('Each square is one month\'s inspection exercise. Click an empty square to start one.') + '</p></div>' +
      (S.api.mode === 'local' && !S.entities.some(function (e) { return e.demo; }) ? '<button class="btn" data-act="loaddemo">' + t('Load demo company') + '</button>' : '') + '</div>' +
      '<div class="stack"><div class="kpis"><div><b>' + S.entities.length + '</b><span>' + t('Entities') + '</span></div><div><b>' + open.length + '</b><span>' + t('Exercises not signed off') + '</span></div>' +
      '<div><b>' + (avg == null ? '—' : avg + '%') + '</b><span>' + t('Average readiness, last 12 months') + '</span></div><div class="' + (fails ? 'bad' : '') + '"><b>' + fails + '</b><span>' + t('Failed checks in latest exercises') + '</span></div>' +
      '<div class="' + (exposure ? 'bad' : '') + '"><b>' + Z.fmt(exposure, 0) + '</b><span>' + t('Quantified tax exposure (SAR)') + '</span></div></div>' +
      '<section class="paper"><header><div><h2>' + t('Readiness by month') + '</h2><p>' + t('Green is ready, amber at risk, red not ready. A dark underline means signed off.') + '</p></div></header><div class="tbl-wrap">' + heat + '</div></section>' +
      '<section class="paper"><header><div><h2>' + t('Filing deadlines') + '</h2><p>' + t('VAT is due by the last day of the month after the period; WHT by the 10th of the following month.') + '</p></div></header><div class="tbl-wrap"><table class="t"><thead><tr><th>' + t('Entity') + '</th><th>' + t('Period') + '</th><th>' + t('VAT return due') + '</th><th>' + t('WHT return due') + '</th></tr></thead><tbody>' + dl + '</tbody></table></div></section></div>');
  };

  Z.ACT.openex = function (el) { location.hash = '#/ex/' + el.dataset.id + '/overview'; };
  Z.ACT.newex = function (el) {
    if (!Z.can('preparer')) return Z.toast(t('Your role does not allow this.'), true);
    Z.createExercise(el.dataset.e, el.dataset.p);
  };
  Z.createExercise = function (entityId, period) {
    var ex = { entityId: entityId, period: period, status: 'in_progress', label: (Z.entity(entityId) || {}).name + ' ' + period, reconItems: [], checkNotes: {}, bankOverrides: {}, returnBoxes: null, createdAt: new Date().toISOString() };
    return Z.save('exercises', ex).then(function (d) {
      S.exercises.push(d);
      var cl = { id: d.id, parentId: d.id, items: E.DEFAULT_CHECKLIST.map(function (c, i) { return { id: 'c' + i, area: c[0], en: c[1], ar: c[2], status: 'missing', owner: '', link: '', note: '' }; }) };
      return Z.save('checklists', cl).then(function () { location.hash = '#/ex/' + d.id + '/data'; });
    });
  };

  // ---------------------------------------------------------------- entities
  Z.views.entities = function (h) {
    if (h[1] === 'new') return entityForm({ vatFreq: 'monthly', whtRegistered: true, mapping: {} });
    var rows = S.entities.map(function (e) {
      var exs = S.exercises.filter(function (x) { return x.entityId === e.id; }).sort(function (a, b) { return a.period < b.period ? 1 : -1; });
      var last = exs[0];
      return '<tr class="clickable" data-act="goent" data-id="' + e.id + '"><td><b>' + esc(e.name) + '</b><div class="faint">' + esc(e.nameAr || '') + '</div></td><td class="nowrap">' + esc(e.trn || '') + (e.trn && !E.validVatNo(e.trn) ? ' ' + Z.pill('fail', t('Invalid')) : '') + '</td><td>' + t(cap(e.vatFreq || 'monthly')) + '</td><td>' + (e.whtRegistered === false ? '—' : t('Yes')) + '</td><td>' + (last ? esc(last.period) + ' ' + (last.summary ? Z.pill(last.summary.grade, last.summary.score + '%') : '') : '<span class="faint">' + t('None yet') + '</span>') + '</td></tr>';
    }).join('');
    Z.setMain('<div class="pagehead"><div><h1>' + t('Legal entities') + '</h1><p>' + t('Each VAT-registered company or branch with its own TRN and chart of accounts mapping.') + '</p></div>' + (Z.can('manager') ? '<a class="btn primary" href="#/entities/new">' + t('Add entity') + '</a>' : '') + '</div>' +
      '<div class="paper flush"><div class="tbl-wrap"><table class="t"><thead><tr><th>' + t('Entity') + '</th><th>' + t('VAT number (TRN)') + '</th><th>' + t('VAT filing') + '</th><th>' + t('WHT') + '</th><th>' + t('Latest exercise') + '</th></tr></thead><tbody>' + (rows || '<tr><td colspan="5" class="empty">' + t('No entities yet.') + '</td></tr>') + '</tbody></table></div></div>');
  };
  Z.ACT.goent = function (el) { location.hash = '#/entity/' + el.dataset.id; };

  Z.MAP_FIELDS = [
    ['outputVat', 'Output VAT accounts', 'e.g. 2210'], ['inputVat', 'Input VAT accounts', 'e.g. 1410'], ['rcmOutput', 'Reverse-charge output VAT (if separate)', 'optional'],
    ['vatPayable', 'VAT payable / settlement account', 'e.g. 2220'], ['revenue', 'Revenue accounts', 'e.g. 4*'], ['receivables', 'Trade receivables', 'e.g. 1200-1299'],
    ['payables', 'Trade payables', 'e.g. 2100'], ['bank', 'Bank accounts', 'e.g. 11*'], ['whtPayable', 'WHT payable account', 'e.g. 2230'], ['foreignExpense', 'Expense accounts paid to non-residents', 'e.g. 5300,5400']
  ];

  function entityForm(e) {
    var m = e.mapping || {};
    Z.setMain('<div class="pagehead"><div><h1>' + (e.id ? esc(e.name) : t('New entity')) + '</h1><p>' + t('The account mapping tells the system which ledger accounts to reconcile against the returns.') + '</p></div></div>' +
      '<form id="entf" class="stack"><section class="paper"><h2 style="margin-bottom:14px">' + t('Registration') + '</h2><div class="grid g3">' +
      fld('name', t('Legal name (English)'), e.name, 'text', 'required') + fld('nameAr', t('Legal name (Arabic)'), e.nameAr, 'text', 'dir="rtl"') +
      fld('trn', t('VAT number (TRN)'), e.trn, 'text', 'pattern="3[0-9]{13}3" inputmode="numeric"', t('15 digits, starts and ends with 3')) + fld('cr', t('Commercial registration'), e.cr, 'text', 'inputmode="numeric"') +
      '<label class="f"><span>' + t('VAT filing frequency') + '</span><select name="vatFreq"><option value="monthly"' + (e.vatFreq !== 'quarterly' ? ' selected' : '') + '>' + t('Monthly') + '</option><option value="quarterly"' + (e.vatFreq === 'quarterly' ? ' selected' : '') + '>' + t('Quarterly') + '</option></select><small>' + t('Monthly if annual taxable supplies exceed SAR 40 million.') + '</small></label>' +
      '<label class="f"><span>' + t('Pays non-residents (WHT)') + '</span><select name="whtRegistered"><option value="1"' + (e.whtRegistered !== false ? ' selected' : '') + '>' + t('Yes') + '</option><option value="0"' + (e.whtRegistered === false ? ' selected' : '') + '>' + t('No') + '</option></select></label>' +
      fld('erp', t('Accounting system'), e.erp, 'text', '', t('e.g. SAP, Oracle, Odoo, NetSuite')) +
      '<label class="f"><span>' + t('Status') + '</span><select name="active"><option value="1"' + (e.active !== false ? ' selected' : '') + '>' + t('Active') + '</option><option value="0"' + (e.active === false ? ' selected' : '') + '>' + t('Inactive') + '</option></select></label></div></section>' +
      '<section class="paper area-ledger"><h2>' + t('Chart of accounts mapping') + '</h2><p class="muted">' + t('Separate codes with commas. Use 4* for a prefix and 1200-1299 for a range.') + '</p><div class="grid g2" style="margin-top:12px">' +
      Z.MAP_FIELDS.map(function (f) { return fld('map_' + f[0], t(f[1]), m[f[0]], 'text', 'placeholder="' + esc(f[2]) + '"'); }).join('') + '</div></section>' +
      '<div class="row end">' + (e.id && Z.can('owner') ? '<button type="button" class="btn danger" data-act="delent" data-id="' + e.id + '">' + t('Delete entity') + '</button>' : '') + '<a class="btn" href="#/' + (e.id ? 'entity/' + e.id : 'entities') + '">' + t('Cancel') + '</a><button class="btn primary" type="submit">' + t('Save entity') + '</button></div></form>');
    document.getElementById('entf').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var f = Object.fromEntries(new FormData(ev.target)), doc = Object.assign({}, e, { mapping: {} });
      Object.keys(f).forEach(function (k) { if (k.indexOf('map_') === 0) doc.mapping[k.slice(4)] = f[k].trim(); else doc[k] = f[k].trim(); });
      doc.whtRegistered = f.whtRegistered === '1'; doc.active = f.active === '1';
      if (doc.trn && !E.validVatNo(doc.trn)) return Z.toast(t('The VAT number must be 15 digits starting and ending with 3.'), true);
      Z.save('entities', doc).then(function (d) {
        var i = S.entities.findIndex(function (x) { return x.id === d.id; });
        if (i >= 0) S.entities[i] = d; else S.entities.push(d);
        S.entityId = d.id; localStorage.setItem('zr_entity', d.id);
        Z.toast(t('Entity saved')); location.hash = '#/entity/' + d.id;
      });
    });
  }
  function fld(name, label, val, type, attrs, hint) {
    return '<label class="f"><span>' + label + '</span><input type="' + (type || 'text') + '" name="' + name + '" value="' + esc(val || '') + '" ' + (attrs || '') + '>' + (hint ? '<small>' + hint + '</small>' : '') + '</label>';
  }
  Z.fld = fld;
  Z.ACT.delent = function (el) {
    if (!confirm(t('Delete this entity? Its exercises stay in the Google Sheet but will no longer be reachable.'))) return;
    Z.call('remove', { table: 'entities', id: el.dataset.id }).then(function () { S.entities = S.entities.filter(function (e) { return e.id !== el.dataset.id; }); location.hash = '#/entities'; });
  };

  Z.views.entity = function (h) {
    var e = Z.entity(h[1]);
    if (!e) return Z.setMain('<div class="empty"><h2>' + t('Entity not found') + '</h2></div>');
    if (h[2] === 'edit') return entityForm(e);
    S.entityId = e.id; localStorage.setItem('zr_entity', e.id);
    var exs = S.exercises.filter(function (x) { return x.entityId === e.id; }).sort(function (a, b) { return a.period < b.period ? 1 : -1; });
    var periods = E.recentPeriods(e.vatFreq || 'monthly', 12, Z.today()).filter(function (p) { return !exs.some(function (x) { return x.period === p; }); });
    var trend = exs.slice(0, 12).reverse();
    var chart = trend.length > 1 ? trendChart(trend) : '';
    var unmapped = Z.MAP_FIELDS.filter(function (f) { return ['outputVat', 'inputVat', 'revenue', 'receivables', 'whtPayable'].indexOf(f[0]) >= 0 && !(e.mapping || {})[f[0]]; });
    Z.setMain('<div class="pagehead"><div><h1>' + esc(Z.entName(e)) + '</h1><p>' + t('TRN') + ' ' + esc(e.trn || '—') + ' · ' + t(cap(e.vatFreq || 'monthly')) + ' ' + t('VAT filer') + (e.erp ? ' · ' + esc(e.erp) : '') + '</p></div>' +
      '<div class="row">' + (Z.can('manager') ? '<a class="btn" href="#/entity/' + e.id + '/edit">' + t('Edit entity') + '</a>' : '') +
      (Z.can('preparer') && periods.length ? '<select id="newp" aria-label="' + t('Period') + '" style="width:auto">' + periods.map(function (p) { return '<option>' + p + '</option>'; }).join('') + '</select><button class="btn primary" data-act="newexsel" data-e="' + e.id + '">' + t('Start inspection exercise') + '</button>' : '') + '</div></div>' +
      (unmapped.length ? '<div class="paper" style="margin-bottom:18px;border-color:var(--amber)"><b>' + t('Account mapping incomplete:') + '</b> ' + unmapped.map(function (f) { return esc(t(f[1])); }).join(', ') + '. ' + t('Ledger checks for these will show as no data.') + '</div>' : '') +
      '<div class="stack">' + (chart ? '<section class="paper"><header><div><h2>' + t('Readiness and VAT due over time') + '</h2></div></header>' + chart + '</section>' : '') +
      '<section class="paper flush"><div class="tbl-wrap"><table class="t"><thead><tr><th>' + t('Period') + '</th><th>' + t('Status') + '</th><th>' + t('Readiness') + '</th><th class="num">' + t('Net VAT due') + '</th><th class="num">' + t('WHT') + '</th><th class="num">' + t('Exposure') + '</th><th>' + t('Signed off') + '</th></tr></thead><tbody>' +
      (exs.map(function (x) {
        var s = x.summary || {};
        return '<tr class="clickable" data-act="openex" data-id="' + x.id + '"><td><b>' + Z.ltr(x.period) + '</b></td><td>' + Z.statusPill(x.status) + '</td><td>' + (s.score != null ? Z.pill(s.grade, s.score + '% — ' + Z.gradeText(s.grade)) : '—') + '</td><td class="num">' + Z.fmt(s.netVat) + '</td><td class="num">' + Z.fmt(s.whtTax) + '</td><td class="num">' + Z.fmt(s.exposure) + '</td><td>' + esc(x.signedOffBy ? x.signedOffBy + ' ' + String(x.signedOffAt).slice(0, 10) : '') + '</td></tr>';
      }).join('') || '<tr><td colspan="7" class="empty">' + t('No exercises yet. Pick a period and start one.') + '</td></tr>') + '</tbody></table></div></section></div>');
  };
  Z.ACT.newexsel = function (el) { Z.createExercise(el.dataset.e, document.getElementById('newp').value); };
  Z.statusPill = function (st) {
    var m = { in_progress: t('In progress'), review: t('Under review'), closed: t('Signed off') };
    return Z.pill(st || 'in_progress', m[st] || m.in_progress);
  };

  function trendChart(list) {
    var W = 760, H = 180, pad = 34, n = list.length, bw = (W - pad * 2) / n;
    var maxV = Math.max.apply(null, list.map(function (x) { return Math.abs((x.summary || {}).netVat || 0); }).concat([1]));
    var bars = '', line = '', dots = '';
    list.forEach(function (x, i) {
      var s = x.summary || {}, cx = pad + bw * i + bw / 2;
      var bh = Math.abs(s.netVat || 0) / maxV * (H - 60);
      bars += '<rect x="' + (cx - bw * 0.28) + '" y="' + (H - 26 - bh) + '" width="' + (bw * 0.56) + '" height="' + bh + '" fill="var(--rule)" rx="2"><title>' + esc(x.period + ': ' + Z.fmt(s.netVat)) + '</title></rect>';
      var y = H - 26 - (s.score || 0) / 100 * (H - 50);
      line += (i ? 'L' : 'M') + cx + ' ' + y;
      dots += '<circle cx="' + cx + '" cy="' + y + '" r="4" fill="var(--green)"><title>' + esc(x.period + ': ' + (s.score || 0) + '%') + '</title></circle><text x="' + cx + '" y="' + (y - 9) + '" text-anchor="middle" font-size="11" fill="var(--ink)">' + (s.score || 0) + '</text>';
      bars += '<text x="' + cx + '" y="' + (H - 8) + '" text-anchor="middle" font-size="11" fill="var(--ink-2)">' + esc(x.period.slice(2)) + '</text>';
    });
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;height:auto" role="img" aria-label="' + t('Readiness and VAT due over time') + '">' + bars + '<path d="' + line + '" fill="none" stroke="var(--green)" stroke-width="2"/>' + dots + '</svg>' +
      '<p class="faint" style="font-size:12px">' + t('Line: readiness %. Bars: net VAT due (SAR).') + '</p>';
  }

  // ---------------------------------------------------------------- settings
  Z.views.settings = function () {
    var V = S.settings, P = V.penalties;
    var whtRows = E.WHT_TYPES.map(function (w) { return '<tr><td>' + esc(S.lang === 'ar' ? w[2] : w[1]) + '</td><td style="width:120px"><input type="number" step="0.01" min="0" max="100" name="wht_' + w[0] + '" value="' + Z.r(V.whtRates[w[0]] * 100) + '" aria-label="' + esc(w[1]) + '"></td></tr>'; }).join('');
    var bank = Object.keys(V.bankRules).map(function (k) { return '<label class="f"><span>' + esc(t(Z.bankClassName(k))) + '</span><input type="text" name="bank_' + k + '" value="' + esc(V.bankRules[k]) + '"></label>'; }).join('');
    Z.setMain('<div class="pagehead"><div><h1>' + t('Settings') + '</h1><p>' + t('Rules and thresholds for every entity in this organisation. Tax rates and penalties are editable because regulations change — verify them against current ZATCA rules.') + '</p></div></div>' +
      '<form id="setf" class="stack">' +
      '<section class="paper"><h2 style="margin-bottom:12px">' + t('Organisation') + '</h2><div class="grid g2">' + fld('orgName', t('Organisation name'), S.tenant.name) +
      (S.api.mode === 'cloud' && S.tenant.spreadsheetUrl ? '<div class="f"><span class="muted" style="font-size:13px">' + t('Your data') + '</span><p><a href="' + esc(S.tenant.spreadsheetUrl) + '" target="_blank" rel="noopener">' + t('Open the Google Sheet that stores this organisation') + '</a></p></div>' : '') + '</div></section>' +
      '<section class="paper"><h2 style="margin-bottom:12px">' + t('Matching tolerance') + '</h2><div class="grid g4">' +
      fld('tolAbs', t('Pass if difference ≤ (SAR)'), V.tolAbs, 'number', 'step="0.01" min="0"') + fld('tolPct', t('Warn if within % of base'), Z.r(V.tolPct * 100), 'number', 'step="0.01" min="0"') +
      fld('tolWarnAbs', t('…and at most (SAR)'), V.tolWarnAbs, 'number', 'step="1" min="0"') + fld('materiality', t('Materiality (SAR)'), V.materiality, 'number', 'step="1" min="0"') +
      fld('vatRate', t('VAT standard rate %'), Z.r(V.vatRate * 100), 'number', 'step="0.01"') + fld('vatCorrectionThreshold', t('Amended return above (SAR)'), V.vatCorrectionThreshold, 'number') +
      '<label class="f"><span>' + t('Read TB VAT accounts as') + '</span><select name="glBasis"><option value="movement"' + (V.glBasis === 'movement' ? ' selected' : '') + '>' + t('Net movement') + '</option><option value="gross"' + (V.glBasis === 'gross' ? ' selected' : '') + '>' + t('Gross side (credits for output, debits for input)') + '</option></select><small>' + t('Used only when no GL detail is loaded.') + '</small></label>' +
      fld('settlementKeywords', t('Settlement journal keywords'), V.settlementKeywords, 'text', '', t('GL lines with these words are left out of VAT account movement.')) + '</div></section>' +
      '<section class="paper area-wht"><h2>' + t('Withholding tax rates') + '</h2><p class="muted">' + t('Statutory rates for payments to non-residents. Lower treaty rates are accepted when the line is marked as treaty relief with a certificate.') + '</p><div class="tbl-wrap"><table class="t"><thead><tr><th>' + t('Payment type') + '</th><th>%</th></tr></thead><tbody>' + whtRows + '</tbody></table></div></section>' +
      '<section class="paper"><h2 style="margin-bottom:12px">' + t('Penalties used for exposure estimates') + '</h2><div class="grid g3">' +
      fld('pen_vatErrorPct', t('Incorrect VAT return — % of difference'), Z.r(P.vatErrorPct * 100), 'number', 'step="0.1"') + fld('pen_vatLatePaymentPctPerMonth', t('VAT late payment — % per month'), Z.r(P.vatLatePaymentPctPerMonth * 100), 'number', 'step="0.1"') +
      fld('pen_whtLatePctPer30Days', t('WHT late payment — % per 30 days'), Z.r(P.whtLatePctPer30Days * 100), 'number', 'step="0.1"') + fld('pen_vatLateFilingMinPct', t('VAT late filing — minimum %'), Z.r(P.vatLateFilingMinPct * 100), 'number') +
      fld('pen_vatLateFilingMaxPct', t('VAT late filing — maximum %'), Z.r(P.vatLateFilingMaxPct * 100), 'number') + fld('pen_invoiceViolationMax', t('Tax invoice violation — maximum (SAR)'), P.invoiceViolationMax, 'number') + '</div></section>' +
      '<section class="paper area-bank"><h2>' + t('Bank line classification') + '</h2><p class="muted">' + t('Comma-separated words found in a bank line\'s description. You can still reclassify any line by hand.') + '</p><div class="grid g2" style="margin-top:12px">' + bank + '</div></section>' +
      '<section class="paper"><h2>' + t('Readiness score weights') + '</h2><div class="grid g3" style="margin-top:12px">' + Object.keys(V.weights).map(function (k) { return fld('w_' + k, t(Z.partName(k)), V.weights[k], 'number', 'min="0" step="1"'); }).join('') + '</div></section>' +
      (Z.can('manager') ? '<div class="row end"><button class="btn primary" type="submit">' + t('Save settings') + '</button></div>' : '') + '</form>' +
      '<section class="paper" style="margin-top:18px"><h2>' + t('Storage') + '</h2>' + storageBox() + '</section>');
    document.getElementById('setf').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var f = Object.fromEntries(new FormData(ev.target)), v = { whtRates: {}, penalties: {}, bankRules: {}, weights: {} };
      Object.keys(f).forEach(function (k) {
        var val = f[k];
        if (k.indexOf('wht_') === 0) v.whtRates[k.slice(4)] = +val / 100;
        else if (k.indexOf('pen_') === 0) v.penalties[k.slice(4)] = /Pct/.test(k) ? +val / 100 : +val;
        else if (k.indexOf('bank_') === 0) v.bankRules[k.slice(5)] = val;
        else if (k.indexOf('w_') === 0) v.weights[k.slice(2)] = +val;
        else if (k === 'tolPct' || k === 'vatRate') v[k] = +val / 100;
        else if (k === 'glBasis' || k === 'settlementKeywords') v[k] = val;
        else if (k !== 'orgName') v[k] = +val;
      });
      var jobs = [Z.save('settings', { id: 'tenant', values: v })];
      if (f.orgName && f.orgName !== S.tenant.name) jobs.push(Z.call('tenantSave', { tenant: { name: f.orgName } }).then(function (r) { S.tenant = r.tenant; }));
      Promise.all(jobs).then(function (r) { S.settingsDoc = r[0]; S.settings = E.mergeSettings(v); Z.toast(t('Settings saved')); Z.route(); });
    });
  };
  Z.r = function (x) { return Math.round(x * 1000) / 1000; };
  function storageBox() {
    if (S.api.mode === 'cloud') return '<p>' + t('Connected to the Google Sheets backend.') + '</p>' + (localStorage.getItem('zr_api_url') ? '<button class="btn small" data-act="disconnect">' + t('Disconnect and use this device only') + '</button>' : '');
    return '<p>' + t('Everything is stored in this browser. To share across users and entities, deploy the Apps Script backend (see README) and paste its web app URL.') + '</p>' +
      '<div class="row" style="margin-top:8px"><input type="url" id="apiurl" placeholder="https://script.google.com/macros/s/…/exec" style="max-width:520px"><button class="btn primary" data-act="connect">' + t('Connect') + '</button></div>' +
      '<div class="row" style="margin-top:14px"><button class="btn" data-act="backup">' + t('Download backup (JSON)') + '</button><label class="btn">' + t('Restore backup') + '<input type="file" accept=".json" data-chg="restore" hidden></label><button class="btn danger" data-act="wipe">' + t('Erase all data on this device') + '</button></div>';
  }
  Z.ACT.connect = function () {
    var u = document.getElementById('apiurl').value.trim();
    if (!/^https:\/\/script\.google(usercontent)?\.com\//.test(u)) return Z.toast(t('Paste the web app URL that ends in /exec.'), true);
    localStorage.setItem('zr_api_url', u); try { sessionStorage.removeItem('zr_local'); } catch (e) {} location.hash = ''; location.reload();
  };
  Z.ACT.disconnect = function () { localStorage.removeItem('zr_api_url'); try { sessionStorage.setItem('zr_local', '1'); } catch (e) {} location.reload(); };
  Z.ACT.wipe = function () { if (confirm(t('Erase every entity, exercise and file stored in this browser?'))) S.api.wipe().then(function () { location.hash = ''; location.reload(); }); };
  Z.ACT.backup = function () {
    var tables = ['entities', 'exercises', 'datasets', 'rows', 'samples', 'findings', 'checklists', 'settings'], out = {};
    Promise.all(tables.map(function (tb) { return Z.list(tb).then(function (d) { out[tb] = d; }); })).then(function () {
      var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(out)], { type: 'application/json' }));
      a.download = 'inspection-ready-backup-' + Z.today() + '.json'; a.click();
    });
  };
  Z.CHG.restore = function (el) {
    var f = el.files[0]; if (!f) return;
    f.text().then(function (txt) {
      var d = JSON.parse(txt);
      return Promise.all(Object.keys(d).map(function (tb) { return d[tb].length ? Z.call('saveMany', { table: tb, docs: d[tb] }) : null; }));
    }).then(function () { Z.toast(t('Backup restored')); Z.reloadAll(); }).catch(function (e) { Z.toast(e.message, true); });
  };

  // ---------------------------------------------------------------- users
  Z.views.users = function () {
    if (S.api.mode !== 'cloud') return Z.setMain('<div class="paper empty"><h2>' + t('Users need the Google Sheets backend') + '</h2><p>' + t('On this device there is one user. Connect the backend in Settings to invite your team with roles and entity access.') + '</p></div>');
    return Z.call('usersList').then(function (r) {
      S.users = r.users;
      var rows = r.users.map(function (u) {
        var ents = (u.entityIds || []).indexOf('*') >= 0 ? t('All entities') : (u.entityIds || []).map(function (id) { return Z.entName(Z.entity(id)); }).join(', ');
        return '<tr class="clickable" data-act="edituser" data-id="' + u.id + '"><td><b>' + esc(u.name) + '</b><div class="faint">' + esc(u.email) + '</div></td><td>' + esc(t(cap(u.role))) + '</td><td>' + esc(ents) + '</td><td>' + (u.active ? Z.pill('pass', t('Active')) : Z.pill('na', t('Disabled'))) + '</td><td>' + esc(String(u.lastLoginAt || '').slice(0, 16).replace('T', ' ')) + '</td></tr>';
      }).join('');
      Z.setMain('<div class="pagehead"><div><h1>' + t('Users') + '</h1><p>' + t('Owner: everything. Manager: entities, settings and sign-off. Preparer: uploads, checks, samples and findings. Viewer: read only.') + '</p></div><button class="btn primary" data-act="edituser">' + t('Add user') + '</button></div>' +
        '<div class="paper flush"><div class="tbl-wrap"><table class="t"><thead><tr><th>' + t('User') + '</th><th>' + t('Role') + '</th><th>' + t('Entity access') + '</th><th>' + t('Status') + '</th><th>' + t('Last sign-in') + '</th></tr></thead><tbody>' + rows + '</tbody></table></div></div>');
    });
  };
  Z.ACT.edituser = function (el) {
    var u = (S.users || []).filter(function (x) { return x.id === el.dataset.id; })[0] || { role: 'preparer', entityIds: ['*'], active: true };
    var all = (u.entityIds || []).indexOf('*') >= 0;
    Z.modal(u.id ? u.name : t('Add user'), '<form id="userf" class="grid g2">' + fld('name', t('Name'), u.name, 'text', 'required') + fld('email', t('Email'), u.email, 'email', 'required') +
      '<label class="f"><span>' + t('Role') + '</span><select name="role">' + ['owner', 'manager', 'preparer', 'viewer'].map(function (r) { return '<option value="' + r + '"' + (u.role === r ? ' selected' : '') + '>' + t(cap(r)) + '</option>'; }).join('') + '</select></label>' +
      fld('password', u.id ? t('New password (leave blank to keep)') : t('Temporary password'), '', 'password', u.id ? 'minlength="10"' : 'required minlength="10"', t('Share it with the user privately.')) +
      '<fieldset class="f" style="grid-column:1/-1;border:1px solid var(--rule);border-radius:4px"><legend>' + t('Entity access') + '</legend><label><input type="checkbox" name="all"' + (all ? ' checked' : '') + '> ' + t('All entities, including future ones') + '</label>' +
      S.entities.map(function (e) { return '<label style="display:block"><input type="checkbox" name="ent" value="' + e.id + '"' + ((u.entityIds || []).indexOf(e.id) >= 0 ? ' checked' : '') + '> ' + esc(Z.entName(e)) + '</label>'; }).join('') + '</fieldset>' +
      '<label class="f"><span>' + t('Status') + '</span><select name="active"><option value="1">' + t('Active') + '</option><option value="0"' + (u.active === false ? ' selected' : '') + '>' + t('Disabled') + '</option></select></label></form>',
      '<button class="btn" data-act="closemodal">' + t('Cancel') + '</button><button class="btn primary" data-act="saveuser" data-id="' + (u.id || '') + '">' + t('Save user') + '</button>');
  };
  Z.ACT.saveuser = function (el) {
    var form = document.getElementById('userf'); if (!form.reportValidity()) return;
    var fd = new FormData(form);
    var u = { id: el.dataset.id || undefined, name: fd.get('name'), email: fd.get('email'), role: fd.get('role'), password: fd.get('password') || undefined, active: fd.get('active') === '1',
      entityIds: fd.get('all') ? ['*'] : fd.getAll('ent') };
    Z.call('userSave', { user: u }).then(function () { Z.closeModal(); Z.toast(t('User saved')); Z.route(); });
  };

  // ---------------------------------------------------------------- audit & platform
  Z.views.audit = function () {
    return Z.list('audit').then(function (docs) {
      docs.sort(function (a, b) { return a.at < b.at ? 1 : -1; });
      Z.setMain('<div class="pagehead"><div><h1>' + t('Audit trail') + '</h1><p>' + t('Every change, who made it and when. Kept in the organisation\'s own Google Sheet.') + '</p></div></div><div class="paper flush"><div class="tbl-wrap"><table class="t"><thead><tr><th>' + t('When') + '</th><th>' + t('Who') + '</th><th>' + t('Action') + '</th><th>' + t('Record') + '</th></tr></thead><tbody>' +
        docs.slice(0, 500).map(function (a) { return '<tr><td class="nowrap">' + esc(String(a.at).slice(0, 19).replace('T', ' ')) + '</td><td>' + esc(a.user) + '</td><td>' + esc(a.action + ' ' + a.table) + '</td><td>' + esc(a.detail) + '</td></tr>'; }).join('') + '</tbody></table></div></div>');
    });
  };
  Z.views.platform = function () {
    return Z.call('platformTenants').then(function (r) {
      Z.setMain('<div class="pagehead"><div><h1>' + t('Platform — organisations') + '</h1><p>' + t('Every tenant has its own Google Sheet.') + '</p></div></div><div class="paper flush"><table class="t"><thead><tr><th>' + t('Organisation') + '</th><th>' + t('Created') + '</th><th>' + t('Status') + '</th><th></th></tr></thead><tbody>' +
        r.tenants.map(function (x) { return '<tr><td><b>' + esc(x.name) + '</b><div><a href="' + esc(x.spreadsheetUrl) + '" target="_blank" rel="noopener">' + t('Sheet') + '</a></div></td><td>' + esc(String(x.createdAt).slice(0, 10)) + '</td><td>' + Z.pill(x.status === 'active' ? 'pass' : 'fail', t(cap(x.status))) + '</td><td><button class="btn small" data-act="tstatus" data-id="' + x.id + '" data-s="' + (x.status === 'active' ? 'suspended' : 'active') + '">' + (x.status === 'active' ? t('Suspend') : t('Reactivate')) + '</button></td></tr>'; }).join('') + '</tbody></table></div>');
    }).catch(function () { Z.setMain('<div class="paper empty"><h2>' + t('Platform administrators only') + '</h2><p>' + t('Add your email to the SUPER_ADMINS script property to manage tenants.') + '</p></div>'); });
  };
  Z.ACT.tstatus = function (el) { Z.call('platformTenantStatus', { id: el.dataset.id, status: el.dataset.s }).then(Z.route); };

  // ---------------------------------------------------------------- modal
  Z.modal = function (title, body, foot, wide) {
    Z.closeModal();
    var d = document.createElement('div'); d.className = 'scrim'; d.id = 'scrim';
    d.innerHTML = '<div class="modal" role="dialog" aria-modal="true" aria-labelledby="mt"' + (wide ? ' style="width:min(1200px,100%)"' : '') + '><header><h2 id="mt">' + esc(title) + '</h2><button class="btn ghost" data-act="closemodal" aria-label="' + t('Close') + '">✕</button></header><div class="body">' + body + '</div>' + (foot ? '<footer>' + foot + '</footer>' : '') + '</div>';
    d.addEventListener('mousedown', function (e) { if (e.target === d) Z.closeModal(); });
    document.body.appendChild(d);
    var f = d.querySelector('input,select,textarea,button.primary'); if (f) f.focus();
  };
  Z.closeModal = function () { var m = document.getElementById('scrim'); if (m) m.remove(); };
  Z.ACT.closemodal = Z.closeModal;

  Z.bankClassName = function (k) {
    return { customer_receipt: 'Customer receipts', supplier_payment: 'Supplier payments', zatca_vat: 'VAT paid to ZATCA', zatca_wht: 'WHT paid to ZATCA', zakat: 'Zakat', foreign_transfer: 'Foreign transfers', payroll: 'Payroll', internal_transfer: 'Internal transfers', financing: 'Financing / loans', other_in: 'Other receipts', other_out: 'Other payments' }[k] || k;
  };
  Z.partName = function (k) { return { recon: 'Return & ledger reconciliation', bank: 'Bank reconciliation', analytics: 'Data analytics', sampling: 'Sample testing', checklist: 'Documents on file', findings: 'Open findings' }[k] || k; };

  // apply saved theme before first paint
  try { var th = localStorage.getItem('zr_theme'); if (th) document.documentElement.dataset.theme = th; } catch (e) {}
})();
