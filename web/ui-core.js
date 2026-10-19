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
    if (n == null || n === '' || isNaN(n)) return '-';
    dp = dp == null ? 2 : dp;
    NF[dp] = NF[dp] || new Intl.NumberFormat('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
    var s = NF[dp].format(Math.abs(n));
    return n < 0 ? '(' + s + ')' : s;
  };
  // dates, periods and codes stay left-to-right inside Arabic text
  Z.ltr = function (s) { return '<bdi dir="ltr">' + esc(s) + '</bdi>'; };
  Z.pct = function (x) { return x == null ? '-' : Math.round(x * 100) + '%'; };
  Z.tick = function (st, title) {
    var ic = { pass: 'ph-check-circle', warn: 'ph-warning-circle', fail: 'ph-x-circle', na: 'ph-minus-circle' }[st] || 'ph-minus-circle';
    var lab = { pass: t('Passed'), warn: t('Needs explanation'), fail: t('Failed'), na: t('No data') }[st];
    return '<span class="tk ' + (st || 'na') + '" role="img" aria-label="' + esc(title || lab) + '" title="' + esc(title || lab) + '"><i class="ph ' + ic + '" aria-hidden="true"></i></span>';
  };
  Z.canExitDemo = function () { return S.api && S.api.mode === 'local' && !!(window.ZR_API_URL || localStorage.getItem('zr_api_url')); };
  Z.exitButton = function (cls) {
    if (S.api && S.api.mode === 'cloud') return '<button class="' + cls + '" data-act="logout">' + Z.icon('sign-out') + '<span>' + t('Sign out') + '</span></button>';
    if (Z.canExitDemo()) return '<button class="' + cls + '" data-act="exitdemo">' + Z.icon('sign-out') + '<span>' + t('Exit demo') + '</span></button>';
    return '';
  };
  Z.ACT.exitdemo = function () { try { sessionStorage.removeItem('zr_local'); } catch (e) {} location.hash = ''; location.reload(); };
  // demo-mode defaults are English words; show them in the interface language
  Z.userName = function () { return S.api && S.api.mode === 'local' ? t(S.user.name) : S.user.name; };
  Z.orgName = function () { return !S.tenant ? '' : S.api && S.api.mode === 'local' ? t(S.tenant.name) : S.tenant.name; };
  Z.icon = function (name) { return '<i class="ph ph-' + name + '" aria-hidden="true"></i>'; };
  // the active tax section: 'vat' or 'wht'
  Z.isWht = function () { return S.tax === 'wht'; };
  Z.taxScore = function (sm) {
    sm = sm || {};
    var sc = Z.isWht() ? sm.whtScore : sm.vatScore, g = Z.isWht() ? sm.whtGrade : sm.vatGrade;
    // summaries saved before the split carry only the combined score
    if (sc === undefined) { sc = sm.score; g = sm.grade; }
    return { score: sc == null ? null : sc, grade: g || 'not' };
  };
  Z.taxName = function () { return Z.isWht() ? t('Withholding tax') : t('VAT'); };
  Z.pill = function (cls, text) { return '<span class="pill ' + esc(cls) + '">' + esc(text) + '</span>'; };
  Z.toast = function (msg, err) {
    var el = document.createElement('div'); el.className = 'toast' + (err ? ' err' : ''); el.setAttribute('role', err ? 'alert' : 'status');
    el.innerHTML = '<i class="ph ph-' + (err ? 'warning-circle' : 'check-circle') + '" aria-hidden="true"></i><span></span>'; el.lastChild.textContent = msg;
    document.querySelectorAll('.toast').forEach(function (x) { x.remove(); });
    document.body.appendChild(el); setTimeout(function () { el.remove(); }, err ? 5200 : 2600);
  };
  Z.can = function (role) { var R = { owner: 4, manager: 3, preparer: 2, viewer: 1 }; return (R[(S.user || {}).role] || 0) >= R[role]; };
  Z.uid = function (p) { return p + '-' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4); };
  Z.today = function () { return new Date().toISOString().slice(0, 10); };
  Z.gradeText = function (g) { return { ready: t('Ready for inspection'), mostly: t('Mostly ready'), risk: t('At risk'), not: t('Not ready') }[g] || '-'; };

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
  Z.seal = function (score, grade, small) {
    var r = 52, c = 2 * Math.PI * r, v = Math.max(0, Math.min(100, +score || 0));
    return '<svg class="seal ' + (grade || 'not') + (small ? ' small' : '') + '" viewBox="0 0 120 120" role="img" aria-label="' + esc(t('Readiness') + ' ' + (score == null ? '-' : score + '%') + ', ' + Z.gradeText(grade)) + '">' +
      '<circle class="track" cx="60" cy="60" r="' + r + '" fill="none" stroke-width="9"/>' +
      '<circle class="arc" style="--c:' + c.toFixed(1) + '" cx="60" cy="60" r="' + r + '" fill="none" stroke-width="9" stroke-linecap="round" stroke-dasharray="' + c.toFixed(1) + '" stroke-dashoffset="' + (c * (1 - v / 100)).toFixed(1) + '" transform="rotate(-90 60 60)"/>' +
      '<text x="60" y="' + (small ? 69 : 66) + '" text-anchor="middle" font-size="' + (small ? 28 : 30) + '" font-weight="800">' + (score == null ? '-' : score) + '<tspan font-size="14" dx="1" dy="-10">%</tspan></text>' +
      (small ? '' : '<text class="lbl" x="60" y="84" text-anchor="middle" font-size="10" font-weight="600">' + esc(t('Readiness')) + '</text>') + '</svg>';
  };

  // ---------------------------------------------------------------- boot
  Z.validApi = function (u) { return /^https:\/\/script\.google\.com\/macros\/s\/[\w-]{20,}\/exec$/.test(String(u || '')); };
  Z.boot = function () {
    S.lang = localStorage.getItem('zr_lang') || 'en';
    applyLang();
    // A hosted copy (GitHub Pages) has its backend URL baked in by build.js and
    // talks to nothing else: a link carrying ?api= (or a stored address) could
    // otherwise send sign-ins to someone else's server (found by the REA audit).
    // The generic build accepts only an Apps Script /exec address, and only
    // after the person confirms it.
    var q = new URLSearchParams(location.search), asked = q.get('api');
    if (asked && !window.ZR_API_URL) {
      if (Z.validApi(asked) && confirm(t('Connect this app to the backend at') + '\n' + asked + '\n\n' + t('Only continue if your administrator gave you this address.'))) localStorage.setItem('zr_api_url', asked);
      history.replaceState(null, '', location.pathname + location.hash);
    }
    // "try it on this device" opts out of the backend for the rest of the browser session.
    var demo = false;
    try { demo = sessionStorage.getItem('zr_local') === '1'; } catch (e) {}
    var stored = localStorage.getItem('zr_api_url');
    if (stored && !Z.validApi(stored)) { localStorage.removeItem('zr_api_url'); stored = ''; }
    var url = demo ? '' : window.ZR_API_URL || stored || '';
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
      t('Bank statements traced to declared sales and purchases - unreported cash surfaces before the inspector finds it'),
      t('Withholding tax: rates, treaty relief, the 10th-of-month deadline, certificates and foreign transfers'),
      t('Reproducible statistical samples of sales, purchases and WHT payments, tested attribute by attribute'),
      t('Every entity, every month, one readiness score - stored in your own Google Sheets')
    ];
    document.body.innerHTML = '<div class="auth"><section class="side"><div class="brand">' + logo() + '<div><b>Inspection Ready</b><span>' + t('VAT & WHT inspection readiness') + '</span></div></div>' +
      '<div><h1>' + t('Be ready the day ZATCA asks.') + '</h1><p style="margin-top:12px;color:#cfe5dc">' + t('A monthly inspection exercise for every legal entity: reconcile, sample, document, sign off.') + '</p></div>' +
      '<ul>' + pts.map(function (p) { return '<li>' + Z.icon('check-circle') + '<span>' + esc(p) + '</span></li>'; }).join('') + '</ul></section>' +
      '<section class="form"><div><div class="spread" style="margin-bottom:22px"><h2>' + (mode === 'login' ? t('Sign in') : t('Create your organisation')) + '</h2><button class="btn ghost small" data-act="lang">' + (S.lang === 'ar' ? 'English' : 'العربية') + '</button></div>' +
      '<form id="authf" class="grid">' +
      (mode === 'signup' ? '<label class="f"><span>' + t('Organisation name') + '</span><input type="text" name="orgName" required autocomplete="organization"></label><label class="f"><span>' + t('Your name') + '</span><input type="text" name="name" required autocomplete="name"></label>' : '') +
      '<label class="f"><span>' + t('Email') + '</span><input type="email" name="email" required autocomplete="email"></label>' +
      '<label class="f"><span>' + t('Password') + '</span><input type="password" name="password" required minlength="' + (mode === 'signup' ? 10 : 1) + '" autocomplete="' + (mode === 'signup' ? 'new-password' : 'current-password') + '">' + (mode === 'signup' ? '<small>' + t('At least 10 characters.') + '</small>' : '') + '</label>' +
      '<label class="row" style="gap:8px;margin:2px 0 4px;font-size:14px"><input type="checkbox" name="remember" value="1" checked style="width:auto"> ' + t('Keep me signed in on this device') + '</label>' +
      '<button class="btn primary" type="submit">' + (mode === 'login' ? t('Sign in') : t('Create organisation')) + '</button></form>' +
      '<p class="muted" style="margin-top:18px">' + (mode === 'login' ? t('New here?') + ' <a href="#" data-act="authmode" data-m="signup">' + t('Create an organisation') + '</a>' : '<a href="#" data-act="authmode" data-m="login">' + t('I already have an account') + '</a>') + '</p>' +
      '<p class="faint" style="font-size:13px">' + t('Want to look around first?') + ' <a href="#" data-act="localmode">' + t('Try it on this device with demo data') + '</a></p></div></section></div>';
    document.getElementById('authf').addEventListener('submit', function (e) {
      e.preventDefault();
      var f = Object.fromEntries(new FormData(e.target)); f.remember = !!f.remember;
      Z.call(mode, f).then(function (r) { start(r); });
    });
  };
  Z.ACT.authmode = function (el) { Z.renderAuth(el.dataset.m); };
  Z.ACT.localmode = function () { try { sessionStorage.setItem('zr_local', '1'); } catch (e) {} S.api = new ZApi.LocalBackend(); start({}); };
  Z.ACT.logout = function () { S.api.logout(); S.user = null; location.hash = ''; Z.renderAuth(); };

  function logo() { return '<span class="mark" aria-hidden="true"><i class="ph ph-seal-check"></i></span>'; }

  // ---------------------------------------------------------------- shell & routing
  Z.route = function () {
    if (!S.user) return;
    var h = location.hash.replace(/^#\/?/, '').split('/');
    if (h[0] === 'vat' || h[0] === 'wht') { S.tax = h[0]; h = h.slice(1); try { localStorage.setItem('zr_tax', S.tax); } catch (e) {} }
    if (!S.tax) { try { S.tax = localStorage.getItem('zr_tax'); } catch (e) {} }
    if (S.tax !== 'wht') S.tax = 'vat';
    document.documentElement.dataset.tax = S.tax;
    S.route = h;
    var view = h[0] || 'dashboard';
    if (!document.querySelector('.shell')) shell();
    paintRail(view);
    paintTop();
    var main = document.getElementById('main');
    main.innerHTML = '<div class="skel" aria-busy="true"><span class="sr-only">' + t('Loading…') + '</span><div class="sk t"></div><div class="sk p"></div><div class="row3"><div class="sk"></div><div class="sk"></div><div class="sk"></div><div class="sk"></div></div><div class="sk big"></div></div>';
    var fn = Z.views[view] || Z.views.dashboard;
    Promise.resolve(fn(h)).catch(function (e) {
      if (e && e.notFound) { main.innerHTML = '<div class="paper empty"><i class="ph ph-magnifying-glass big" aria-hidden="true"></i><h2>' + esc(e.message) + '</h2><p>' + t('It may have been deleted, or the link is incomplete.') + '</p><a class="btn primary" href="#/' + S.tax + '/dashboard">' + t('Back to the dashboard') + '</a></div>'; return; }
      console.error(e); main.innerHTML = '<div class="empty"><h2>' + t('This page could not load') + '</h2><p>' + esc(e.message) + '</p></div>'; });
    document.querySelector('.shell').classList.remove('open');
    window.scrollTo(0, 0);
  };
  Z.paintChrome = function (view) { paintRail(view); paintTop(); };
  Z.setMain = function (html) { document.getElementById('main').innerHTML = html; Z.fitTabs(); Z.scrollables(); if (Z.revealPage) Z.revealPage(); };
  Z.scrollables = function () {
    document.querySelectorAll('#main .tbl-wrap').forEach(function (w) {
      if (w.scrollWidth > w.clientWidth + 1) { w.tabIndex = 0; w.setAttribute('role', 'region'); if (!w.getAttribute('aria-label')) { var h = w.closest('section') && w.closest('section').querySelector('h2, h3'); w.setAttribute('aria-label', h ? h.textContent : t('Table')); } }
    });
  };
  // Keeps every tab strip on one row. Tabs that do not fit move, from the end,
  // into a "More" menu; the open tab always stays visible.
  Z.fitTabs = function () {
    document.querySelectorAll('#main nav.tabs').forEach(function (nav) {
      var more = nav.querySelector('details.more');
      if (more) { more.querySelectorAll('.menu a').forEach(function (a) { nav.insertBefore(a, more); }); more.remove(); }
      if (nav.scrollWidth <= nav.clientWidth + 1) return;
      more = document.createElement('details'); more.className = 'more';
      more.innerHTML = '<summary>' + t('More') + ' <i class="ph ph-caret-down" aria-hidden="true"></i><span class="count">00</span></summary><div class="menu" role="menu"></div>';  // the badge is measured too
      nav.appendChild(more);
      var menu = more.querySelector('.menu'), links = [].slice.call(nav.querySelectorAll(':scope > a'));
      for (var i = links.length - 1; i >= 0 && nav.scrollWidth > nav.clientWidth + 1; i--) {
        if (links[i].getAttribute('aria-current') === 'page') continue;
        menu.insertBefore(links[i], menu.firstChild);
      }
      var hidden = menu.querySelectorAll('a'), bad = 0;
      if (!hidden.length) { more.remove(); return; }
      hidden.forEach(function (a) { a.setAttribute('role', 'menuitem'); var c = a.querySelector('.count'); if (c) bad += +c.textContent || 0; });
      var badge = more.querySelector('summary .count');
      if (bad) badge.textContent = bad; else badge.remove();
    });
  };
  var fitT;
  window.addEventListener('resize', function () { clearTimeout(fitT); fitT = setTimeout(Z.fitTabs, 120); });
  // web fonts arrive after the first render and are wider than the fallback: measure again
  if (document.fonts) { document.fonts.addEventListener('loadingdone', function () { Z.fitTabs(); }); if (document.fonts.ready) document.fonts.ready.then(function () { Z.fitTabs(); }); }
  document.addEventListener('click', function (e) { document.querySelectorAll('details.more[open]').forEach(function (d) { if (!d.contains(e.target) || e.target.closest('.menu a')) d.open = false; }); });

  function shell() {
    document.body.innerHTML = '<div class="shell"><header class="top"></header><nav class="rail" aria-label="' + t('Main') + '"></nav><div class="col">' +
      (S.api.mode === 'local' ? '<div class="banner">' + t('Demo mode: data stays in this browser only.') + ' <a href="#/settings">' + t('Connect your Google Sheets backend') + '</a></div>' : '') +
      '<main id="main" class="main" tabindex="-1"></main></div></div>';
  }
  // Sidebar: the section it belongs to, the way around, the exercise in hand and who is signed in.
  // It folds to icons (remembered per browser); labels then show as tooltips.
  Z.railMini = function () { try { return localStorage.getItem('zr_mini') === '1'; } catch (e) { return false; } };
  Z.ACT.railmini = function () {
    var on = !Z.railMini(); try { localStorage.setItem('zr_mini', on ? '1' : '0'); } catch (e) {}
    document.querySelector('.shell').classList.toggle('folded', on); paintRail((S.route || [])[0] || 'dashboard');
  };
  function initials(n) { return String(n || '?').trim().split(/\s+/).slice(0, 2).map(function (w) { return w[0]; }).join('').toUpperCase(); }
  function miniRing(score, grade) {
    var r = 15, c = 2 * Math.PI * r, v = Math.max(0, Math.min(100, +score || 0));
    return '<svg class="mring ' + (grade || 'not') + '" viewBox="0 0 36 36" aria-hidden="true"><circle class="track" cx="18" cy="18" r="' + r + '" fill="none" stroke-width="4"/><circle class="arc" style="--c:' + c.toFixed(1) + '" cx="18" cy="18" r="' + r + '" fill="none" stroke-width="4" stroke-linecap="round" stroke-dasharray="' + c.toFixed(1) + '" stroke-dashoffset="' + (c * (1 - v / 100)).toFixed(1) + '" transform="rotate(-90 18 18)"/></svg>';
  }
  function paintRail(view) {
    var ex = S.exId && S.ex ? S.ex : null, tx = S.tax, wht = Z.isWht(), mini = Z.railMini();
    var shellEl = document.querySelector('.shell'); if (shellEl) shellEl.classList.toggle('folded', mini);
    var nav = function (href, label, icon, on, ext) {
      return '<a class="nav" href="' + href + '"' + (on ? ' aria-current="page"' : '') + (ext ? ' target="_blank" rel="noopener noreferrer"' : '') + ' data-tip="' + esc(label) + '"><span class="ni">' + Z.icon(icon) + '</span><span class="nl">' + label + '</span>' + (ext ? '<i class="ph ph-arrow-square-out nx" aria-hidden="true"></i>' : '') + '</a>';
    };
    var h = '<div class="rail-sec"><span class="rs-ico">' + Z.icon(wht ? 'hand-coins' : 'receipt') + '</span><span class="rs-t"><b>' + Z.taxName() + '</b><small>' + (wht ? t('Payments to non-residents') : t('Returns, e-invoicing and bank')) + '</small></span>' +
      '<button type="button" class="rail-mini" data-act="railmini" aria-pressed="' + mini + '" aria-label="' + esc(mini ? t('Expand the menu') : t('Collapse the menu')) + '" data-tip="' + esc(mini ? t('Expand the menu') : t('Collapse the menu')) + '">' + Z.icon(mini ? 'caret-double-' + (S.lang === 'ar' ? 'left' : 'right') : 'caret-double-' + (S.lang === 'ar' ? 'right' : 'left')) + '</button></div>';
    h += '<nav class="rail-nav" aria-label="' + esc(t('Main')) + '">';
    h += nav('#/' + tx + '/dashboard', t('Dashboard'), 'squares-four', view === 'dashboard');
    h += nav('#/' + tx + '/insights', t('Company 360'), 'chart-line-up', view === 'insights');
    h += nav('#/' + tx + '/reports', t('Reports'), 'chart-bar', view === 'reports');
    if (ex) {
      var ent = Z.entity(ex.entityId) || {}, sc = Z.taxScore(ex.summary), crit = Z.planFor && S.R ? Z.planFor().critical : 0;
      h += '<a class="current" href="#/' + tx + '/ex/' + ex.id + '/' + (crit ? 'plan' : 'overview') + '"' + (view === 'ex' ? ' aria-current="page"' : '') + ' data-tip="' + esc(Z.entName(ent) + ' ' + ex.period) + '">' + miniRing(sc.score, sc.grade) +
        '<span class="cur-t"><small>' + t('Open exercise') + '</small><b>' + esc(Z.entName(ent)) + '</b><span>' + Z.ltr(ex.period) + (sc.score != null ? ', ' + sc.score + '%' : '') + '</span></span>' +
        (crit ? '<span class="nb" title="' + esc(t('Critical actions')) + '">' + crit + '</span>' : '') + '</a>';
    }
    h += '<div class="group">' + t('Organisation') + '</div>';
    h += nav('#/' + tx + '/entities', t('Entities'), 'buildings', view === 'entities' || view === 'entity' || view === 'annual');
    h += nav('#/' + tx + '/requests', t('ZATCA requests'), 'envelope-simple', view === 'requests');
    [['settings', t('Settings'), 'gear-six', 'manager'], ['users', t('Users'), 'users-three', 'owner'], ['audit', t('Audit trail'), 'list-checks', 'manager']].forEach(function (i) {
      if (Z.can(i[3])) h += nav('#/' + tx + '/' + i[0], i[1], i[2], view === i[0]);
    });
    if (S.api.mode === 'cloud') h += nav('#/' + tx + '/platform', t('Platform'), 'globe-hemisphere-east', view === 'platform');
    h += '<div class="group">' + t('Help and data') + '</div>';
    if (S.api.mode === 'cloud' && S.tenant && S.tenant.spreadsheetUrl) h += nav(esc(S.tenant.spreadsheetUrl), t('Google Sheet (your data)'), 'table', false, true);
    h += nav('https://besgasksa.github.io/Zatca/Inspection-Ready-Guide.pdf', t('User guide (PDF)'), 'book-open-text', false, true);
    h += '</nav>';
    h += '<div class="foot"><div class="me"><span class="av" aria-hidden="true">' + esc(initials(Z.userName())) + '</span><span class="me-t"><b>' + esc(Z.userName()) + '</b><small>' + esc(t(cap(S.user.role))) + (S.tenant ? ', ' + esc(Z.orgName()) : '') + '</small>' +
      (S.api.mode === 'cloud' ? '' : '<small class="local">' + Z.icon('hard-drives') + ' ' + t('Stored on this device') + '</small>') + '</span></div>' +
      '<div class="foot-acts"><button type="button" class="btn small ghost" data-act="lang" data-tip="' + esc(S.lang === 'ar' ? 'English' : 'العربية') + '">' + Z.icon('translate') + '<span>' + (S.lang === 'ar' ? 'English' : 'العربية') + '</span></button>' + Z.exitButton('btn small exit-btn') + '</div></div>';
    document.querySelector('.rail').innerHTML = h;
  }
  function cap(s) { return s ? s[0].toUpperCase() + s.slice(1) : ''; }
  Z.cap = cap;
  function paintTop() {
    var opts = S.entities.map(function (e) { return '<option value="' + e.id + '"' + (e.id === S.entityId ? ' selected' : '') + '>' + esc(S.lang === 'ar' && e.nameAr ? e.nameAr : e.name) + '</option>'; }).join('');
    // the section switch keeps the person where they are (same exercise, overview tab)
    var rest = (S.route || []).slice(), here = rest[0] === 'ex' ? ['ex', rest[1], 'overview'] : rest;
    var sw = function (tx, label) { return '<a href="#/' + tx + '/' + here.join('/') + '"' + (S.tax === tx ? ' aria-current="page"' : '') + '>' + label + '</a>'; };
    document.querySelector('.top').innerHTML = '<button class="btn ghost menu-btn" data-act="menu" aria-label="' + t('Menu') + '">' + Z.icon('list') + '</button>' +
      '<div class="brand">' + logo() + '<div><b>Inspection Ready</b><span>' + esc(Z.orgName()) + '</span></div></div>' +
      '<nav class="switch" aria-label="' + t('Tax') + '">' + sw('vat', '<span class="lg">' + t('VAT') + '</span><span class="sh">' + (S.lang === 'ar' ? 'القيمة المضافة' : 'VAT') + '</span>') + sw('wht', '<span class="lg">' + t('Withholding tax') + '</span><span class="sh">' + (S.lang === 'ar' ? 'الاستقطاع' : 'WHT') + '</span>') + '</nav>' +
      '<span class="grow"></span>' +
      (S.entities.length ? '<label class="ent-pick" title="' + esc(t('Entity')) + '">' + Z.icon('buildings') + '<select data-chg="entity" aria-label="' + t('Entity') + '">' + opts + '</select></label>' : '') +
      (S.api.mode === 'cloud' && S.tenant && S.tenant.spreadsheetUrl ? '<a class="btn small sheet-btn" href="' + esc(S.tenant.spreadsheetUrl) + '" target="_blank" rel="noopener noreferrer" title="' + esc(t('Open Google Sheet')) + '">' + Z.icon('microsoft-excel-logo') + '<span class="so-lbl">' + t('Google Sheet') + '</span></a>' : '') +
      '<button class="btn ghost small" data-act="theme" aria-label="' + t('Switch light/dark') + '">' + Z.icon('circle-half') + '</button><button class="btn ghost small lang-btn" data-act="lang">' + (S.lang === 'ar' ? 'English' : 'العربية') + '</button>' +
      Z.exitButton('btn small exit-btn');
  }
  Z.CHG.entity = function (el) { S.entityId = el.value; localStorage.setItem('zr_entity', el.value); location.hash = '#/' + S.tax + '/' + ((S.route || [])[0] === 'insights' ? 'insights' : 'entity') + '/' + el.value; };
  Z.entity = function (id) { return S.entities.filter(function (e) { return e.id === id; })[0]; };
  Z.entName = function (e) { return e ? (S.lang === 'ar' && e.nameAr ? e.nameAr : e.name) : ''; };

  // ---------------------------------------------------------------- dashboard
  // Three steps from an empty account to a signed-off month. Shown until the
  // first exercise is signed off, or until the person hides it.
  Z.getStarted = function () {
    var hidden = false; try { hidden = localStorage.getItem('zr_gs_hide') === '1'; } catch (e) {}
    var e0 = S.entities[0], hasEx = S.exercises.length > 0, closed = S.exercises.some(function (x) { return x.status === 'closed'; });
    if (closed || (hidden && S.entities.length)) return '';
    var open = S.exercises.filter(function (x) { return x.status !== 'closed'; })[0];
    var steps = [
      { done: S.entities.length > 0, icon: 'buildings', title: t('Add your legal entity'), text: t('Its TRN, VAT filing frequency, whether it pays non-residents, and which GL accounts hold revenue and VAT.'),
        btn: S.entities.length ? '' : (Z.can('manager') ? '<a class="btn primary small" href="#/entities/new">' + t('Add entity') + '</a>' : '') + (S.api.mode === 'local' ? '<button class="btn small" data-act="loaddemo">' + t('Load demo company') + '</button>' : '') },
      { done: hasEx, icon: 'upload-simple', title: t('Start a month and load the data'), text: t('Pick the month on the dashboard, then load the filed return, the ERP tax report, TB and GL, bank statements and the e-invoicing export.'),
        btn: !hasEx && e0 ? '<a class="btn primary small" href="#/entity/' + e0.id + '">' + t('Start an exercise') + '</a>' : '' },
      { done: closed, icon: 'seal-check', title: t('Clear the checks and sign off'), text: t('Explain or correct every red check, test the samples, link the documents, then a manager signs the month off.'),
        btn: open ? '<a class="btn primary small" href="#/ex/' + open.id + '/overview">' + t('Open the exercise') + '</a>' : '' }
    ];
    var cur = steps.findIndex(function (s) { return !s.done; });
    return '<section class="paper getstarted"><header><div><h2>' + t('Get started in three steps') + '</h2><p>' + t('About an hour for the first month; less every month after.') + '</p></div>' +
      '<div class="row"><a class="btn ghost small" href="https://besgasksa.github.io/Zatca/Inspection-Ready-Guide.pdf" target="_blank" rel="noopener noreferrer">' + Z.icon('book-open-text') + ' ' + t('User guide (PDF)') + '</a>' +
      (S.entities.length ? '<button class="btn ghost small" data-act="gshide" aria-label="' + esc(t('Hide')) + '">' + Z.icon('x') + '</button>' : '') + '</div></header><ol class="gs">' +
      steps.map(function (s, i) {
        return '<li class="' + (s.done ? 'done' : i === cur ? 'now' : '') + '"><span class="dot">' + (s.done ? Z.icon('check') : i + 1) + '</span><div><h3>' + Z.icon(s.icon) + ' ' + s.title + '</h3><p>' + s.text + '</p>' + (i === cur && s.btn ? '<div class="row">' + s.btn + '</div>' : '') + '</div></li>';
      }).join('') + '</ol></section>';
  };
  Z.ACT.gshide = function () { try { localStorage.setItem('zr_gs_hide', '1'); } catch (e) {} Z.route(); };

  Z.views.dashboard = function () {
    if (!S.entities.length) {
      return Z.setMain('<div class="pagehead"><div><p class="eyebrow">' + t('Welcome') + '</p><h1>' + t('Inspection readiness, every month') + '</h1><p>' + t('Each month you run an inspection exercise per entity: the system compares your return with the ledger, the bank and e-invoicing, and tells you what an inspector would find.') + '</p></div></div>' + Z.getStarted());
    }
    var wht = Z.isWht(), months = [], cur = E.periodOf(Z.today(), 'monthly');
    for (var i = 0; i < 12; i++) { cur = E.prevPeriod(cur); months.unshift(cur); }
    var ents = S.entities.filter(function (e) { return e.active !== false && (!wht || e.whtRegistered !== false); });
    var ids = ents.map(function (e) { return e.id; });
    var exs = S.exercises.filter(function (x) { return ids.indexOf(x.entityId) >= 0; }), open = exs.filter(function (x) { return x.status !== 'closed'; });
    var inWindow = function (x) { return months.indexOf(x.period) >= 0 || (/Q/.test(x.period) && months.some(function (m) { return E.periodOf(m + '-01', 'quarterly') === x.period; })); };
    var scores = exs.filter(inWindow).map(function (x) { return Z.taxScore(x.summary).score; }).filter(function (x) { return x != null; });
    var avg = scores.length ? Math.round(scores.reduce(function (a, b) { return a + b; }, 0) / scores.length) : null;
    var latest = {};
    exs.forEach(function (x) { if (!latest[x.entityId] || x.period > latest[x.entityId].period) latest[x.entityId] = x; });
    var pick = function (sm, v, w, all) { sm = sm || {}; var k = wht ? w : v; return sm[k] != null ? sm[k] : (wht ? 0 : sm[all] || 0); };
    var exposure = Object.keys(latest).reduce(function (a, k) { return a + pick(latest[k].summary, 'vatExposure', 'whtExposure', 'exposure'); }, 0);
    var fails = Object.keys(latest).reduce(function (a, k) { return a + pick(latest[k].summary, 'vatFails', 'whtFails', 'fails'); }, 0);

    var heat = '<table class="heat"><thead><tr><th></th>' + months.map(function (m) { return '<th scope="col">' + Z.ltr(m.slice(2).replace('-', '/')) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      ents.map(function (e) {
        return '<tr><th class="ent" scope="row"><a href="#/insights/' + e.id + '" title="' + esc(t('Company 360')) + '">' + esc(Z.entName(e)) + '</a></th>' + months.map(function (m) {
          var key = e.vatFreq === 'quarterly' ? m.slice(0, 4) + '-Q' + Math.ceil(+m.slice(5) / 3) : m;
          var x = Z.exFor(e, m);
          if (!x) return '<td data-act="newex" data-e="' + e.id + '" data-p="' + key + '" title="' + esc(t('Start exercise') + ' ' + key) + '"><i class="ph ph-plus" aria-hidden="true"></i></td>';
          var ts = Z.taxScore(x.summary), g = ts.grade;
          return '<td class="s-' + g + (x.status === 'closed' ? ' closed' : '') + '" data-act="openex" data-id="' + x.id + '" title="' + esc(key + ' - ' + (ts.score != null ? ts.score + '% ' : '') + Z.gradeText(g) + (x.status === 'closed' ? ' - ' + t('signed off') : '')) + '">' + (ts.score != null ? ts.score : '·') + '</td>';
        }).join('') + '</tr>';
      }).join('') + '</tbody></table>';

    var dl = ents.map(function (e) {
      var row = '<tr><td>' + esc(Z.entName(e)) + '</td>';
      if (wht) {
        var mp = E.prevPeriod(E.periodOf(Z.today(), 'monthly')), w = E.deadlines(mp), lw = E.daysBetween(Z.today(), w.wht);
        return row + '<td>' + Z.ltr(mp) + '</td><td class="nowrap">' + Z.ltr(w.wht) + ' <span class="' + (lw < 4 ? 'diff-bad' : 'faint') + '">(' + lw + ' ' + t('days') + ')</span></td></tr>';
      }
      var prev = E.prevPeriod(E.periodOf(Z.today(), e.vatFreq || 'monthly')), d = E.deadlines(prev), left = E.daysBetween(Z.today(), d.vat);
      return row + '<td>' + Z.ltr(prev) + '</td><td class="nowrap">' + Z.ltr(d.vat) + ' <span class="' + (left < 7 ? 'diff-bad' : 'faint') + '">(' + left + ' ' + t('days') + ')</span></td></tr>';
    }).join('');

    var kpi = function (icon, val, label, bad) { return '<div class="' + (bad ? 'bad' : '') + '">' + Z.icon(icon) + '<b>' + val + '</b><span>' + label + '</span></div>'; };
    Z.setMain('<div class="pagehead"><div><p class="eyebrow">' + Z.taxName() + '</p><h1>' + (wht ? t('Withholding tax readiness') : t('VAT inspection readiness')) + '</h1><p>' +
      (wht ? t('Payments to non-residents, WHT returns, certificates and treaty relief. Each square is one exercise; the score counts the WHT checks only.') : t('Returns, ledgers, e-invoicing, bank and samples. Each square is one exercise; the score counts the VAT checks only.')) + '</p></div>' +
      (S.api.mode === 'local' && !S.entities.some(function (e) { return e.demo; }) ? '<button class="btn" data-act="loaddemo">' + t('Load demo company') + '</button>' : '') + '</div>' +
      '<div class="stack"><div class="kpis">' + kpi('buildings', ents.length, t('Entities')) + kpi('hourglass-medium', open.length, t('Exercises not signed off')) +
      kpi('gauge', avg == null ? '-' : avg + '%', t('Average readiness, last 12 months')) + kpi('x-circle', fails, t('Failed checks in latest exercises'), fails) +
      kpi('coins', Z.fmt(exposure, 0), wht ? t('WHT exposure (SAR)') : t('VAT exposure (SAR)'), exposure) + '</div>' +
      Z.getStarted() + dataStrip() + '<div id="reqalert"></div>' +
      (ents.length ? '' : '<section class="paper empty"><i class="ph ph-info big" aria-hidden="true"></i><p>' + t('No entity is registered for withholding tax. Turn it on in the entity settings.') + '</p></section>') +
      '<section class="paper"><header><div><h2>' + t('Readiness by month') + '</h2><p>' + t('Green is ready, amber at risk, red not ready. A dark underline means signed off.') + '</p></div></header><div class="tbl-wrap">' + heat + '</div></section>' +
      '<section class="paper"><header><div><h2>' + t('Filing deadlines') + '</h2><p>' + (wht ? t('WHT is due by the 10th of the month after the payment.') : t('VAT is due by the last day of the month after the period.')) + '</p></div></header><div class="tbl-wrap"><table class="t"><thead><tr><th>' + t('Entity') + '</th><th>' + t('Period') + '</th><th>' + (wht ? t('WHT return due') : t('VAT return due')) + '</th></tr></thead><tbody>' + dl + '</tbody></table></div></section></div>');
  };

  function dataStrip() {
    if (S.api.mode !== 'cloud' || !S.tenant || !S.tenant.spreadsheetUrl) return '';
    return '<section class="paper area-ledger" style="display:flex;gap:14px;align-items:center;justify-content:space-between;flex-wrap:wrap"><div><h3>' + t('Your data lives in your own Google Sheet') + '</h3><p class="muted" style="margin:2px 0 0">' + t('Connected automatically. Every entity, exercise, upload, sample and finding is stored there, one tab per table.') + '</p></div>' +
      '<div class="row"><a class="btn primary" href="' + esc(S.tenant.spreadsheetUrl) + '" target="_blank" rel="noopener noreferrer">' + t('Open Google Sheet') + ' ↗</a>' + (Z.can('owner') ? '<button class="btn" data-act="sharesheet">' + t('Give me access') + '</button>' : '') + '</div></section>';
  }
  Z.ACT.sharesheet = function () {
    Z.call('shareSheet').then(function (r) { Z.toast(r.shared ? t('Shared with') + ' ' + S.user.email + ' - ' + t('check your inbox') : t('Google refused to share with this email. Ask the platform administrator.'), !r.shared); });
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
      return '<tr class="clickable" data-act="goent" data-id="' + e.id + '"><td><b>' + esc(e.name) + '</b><div class="faint">' + esc(e.nameAr || '') + '</div></td><td class="nowrap">' + esc(e.trn || '') + (e.trn && !E.validVatNo(e.trn) ? ' ' + Z.pill('fail', t('Invalid')) : '') + '</td><td>' + t(cap(e.vatFreq || 'monthly')) + '</td><td>' + (e.whtRegistered === false ? '-' : t('Yes')) + '</td><td>' + (last ? esc(last.period) + ' ' + (last.summary ? Z.pill(last.summary.grade, last.summary.score + '%') : '') : '<span class="faint">' + t('None yet') + '</span>') + '</td></tr>';
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
      '<section class="paper area-vat"><h2>' + t('E-invoicing Phase 2 (Fatoora integration)') + '</h2><p class="muted">' + t('From the ZATCA notification for this entity. ZATCA gives at least six months\' notice before the integration date.') + '</p><div class="grid g3" style="margin-top:12px">' +
      fld('einvWave', t('Wave'), e.einvWave, 'text', 'placeholder="' + esc(t('e.g. Wave 24')) + '"') + fld('einvDeadline', t('Integration deadline'), e.einvDeadline, 'date') + fld('einvIntegratedOn', t('Integrated on'), e.einvIntegratedOn, 'date') + '</div></section>' +
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
    var periods = [1];
    var trend = exs.slice(0, 12).reverse();
    var chart = trend.length > 1 ? trendChart(trend) : '';
    var unmapped = Z.MAP_FIELDS.filter(function (f) { return ['outputVat', 'inputVat', 'revenue', 'receivables', 'whtPayable'].indexOf(f[0]) >= 0 && !(e.mapping || {})[f[0]]; });
    Z.setMain('<div class="pagehead"><div><h1>' + esc(Z.entName(e)) + '</h1><p>' + t('TRN') + ' ' + esc(e.trn || '-') + ' · ' + t(cap(e.vatFreq || 'monthly')) + ' ' + t('VAT filer') + (e.erp ? ' · ' + esc(e.erp) : '') + '</p></div>' +
      '<div class="row">' + (Z.can('manager') ? '<a class="btn" href="#/entity/' + e.id + '/edit">' + t('Edit entity') + '</a>' : '') +
      (Z.can('preparer') && periods.length ? '<span id="pp">' + periodPicker(e) + '</span><button class="btn primary" data-act="newexsel" data-e="' + e.id + '">' + t('Start inspection exercise') + '</button>' : '') + '<a class="btn" href="#/annual/' + e.id + '/' + Z.today().slice(0, 4) + '">' + t('Annual reconciliation') + '</a></div></div>' +
      (unmapped.length ? '<div class="paper" style="margin-bottom:18px;border-color:var(--amber)"><b>' + t('Account mapping incomplete:') + '</b> ' + unmapped.map(function (f) { return esc(t(f[1])); }).join(', ') + '. ' + t('Ledger checks for these will show as no data.') + '</div>' : '') +
      '<div class="stack">' + (chart ? '<section class="paper"><header><div><h2>' + t('Readiness and VAT due over time') + '</h2></div></header>' + chart + '</section>' : '') +
      '<section class="paper flush"><div class="tbl-wrap"><table class="t"><thead><tr><th>' + t('Period') + '</th><th>' + t('Status') + '</th><th>' + t('Readiness') + '</th><th class="num">' + t('Net VAT due') + '</th><th class="num">' + t('WHT') + '</th><th class="num">' + t('Exposure') + '</th><th>' + t('Signed off') + '</th></tr></thead><tbody>' +
      (exs.map(function (x) {
        var s = x.summary || {};
        return '<tr class="clickable" data-act="openex" data-id="' + x.id + '"><td><b>' + Z.ltr(x.period) + '</b></td><td>' + Z.statusPill(x.status) + '</td><td>' + (Z.taxScore(s).score != null ? Z.pill(Z.taxScore(s).grade, Z.taxScore(s).score + '% - ' + Z.gradeText(Z.taxScore(s).grade)) : '-') + '</td><td class="num">' + Z.fmt(s.netVat) + '</td><td class="num">' + Z.fmt(s.whtTax) + '</td><td class="num">' + Z.fmt(s.exposure) + '</td><td>' + esc(x.signedOffBy ? x.signedOffBy + ' ' + String(x.signedOffAt).slice(0, 10) : '') + '</td></tr>';
      }).join('') || '<tr><td colspan="7" class="empty">' + t('No exercises yet. Pick a period and start one.') + '</td></tr>') + '</tbody></table></div></section></div>');
  };
  Z.ACT.newexsel = function (el) {
    var p = document.getElementById('newp').value;
    if (!p) return Z.toast(t('Every period of that year already has an exercise.'), true);
    if (S.exercises.some(function (x) { return x.entityId === el.dataset.e && x.period === p; })) return Z.toast(t('An exercise for that period already exists.'), true);
    Z.createExercise(el.dataset.e, p);
  };

  // Any period since VAT began (Jan 2018), monthly or quarterly. A company can
  // change frequency over the years, so the choice is per exercise.
  var FIRST_YEAR = 2018;
  Z.FIRST_YEAR = FIRST_YEAR;
  Z.exFor = function (e, month) {
    var q = month.slice(0, 4) + '-Q' + Math.ceil(+month.slice(5) / 3);
    return S.exercises.filter(function (x) { return x.entityId === e.id && x.period === month; })[0] || S.exercises.filter(function (x) { return x.entityId === e.id && x.period === q; })[0];
  };
  function periodPicker(e, freq, year) {
    freq = freq || S.ppFreq || e.vatFreq || 'monthly';
    var cy = +Z.today().slice(0, 4), cur = E.periodOf(Z.today(), freq);
    year = +(year || S.ppYear || E.prevPeriod(cur).slice(0, 4));
    var years = []; for (var y = cy; y >= FIRST_YEAR; y--) years.push(y);
    var opts = E.periodsOfYear(year, freq).filter(function (p) { return p <= cur && !S.exercises.some(function (x) { return x.entityId === e.id && x.period === p; }); });
    var name = function (p) { if (/Q/.test(p)) return 'Q' + p.slice(-1); var d = new Date(Date.UTC(+p.slice(0, 4), +p.slice(5) - 1, 1)); return d.toLocaleString(S.lang === 'ar' ? 'ar-SA-u-ca-gregory' : 'en-GB', { month: 'long', timeZone: 'UTC' }); };
    return '<select data-chg="ppfreq" data-e="' + e.id + '" aria-label="' + t('Filing frequency') + '" style="width:auto"><option value="monthly"' + (freq === 'monthly' ? ' selected' : '') + '>' + t('Monthly') + '</option><option value="quarterly"' + (freq === 'quarterly' ? ' selected' : '') + '>' + t('Quarterly') + '</option></select>' +
      '<select data-chg="ppyear" data-e="' + e.id + '" aria-label="' + t('Year') + '" style="width:auto">' + years.map(function (y) { return '<option' + (y === year ? ' selected' : '') + '>' + y + '</option>'; }).join('') + '</select>' +
      '<select id="newp" aria-label="' + t('Period') + '" style="width:auto">' + (opts.length ? opts.slice().reverse().map(function (p) { return '<option value="' + p + '">' + esc(name(p)) + ' ' + year + '</option>'; }).join('') : '<option value="">' + t('All done') + '</option>') + '</select>';
  }
  Z.CHG.ppfreq = function (el) { S.ppFreq = el.value; document.getElementById('pp').innerHTML = periodPicker(Z.entity(el.dataset.e)); };
  Z.CHG.ppyear = function (el) { S.ppYear = +el.value; document.getElementById('pp').innerHTML = periodPicker(Z.entity(el.dataset.e)); };
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
      var sv = Z.taxScore(s).score || 0, y = H - 26 - sv / 100 * (H - 50);
      line += (i ? 'L' : 'M') + cx + ' ' + y;
      dots += '<circle cx="' + cx + '" cy="' + y + '" r="4" fill="var(--green)"><title>' + esc(x.period + ': ' + sv + '%') + '</title></circle><text x="' + cx + '" y="' + (y - 9) + '" text-anchor="middle" font-size="11" fill="var(--ink)">' + (s.score || 0) + '</text>';
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
    Z.setMain('<div class="pagehead"><div><h1>' + t('Settings') + '</h1><p>' + t('Rules and thresholds for every entity in this organisation. Tax rates and penalties are editable because regulations change - verify them against current ZATCA rules.') + '</p></div></div>' +
      '<form id="setf" class="stack">' +
      '<section class="paper"><h2 style="margin-bottom:12px">' + t('Organisation') + '</h2><div class="grid g2">' + fld('orgName', t('Organisation name'), S.tenant.name) +
      (S.api.mode === 'cloud' && S.tenant.spreadsheetUrl ? '<div class="f"><span class="muted" style="font-size:13px">' + t('Your data') + '</span><p><a href="' + esc(S.tenant.spreadsheetUrl) + '" target="_blank" rel="noopener">' + t('Open the Google Sheet that stores this organisation') + '</a></p></div>' : '') + '</div></section>' +
      '<section class="paper"><h2 style="margin-bottom:12px">' + t('Matching tolerance') + '</h2><div class="grid g4">' +
      fld('tolAbs', t('Pass if difference ≤ (SAR)'), V.tolAbs, 'number', 'step="0.01" min="0"') + fld('tolPct', t('Warn if within % of base'), Z.r(V.tolPct * 100), 'number', 'step="0.01" min="0"') +
      fld('tolWarnAbs', t('…and at most (SAR)'), V.tolWarnAbs, 'number', 'step="1" min="0"') + fld('materiality', t('Materiality (SAR)'), V.materiality, 'number', 'step="1" min="0"') +
      fld('vatRate', t('VAT standard rate %'), Z.r(V.vatRate * 100), 'number', 'step="0.01"') + fld('vatCorrectionThreshold', t('Amended return above (SAR)'), V.vatCorrectionThreshold, 'number') +
      '<label class="f"><span>' + t('Read TB VAT accounts as') + '</span><select name="glBasis"><option value="movement"' + (V.glBasis === 'movement' ? ' selected' : '') + '>' + t('Net movement') + '</option><option value="gross"' + (V.glBasis === 'gross' ? ' selected' : '') + '>' + t('Gross side (credits for output, debits for input)') + '</option></select><small>' + t('Used only when no GL detail is loaded.') + '</small></label>' +
      fld('settlementKeywords', t('Settlement journal keywords'), V.settlementKeywords, 'text', '', t('GL lines with these words are left out of VAT account movement.')) + '</div></section>' +
      '<section class="paper"><h2 style="margin-bottom:12px">' + t('Corrections, e-invoicing and input VAT rules') + '</h2><div class="grid g3">' +
      fld('vatCorrectionThreshold', t('Amend the original return at or above (SAR)'), V.vatCorrectionThreshold, 'number', 'step="1"', t('VAT IR Art. 63: SAR 15,000 since 23 June 2023.')) +
      fld('correctionNotifyDays', t('Days to notify ZATCA of a material error'), V.correctionNotifyDays, 'number', 'step="1"') +
      fld('refundMin', t('Minimum refund application (SAR)'), V.refundMin, 'number', 'step="1"') +
      fld('ein_simplifiedHours', t('Report simplified (B2C) invoices within (hours)'), V.einv.simplifiedHours, 'number', 'step="1"') +
      fld('ein_standardMinutes', t('Clearance allowance for standard invoices (minutes)'), V.einv.standardMinutes, 'number', 'step="1"', t('Standard invoices must be cleared before sharing; this only absorbs clock differences.')) +
      fld('gift_perRecipient', t('Gift relief per recipient per year (SAR)'), V.giftRelief.perRecipient, 'number', 'step="1"') +
      fld('gift_annualCap', t('Gift relief annual cap (SAR)'), V.giftRelief.annualCap, 'number', 'step="1"') +
      fld('trend_salesDropPct', t('Flag a sales drop above (%)'), V.trend.salesDropPct, 'number', 'step="1"') +
      fld('trend_inputJumpPct', t('Flag an input VAT rise above (%)'), V.trend.inputJumpPct, 'number', 'step="1"') +
      fld('rett_rate', t('RETT rate %'), Z.r(V.rett.rate * 100), 'number', 'step="0.01"') + fld('rett_latePctPerMonth', t('RETT late payment % per month'), Z.r(V.rett.latePctPerMonth * 100), 'number', 'step="0.01"', t('Sources report 2% under the current law; verify.')) +
      fld('rettd_dueDays', t('RETT due within (days of the transaction)'), V.rett.dueDays, 'number', 'step="1"') +
      fld('zakat_dueDays', t('Zakat return due (days after year end)'), V.zakat.dueDays, 'number', 'step="1"') +
      fld('disp_objectionDays', t('Days to object to an assessment'), V.disputes.objectionDays, 'number', 'step="1"') +
      fld('disp_appealDays', t('Days to appeal a committee decision'), V.disputes.appealDays, 'number', 'step="1"') +
      fld('zakatp_latePctPer30Days', t('Zakat late fine % per 30 days (estimate)'), Z.r(V.zakat.latePctPer30Days * 100), 'number', 'step="0.01"') +
      fld('sugar_mid', t('Sweetened drinks 5-7.99 g sugar: SAR per litre'), V.sugarTiers.tiers[1][2], 'number', 'step="0.01"') +
      fld('sugar_high', t('Sweetened drinks 8 g sugar or more: SAR per litre'), V.sugarTiers.tiers[2][2], 'number', 'step="0.01"', t('Per-litre tiers since 1 Jan 2026; under 5 g and sugar-free pay nothing.')) +
      fld('exc_tobacco', t('Excise: tobacco %'), Z.r(V.exciseRates.tobacco * 100), 'number', 'step="1"') + fld('exc_energy', t('Excise: energy drinks %'), Z.r(V.exciseRates.energy * 100), 'number', 'step="1"') +
      fld('exc_ecig', t('Excise: e-cigarettes and liquids %'), Z.r(V.exciseRates.ecig * 100), 'number', 'step="1"') + fld('exc_sweetened', t('Excise: sweetened drinks % (before 2026)'), Z.r(V.exciseRates.sweetened * 100), 'number', 'step="1"') + '</div>' +
      '<label class="f" style="margin-top:12px"><span>' + t('Marketplace payout keywords (bank descriptions)') + '</span><input type="text" name="marketplaceKeywords" value="' + esc(V.marketplace.payoutKeywords) + '"></label>' +
      '<label class="f" style="margin-top:12px"><span>' + t('Blocked input VAT keywords') + '</span><textarea name="blockedKeywords">' + esc(V.blockedKeywords) + '</textarea><small>' + t('Matched against purchase descriptions, accounts and supplier names (VAT IR Art. 50).') + '</small></label></section>' +
      '<section class="paper area-wht"><h2>' + t('Withholding tax rates') + '</h2><p class="muted">' + t('Statutory rates for payments to non-residents. Lower treaty rates are accepted when the line is marked as treaty relief with a certificate.') + '</p><div class="tbl-wrap"><table class="t"><thead><tr><th>' + t('Payment type') + '</th><th>%</th></tr></thead><tbody>' + whtRows + '</tbody></table></div></section>' +
      '<section class="paper"><h2 style="margin-bottom:12px">' + t('Penalties used for exposure estimates') + '</h2><div class="grid g3">' +
      fld('pen_vatErrorPct', t('Incorrect VAT return - % of difference'), Z.r(P.vatErrorPct * 100), 'number', 'step="0.1"') + fld('pen_vatLatePaymentPctPerMonth', t('VAT late payment - % per month'), Z.r(P.vatLatePaymentPctPerMonth * 100), 'number', 'step="0.1"') +
      fld('pen_whtLatePctPer30Days', t('WHT late payment - % per 30 days'), Z.r(P.whtLatePctPer30Days * 100), 'number', 'step="0.1"') + fld('pen_vatLateFilingMinPct', t('VAT late filing - minimum %'), Z.r(P.vatLateFilingMinPct * 100), 'number') +
      fld('pen_vatLateFilingMaxPct', t('VAT late filing - maximum %'), Z.r(P.vatLateFilingMaxPct * 100), 'number') + fld('pen_invoiceViolationMax', t('Tax invoice violation - maximum (SAR)'), P.invoiceViolationMax, 'number') + '</div></section>' +
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
        else if (k === 'glBasis' || k === 'settlementKeywords' || k === 'blockedKeywords') v[k] = val;
        else if (k.indexOf('ein_') === 0) { v.einv = v.einv || {}; v.einv[k.slice(4)] = +val; }
        else if (k.indexOf('gift_') === 0) { v.giftRelief = v.giftRelief || {}; v.giftRelief[k.slice(5)] = +val; }
        else if (k.indexOf('trend_') === 0) { v.trend = v.trend || {}; v.trend[k.slice(6)] = +val; }
        else if (k.indexOf('rett_') === 0) { v.rett = v.rett || {}; v.rett[k.slice(5)] = +val / 100; }
        else if (k.indexOf('rettd_') === 0) { v.rett = v.rett || {}; v.rett[k.slice(6)] = +val; }
        else if (k.indexOf('disp_') === 0) { v.disputes = v.disputes || {}; v.disputes[k.slice(5)] = +val; }
        else if (k.indexOf('zakatp_') === 0) { v.zakat = v.zakat || {}; v.zakat[k.slice(7)] = +val / 100; }
        else if (k.indexOf('sugar_') === 0) { v.sugarTiers = v.sugarTiers || { tiers: [[0, 5, 0], [5, 8, 0.79], [8, 1000, 1.09]] }; v.sugarTiers.tiers[k === 'sugar_mid' ? 1 : 2][2] = +val; }
        else if (k.indexOf('zakat_') === 0) { v.zakat = v.zakat || {}; v.zakat[k.slice(6)] = +val; }
        else if (k.indexOf('exc_') === 0) { v.exciseRates = v.exciseRates || {}; v.exciseRates[k.slice(4)] = +val / 100; }
        else if (k === 'marketplaceKeywords') { v.marketplace = { payoutKeywords: val }; }
        else if (k !== 'orgName') v[k] = +val;
      });
      var jobs = [Z.save('settings', { id: 'tenant', values: v })];
      if (f.orgName && f.orgName !== S.tenant.name) jobs.push(Z.call('tenantSave', { tenant: { name: f.orgName } }).then(function (r) { S.tenant = r.tenant; }));
      Promise.all(jobs).then(function (r) { S.settingsDoc = r[0]; S.settings = E.mergeSettings(v); Z.toast(t('Settings saved')); Z.route(); });
    });
  };
  Z.r = function (x) { return Math.round(x * 1000) / 1000; };
  function storageBox() {
    if (S.api.mode === 'cloud') return '<p>' + t('Connected automatically to the Google Sheets backend.') + '</p>' +
      (S.tenant && S.tenant.spreadsheetUrl ? '<div class="row" style="margin:8px 0"><a class="btn primary" href="' + esc(S.tenant.spreadsheetUrl) + '" target="_blank" rel="noopener noreferrer">' + t('Open Google Sheet') + ' ↗</a>' + (Z.can('owner') ? '<button class="btn" data-act="sharesheet">' + t('Give me access') + '</button>' : '') + '</div><p class="faint" style="font-size:12.5px">' + esc(S.tenant.spreadsheetUrl) + '</p>' : '') +
      (localStorage.getItem('zr_api_url') ? '<button class="btn small" data-act="disconnect">' + t('Disconnect and use this device only') + '</button>' : '');
    return '<p>' + t('Everything is stored in this browser. To share across users and entities, deploy the Apps Script backend (see README) and paste its web app URL.') + '</p>' +
      '<div class="row" style="margin-top:8px"><input type="url" id="apiurl" placeholder="https://script.google.com/macros/s/…/exec" style="max-width:520px"><button class="btn primary" data-act="connect">' + t('Connect') + '</button></div>' +
      '<div class="row" style="margin-top:14px"><button class="btn" data-act="backup">' + t('Download backup (JSON)') + '</button><label class="btn">' + t('Restore backup') + '<input type="file" accept=".json" data-chg="restore" hidden></label><button class="btn danger" data-act="wipe">' + t('Erase all data on this device') + '</button></div>';
  }
  Z.ACT.connect = function () {
    var u = document.getElementById('apiurl').value.trim();
    if (!Z.validApi(u)) return Z.toast(t('Paste the web app URL that ends in /exec.'), true);
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
  // Users and company access. One row per person, one column per company:
  // tick a box to give access. The server enforces it on every read and write.
  var ROLE_LIST = ['owner', 'manager', 'preparer', 'viewer'];
  var hasAll = function (u) { return u.role === 'owner' || (u.entityIds || []).indexOf('*') >= 0; };
  var canSee = function (u, e) { return hasAll(u) || (u.entityIds || []).indexOf(e.id) >= 0; };
  Z.views.users = function () {
    if (!Z.can('owner')) return Z.setMain('<div class="paper empty"><h2>' + t('Only the owner manages users') + '</h2></div>');
    return Z.call('usersList').then(function (r) {
      S.users = r.users;
      var ents = S.entities, me = S.user.id, demo = S.api.mode !== 'cloud';
      var active = r.users.filter(function (u) { return u.active !== false; });
      var head = '<tr><th>' + t('User') + '</th><th>' + t('Role') + '</th><th class="c">' + t('All companies') + '</th>' +
        ents.map(function (e) { return '<th class="c ent" title="' + esc(Z.entName(e)) + '"><span>' + esc(Z.entName(e)) + '</span></th>'; }).join('') + '<th>' + t('Status') + '</th></tr>';
      var rows = r.users.map(function (u) {
        var self = u.id === me, owner = u.role === 'owner', lock = self || owner;
        var roleSel = self ? '<span class="pill na">' + esc(t(cap(u.role))) + '</span>' :
          '<select data-chg="urole" data-u="' + u.id + '" aria-label="' + esc(t('Role') + ' - ' + u.name) + '">' + ROLE_LIST.map(function (x) { return '<option value="' + x + '"' + (u.role === x ? ' selected' : '') + '>' + t(cap(x)) + '</option>'; }).join('') + '</select>';
        var box = function (attrs, on, label) { return '<td class="c"><input type="checkbox" ' + attrs + (on ? ' checked' : '') + (lock ? ' disabled' : '') + ' aria-label="' + esc(label) + '"></td>'; };
        return '<tr' + (u.active === false ? ' class="off"' : '') + '><td><a href="#" data-act="edituser" data-id="' + u.id + '"><b>' + esc(Z.userLabel(u)) + '</b></a><div class="faint">' + esc(u.email) + (self ? ' · ' + t('you') : '') + '</div></td><td>' + roleSel + '</td>' +
          box('data-chg="uall" data-u="' + u.id + '"', hasAll(u), t('All companies') + ' - ' + u.name) +
          ents.map(function (e) { return box('data-chg="uacc" data-u="' + u.id + '" data-e="' + e.id + '"' + (hasAll(u) ? ' class="implied"' : ''), canSee(u, e), Z.entName(e) + ' - ' + u.name); }).join('') +
          '<td>' + (u.active === false ? Z.pill('fail', t('Disabled')) : Z.pill('pass', t('Active'))) + '</td></tr>';
      }).join('');
      // per company: who works on it, and whether someone other than the owner can sign it off
      var cover = ents.map(function (e) {
        var people = active.filter(function (u) { return canSee(u, e); });
        var signers = people.filter(function (u) { return u.role === 'manager' || u.role === 'owner'; }), preparers = people.filter(function (u) { return u.role === 'preparer'; });
        var warn = !preparers.length ? t('No preparer') : '';
        return '<tr><td><b>' + esc(Z.entName(e)) + '</b></td><td class="num">' + people.length + '</td><td>' + esc(preparers.map(Z.userLabel).join(', ') || '-') + '</td><td>' + esc(signers.map(Z.userLabel).join(', ')) + '</td><td>' + (warn ? Z.pill('risk', warn) : Z.pill('pass', t('Covered'))) + '</td></tr>';
      }).join('');
      Z.setMain('<div class="pagehead"><div><p class="eyebrow">' + t('Organisation') + '</p><h1>' + t('Users and company access') + '</h1><p>' + t('Tick a box to let a person work on a company. Owner: everything. Manager: settings and sign-off. Preparer: uploads, checks, samples and findings. Viewer: read only.') + '</p></div>' +
        '<button class="btn primary" data-act="edituser">' + Z.icon('user-plus') + ' ' + t('Add user') + '</button></div>' +
        (demo ? '<div class="paper note">' + Z.icon('info') + ' ' + t('Demo mode: you can set up users and access to try it, but they cannot sign in. Connect the Google Sheets backend to invite your team.') + '</div>' : '') +
        '<div class="stack"><div class="kpis">' +
        '<div>' + Z.icon('users-three') + '<b>' + active.length + '</b><span>' + t('Active users') + '</span></div>' +
        '<div>' + Z.icon('buildings') + '<b>' + ents.length + '</b><span>' + t('Companies') + '</span></div>' +
        '<div>' + Z.icon('seal-check') + '<b>' + active.filter(function (u) { return u.role === 'owner' || u.role === 'manager'; }).length + '</b><span>' + t('Can sign off') + '</span></div>' +
        '<div>' + Z.icon('user-circle-dashed') + '<b>' + active.filter(function (u) { return !hasAll(u) && !(u.entityIds || []).length; }).length + '</b><span>' + t('Without any company') + '</span></div></div>' +
        '<section class="paper flush"><div class="tbl-wrap"><table class="t access">' + '<thead>' + head + '</thead><tbody>' + rows + '</tbody></table></div>' +
        '<p class="faint" style="padding:10px 18px;margin:0;font-size:12.5px">' + t('Owners always see every company. "All companies" includes companies added later. Changes apply at the person\'s next click; no need to sign out.') + '</p></section>' +
        (ents.length ? '<section class="paper flush"><div style="padding:14px 18px"><h2>' + t('Coverage by company') + '</h2><p class="muted" style="margin:2px 0 0">' + t('Every company needs someone to prepare it and someone to sign it off.') + '</p></div><div class="tbl-wrap"><table class="t"><thead><tr><th>' + t('Company') + '</th><th class="num">' + t('People') + '</th><th>' + t('Preparers') + '</th><th>' + t('Can sign off') + '</th><th>' + t('Status') + '</th></tr></thead><tbody>' + cover + '</tbody></table></div></section>' : '') + '</div>');
    });
  };
  Z.userLabel = function (u) { return u.id === 'local' ? t(u.name) : u.name; };
  function saveAccess(u, msg) {
    return Z.call('userSave', { user: { id: u.id, name: u.name, email: u.email, role: u.role, active: u.active !== false, entityIds: u.entityIds } })
      .then(function () { Z.toast(msg || t('Access updated')); Z.route(); })
      .catch(function () { Z.route(); });
  }
  var userById = function (id) { return Object.assign({}, (S.users || []).filter(function (x) { return x.id === id; })[0]); };
  Z.CHG.urole = function (el) { var u = userById(el.dataset.u); u.role = el.value; saveAccess(u, t('Role updated')); };
  Z.CHG.uall = function (el) {
    var u = userById(el.dataset.u);
    // switching "all" off keeps the companies that exist today, so nobody loses access by surprise
    u.entityIds = el.checked ? ['*'] : S.entities.map(function (e) { return e.id; });
    saveAccess(u);
  };
  Z.CHG.uacc = function (el) {
    var u = userById(el.dataset.u), ids = hasAll(u) ? S.entities.map(function (e) { return e.id; }) : (u.entityIds || []).slice();
    ids = ids.filter(function (id) { return id !== el.dataset.e; });
    if (el.checked) ids.push(el.dataset.e);
    u.entityIds = ids;
    saveAccess(u);
  };
  Z.ACT.edituser = function (el) {
    var u = (S.users || []).filter(function (x) { return x.id === el.dataset.id; })[0] || { role: 'preparer', entityIds: [], active: true };
    var all = hasAll(u), self = u.id === S.user.id, cloud = S.api.mode === 'cloud';
    Z.modal(u.id ? Z.userLabel(u) : t('Add user'), '<form id="userf" class="grid g2">' + fld('name', t('Name'), Z.userLabel(u), 'text', 'required' + (self ? ' disabled' : '')) + fld('email', t('Email'), u.email, 'email', 'required' + (self ? ' disabled' : '')) +
      '<label class="f"><span>' + t('Role') + '</span><select name="role"' + (self ? ' disabled' : '') + '>' + ROLE_LIST.map(function (r) { return '<option value="' + r + '"' + (u.role === r ? ' selected' : '') + '>' + t(cap(r)) + '</option>'; }).join('') + '</select></label>' +
      (cloud ? fld('password', u.id ? t('New password (leave blank to keep)') : t('Temporary password'), '', 'password', (u.id ? '' : 'required ') + 'minlength="10" autocomplete="new-password"', t('Share it with the user privately.')) : '<div></div>') +
      '<fieldset class="f access-pick" style="grid-column:1/-1"><legend>' + t('Company access') + '</legend><label class="all"><input type="checkbox" name="all"' + (all ? ' checked' : '') + (self ? ' disabled' : '') + '> <b>' + t('All companies, including future ones') + '</b></label>' +
      S.entities.map(function (e) { return '<label><input type="checkbox" name="ent" value="' + e.id + '"' + ((u.entityIds || []).indexOf(e.id) >= 0 ? ' checked' : '') + (self ? ' disabled' : '') + '> ' + esc(Z.entName(e)) + '</label>'; }).join('') +
      '<small>' + t('Tick nothing to keep the person without access until you choose.') + '</small></fieldset>' +
      '<label class="f"><span>' + t('Status') + '</span><select name="active"' + (self ? ' disabled' : '') + '><option value="1">' + t('Active') + '</option><option value="0"' + (u.active === false ? ' selected' : '') + '>' + t('Disabled') + '</option></select></label></form>',
      '<button class="btn" data-act="closemodal">' + t('Cancel') + '</button>' + (self ? '' : '<button class="btn primary" data-act="saveuser" data-id="' + (u.id || '') + '">' + t('Save user') + '</button>'));
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
      Z.setMain('<div class="pagehead"><div><h1>' + t('Platform - organisations') + '</h1><p>' + t('Every tenant has its own Google Sheet.') + '</p></div>' + (r.registryUrl ? '<a class="btn" href="' + esc(r.registryUrl) + '" target="_blank" rel="noopener noreferrer">' + t('Open the Registry sheet') + ' ↗</a>' : '') + '</div><div class="paper flush"><table class="t"><thead><tr><th>' + t('Organisation') + '</th><th>' + t('Created') + '</th><th>' + t('Status') + '</th><th></th></tr></thead><tbody>' +
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
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && document.getElementById('scrim')) Z.closeModal(); });
  Z.ACT.closemodal = Z.closeModal;

  Z.bankClassName = function (k) {
    return { customer_receipt: 'Customer receipts', supplier_payment: 'Supplier payments', zatca_vat: 'VAT paid to ZATCA', zatca_wht: 'WHT paid to ZATCA', zakat: 'Zakat', foreign_transfer: 'Foreign transfers', payroll: 'Payroll', internal_transfer: 'Internal transfers', financing: 'Financing / loans', other_in: 'Other receipts', other_out: 'Other payments' }[k] || k;
  };
  Z.partName = function (k) { return { recon: 'Return & ledger reconciliation', bank: 'Bank reconciliation', einv: 'E-invoicing chain', filing: 'Filing & payment', other: 'Other taxes', analytics: 'Data analytics', sampling: 'Sample testing', checklist: 'Documents on file', findings: 'Open findings' }[k] || k; };

  // apply saved theme before first paint
  try { var th = localStorage.getItem('zr_theme'); if (th) document.documentElement.dataset.theme = th; } catch (e) {}
})();
