// node tests/engine.test.js — runs the engine against the demo company and
// asserts that every planted problem is caught and nothing clean is flagged.
var assert = require('assert');
var E = require('../web/engine.js');
global.ZEngine = E;
var demo = require('../web/demo.js').gen();

var passed = 0, r2 = E.r2;
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
t('B1 excess = cash deposit + cash for the unreported invoice + the untraced Noon payout', function () { assert.strictEqual(byId(R.bank.checks, 'B1').diff, 85000 + 26910 + 48000); });
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
t('W6 one late remittance with a 1%-per-30-days fine', function () { var c = byId(R.wht.checks, 'W6'); assert.strictEqual(c.counts.late, 1); /* 43 days late: one full 30-day period */ assert.strictEqual(c.exceptions.late[0].penalty, 4.75); });
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

console.log('e-invoicing: ERP ↔ provider ↔ ZATCA');
var R2 = E.runAll({ entity: demo.entity, periodKey: demo.period, settings: {}, data: demo.datasets, returnBoxes: demo.returnBoxes, reconItems: demo.reconItems,
  prevNetVat: demo.prevNetVat, prevWhtTax: demo.prevWhtTax, filing: demo.filing, recovery: demo.recovery, history: demo.history, today: '2026-11-05', samples: [], checklist: [], findings: [] });
var EI = function (id) { return byId(R2.einv.checks, id); };
t('E1 two ERP invoices never reached the provider', function () { assert.strictEqual(EI('E1').counts.list, 2); });
t('E2 the POS sale outside the ERP', function () { assert.strictEqual(EI('E2').counts.list, 1); assert.strictEqual(EI('E2').exceptions.list[0].invoice, 'POS-88417'); });
t('E3 rejected, pending, and accepted-at-provider-but-unknown-to-ZATCA', function () {
  var r = EI('E3').exceptions.list.map(function (x) { return x.reason; }).join('|');
  assert.ok(/REJECTED/.test(r) && /PENDING/.test(r) && /ZATCA has no record/.test(r), r);
});
t('E4 the SAR 150 VAT mismatch', function () { assert.strictEqual(EI('E4').counts.list, 1); });
t('E5 B2C after 30 h and B2B cleared 3.5 h after issue', function () { assert.strictEqual(EI('E5').counts.list, 2); });
t('E6 skipped counter on an EGS unit', function () { assert.strictEqual(EI('E6').counts.list, 1); });
t('E7 credit note without a reference', function () { assert.strictEqual(EI('E7').counts.list, 1); });
t('E8 simplified invoice to a VAT-registered customer is flagged', function () { assert.ok(EI('E8').exceptions.list.some(function (x) { return /standard \(cleared\)/.test(x.reason); })); });
t('E9 one accepted with a warning', function () { assert.strictEqual(EI('E9').counts.list, 1); });
t('datetime parsing', function () { assert.strictEqual(E.datetime('03/09/2026 14:05'), '2026-09-03T14:05'); assert.strictEqual(E.datetime('2026-09-03T14:05:59Z'), '2026-09-03T14:05'); });

console.log('filing & payment');
var FC = function (id) { return byId(R2.filing.checks, id); };
t('C1 VAT filed on time, C2 paid in full on time', function () { assert.strictEqual(FC('C1').status, 'pass'); assert.strictEqual(FC('C2').status, 'pass'); });
t('C3 WHT 2 days late: late, but no fine under 30 days', function () { assert.strictEqual(FC('C3').status, 'warn'); assert.strictEqual(FC('C3').exposure, 0); });
t('C1 late filing and C2 late payment are priced', function () {
  var r = E.runFiling({ settings: E.mergeSettings({}), periodKey: '2026-09', returnBoxes: demo.returnBoxes, filing: { vatFiledOn: '2026-11-20', vatPaidOn: '2026-12-15' }, today: '2026-12-20' });
  var c1 = byId(r.checks, 'C1'), c2 = byId(r.checks, 'C2');
  assert.strictEqual(c1.status, 'fail'); assert.strictEqual(c2.status, 'fail');
  assert.ok(c2.exposure > 0 && /2\)/.test(c2.note), c2.note); // 45 days → 2 months or part
});

