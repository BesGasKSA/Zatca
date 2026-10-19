/* Performance of the engine on a large month: 20,000 invoices, the same in the
   provider log and Fatoora, 6,000 bank lines, 2,000 WHT payments.
   node tests/perf.js                                                       */
var E = require('../web/engine.js');
var demo = require('../web/demo.js').gen();
function grow(rows, n, mut) { var out = []; for (var i = 0; i < n; i++) { var r = Object.assign({}, rows[i % rows.length]); mut(r, i); out.push(r); } return out; }
var D = demo.datasets, big = {};
Object.keys(D).forEach(function (k) { big[k] = D[k]; });
big.sys_vat = grow(D.sys_vat, 20000, function (r, i) { r.invoice = (r.flow === 'P' ? 'P' : 'S') + '-' + (100000 + i); r.net = Math.round((+r.net || 1000) * (0.5 + (i % 7) / 7) * 100) / 100; r.vat = Math.round(r.net * 0.15 * 100) / 100; });
if (D.einv_provider) big.einv_provider = grow(D.einv_provider, 20000, function (r, i) { r.invoice = 'S-' + (100000 + i); });
if (D.einv) big.einv = grow(D.einv, 20000, function (r, i) { r.invoice = 'S-' + (100000 + i); });
big.bank = grow(D.bank, 6000, function (r, i) { r.reference = 'REF' + i; });
big.wht_reg = grow(D.wht_reg, 2000, function (r, i) { r.party = r.party + ' ' + (i % 300); });
var ctx = { entity: demo.entity, periodKey: demo.period, settings: {}, data: big, returnBoxes: demo.returnBoxes, reconItems: demo.reconItems, prevNetVat: demo.prevNetVat, prevWhtTax: demo.prevWhtTax, filing: demo.filing, today: '2026-10-19' };
var times = [];
for (var i = 0; i < 3; i++) { var t = Date.now(); var R = E.runAll(Object.assign({}, ctx)); times.push(Date.now() - t); }
var t1 = Date.now(), packed = E.packRows(big.sys_vat), packMs = Date.now() - t1, json = JSON.stringify(packed);
var t2 = Date.now(); E.unpackRows(JSON.parse(json)); var unpackMs = Date.now() - t2;
var best = Math.min.apply(null, times);
console.log('runAll on 20,000 invoices: ' + times.join(' / ') + ' ms (best ' + best + ')');
console.log('pack ' + packMs + ' ms, unpack ' + unpackMs + ' ms, stored size ' + Math.round(json.length / 1024) + ' KB (' + Math.ceil(json.length / 45000) + ' sheet chunks)');
console.log('plan: ' + R.plan.actions.length + ' actions; analytics tests: ' + R.analytics.tests.length);
var LIMIT = 4000;
if (best > LIMIT) { console.log('FAIL: slower than ' + LIMIT + ' ms'); process.exitCode = 1; } else console.log('ok: under ' + LIMIT + ' ms');
