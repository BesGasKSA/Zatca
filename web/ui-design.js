/* Interface components shared by every screen:
   - dropdowns: every <select> gets an accessible listbox popover (the native
     element stays in the DOM, hidden, so forms, handlers and tests keep working);
   - date and month pickers: a calendar popover over the native input;
   - the breakdown drawer: any element with data-drill opens the parts behind
     a figure (Z.DRILL[key] returns the rows);
   - motion helpers. Everything honours prefers-reduced-motion. */
(function () {
  'use strict';
  var S = Z.S, t = Z.t, esc = Z.esc, fmt = Z.fmt;
  var reduced = function () { return window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches; };
  var uid = 0, nextId = function (p) { return p + '-' + (++uid); };
  var isRtl = function () { return document.documentElement.dir === 'rtl'; };

  // ---------------------------------------------------------------- popover plumbing
  var openPop = null;
  function closePop(restore) {
    if (!openPop) return;
    var p = openPop; openPop = null;
    p.owner.setAttribute('aria-expanded', 'false');
    p.owner.removeAttribute('aria-activedescendant');
    if (reduced()) p.el.remove(); else { p.el.classList.add('out'); setTimeout(function () { p.el.remove(); }, 110); }
    if (restore !== false) p.owner.focus();
  }
  function place(pop, owner, minW) {
    var r = owner.getBoundingClientRect(), vw = document.documentElement.clientWidth, vh = window.innerHeight;
    pop.style.minWidth = Math.max(r.width, minW || 0) + 'px';
    var h = pop.offsetHeight, w = pop.offsetWidth, below = vh - r.bottom;
    var top = below < h + 12 && r.top > h + 12 ? r.top - h - 6 : r.bottom + 6;
    var left = isRtl() ? r.right - w : r.left;
    left = Math.max(8, Math.min(left, vw - w - 8));
    pop.style.top = Math.max(8, top) + 'px'; pop.style.left = left + 'px';
    pop.classList.toggle('up', top < r.top);
  }
  document.addEventListener('mousedown', function (e) { if (openPop && !openPop.el.contains(e.target) && !openPop.owner.contains(e.target)) closePop(false); }, true);
  window.addEventListener('resize', function () { closePop(false); });
  document.addEventListener('scroll', function (e) { if (openPop && !openPop.el.contains(e.target)) closePop(false); }, true);

  // ---------------------------------------------------------------- dropdowns
  function labelOf(el) {
    if (el.getAttribute('aria-label')) return el.getAttribute('aria-label');
    var l = el.closest('label'); var sp = l && l.querySelector('span');
    return (sp && sp.textContent.trim()) || el.name || t('Choose');
  }
  function optText(sel) { var o = sel.options[sel.selectedIndex]; return o ? o.textContent : ''; }
  function enhanceSelect(sel) {
    if (sel._combo) return;
    var btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'combo'; btn.setAttribute('role', 'combobox'); btn.setAttribute('aria-haspopup', 'listbox'); btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-label', labelOf(sel));
    if (sel.getAttribute('style')) btn.setAttribute('style', sel.getAttribute('style'));
    btn.innerHTML = '<span class="combo-v"></span><i class="ph ph-caret-down" aria-hidden="true"></i>';
    sel._combo = btn; btn._sel = sel;
    sel.classList.add('native-hidden'); sel.tabIndex = -1; sel.setAttribute('aria-hidden', 'true');
    sel.insertAdjacentElement('afterend', btn);
    var sync = function () { btn.querySelector('.combo-v').textContent = optText(sel); btn.disabled = sel.disabled; };
    sync();
    sel.addEventListener('change', sync);
    btn.addEventListener('click', function () { if (openPop && openPop.owner === btn) closePop(); else openList(btn); });
    btn.addEventListener('keydown', function (e) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].indexOf(e.key) >= 0 && !(openPop && openPop.owner === btn)) { e.preventDefault(); openList(btn); return; }
      if (openPop && openPop.owner === btn) listKeys(e);
    });
  }
  function openList(btn) {
    closePop(false);
    var sel = btn._sel; if (sel.disabled) return;
    var pop = document.createElement('div'); pop.className = 'pop list'; pop.id = nextId('lb'); pop.setAttribute('role', 'listbox'); pop.setAttribute('aria-label', btn.getAttribute('aria-label'));
    var opts = [].slice.call(sel.options), many = opts.length > 9;
    pop.innerHTML = (many ? '<div class="pop-search"><i class="ph ph-magnifying-glass" aria-hidden="true"></i><input type="text" aria-label="' + esc(t('Search')) + '" placeholder="' + esc(t('Search')) + '"></div>' : '') +
      '<div class="pop-opts">' + opts.map(function (o, i) {
        return '<div class="opt' + (o.disabled ? ' dis' : '') + '" role="option" id="' + pop.id + '-' + i + '" data-i="' + i + '" aria-selected="' + (i === sel.selectedIndex) + '"' + (o.disabled ? ' aria-disabled="true"' : '') + '><span>' + esc(o.textContent) + '</span>' + (i === sel.selectedIndex ? '<i class="ph ph-check" aria-hidden="true"></i>' : '') + '</div>';
      }).join('') + '</div>';
    document.body.appendChild(pop);
    btn.setAttribute('aria-controls', pop.id); btn.setAttribute('aria-expanded', 'true');
    openPop = { el: pop, owner: btn, active: sel.selectedIndex };
    place(pop, btn, 200);
    setActive(Math.max(0, sel.selectedIndex));
    pop.addEventListener('mousedown', function (e) { e.preventDefault(); });
    pop.addEventListener('click', function (e) { var o = e.target.closest('.opt'); if (o && !o.classList.contains('dis')) choose(+o.dataset.i); });
    pop.addEventListener('mousemove', function (e) { var o = e.target.closest('.opt'); if (o) setActive(+o.dataset.i, true); });
    var q = pop.querySelector('.pop-search input');
    if (q) {
      setTimeout(function () { q.focus(); }, 0);
      q.addEventListener('input', function () {
        var v = q.value.trim().toLowerCase(), first = -1;
        pop.querySelectorAll('.opt').forEach(function (o) { var hit = !v || o.textContent.toLowerCase().indexOf(v) >= 0; o.hidden = !hit; if (hit && first < 0) first = +o.dataset.i; });
        if (first >= 0) setActive(first);
      });
      q.addEventListener('keydown', listKeys);
    }
  }
  function setActive(i, noScroll) {
    if (!openPop) return;
    openPop.active = i;
    openPop.el.querySelectorAll('.opt').forEach(function (o) { o.classList.toggle('hl', +o.dataset.i === i); });
    var a = openPop.el.querySelector('.opt.hl');
    if (a) { openPop.owner.setAttribute('aria-activedescendant', a.id); if (!noScroll) a.scrollIntoView({ block: 'nearest' }); }
  }
  function listKeys(e) {
    if (!openPop) return;
    var vis = [].slice.call(openPop.el.querySelectorAll('.opt:not([hidden]):not(.dis)')).map(function (o) { return +o.dataset.i; });
    var k = vis.indexOf(openPop.active);
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(vis[Math.min(vis.length - 1, k + 1)]); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(vis[Math.max(0, k - 1)]); }
    else if (e.key === 'Home') { e.preventDefault(); setActive(vis[0]); }
    else if (e.key === 'End') { e.preventDefault(); setActive(vis[vis.length - 1]); }
    else if (e.key === 'Enter' || (e.key === ' ' && e.target === openPop.owner)) { e.preventDefault(); if (openPop.active >= 0) choose(openPop.active); }
    else if (e.key === 'Escape' || e.key === 'Tab') { if (e.key === 'Escape') e.preventDefault(); closePop(e.key === 'Escape'); }
    else if (e.key.length === 1 && e.target === openPop.owner) {      // type to jump
      var sel = openPop.owner._sel, ch = e.key.toLowerCase();
      for (var j = 1; j <= sel.options.length; j++) { var n = (openPop.active + j) % sel.options.length; if (sel.options[n].textContent.trim().toLowerCase().indexOf(ch) === 0) { setActive(n); break; } }
    }
  }
  function choose(i) {
    var btn = openPop.owner, sel = btn._sel, changed = sel.selectedIndex !== i;
    sel.selectedIndex = i;
    closePop();
    if (changed) { sel.dispatchEvent(new Event('input', { bubbles: true })); sel.dispatchEvent(new Event('change', { bubbles: true })); }
  }

  // ---------------------------------------------------------------- date and month pickers
  var LOC = function () { return S.lang === 'ar' ? 'ar-SA-u-ca-gregory-nu-latn' : 'en-GB'; };
  var pad = function (n) { return (n < 10 ? '0' : '') + n; };
  function fmtDate(v, month) {
    if (!v) return '';
    var d = new Date(Date.UTC(+v.slice(0, 4), +v.slice(5, 7) - 1, month ? 1 : +v.slice(8, 10)));
    if (isNaN(d)) return v;
    try { return d.toLocaleDateString(LOC(), month ? { month: 'long', year: 'numeric', timeZone: 'UTC' } : { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }); } catch (e) { return v; }
  }
  function enhanceDate(inp) {
    if (inp._pick) return;
    var month = inp.type === 'month';
    var btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'dpick'; btn.setAttribute('aria-haspopup', 'dialog'); btn.setAttribute('aria-expanded', 'false');
    btn.innerHTML = '<i class="ph ph-calendar-blank" aria-hidden="true"></i><span class="dpick-v"></span>';
    inp._pick = btn; btn._inp = inp;
    inp.classList.add('native-hidden'); inp.tabIndex = -1; inp.setAttribute('aria-hidden', 'true');
    inp.insertAdjacentElement('afterend', btn);
    var sync = function () {
      var v = inp.value;
      btn.querySelector('.dpick-v').textContent = v ? fmtDate(v, month) : (month ? t('Pick a month') : t('Pick a date'));
      btn.classList.toggle('empty', !v); btn.disabled = inp.disabled;
      btn.setAttribute('aria-label', labelOf(inp) + ': ' + (v ? fmtDate(v, month) : t('not set')));
    };
    sync();
    inp.addEventListener('change', sync); inp.addEventListener('input', sync);
    btn.addEventListener('click', function () { if (openPop && openPop.owner === btn) closePop(); else openCal(btn); });
    btn.addEventListener('keydown', function (e) { if (e.key === 'ArrowDown') { e.preventDefault(); openCal(btn); } });
  }
  function openCal(btn) {
    closePop(false);
    var inp = btn._inp; if (inp.disabled) return;
    var month = inp.type === 'month', v = inp.value || (month ? Z.today().slice(0, 7) : Z.today());
    var pop = document.createElement('div'); pop.className = 'pop cal'; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', labelOf(inp));
    document.body.appendChild(pop);
    btn.setAttribute('aria-expanded', 'true');
    openPop = { el: pop, owner: btn, view: { y: +v.slice(0, 4), m: +v.slice(5, 7) }, focus: month ? null : v };
    renderCal(); place(pop, btn, month ? 260 : 288);
    pop.addEventListener('mousedown', function (e) { if (!e.target.closest('input')) e.preventDefault(); });
    pop.addEventListener('click', calClick);
    pop.addEventListener('keydown', calKeys);
    setTimeout(function () { var f = pop.querySelector('[aria-pressed="true"], .today, .day:not([disabled]), .mon'); if (f) f.focus(); }, 0);
  }
  function renderCal() {
    var p = openPop, inp = p.owner._inp, month = inp.type === 'month', y = p.view.y, m = p.view.m, today = Z.today();
    var min = inp.min || '', max = inp.max || '', cur = inp.value;
    var head = '<div class="cal-head"><button type="button" class="cal-nav" data-nav="-1" aria-label="' + esc(month ? t('Previous year') : t('Previous month')) + '"><i class="ph ph-caret-' + (isRtl() ? 'right' : 'left') + '" aria-hidden="true"></i></button>' +
      '<b>' + esc(month ? String(y) : fmtDate(y + '-' + pad(m) + '-01', true)) + '</b>' +
      '<button type="button" class="cal-nav" data-nav="1" aria-label="' + esc(month ? t('Next year') : t('Next month')) + '"><i class="ph ph-caret-' + (isRtl() ? 'left' : 'right') + '" aria-hidden="true"></i></button></div>';
    var body;
    if (month) {
      body = '<div class="cal-months">' + [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(function (k) {
        var key = y + '-' + pad(k), off = (min && key < min.slice(0, 7)) || (max && key > max.slice(0, 7));
        var name = new Date(Date.UTC(y, k - 1, 1)).toLocaleDateString(LOC(), { month: 'short', timeZone: 'UTC' });
        return '<button type="button" class="mon' + (key === today.slice(0, 7) ? ' today' : '') + '" data-v="' + key + '" aria-pressed="' + (key === cur) + '"' + (off ? ' disabled' : '') + '>' + esc(name) + '</button>';
      }).join('') + '</div>';
    } else {
      var first = new Date(Date.UTC(y, m - 1, 1)), start = first.getUTCDay(), days = new Date(Date.UTC(y, m, 0)).getUTCDate();   // weeks start on Sunday (Saudi Arabia)
      var wd = [0, 1, 2, 3, 4, 5, 6].map(function (k) { return '<span aria-hidden="true">' + esc(new Date(Date.UTC(2023, 0, 1 + k)).toLocaleDateString(LOC(), { weekday: 'narrow', timeZone: 'UTC' })) + '</span>'; }).join('');
      var cells = '';
      for (var k = 0; k < start; k++) cells += '<span></span>';
      for (var d = 1; d <= days; d++) {
        var iso = y + '-' + pad(m) + '-' + pad(d), off = (min && iso < min) || (max && iso > max);
        cells += '<button type="button" class="day' + (iso === today ? ' today' : '') + '" data-v="' + iso + '" aria-pressed="' + (iso === cur) + '" aria-label="' + esc(fmtDate(iso)) + '" tabindex="' + (iso === (p.focus || cur) ? 0 : -1) + '"' + (off ? ' disabled' : '') + '>' + d + '</button>';
      }
      body = '<div class="cal-wd">' + wd + '</div><div class="cal-grid">' + cells + '</div>';
    }
    var foot = '<div class="cal-foot"><button type="button" class="btn small ghost" data-v="' + (month ? today.slice(0, 7) : today) + '">' + (month ? t('This month') : t('Today')) + '</button>' + (inp.required ? '' : '<button type="button" class="btn small ghost" data-v="">' + t('Clear') + '</button>') + '</div>';
    p.el.innerHTML = head + body + foot;
  }
  function calClick(e) {
    var p = openPop; if (!p) return;
    var nav = e.target.closest('[data-nav]');
    if (nav) { var dir = +nav.dataset.nav; if (p.owner._inp.type === 'month') p.view.y += dir; else { p.view.m += dir; if (p.view.m < 1) { p.view.m = 12; p.view.y--; } if (p.view.m > 12) { p.view.m = 1; p.view.y++; } } renderCal(); return; }
    var b = e.target.closest('[data-v]'); if (!b || b.disabled) return;
    var inp = p.owner._inp; inp.value = b.dataset.v;
    closePop();
    inp.dispatchEvent(new Event('input', { bubbles: true })); inp.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function calKeys(e) {
    var p = openPop; if (!p) return;
    if (e.key === 'Escape') { e.preventDefault(); closePop(); return; }
    var f = document.activeElement; if (!f || !f.classList.contains('day')) return;
    var step = { ArrowLeft: isRtl() ? 1 : -1, ArrowRight: isRtl() ? -1 : 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    if (e.key === 'PageUp' || e.key === 'PageDown') { e.preventDefault(); p.view.m += e.key === 'PageUp' ? -1 : 1; if (p.view.m < 1) { p.view.m = 12; p.view.y--; } if (p.view.m > 12) { p.view.m = 1; p.view.y++; } p.focus = p.view.y + '-' + pad(p.view.m) + '-01'; renderCal(); var g = p.el.querySelector('[tabindex="0"]'); if (g) g.focus(); return; }
    if (!step) return;
    e.preventDefault();
    var d = new Date(f.dataset.v + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + step);
    var iso = d.toISOString().slice(0, 10);
    if (+iso.slice(5, 7) !== p.view.m) { p.view.y = +iso.slice(0, 4); p.view.m = +iso.slice(5, 7); p.focus = iso; renderCal(); }
    var n = p.el.querySelector('[data-v="' + iso + '"]'); if (n) n.focus();
  }

  // ---------------------------------------------------------------- automatic enhancement
  Z.enhance = function (root) {
    (root || document).querySelectorAll('select:not([multiple]):not([data-native])').forEach(enhanceSelect);
    (root || document).querySelectorAll('input[type=date]:not([data-native]), input[type=month]:not([data-native])').forEach(enhanceDate);
  };
  var pending = false;
  new MutationObserver(function () {
    if (pending) return; pending = true;
    (window.queueMicrotask || setTimeout)(function () { pending = false; Z.enhance(); });
  }).observe(document.documentElement, { childList: true, subtree: true });

  // ---------------------------------------------------------------- breakdown drawer
  // spec: { title, sub, total, totalLabel, money, rows: [{ label, sub, value, display, href, act, tone, data }], note, empty }
  Z.DRILL = {};
  var lastFocus = null;
  Z.drawer = function (spec) {
    Z.closeDrawer(true);
    lastFocus = document.activeElement;
    var rows = spec.rows || [], max = Math.max.apply(null, rows.map(function (r) { return Math.abs(+r.value || 0); }).concat([0])) || 1;
    var money = spec.money !== false;
    var wrap = document.createElement('div'); wrap.className = 'drawer-scrim'; wrap.id = 'drawer';
    wrap.innerHTML = '<aside class="drawer" role="dialog" aria-modal="true" aria-labelledby="dr-t">' +
      '<header><div><h2 id="dr-t">' + esc(spec.title) + '</h2>' + (spec.sub ? '<p>' + esc(spec.sub) + '</p>' : '') + '</div><button type="button" class="btn ghost icon" data-act="closedrawer" aria-label="' + esc(t('Close')) + '"><i class="ph ph-x" aria-hidden="true"></i></button></header>' +
      (spec.total != null ? '<div class="dr-total"><b data-count="' + (+spec.total || 0) + '">' + (typeof spec.total === 'number' ? fmt(spec.total, money ? 0 : 0) : esc(spec.total)) + '</b><span>' + esc(spec.totalLabel || '') + '</span></div>' : '') +
      (rows.length ? '<ol class="dr-rows">' + rows.map(function (r, i) {
        var w = Math.max(1.5, Math.abs(+r.value || 0) / max * 100).toFixed(1);
        var inner = '<span class="dr-l"><b>' + esc(r.label) + '</b>' + (r.sub ? '<small>' + esc(r.sub) + '</small>' : '') + '</span>' +
          '<span class="dr-v num">' + (r.display != null ? esc(r.display) : fmt(r.value, 0)) + '</span>' +
          (r.value != null && !isNaN(+r.value) ? '<span class="dr-bar"><i class="' + (r.tone || '') + '" style="--w:' + w + '%"></i></span>' : '');
        var attrs = r.href ? 'href="' + esc(r.href) + '"' : r.act ? 'href="#" data-act="' + esc(r.act) + '"' + Object.keys(r.data || {}).map(function (k) { return ' data-' + k + '="' + esc(r.data[k]) + '"'; }).join('') : '';
        return '<li style="--i:' + i + '">' + (attrs ? '<a class="dr-row" ' + attrs + '>' + inner + '<i class="ph ph-caret-' + (isRtl() ? 'left' : 'right') + ' go" aria-hidden="true"></i></a>' : '<div class="dr-row">' + inner + '</div>') + '</li>';
      }).join('') + '</ol>' : '<div class="dr-empty">' + Z.icon('check-circle') + '<p>' + esc(spec.empty || t('Nothing here.')) + '</p></div>') +
      (spec.note ? '<p class="dr-note">' + esc(spec.note) + '</p>' : '') + '</aside>';
    wrap.addEventListener('mousedown', function (e) { if (e.target === wrap) Z.closeDrawer(); });
    wrap.addEventListener('click', function (e) { var a = e.target.closest('a.dr-row[href]:not([data-act])'); if (a) Z.closeDrawer(true); });
    document.body.appendChild(wrap);
    document.body.classList.add('drawer-open');
    var c = wrap.querySelector('[data-act=closedrawer]'); if (c) c.focus();
    if (Z.animateCounts) Z.animateCounts(wrap);
  };
  Z.closeDrawer = function (instant) {
    var w = document.getElementById('drawer'); if (!w) return;
    document.body.classList.remove('drawer-open');
    w.id = '';
    if (instant || reduced()) w.remove(); else { w.classList.add('out'); setTimeout(function () { w.remove(); }, 190); }
    if (!instant && lastFocus && lastFocus.focus) lastFocus.focus();
  };
  Z.ACT.closedrawer = function () { Z.closeDrawer(); };
  function openDrill(el) {
    var key = el.dataset.drill, base = key.split(':')[0], fn = Z.DRILL[base];
    if (!fn) return;
    var spec = fn(key.slice(base.length + 1), el);
    if (spec) Z.drawer(spec);
  }
  document.addEventListener('click', function (e) {
    var d = e.target.closest('[data-drill]');
    if (d && !e.target.closest('a[href]:not([data-drill]), button:not([data-drill])')) { e.preventDefault(); openDrill(d); }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && document.getElementById('drawer')) { Z.closeDrawer(); return; }
    var d = e.target.closest && e.target.closest('[data-drill]');
    if (d && (e.key === 'Enter' || e.key === ' ') && e.target === d) { e.preventDefault(); openDrill(d); }
  });
  // drillable tiles are announced and reachable as buttons
  Z.markDrills = function (root) {
    (root || document).querySelectorAll('[data-drill]:not([data-drilled])').forEach(function (el) {
      el.setAttribute('data-drilled', '1');
      if (!/^(A|BUTTON)$/.test(el.tagName)) { el.setAttribute('role', 'button'); el.tabIndex = 0; }
      if (!el.getAttribute('aria-label')) el.setAttribute('aria-label', (el.textContent || '').replace(/\s+/g, ' ').trim() + '. ' + t('Show the breakdown'));
      el.title = t('Show the breakdown');
    });
  };
  new MutationObserver(function () { Z.markDrills(); }).observe(document.documentElement, { childList: true, subtree: true });

  // ---------------------------------------------------------------- motion: page entrance
  // one orchestrated moment per screen: the sections arrive in reading order
  Z.revealPage = function () {
    if (reduced()) return;
    var m = document.getElementById('main'); if (!m) return;
    var kids = [].slice.call(m.querySelectorAll(':scope > *, :scope > .stack > *, :scope > .i360 > *, :scope > #tab > *, :scope > #tab > .grid > *'));
    kids.slice(0, 14).forEach(function (el, i) { el.classList.remove('enter'); void el.offsetWidth; el.style.setProperty('--d', (i * 40) + 'ms'); el.classList.add('enter'); });
  };
})();
