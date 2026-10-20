/**
 * Tax Inspection Readiness — Google Apps Script backend.
 *
 * Multi-tenant storage on Google Sheets:
 *   - one REGISTRY spreadsheet (script property REGISTRY_ID) holds tenants,
 *     users and the platform audit trail;
 *   - every tenant (organisation) gets its OWN spreadsheet, created at
 *     sign-up, so one customer's data never shares a file with another's.
 * Each table is a sheet of JSON documents: id | parentId | entityId | label |
 * updatedAt | updatedBy | data. A document too big for one cell (50,000 chars)
 * is split across the _chunks sheet transparently.
 *
 * The business logic (reconciliations, sampling, scoring) runs in the client
 * (web/engine.js). This server owns identity, tenancy, entity-level access,
 * roles, storage and the audit trail.
 */

var REGISTRY_SHEETS = { TENANTS: 'tenants', USERS: 'users', AUDIT: 'audit' };
var TENANT_TABLES = ['entities', 'exercises', 'datasets', 'rows', 'samples', 'findings', 'checklists', 'settings', 'annual', 'requests', 'statements', 'refunds', 'disputes', 'events', 'audit'];
// tables that belong to one entity but to no exercise
var ENTITY_TABLES = { annual: 1, requests: 1, statements: 1, refunds: 1, disputes: 1, events: 1 };
// tables whose documents hang off an exercise (parentId = exerciseId)
var CHILD_TABLES = { datasets: 1, rows: 1, samples: 1, findings: 1, checklists: 1 };
var COLS = ['id', 'parentId', 'entityId', 'label', 'updatedAt', 'updatedBy', 'data'];
var CELL_MAX = 45000;
var ROLES = { owner: 4, manager: 3, preparer: 2, viewer: 1 };
var TOKEN_TTL_MS = 12 * 3600 * 1000;
// 'Keep me signed in': 30 days, renewed on use; a password change ends it everywhere
var REMEMBER_TTL_MS = 30 * 24 * 3600 * 1000;

// ---------------------------------------------------------------- entry points

function doGet(e) {
  if (e && e.parameter && e.parameter.ping) return json_({ ok: true, service: 'tax-inspection-readiness' });
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Inspection Ready — VAT & WHT')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

// Called by external hosting (fetch, Content-Type text/plain to skip CORS preflight).
function doPost(e) {
  var req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'bad_request' }); }
  return json_(handle_(req));
}

// Called by the client when it is served from this script (google.script.run).
function api(reqJson) {
  var req;
  try { req = JSON.parse(reqJson); } catch (err) { return JSON.stringify({ ok: false, error: 'bad_request' }); }
  return JSON.stringify(handle_(req));
}

function handle_(req) {
  try { return route_(req); }
  catch (err) {
    var msg = String(err && err.message || err);
    if (!/^[a-z_]+$/.test(msg)) { try { regAudit_('server_error', '', '', msg.slice(0, 500)); } catch (e2) {} msg = 'server_error'; }
    return { ok: false, error: msg };
  }
}

function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

// ---------------------------------------------------------------- router

