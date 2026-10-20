/* Stress test of the tax engine with generated data: messy values, missing
   columns, blank files, extreme amounts, any period since 2018, monthly and
   quarterly, with and without WHT. Every run must finish without an error and
   every figure must be a finite number (or deliberately null).
   node tests/fuzz.js [runs] [seed]                                         */
var assert = require('assert');
var E = require('../web/engine.js');
var RUNS = +process.argv[2] || 600, seed = +process.argv[3] || 20261019;
function rnd() { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; }
function pick(a) { return a[Math.floor(rnd() * a.length)]; }
function int(a, b) { return a + Math.floor(rnd() * (b - a + 1)); }

var NUMS = [0, 1, -1, 0.004, 100, 1500, 15000, 14999.99, 1e6, 9.99e9, -25000, 0.5, '', null, undefined, 'abc', '1,234.50', '(500)', NaN, '١٢٣'];
var STRS = ['', 'Alpha Co', 'شركة الاختبار', '<b>x</b>', 'S', 'P', 'Z', 'E', 'O', 'RCM', 'standard', 'exempt', 'mada POS', 'SWIFT transfer', 'deposit', null, '310000000000003', '300000000000000', 'x'.repeat(300)];
var STATUSES = ['CLEARED', 'REPORTED', 'REJECTED', 'PENDING', 'WARNING', 'NOT_SUBMITTED', '', 'cleared'];
function dateIn(period) {
  if (rnd() < 0.08) return pick(['', null, '2026-02-30', 'not a date', '31/12/2025']);
  var r = E.periodRange(period); if (!r) return '2026-09-15';
  var d0 = new Date(r.start + 'T00:00:00Z').getTime(), d1 = new Date(r.end + 'T00:00:00Z').getTime();
  var d = new Date(d0 + rnd() * (d1 - d0 + 86400000 * (rnd() < 0.1 ? 60 : 0)));
  return d.toISOString().slice(0, 10);
}
function value(f, period) {
  if (rnd() < 0.05) return undefined;                  // optional column missing
  if (f.t === 'n') return pick(NUMS.concat([int(-5000, 500000), rnd() * 1e5]));
  if (f.t === 'd') return dateIn(period);
  if (f.k === 'status') return pick(STATUSES);
  if (f.k === 'paymentType') return pick(E.WHT_TYPES.map(function (w) { return w[0]; }).concat(['', 'unknown']));
  if (f.k === 'flow') return pick(['S', 'P', '', 'X']);
  if (f.k === 'category') return pick(['S', 'Z', 'E', 'O', 'RCM', 'IMP', '', 'q']);
  return pick(STRS);
}
function dataset(period) {
  var data = {};
  Object.keys(E.KINDS).forEach(function (k) {
    if (rnd() < 0.3) return;                            // source not loaded
    var n = pick([0, 1, 2, 5, 20, 80]), rows = [];
    for (var i = 0; i < n; i++) {
      var r = { _r: i + 2, _k: k + ':' + i };
      E.KINDS[k].fields.forEach(function (f) { var v = value(f, period); if (v !== undefined) r[f.k] = v; });
      rows.push(r);
    }
    data[k] = rows;
  });
  return data;
}
function boxes() {
  if (rnd() < 0.15) return null;
  var b = E.emptyBoxes();
  Object.keys(b).forEach(function (n) { ['amount', 'adj', 'vat'].forEach(function (f) { if (rnd() < 0.6) b[n][f] = pick([0, int(0, 2e6), -int(0, 50000), 0.01]); }); });
  return E.completeBoxes(b);
}
function period() {
  var y = int(2018, 2026), q = rnd() < 0.3;
  return q ? y + '-Q' + int(1, 4) : y + '-' + String(int(1, 12)).padStart(2, '0');
}
var finite = function (v) { return v === null || v === undefined || (typeof v === 'number' && isFinite(v)) || typeof v === 'string'; };
function checkList(list, where) {
  list.forEach(function (c) {
    assert.ok(['pass', 'warn', 'fail', 'na'].indexOf(c.status) >= 0, where + ' ' + c.id + ' status ' + c.status);
    ['a', 'b', 'diff', 'exposure'].forEach(function (k) {
      assert.ok(finite(c[k]), where + ' ' + c.id + '.' + k + ' = ' + c[k]);
      if (typeof c[k] === 'number') assert.ok(!isNaN(c[k]), where + ' ' + c.id + '.' + k + ' NaN');
    });
    if (c.exposure != null) assert.ok(c.exposure >= 0, where + ' ' + c.id + ' negative exposure ' + c.exposure);
    assert.ok(c.title && typeof c.title === 'string', where + ' ' + c.id + ' title');
  });
}

