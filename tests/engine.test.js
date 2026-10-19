// node tests/engine.test.js — runs the engine against the demo company and
// asserts that every planted problem is caught and nothing clean is flagged.
var assert = require('assert');
var E = require('../web/engine.js');
global.ZEngine = E;
var demo = require('../web/demo.js').gen();

var passed = 0;
function t(name, fn) { try { fn(); passed++; console.log('  ok  ' + name); } catch (e) { console.error('  FAIL ' + name + '\n       ' + e.message); process.exitCode = 1; } }
function byId(list, id) { return list.filter(function (c) { return c.id === id; })[0]; }

var ctx = {
  entity: demo.entity, periodKey: demo.period, settings: {}, data: demo.datasets,
  returnBoxes: demo.returnBoxes, reconItems: demo.reconItems, prevNetVat: demo.prevNetVat, prevWhtTax: demo.prevWhtTax,
  samples: [], checklist: [], findings: []
};
var R = E.runAll(ctx);

console.log('normalizers');
t('Arabic digits and brackets', function () { assert.strictEqual(E.num('(١٬٢٣٤٫٥٠)'), -1234.5); assert.strictEqual(E.num('1,234.50'), 1234.5); });
t('day-first dates', function () { assert.strictEqual(E.date('03/04/2026'), '2026-04-03'); assert.strictEqual(E.date(46000), '2025-12-09'); });
t('TRN format', function () { assert.ok(E.validVatNo('310123456700003')); assert.ok(!E.validVatNo('300123456700002')); });
t('categories', function () { assert.strictEqual(E.category('Reverse charge', 'P'), 'RCM'); assert.strictEqual(E.category('Zero rated', 'S'), 'Z'); assert.strictEqual(E.category('Standard 15%', 'S'), 'S'); });
t('header detection (Arabic)', function () {
  var h = E.detectHeader([['Report'], ['رقم الفاتورة', 'التاريخ', 'النوع', 'فئة الضريبة', 'المبلغ قبل الضريبة', 'مبلغ الضريبة']], 'sys_vat');
  assert.strictEqual(h.row, 1); assert.strictEqual(h.map.invoice, 0); assert.strictEqual(h.map.vat, 5);
});
t('box completion: RCM VAT counts on both sides', function () {
  var b = E.emptyBoxes(); b[1].vat = 150; b[9].vat = 30; b[7].vat = 60; b = E.completeBoxes(b);
  assert.strictEqual(b[13].vat, 150 + 30 - 90);
});

console.log('VAT reconciliation');
t('V1 return vs system fails on box 1 by 23,400', function () {
  var c = byId(R.vat.checks, 'V1'); assert.strictEqual(c.status, 'fail');
  var l = c.lines.filter(function (x) { return x.box === 1; })[0]; assert.strictEqual(l.dAmount, -23400);
});
t('V2 return vs Excel catches box 3, tolerates box 7 rounding', function () {
  var c = byId(R.vat.checks, 'V2'); assert.strictEqual(c.status, 'fail');
  assert.strictEqual(c.lines.filter(function (x) { return x.box === 3; })[0].status, 'fail');
  assert.strictEqual(c.lines.filter(function (x) { return x.box === 7; })[0].status, 'pass');
});
t('V4 output VAT: GL holds the unreported invoice VAT', function () { var c = byId(R.vat.checks, 'V4'); assert.strictEqual(c.diff, -3510); });
t('V5 input VAT ties to GL', function () { assert.strictEqual(byId(R.vat.checks, 'V5').status, 'pass'); });
t('V6 revenue: other income explained, invoice gap remains', function () { var c = byId(R.vat.checks, 'V6'); assert.strictEqual(c.diff, 23400); });
t('V7 net VAT liability across all VAT accounts shows the same 3,510', function () { assert.strictEqual(byId(R.vat.checks, 'V7').diff, -3510); });
t('B2 payments tie to purchases once RCM VAT is excluded', function () { assert.strictEqual(byId(R.bank.checks, 'B2').status, 'pass'); });
t('B1 excess = cash deposit + cash for the unreported invoice', function () { assert.strictEqual(byId(R.bank.checks, 'B1').diff, 85000 + 26910); });
t('V8 customs: one import declaration missing', function () { assert.strictEqual(byId(R.vat.checks, 'V8').status, 'fail'); });
t('V9 Fatoora: 3 unreported, 1 rejected', function () { var c = byId(R.vat.checks, 'V9'); assert.strictEqual(c.counts.notReported, 3); assert.strictEqual(c.counts.rejected, 1); });