function route_(req) {
  var a = req.action;
  if (!a) throw new Error('missing_action');
  if (a === 'ping') return { ok: true };
  if (a === 'signup') return signup_(req);
  if (a === 'login') return login_(req);

  var s = session_(req.token);
  var out;
  switch (a) {
    case 'me': out = { user: publicUser_(s.user), tenant: publicTenant_(s.tenant) }; break;
    case 'list': out = { docs: list_(s, req.table, req.parentId) }; break;
    case 'get': out = { doc: get_(s, req.table, req.id) }; break;
    case 'save': out = { doc: save_(s, req.table, req.doc) }; break;
    case 'saveMany': out = { docs: (req.docs || []).map(function (d) { return save_(s, req.table, d); }) }; break;
    case 'remove': remove_(s, req.table, req.id); out = {}; break;
    case 'usersList': need_(s, 'owner'); out = { users: usersOfTenant_(s.tenant.id).map(publicUser_) }; break;
    case 'userSave': need_(s, 'owner'); out = { user: publicUser_(userSave_(s, req.user)) }; break;
    case 'changePassword': changePassword_(s, req.oldPassword, req.newPassword); out = {}; break;
    case 'tenantSave': need_(s, 'owner'); out = { tenant: publicTenant_(tenantSave_(s, req.tenant)) }; break;
    case 'shareSheet': need_(s, 'owner'); out = { shared: shareWith_(book_(s), s.user.email, s.tenant.id, s.user.id), url: publicTenant_(s.tenant).spreadsheetUrl }; break;
    case 'platformTenants': if (!isSuper_(s.user.email)) throw new Error('forbidden'); out = { tenants: regRows_(REGISTRY_SHEETS.TENANTS).map(publicTenant_), registryUrl: 'https://docs.google.com/spreadsheets/d/' + prop_('REGISTRY_ID') }; break;
    case 'platformTenantStatus':
      if (!isSuper_(s.user.email)) throw new Error('forbidden');
      var t = regFind_(REGISTRY_SHEETS.TENANTS, req.id); if (!t) throw new Error('not_found');
      t.status = req.status === 'suspended' ? 'suspended' : 'active'; regUpsert_(REGISTRY_SHEETS.TENANTS, t); out = {}; break;
    default: throw new Error('unknown_action');
  }
  out.ok = true;
  out.token = issueToken_(s.user, s.tenant, s.rm);
  return out;
}

// ---------------------------------------------------------------- identity

function signup_(req) {
  var email = normEmail_(req.email), org = String(req.orgName || '').trim();
  if (!email || !org) throw new Error('missing_fields');
  if (String(req.password || '').length < 10) throw new Error('weak_password');
  return withLock_(function () {
    if (regRows_(REGISTRY_SHEETS.USERS).some(function (u) { return u.email === email; })) throw new Error('email_taken');
    var ss = SpreadsheetApp.create('Inspection Ready — ' + org);
    initTenantBook_(ss);
    var folderId = prop_('TENANT_FOLDER_ID');
    if (folderId) { try { DriveApp.getFileById(ss.getId()).moveTo(DriveApp.getFolderById(folderId)); } catch (e) {} }
    var tenant = { id: uid_('T'), name: org, spreadsheetId: ss.getId(), plan: 'standard', status: 'active', createdAt: now_() };
    regUpsert_(REGISTRY_SHEETS.TENANTS, tenant);
    var salt = uid_('S');
    var user = { id: uid_('U'), tenantId: tenant.id, email: email, name: String(req.name || email), role: 'owner', entityIds: ['*'],
      salt: salt, pw: hashPw_(req.password, salt), active: true, createdAt: now_() };
    regUpsert_(REGISTRY_SHEETS.USERS, user);
    // The owner can open their own data sheet (view only; every write still goes
    // through this script's checks). On by default; SHARE_SHEET_WITH_OWNER=false turns it off.
    if (prop_('SHARE_SHEET_WITH_OWNER') !== 'false') shareWith_(ss, email, tenant.id, user.id);
    regAudit_('signup', tenant.id, user.id, org);
    return { ok: true, token: issueToken_(user, tenant, !!req.remember), user: publicUser_(user), tenant: publicTenant_(tenant) };
  });
}

// Five wrong passwords for one email lock it for 15 minutes.
var MAX_FAILS = 5, LOCK_SEC = 900;
function login_(req) {
  var email = normEmail_(req.email);
  var cache = CacheService.getScriptCache(), key = 'fail_' + Utilities.base64EncodeWebSafe(email).slice(0, 200);
  var fails = +(cache.get(key) || 0);
  if (fails >= MAX_FAILS) throw new Error('too_many_attempts');
  var u = regRows_(REGISTRY_SHEETS.USERS).filter(function (x) { return x.email === email; })[0];
  // same answer whether the email exists or not
  if (!u || u.active === false || hashPw_(req.password || '', u.salt) !== u.pw) {
    regAudit_('login_failed', u ? u.tenantId : '', u ? u.id : '', email);
    cache.put(key, String(fails + 1), LOCK_SEC);
    Utilities.sleep(400);
    throw new Error('bad_credentials');
  }
  var t = regFind_(REGISTRY_SHEETS.TENANTS, u.tenantId);
  if (!t || t.status === 'suspended') throw new Error('tenant_suspended');
  cache.remove(key);
  u.lastLoginAt = now_(); regUpsert_(REGISTRY_SHEETS.USERS, u);
  regAudit_('login', t.id, u.id, '');
  return { ok: true, token: issueToken_(u, t, !!req.remember), user: publicUser_(u), tenant: publicTenant_(t) };
}