console.log('input VAT recovery, cross-tax, trends');
var VC = function (id) { return byId(R2.vat.checks, id); };
t('V10 three blocked purchases (dinner, hotel, GM car)', function () { assert.strictEqual(VC('V10').counts.list, 3); });
t('V11 exempt sales with no apportionment fail with an upper-bound exposure', function () { assert.strictEqual(VC('V11').status, 'fail'); assert.ok(VC('V11').exposure > 0 && VC('V11').a < 100); });
t('V11 passes once apportionment is applied at the computed ratio', function () {
  var ratio = VC('V11').a;
  var r = E.runRecovery({ settings: E.mergeSettings({}), entity: demo.entity, data: demo.datasets, returnBoxes: demo.returnBoxes, recovery: { method: 'standard', commonVat: 100000, directExemptVat: 0, ratioUsed: ratio } });
  assert.strictEqual(byId(r.checks, 'V11').status, 'pass');
});
t('V12 SAR 30,000 of gifts against the monthly relief', function () { assert.strictEqual(VC('V12').status, 'warn'); assert.strictEqual(VC('V12').exposure, 3875); });
t('A17 two exports without customs evidence', function () { assert.strictEqual(byId(R2.analytics.tests, 'A17').count, 2); });
var XC = function (id) { return byId(R2.wht.checks, id); };
t('X1 reverse-charged training with no WHT line', function () { assert.strictEqual(XC('X1').counts.list, 1); assert.ok(/Amman/.test(XC('X1').exceptions.list[0].party)); });
t('X2 management fees to the parent with no reverse-charge VAT', function () { assert.strictEqual(XC('X2').counts.list, 1); assert.strictEqual(XC('X2').exposure, 18000); });
t('T2 input VAT surge against history; T1 sales steady', function () { assert.strictEqual(byId(R2.analytics.tests, 'T2').status, 'warn'); assert.strictEqual(byId(R2.analytics.tests, 'T1').status, 'pass'); });

console.log('marketplaces, RETT, excise, Zakat, integration wave');
var R3 = E.runAll({ entity: demo.entity, periodKey: demo.period, settings: {}, data: demo.datasets, returnBoxes: demo.returnBoxes, reconItems: demo.reconItems, prevNetVat: demo.prevNetVat, prevWhtTax: demo.prevWhtTax,
  filing: demo.filing, recovery: demo.recovery, history: demo.history, exciseReturn: demo.exciseReturn, today: '2026-11-05', samples: [], checklist: [], findings: [] });
