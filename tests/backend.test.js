// node tests/backend.test.js — runs the real apps-script/*.gs under Node's vm
// against an in-memory fake of SpreadsheetApp and friends, then exercises
// sign-up, login, tenant isolation, roles, entity access, the sign-off lock
// and transparent chunking of large documents.
var vm = require('vm'), fs = require('fs'), path = require('path'), crypto = require('crypto'), assert = require('assert');

function fakeSheet(name, cols) {
  var rows = [];
  return {
    _rows: rows,
    getName: function () { return name; },
    appendRow: function (a) { rows.push(a.map(cell)); },
    setFrozenRows: function () {},
    getLastRow: function () { return rows.length; },
    deleteRow: function (r) { rows.splice(r - 1, 1); },
    getRange: function (r, c, nr, nc) {
      return {
        getValues: function () { var o = []; for (var i = 0; i < nr; i++) { var row = rows[r - 1 + i] || []; var x = []; for (var j = 0; j < nc; j++) x.push(row[c - 1 + j] === undefined ? '' : row[c - 1 + j]); o.push(x); } return o; },
        setValues: function (v) { for (var i = 0; i < v.length; i++) { var row = rows[r - 1 + i] || (rows[r - 1 + i] = []); for (var j = 0; j < v[i].length; j++) row[c - 1 + j] = cell(v[i][j]); } }
      };
    }
  };
}
// Sheets keeps text after a leading apostrophe as text, and enforces 50,000 chars per cell
function cell(v) {
  if (typeof v === 'string') {
    if (v[0] === "'") v = v.slice(1);
    if (v.length > 50000) throw new Error('Your input contains more than the maximum of 50000 characters in a single cell.');
  }
  return v;
}
function fakeBook(id) {
  var sheets = {}, order = [];
  var b = {
    getId: function () { return id; },
    getSheetByName: function (n) { return sheets[n] || null; },
    insertSheet: function (n) { sheets[n] = fakeSheet(n); order.push(n); return sheets[n]; },
    getSheets: function () { return order.map(function (n) { return sheets[n]; }); },
    addViewer: function (e) { (b._viewers = b._viewers || []).push(e); },
    deleteSheet: function (s) { delete sheets[s.getName()]; order.splice(order.indexOf(s.getName()), 1); },
    _sheets: sheets
  };
  b.insertSheet('Sheet1');
  return b;
}

var books = {}, props = {}, mails = [], n = 0, cache = {};
var ctx = {
  SpreadsheetApp: {
    create: function () { var id = 'book' + (++n); books[id] = fakeBook(id); return books[id]; },
    openById: function (id) { if (!books[id]) throw new Error('no book ' + id); return books[id]; }
  },
  PropertiesService: { getScriptProperties: function () { return { getProperty: function (k) { return props[k] == null ? null : props[k]; }, setProperty: function (k, v) { props[k] = v; } }; } },
  CacheService: { getScriptCache: function () { return { get: function (k) { return cache[k] || null; }, put: function (k, v) { cache[k] = v; }, remove: function (k) { delete cache[k]; } }; } },
  LockService: { getScriptLock: function () { return { waitLock: function () {}, releaseLock: function () {} }; } },
  Utilities: {
    getUuid: function () { return crypto.randomUUID(); },
    computeDigest: function (alg, s) { return Array.from(crypto.createHash('sha256').update(s, 'utf8').digest()); },
    computeHmacSha256Signature: function (s, k) { return Array.from(crypto.createHmac('sha256', k).update(s).digest()); },
    base64Encode: function (b) { return Buffer.from(b).toString('base64'); },
    base64EncodeWebSafe: function (b) { return Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'); },
    base64DecodeWebSafe: function (s) { return Array.from(Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64')); },
    newBlob: function (bytes) { return { getDataAsString: function () { return Buffer.from(bytes).toString('utf8'); } }; },
    sleep: function () {},
    DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' }
  },
  DriveApp: { getFileById: function () { return { moveTo: function () {} }; }, getFolderById: function () { return {}; } },
  MailApp: { sendEmail: function (m) { mails.push(m); } },
  ContentService: { createTextOutput: function (s) { return { setMimeType: function () { return s; } }; }, MimeType: { JSON: 'json' } },
  HtmlService: {}, ScriptApp: {}, console: console
};
vm.createContext(ctx);
['Code.gs', 'Jobs.gs'].forEach(function (f) { vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'apps-script', f), 'utf8'), ctx, { filename: f }); });