function session_(token) {
  var c = readToken_(token);
  if (!c) throw new Error('auth_required');
  var u = regFind_(REGISTRY_SHEETS.USERS, c.uid);
  if (!u || u.active === false || u.tenantId !== c.tid || (u.epoch || 0) !== c.ep) throw new Error('auth_required');
  var t = regFind_(REGISTRY_SHEETS.TENANTS, u.tenantId);
  if (!t || t.status === 'suspended') throw new Error('tenant_suspended');
  return { user: u, tenant: t, book: null, rm: !!c.rm };
}

function issueToken_(u, t, rm) {
  var c = { uid: u.id, tid: t.id, ep: u.epoch || 0, exp: Date.now() + (rm ? REMEMBER_TTL_MS : TOKEN_TTL_MS) };
  if (rm) c.rm = 1;
  var p = Utilities.base64EncodeWebSafe(JSON.stringify(c));
  return p + '.' + hmac_(p);
}
function readToken_(tok) {
  if (!tok || String(tok).indexOf('.') < 0) return null;
  var parts = String(tok).split('.');
  if (hmac_(parts[0]) !== parts[1]) return null;
  try {
    var c = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString());
    return c.exp > Date.now() ? c : null;
  } catch (e) { return null; }
}
function hmac_(s) {
  return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(s, secret_())).replace(/=+$/, '');
}
function secret_() {
  var p = PropertiesService.getScriptProperties(), s = p.getProperty('TOKEN_SECRET');
  if (!s) { s = Utilities.getUuid() + Utilities.getUuid(); p.setProperty('TOKEN_SECRET', s); }
  return s;
}
function hashPw_(pw, salt) {
  var h = salt + '|' + pw;
  for (var i = 0; i < 300; i++) {
    h = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, h + '|' + salt, Utilities.Charset.UTF_8));
  }
  return h;
}

function need_(s, role) { if ((ROLES[s.user.role] || 0) < ROLES[role]) throw new Error('forbidden'); }
function canEntity_(s, entityId) {
  var ids = s.user.entityIds || [];
  return s.user.role === 'owner' || ids.indexOf('*') >= 0 || ids.indexOf(entityId) >= 0;
}

function userSave_(s, u) {
  return withLock_(function () {
    var all = regRows_(REGISTRY_SHEETS.USERS);
    var cur = u.id ? all.filter(function (x) { return x.id === u.id && x.tenantId === s.tenant.id; })[0] : null;
    var email = normEmail_(u.email);
    if (!cur && all.some(function (x) { return x.email === email; })) throw new Error('email_taken');
    if (!ROLES[u.role]) throw new Error('bad_role');
    var rec = cur || { id: uid_('U'), tenantId: s.tenant.id, createdAt: now_(), salt: uid_('S') };
    if (cur && cur.id === s.user.id && u.role !== 'owner') throw new Error('cannot_demote_self');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('bad_email');
    rec.email = email; rec.name = String(u.name || email).slice(0, 120); rec.role = u.role;
    rec.entityIds = cleanEntityIds_(u.entityIds);
    rec.active = u.active !== false;
    if (u.password) {
      if (String(u.password).length < 10) throw new Error('weak_password');
      rec.pw = hashPw_(u.password, rec.salt); rec.epoch = (rec.epoch || 0) + 1;
    }
    if (!rec.pw) throw new Error('password_required');
    if (cur && rec.active === false) rec.epoch = (rec.epoch || 0) + 1;
    regUpsert_(REGISTRY_SHEETS.USERS, rec);
    tenantAudit_(s, 'user_saved', 'users', rec.id, rec.email + ' ' + rec.role);
    return rec;
  });
}