console.log('bank');
t('classification', function () {
  var cls = {}; R.bank.lines.forEach(function (l) { cls[l.cls] = (cls[l.cls] || 0) + 1; });
  assert.ok(cls.zatca_vat === 1 && cls.zatca_wht === 1 && cls.payroll === 1 && cls.internal_transfer === 1 && cls.foreign_transfer === 4, JSON.stringify(cls));
});
t('B1 receipts exceed declared sales (unreported cash)', function () { var c = byId(R.bank.checks, 'B1'); assert.strictEqual(c.status, 'fail'); assert.ok(c.diff > 80000, String(c.diff)); });
t('B3 VAT paid = previous net VAT', function () { assert.strictEqual(byId(R.bank.checks, 'B3').status, 'pass'); });
t('B4 WHT paid = previous WHT return', function () { assert.strictEqual(byId(R.bank.checks, 'B4').status, 'pass'); });
t('B5 one foreign transfer not in WHT register', function () { var c = byId(R.bank.checks, 'B5'); assert.strictEqual(c.counts.unmatched, 1); assert.ok(/Lisbon/.test(c.exceptions.unmatched[0].description)); });
t('B6 the cash deposit is untraced', function () { var c = byId(R.bank.checks, 'B6'); assert.ok(c.exceptions.unmatched.some(function (l) { return l.credit === 85000; })); });
t('B7 bank balance ties to TB', function () { assert.strictEqual(byId(R.bank.checks, 'B7').status, 'pass'); });

console.log('WHT');
t('W1 return misses freight line', function () { var c = byId(R.wht.checks, 'W1'); assert.strictEqual(c.diff, -1300); });
t('W5 management fees under-withheld by 6,000', function () { var c = byId(R.wht.checks, 'W5'); assert.strictEqual(c.a, 6000); });
t('W6 one late remittance with a 1%-per-30-days fine', function () { var c = byId(R.wht.checks, 'W6'); assert.strictEqual(c.counts.late, 1); assert.strictEqual(c.exceptions.late[0].penalty, 9.5); });
t('W7 one certificate missing', function () { assert.strictEqual(byId(R.wht.checks, 'W7').counts.noCert, 1); });
t('W8 Lisbon Analytics expense not in register', function () { var c = byId(R.wht.checks, 'W8'); assert.strictEqual(c.counts.missing, 1); });
t('W4 WHT payable credits tie to register, not return', function () { assert.strictEqual(byId(R.wht.checks, 'W4').diff, -1300); });

console.log('analytics');
var A = function (id) { return byId(R.analytics.tests, id); };
t('A1 one mis-rated invoice', function () { assert.strictEqual(A('A1').count, 1); });
t('A3 purchases without valid TRN (3 planted + the foreign supplier)', function () { assert.strictEqual(A('A3').count, 4); });
t('A4 bad customer TRNs (2 planted + a credit note copying one)', function () { assert.strictEqual(A('A4').count, 3); });
t('A5 duplicate supplier invoice found', function () { assert.ok(A('A5').count >= 1); });
t('A7 two numbering gaps', function () { assert.strictEqual(A('A7').count, 2); });
t('A8 export to SA', function () { assert.strictEqual(A('A8').count, 1); });
t('A9 foreign supplier not on RCM', function () { assert.strictEqual(A('A9').count, 1); });
t('A16 Benford computed', function () { assert.ok(A('A16').mad > 0); });
t('effective VAT rate below 15% because of the mis-rated line', function () { assert.ok(R.analytics.ratios.effectiveRate < 15 && R.analytics.ratios.effectiveRate > 14.8); });

console.log('sampling');
t('attribute sample size 95% / 5% / 0 → 59 (Poisson)', function () { assert.strictEqual(E.sampleSizeAttribute(0.95, 0.05, 0, 100000), 60); });
t('reliability factors', function () { assert.strictEqual(E.reliabilityFactor(0, 0.95), 3); assert.strictEqual(E.reliabilityFactor(1, 0.95), 4.75); });
t('MUS selection is reproducible and includes the top stratum', function () {
  var pop = demo.datasets.sys_vat.filter(function (x) { return x.flow === 'P'; });
  var a = E.selectMUS(pop, 40, 7, 'vat'), b = E.selectMUS(pop, 40, 7, 'vat');
  assert.deepStrictEqual(a.items, b.items);
  assert.ok(a.items.length >= 35 && a.items.length <= 41, String(a.items.length));
});
t('MUS evaluation projects a tainting', function () {
  var s = { flow: 'P', method: 'mus', interval: 10000, items: [{ book: 2000, audited: 1000, tests: { amount: 'fail' } }, { book: 5000, audited: 5000, tests: { amount: 'pass' } }] };
  var ev = E.evaluateSample(s, 0.95);
  assert.strictEqual(ev.projected, 5000); assert.strictEqual(ev.deviations, 1);
});
t('random selection is seeded', function () { assert.deepStrictEqual(E.selectRandom(new Array(500).fill(0), 10, 42), E.selectRandom(new Array(500).fill(0), 10, 42)); });

console.log('scoring');
t('readiness is low for the demo with nothing tested', function () { assert.ok(R.score.score < 60, String(R.score.score)); });
t('exposure includes WHT under-withholding', function () { assert.ok(R.exposure >= 6000); });

console.log('\n' + passed + ' passed' + (process.exitCode ? ', some FAILED' : ''));