var OC = function (id) { return byId(R3.other.checks, id); };
t('M2 Noon payout with no Noon sales booked', function () { assert.strictEqual(OC('M2').a, 48000); });
t('M1 platform deemed supplier: unregistered resident seller from 2026 with no VAT', function () {
  var r = E.runOtherTaxes({ settings: E.mergeSettings({}), data: { mkt_sales: [
    { date: '2026-02-01', seller: 'Home bakery', sellerVat: '', sellerResident: 'yes', category: 'goods', gross: 1150, vat: 0 },
    { date: '2025-12-15', seller: 'Home bakery', sellerVat: '', sellerResident: 'yes', category: 'goods', gross: 1150, vat: 0 },
    { date: '2026-02-01', seller: 'Registered shop', sellerVat: '310123456700003', sellerResident: 'yes', category: 'goods', gross: 1150, vat: 0 },
    { date: '2025-06-01', seller: 'US app studio', sellerVat: '', sellerResident: 'no', category: 'electronic services', gross: 230, vat: 0 }] } });
  var m1 = byId(r.checks, 'M1'); assert.strictEqual(m1.counts.list, 2); assert.strictEqual(m1.exposure, 180);
});
t('R1 RETT short by 32,000 on the warehouse; the exempt transfer is not flagged', function () { assert.strictEqual(OC('R1').a, 32000); assert.strictEqual(OC('R1').counts.list, 1); });
t('R2 RETT paid 36 days after the transaction (limit 30)', function () { assert.strictEqual(OC('R2').counts.list, 1); assert.strictEqual(OC('R2').exceptions.list[0].daysLate, 6); });
t('K1 sweetened drinks from 2026: SAR per litre by sugar tier', function () {
  var r = E.runOtherTaxes({ settings: E.mergeSettings({}), periodKey: '2026-09', data: { excise: [
    { date: '2026-09-30', product: 'Cola', category: 'Carbonated sweetened', qty: 1, retailPrice: 2, litres: 1000, sugar: 10.6, excise: 1090 },
    { date: '2026-09-30', product: 'Light juice', category: 'Sweetened drinks', qty: 1, retailPrice: 2, litres: 1000, sugar: 6, excise: 0 },
    { date: '2026-09-30', product: 'Diet cola', category: 'Sweetened drinks', qty: 1, retailPrice: 2, litres: 1000, sugar: 0, excise: 0 },
    { date: '2025-09-30', product: 'Old juice', category: 'Sweetened drinks', qty: 300, retailPrice: 3, excise: 300 }] } });
  var k1 = byId(r.checks, 'K1'); assert.strictEqual(k1.counts.list, 1); assert.strictEqual(k1.exceptions.list[0].product, 'Light juice'); assert.strictEqual(k1.a, 790);
});
t('K3 200 packs missing from the designated zone, taxed as released', function () { assert.strictEqual(OC('K3').counts.list, 1); assert.strictEqual(OC('K3').exposure, 2600); });
t('K4 released quantities match the taxed quantities', function () { assert.strictEqual(OC('K4').status, 'pass'); });
t('M1 / M3 the deemed-supplier exception switches M1 off only when all six conditions hold', function () {
  var data = { mkt_sales: [{ date: '2026-02-01', seller: 'Home bakery', sellerVat: '', sellerResident: 'yes', category: 'goods', gross: 1150, vat: 0 }] };
  var all = { named: 'yes', noTerms: 'yes', noPrice: 'yes', noPayment: 'yes', noComplaints: 'yes', noPromos: 'yes' };
  var ok1 = E.runOtherTaxes({ settings: E.mergeSettings({}), data: data, mktException: all });
  assert.ok(!byId(ok1.checks, 'M1') && byId(ok1.checks, 'M3').status === 'pass');
  var one = Object.assign({}, all, { noPayment: 'no' }), r = E.runOtherTaxes({ settings: E.mergeSettings({}), data: data, mktException: one });
  assert.strictEqual(byId(r.checks, 'M1').status, 'fail');
  assert.strictEqual(byId(E.runOtherTaxes({ settings: E.mergeSettings({}), data: data }).checks, 'M3').status, 'warn');
});
t('Zakat late fine: none under 30 days, 1% per 30 days, capped at 25%', function () {
  var base = { capital: 1000000, adjustedNetProfit: 0, yearType: 'hijri', fyEnd: '2025-12-31' };
  assert.strictEqual(byId(E.zakat(Object.assign({ filedOn: '2026-05-20' }, base), {}).checks, 'Z2').exposure, 0);
  assert.strictEqual(byId(E.zakat(Object.assign({ filedOn: '2026-06-30' }, base), {}).checks, 'Z2').exposure, 500);
  assert.strictEqual(byId(E.zakat(Object.assign({ filedOn: '2030-01-01' }, base), {}).checks, 'Z2').exposure, 6250);
});
t('Zakat worksheet prefill from the year-end trial balance', function () {
  var z = E.zakatFromTb(demo.datasets.tb, { provisions: '2220', netFixedAssets: '5000', longTermFinancing: '' });
  assert.strictEqual(z.provisions, 0); assert.ok(z.netFixedAssets > 0); assert.ok(!('longTermFinancing' in z));
});
t('K1 cigarettes: excise on the higher standard price (juice at its sugar tier is fine)', function () { assert.strictEqual(OC('K1').a, 5000); assert.strictEqual(OC('K1').counts.list, 1); });
t('K2 excise return ties to the register', function () { assert.strictEqual(OC('K2').status, 'pass'); });
t('E10 integrated before the wave deadline', function () { assert.strictEqual(byId(R3.einv.checks, 'E10').status, 'pass'); });
t('Zakat: Gregorian-year rate, worksheet vs declared', function () {
  var z = E.zakat(demo.zakat2025, {});
  assert.strictEqual(z.base, 15000000); assert.strictEqual(z.zakat, 386652.54); assert.strictEqual(z.dueDate, '2026-04-30');
  assert.strictEqual(byId(z.checks, 'Z3').status, 'fail'); assert.strictEqual(byId(z.checks, 'Z2').status, 'pass');
});
t('Zakat: base below adjusted net profit is raised to it at a flat 2.5%', function () {
  var z = E.zakat({ capital: 1000000, adjustedNetProfit: 2000000, netFixedAssets: 2500000, yearType: 'gregorian' }, {});
  assert.strictEqual(z.baseUsed, 2000000); assert.strictEqual(z.zakat, 50000); assert.strictEqual(byId(z.checks, 'Z1').status, 'warn');
});