// '*' = every company, including future ones. An empty list = no company: the
// user sees nothing until given one (it used to fall back to '*', which turned
// "untick everything" into "see everything").
function cleanEntityIds_(ids) {
  if (!Array.isArray(ids)) return ['*'];
  if (ids.indexOf('*') >= 0) return ['*'];
  var seen = {};
  return ids.map(String).filter(function (id) { if (seen[id] || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) return false; seen[id] = 1; return true; }).slice(0, 500);
}

function changePassword_(s, oldPw, newPw) {
  if (hashPw_(oldPw || '', s.user.salt) !== s.user.pw) throw new Error('bad_credentials');
  if (String(newPw || '').length < 10) throw new Error('weak_password');
  s.user.pw = hashPw_(newPw, s.user.salt); s.user.epoch = (s.user.epoch || 0) + 1;
  regUpsert_(REGISTRY_SHEETS.USERS, s.user);
}

function tenantSave_(s, t) {
  s.tenant.name = String(t.name || s.tenant.name).trim();
  regUpsert_(REGISTRY_SHEETS.TENANTS, s.tenant);
  return s.tenant;
}

function shareWith_(ss, email, tid, uid) {
  try { ss.addViewer(email); return true; }
  catch (e) { try { regAudit_('share_failed', tid, uid, String(e.message || e)); } catch (e2) {} return false; }
}

