/**
 * Demo data: one trading company with a full month of data and the kind of
 * problems a ZATCA inspection finds, planted on purpose so every check has
 * something to show. Deterministic (seeded), so tests can pin the results.
 *
 * Planted issues (period 2026-09):
 *   - return box 1 understates one invoice (SAR 23,400 net)
 *   - Excel workings box 3 differs from the return
 *   - one sales line with VAT ≠ 15%, two invalid customer TRNs, two numbering gaps
 *   - one export with destination SA
 *   - three supplier invoices without a TRN, one duplicate supplier invoice
 *   - a foreign supplier booked as standard-rated instead of RCM
 *   - three sales invoices never reported to Fatoora, one rejected
 *   - a SAR 85,000 cash deposit with no invoice behind it
 *   - a foreign transfer with no WHT register line
 *   - management fees withheld at 15% instead of 20%; one WHT line paid late,
 *     one without a certificate; the WHT return misses one line
 *   - e-invoicing provider: 2 ERP invoices never sent, a POS sale outside the
 *     ERP, a rejected and a pending invoice, an amount mismatch, a B2C invoice
 *     reported after 30 h and a B2B invoice cleared 3.5 h after issue, a skipped
 *     counter, a credit note with no reference, a simplified invoice to a
 *     VAT-registered customer, one accepted with a warning
 *   - input VAT on a staff dinner, a hotel stay and the GM's car; exempt sales
 *     with no apportionment; SAR 30,000 of gifts against a SAR 4,167 monthly relief
 *   - one export without a customs export declaration (plus the export to SA)
 *   - management fees to the parent with no reverse-charge VAT; a reverse-charged
 *     training service with no WHT line
 *   - WHT filed and paid 2 days late (late, but under 30 days: no fine)
 *   - input VAT about 65% above the average of the last three months
 */