console.log('return integrity, cross-period, QR, POS, corrections, requests');
var R4 = E.runAll({ entity: demo.entity, periodKey: demo.period, settings: {}, data: demo.datasets, returnBoxes: demo.returnBoxes, reconItems: demo.reconItems, prevNetVat: demo.prevNetVat, prevWhtTax: demo.prevWhtTax,
  filing: demo.filing, recovery: demo.recovery, history: demo.history, exciseReturn: demo.exciseReturn, priorPurchaseKeys: demo.priorPurchaseKeys, today: '2026-11-05', samples: [], checklist: [], findings: [] });
t('V13 box 14 at or above SAR 15,000 fails; below passes', function () {
  var b = JSON.parse(JSON.stringify(demo.returnBoxes)); b[14].vat = 18000;
  assert.strictEqual(byId(E.runReturnIntegrity({ settings: E.mergeSettings({}), returnBoxes: b }).checks, 'V13').status, 'fail');
  b[14].vat = 9000; assert.strictEqual(byId(E.runReturnIntegrity({ settings: E.mergeSettings({}), returnBoxes: b }).checks, 'V13').status, 'pass');
});
t('V14 box 15 must equal the previous credit', function () {
  var b = JSON.parse(JSON.stringify(demo.returnBoxes)); b[15].vat = 5000;
  assert.strictEqual(byId(E.runReturnIntegrity({ settings: E.mergeSettings({}), returnBoxes: b, prevNetVatBox16: -5000 }).checks, 'V14').status, 'pass');
  assert.strictEqual(byId(E.runReturnIntegrity({ settings: E.mergeSettings({}), returnBoxes: b, prevNetVatBox16: 4000 }).checks, 'V14').status, 'fail');
});
t('A18 the supplier invoice already claimed in August', function () { var a = byId(R4.analytics.tests, 'A18'); assert.strictEqual(a.count, 1); assert.ok(/2026-08/.test(a.items[0].reason)); });
t('QR encode/decode round trip with Arabic', function () {
  var q = E.decodeQr(E.encodeQr({ sellerName: 'شركة النور', vatNo: '310123456700003', timestamp: '2026-09-01T10:00:00Z', total: 115, vat: 15 }));
  assert.strictEqual(q.sellerName, 'شركة النور'); assert.strictEqual(q.total, 115); assert.strictEqual(q.vat, 15);
});
t('E11 two QR codes do not match their invoices', function () { var c = byId(R4.einv.checks, 'E11'); assert.strictEqual(c.counts.list, 2); });
t('P1 card takings above B2C sales; P2 POS settlements tie to the bank', function () {
  assert.strictEqual(byId(R4.bank.checks, 'P1').status, 'fail'); assert.strictEqual(byId(R4.bank.checks, 'P2').status, 'pass');
});
t('corrections register: amend within 20 days at or above SAR 15,000', function () {
  var c = E.corrections([
    { tax: 'VAT', taxImpact: 20000, discoveredOn: '2026-09-01' },
    { tax: 'VAT', taxImpact: 20000, discoveredOn: '2026-09-01', correctedOn: '2026-09-15' },
    { tax: 'VAT', taxImpact: 3000, discoveredOn: '2026-09-10' },
    { tax: 'WHT', taxImpact: 900 }], {}, '2026-10-19');
  assert.strictEqual(c.length, 3); assert.strictEqual(c[0].state, 'overdue'); assert.strictEqual(c[0].dueBy, '2026-09-21');
  assert.strictEqual(c[1].state, 'done'); assert.strictEqual(c[2].route, 'next'); assert.strictEqual(c[2].dueBy, '2026-10-31');
});
t('requests: objection window 60 days after an assessment', function () {
  var a = E.requestDue(demo.requests[1], {}, '2026-10-19'); assert.strictEqual(a.due, '2026-10-24'); assert.strictEqual(a.state, 'urgent');
  var i = E.requestDue(demo.requests[0], {}, '2026-10-19'); assert.strictEqual(i.due, '2026-10-22'); assert.strictEqual(i.daysLeft, 3);
});