var failures = 0, t0 = Date.now(), slowest = 0;
for (var run = 0; run < RUNS; run++) {
  var pk = period(), ent = { id: 'E1', name: 'Fuzz', trn: pick(['310000000000003', '', 'bad']), vatFreq: /Q/.test(pk) ? 'quarterly' : 'monthly', whtRegistered: rnd() < 0.8,
    mapping: rnd() < 0.7 ? { outputVat: '2210', inputVat: '1410', revenue: '4*', receivables: '1200-1299', payables: '2100', bank: '11*', whtPayable: '2230', vatPayable: '2220', foreignExpense: '5300' } : {} };
  var ctx = { entity: ent, periodKey: pk, settings: rnd() < 0.2 ? { vatRate: 0.15, materiality: pick([0, 1, 1e9]) } : {}, data: dataset(pk), returnBoxes: boxes(),
    reconItems: rnd() < 0.3 ? [{ id: 'r', check: 'V6', description: 'x', amount: pick([100, -100, 'x']) }] : [], prevNetVat: pick([null, 0, 12345, -500]), prevWhtTax: pick([null, 0, 999]),
    filing: rnd() < 0.5 ? { vatFiledOn: dateIn(pk), vatPaidOn: dateIn(pk), vatPaidAmount: pick(['', 100, 'x']), whtFiledOn: dateIn(pk), whtPaidOn: '' } : {}, today: pick(['2026-10-19', '2018-03-01', '2030-01-01']),
    samples: [], checklist: [], findings: rnd() < 0.3 ? [{ tax: pick(['VAT', 'WHT']), status: 'open', taxImpact: pick([0, 500, 'x']) }] : [], history: [] };
  var where = 'run ' + run + ' ' + pk;
  try {
    var s = Date.now();
    var R = E.runAll(ctx);
    slowest = Math.max(slowest, Date.now() - s);
    checkList([].concat(R.vat.checks, R.bank.checks, R.einv.checks, R.wht.checks, R.filing.checks, R.other.checks), where);
    [R.score, R.vatScore].concat(R.whtScore ? [R.whtScore] : []).forEach(function (sc) {
      assert.ok(Number.isInteger(sc.score) && sc.score >= 0 && sc.score <= 100, where + ' score ' + sc.score);
      assert.ok(['ready', 'mostly', 'risk', 'not'].indexOf(sc.grade) >= 0, where + ' grade');
    });
    ['exposure', 'vatExposure', 'whtExposure'].forEach(function (k) { assert.ok(isFinite(R[k]) && R[k] >= 0, where + ' ' + k + ' ' + R[k]); });
    var P = R.plan;
    P.actions.forEach(function (a) {
      ['impact', 'costNow', 'costLater', 'avoided'].forEach(function (k) { assert.ok(isFinite(a[k]) && a[k] >= 0, where + ' ' + a.checkId + '.' + k + ' ' + a[k]); });
      assert.ok(a.costLater >= a.costNow, where + ' ' + a.checkId + ' later < now');
      assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(a.deadline || ''), where + ' ' + a.checkId + ' deadline ' + a.deadline);
      assert.ok(a.steps.length && a.steps.every(function (x) { return x.en && x.ar; }), where + ' ' + a.checkId + ' steps');
    });
    Object.keys(P.totals).forEach(function (k) { var v = P.totals[k]; if (typeof v === 'number') assert.ok(isFinite(v) && v >= 0, where + ' total ' + k); });
    JSON.parse(JSON.stringify(R));                      // what the UI saves must serialise
    (R.analytics.tests || []).forEach(function (x) { assert.ok(isFinite(x.count || 0) && isFinite(x.amount || 0), where + ' ' + x.id + ' count/amount'); });
    // storage round trip of every dataset
    Object.keys(ctx.data).forEach(function (k) {
      var rows = ctx.data[k].map(function (r) { var c = Object.assign({}, r); delete c._k; return c; });
      var back = E.unpackRows(JSON.parse(JSON.stringify(E.packRows(rows))));
      assert.strictEqual(back.length, rows.length, where + ' pack ' + k);
    });
  } catch (e) {
    failures++;
    if (failures <= 15) console.log('  FAIL ' + where + ': ' + (e.message || e).split('\n')[0]);
  }
}
// sampling maths on random populations
for (var i = 0; i < 300; i++) {
  try {
    var pop = []; for (var j = 0, n = int(0, 400); j < n; j++) pop.push({ net: pick([int(1, 90000), 0, -50, rnd() * 10]), vat: rnd() * 1000 });
    var bv = pop.reduce(function (a, x) { return a + Math.abs(x.net); }, 0);
    var size = E.sampleSizeMUS(bv, pick([0, 1, 1000, bv * 0.03 + 1]), pick([0, 100]), pick([0.9, 0.95, 0.99]));
    assert.ok(size === null || (Number.isInteger(size) && size >= 0), 'MUS size ' + size);
    var sel = E.selectMUS(pop, Math.min(size || 0, pop.length), int(1, 1e6), 'net');
    assert.ok(sel.items.every(function (x) { return x.i >= 0 && x.i < pop.length; }), 'MUS selection in range');
    var att = E.sampleSizeAttribute(pick([0.9, 0.95]), pick([0.05, 0.1, 0.02]), pick([0, 0.01, 0.05]), pop.length);
    assert.ok(att === null || (Number.isInteger(att) && att >= 0 && att <= Math.max(pop.length, att)), 'attribute size ' + att);
    var ev = E.evaluateSample({ flow: 'S', method: 'mus', interval: 1000, items: sel.items.slice(0, 5).map(function (x) { return { book: Math.abs(pop[x.i].net), audited: pick(['', 0, 10]), tests: { a: pick(['pass', 'fail', 'na']) } }; }) }, 0.95);
    ['projected', 'actualMisstatement', 'rate'].forEach(function (k) { assert.ok(ev[k] == null || isFinite(ev[k]), 'evaluate ' + k + ' ' + ev[k]); });
  } catch (e) { failures++; if (failures <= 15) console.log('  FAIL sampling ' + i + ': ' + e.message); }
}
// ZATCA account and VAT adjustments: typed-in registers and statements, any junk
var JUNK = [null, '', undefined, 'abc', '-5', '2026-02-30', '12/13/2026', -1000, 1e12, '١٢٣', {}, [], true, 'yes', 50, '2025-06-15', '2026-09'];
for (var k = 0; k < 600; k++) {
  try {
    var o = {}; ['acquiredOn', 'inputVat', 'usefulYears', 'initialPct', 'kind', 'invoiceDate', 'vat', 'amount', 'writtenOffOn', 'claimedPeriod', 'recovered', 'receivedOn', 'declaredPeriod', 'invoiceOn', 'refundable', 'currency', 'rateUsed', 'samaRate', 'marketValue', 'consideration', 'buyerFullRecovery', 'notified', 'date', 'debit', 'credit', 'period', 'kind', 'description', 'stage', 'noticeOn', 'status', 'approvedOn'].forEach(function (f) { o[f] = pick(JUNK); });
    o.uses = [{ year: 2025, pct: pick(JUNK), declared: pick(JUNK) }, pick(JUNK)];
    var aj = E.adjustments({ capital: [o, pick(JUNK)], baddebts: [o], advances: [o], fx: [o], related: [o] }, {}, '2026-10-20');
    var sr = E.statementRecon({ lines: [o, o, pick(JUNK)], glBalance: pick(JUNK) }, [{ id: 'X', period: '2026-08', summary: { netVat: pick(JUNK), whtTax: pick(JUNK) } }], [o], {}, '2026-10-20');
    var cal = E.complianceCalendar({ entities: [{ id: 'A' }], events: [o], disputes: [o], refunds: [o], from: '2026-01-01', to: '2026-12-31', today: '2026-10-20' });
    var js = JSON.stringify([aj, sr, cal, E.refundStatus(o, {}, '2026-10-20'), E.disputeStatus(o, {}, '2026-10-20')]);
    assert.ok(!/NaN|Infinity/.test(js), 'no NaN');
    assert.ok(aj.exposure >= 0 && aj.recover >= 0 && sr.exposure >= 0, 'no negative exposure');
  } catch (e) { failures++; if (failures <= 15) console.log('  FAIL account ' + k + ': ' + e.message); }
}
console.log(RUNS + ' generated exercises + 300 samples in ' + ((Date.now() - t0) / 1000).toFixed(1) + 's (slowest run ' + slowest + ' ms): ' + (failures ? failures + ' FAILED' : 'all passed'));
process.exitCode = failures ? 1 : 0;