function call(req) { ctx.REG_CACHE_ = {}; vm.runInContext('REG_CACHE_ = {}', ctx); return JSON.parse(ctx.api(JSON.stringify(req))); }
function ok(r) { assert.ok(r.ok, 'expected ok, got ' + r.error); return r; }
function err(r, code) { assert.ok(!r.ok, 'expected error ' + code); assert.strictEqual(r.error, code); }

var passed = 0;
function t(name, fn) { try { fn(); passed++; console.log('  ok  ' + name); } catch (e) { console.error('  FAIL ' + name + '\n       ' + (e.stack || e.message).split('\n').slice(0, 3).join('\n       ')); process.exitCode = 1; } }

var A, B, ent, ex, ent2;
t('sign-up creates a tenant with its own spreadsheet', function () {
  A = ok(call({ action: 'signup', orgName: 'Alpha Co', name: 'Aisha', email: 'aisha@alpha.sa', password: 'correct-horse-1' }));
  B = ok(call({ action: 'signup', orgName: 'Beta Co', name: 'Bilal', email: 'bilal@beta.sa', password: 'correct-horse-2' }));
  assert.notStrictEqual(A.tenant.spreadsheetUrl, B.tenant.spreadsheetUrl);
  var bk = books[A.tenant.spreadsheetUrl.split('/d/')[1]];
  assert.ok(bk._sheets.entities && bk._sheets._chunks && !bk._sheets.Sheet1);
  assert.deepStrictEqual(bk._viewers, ['aisha@alpha.sa'], 'owner gets view access to their own sheet');
});
t('weak password and duplicate email refused', function () {
  err(call({ action: 'signup', orgName: 'X', email: 'x@x.sa', password: 'short' }), 'weak_password');
  err(call({ action: 'signup', orgName: 'X', email: 'AISHA@alpha.sa', password: 'long-enough-pw' }), 'email_taken');
});
t('login: right password works, wrong one does not', function () {
  ok(call({ action: 'login', email: 'aisha@alpha.sa', password: 'correct-horse-1' }));
  err(call({ action: 'login', email: 'aisha@alpha.sa', password: 'nope' }), 'bad_credentials');
  err(call({ action: 'login', email: 'nobody@alpha.sa', password: 'nope' }), 'bad_credentials');
});
t('five wrong passwords lock the account for a while', function () {
  for (var i = 0; i < 5; i++) err(call({ action: 'login', email: 'bilal@beta.sa', password: 'wrong' }), 'bad_credentials');
  err(call({ action: 'login', email: 'bilal@beta.sa', password: 'correct-horse-2' }), 'too_many_attempts');
  Object.keys(cache).forEach(function (k) { delete cache[k]; }); // the 15 minutes pass
  ok(call({ action: 'login', email: 'bilal@beta.sa', password: 'correct-horse-2' }));
});
t('user text is written as text, never as a formula; odd ids refused', function () {
  var X = ok(call({ action: 'signup', orgName: '=IMPORTXML("http://evil","//a")', name: '=HYPERLINK("http://evil")', email: 'eve@evil.sa', password: 'eve-password-1' }));
  var bk = books[X.tenant.spreadsheetUrl.split('/d/')[1]], sh = bk._sheets.entities, raw = null, orig = sh.getRange;
  sh.getRange = function (r, c, nr, nc) { var g = orig(r, c, nr, nc); return { getValues: g.getValues, setValues: function (v) { raw = v; g.setValues(v); } }; };
  ok(call({ action: 'save', token: X.token, table: 'entities', doc: { name: '=1+1' } }));
  assert.strictEqual(raw[0][3], "'=1+1"); assert.strictEqual(raw[0][5][0], "'");
  err(call({ action: 'save', token: X.token, table: 'entities', doc: { id: '=cmd|x', name: 'n' } }), 'bad_id');
});
t('tampered token refused', function () {
  var tok = A.token.split('.'); err(call({ action: 'me', token: tok[0] + 'x.' + tok[1] }), 'auth_required');
  err(call({ action: 'me' }), 'auth_required');
});
t('owner creates entity, exercise and child docs', function () {
  ent = ok(call({ action: 'save', token: A.token, table: 'entities', doc: { name: 'Alpha Trading', trn: '310000000000003' } })).doc;
  ent2 = ok(call({ action: 'save', token: A.token, table: 'entities', doc: { name: 'Alpha Logistics' } })).doc;
  ex = ok(call({ action: 'save', token: A.token, table: 'exercises', doc: { entityId: ent.id, period: '2026-09', status: 'in_progress' } })).doc;
  var f = ok(call({ action: 'save', token: A.token, table: 'findings', doc: { parentId: ex.id, title: 'x', entityId: 'FORGED' } })).doc;
  assert.strictEqual(f.entityId, ent.id, 'entityId comes from the exercise, not the client');
});
t('tenants cannot see each other', function () {
  assert.strictEqual(ok(call({ action: 'list', token: B.token, table: 'entities' })).docs.length, 0);
  assert.strictEqual(ok(call({ action: 'get', token: B.token, table: 'exercises', id: ex.id })).doc, null);
  err(call({ action: 'save', token: B.token, table: 'findings', doc: { parentId: ex.id, title: 'intrude' } }), 'forbidden');
});
t('large documents are chunked and read back intact', function () {
  var rows = []; for (var i = 0; i < 4000; i++) rows.push(['INV-' + i, '2026-09-01', 'Customer ' + i, 1000 + i, 150 + i]);
  var ds = ok(call({ action: 'save', token: A.token, table: 'datasets', doc: { parentId: ex.id, kind: 'sys_vat', rowCount: 4000 } })).doc;
  ok(call({ action: 'save', token: A.token, table: 'rows', doc: { id: ds.id, parentId: ex.id, cols: ['a', 'b', 'c', 'd', 'e'], data: rows } }));
  var back = ok(call({ action: 'get', token: A.token, table: 'rows', id: ds.id })).doc;
  assert.strictEqual(back.data.length, 4000); assert.deepStrictEqual(back.data[3999], rows[3999]);
  var bk = books[A.tenant.spreadsheetUrl.split('/d/')[1]];
  assert.ok(bk._sheets._chunks._rows.length > 3, 'chunks written');
  // overwrite with a small doc removes the old chunks
  ok(call({ action: 'save', token: A.token, table: 'rows', doc: { id: ds.id, parentId: ex.id, cols: ['a'], data: [[1]] } }));
  assert.strictEqual(bk._sheets._chunks._rows.length, 1, 'only the header row is left');
});
var P;
t('owner invites a preparer limited to one entity', function () {
  ok(call({ action: 'userSave', token: A.token, user: { name: 'Pat', email: 'pat@alpha.sa', role: 'preparer', password: 'preparer-pass-1', entityIds: [ent.id] } }));
  P = ok(call({ action: 'login', email: 'pat@alpha.sa', password: 'preparer-pass-1' }));
  var ents = ok(call({ action: 'list', token: P.token, table: 'entities' })).docs;
  assert.deepStrictEqual(ents.map(function (e) { return e.id; }), [ent.id]);
  err(call({ action: 'save', token: P.token, table: 'exercises', doc: { entityId: ent2.id, period: '2026-09' } }), 'forbidden');
  err(call({ action: 'save', token: P.token, table: 'entities', doc: { name: 'New' } }), 'forbidden');
  err(call({ action: 'usersList', token: P.token }), 'forbidden');
});
t('company access: unticking every company means none, never all; bad ids are dropped', function () {
  ok(call({ action: 'userSave', token: A.token, user: { name: 'Nora', email: 'nora@alpha.sa', role: 'viewer', password: 'viewer-pass-123', entityIds: [] } }));
  var N = ok(call({ action: 'login', email: 'nora@alpha.sa', password: 'viewer-pass-123' }));
  assert.strictEqual(ok(call({ action: 'list', token: N.token, table: 'entities' })).docs.length, 0, 'no company ticked: sees nothing');
  var nora = ok(call({ action: 'usersList', token: A.token })).users.filter(function (u) { return u.email === 'nora@alpha.sa'; })[0];
  assert.deepStrictEqual(nora.entityIds, []);
  ok(call({ action: 'userSave', token: A.token, user: { id: nora.id, name: 'Nora', email: 'nora@alpha.sa', role: 'viewer', entityIds: [ent2.id, '../../x', ent2.id, '<script>'] } }));
  nora = ok(call({ action: 'usersList', token: A.token })).users.filter(function (u) { return u.email === 'nora@alpha.sa'; })[0];
  assert.deepStrictEqual(nora.entityIds, [ent2.id], 'invalid and duplicate ids dropped');
  assert.deepStrictEqual(ok(call({ action: 'list', token: N.token, table: 'entities' })).docs.map(function (e) { return e.id; }), [ent2.id], 'access applies without signing in again');
});
t('preparer cannot sign off; manager can, and then the exercise is locked', function () {
  var cur = ok(call({ action: 'get', token: P.token, table: 'exercises', id: ex.id })).doc;
  cur.status = 'closed';
  err(call({ action: 'save', token: P.token, table: 'exercises', doc: cur }), 'forbidden');
  var signed = ok(call({ action: 'save', token: A.token, table: 'exercises', doc: cur })).doc;
  assert.strictEqual(signed.signedOffBy, 'Aisha');
  err(call({ action: 'save', token: P.token, table: 'findings', doc: { parentId: ex.id, title: 'late' } }), 'exercise_closed');
  signed.summary = { score: 99 };
  err(call({ action: 'save', token: A.token, table: 'exercises', doc: signed }), 'exercise_closed');
  var re = ok(call({ action: 'get', token: A.token, table: 'exercises', id: ex.id })).doc; re.status = 'in_progress';
  ok(call({ action: 'save', token: A.token, table: 'exercises', doc: re }));
});
t('disabling a user ends their session', function () {
  var users = ok(call({ action: 'usersList', token: A.token })).users, pat = users.filter(function (u) { return u.email === 'pat@alpha.sa'; })[0];
  ok(call({ action: 'userSave', token: A.token, user: { id: pat.id, name: 'Pat', email: 'pat@alpha.sa', role: 'preparer', entityIds: [ent.id], active: false } }));
  err(call({ action: 'me', token: P.token }), 'auth_required');
});
t('deleting an exercise removes its child documents', function () {
  ok(call({ action: 'remove', token: A.token, table: 'exercises', id: ex.id }));
  assert.strictEqual(ok(call({ action: 'list', token: A.token, table: 'findings' })).docs.length, 0);
  assert.strictEqual(ok(call({ action: 'list', token: A.token, table: 'datasets' })).docs.length, 0);
});
t('annual figures are scoped to an accessible entity', function () {
  var a = ok(call({ action: 'save', token: A.token, table: 'annual', doc: { id: ent.id + '_2026', entityId: ent.id, year: 2026, fsRevenue: 1000 } })).doc;
  assert.strictEqual(a.entityId, ent.id);
  err(call({ action: 'save', token: B.token, table: 'annual', doc: { id: 'x_2026', entityId: ent.id, year: 2026 } }), 'forbidden');
});
t('owner can (re)share the sheet with themselves', function () {
  var r = ok(call({ action: 'shareSheet', token: A.token }));
  assert.ok(/docs\.google\.com\/spreadsheets/.test(r.url));
});
t('data cycle: upload → Sheets (chunked) → read back → recompute gives identical results', function () {
  var E = require('../web/engine.js'); global.ZEngine = E;
  var demo = require('../web/demo.js').gen();
  var ce = ok(call({ action: 'save', token: A.token, table: 'entities', doc: { name: 'Cycle Co', trn: demo.entity.trn, mapping: demo.entity.mapping } })).doc;
  var cx = ok(call({ action: 'save', token: A.token, table: 'exercises', doc: { entityId: ce.id, period: demo.period, status: 'in_progress', returnBoxes: demo.returnBoxes, filing: demo.filing } })).doc;
  var sent = 0;
  Object.keys(demo.datasets).forEach(function (k) {
    var rows = demo.datasets[k].map(function (r, i) { return Object.assign({ _r: i + 2 }, r); });
    sent += rows.length;
    var ds = ok(call({ action: 'save', token: A.token, table: 'datasets', doc: { parentId: cx.id, kind: k, rowCount: rows.length } })).doc;
    ok(call({ action: 'save', token: A.token, table: 'rows', doc: Object.assign({ id: ds.id, parentId: cx.id }, E.packRows(rows)) }));
  });
  // read back exactly as the client does (Z.loadExercise)
  var loaded = {}, got = 0;
  ok(call({ action: 'list', token: A.token, table: 'datasets', parentId: cx.id })).docs.forEach(function (d) {
    var back = E.unpackRows(ok(call({ action: 'get', token: A.token, table: 'rows', id: d.id })).doc);
    got += back.length; (loaded[d.kind] = loaded[d.kind] || []).push.apply(loaded[d.kind], back);
  });
  assert.strictEqual(got, sent, 'every row came back');
  var exBack = ok(call({ action: 'get', token: A.token, table: 'exercises', id: cx.id })).doc;
  var ctx = function (data, boxes, filing) {
    return { entity: demo.entity, periodKey: demo.period, settings: {}, data: data, returnBoxes: boxes, reconItems: demo.reconItems, prevNetVat: demo.prevNetVat, prevWhtTax: demo.prevWhtTax,
      filing: filing, recovery: demo.recovery, history: demo.history, exciseReturn: demo.exciseReturn, priorPurchaseKeys: demo.priorPurchaseKeys, today: '2026-11-05', samples: [], checklist: [], findings: [] };
  };
  var a = E.runAll(ctx(demo.datasets, demo.returnBoxes, demo.filing)), b = E.runAll(ctx(loaded, exBack.returnBoxes, exBack.filing));
  var sig = function (R) {
    return R.vat.checks.concat(R.wht.checks, R.bank.checks, R.einv.checks, R.filing.checks, R.other.checks).map(function (c) { return c.id + ':' + c.status + ':' + c.diff + ':' + (c.exposure || 0); })
      .concat(R.analytics.tests.map(function (x) { return x.id + ':' + x.status + ':' + x.count; })).join('|');
  };
  assert.strictEqual(sig(b), sig(a));
  assert.strictEqual(b.score.score, a.score.score); assert.strictEqual(b.exposure, a.exposure);
  var bk = books[A.tenant.spreadsheetUrl.split('/d/')[1]];
  assert.ok(bk._sheets._chunks._rows.length > 1, 'large datasets were chunked');
});
t('audit trail records changes for managers', function () {
  var a = ok(call({ action: 'list', token: A.token, table: 'audit' })).docs;
  assert.ok(a.length > 5 && a.some(function (x) { return x.action === 'delete'; }));
});
t('platform admin can list and suspend tenants', function () {
  err(call({ action: 'platformTenants', token: A.token }), 'forbidden');
  props.SUPER_ADMINS = 'aisha@alpha.sa';
  var ts = ok(call({ action: 'platformTenants', token: A.token })).tenants;
  assert.strictEqual(ts.length, 3);
  var beta = ts.filter(function (x) { return x.name === 'Beta Co'; })[0];
  ok(call({ action: 'platformTenantStatus', token: A.token, id: beta.id, status: 'suspended' }));
  err(call({ action: 'me', token: B.token }), 'tenant_suspended');
});
t('monthly reminder emails owners about entities without an exercise', function () {
  var RealDate = ctx.Date;
  vm.runInContext('var __D = Date; Date = function (a) { return a === undefined ? new __D("2026-11-01T08:00:00Z") : new __D(a); }; Date.now = __D.now;', ctx);
  ctx.monthlyReminder();
  vm.runInContext('Date = __D;', ctx);
  assert.ok(mails.length >= 1 && /Alpha Trading/.test(mails[0].body), JSON.stringify(mails));
});
console.log('\n' + passed + ' passed' + (process.exitCode ? ', some FAILED' : ''));