function usersOfTenant_(tid) { return regRows_(REGISTRY_SHEETS.USERS).filter(function (u) { return u.tenantId === tid; }); }
function publicUser_(u) { return { id: u.id, email: u.email, name: u.name, role: u.role, entityIds: u.entityIds, active: u.active !== false, lastLoginAt: u.lastLoginAt || '' }; }
function publicTenant_(t) { return { id: t.id, name: t.name, plan: t.plan, status: t.status, createdAt: t.createdAt, spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/' + t.spreadsheetId }; }
function isSuper_(email) { return String(prop_('SUPER_ADMINS') || '').toLowerCase().split(',').map(function (x) { return x.trim(); }).indexOf(email) >= 0; }

// ---------------------------------------------------------------- tenant documents

function book_(s) {
  if (!s.book) s.book = SpreadsheetApp.openById(s.tenant.spreadsheetId);
  return s.book;
}

function checkTable_(t) { if (TENANT_TABLES.indexOf(t) < 0) throw new Error('bad_table'); }
// Ids end up in column A of a sheet, so only plain characters are allowed.
function checkId_(id) { if (!/^[A-Za-z0-9_-]{1,64}$/.test(String(id))) throw new Error('bad_id'); }
// Anything a user typed is written with a leading apostrophe, so Sheets stores
// it as text and never evaluates it as a formula (=IMPORTXML(...) and the like).
function txt_(v) { return "'" + String(v == null ? '' : v); }

function list_(s, table, parentId) {
  checkTable_(table);
  if (table === 'audit') need_(s, 'manager');
  var docs = readTable_(book_(s), table).filter(function (d) {
    if (parentId && d.parentId !== parentId) return false;
    if (table === 'settings') return true;
    if (table === 'entities') return canEntity_(s, d.id);
    return canEntity_(s, d.entityId);
  });
  if (table === 'audit') docs = docs.slice(-1000).reverse();
  return docs;
}

function get_(s, table, id) {
  checkTable_(table);
  var d = readTable_(book_(s), table, id)[0] || null;
  if (!d) return null;
  if (table === 'entities' ? !canEntity_(s, d.id) : (table !== 'settings' && !canEntity_(s, d.entityId))) throw new Error('forbidden');
  return d;
}

function save_(s, table, doc) {
  checkTable_(table);
  if (table === 'audit') throw new Error('forbidden');
  if (!doc || typeof doc !== 'object') throw new Error('bad_doc');
  need_(s, table === 'entities' || table === 'settings' ? 'manager' : 'preparer');
  return withLock_(function () {
    var ss = book_(s);
    if (!doc.id) doc.id = uid_(table.slice(0, 2).toUpperCase());
    checkId_(doc.id);
    if (doc.parentId) checkId_(doc.parentId);
    if (doc.entityId) checkId_(doc.entityId);
    var prev = readTable_(ss, table, doc.id)[0];
    if (table === 'entities') {
      if (prev && !canEntity_(s, prev.id)) throw new Error('forbidden');
      if (!prev && s.user.role !== 'owner' && (s.user.entityIds || []).indexOf('*') < 0) throw new Error('forbidden');
      doc.entityId = doc.id;
    } else if (table === 'exercises') {
      if (!canEntity_(s, doc.entityId) || !readTable_(ss, 'entities', doc.entityId)[0]) throw new Error('forbidden');
      if (prev && prev.entityId !== doc.entityId) throw new Error('forbidden');
      doc.parentId = doc.entityId;
      // only a manager signs off or reopens a closed exercise
      var closing = doc.status === 'closed' && (!prev || prev.status !== 'closed');
      var reopening = prev && prev.status === 'closed' && doc.status !== 'closed';
      if (closing || reopening) need_(s, 'manager');
      if (prev && prev.status === 'closed' && doc.status === 'closed' && JSON.stringify(stripMeta_(prev)) !== JSON.stringify(stripMeta_(doc))) throw new Error('exercise_closed');
      guardReviews_(s, prev, doc);
      if (closing && (doc.reviews || []).some(function (r) { return r && r.status !== 'cleared'; })) throw new Error('open_review_notes');
      if (closing) { doc.signedOffBy = s.user.name; doc.signedOffAt = now_(); }
    } else if (CHILD_TABLES[table]) {
      var ex = readTable_(ss, 'exercises', doc.parentId)[0];
      if (!ex || !canEntity_(s, ex.entityId)) throw new Error('forbidden');
      if (ex.status === 'closed') throw new Error('exercise_closed');
      if (prev && prev.parentId !== doc.parentId) throw new Error('forbidden');
      doc.entityId = ex.entityId;
    } else if (ENTITY_TABLES[table]) {
      // annual figures, ZATCA letters, statements of account, refunds, disputes, calendar events
      if (!doc.entityId || !canEntity_(s, doc.entityId) || !readTable_(ss, 'entities', doc.entityId)[0]) throw new Error('forbidden');
      if (prev && prev.entityId !== doc.entityId) throw new Error('forbidden');
    } else if (table === 'settings') {
      doc.entityId = '';
    }
    doc.updatedAt = now_(); doc.updatedBy = s.user.name;
    writeDoc_(ss, table, doc);
    if (table !== 'rows') tenantAudit_(s, prev ? 'update' : 'create', table, doc.id, doc.label || doc.name || doc.period || doc.title || '');
    return doc;
  });
}

function remove_(s, table, id) {
  checkTable_(table);
  if (table === 'audit' || table === 'settings') throw new Error('forbidden');
  need_(s, table === 'entities' ? 'owner' : 'preparer');
  withLock_(function () {
    var ss = book_(s), d = readTable_(ss, table, id)[0];
    if (!d) return;
    if (!canEntity_(s, table === 'entities' ? d.id : d.entityId)) throw new Error('forbidden');
    if (CHILD_TABLES[table]) {
      var ex = readTable_(ss, 'exercises', d.parentId)[0];
      if (ex && ex.status === 'closed') throw new Error('exercise_closed');
    }
    if (table === 'exercises') {
      need_(s, 'manager');
      Object.keys(CHILD_TABLES).forEach(function (t) {
        readTable_(ss, t).filter(function (x) { return x.parentId === id; }).forEach(function (x) { deleteDoc_(ss, t, x.id); });
      });
    }
    if (table === 'datasets') deleteDoc_(ss, 'rows', id);
    deleteDoc_(ss, table, id);
    tenantAudit_(s, 'delete', table, id, d.label || d.name || d.period || '');
  });
}

// Review notes on an exercise: a manager raises and clears them; anyone else may
// only reply. Sign-off is refused while one is open.
function guardReviews_(s, prev, doc) {
  var before = (prev && prev.reviews) || [], after = doc.reviews || [];
  if (!Array.isArray(after)) throw new Error('bad_doc');
  if (after.length > 500) throw new Error('bad_doc');
  after.forEach(function (r) {
    if (!r || typeof r !== 'object') throw new Error('bad_doc');
    checkId_(r.id);
    ['text', 'reply', 'checkId', 'by', 'clearedBy'].forEach(function (k) { if (r[k] != null) r[k] = String(r[k]).slice(0, 2000); });
  });
  if (s.user.role === 'owner' || s.user.role === 'manager') return;
  // the stored notes stand; only the replies sent for them are taken
  var sent = {}; after.forEach(function (r) { sent[r.id] = r; });
  doc.reviews = before.map(function (r) {
    var o = JSON.parse(JSON.stringify(r)), n = sent[r.id];
    if (n && n.reply !== o.reply) { o.reply = n.reply; o.repliedBy = s.user.name; o.repliedAt = now_(); }
    return o;
  });
}

function stripMeta_(d) { var o = {}; Object.keys(d).forEach(function (k) { if (k !== 'updatedAt' && k !== 'updatedBy') o[k] = d[k]; }); return o; }

// ---------------------------------------------------------------- sheet storage

function initTenantBook_(ss) {
  TENANT_TABLES.forEach(function (t) { sheet_(ss, t); });
  sheet_(ss, '_chunks', ['key', 'idx', 'text']);
  var first = ss.getSheetByName('Sheet1') || ss.getSheetByName('Sheet 1');
  if (first && ss.getSheets().length > 1) ss.deleteSheet(first);
}

function sheet_(ss, name, cols) {
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(cols || COLS);
    sh.setFrozenRows(1);
  }
  return sh;
}

function readTable_(ss, table, onlyId) {
  var sh = sheet_(ss, table), n = sh.getLastRow();
  if (n < 2) return [];
  var vals = sh.getRange(2, 1, n - 1, COLS.length).getValues(), out = [], chunks = null;
  for (var i = 0; i < vals.length; i++) {
    var r = vals[i];
    if (!r[0] || (onlyId && String(r[0]) !== String(onlyId))) continue;
    var raw = String(r[6] || '');
    if (raw.indexOf('@chunks:') === 0) {
      chunks = chunks || readChunks_(ss);
      raw = (chunks[table + '/' + r[0]] || []).join('');
    }
    try { out.push(JSON.parse(raw)); } catch (e) { /* a damaged row is skipped, not fatal */ }
  }
  return out;
}

function readChunks_(ss) {
  var sh = sheet_(ss, '_chunks', ['key', 'idx', 'text']), n = sh.getLastRow(), m = {};
  if (n < 2) return m;
  sh.getRange(2, 1, n - 1, 3).getValues().forEach(function (r) { (m[r[0]] = m[r[0]] || [])[+r[1]] = String(r[2]); });
  return m;
}

function writeDoc_(ss, table, doc) {
  var sh = sheet_(ss, table), json = JSON.stringify(doc), key = table + '/' + doc.id;
  deleteChunks_(ss, key);
  var cell = json;
  if (json.length > CELL_MAX) {
    var parts = [];
    for (var i = 0; i < json.length; i += CELL_MAX) parts.push([key, parts.length, "'" + json.slice(i, i + CELL_MAX)]);
    var ch = sheet_(ss, '_chunks', ['key', 'idx', 'text']);
    ch.getRange(ch.getLastRow() + 1, 1, parts.length, 3).setValues(parts);
    cell = '@chunks:' + parts.length;
  } else cell = "'" + json;
  var row = [doc.id, doc.parentId || '', doc.entityId || '', txt_(String(doc.label || doc.name || doc.period || doc.title || '').slice(0, 200)), doc.updatedAt, txt_(doc.updatedBy), cell];
  var at = findRow_(sh, doc.id);
  if (at) sh.getRange(at, 1, 1, COLS.length).setValues([row]);
  else sh.getRange(sh.getLastRow() + 1, 1, 1, COLS.length).setValues([row]);
}

function deleteDoc_(ss, table, id) {
  var sh = sheet_(ss, table), at = findRow_(sh, id);
  if (at) sh.deleteRow(at);
  deleteChunks_(ss, table + '/' + id);
}

function deleteChunks_(ss, key) {
  var sh = sheet_(ss, '_chunks', ['key', 'idx', 'text']), n = sh.getLastRow();
  if (n < 2) return;
  var keys = sh.getRange(2, 1, n - 1, 1).getValues();
  for (var i = keys.length - 1; i >= 0; i--) if (keys[i][0] === key) sh.deleteRow(i + 2);
}

function findRow_(sh, id) {
  var n = sh.getLastRow();
  if (n < 2) return 0;
  var ids = sh.getRange(2, 1, n - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) if (String(ids[i][0]) === String(id)) return i + 2;
  return 0;
}

// ---------------------------------------------------------------- registry

function registry_() {
  var p = PropertiesService.getScriptProperties(), id = p.getProperty('REGISTRY_ID');
  if (!id) {
    var ss = SpreadsheetApp.create('Inspection Ready — Registry (do not share)');
    sheet_(ss, REGISTRY_SHEETS.TENANTS, ['id', 'data']);
    sheet_(ss, REGISTRY_SHEETS.USERS, ['id', 'data']);
    sheet_(ss, REGISTRY_SHEETS.AUDIT, ['at', 'tenantId', 'userId', 'action', 'detail']);
    var first = ss.getSheetByName('Sheet1'); if (first) ss.deleteSheet(first);
    id = ss.getId(); p.setProperty('REGISTRY_ID', id);
  }
  return SpreadsheetApp.openById(id);
}
var REG_CACHE_ = {};
function regRows_(name) {
  if (REG_CACHE_[name]) return REG_CACHE_[name];
  var sh = registry_().getSheetByName(name), n = sh.getLastRow();
  var out = n < 2 ? [] : sh.getRange(2, 1, n - 1, 2).getValues().filter(function (r) { return r[0]; }).map(function (r) { return JSON.parse(String(r[1])); });
  return (REG_CACHE_[name] = out);
}
function regFind_(name, id) { return regRows_(name).filter(function (x) { return x.id === id; })[0] || null; }
function regUpsert_(name, obj) {
  var sh = registry_().getSheetByName(name), at = findRow_(sh, obj.id), row = [obj.id, "'" + JSON.stringify(obj)];
  if (at) sh.getRange(at, 1, 1, 2).setValues([row]); else sh.getRange(sh.getLastRow() + 1, 1, 1, 2).setValues([row]);
  delete REG_CACHE_[name];
}
function regAudit_(action, tid, uid, detail) {
  registry_().getSheetByName(REGISTRY_SHEETS.AUDIT).appendRow([now_(), txt_(tid), txt_(uid), txt_(action), txt_(String(detail || '').slice(0, 500))]);
}
function tenantAudit_(s, action, table, id, detail) {
  var sh = sheet_(book_(s), 'audit');
  var doc = { id: uid_('A'), at: now_(), user: s.user.name, action: action, table: table, docId: id, detail: String(detail || '').slice(0, 300) };
  sh.appendRow([doc.id, '', '', txt_(action + ' ' + table), doc.at, txt_(s.user.name), txt_(JSON.stringify(doc))]);
}

// ---------------------------------------------------------------- helpers

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try { return fn(); } finally { lock.releaseLock(); }
}
function uid_(p) { return p + '-' + Utilities.getUuid().replace(/-/g, '').slice(0, 12); }
function now_() { return new Date().toISOString(); }
function normEmail_(e) { return String(e || '').trim().toLowerCase(); }
function prop_(k) { return PropertiesService.getScriptProperties().getProperty(k); }