(function (root) {
  'use strict';
  var E = root.ZEngine || (typeof require !== 'undefined' ? require('./engine.js') : null);

  function gen(seed) {
    var R = E.rng(seed || 20260930), r2 = E.r2;
    var pick = function (a) { return a[Math.floor(R() * a.length)]; };
    var amt = function (lo, hi) { return r2(lo + Math.pow(R(), 2.2) * (hi - lo)); };
    var day = function (y, m) { var d = 1 + Math.floor(R() * 30); return y + '-' + ('0' + m).slice(-2) + '-' + ('0' + Math.min(d, 30)).slice(-2); };
    var trn = function () { var s = '3'; for (var i = 0; i < 13; i++) s += Math.floor(R() * 10); return s + '3'; };

    var customers = ['Riyadh Medical Supplies', 'Gulf Retail Group', 'Najd Contracting', 'Eastern Foods Co.', 'Al Madina Hospital', 'Jeddah Logistics', 'Tabuk Agro', 'Qassim Dates Co.', 'Red Sea Hotels', 'Abha Electric'].map(function (n) { return { name: n, trn: trn() }; });
    var suppliers = ['Saudi Paper Mills', 'Al Rajhi Steel', 'National Packaging', 'SAPTCO Fleet', 'Zamil Industries', 'Almarai Wholesale', 'Obeikan Printing', 'Bin Dawood Supply'].map(function (n) { return { name: n, trn: trn() }; });

    var sys = [], no = 10001;
    for (var i = 0; i < 620; i++) {
      var c = pick(customers), cat = R() < 0.86 ? 'S' : R() < 0.5 ? 'Z' : R() < 0.7 ? 'X' : 'E';
      var net = amt(250, 95000), vat = cat === 'S' ? r2(net * 0.15) : 0;
      if (no === 10140 || no === 10388) no += (no === 10140 ? 1 : 2); // numbering gaps
      sys.push({ flow: 'S', invoice: 'INV-' + no++, date: day(2026, 9), party: c.name, vatNo: cat === 'X' ? '' : c.trn, country: cat === 'X' ? pick(['AE', 'BH', 'KW', 'EG', 'JO']) : 'SA', category: cat, docType: 'INV', net: net, vat: vat, total: r2(net + vat) });
    }
    sys[17].vat = r2(sys[17].net * 0.05); sys[17].category = 'S'; sys[17].total = r2(sys[17].net + sys[17].vat);
    sys[40].vatNo = '30012345678'; sys[41].vatNo = '400123456789013';
    var ex = sys.filter(function (x) { return x.category === 'X'; })[0]; ex.country = 'SA';
    for (var k = 0; k < 9; k++) {
      var base = sys[30 + k * 11], cn = r2(base.net * 0.3);
      sys.push({ flow: 'S', invoice: 'CN-' + (501 + k), date: day(2026, 9), party: base.party, vatNo: base.vatNo, country: 'SA', category: base.category, docType: 'CN', net: -cn, vat: base.category === 'S' ? -r2(cn * 0.15) : 0, total: -r2(cn * (base.category === 'S' ? 1.15 : 1)) });
    }
    var big = { flow: 'S', invoice: 'INV-' + no++, date: '2026-09-28', party: 'Red Sea Hotels', vatNo: customers[8].trn, country: 'SA', category: 'S', docType: 'INV', net: 23400, vat: 3510, total: 26910 };
    sys.push(big);

    var pno = 1;
    for (var j = 0; j < 410; j++) {
      var s = pick(suppliers), pc = R() < 0.93 ? 'S' : 'E', pn = amt(120, 60000);
      sys.push({ flow: 'P', invoice: 'SUP-' + (70000 + pno++), date: day(2026, 9), party: s.name, vatNo: s.trn, country: 'SA', category: pc, docType: 'INV', net: pn, vat: pc === 'S' ? r2(pn * 0.15) : 0, total: r2(pn * (pc === 'S' ? 1.15 : 1)) });
    }
    var purch = sys.filter(function (x) { return x.flow === 'P' && x.category === 'S'; });
    purch[3].vatNo = ''; purch[9].vatNo = ''; purch[15].vatNo = '310000000';
    var dup = Object.assign({}, purch[22]); dup.invoice = purch[22].invoice + '-A'; sys.push(dup);
    var imports = [];
    for (var m = 0; m < 10; m++) {
      var iv = amt(8000, 140000);
      var line = { flow: 'P', invoice: 'IMP-' + (900 + m), date: day(2026, 9), party: pick(['Shenzhen Electronics', 'Guangzhou Textile', 'Istanbul Steel', 'Mumbai Spices']), vatNo: '', country: pick(['CN', 'TR', 'IN']), category: 'IMP', docType: 'INV', net: iv, vat: r2(iv * 0.15), total: r2(iv * 1.15) };
      sys.push(line); imports.push(line);
    }
    var rcm = [['Deloitte UK', 'GB', 42000], ['Oracle Corp', 'US', 65500], ['Dubai Design Studio', 'AE', 18000], ['Cairo Software', 'EG', 9500], ['Amman Training', 'JO', 7200]];
    rcm.forEach(function (x, i2) { sys.push({ flow: 'P', invoice: 'RC-' + (i2 + 1), date: day(2026, 9), party: x[0], vatNo: '', country: x[1], category: 'RCM', docType: 'INV', net: x[2], vat: r2(x[2] * 0.15), total: x[2] }); });
    sys.push({ flow: 'P', invoice: 'SG-4471', date: '2026-09-14', party: 'Singapore Cloud Pte', vatNo: '', country: 'SG', category: 'S', docType: 'INV', net: 12000, vat: 1800, total: 13800 });

    var sysBoxes = E.boxesFromSystem(sys);
    // return: box 1 short by the big invoice; credit notes shown as adjustments
    var ret = JSON.parse(JSON.stringify(sysBoxes));
    ret[1].amount = r2(ret[1].amount - 23400); ret[1].vat = r2(ret[1].vat - 3510);
    ret = E.completeBoxes(ret);
    ret[14].vat = 0; ret[15].vat = 0; ret = E.completeBoxes(ret);
    var xls = [];
    for (var b = 1; b <= 11; b++) if (b !== 6) xls.push({ box: b, amount: ret[b].amount, adj: 0, vat: ret[b].vat });
    xls[2].amount = r2(xls[2].amount + 15750); // box 3
    xls[6].vat = r2(xls[6].vat + 0.4);          // box 7, rounding only

    // ledger
    var outVat = sysBoxes[6].vat + sysBoxes[9].vat, inVat = sysBoxes[12].vat;
    var rev = sysBoxes[6].amount;
    var arOpen = 1840000, arClose = 2015500, apOpen = 1210000, apClose = 1176300;
    var tb = [
      { account: '1100', name: 'Bank — SNB current', opening: 2650000, debit: 0, credit: 0, closing: 0 },
      { account: '1200', name: 'Trade receivables', opening: arOpen, debit: 0, credit: 0, closing: arClose },
      { account: '1410', name: 'Input VAT recoverable', opening: 0, debit: r2(inVat), credit: 0, closing: r2(inVat) },
      { account: '2100', name: 'Trade payables', opening: -apOpen, debit: 0, credit: 0, closing: -apClose },
      { account: '2210', name: 'Output VAT', opening: 0, debit: 0, credit: r2(outVat), closing: -r2(outVat) },
      { account: '2220', name: 'VAT payable (settlement)', opening: -412880, debit: 412880, credit: 0, closing: 0 },
      { account: '2230', name: 'WHT payable', opening: -9840, debit: 9840, credit: 0, closing: 0 },
      { account: '4000', name: 'Sales revenue', opening: 0, debit: 0, credit: r2(rev), closing: -r2(rev) },
      { account: '4100', name: 'Other income — scrap & insurance claims', opening: 0, debit: 0, credit: 12000, closing: -12000 },
      { account: '5000', name: 'Cost of sales', opening: 0, debit: r2(sysBoxes[12].amount * 0.8), credit: 0, closing: r2(sysBoxes[12].amount * 0.8) },
      { account: '5300', name: 'Foreign professional services', opening: 0, debit: 160000, credit: 0, closing: 160000 },
      { account: '5400', name: 'Royalties & management fees', opening: 0, debit: 190000, credit: 0, closing: 190000 }
    ];
    tb.forEach(function (x) { x.debit = r2(x.debit); x.credit = r2(x.credit); });
    tb[1].debit = r2(Math.max(0, arClose - arOpen)); tb[3].credit = 0; tb[3].debit = r2(apOpen - apClose);

    // WHT
    var reg = [
      { date: '2026-09-03', party: 'Deloitte UK', country: 'GB', paymentType: 'consulting_services', gross: 42000, rate: 0.05, wht: 2100, dtt: 'no', certificate: 'WC-2609-01', paidDate: '2026-10-08' },
      { date: '2026-09-07', party: 'Oracle Corp', country: 'US', paymentType: 'royalties', gross: 65500, rate: 0.15, wht: 9825, dtt: 'no', certificate: 'WC-2609-02', paidDate: '2026-10-09' },
      { date: '2026-09-11', party: 'Gulf Holding (parent)', country: 'AE', paymentType: 'management_fees', gross: 120000, rate: 0.15, wht: 18000, dtt: 'no', certificate: 'WC-2609-03', paidDate: '2026-10-09' },
      { date: '2026-09-15', party: 'Dubai Design Studio', country: 'AE', paymentType: 'technical_services', gross: 18000, rate: 0.05, wht: 900, dtt: 'no', certificate: '', paidDate: '2026-10-09' },
      { date: '2026-09-20', party: 'Cairo Software', country: 'EG', paymentType: 'technical_services', gross: 9500, rate: 0.05, wht: 475, dtt: 'no', certificate: 'WC-2609-05', paidDate: '2026-11-22' },
      { date: '2026-09-24', party: 'Maersk Line', country: 'DK', paymentType: 'air_tickets_freight', gross: 26000, rate: 0.05, wht: 1300, dtt: 'no', certificate: 'WC-2609-06', paidDate: '2026-10-09' }
    ];
    var types = {};
    reg.forEach(function (x) { types[x.paymentType] = types[x.paymentType] || { paymentType: x.paymentType, amount: 0, rate: x.rate, tax: 0 }; types[x.paymentType].amount += x.gross; types[x.paymentType].tax += x.wht; });
    var retWht = Object.keys(types).map(function (k) { return types[k]; });
    retWht = retWht.map(function (x) { return x.paymentType === 'air_tickets_freight' ? { paymentType: x.paymentType, amount: 0, rate: 0.05, tax: 0 } : x; }).filter(function (x) { return x.amount; });
    var xlsWht = Object.keys(types).map(function (k) { return types[k]; });
    var whtCredits = reg.reduce(function (s, x) { return s + x.wht; }, 0);
    tb[6].credit = r2(whtCredits); tb[6].closing = -r2(whtCredits);

    // bank: customer receipts = sales gross − ΔAR (+ an unexplained cash deposit)
    var bank = [], bal = 2650000;
    function bl(date, desc, ref, debit, credit) { bal = r2(bal - (debit || 0) + (credit || 0)); bank.push({ date: date, description: desc, reference: ref, debit: r2(debit || 0), credit: r2(credit || 0), balance: bal, account: 'SA44 1000 0000 1234 5678 9012' }); }
    var sales = sys.filter(function (x) { return x.flow === 'S' && x.docType === 'INV' && x.invoice !== big.invoice; });
    var targetIn = r2(ret[6].amount + ret[6].vat + 23400 + 3510 - (arClose - arOpen) - sys.filter(function (x) { return x.docType === 'CN'; }).reduce(function (a, x) { return a + x.total; }, 0) * 0);
    var got = 0;
    sales.forEach(function (x, i3) {
      if (got >= targetIn) return;
      var v = Math.min(x.total, r2(targetIn - got));
      if (i3 % 9 === 0) bl(x.date, 'POS mada settlement batch ' + (4400 + i3), 'MADA' + i3, 0, v);
      else bl(x.date, 'Customer transfer ' + x.party + ' ' + x.invoice, 'TRF' + i3, 0, v);
      got = r2(got + v);
    });
    bl('2026-09-21', 'Cash deposit branch 112', 'CSH-0921', 0, 85000);
    // supplier payments + foreign transfers = purchases incl. VAT (excl. RCM VAT) + fall in payables
    var foreignOut = 39900 + 55675 + 102000 + 31000;
    var purTarget = r2(sysBoxes[12].amount + sysBoxes[12].vat - sysBoxes[9].vat + (apOpen - apClose) - foreignOut);
    var paid = 0;
    sys.filter(function (x) { return x.flow === 'P' && x.category !== 'RCM'; }).forEach(function (x, i4) {
      if (paid >= purTarget) return;
      var v = Math.min(x.total, r2(purTarget - paid));
      bl(x.date, 'Payment to supplier ' + x.party, 'PAY' + i4, v, 0); paid = r2(paid + v);
    });
    bl('2026-09-25', 'SADAD 001 ZATCA VAT payment Aug-2026', 'SADAD88123', 412880, 0);
    bl('2026-09-09', 'SADAD ZATCA withholding tax Aug-2026', 'SADAD88001', 9840, 0);
    bl('2026-09-04', 'SWIFT international transfer Deloitte UK', 'SW01', 39900, 0);
    bl('2026-09-08', 'SWIFT international transfer Oracle Corp', 'SW02', 55675, 0);
    bl('2026-09-12', 'SWIFT international transfer Gulf Holding', 'SW03', 102000, 0);
    bl('2026-09-27', 'SWIFT international transfer Lisbon Analytics Lda', 'SW04', 31000, 0);
    bl('2026-09-28', 'Payroll WPS September', 'WPS09', 486000, 0);
    bl('2026-09-29', 'Internal transfer to own account Riyad Bank', 'INT01', 250000, 0);
    bank.sort(function (a, b2) { return a.date < b2.date ? -1 : a.date > b2.date ? 1 : 0; });
    var running = 2650000;
    bank.forEach(function (x) { running = r2(running - x.debit + x.credit); x.balance = running; });
    tb[0].closing = running; tb[0].debit = r2(bank.reduce(function (a, x) { return a + x.credit; }, 0)); tb[0].credit = r2(bank.reduce(function (a, x) { return a + x.debit; }, 0));

    // GL detail for WHT completeness (foreign expense lines)
    var gl = [
      { date: '2026-09-03', account: '5300', doc: 'JV-901', description: 'Consulting — Deloitte UK', debit: 42000, credit: 0, party: 'Deloitte UK', country: 'GB' },
      { date: '2026-09-15', account: '5300', doc: 'JV-915', description: 'Design work', debit: 18000, credit: 0, party: 'Dubai Design Studio', country: 'AE' },
      { date: '2026-09-20', account: '5300', doc: 'JV-920', description: 'Software customisation', debit: 9500, credit: 0, party: 'Cairo Software', country: 'EG' },
      { date: '2026-09-26', account: '5300', doc: 'JV-926', description: 'Data analytics project', debit: 31000, credit: 0, party: 'Lisbon Analytics Lda', country: 'PT' },
      { date: '2026-09-07', account: '5400', doc: 'JV-907', description: 'Licence royalties', debit: 65500, credit: 0, party: 'Oracle Corp', country: 'US' },
      { date: '2026-09-11', account: '5400', doc: 'JV-911', description: 'Group management fee', debit: 120000, credit: 0, party: 'Gulf Holding (parent)', country: 'AE' }
    ];

    // ---- details for the input-VAT, export and e-invoicing checks. No random
    // draws below this line, so every figure above stays as the tests pin it.
    var pdesc = ['Raw materials', 'Packaging materials', 'Spare parts', 'Logistics services', 'Office supplies', 'IT equipment', 'Maintenance services', 'Utilities'], pi = 0;
    sys.forEach(function (x) { if (x.flow === 'P') x.description = x.category === 'RCM' ? 'Professional services' : x.category === 'IMP' ? 'Imported goods' : pdesc[pi++ % pdesc.length]; });
    purch[30].description = 'Staff dinner — restaurant'; purch[31].description = 'Hotel accommodation for visiting directors'; purch[32].description = 'Purchase of Toyota Land Cruiser for the GM';
    var xi = 0;
    sys.forEach(function (x) { if (x.flow === 'S' && x.category === 'X' && x !== ex) { if (xi !== 2) x.exportRef = 'EXP-26-' + (7000 + xi); xi++; } });
    gl.push({ date: '2026-09-17', account: '5600', doc: 'JV-917', description: 'Customer gifts — National Day giveaways', debit: 30000, credit: 0, party: '', country: 'SA' });

    var salesAll = sys.filter(function (x) { return x.flow === 'S'; }), prov = [], ctr = { 'ERP-01': 5000, 'POS-02': 900 };
    salesAll.forEach(function (x, i) {
      if (i === 12 || i === 301) return;
      var egs = x.vatNo ? 'ERP-01' : 'POS-02', type = x.vatNo ? 'standard' : 'simplified';
      ctr[egs] += i === 150 ? 2 : 1;
      var ref = '';
      if (x.docType === 'CN') { var k = +x.invoice.slice(3) - 501; ref = k < 8 ? sys[30 + k * 11].invoice : ''; }
      prov.push({ invoice: x.invoice, type: type, docType: x.docType, issuedAt: x.date + 'T10:00', submittedAt: x.date + (type === 'standard' ? 'T10:02' : 'T11:30'),
        status: type === 'standard' ? 'CLEARED' : 'REPORTED', icv: ctr[egs], egs: egs, uuid: 'u-' + i, buyerVat: x.vatNo || '', ref: ref, net: x.net, vat: x.vat, message: '' });
    });
    prov[40].status = 'REJECTED'; prov[40].message = 'BR-KSA-37: buyer VAT number is not valid';
    prov[90].status = 'PENDING';
    prov[120].vat = r2(prov[120].vat + 150);
    var firstSimp = prov.filter(function (x) { return x.type === 'simplified'; })[0];
    firstSimp.submittedAt = E.datetime(new Date(Date.parse(firstSimp.issuedAt + ':00Z') + 30 * 3600000).toISOString());
    var lateStd = prov.filter(function (x, i) { return x.type === 'standard' && i > 200; })[0]; lateStd.submittedAt = lateStd.issuedAt.slice(0, 11) + '13:30';
    var wrongType = prov.filter(function (x, i) { return x.type === 'standard' && i > 250 && x.docType === 'INV'; })[0]; wrongType.type = 'simplified';
    prov[260].status = 'WARNING'; prov[260].message = 'BR-KSA-F-06: seller address is incomplete';
    prov.push({ invoice: 'POS-88417', type: 'simplified', docType: 'INV', issuedAt: '2026-09-19T21:14', submittedAt: '2026-09-19T21:20', status: 'REPORTED', icv: ++ctr['POS-02'], egs: 'POS-02', uuid: 'u-pos', buyerVat: '', ref: '', net: 4200, vat: 630, message: '' });

    var einv = sys.filter(function (x) { return x.flow === 'S'; }).filter(function (x, i5) { return i5 !== 55 && i5 !== 233 && i5 !== 470; })
      .map(function (x, i6) { return { invoice: x.invoice, date: x.date, uuid: 'uuid-' + i6, status: i6 === 101 ? 'REJECTED' : x.vatNo ? 'CLEARED' : 'REPORTED', net: x.net, vat: x.vat }; });
    var customs = imports.slice(0, 9).map(function (x, i7) { return { declaration: 'BYN-26-' + (40100 + i7), date: x.date, party: x.party, value: x.net, vat: x.vat }; });

    return {
      entity: {
        name: 'Al Noor Trading Co.', nameAr: 'شركة النور التجارية', trn: '310123456700003', cr: '1010987654', vatFreq: 'monthly', whtRegistered: true, erp: 'Oracle NetSuite',
        mapping: { outputVat: '2210', inputVat: '1410', vatPayable: '2220', revenue: '4000,4100', receivables: '1200', payables: '2100', bank: '1100', whtPayable: '2230', foreignExpense: '5300,5400', gifts: '5600' }
      },
      period: '2026-09',
      returnBoxes: ret,
      prevNetVat: 412880,
      prevWhtTax: 9840,
      filing: { vatFiledOn: '2026-10-28', vatPaidOn: '2026-10-29', vatPaidAmount: '', whtFiledOn: '2026-10-12', whtPaidOn: '2026-10-12' },
      recovery: { method: 'none' },
      history: (function () {
        var cur = E.periodFigures(ret);
        return [['2026-08', 1.02, 0.62, 412880], ['2026-07', 0.98, 0.58, 401220], ['2026-06', 1.01, 0.60, 318400]].map(function (h) {
          return { period: h[0], sales: r2(cur.sales * h[1]), inputVat: r2(cur.inputVat * h[2]), outputVat: r2(cur.outputVat * h[1]), zeroShare: cur.zeroShare, netVat: h[3] };
        });
      })(),
      reconItems: [{ check: 'V6', description: 'Other income — scrap sales and insurance claims (out of scope)', amount: 12000 }],
      datasets: { tb: tb, gl: gl, sys_vat: sys, xls_vat: xls, einv: einv, einv_provider: prov, customs: customs, bank: bank, wht_reg: reg, ret_wht: retWht, xls_wht: xlsWht }
    };
  }

  root.ZDemo = { gen: gen };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.ZDemo;
})(typeof window !== 'undefined' ? window : this);
