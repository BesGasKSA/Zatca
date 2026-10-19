/**
 * Tax Inspection Readiness — the engine.
 * Pure functions only: no DOM, no storage. Runs in the browser and in Node
 * (tests/engine.test.js). Everything the UI shows as a check, a test, a sample
 * or a score is computed here from the normalized datasets of one exercise.
 *
 * Saudi rules encoded here (all overridable from tenant settings, because
 * regulations change — see DEFAULT_SETTINGS):
 *   VAT standard rate 15%; VAT return boxes 1–16 as on the ZATCA portal;
 *   WHT rates per Income Tax Law Art. 68 / Implementing Regs Art. 63;
 *   WHT due by the 10th of the following month; VAT due by the last day of
 *   the month after the period; corrections over SAR 5,000 need an amended
 *   return, smaller ones may go through Box 14 of the next return.
 */
(function (root) {
  'use strict';
  var E = {};

  // ------------------------------------------------------------------ settings
  E.DEFAULT_SETTINGS = {
    vatRate: 0.15,
    tolAbs: 1,            // SAR: a difference this small passes
    tolPct: 0.005,        // up to this share of the base is a warning…
    tolWarnAbs: 1000,     // …but never more than this many SAR; above it a failure
    vatCorrectionThreshold: 5000,
    materiality: 50000,
    benfordMin: 300,
    glBasis: 'movement',  // movement | gross — how TB VAT accounts are read when no GL is given
    settlementKeywords: 'settlement,closing vat,vat closing,تسوية,اقفال الضريبة,إقفال الضريبة',
    bankRules: {
      zatca_vat: 'zatca vat,vat payment,ضريبة القيمة المضافة,sadad 001,هيئة الزكاة والضريبة والجمارك - ضريبة',
      zatca_wht: 'withholding,wht,ضريبة الاستقطاع,استقطاع',
      zakat: 'zakat,زكاة',
      foreign_transfer: 'swift,international transfer,foreign transfer,tt out,telegraphic,حوالة دولية,حوالة خارجية',
      payroll: 'payroll,salary,salaries,wps,رواتب,مسير',
      internal_transfer: 'internal transfer,own account,between accounts,تحويل داخلي,بين حسابات',
      financing: 'loan,murabaha,facility,capital injection,قرض,مرابحة,تمويل',
      customer_receipt: 'pos,mada,customer,receipt,collection,invoice,inv-,تحصيل,عميل,نقاط بيع,مدى',
      supplier_payment: 'supplier,vendor,payment to,purchase,po-,مورد,سداد'
    },
    penalties: {
      vatLatePaymentPctPerMonth: 0.05,   // VAT Law: 5% of unpaid tax per month or part
      vatErrorPct: 0.50,                 // incorrect return: 50% of the difference
      vatLateFilingMinPct: 0.05,
      vatLateFilingMaxPct: 0.25,
      whtLatePctPer30Days: 0.01,         // Income Tax Law Art. 77: 1% per 30 days
      invoiceViolationMax: 50000
    },
    whtRates: {
      rent: 0.05, technical_services: 0.05, consulting_services: 0.05, air_tickets_freight: 0.05,
      intl_telecom: 0.05, dividends: 0.05, loan_returns: 0.05, insurance: 0.05,
      royalties: 0.15, head_office_services: 0.15, management_fees: 0.20, other: 0.15
    },
    weights: { recon: 35, bank: 10, analytics: 15, sampling: 15, checklist: 15, findings: 10 }
  };

  E.WHT_TYPES = [
    ['rent', 'Rent', 'إيجار'],
    ['technical_services', 'Technical services', 'خدمات فنية'],
    ['consulting_services', 'Consulting services', 'خدمات استشارية'],
    ['air_tickets_freight', 'Air tickets / air & sea freight', 'تذاكر طيران وشحن جوي وبحري'],
    ['intl_telecom', 'International telecom', 'اتصالات دولية'],
    ['dividends', 'Dividends', 'أرباح موزعة'],
    ['loan_returns', 'Loan returns / interest', 'عوائد القروض'],
    ['insurance', 'Insurance / re-insurance premiums', 'أقساط التأمين وإعادة التأمين'],
    ['royalties', 'Royalties', 'إتاوات'],
    ['head_office_services', 'Services to head office / related party', 'خدمات للمركز الرئيسي أو طرف مرتبط'],
    ['management_fees', 'Management fees', 'أتعاب إدارة'],
    ['other', 'Other payments', 'مدفوعات أخرى']
  ];

  E.mergeSettings = function (s) {
    var out = JSON.parse(JSON.stringify(E.DEFAULT_SETTINGS));
    if (!s) return out;
    Object.keys(s).forEach(function (k) {
      if (s[k] && typeof s[k] === 'object' && !Array.isArray(s[k]) && out[k] && typeof out[k] === 'object') {
        Object.keys(s[k]).forEach(function (kk) { if (s[k][kk] !== '' && s[k][kk] != null) out[k][kk] = s[k][kk]; });
      } else if (s[k] !== '' && s[k] != null) out[k] = s[k];
    });
    return out;
  };

  // ------------------------------------------------------------------ VAT return boxes
  E.BOXES = [
    { n: 1, side: 'S', en: 'Standard rated sales (15%)', ar: 'المبيعات الخاضعة للنسبة الأساسية', cat: 'S' },
    { n: 2, side: 'S', en: 'Sales to citizens (private health / education)', ar: 'المبيعات للمواطنين (الصحة والتعليم الخاص)', cat: 'SC' },
    { n: 3, side: 'S', en: 'Zero rated domestic sales', ar: 'المبيعات المحلية الخاضعة للنسبة الصفرية', cat: 'Z' },
    { n: 4, side: 'S', en: 'Exports', ar: 'الصادرات', cat: 'X' },
    { n: 5, side: 'S', en: 'Exempt sales', ar: 'المبيعات المعفاة', cat: 'E' },
    { n: 6, side: 'S', en: 'Total sales', ar: 'إجمالي المبيعات', total: true },
    { n: 7, side: 'P', en: 'Standard rated domestic purchases (15%)', ar: 'المشتريات المحلية الخاضعة للنسبة الأساسية', cat: 'S' },
    { n: 8, side: 'P', en: 'Imports subject to VAT paid at customs', ar: 'الاستيرادات الخاضعة للضريبة المدفوعة في الجمارك', cat: 'IMP' },
    { n: 9, side: 'P', en: 'Imports subject to VAT under reverse charge', ar: 'الاستيرادات الخاضعة للضريبة بآلية الاحتساب العكسي', cat: 'RCM' },
    { n: 10, side: 'P', en: 'Zero rated purchases', ar: 'المشتريات الخاضعة للنسبة الصفرية', cat: 'Z' },
    { n: 11, side: 'P', en: 'Exempt purchases', ar: 'المشتريات المعفاة', cat: 'E' },
    { n: 12, side: 'P', en: 'Total purchases', ar: 'إجمالي المشتريات', total: true },
    { n: 13, side: 'T', en: 'Total VAT due for the period', ar: 'إجمالي ضريبة القيمة المضافة المستحقة', vatOnly: true },
    { n: 14, side: 'T', en: 'Corrections from previous periods (±5,000)', ar: 'تصحيحات من الفترات السابقة', vatOnly: true },
    { n: 15, side: 'T', en: 'VAT credit carried forward', ar: 'الرصيد الدائن المرحل', vatOnly: true },
    { n: 16, side: 'T', en: 'Net VAT due (or claimed)', ar: 'صافي الضريبة المستحقة (أو المطالب بها)', vatOnly: true }
  ];

  function emptyBoxes() {
    var b = {};
    for (var i = 1; i <= 16; i++) b[i] = { amount: 0, adj: 0, vat: 0 };
    return b;
  }
  E.emptyBoxes = emptyBoxes;

  // Box 6 / 12 / 13 / 16 are derived. RCM VAT (box 9) is both output and
  // input on the ZATCA form, so it adds to the VAT due side as well.
  E.completeBoxes = function (b, keepEntered) {
    b = b || emptyBoxes();
    for (var i = 1; i <= 16; i++) b[i] = b[i] || { amount: 0, adj: 0, vat: 0 };
    var s = { amount: 0, adj: 0, vat: 0 }, p = { amount: 0, adj: 0, vat: 0 };
    [1, 2, 3, 4, 5].forEach(function (n) { s.amount += +b[n].amount || 0; s.adj += +b[n].adj || 0; s.vat += +b[n].vat || 0; });
    [7, 8, 9, 10, 11].forEach(function (n) { p.amount += +b[n].amount || 0; p.adj += +b[n].adj || 0; p.vat += +b[n].vat || 0; });
    if (!keepEntered || !b[6].amount) b[6] = { amount: r2(s.amount), adj: r2(s.adj), vat: r2(s.vat) };
    if (!keepEntered || !b[12].amount) b[12] = { amount: r2(p.amount), adj: r2(p.adj), vat: r2(p.vat) };
    var due = (+b[6].vat || 0) + (+b[9].vat || 0) - (+b[12].vat || 0);
    if (!keepEntered || !b[13].vat) b[13] = { amount: 0, adj: 0, vat: r2(due) };
    var net = (+b[13].vat || 0) + (+b[14].vat || 0) - (+b[15].vat || 0);
    if (!keepEntered || !b[16].vat) b[16] = { amount: 0, adj: 0, vat: r2(net) };
    return b;
  };

  // ------------------------------------------------------------------ dataset kinds
  // syn: header synonyms (English and Arabic, lower-cased) used by autoMap.
  E.KINDS = {
    tb: {
      en: 'Trial balance', ar: 'ميزان المراجعة', group: 'ledger', required: true,
      fields: [
        { k: 'account', t: 's', req: 1, syn: ['account', 'account code', 'acc', 'gl account', 'account no', 'account number', 'رقم الحساب', 'الحساب', 'كود الحساب'] },
        { k: 'name', t: 's', syn: ['account name', 'name', 'description', 'اسم الحساب', 'البيان'] },
        { k: 'opening', t: 'n', syn: ['opening', 'opening balance', 'beginning balance', 'رصيد افتتاحي', 'الرصيد الافتتاحي'] },
        { k: 'debit', t: 'n', syn: ['debit', 'period debit', 'dr', 'مدين', 'حركة مدين'] },
        { k: 'credit', t: 'n', syn: ['credit', 'period credit', 'cr', 'دائن', 'حركة دائن'] },
        { k: 'closing', t: 'n', syn: ['closing', 'closing balance', 'ending balance', 'balance', 'رصيد ختامي', 'الرصيد الختامي', 'الرصيد'] }
      ]
    },
    gl: {
      en: 'General ledger detail', ar: 'تفاصيل دفتر الأستاذ', group: 'ledger',
      fields: [
        { k: 'date', t: 'd', req: 1, syn: ['date', 'posting date', 'gl date', 'التاريخ', 'تاريخ القيد'] },
        { k: 'account', t: 's', req: 1, syn: ['account', 'account code', 'gl account', 'رقم الحساب', 'الحساب'] },
        { k: 'doc', t: 's', syn: ['document', 'doc', 'doc no', 'voucher', 'journal', 'je', 'reference', 'رقم القيد', 'رقم المستند'] },
        { k: 'description', t: 's', syn: ['description', 'narration', 'memo', 'text', 'البيان', 'الوصف'] },
        { k: 'debit', t: 'n', syn: ['debit', 'dr', 'مدين'] },
        { k: 'credit', t: 'n', syn: ['credit', 'cr', 'دائن'] },
        { k: 'party', t: 's', syn: ['vendor', 'supplier', 'customer', 'party', 'counterparty', 'المورد', 'العميل', 'الطرف'] },
        { k: 'country', t: 's', syn: ['country', 'الدولة'] }
      ]
    },
    sys_vat: {
      en: 'System VAT report (invoice level)', ar: 'تقرير الضريبة من النظام (على مستوى الفاتورة)', group: 'vat', required: true,
      fields: [
        { k: 'flow', t: 's', req: 1, syn: ['flow', 'type', 'sales/purchase', 'transaction type', 'module', 'النوع', 'مبيعات/مشتريات'] },
        { k: 'invoice', t: 's', req: 1, syn: ['invoice', 'invoice no', 'invoice number', 'document no', 'doc no', 'رقم الفاتورة'] },
        { k: 'date', t: 'd', req: 1, syn: ['date', 'invoice date', 'document date', 'تاريخ الفاتورة', 'التاريخ'] },
        { k: 'party', t: 's', syn: ['customer', 'supplier', 'vendor', 'party', 'name', 'customer/supplier', 'العميل', 'المورد', 'اسم العميل', 'اسم المورد'] },
        { k: 'vatNo', t: 's', syn: ['vat no', 'vat number', 'trn', 'tax number', 'vat registration', 'الرقم الضريبي', 'رقم التسجيل الضريبي'] },
        { k: 'country', t: 's', syn: ['country', 'الدولة', 'بلد'] },
        { k: 'category', t: 's', req: 1, syn: ['category', 'tax category', 'vat category', 'tax code', 'vat code', 'فئة الضريبة', 'رمز الضريبة'] },
        { k: 'docType', t: 's', syn: ['doc type', 'document type', 'invoice type', 'نوع المستند'] },
        { k: 'net', t: 'n', req: 1, syn: ['net', 'net amount', 'taxable amount', 'amount excl vat', 'amount', 'المبلغ قبل الضريبة', 'المبلغ الخاضع', 'الصافي'] },
        { k: 'vat', t: 'n', req: 1, syn: ['vat', 'vat amount', 'tax', 'tax amount', 'مبلغ الضريبة', 'الضريبة'] },
        { k: 'total', t: 'n', syn: ['total', 'gross', 'amount incl vat', 'الإجمالي', 'المبلغ شامل الضريبة'] }
      ]
    },
    xls_vat: {
      en: 'Excel workings (VAT by box)', ar: 'أوراق العمل (الضريبة حسب البند)', group: 'vat', boxes: true,
      fields: [
        { k: 'box', t: 'n', req: 1, syn: ['box', 'box no', 'line', 'البند', 'رقم البند'] },
        { k: 'amount', t: 'n', syn: ['amount', 'net', 'المبلغ'] },
        { k: 'adj', t: 'n', syn: ['adjustment', 'adj', 'التعديلات', 'تعديل'] },
        { k: 'vat', t: 'n', syn: ['vat', 'vat amount', 'tax', 'مبلغ الضريبة', 'الضريبة'] }
      ]
    },
    einv: {
      en: 'E-invoicing (Fatoora) report', ar: 'تقرير الفوترة الإلكترونية (فاتورة)', group: 'vat',
      fields: [
        { k: 'invoice', t: 's', req: 1, syn: ['invoice', 'invoice no', 'invoice number', 'رقم الفاتورة'] },
        { k: 'date', t: 'd', syn: ['date', 'issue date', 'التاريخ'] },
        { k: 'uuid', t: 's', syn: ['uuid', 'irn'] },
        { k: 'status', t: 's', syn: ['status', 'clearance status', 'reporting status', 'الحالة'] },
        { k: 'net', t: 'n', syn: ['net', 'taxable amount', 'المبلغ الخاضع'] },
        { k: 'vat', t: 'n', syn: ['vat', 'tax amount', 'الضريبة'] }
      ]
    },
    customs: {
      en: 'Customs declarations (imports)', ar: 'البيانات الجمركية (الواردات)', group: 'vat',
      fields: [
        { k: 'declaration', t: 's', req: 1, syn: ['declaration', 'declaration no', 'bayan', 'رقم البيان', 'البيان الجمركي'] },
        { k: 'date', t: 'd', syn: ['date', 'التاريخ'] },
        { k: 'party', t: 's', syn: ['supplier', 'exporter', 'المورد'] },
        { k: 'value', t: 'n', syn: ['value', 'customs value', 'cif', 'القيمة', 'القيمة الجمركية'] },
        { k: 'vat', t: 'n', req: 1, syn: ['vat', 'vat paid', 'import vat', 'الضريبة', 'ضريبة القيمة المضافة'] }
      ]
    },
    bank: {
      en: 'Bank statements', ar: 'كشوف الحسابات البنكية', group: 'bank', required: true,
      fields: [
        { k: 'date', t: 'd', req: 1, syn: ['date', 'value date', 'transaction date', 'posting date', 'التاريخ', 'تاريخ العملية'] },
        { k: 'description', t: 's', req: 1, syn: ['description', 'narrative', 'details', 'narration', 'transaction details', 'البيان', 'الوصف', 'التفاصيل'] },
        { k: 'reference', t: 's', syn: ['reference', 'ref', 'cheque', 'المرجع', 'رقم المرجع'] },
        { k: 'debit', t: 'n', syn: ['debit', 'withdrawal', 'withdrawals', 'out', 'money out', 'مدين', 'سحب', 'مسحوبات'] },
        { k: 'credit', t: 'n', syn: ['credit', 'deposit', 'deposits', 'in', 'money in', 'دائن', 'إيداع', 'ايداعات'] },
        { k: 'balance', t: 'n', syn: ['balance', 'running balance', 'الرصيد'] },
        { k: 'account', t: 's', syn: ['account', 'bank account', 'iban', 'الحساب', 'رقم الحساب'] }
      ]
    },
    wht_reg: {
      en: 'WHT payments register', ar: 'سجل مدفوعات ضريبة الاستقطاع', group: 'wht', required: true,
      fields: [
        { k: 'date', t: 'd', req: 1, syn: ['date', 'payment date', 'تاريخ الدفع', 'التاريخ'] },
        { k: 'party', t: 's', req: 1, syn: ['vendor', 'beneficiary', 'payee', 'non-resident', 'المستفيد', 'المورد'] },
        { k: 'country', t: 's', syn: ['country', 'residence', 'الدولة', 'بلد الإقامة'] },
        { k: 'paymentType', t: 's', req: 1, syn: ['payment type', 'type', 'nature', 'service type', 'نوع الدفعة', 'طبيعة الدفعة'] },
        { k: 'gross', t: 'n', req: 1, syn: ['gross', 'amount', 'gross amount', 'amount paid', 'المبلغ', 'المبلغ المدفوع'] },
        { k: 'rate', t: 'n', syn: ['rate', 'wht rate', 'النسبة', 'نسبة الاستقطاع'] },
        { k: 'wht', t: 'n', req: 1, syn: ['wht', 'tax', 'wht amount', 'withholding tax', 'ضريبة الاستقطاع', 'مبلغ الضريبة'] },
        { k: 'dtt', t: 's', syn: ['dtt', 'treaty', 'treaty applied', 'اتفاقية', 'اتفاقية ازدواج'] },
        { k: 'certificate', t: 's', syn: ['certificate', 'certificate no', 'شهادة', 'رقم الشهادة'] },
        { k: 'paidDate', t: 'd', syn: ['paid to zatca', 'remittance date', 'zatca payment date', 'تاريخ السداد للهيئة'] }
      ]
    },
    ret_wht: {
      en: 'WHT return as filed', ar: 'إقرار ضريبة الاستقطاع المقدم', group: 'wht', required: true,
      fields: [
        { k: 'paymentType', t: 's', req: 1, syn: ['payment type', 'type', 'nature', 'نوع الدفعة'] },
        { k: 'amount', t: 'n', req: 1, syn: ['amount', 'amount paid', 'gross', 'المبلغ'] },
        { k: 'rate', t: 'n', syn: ['rate', 'النسبة'] },
        { k: 'tax', t: 'n', req: 1, syn: ['tax', 'wht', 'tax amount', 'الضريبة', 'مبلغ الضريبة'] }
      ]
    },
    xls_wht: {
      en: 'Excel workings (WHT)', ar: 'أوراق العمل (الاستقطاع)', group: 'wht',
      fields: [
        { k: 'paymentType', t: 's', req: 1, syn: ['payment type', 'type', 'nature', 'نوع الدفعة'] },
        { k: 'amount', t: 'n', req: 1, syn: ['amount', 'gross', 'المبلغ'] },
        { k: 'rate', t: 'n', syn: ['rate', 'النسبة'] },
        { k: 'tax', t: 'n', req: 1, syn: ['tax', 'wht', 'الضريبة'] }
      ]
    }
  };

  // ------------------------------------------------------------------ normalizers
  function r2(x) { return Math.round((+x || 0) * 100) / 100; }
  E.r2 = r2;

  var AR_DIGITS = /[٠-٩۰-۹]/g;
  function deArabic(s) {
    return String(s).replace(AR_DIGITS, function (c) {
      var code = c.charCodeAt(0);
      return String(code >= 0x06F0 ? code - 0x06F0 : code - 0x0660);
    }).replace(/٫/g, '.').replace(/٬/g, ',');
  }

  E.num = function (v) {
    if (v == null || v === '') return 0;
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    var s = deArabic(v).trim();
    var neg = /^\(.*\)$/.test(s) || /-$/.test(s) || /^-/.test(s);
    s = s.replace(/[^\d.,]/g, '');
    if (s.indexOf(',') >= 0 && s.indexOf('.') >= 0) s = s.replace(/,/g, '');
    else if (/,\d{1,2}$/.test(s) && s.split(',').length === 2 && s.indexOf('.') < 0 && !/,\d{3}$/.test(s)) s = s.replace(',', '.');
    else s = s.replace(/,/g, '');
    var n = parseFloat(s);
    if (!isFinite(n)) return 0;
    return neg ? -n : n;
  };

  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function iso(y, m, d) { return y + '-' + pad(m) + '-' + pad(d); }

  // Returns 'YYYY-MM-DD' or '' — Saudi files are day-first, so 03/04/2026 is 3 April.
  E.date = function (v) {
    if (v == null || v === '') return '';
    if (v instanceof Date && !isNaN(v)) return iso(v.getFullYear(), v.getMonth() + 1, v.getDate());
    if (typeof v === 'number' && v > 20000 && v < 80000) {
      var d = new Date(Math.round((v - 25569) * 86400000));
      return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
    }
    var s = deArabic(v).trim(), m;
    if ((m = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/))) return iso(+m[1], +m[2], +m[3]);
    if ((m = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})/))) {
      var a = +m[1], b = +m[2], y = +m[3];
      if (y < 100) y += 2000;
      if (a > 12) return iso(y, b, a);
      if (b > 12) return iso(y, a, b);
      return iso(y, b, a);
    }
    var MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
    if ((m = s.match(/^(\d{1,2})[\s-]([A-Za-z]{3})[A-Za-z]*[\s-](\d{2,4})/))) {
      var mo = MON[m[2].toLowerCase()];
      if (mo) return iso(+m[3] < 100 ? 2000 + +m[3] : +m[3], mo, +m[1]);
    }
    return '';
  };

  E.str = function (v) { return v == null ? '' : deArabic(v).trim(); };

  // TRN: 15 digits, first and last digit 3.
  E.validVatNo = function (v) { return /^3\d{13}3$/.test(String(v || '').replace(/\s/g, '')); };

  E.flow = function (v) {
    var s = String(v || '').toLowerCase().trim();
    if (/^(p|purchase|purchases|ap|buy|input|مشتريات|مشتري|شراء|مدخلات)/.test(s)) return 'P';
    if (/^(s|sale|sales|ar|output|مبيعات|بيع|مخرجات)/.test(s)) return 'S';
    return '';
  };

  // Maps whatever tax code the ERP uses onto the ZATCA categories.
  E.category = function (v, flow) {
    var s = String(v || '').toLowerCase().replace(/\s+/g, ' ').trim();
    if (!s) return '';
    if (/rcm|reverse|عكسي/.test(s)) return 'RCM';
    if (/import|customs|استيراد|جمارك|imp/.test(s)) return flow === 'P' ? 'IMP' : 'X';
    if (/export|صادر|^x$/.test(s)) return 'X';
    if (/citizen|health|education|مواطن|صحة|تعليم|^sc$/.test(s)) return 'SC';
    if (/exempt|معف|^e$/.test(s)) return 'E';
    if (/out of scope|outside|خارج|^o$|^oos$/.test(s)) return 'O';
    if (/zero|صفر|^z$|^0%?$/.test(s)) return 'Z';
    if (/standard|15|اساس|أساس|^s$|^sr$|^std$/.test(s)) return 'S';
    return s.toUpperCase();
  };

  E.docType = function (v) {
    var s = String(v || '').toLowerCase();
    if (/credit|cn|اشعار دائن|إشعار دائن|مرتجع|return/.test(s)) return 'CN';
    if (/debit|dn|اشعار مدين|إشعار مدين/.test(s)) return 'DN';
    return 'INV';
  };

  E.whtType = function (v) {
    var s = String(v || '').toLowerCase();
    if (!s) return 'other';
    for (var i = 0; i < E.WHT_TYPES.length; i++) if (s === E.WHT_TYPES[i][0]) return s;
    if (/manag|إدار|ادار/.test(s)) return 'management_fees';
    if (/royalt|إتاو|اتاو|licen/.test(s)) return 'royalties';
    if (/head office|related|مركز|مرتبط/.test(s)) return 'head_office_services';
    if (/rent|lease|إيجار|ايجار/.test(s)) return 'rent';
    if (/consult|استشار/.test(s)) return 'consulting_services';
    if (/techn|فني/.test(s)) return 'technical_services';
    if (/ticket|freight|shipping|تذاكر|شحن/.test(s)) return 'air_tickets_freight';
    if (/telecom|اتصال/.test(s)) return 'intl_telecom';
    if (/dividend|أرباح|ارباح/.test(s)) return 'dividends';
    if (/loan|interest|قرض|عوائد|فوائد/.test(s)) return 'loan_returns';
    if (/insur|تأمين|تامين/.test(s)) return 'insurance';
    return 'other';
  };

  function normHeader(h) { return String(h == null ? '' : h).toLowerCase().replace(/[_\-:]+/g, ' ').replace(/\s+/g, ' ').trim(); }

  E.autoMap = function (headers, kind) {
    var def = E.KINDS[kind], map = {}, used = {};
    var H = headers.map(normHeader);
    def.fields.forEach(function (f) {
      var best = -1, bestScore = 0;
      H.forEach(function (h, i) {
        if (used[i] || !h) return;
        var sc = 0;
        if (h === f.k.toLowerCase()) sc = 100;
        f.syn.forEach(function (s, si) {
          if (h === s) sc = Math.max(sc, 90 - si);
          else if (h.indexOf(s) >= 0 && s.length >= 3) sc = Math.max(sc, 40 + s.length - si);
        });
        if (sc > bestScore) { bestScore = sc; best = i; }
      });
      if (best >= 0) { map[f.k] = best; used[best] = 1; }
    });
    return map;
  };

  // The header row is the first of the top 15 rows that names the most fields.
  E.detectHeader = function (aoa, kind) {
    var best = { row: 0, hits: -1, map: {} };
    for (var r = 0; r < Math.min(15, aoa.length); r++) {
      var row = aoa[r] || [];
      var map = E.autoMap(row, kind);
      var hits = Object.keys(map).length;
      if (hits > best.hits) best = { row: r, hits: hits, map: map };
    }
    return best;
  };

  E.normalizeRows = function (aoa, headerRow, map, kind) {
    var def = E.KINDS[kind], rows = [], errors = [];
    for (var r = headerRow + 1; r < aoa.length; r++) {
      var src = aoa[r] || [];
      if (!src.some(function (c) { return c !== '' && c != null; })) continue;
      var o = {}, bad = [];
      def.fields.forEach(function (f) {
        var v = map[f.k] == null || map[f.k] === '' ? '' : src[map[f.k]];
        if (f.t === 'n') o[f.k] = r2(E.num(v));
        else if (f.t === 'd') { o[f.k] = E.date(v); if (f.req && !o[f.k]) bad.push(f.k); }
        else { o[f.k] = E.str(v); if (f.req && !o[f.k]) bad.push(f.k); }
      });
      // a total row ("Total", "الإجمالي") is not a record
      var firstText = String(src.find(function (c) { return typeof c === 'string' && c.trim(); }) || '').toLowerCase();
      if (/^(grand )?total|^الإجمالي|^الاجمالي|^المجموع/.test(firstText)) continue;
      if (kind === 'sys_vat') {
        o.flow = E.flow(o.flow);
        if (!o.flow) bad.push('flow');
        o.category = E.category(o.category, o.flow);
        o.docType = E.docType(o.docType);
        if (o.docType === 'CN' && o.net > 0) { o.net = -o.net; o.vat = -Math.abs(o.vat); }
        if (!o.total) o.total = r2(o.net + o.vat);
      }
      if (kind === 'wht_reg' || kind === 'ret_wht' || kind === 'xls_wht') {
        o.paymentType = E.whtType(o.paymentType);
        if (o.rate > 1) o.rate = o.rate / 100;
      }
      if (kind === 'bank') { o.debit = Math.abs(o.debit); o.credit = Math.abs(o.credit); }
      if (bad.length) errors.push({ row: r + 1, fields: bad });
      o._r = r + 1;
      rows.push(o);
    }
    return { rows: rows, errors: errors };
  };

  E.boxesFromRows = function (rows) {
    var b = emptyBoxes();
    (rows || []).forEach(function (x) {
      var n = Math.round(+x.box);
      if (n >= 1 && n <= 16) { b[n].amount += +x.amount || 0; b[n].adj += +x.adj || 0; b[n].vat += +x.vat || 0; }
    });
    return E.completeBoxes(b, true);
  };

  // ------------------------------------------------------------------ periods
  // Period keys: 'YYYY-MM' for months, 'YYYY-Qn' for quarters.
  E.periodRange = function (key) {
    var m = String(key).match(/^(\d{4})-(\d{2})$/), q = String(key).match(/^(\d{4})-Q([1-4])$/);
    var y, m1, m2;
    if (m) { y = +m[1]; m1 = m2 = +m[2]; }
    else if (q) { y = +q[1]; m1 = (+q[2] - 1) * 3 + 1; m2 = m1 + 2; }
    else return null;
    var last = new Date(Date.UTC(y, m2, 0)).getUTCDate();
    return { start: iso(y, m1, 1), end: iso(y, m2, last), y: y, m1: m1, m2: m2 };
  };

  E.prevPeriod = function (key) {
    var m = String(key).match(/^(\d{4})-(\d{2})$/), q = String(key).match(/^(\d{4})-Q([1-4])$/);
    if (m) { var y = +m[1], mo = +m[2] - 1; if (!mo) { y--; mo = 12; } return y + '-' + pad(mo); }
    if (q) { var yy = +q[1], qq = +q[2] - 1; if (!qq) { yy--; qq = 4; } return yy + '-Q' + qq; }
    return '';
  };

  E.periodOf = function (dateIso, freq) {
    var y = dateIso.slice(0, 4), mo = +dateIso.slice(5, 7);
    return freq === 'quarterly' ? y + '-Q' + Math.ceil(mo / 3) : y + '-' + pad(mo);
  };

  E.recentPeriods = function (freq, n, todayIso) {
    var out = [], k = E.periodOf(todayIso || new Date().toISOString().slice(0, 10), freq);
    for (var i = 0; i < n; i++) { k = E.prevPeriod(k); out.push(k); }
    return out;
  };

  function addDays(isoD, n) { var d = new Date(isoD + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function daysBetween(a, b) { return Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000); }
  E.daysBetween = daysBetween;

  // VAT: last day of the month after the period. WHT: 10th of the month after each month.
  E.deadlines = function (periodKey) {
    var r = E.periodRange(periodKey);
    if (!r) return {};
    var vatDue = new Date(Date.UTC(r.y, r.m2 + 1, 0)).toISOString().slice(0, 10);
    var whtDue = new Date(Date.UTC(r.y, r.m2, 10)).toISOString().slice(0, 10);
    return { vat: vatDue, wht: whtDue };
  };

  // ------------------------------------------------------------------ ledger helpers
  function patterns(list) {
    return String(list || '').split(/[,;\s]+/).filter(Boolean).map(function (p) {
      p = p.trim();
      if (p.slice(-1) === '*') { var pre = p.slice(0, -1); return function (a) { return String(a).indexOf(pre) === 0; }; }
      if (p.indexOf('-') > 0) { var ab = p.split('-'); return function (a) { return String(a) >= ab[0] && String(a) <= ab[1] && String(a).length === ab[0].length; }; }
      return function (a) { return String(a) === p; };
    });
  }
  function matches(acc, pats) { for (var i = 0; i < pats.length; i++) if (pats[i](acc)) return true; return false; }
  E.accountMatcher = function (list) { var p = patterns(list); return function (a) { return matches(a, p); }; };

  // Debit-positive movement for the mapped accounts.
  E.tbMovement = function (tb, list, basis, side) {
    var pats = patterns(list);
    if (!pats.length || !tb || !tb.length) return null;
    var tot = 0, found = false;
    tb.forEach(function (r) {
      if (!matches(r.account, pats)) return;
      found = true;
      var hasDC = (+r.debit || 0) !== 0 || (+r.credit || 0) !== 0;
      if (basis === 'gross' && hasDC) tot += side === 'credit' ? -(+r.credit || 0) : (+r.debit || 0);
      else if (hasDC) tot += (+r.debit || 0) - (+r.credit || 0);
      else tot += (+r.closing || 0) - (+r.opening || 0);
    });
    return found ? r2(tot) : null;
  };

  E.tbBalance = function (tb, list, which) {
    var pats = patterns(list);
    if (!pats.length || !tb || !tb.length) return null;
    var tot = 0, found = false;
    tb.forEach(function (r) {
      if (!matches(r.account, pats)) return;
      found = true;
      var v = which === 'opening' ? +r.opening || 0 : (r.closing !== 0 || (!r.debit && !r.credit) ? +r.closing || 0 : (+r.opening || 0) + (+r.debit || 0) - (+r.credit || 0));
      tot += v;
    });
    return found ? r2(tot) : null;
  };

  // From GL detail, leaving out the month-end settlement journal that moves
  // output and input VAT into the payable account.
  E.glMovement = function (gl, list, settlementKeywords) {
    var pats = patterns(list);
    if (!pats.length || !gl || !gl.length) return null;
    var keys = String(settlementKeywords || '').toLowerCase().split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    var tot = 0, found = false, excluded = 0;
    gl.forEach(function (r) {
      if (!matches(r.account, pats)) return;
      found = true;
      var d = String(r.description || '').toLowerCase();
      if (keys.some(function (k) { return d.indexOf(k) >= 0; })) { excluded += (+r.debit || 0) - (+r.credit || 0); return; }
      tot += (+r.debit || 0) - (+r.credit || 0);
    });
    return found ? { value: r2(tot), excluded: r2(excluded) } : null;
  };

  // ------------------------------------------------------------------ check helpers
  function status(diff, base, S) {
    var d = Math.abs(diff);
    if (d <= S.tolAbs) return 'pass';
    if (d <= Math.min(Math.abs(base || 0) * S.tolPct, S.tolWarnAbs == null ? Infinity : S.tolWarnAbs)) return 'warn';
    return 'fail';
  }
  E.status = status;
  var RANK = { na: 0, pass: 1, warn: 2, fail: 3 };
  function worst(list) { return list.reduce(function (w, s) { return RANK[s] > RANK[w] ? s : w; }, 'pass'); }
  E.worst = worst;

  function check(id, group, title, titleAr, a, aLabel, b, bLabel, S, extra) {
    var c = { id: id, group: group, title: title, titleAr: titleAr, aLabel: aLabel, bLabel: bLabel };
    if (a == null || b == null) { c.status = 'na'; c.a = a; c.b = b; c.diff = null; c.missing = a == null ? aLabel : bLabel; }
    else { c.a = r2(a); c.b = r2(b); c.diff = r2(a - b); c.status = status(c.diff, Math.max(Math.abs(a), Math.abs(b)), S); }
    if (extra) Object.keys(extra).forEach(function (k) { c[k] = extra[k]; });
    return c;
  }

  // ------------------------------------------------------------------ VAT reconciliation
  E.boxesFromSystem = function (rows) {
    var b = emptyBoxes();
    var catBox = { S: { S: 1, SC: 2, Z: 3, X: 4, E: 5 }, P: { S: 7, IMP: 8, RCM: 9, Z: 10, E: 11 } };
    (rows || []).forEach(function (x) {
      var n = (catBox[x.flow] || {})[x.category];
      if (!n) return;
      b[n].amount += +x.net || 0;
      b[n].vat += +x.vat || 0;
    });
    for (var i = 1; i <= 12; i++) { b[i].amount = r2(b[i].amount); b[i].vat = r2(b[i].vat); }
    return E.completeBoxes(b);
  };

  function boxCompare(id, title, titleAr, A, aLabel, B, bLabel, S, useAdjA, useAdjB) {
    var lines = [];
    E.BOXES.forEach(function (bx) {
      if (bx.n > 13) return;
      var a = A[bx.n], b = B[bx.n];
      var aAmt = (+a.amount || 0) + (useAdjA ? +a.adj || 0 : 0), bAmt = (+b.amount || 0) + (useAdjB ? +b.adj || 0 : 0);
      var l = { box: bx.n, aAmount: r2(aAmt), bAmount: r2(bAmt), aVat: r2(a.vat), bVat: r2(b.vat) };
      l.dAmount = r2(l.aAmount - l.bAmount); l.dVat = r2(l.aVat - l.bVat);
      l.status = bx.vatOnly ? status(l.dVat, Math.max(Math.abs(l.aVat), Math.abs(l.bVat)), S)
        : worst([status(l.dAmount, Math.max(Math.abs(l.aAmount), Math.abs(l.bAmount)), S), status(l.dVat, Math.max(Math.abs(l.aVat), Math.abs(l.bVat)), S)]);
      lines.push(l);
    });
    var due = lines.filter(function (l) { return l.box === 13; })[0];
    return {
      id: id, group: 'vat', title: title, titleAr: titleAr, aLabel: aLabel, bLabel: bLabel, kind: 'boxes', lines: lines,
      status: worst(lines.map(function (l) { return l.status; })),
      a: due.aVat, b: due.bVat, diff: due.dVat
    };
  }

  E.runVatRecon = function (ctx) {
    var S = ctx.settings, D = ctx.data, map = (ctx.entity && ctx.entity.mapping) || {}, checks = [];
    var ret = ctx.returnBoxes ? E.completeBoxes(JSON.parse(JSON.stringify(ctx.returnBoxes)), true) : null;
    var sys = D.sys_vat && D.sys_vat.length ? E.boxesFromSystem(D.sys_vat) : null;
    var xls = D.xls_vat && D.xls_vat.length ? E.boxesFromRows(D.xls_vat) : null;
    var na = function (id, title, titleAr, miss) { return { id: id, group: 'vat', title: title, titleAr: titleAr, status: 'na', missing: miss }; };

    checks.push(ret && sys ? boxCompare('V1', 'VAT return vs system tax report', 'الإقرار مقابل تقرير الضريبة من النظام', ret, 'Return', sys, 'System', S, true, false)
      : na('V1', 'VAT return vs system tax report', 'الإقرار مقابل تقرير الضريبة من النظام', !ret ? 'VAT return' : 'System VAT report'));
    checks.push(ret && xls ? boxCompare('V2', 'VAT return vs Excel workings', 'الإقرار مقابل أوراق العمل', ret, 'Return', xls, 'Excel', S, true, true)
      : na('V2', 'VAT return vs Excel workings', 'الإقرار مقابل أوراق العمل', !ret ? 'VAT return' : 'Excel workings'));
    checks.push(sys && xls ? boxCompare('V3', 'System tax report vs Excel workings', 'تقرير النظام مقابل أوراق العمل', sys, 'System', xls, 'Excel', S, false, true)
      : na('V3', 'System tax report vs Excel workings', 'تقرير النظام مقابل أوراق العمل', !sys ? 'System VAT report' : 'Excel workings'));

    // Ledger side: GL detail if mapped accounts appear there, otherwise TB.
    function ledger(list, side) {
      var g = E.glMovement(D.gl, list, S.settlementKeywords);
      if (g) return { v: g.value, src: 'GL (settlement excluded: ' + g.excluded + ')' };
      var t = E.tbMovement(D.tb, list, S.glBasis, side);
      return t == null ? null : { v: t, src: 'TB (' + S.glBasis + ')' };
    }
    var outL = ledger(map.outputVat, 'credit'), inL = ledger(map.inputVat, 'debit');
    var rcmOut = map.rcmOutput ? ledger(map.rcmOutput, 'credit') : null;
    var retOut = ret ? (+ret[6].vat || 0) + (map.rcmOutput ? 0 : (+ret[9].vat || 0)) : null;
    checks.push(check('V4', 'vat', 'Output VAT: return vs general ledger', 'ضريبة المخرجات: الإقرار مقابل الأستاذ العام',
      retOut, 'Return (box 6' + (map.rcmOutput ? '' : ' + box 9') + ' VAT)', outL ? -outL.v : null, 'GL output VAT', S, { source: outL && outL.src, missingHint: map.outputVat ? '' : 'Map output VAT accounts on the entity' }));
    if (map.rcmOutput) checks.push(check('V4b', 'vat', 'Reverse-charge VAT: return box 9 vs GL', 'الاحتساب العكسي: البند 9 مقابل الأستاذ', ret ? ret[9].vat : null, 'Return box 9 VAT', rcmOut ? -rcmOut.v : null, 'GL RCM output', S));
    checks.push(check('V5', 'vat', 'Input VAT: return vs general ledger', 'ضريبة المدخلات: الإقرار مقابل الأستاذ العام',
      ret ? ret[12].vat : null, 'Return (box 12 VAT)', inL ? inL.v : null, 'GL input VAT', S, { source: inL && inL.src, missingHint: map.inputVat ? '' : 'Map input VAT accounts on the entity' }));

    // Revenue: TB revenue vs total sales, with explained reconciling items.
    var rev = E.tbMovement(D.tb, map.revenue, 'movement');
    var items = (ctx.reconItems || []).filter(function (i) { return i.check === 'V6'; });
    var explained = items.reduce(function (s, i) { return s + (+i.amount || 0); }, 0);
    var c6 = check('V6', 'vat', 'Revenue per TB vs total sales declared (box 6)', 'الإيرادات حسب الميزان مقابل إجمالي المبيعات (البند 6)',
      rev == null ? null : -rev - explained, 'TB revenue less explained items', ret ? (+ret[6].amount || 0) + (+ret[6].adj || 0) : null, 'Return box 6', S,
      { explained: r2(explained), tbRevenue: rev == null ? null : r2(-rev), items: items, missingHint: map.revenue ? '' : 'Map revenue accounts on the entity' });
    checks.push(c6);

    // Net VAT payable vs the payable account balance at period end.
    // Net VAT due vs the net of every VAT account at period end — works whether
    // or not a settlement journal moved the balances into the payable account.
    if (map.vatPayable || (map.outputVat && map.inputVat)) {
      var vatAccts = [map.outputVat, map.inputVat, map.rcmOutput, map.vatPayable].filter(Boolean).join(',');
      var bal = E.tbBalance(D.tb, vatAccts, 'closing'), open = E.tbBalance(D.tb, map.vatPayable, 'opening');
      // last period's liability still unpaid at the start of this one is not this period's VAT
      var paidPrev = ctx.prevNetVat != null && open != null ? Math.min(Math.max(-open, 0), Math.max(ctx.prevNetVat, 0)) : 0;
      var unpaidPrev = open != null ? Math.max(-open, 0) - paidPrev : 0;
      checks.push(check('V7', 'vat', 'Net VAT due (box 16) vs net VAT liability in GL', 'صافي الضريبة (البند 16) مقابل صافي التزام الضريبة في الأستاذ',
        ret ? ret[16].vat : null, 'Return box 16', bal == null ? null : -bal - unpaidPrev, 'GL VAT accounts (closing, net)', S));
    }
    if (D.customs && D.customs.length) {
      var cv = D.customs.reduce(function (s, x) { return s + (+x.vat || 0); }, 0);
      checks.push(check('V8', 'vat', 'Import VAT: return box 8 vs customs declarations', 'ضريبة الاستيراد: البند 8 مقابل البيانات الجمركية', ret ? ret[8].vat : null, 'Return box 8 VAT', cv, 'Customs declarations', S));
    }
    if (D.einv && D.einv.length && D.sys_vat) checks.push(einvCheck(D, S));
    return { checks: checks, boxes: { ret: ret, sys: sys, xls: xls }, ledger: { output: outL, input: inL, revenue: rev == null ? null : -rev } };
  };

  function einvCheck(D, S) {
    var sales = D.sys_vat.filter(function (x) { return x.flow === 'S'; });
    var byNo = {}, fat = {};
    sales.forEach(function (x) { byNo[x.invoice] = x; });
    D.einv.forEach(function (x) { fat[x.invoice] = x; });
    var notReported = sales.filter(function (x) { return !fat[x.invoice]; });
    var notInSystem = D.einv.filter(function (x) { return !byNo[x.invoice]; });
    var rejected = D.einv.filter(function (x) { return /reject|رفض|مرفوض/i.test(x.status); });
    var mismatch = D.einv.filter(function (x) { var s = byNo[x.invoice]; return s && Math.abs((+s.vat || 0) - (+x.vat || 0)) > S.tolAbs; });
    var sysVat = sales.reduce(function (s, x) { return s + (+x.vat || 0); }, 0);
    var fatVat = D.einv.reduce(function (s, x) { return s + (+x.vat || 0); }, 0);
    var c = check('V9', 'vat', 'E-invoicing (Fatoora) vs system sales', 'الفوترة الإلكترونية مقابل مبيعات النظام', sysVat, 'System sales VAT', fatVat, 'Fatoora VAT', S);
    c.exceptions = { notReported: notReported.slice(0, 300), notInSystem: notInSystem.slice(0, 300), rejected: rejected.slice(0, 300), mismatch: mismatch.slice(0, 300) };
    c.counts = { notReported: notReported.length, notInSystem: notInSystem.length, rejected: rejected.length, mismatch: mismatch.length };
    if (notReported.length || rejected.length || notInSystem.length) c.status = worst([c.status, 'fail']);
    return c;
  }

  // ------------------------------------------------------------------ bank reconciliation
  // Each bank line gets a class from keyword rules (tenant-editable), unless a
  // person set it by hand (overrides keyed by line number). Then receipts are
  // compared with sales, payments with purchases, ZATCA payments with the
  // prior returns, and foreign transfers with the WHT register.
  E.BANK_CLASSES = ['customer_receipt', 'supplier_payment', 'zatca_vat', 'zatca_wht', 'zakat', 'foreign_transfer', 'payroll', 'internal_transfer', 'financing', 'other_in', 'other_out'];

  E.classifyBank = function (rows, S, overrides) {
    var rules = {};
    Object.keys(S.bankRules || {}).forEach(function (k) {
      rules[k] = String(S.bankRules[k] || '').toLowerCase().split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    });
    var order = ['zatca_wht', 'zatca_vat', 'zakat', 'internal_transfer', 'financing', 'payroll', 'foreign_transfer', 'customer_receipt', 'supplier_payment'];
    return (rows || []).map(function (r, i) {
      var key = String(r._k || r._r || i);
      var o = Object.assign({}, r);
      if (overrides && overrides[key]) { o.cls = overrides[key]; o.manual = true; return o; }
      var d = (String(r.description || '') + ' ' + String(r.reference || '')).toLowerCase();
      var inflow = (+r.credit || 0) > 0;
      var cls = '';
      for (var j = 0; j < order.length && !cls; j++) {
        var k = order[j];
        if (inflow && /payment|payroll|foreign|zakat|zatca/.test(k)) continue;
        if (!inflow && k === 'customer_receipt') continue;
        if ((rules[k] || []).some(function (w) { return d.indexOf(w) >= 0; })) cls = k;
      }
      if (!cls) cls = inflow ? 'customer_receipt' : 'other_out';
      o.cls = cls;
      return o;
    });
  };

  E.runBankRecon = function (ctx) {
    var S = ctx.settings, D = ctx.data, map = (ctx.entity && ctx.entity.mapping) || {}, checks = [];
    if (!D.bank || !D.bank.length) {
      return { checks: [{ id: 'B1', group: 'bank', title: 'Bank receipts vs declared sales', titleAr: 'المقبوضات البنكية مقابل المبيعات المقرة', status: 'na', missing: 'Bank statements' }], lines: [], summary: {} };
    }
    var lines = E.classifyBank(D.bank, S, ctx.bankOverrides);
    var sum = {};
    lines.forEach(function (l) { sum[l.cls] = r2((sum[l.cls] || 0) + (+l.credit || 0) - (+l.debit || 0)); });
    var ret = ctx.returnBoxes ? E.completeBoxes(JSON.parse(JSON.stringify(ctx.returnBoxes)), true) : null;
    var sys = D.sys_vat && D.sys_vat.length ? E.boxesFromSystem(D.sys_vat) : null;
    var B = ret || sys;

    // Sales incl. VAT less the rise in receivables ≈ cash received from customers.
    var salesGross = B ? (+B[6].amount || 0) + (+B[6].adj || 0) + (+B[6].vat || 0) : null;
    var arOpen = E.tbBalance(D.tb, map.receivables, 'opening'), arClose = E.tbBalance(D.tb, map.receivables, 'closing');
    var dAR = arOpen != null && arClose != null ? arClose - arOpen : 0;
    var expectedIn = salesGross == null ? null : salesGross - dAR;
    var receipts = sum.customer_receipt || 0;
    checks.push(check('B1', 'bank', 'Bank customer receipts vs sales declared (incl. VAT, adjusted for receivables)', 'تحصيلات العملاء البنكية مقابل المبيعات المقرة (شاملة الضريبة ومعدلة بالذمم)',
      receipts, 'Bank customer receipts', expectedIn, 'Sales incl. VAT − Δ receivables', S,
      { salesGross: salesGross == null ? null : r2(salesGross), deltaAR: r2(dAR), arMapped: !!map.receivables, note: 'Receipts above declared sales are the classic inspection finding: possible unreported sales.' }));
    // Cash in excess of sales is riskier than the reverse.
    var c1 = checks[0];
    if (c1.status !== 'na' && c1.diff > 0 && c1.status === 'warn') c1.status = 'fail';

    var purGross = B ? (+B[12].amount || 0) + (+B[12].adj || 0) + (+B[12].vat || 0) : null;
    var apOpen = E.tbBalance(D.tb, map.payables, 'opening'), apClose = E.tbBalance(D.tb, map.payables, 'closing');
    var dAP = apOpen != null && apClose != null ? -(apClose - apOpen) : 0; // payables are credit balances
    // reverse-charge VAT (box 9) is self-assessed, never paid to the supplier
    var expectedOut = purGross == null ? null : purGross - dAP - (+B[9].vat || 0);
    var payments = -(sum.supplier_payment || 0) - (sum.foreign_transfer || 0);
    checks.push(check('B2', 'bank', 'Bank supplier payments vs purchases declared (incl. VAT, adjusted for payables)', 'مدفوعات الموردين البنكية مقابل المشتريات المقرة',
      payments, 'Bank supplier + foreign payments', expectedOut, 'Purchases incl. VAT (excl. box 9) − Δ payables', S,
      { purGross: purGross == null ? null : r2(purGross), deltaAP: r2(dAP), apMapped: !!map.payables }));

    // VAT paid this period should equal the previous period's net VAT due.
    var vatPaid = -(sum.zatca_vat || 0);
    var prevDue = ctx.prevNetVat;
    checks.push(check('B3', 'bank', 'VAT paid to ZATCA vs previous return net VAT due', 'الضريبة المسددة للهيئة مقابل صافي الإقرار السابق',
      lines.some(function (l) { return l.cls === 'zatca_vat'; }) ? vatPaid : (prevDue != null ? 0 : null), 'Bank ZATCA VAT payments', prevDue == null ? null : Math.max(prevDue, 0), 'Previous period box 16', S));

    var whtPaid = -(sum.zatca_wht || 0);
    checks.push(check('B4', 'bank', 'WHT paid to ZATCA vs previous WHT return', 'ضريبة الاستقطاع المسددة مقابل إقرار الاستقطاع السابق',
      lines.some(function (l) { return l.cls === 'zatca_wht'; }) ? whtPaid : (ctx.prevWhtTax != null ? 0 : null), 'Bank ZATCA WHT payments', ctx.prevWhtTax == null ? null : ctx.prevWhtTax, 'Previous WHT return tax', S));

    // Foreign transfers with no WHT register line for the same beneficiary/amount.
    var reg = D.wht_reg || [];
    var foreign = lines.filter(function (l) { return l.cls === 'foreign_transfer'; });
    var unmatchedForeign = foreign.filter(function (l) {
      var amt = +l.debit || 0, d = String(l.description || '').toLowerCase();
      return !reg.some(function (w) {
        var net = (+w.gross || 0) - (+w.wht || 0);
        var nameHit = w.party && d.indexOf(String(w.party).toLowerCase().slice(0, 6)) >= 0;
        return Math.abs(net - amt) <= Math.max(1, amt * 0.01) || Math.abs((+w.gross || 0) - amt) <= Math.max(1, amt * 0.01) || nameHit;
      });
    });
    var c5 = { id: 'B5', group: 'bank', title: 'Foreign transfers covered by the WHT register', titleAr: 'التحويلات الخارجية مغطاة في سجل الاستقطاع',
      a: r2(foreign.reduce(function (s, l) { return s + (+l.debit || 0); }, 0)), aLabel: 'Foreign transfers',
      b: r2(unmatchedForeign.reduce(function (s, l) { return s + (+l.debit || 0); }, 0)), bLabel: 'Not in WHT register',
      exceptions: { unmatched: unmatchedForeign.slice(0, 300) }, counts: { unmatched: unmatchedForeign.length } };
    c5.diff = c5.b;
    c5.status = !foreign.length ? 'pass' : unmatchedForeign.length ? 'fail' : 'pass';
    c5.exposure = r2(c5.b * 0.15); // worst-case rate for an unknown payment type
    checks.push(c5);

    // Large customer receipts that match no sales invoice by amount or number.
    var sales = (D.sys_vat || []).filter(function (x) { return x.flow === 'S'; });
    var unmatchedIn = [];
    if (sales.length) {
      var byTotal = {};
      sales.forEach(function (x) { var k = Math.round(+x.total || 0); (byTotal[k] = byTotal[k] || []).push(x); });
      lines.filter(function (l) { return l.cls === 'customer_receipt'; }).forEach(function (l) {
        var amt = +l.credit || 0, k = Math.round(amt), d = String(l.description || '') + ' ' + String(l.reference || '');
        var hit = (byTotal[k] || byTotal[k - 1] || byTotal[k + 1]) || sales.some(function (x) { return x.invoice && d.indexOf(x.invoice) >= 0; });
        if (!hit && amt >= (S.materiality || 0) * 0.1) unmatchedIn.push(l);
      });
    }
    unmatchedIn.sort(function (a, b) { return b.credit - a.credit; });
    var c6 = { id: 'B6', group: 'bank', title: 'Significant receipts traced to sales invoices', titleAr: 'تتبع المقبوضات الجوهرية إلى فواتير المبيعات',
      a: r2(unmatchedIn.reduce(function (s, l) { return s + (+l.credit || 0); }, 0)), aLabel: 'Unmatched receipts', b: 0, bLabel: '',
      exceptions: { unmatched: unmatchedIn.slice(0, 300) }, counts: { unmatched: unmatchedIn.length },
      note: 'Individual receipts (≥ 10% of materiality) that match no invoice total or number. Pooled POS/mada settlements will appear here until classified.' };
    c6.diff = c6.a;
    c6.status = !sales.length ? 'na' : !unmatchedIn.length ? 'pass' : c6.a > S.materiality ? 'fail' : 'warn';
    if (!sales.length) c6.missing = 'System VAT report';
    checks.push(c6);

    // Bank balance per statement vs TB bank accounts.
    if (map.bank && D.bank.some(function (l) { return l.balance; })) {
      var lastBal = 0, byAcc = {};
      D.bank.slice().sort(function (a, b) { return (a.date < b.date ? -1 : a.date > b.date ? 1 : (a._r || 0) - (b._r || 0)); })
        .forEach(function (l) { if (l.balance || l.balance === 0) byAcc[l.account || '_'] = +l.balance || 0; });
      Object.keys(byAcc).forEach(function (k) { lastBal += byAcc[k]; });
      checks.push(check('B7', 'bank', 'Closing bank balance: statements vs TB', 'رصيد البنك الختامي: الكشوف مقابل الميزان', lastBal, 'Statements', E.tbBalance(D.tb, map.bank, 'closing'), 'TB bank accounts', S));
    }
    return { checks: checks, lines: lines, summary: sum };
  };

  // ------------------------------------------------------------------ WHT reconciliation
  E.runWhtRecon = function (ctx) {
    var S = ctx.settings, D = ctx.data, map = (ctx.entity && ctx.entity.mapping) || {}, checks = [];
    var reg = D.wht_reg || [], ret = D.ret_wht || [], xls = D.xls_wht || [];
    var sum = function (rows, f) { return rows.length ? r2(rows.reduce(function (s, x) { return s + (+x[f] || 0); }, 0)) : null; };

    // By payment type: return vs register vs Excel.
    var types = {};
    function add(rows, key, af, tf) { rows.forEach(function (x) { var t = x.paymentType || 'other'; types[t] = types[t] || { type: t, ret: { a: 0, t: 0 }, reg: { a: 0, t: 0 }, xls: { a: 0, t: 0 } }; types[t][key].a += +x[af] || 0; types[t][key].t += +x[tf] || 0; }); }
    add(ret, 'ret', 'amount', 'tax'); add(reg, 'reg', 'gross', 'wht'); add(xls, 'xls', 'amount', 'tax');
    var lines = Object.keys(types).map(function (k) {
      var x = types[k];
      ['ret', 'reg', 'xls'].forEach(function (s) { x[s].a = r2(x[s].a); x[s].t = r2(x[s].t); });
      x.dRegTax = r2(x.ret.t - x.reg.t); x.dXlsTax = r2(x.ret.t - x.xls.t);
      x.status = worst([ret.length && reg.length ? status(x.dRegTax, Math.max(x.ret.t, x.reg.t), S) : 'pass', ret.length && xls.length ? status(x.dXlsTax, Math.max(x.ret.t, x.xls.t), S) : 'pass']);
      return x;
    });
    var w1 = check('W1', 'wht', 'WHT return vs WHT register (by payment type)', 'إقرار الاستقطاع مقابل سجل المدفوعات (حسب النوع)', sum(ret, 'tax'), 'Return tax', sum(reg, 'wht'), 'Register WHT', S, { kind: 'wht', lines: lines });
    if (w1.status !== 'na') w1.status = worst([w1.status].concat(lines.map(function (l) { return l.status; })));
    checks.push(w1);
    checks.push(check('W2', 'wht', 'WHT return vs Excel workings', 'إقرار الاستقطاع مقابل أوراق العمل', sum(ret, 'tax'), 'Return tax', sum(xls, 'tax'), 'Excel tax', S));
    checks.push(check('W3', 'wht', 'WHT return amounts paid vs register gross', 'المبالغ المدفوعة في الإقرار مقابل إجمالي السجل', sum(ret, 'amount'), 'Return amounts', sum(reg, 'gross'), 'Register gross', S));

    // Ledger: credits to WHT payable this period (accrual) vs return tax.
    var g = E.glMovement(D.gl, map.whtPayable, '');
    var led = null, src = '';
    if (g && D.gl) {
      var pats = E.accountMatcher(map.whtPayable);
      led = r2(D.gl.filter(function (x) { return pats(x.account); }).reduce(function (s, x) { return s + (+x.credit || 0); }, 0)); src = 'GL credits';
    } else {
      var t = E.tbMovement(D.tb, map.whtPayable, 'gross', 'credit');
      if (t != null) { led = -t; src = 'TB credits'; }
    }
    checks.push(check('W4', 'wht', 'WHT return vs WHT payable account (period credits)', 'إقرار الاستقطاع مقابل حساب ضريبة الاستقطاع المستحقة', sum(ret, 'tax'), 'Return tax', led, 'GL WHT payable credits', S, { source: src, missingHint: map.whtPayable ? '' : 'Map the WHT payable account on the entity' }));

    // Rate test per register line: statutory (or lower treaty) rate.
    var rateEx = [], under = 0;
    reg.forEach(function (x) {
      var stat = S.whtRates[x.paymentType] != null ? +S.whtRates[x.paymentType] : 0.15;
      var applied = x.rate ? +x.rate : (x.gross ? (+x.wht || 0) / x.gross : 0);
      var expected = r2((+x.gross || 0) * stat);
      var dtt = /^(y|yes|true|1|نعم)/i.test(String(x.dtt || ''));
      var short = r2(expected - (+x.wht || 0));
      if (short > S.tolAbs && !dtt) { rateEx.push(Object.assign({}, x, { statutory: stat, applied: Math.round(applied * 10000) / 10000, expected: expected, shortfall: short, reason: 'Under-withheld' })); under += short; }
      else if (short > S.tolAbs && dtt && !x.certificate) rateEx.push(Object.assign({}, x, { statutory: stat, applied: applied, expected: expected, shortfall: short, reason: 'Treaty rate without residency certificate on file' }));
    });
    checks.push({ id: 'W5', group: 'wht', title: 'Statutory WHT rates applied (treaty relief documented)', titleAr: 'تطبيق نسب الاستقطاع النظامية (وتوثيق الإعفاء الاتفاقي)',
      status: !reg.length ? 'na' : rateEx.length ? 'fail' : 'pass', missing: reg.length ? '' : 'WHT register', a: r2(under), aLabel: 'Under-withheld', b: 0, bLabel: '', diff: r2(under),
      exceptions: { rate: rateEx }, counts: { rate: rateEx.length }, exposure: r2(under) });

    // Timeliness: remitted to ZATCA by the 10th of the following month.
    var late = [], latePen = 0;
    reg.forEach(function (x) {
      if (!x.date) return;
      var d = x.date, due = new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7), 10)).toISOString().slice(0, 10);
      if (x.paidDate && x.paidDate > due) {
        var days = daysBetween(due, x.paidDate), per = Math.ceil(days / 30);
        var pen = r2((+x.wht || 0) * S.penalties.whtLatePctPer30Days * per);
        late.push(Object.assign({}, x, { due: due, daysLate: days, penalty: pen })); latePen += pen;
      }
    });
    var noPaid = reg.filter(function (x) { return !x.paidDate; }).length;
    checks.push({ id: 'W6', group: 'wht', title: 'WHT remitted by the 10th of the following month', titleAr: 'سداد الاستقطاع قبل اليوم العاشر من الشهر التالي',
      status: !reg.length ? 'na' : late.length ? 'fail' : noPaid ? 'warn' : 'pass', missing: reg.length ? '' : 'WHT register', a: r2(latePen), aLabel: 'Late-payment fines', b: 0, bLabel: '', diff: r2(latePen),
      exceptions: { late: late }, counts: { late: late.length, noPaidDate: noPaid }, exposure: r2(latePen) });

    // Certificates issued to every beneficiary.
    var noCert = reg.filter(function (x) { return !x.certificate; });
    checks.push({ id: 'W7', group: 'wht', title: 'WHT certificates issued to beneficiaries', titleAr: 'إصدار شهادات الاستقطاع للمستفيدين',
      status: !reg.length ? 'na' : noCert.length ? 'warn' : 'pass', missing: reg.length ? '' : 'WHT register', a: noCert.length, aLabel: 'Lines without certificate', b: 0, bLabel: '', diff: noCert.length,
      exceptions: { noCert: noCert.slice(0, 300) }, counts: { noCert: noCert.length } });

    // Completeness: non-resident payments in the GL not in the register.
    if (D.gl && D.gl.length && map.foreignExpense) {
      var fx = E.accountMatcher(map.foreignExpense);
      var cand = D.gl.filter(function (x) { return fx(x.account) && (+x.debit || 0) > 0 && x.country && !/^(sa|ksa|saudi|السعودية)/i.test(x.country); });
      var miss = cand.filter(function (x) {
        return !reg.some(function (w) { return (w.party && x.party && String(w.party).toLowerCase() === String(x.party).toLowerCase()) || Math.abs((+w.gross || 0) - (+x.debit || 0)) <= 1; });
      });
      checks.push({ id: 'W8', group: 'wht', title: 'Non-resident expenses in GL captured in WHT register', titleAr: 'مصروفات غير المقيمين في الأستاذ مدرجة في سجل الاستقطاع',
        status: miss.length ? 'fail' : 'pass', a: r2(miss.reduce(function (s, x) { return s + (+x.debit || 0); }, 0)), aLabel: 'Not in register', b: 0, bLabel: '',
        exceptions: { missing: miss.slice(0, 300) }, counts: { missing: miss.length }, exposure: r2(miss.reduce(function (s, x) { return s + (+x.debit || 0) * (S.whtRates.other || 0.15); }, 0)) });
      checks[checks.length - 1].diff = checks[checks.length - 1].a;
    }
    return { checks: checks, lines: lines };
  };

  // ------------------------------------------------------------------ analytics
  E.runAnalytics = function (ctx) {
    var S = ctx.settings, D = ctx.data, rows = D.sys_vat || [], tests = [];
    var range = ctx.periodKey ? E.periodRange(ctx.periodKey) : null;
    var rate = +S.vatRate || 0.15;
    function T(id, title, titleAr, sev, items, desc, amountField) {
      var amt = items.reduce(function (s, x) { return s + Math.abs(+x[amountField || 'vat'] || 0); }, 0);
      tests.push({ id: id, title: title, titleAr: titleAr, severity: sev, desc: desc, count: items.length, amount: r2(amt),
        status: !rows.length ? 'na' : items.length ? (sev === 'high' ? 'fail' : 'warn') : 'pass', items: items.slice(0, 500) });
    }
    var sales = rows.filter(function (x) { return x.flow === 'S'; }), purch = rows.filter(function (x) { return x.flow === 'P'; });

    T('A1', 'VAT amount ≠ 15% of net on standard-rated lines', 'مبلغ الضريبة لا يساوي 15% من الصافي', 'high',
      rows.filter(function (x) { return /^(S|SC|IMP|RCM)$/.test(x.category) && Math.abs((+x.vat || 0) - (+x.net || 0) * rate) > Math.max(0.05, Math.abs(+x.net || 0) * 0.001); })
        .map(function (x) { return Object.assign({}, x, { expected: r2(x.net * rate), reason: 'Expected ' + r2(x.net * rate) }); }),
      'Recomputes VAT on every standard-rated invoice. Differences mean a wrong rate, a rounding scheme, or a mis-keyed amount.');
    T('A2', 'VAT charged on zero-rated, exempt or out-of-scope lines', 'ضريبة على بنود صفرية أو معفاة', 'high',
      rows.filter(function (x) { return /^(Z|X|E|O)$/.test(x.category) && Math.abs(+x.vat || 0) > 0.01; }), 'A non-standard category carrying VAT is either the wrong code or VAT collected and not declared.');
    T('A3', 'Input VAT claimed without a valid supplier VAT number', 'ضريبة مدخلات بدون رقم ضريبي صحيح للمورد', 'high',
      purch.filter(function (x) { return x.category === 'S' && (+x.vat || 0) > 0 && !E.validVatNo(x.vatNo); }).map(function (x) { return Object.assign({}, x, { reason: x.vatNo ? 'Invalid format' : 'Missing' }); }),
      'Input VAT is only recoverable on a tax invoice showing the supplier\'s 15-digit TRN (starts and ends with 3).');
    T('A4', 'B2B sales with an invalid customer VAT number', 'مبيعات لشركات برقم ضريبي غير صحيح', 'medium',
      sales.filter(function (x) { return x.vatNo && !E.validVatNo(x.vatNo); }), 'Standard tax invoices must show the buyer\'s valid TRN.');
    var seen = {}, dups = [];
    rows.forEach(function (x) {
      var k = x.flow + '|' + String(x.party || '').toLowerCase() + '|' + String(x.invoice).toLowerCase();
      if (seen[k]) dups.push(Object.assign({}, x, { reason: 'Duplicate of row ' + seen[k]._r })); else seen[k] = x;
    });
    var seen2 = {};
    purch.forEach(function (x) {
      var k = String(x.party || '').toLowerCase() + '|' + x.date + '|' + x.total;
      if (seen2[k] && seen2[k].invoice !== x.invoice) dups.push(Object.assign({}, x, { reason: 'Same supplier, date and amount as ' + seen2[k].invoice })); else seen2[k] = x;
    });
    T('A5', 'Duplicate invoices', 'فواتير مكررة', 'high', dups, 'Same counterparty and number, or same supplier/date/amount under a different number — double-claimed input VAT is a frequent assessment.');
    if (range) T('A6', 'Invoices dated outside the period', 'فواتير خارج الفترة', 'medium',
      rows.filter(function (x) { return x.date && (x.date < range.start || x.date > range.end); }), 'Cut-off: a tax point outside the period belongs in another return.');
    // sequence gaps per prefix
    var seq = {}, gaps = [];
    sales.filter(function (x) { return x.docType === 'INV'; }).forEach(function (x) {
      var m = String(x.invoice).match(/^(.*?)(\d+)$/); if (!m) return;
      (seq[m[1]] = seq[m[1]] || []).push(+m[2]);
    });
    Object.keys(seq).forEach(function (p) {
      var a = seq[p].sort(function (x, y) { return x - y; });
      for (var i = 1; i < a.length; i++) if (a[i] - a[i - 1] > 1 && a[i] - a[i - 1] < 1000) {
        gaps.push({ invoice: p + (a[i - 1] + 1) + (a[i] - a[i - 1] > 2 ? ' … ' + p + (a[i] - 1) : ''), missing: a[i] - a[i - 1] - 1, reason: 'Gap in sequence', vat: 0 });
      }
    });
    T('A7', 'Gaps in sales invoice numbering', 'فجوات في تسلسل فواتير المبيعات', 'medium', gaps, 'Missing numbers must be explained (cancelled, voided) — inspectors ask for them.');
    T('A8', 'Exports without a foreign destination', 'صادرات بدون دولة وجهة خارجية', 'medium',
      sales.filter(function (x) { return x.category === 'X' && (!x.country || /^(sa|ksa|saudi|السعودية)/i.test(x.country)); }), 'Zero-rating an export needs proof the goods left KSA (customs export declaration).');
    T('A9', 'Foreign supplier charged standard VAT instead of reverse charge', 'مورد أجنبي بضريبة أساسية بدلاً من الاحتساب العكسي', 'medium',
      purch.filter(function (x) { return x.category === 'S' && x.country && !/^(sa|ksa|saudi|السعودية)/i.test(x.country); }), 'Services from non-residents are self-assessed under RCM (box 9).');
    T('A10', 'Reverse-charge lines from Saudi suppliers', 'احتساب عكسي على موردين سعوديين', 'low',
      purch.filter(function (x) { return x.category === 'RCM' && (/^(sa|ksa|saudi|السعودية)/i.test(x.country || '') || E.validVatNo(x.vatNo)); }), 'RCM applies to non-resident suppliers.');
    var cn = sales.filter(function (x) { return x.docType === 'CN' || (+x.net || 0) < 0; });
    var cnAmt = Math.abs(cn.reduce(function (s, x) { return s + (+x.net || 0); }, 0)), sAmt = sales.reduce(function (s, x) { return s + Math.max(+x.net || 0, 0); }, 0);
    T('A11', 'Credit notes above 5% of sales', 'إشعارات دائنة تتجاوز 5% من المبيعات', 'low', sAmt && cnAmt / sAmt > 0.05 ? cn : [], 'High credit notes reduce output VAT and are always sampled. Ratio: ' + (sAmt ? (cnAmt / sAmt * 100).toFixed(1) : 0) + '%.');
    var big = rows.filter(function (x) { return Math.abs(+x.net || 0) >= (S.materiality || Infinity); }).sort(function (a, b) { return Math.abs(b.net) - Math.abs(a.net); });
    T('A12', 'Transactions above materiality', 'معاملات تتجاوز الأهمية النسبية', 'low', big, 'Key items — test 100% of these.', 'net');
    T('A13', 'Round-amount purchases (multiples of 1,000)', 'مشتريات بمبالغ مقربة', 'low',
      purch.filter(function (x) { return (+x.net || 0) >= 5000 && (+x.net || 0) % 1000 === 0; }), 'Round amounts can indicate estimates or non-genuine invoices.', 'net');
    T('A14', 'Purchases dated on a weekend (Fri/Sat)', 'مشتريات بتاريخ عطلة نهاية الأسبوع', 'low',
      purch.filter(function (x) { if (!x.date) return false; var g = new Date(x.date + 'T00:00:00Z').getUTCDay(); return g === 5 || g === 6; }), 'Not wrong on its own; useful for targeting samples.');
    if (D.customs && D.customs.length) {
      var imp = purch.filter(function (x) { return x.category === 'IMP'; });
      var cv = D.customs.reduce(function (s, x) { return s + (+x.vat || 0); }, 0), iv = imp.reduce(function (s, x) { return s + (+x.vat || 0); }, 0);
      T('A15', 'Import VAT in system vs customs declarations', 'ضريبة الاستيراد في النظام مقابل البيانات الجمركية', 'medium',
        Math.abs(cv - iv) > S.tolAbs ? [{ invoice: 'Total', vat: r2(iv - cv), reason: 'System ' + r2(iv) + ' vs customs ' + r2(cv) }] : [], 'Box 8 input VAT is only recoverable against a customs declaration in the entity\'s name.');
    }
    tests.push(E.benford(rows.map(function (x) { return Math.abs(+x.net || 0); }), S));
    // ratio analytics
    var outV = sales.filter(function (x) { return x.category === 'S' || x.category === 'SC'; });
    var effective = outV.reduce(function (s, x) { return s + (+x.net || 0); }, 0);
    var effVat = outV.reduce(function (s, x) { return s + (+x.vat || 0); }, 0);
    var ratios = {
      effectiveRate: effective ? Math.round(effVat / effective * 100000) / 1000 : null, // 3 dp: one wrong invoice moves it by hundredths
      inputToOutput: null,
      zeroExemptShare: null
    };
    var inVat = purch.reduce(function (s, x) { return s + (+x.vat || 0); }, 0), outVat = sales.reduce(function (s, x) { return s + (+x.vat || 0); }, 0);
    ratios.inputToOutput = outVat ? r2(inVat / outVat * 100) : null;
    var ze = sales.filter(function (x) { return /^(Z|X|E)$/.test(x.category); }).reduce(function (s, x) { return s + (+x.net || 0); }, 0);
    ratios.zeroExemptShare = sAmt ? r2(ze / sAmt * 100) : null;
    return { tests: tests, ratios: ratios };
  };

  // Benford first-digit test with Nigrini's MAD thresholds.
  E.benford = function (values, S) {
    var v = values.filter(function (x) { return x >= 10; });
    var res = { id: 'A16', title: 'Benford\'s law — first digit (amounts ≥ 10)', titleAr: 'قانون بنفورد — الرقم الأول', severity: 'low', items: [], count: 0, amount: 0 };
    if (v.length < (S.benfordMin || 300)) { res.status = 'na'; res.desc = 'Needs at least ' + (S.benfordMin || 300) + ' amounts (have ' + v.length + ').'; return res; }
    var c = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    v.forEach(function (x) { c[+String(Math.floor(x))[0]]++; });
    var mad = 0, dist = [];
    for (var d = 1; d <= 9; d++) {
      var exp = Math.log10(1 + 1 / d), act = c[d] / v.length;
      mad += Math.abs(act - exp);
      dist.push({ digit: d, expected: r2(exp * 100), actual: r2(act * 100), count: c[d] });
    }
    mad = mad / 9;
    res.mad = Math.round(mad * 100000) / 100000;
    res.dist = dist;
    res.conformity = mad <= 0.006 ? 'Close conformity' : mad <= 0.012 ? 'Acceptable conformity' : mad <= 0.015 ? 'Marginal conformity' : 'Nonconformity';
    res.status = mad <= 0.012 ? 'pass' : mad <= 0.015 ? 'warn' : 'fail';
    res.desc = res.conformity + ' (MAD ' + res.mad + ', n=' + v.length + ').';
    res.count = res.status === 'pass' ? 0 : 1;
    return res;
  };

  // ------------------------------------------------------------------ sampling
  // Seeded PRNG so a sample can be re-performed by an inspector from its seed.
  E.rng = function (seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  function poissonCdf(k, lam) { var s = 0, term = Math.exp(-lam); for (var i = 0; i <= k; i++) { if (i > 0) term *= lam / i; s += term; } return s; }
  // Upper precision limit factor: λ with P(X ≤ k; λ) = 1 − confidence.
  E.reliabilityFactor = function (k, confidence) {
    var lo = 0, hi = 100, target = 1 - confidence;
    for (var i = 0; i < 80; i++) { var mid = (lo + hi) / 2; if (poissonCdf(k, mid) > target) lo = mid; else hi = mid; }
    return Math.ceil(hi * 100 - 1e-6) / 100; // rounded up, as in the AICPA tables
  };

  // Attribute sampling: smallest n with expected deviations still under the tolerable rate.
  E.sampleSizeAttribute = function (confidence, tolerableRate, expectedRate, population) {
    var n = 1;
    for (var it = 0; it < 50; it++) {
      var k = Math.ceil(n * (expectedRate || 0));
      var nn = Math.ceil(E.reliabilityFactor(k, confidence) / tolerableRate);
      if (nn === n) break;
      n = nn;
    }
    if (population && n > population) n = population;
    // finite population correction for small populations
    if (population && population < 5000) n = Math.ceil(n / (1 + n / population));
    return Math.max(1, n);
  };

  // MUS: n = BV × RF / (TM − EM × expansion factor).
  E.sampleSizeMUS = function (bookValue, tolerable, expected, confidence) {
    var rf = E.reliabilityFactor(0, confidence);
    var ef = confidence >= 0.95 ? 1.6 : confidence >= 0.9 ? 1.5 : 1.3;
    var den = tolerable - (expected || 0) * ef;
    if (den <= 0) return null;
    return Math.max(1, Math.ceil(bookValue * rf / den));
  };

  E.selectRandom = function (pop, n, seed) {
    var R = E.rng(seed), idx = pop.map(function (_, i) { return i; });
    for (var i = idx.length - 1; i > 0; i--) { var j = Math.floor(R() * (i + 1)); var t = idx[i]; idx[i] = idx[j]; idx[j] = t; }
    return idx.slice(0, Math.min(n, pop.length)).sort(function (a, b) { return a - b; }).map(function (i) { return { i: i, why: 'Random' }; });
  };

  // Systematic PPS with a random start. Items at or above the interval are always in.
  E.selectMUS = function (pop, n, seed, field) {
    var vals = pop.map(function (x) { return Math.abs(+x[field] || 0); });
    var BV = vals.reduce(function (s, v) { return s + v; }, 0);
    if (!BV || !n) return { items: [], interval: 0, start: 0, bookValue: 0 };
    var J = BV / n, start = E.rng(seed)() * J, out = [], cum = 0, next = start, picked = {};
    for (var i = 0; i < pop.length; i++) {
      var lo = cum; cum += vals[i];
      if (vals[i] >= J) { out.push({ i: i, why: 'Top stratum (≥ interval)' }); picked[i] = 1; while (next < cum) next += J; continue; }
      if (next >= lo && next < cum) { if (!picked[i]) { out.push({ i: i, why: 'MUS hit at ' + r2(next) }); picked[i] = 1; } while (next < cum) next += J; }
    }
    return { items: out, interval: r2(J), start: r2(start), bookValue: r2(BV) };
  };

  E.selectStratified = function (pop, n, seed, field, strata) {
    strata = strata || 4;
    var R = E.rng(seed);
    var sorted = pop.map(function (x, i) { return { i: i, v: Math.abs(+x[field] || 0) }; }).sort(function (a, b) { return b.v - a.v; });
    var total = sorted.reduce(function (s, x) { return s + x.v; }, 0) || 1, bands = [], cur = [], acc = 0, per = total / strata;
    sorted.forEach(function (x) { cur.push(x); acc += x.v; if (acc >= per * (bands.length + 1) && bands.length < strata - 1) { bands.push(cur); cur = []; } });
    if (cur.length) bands.push(cur);
    var out = [];
    bands.forEach(function (b, bi) {
      var bv = b.reduce(function (s, x) { return s + x.v; }, 0);
      var k = Math.min(b.length, Math.max(1, Math.round(n * bv / total)));
      var idx = b.slice();
      for (var i = idx.length - 1; i > 0; i--) { var j = Math.floor(R() * (i + 1)); var t = idx[i]; idx[i] = idx[j]; idx[j] = t; }
      idx.slice(0, k).forEach(function (x) { out.push({ i: x.i, why: 'Stratum ' + (bi + 1) + ' (' + b.length + ' items, ' + r2(bv) + ')' }); });
    });
    return out.sort(function (a, b) { return a.i - b.i; });
  };

  E.selectKey = function (pop, threshold, field) {
    return pop.map(function (x, i) { return { i: i, v: Math.abs(+x[field] || 0) }; }).filter(function (x) { return x.v >= threshold; })
      .map(function (x) { return { i: x.i, why: 'Key item ≥ ' + threshold }; });
  };

  E.ATTRIBUTES = {
    S: [
      ['inv_issued', 'Tax invoice issued (standard B2B / simplified B2C)', 'صدرت فاتورة ضريبية (قياسية / مبسطة)'],
      ['inv_fields', 'Mandatory fields: seller TRN, buyer TRN (B2B), date, Arabic, VAT breakdown', 'الحقول الإلزامية: الرقم الضريبي للبائع والمشتري، التاريخ، العربية، تفصيل الضريبة'],
      ['qr', 'QR code present and decodes to the invoice values', 'رمز الاستجابة السريعة موجود ومطابق'],
      ['fatoora', 'Cleared / reported on Fatoora within the time limit', 'تم اعتمادها/الإبلاغ عنها في منصة فاتورة'],
      ['rate', 'Correct VAT category and rate', 'فئة ونسبة الضريبة صحيحة'],
      ['amount', 'VAT amount correctly computed', 'مبلغ الضريبة محسوب بشكل صحيح'],
      ['period', 'Tax point within the period (cut-off)', 'نقطة الاستحقاق ضمن الفترة'],
      ['box', 'Reported in the correct return box', 'مدرجة في البند الصحيح من الإقرار'],
      ['gl', 'Recorded in GL revenue and output VAT', 'مسجلة في الإيرادات وضريبة المخرجات'],
      ['bank', 'Collection traced to bank statement', 'التحصيل متتبع في كشف البنك'],
      ['support', 'Supporting docs (contract, PO, delivery note; export declaration if zero-rated)', 'المستندات المؤيدة (عقد، أمر شراء، إشعار تسليم، بيان تصدير)']
    ],
    P: [
      ['inv_valid', 'Valid tax invoice addressed to the entity', 'فاتورة ضريبية صحيحة باسم المنشأة'],
      ['trn', 'Supplier TRN valid and active (checked on ZATCA)', 'الرقم الضريبي للمورد صحيح وفعال'],
      ['amount', 'VAT amount and rate correct', 'مبلغ ونسبة الضريبة صحيحة'],
      ['business', 'For taxable business use — not a blocked item (entertainment, personal cars…)', 'للاستخدام في نشاط خاضع — ليست من البنود المحظورة'],
      ['period', 'Claimed in the right period, not claimed before', 'مطالب بها في الفترة الصحيحة ولم يسبق المطالبة'],
      ['gl', 'Recorded in GL expense/asset and input VAT', 'مسجلة في المصروفات/الأصول وضريبة المدخلات'],
      ['bank', 'Payment traced to bank statement (or payable)', 'الدفع متتبع في كشف البنك'],
      ['customs', 'Imports: customs declaration in entity\'s name (box 8)', 'الاستيراد: بيان جمركي باسم المنشأة'],
      ['rcm', 'Non-resident services: RCM self-assessed (box 9) and WHT withheld', 'خدمات غير مقيم: احتساب عكسي واستقطاع'],
      ['support', 'Supporting docs (PO, GRN, contract)', 'المستندات المؤيدة (أمر شراء، استلام، عقد)']
    ],
    W: [
      ['nonresident', 'Beneficiary is a non-resident (no PE in KSA)', 'المستفيد غير مقيم'],
      ['type', 'Payment type classified correctly', 'تصنيف نوع الدفعة صحيح'],
      ['rate', 'Correct statutory or treaty rate applied', 'تطبيق النسبة النظامية أو الاتفاقية الصحيحة'],
      ['dtt', 'Treaty relief: residency certificate / forms on file', 'الإعفاء الاتفاقي: شهادة الإقامة الضريبية'],
      ['remit', 'Remitted to ZATCA by the 10th', 'السداد للهيئة قبل اليوم العاشر'],
      ['return', 'Included in the monthly WHT return', 'مدرجة في إقرار الاستقطاع الشهري'],
      ['cert', 'WHT certificate issued to beneficiary', 'إصدار شهادة استقطاع'],
      ['bank', 'Net payment traced to bank statement', 'صافي الدفعة متتبع في كشف البنك'],
      ['contract', 'Contract / invoice supports the gross amount', 'العقد/الفاتورة تؤيد المبلغ الإجمالي']
    ]
  };

  // Evaluates a tested sample. Items carry .tests {attr: 'pass'|'fail'|'na'}
  // and optionally .audited (the correct value) for MUS projection.
  E.evaluateSample = function (sample, confidence) {
    var items = sample.items || [], attrs = E.ATTRIBUTES[sample.flow] || [];
    var tested = items.filter(function (x) { return x.tests && Object.keys(x.tests).length; });
    var devItems = tested.filter(function (x) { return Object.keys(x.tests).some(function (k) { return x.tests[k] === 'fail'; }); });
    var byAttr = attrs.map(function (a) {
      var t = tested.filter(function (x) { return x.tests[a[0]] && x.tests[a[0]] !== 'na'; }).length;
      var f = tested.filter(function (x) { return x.tests[a[0]] === 'fail'; }).length;
      return { key: a[0], tested: t, fails: f, rate: t ? r2(f / t * 100) : 0, upper: t ? r2(E.reliabilityFactor(f, confidence || 0.95) / t * 100) : null };
    });
    var res = { tested: tested.length, total: items.length, deviations: devItems.length,
      rate: tested.length ? r2(devItems.length / tested.length * 100) : 0, byAttr: byAttr,
      upperRate: tested.length ? r2(E.reliabilityFactor(devItems.length, confidence || 0.95) / tested.length * 100) : null };
    // monetary projection
    var mis = items.filter(function (x) { return x.audited != null && x.audited !== '' && Math.abs((+x.book || 0) - (+x.audited)) > 0.005; });
    res.actualMisstatement = r2(mis.reduce(function (s, x) { return s + (+x.book || 0) - (+x.audited); }, 0));
    if (sample.method === 'mus' && sample.interval) {
      var J = sample.interval, taint = [], top = 0;
      mis.forEach(function (x) {
        var b = Math.abs(+x.book || 0), d = (+x.book || 0) - (+x.audited);
        if (b >= J) top += d; else taint.push(Math.min(1, Math.abs(d) / (b || 1)) * (d < 0 ? -1 : 1));
      });
      var over = taint.filter(function (t) { return t > 0; }).sort(function (a, b) { return b - a; });
      var conf = confidence || 0.95, bp = E.reliabilityFactor(0, conf) * J, proj = 0, inc = 0;
      over.forEach(function (t, k) {
        proj += t * J;
        inc += (E.reliabilityFactor(k + 1, conf) - E.reliabilityFactor(k, conf) - 1) * t * J;
      });
      res.projected = r2(proj + top);
      res.upperLimit = r2(bp + proj + inc + top);
      res.basicPrecision = r2(bp);
    } else if (sample.populationValue && tested.length) {
      var sv = items.reduce(function (s, x) { return s + Math.abs(+x.book || 0); }, 0);
      res.projected = sv ? r2(res.actualMisstatement / sv * sample.populationValue) : 0;
    }
    return res;
  };

  // ------------------------------------------------------------------ penalties & readiness
  E.penaltyForFinding = function (f, S) {
    var P = S.penalties, tax = Math.abs(+f.taxImpact || 0), months = +f.monthsLate || 0;
    if (f.tax === 'WHT') return r2(tax * P.whtLatePctPer30Days * Math.max(1, Math.ceil((+f.daysLate || 30) / 30)));
    var err = tax * P.vatErrorPct;
    var late = tax * P.vatLatePaymentPctPerMonth * months;
    return r2(err + late);
  };

  E.correctionRoute = function (netVatImpact, S) {
    return Math.abs(netVatImpact) > (S.vatCorrectionThreshold || 5000)
      ? 'Amended return (voluntary disclosure) — impact above SAR ' + (S.vatCorrectionThreshold || 5000)
      : 'Correct through Box 14 of the next return';
  };

  E.DEFAULT_CHECKLIST = [
    ['VAT', 'VAT registration certificate', 'شهادة التسجيل في ضريبة القيمة المضافة'],
    ['VAT', 'Commercial registration (CR) and articles', 'السجل التجاري وعقد التأسيس'],
    ['VAT', 'Filed VAT return and payment receipt (SADAD)', 'الإقرار المقدم وإيصال السداد'],
    ['VAT', 'Trial balance for the period', 'ميزان المراجعة للفترة'],
    ['VAT', 'General ledger (VAT, revenue, expense accounts)', 'دفتر الأستاذ (حسابات الضريبة والإيرادات والمصروفات)'],
    ['VAT', 'Sales and purchase listings (system VAT report)', 'كشوف المبيعات والمشتريات (تقرير الضريبة)'],
    ['VAT', 'VAT working papers reconciling to the return', 'أوراق عمل الضريبة المطابقة للإقرار'],
    ['VAT', 'Sample tax invoices — sales and purchases', 'عينات الفواتير الضريبية — مبيعات ومشتريات'],
    ['VAT', 'Credit / debit notes with reasons', 'الإشعارات الدائنة والمدينة وأسبابها'],
    ['VAT', 'Customs declarations for imports', 'البيانات الجمركية للواردات'],
    ['VAT', 'Export evidence for zero-rated supplies', 'إثبات التصدير للتوريدات الصفرية'],
    ['VAT', 'Contracts with key customers and suppliers', 'العقود مع العملاء والموردين الرئيسيين'],
    ['VAT', 'E-invoicing: Fatoora onboarding (CSID) and integration evidence', 'الفوترة الإلكترونية: شهادة الربط وأدلة التكامل'],
    ['VAT', 'Fixed asset register (capital goods adjustments)', 'سجل الأصول الثابتة'],
    ['BANK', 'Bank statements — all accounts, full period', 'كشوف الحسابات البنكية — جميع الحسابات للفترة كاملة'],
    ['BANK', 'Bank reconciliations', 'المطابقات البنكية'],
    ['BANK', 'POS / mada settlement reports', 'تقارير تسويات نقاط البيع / مدى'],
    ['WHT', 'Monthly WHT return and payment receipt', 'إقرار الاستقطاع الشهري وإيصال السداد'],
    ['WHT', 'WHT payments register with contracts and invoices', 'سجل مدفوعات الاستقطاع مع العقود والفواتير'],
    ['WHT', 'WHT certificates issued to beneficiaries', 'شهادات الاستقطاع الصادرة للمستفيدين'],
    ['WHT', 'Tax residency certificates / treaty forms (DTT)', 'شهادات الإقامة الضريبية ونماذج الاتفاقيات'],
    ['WHT', 'Intercompany / head-office agreements', 'اتفاقيات الأطراف المرتبطة والمركز الرئيسي']
  ];

  E.readiness = function (r) {
    var W = r.settings.weights, parts = {};
    function score(list) {
      var l = list.filter(function (c) { return c.status !== 'na'; });
      var naCount = list.length - l.length;
      if (!list.length) return null;
      var s = l.reduce(function (a, c) { return a + (c.status === 'pass' ? 1 : c.status === 'warn' ? 0.5 : 0); }, 0);
      return (s) / (l.length + naCount * 0.5 || 1);
    }
    parts.recon = score((r.vat || []).concat(r.wht || []));
    parts.bank = score(r.bank || []);
    var tests = (r.analytics || []).filter(function (t) { return t.status !== 'na'; });
    parts.analytics = tests.length ? tests.reduce(function (a, t) { return a + (t.status === 'pass' ? 1 : t.status === 'warn' ? (t.severity === 'low' ? 0.85 : 0.6) : 0.2); }, 0) / tests.length : 0;
    var samples = r.samples || [];
    if (!samples.length) parts.sampling = 0;
    else {
      var flows = { S: 0, P: 0, W: 0 };
      samples.forEach(function (s) { flows[s.flow] = 1; });
      var cov = (flows.S + flows.P + (r.hasWht ? flows.W : 1)) / 3;
      var ev = samples.map(function (s) { return s.eval || E.evaluateSample(s); });
      var done = ev.reduce(function (a, e) { return a + (e.total ? e.tested / e.total : 0); }, 0) / ev.length;
      var dev = ev.reduce(function (a, e) { return a + (e.rate || 0); }, 0) / ev.length / 100;
      parts.sampling = Math.max(0, cov * done * (1 - Math.min(1, dev * 3)));
    }
    var cl = r.checklist || [];
    var req = cl.filter(function (c) { return c.status !== 'na'; });
    parts.checklist = req.length ? req.filter(function (c) { return c.status === 'available'; }).length / req.length : 0;
    var open = (r.findings || []).filter(function (f) { return f.status !== 'closed'; });
    var pen = open.reduce(function (a, f) { return a + ({ critical: 0.5, high: 0.25, medium: 0.1, low: 0.03 }[f.severity] || 0.05); }, 0);
    parts.findings = Math.max(0, 1 - pen);
    var total = 0, wsum = 0;
    Object.keys(W).forEach(function (k) { if (parts[k] != null) { total += parts[k] * W[k]; wsum += W[k]; } });
    var sc = wsum ? Math.round(total / wsum * 100) : 0;
    return { score: sc, parts: parts, grade: sc >= 85 ? 'ready' : sc >= 70 ? 'mostly' : sc >= 50 ? 'risk' : 'not' };
  };

  // One call that runs everything for an exercise.
  E.runAll = function (ctx) {
    ctx.settings = E.mergeSettings(ctx.settings);
    var vat = E.runVatRecon(ctx), wht = E.runWhtRecon(ctx), bank = E.runBankRecon(ctx), an = E.runAnalytics(ctx);
    (ctx.checkNotes ? Object.keys(ctx.checkNotes) : []).forEach(function () {});
    var res = { vat: vat, wht: wht, bank: bank, analytics: an };
    res.score = E.readiness({
      settings: ctx.settings, vat: vat.checks, wht: (ctx.entity && ctx.entity.whtRegistered === false) ? [] : wht.checks, bank: bank.checks, analytics: an.tests,
      samples: ctx.samples, checklist: ctx.checklist, findings: ctx.findings, hasWht: !(ctx.entity && ctx.entity.whtRegistered === false)
    });
    var exp = 0;
    vat.checks.concat(wht.checks, bank.checks).forEach(function (c) { if (c.exposure) exp += c.exposure; });
    res.exposure = r2(exp);
    return res;
  };

  root.ZEngine = E;
  if (typeof module !== 'undefined' && module.exports) module.exports = E;
})(typeof window !== 'undefined' ? window : this);
