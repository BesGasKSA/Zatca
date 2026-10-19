/**
 * Storage backends. Both expose call(action, payload) → Promise of the same
 * response shapes as apps-script/Code.gs.
 *   CloudBackend — the Google Sheets backend, via google.script.run when this
 *                  page is served by Apps Script, or fetch() when hosted
 *                  elsewhere (Content-Type text/plain avoids a CORS preflight).
 *   LocalBackend — IndexedDB in this browser only; for trying the system
 *                  out and for demos. Single user, owner role.
 */
(function (root) {
  'use strict';

  function CloudBackend(url) {
    this.mode = 'cloud';
    this.url = url;
    this.token = null;
    try { this.token = sessionStorage.getItem('zr_token'); } catch (e) {}
  }
  CloudBackend.prototype.call = function (action, payload) {
    var self = this, req = Object.assign({ action: action, token: this.token }, payload || {});
    var p;
    if (root.google && root.google.script && root.google.script.run) {
      p = new Promise(function (res, rej) {
        root.google.script.run.withSuccessHandler(function (s) { res(JSON.parse(s)); }).withFailureHandler(rej).api(JSON.stringify(req));
      });
    } else {
      p = fetch(this.url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(req) })
        .then(function (r) { return r.json(); });
    }
    return p.then(function (r) {
      if (r.token) { self.token = r.token; try { sessionStorage.setItem('zr_token', r.token); } catch (e) {} }
      if (!r.ok) { var err = new Error(r.error || 'server_error'); err.code = r.error; throw err; }
      return r;
    });
  };
  CloudBackend.prototype.logout = function () { this.token = null; try { sessionStorage.removeItem('zr_token'); } catch (e) {} };

  // ---------------------------------------------------------------- local
  var DB = 'zatca-readiness', STORE = 'docs';
  function idb() {
    return new Promise(function (res, rej) {
      var r = indexedDB.open(DB, 1);
      r.onupgradeneeded = function () { r.result.createObjectStore(STORE); };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
    });
  }
  function tx(mode, fn) {
    return idb().then(function (db) {
      return new Promise(function (res, rej) {
        var t = db.transaction(STORE, mode), st = t.objectStore(STORE), out = fn(st);
        t.oncomplete = function () { res(out instanceof IDBRequest ? out.result : out); };
        t.onerror = function () { rej(t.error); };
      });
    });
  }
  function uid(p) { return p + '-' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4); }

  // Each action reads a whole table and writes it back, so actions run one at
  // a time — two saves in parallel would otherwise lose one of them.
  function LocalBackend() { this.mode = 'local'; this.token = 'local'; this.q = Promise.resolve(); }
  LocalBackend.prototype.all = function (table) {
    return tx('readonly', function (st) { return st.get(table); }).then(function (v) { return v || {}; });
  };
  LocalBackend.prototype.put = function (table, map) { return tx('readwrite', function (st) { st.put(map, table); }); };
  LocalBackend.prototype.audit = function (action, table, id, detail) {
    var self = this;
    // audit entries also read-modify-write one table, so they queue too
    return (self.aq = (self.aq || Promise.resolve()).then(function () { return self.all('audit'); }).then(function (m) {
      var a = { id: uid('A'), at: new Date().toISOString(), user: 'You', action: action, table: table, docId: id, detail: detail || '' };
      m[a.id] = a;
      var keys = Object.keys(m); if (keys.length > 2000) delete m[keys[0]];
      return self.put('audit', m);
    }).catch(function () {}));
  };
  LocalBackend.prototype.call = function (action, p) {
    var self = this, run = function () { return self.run(action, p); };
    var r = this.q.then(run, run);
    this.q = r.catch(function () {});
    return r;
  };
  LocalBackend.prototype.run = function (action, p) {
    var self = this; p = p || {};
    var user = { id: 'local', name: 'You', email: 'local@device', role: 'owner', entityIds: ['*'], active: true };
    var tenant = { id: 'local', name: localStorage.getItem('zr_local_org') || 'My organisation (this device)', plan: 'local', status: 'active' };
    switch (action) {
      case 'me': case 'login': case 'signup':
        if (p.orgName) localStorage.setItem('zr_local_org', p.orgName);
        return Promise.resolve({ ok: true, user: user, tenant: tenant });
      case 'list':
        return self.all(p.table).then(function (m) {
          var docs = Object.keys(m).map(function (k) { return m[k]; }).filter(function (d) { return !p.parentId || d.parentId === p.parentId; });
          if (p.table === 'audit') docs.sort(function (a, b) { return a.at < b.at ? 1 : -1; });
          return { ok: true, docs: docs };
        });
      case 'get':
        return self.all(p.table).then(function (m) { return { ok: true, doc: m[p.id] || null }; });
      case 'save': case 'saveMany':
        var docs = action === 'save' ? [p.doc] : p.docs;
        return self.all(p.table).then(function (m) {
          docs.forEach(function (d) {
            if (!d.id) d.id = uid(p.table.slice(0, 2).toUpperCase());
            if (p.table === 'entities') d.entityId = d.id;
            if (p.table === 'exercises') d.parentId = d.entityId;
            var prev = m[d.id];
            if (p.table === 'exercises' && d.status === 'closed' && (!prev || prev.status !== 'closed')) { d.signedOffBy = user.name; d.signedOffAt = new Date().toISOString(); }
            d.updatedAt = new Date().toISOString(); d.updatedBy = user.name;
            m[d.id] = d;
          });
          return self.put(p.table, m).then(function () {
            if (p.table !== 'rows') docs.forEach(function (d) { self.audit('save', p.table, d.id, d.name || d.period || d.title || d.label || ''); });
            return action === 'save' ? { ok: true, doc: docs[0] } : { ok: true, docs: docs };
          });
        });
      case 'remove':
        return self.all(p.table).then(function (m) {
          var d = m[p.id]; delete m[p.id];
          var jobs = [self.put(p.table, m)];
          if (p.table === 'exercises') ['datasets', 'rows', 'samples', 'findings', 'checklists'].forEach(function (t) {
            jobs.push(self.all(t).then(function (mm) { Object.keys(mm).forEach(function (k) { if (mm[k].parentId === p.id) delete mm[k]; }); return self.put(t, mm); }));
          });
          if (p.table === 'datasets') jobs.push(self.all('rows').then(function (mm) { delete mm[p.id]; return self.put('rows', mm); }));
          return Promise.all(jobs).then(function () { self.audit('delete', p.table, p.id, d ? (d.name || d.period || d.title || '') : ''); return { ok: true }; });
        });
      case 'usersList': return Promise.resolve({ ok: true, users: [user] });
      case 'tenantSave': localStorage.setItem('zr_local_org', p.tenant.name); return Promise.resolve({ ok: true, tenant: Object.assign(tenant, { name: p.tenant.name }) });
      case 'userSave': case 'changePassword': case 'platformTenants':
        return Promise.reject(Object.assign(new Error('cloud_only'), { code: 'cloud_only' }));
      default: return Promise.reject(new Error('unknown_action'));
    }
  };
  LocalBackend.prototype.logout = function () {};
  LocalBackend.prototype.wipe = function () { return idb().then(function (db) { db.close(); return new Promise(function (res) { var r = indexedDB.deleteDatabase(DB); r.onsuccess = r.onerror = r.onblocked = function () { res(); }; }); }); };

  root.ZApi = { CloudBackend: CloudBackend, LocalBackend: LocalBackend };
})(typeof window !== 'undefined' ? window : this);