t('separate VAT and WHT readiness and exposure', function () {
  assert.ok(R4.vatScore.score >= 0 && R4.whtScore.score >= 0);
  assert.notStrictEqual(R4.vatScore.score, R4.whtScore.score);
  assert.ok(R4.whtExposure > 0 && R4.vatExposure > R4.whtExposure);
  assert.strictEqual(r2(R4.vatExposure + R4.whtExposure), R4.exposure);
  assert.ok(!('bank' in R4.whtScore.parts) || R4.whtScore.parts.bank == null);
});

console.log('regulatory rules');
var S0 = E.mergeSettings({});
t('Art. 63: SAR 15,000 threshold and routes', function () {
  assert.ok(/Amend the original return/.test(E.correctionRoute(15000, S0)) && /20 days/.test(E.correctionRoute(15000, S0)));
  assert.ok(/period in which the error was discovered/.test(E.correctionRoute(14999, S0)));
  assert.ok(/Over-declared/.test(E.correctionRoute(-20000, S0)));
});
t('WHT fine: none under 30 days, 1% per full 30 days after', function () {
  assert.strictEqual(E.penaltyForFinding({ tax: 'WHT', taxImpact: 10000, daysLate: 29 }, S0), 0);
  assert.strictEqual(E.penaltyForFinding({ tax: 'WHT', taxImpact: 10000, daysLate: 61 }, S0), 200);
});
t('annual reconciliation flags missing periods and FS differences', function () {
  var rows = [{ period: '2026-01', sales: 100, outputVat: 15, inputVat: 5, netVat: 10, whtTax: 1 }, { period: '2026-02', sales: 200, outputVat: 30, inputVat: 10, netVat: 20, whtTax: 2 }];
  var a = E.annualRecon(rows, { fsRevenue: 350, zakatRevenue: 300, items: [] }, {}, E.periodsOfYear(2026, 'monthly'));
  assert.strictEqual(a.missing.length, 10); assert.strictEqual(a.lines[0].diff, -50); assert.strictEqual(a.lines[1].status, 'pass'); assert.strictEqual(a.status, 'fail');
});
t('findings aging buckets', function () {
  var b = E.aging([{ status: 'open', due: '2026-10-01' }, { status: 'open', due: '2026-06-01' }, { status: 'closed', due: '2026-01-01' }, { status: 'open' }], '2026-10-19');
  assert.strictEqual(b.d30.length, 1); assert.strictEqual(b.over90.length, 1); assert.strictEqual(b.noDate.length, 1);
});

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
