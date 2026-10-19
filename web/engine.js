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
    // VAT IR Art. 63 (amended 23 June 2023): net error >= SAR 15,000 -> amend the
    // original return within 20 days of becoming aware; below it -> include in the
    // return for the period of discovery; overstatements -> deduct within 5 years.
    vatCorrectionThreshold: 15000,
    correctionNotifyDays: 20,
    overstatementYears: 5,
    refundMin: 5000,                 // minimum refund application (2025 amendment)
    einv: { simplifiedHours: 24, standardMinutes: 60 },
    blockedKeywords: 'entertainment,hospitality,restaurant,catering,banquet,party,hotel,club membership,gym,cinema,concert,tickets for staff,alcohol,personal use,car purchase,vehicle purchase,land cruiser,ترفيه,ضيافة,مطعم,تموين,حفل,فندق,اشتراك نادي,شراء سيارة',
    giftRelief: { perRecipient: 200, annualCap: 50000 },   // IR Art. 15
    trend: { salesDropPct: 25, inputJumpPct: 40, zeroShareJumpPts: 15, inputOutputMax: 90 },
    // Electronic marketplaces as deemed supplier (VAT IR Art. 47, amended 2025)
    marketplace: { nonResidentFrom: '2025-04-18', residentUnregisteredFrom: '2026-01-01',
      payoutKeywords: 'noon,amazon,salla,zid,jahez,hungerstation,careem,talabat,mrsool,the chefz,keeta,toyou,نون,أمازون,سلة,زد,جاهز,هنقرستيشن' },
    // RETT Law (Royal Decree M/84) and Implementing Regulations, effective April 2025:
    // 5%, due within 30 days of the transaction date.
    rett: { rate: 0.05, latePctPerMonth: 0.02, dueDays: 30 },
    exciseRates: { tobacco: 1, energy: 1, ecig: 1, sweetened: 0.5 },
    // Excise IR amended 29 Dec 2025: from 1 Jan 2026 sweetened (incl. carbonated)
    // drinks pay a fixed SAR per litre by sugar per 100 ml instead of 50%.
    sugarTiers: { from: '2026-01-01', tiers: [[0, 5, 0], [5, 8, 0.79], [8, 1000, 1.09]] },
    // Zakat IR Art. 17: return and payment within 120 days of the year end.
    zakat: { rate: 0.025, gregorianDays: 365, dueDays: 120, latePctPer30Days: 0.01, lateCap: 0.25 },
    // Objection to ZATCA within 60 days of an assessment; appeal of a committee decision within 30.
    disputes: { objectionDays: 60, appealDays: 30 },
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
    weights: { recon: 30, bank: 10, einv: 10, filing: 10, other: 5, analytics: 10, sampling: 12, checklist: 10, findings: 8 }
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
        { k: 'total', t: 'n', syn: ['total', 'gross', 'amount incl vat', 'الإجمالي', 'المبلغ شامل الضريبة'] },
        { k: 'description', t: 's', syn: ['description', 'item', 'narration', 'line description', 'الوصف', 'البيان'] },
        { k: 'account', t: 's', syn: ['gl account', 'expense account', 'account', 'حساب المصروف', 'الحساب'] },
        { k: 'exportRef', t: 's', syn: ['export declaration', 'export ref', 'customs export', 'bill of lading', 'بيان التصدير', 'بوليصة الشحن'] },
        { k: 'channel', t: 's', syn: ['channel', 'sales channel', 'platform', 'marketplace', 'القناة', 'المنصة'] }
      ]
    },
    mkt_sales: {
      en: 'Marketplace sales by third-party sellers (if you operate a platform)', ar: 'مبيعات البائعين عبر منصتك (إن كنت تشغل منصة)', group: 'other',
      fields: [
        { k: 'date', t: 'd', req: 1, syn: ['date', 'order date', 'التاريخ'] },
        { k: 'order', t: 's', syn: ['order', 'order no', 'reference', 'رقم الطلب'] },
        { k: 'seller', t: 's', req: 1, syn: ['seller', 'merchant', 'vendor', 'البائع', 'التاجر'] },
        { k: 'sellerVat', t: 's', syn: ['seller vat', 'merchant vat', 'seller trn', 'الرقم الضريبي للبائع'] },
        { k: 'sellerResident', t: 's', syn: ['resident', 'seller resident', 'مقيم'] },
        { k: 'category', t: 's', syn: ['category', 'supply type', 'type', 'نوع التوريد'] },
        { k: 'gross', t: 'n', req: 1, syn: ['gross', 'amount', 'order value', 'المبلغ', 'قيمة الطلب'] },
        { k: 'vat', t: 'n', syn: ['vat', 'vat charged', 'tax', 'الضريبة'] }
      ]
    },
    rett: {
      en: 'Real estate disposals (RETT register)', ar: 'سجل التصرفات العقارية (ضريبة التصرفات)', group: 'other',
      fields: [
        { k: 'date', t: 'd', req: 1, syn: ['deed date', 'transfer date', 'date', 'تاريخ الإفراغ', 'التاريخ'] },
        { k: 'deed', t: 's', syn: ['deed', 'deed no', 'رقم الصك'] },
        { k: 'property', t: 's', req: 1, syn: ['property', 'description', 'العقار', 'الوصف'] },
        { k: 'buyer', t: 's', syn: ['buyer', 'transferee', 'المشتري'] },
        { k: 'value', t: 'n', req: 1, syn: ['value', 'price', 'disposal value', 'القيمة', 'السعر'] },
        { k: 'rett', t: 'n', syn: ['rett', 'rett paid', 'tax paid', 'الضريبة المسددة'] },
        { k: 'paidOn', t: 'd', syn: ['paid on', 'payment date', 'تاريخ السداد'] },
        { k: 'exemption', t: 's', syn: ['exemption', 'exemption ref', 'الإعفاء'] }
      ]
    },
    excise: {
      en: 'Excise goods register', ar: 'سجل السلع الانتقائية', group: 'other',
      fields: [
        { k: 'date', t: 'd', syn: ['date', 'release date', 'التاريخ'] },
        { k: 'product', t: 's', req: 1, syn: ['product', 'item', 'sku', 'المنتج', 'الصنف'] },
        { k: 'category', t: 's', req: 1, syn: ['category', 'excise category', 'الفئة'] },
        { k: 'qty', t: 'n', req: 1, syn: ['quantity', 'qty', 'units', 'الكمية'] },
        { k: 'retailPrice', t: 'n', req: 1, syn: ['retail price', 'retail selling price', 'unit price', 'سعر التجزئة'] },
        { k: 'standardPrice', t: 'n', syn: ['standard price', 'zatca price', 'السعر المعياري'] },
        { k: 'rate', t: 'n', syn: ['rate', 'excise rate', 'النسبة'] },
        { k: 'litres', t: 'n', syn: ['litres', 'liters', 'volume', 'total litres', 'لتر', 'الحجم'] },
        { k: 'sugar', t: 'n', syn: ['sugar', 'sugar g/100ml', 'sugar per 100 ml', 'السكر'] },
        { k: 'excise', t: 'n', req: 1, syn: ['excise', 'excise declared', 'excise amount', 'الضريبة الانتقائية'] }
      ]
    },
    excise_stock: {
      en: 'Excise designated-zone stock movements', ar: 'حركة مخزون السلع الانتقائية في المستودع المحدد', group: 'other',
      fields: [
        { k: 'product', t: 's', req: 1, syn: ['product', 'item', 'sku', 'المنتج', 'الصنف'] },
        { k: 'category', t: 's', syn: ['category', 'excise category', 'الفئة'] },
        { k: 'opening', t: 'n', syn: ['opening', 'opening stock', 'رصيد أول المدة'] },
        { k: 'received', t: 'n', syn: ['received', 'imported', 'produced', 'in', 'الوارد'] },
        { k: 'released', t: 'n', syn: ['released', 'released for consumption', 'out', 'المفرج عنه'] },
        { k: 'exported', t: 'n', syn: ['exported', 'transferred', 'المصدر'] },
        { k: 'closing', t: 'n', syn: ['closing', 'counted', 'closing stock', 'الجرد', 'رصيد آخر المدة'] },
        { k: 'retailPrice', t: 'n', syn: ['retail price', 'unit price', 'سعر التجزئة'] }
      ]
    },
    einv_provider: {
      en: 'E-invoicing provider export (3rd-party system)', ar: 'تقرير مزود الفوترة الإلكترونية (النظام الوسيط)', group: 'vat',
      fields: [
        { k: 'invoice', t: 's', req: 1, syn: ['invoice', 'invoice no', 'invoice number', 'document no', 'رقم الفاتورة'] },
        { k: 'type', t: 's', syn: ['invoice type', 'type', 'subtype', 'b2b/b2c', 'transaction type', 'نوع الفاتورة'] },
        { k: 'docType', t: 's', syn: ['document type', 'doc type', 'نوع المستند'] },
        { k: 'issuedAt', t: 't', syn: ['issue date', 'issued at', 'issue time', 'invoice date', 'تاريخ الإصدار'] },
        { k: 'submittedAt', t: 't', syn: ['submitted at', 'submission date', 'sent to zatca', 'reported at', 'cleared at', 'clearance date', 'تاريخ الإرسال'] },
        { k: 'status', t: 's', syn: ['zatca status', 'status', 'clearance status', 'reporting status', 'الحالة'] },
        { k: 'icv', t: 'n', syn: ['icv', 'invoice counter', 'counter value', 'عداد الفاتورة'] },
        { k: 'egs', t: 's', syn: ['egs', 'egs unit', 'device', 'unit', 'pos', 'الجهاز', 'الوحدة'] },
        { k: 'uuid', t: 's', syn: ['uuid'] },
        { k: 'buyerVat', t: 's', syn: ['buyer vat', 'customer vat', 'buyer trn', 'الرقم الضريبي للمشتري'] },
        { k: 'ref', t: 's', syn: ['billing reference', 'original invoice', 'reference invoice', 'ref', 'الفاتورة الأصلية'] },
        { k: 'net', t: 'n', syn: ['net', 'taxable amount', 'amount excl vat', 'المبلغ الخاضع', 'الصافي'] },
        { k: 'vat', t: 'n', syn: ['vat', 'vat amount', 'tax amount', 'الضريبة', 'مبلغ الضريبة'] },
        { k: 'message', t: 's', syn: ['message', 'error', 'validation', 'warning', 'الرسالة', 'الخطأ'] },
        { k: 'qr', t: 's', syn: ['qr', 'qr code', 'qr base64', 'رمز الاستجابة'] }
      ]
    },
    pos: {
      en: 'POS / mada settlement reports', ar: 'تقارير تسويات نقاط البيع / مدى', group: 'bank',
      fields: [
        { k: 'date', t: 'd', req: 1, syn: ['date', 'settlement date', 'التاريخ'] },
        { k: 'terminal', t: 's', syn: ['terminal', 'tid', 'device', 'الجهاز', 'رقم الجهاز'] },
        { k: 'reference', t: 's', syn: ['batch', 'reference', 'settlement no', 'رقم التسوية'] },
        { k: 'gross', t: 'n', req: 1, syn: ['gross', 'sales', 'total', 'amount', 'الإجمالي', 'المبيعات'] },
        { k: 'fees', t: 'n', syn: ['fees', 'commission', 'mdr', 'الرسوم', 'العمولة'] },
        { k: 'net', t: 'n', syn: ['net', 'settled', 'net amount', 'الصافي', 'المبلغ المسوى'] }
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

  // 'YYYY-MM-DDTHH:MM' or ''. Used for e-invoicing issue / submission times.
  E.datetime = function (v) {
    if (v == null || v === '') return '';
    if (v instanceof Date && !isNaN(v)) return iso(v.getFullYear(), v.getMonth() + 1, v.getDate()) + 'T' + pad(v.getHours()) + ':' + pad(v.getMinutes());
    if (typeof v === 'number' && v > 20000 && v < 80000) { var d = new Date(Math.round((v - 25569) * 86400000)); return d.toISOString().slice(0, 16); }
    var s = deArabic(v).trim(), m;
    if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})/))) return m[1] + '-' + m[2] + '-' + m[3] + 'T' + pad(+m[4]) + ':' + m[5];
    if ((m = s.match(/^(\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4})[ T]+(\d{1,2}):(\d{2})/))) { var dd = E.date(m[1]); return dd ? dd + 'T' + pad(+m[2]) + ':' + m[3] : ''; }
    var d0 = E.date(v);
    return d0 ? d0 + 'T00:00' : '';
  };
  function minutesBetween(a, b) { return Math.round((Date.parse(b + ':00Z') - Date.parse(a + ':00Z')) / 60000); }
  E.minutesBetween = minutesBetween;

  E.invType = function (v) {
    var s = String(v || '').toLowerCase();
    if (/simpl|b2c|0200|مبسط/.test(s)) return 'simplified';
    if (/stand|b2b|tax invoice|0100|قياسي|ضريبية/.test(s)) return 'standard';
    return '';
  };
  E.einvStatus = function (v) {
    var s = String(v || '').toLowerCase();
    if (/reject|fail|error|مرفوض|رفض|خطأ/.test(s)) return 'REJECTED';
    if (/warn|تحذير/.test(s)) return 'WARNING';
    if (/clear|معتمد|اعتماد/.test(s)) return 'CLEARED';
    if (/report|مبلغ|إبلاغ|ابلاغ/.test(s)) return 'REPORTED';
    if (/pend|queue|انتظار|معلق/.test(s)) return 'PENDING';
    if (/not sent|not submitted|لم ي/.test(s)) return 'NOT_SUBMITTED';
    return s ? s.toUpperCase() : '';
  };

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
        else if (f.t === 't') o[f.k] = E.datetime(v);
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
      if (kind === 'einv_provider') { o.type = E.invType(o.type); o.status = E.einvStatus(o.status); o.docType = E.docType(o.docType); }
      if (kind === 'einv') o.status = E.einvStatus(o.status) || o.status;
      if (kind === 'excise' && o.rate > 1) o.rate = o.rate / 100;
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
        var days = daysBetween(due, x.paidDate), per = days < 30 ? 0 : Math.floor(days / 30);
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
    if (ctx.priorPurchaseKeys && Object.keys(ctx.priorPurchaseKeys).length) T('A18', 'Purchase invoices already claimed in an earlier period', 'فواتير مشتريات سبق المطالبة بها في فترة سابقة', 'high',
      purch.filter(function (x) { return (+x.vat || 0) > 0 && ctx.priorPurchaseKeys[purchaseKey(x)]; }).map(function (x) { return Object.assign({}, x, { reason: 'Same supplier and invoice number claimed in ' + ctx.priorPurchaseKeys[purchaseKey(x)] }); }),
      'Input VAT can be deducted once. An invoice already in an earlier return is a double claim.');
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
    if (sales.some(function (x) { return x.exportRef; })) T('A17', 'Exports without a customs export declaration reference', 'صادرات بدون مرجع بيان تصدير جمركي', 'high',
      sales.filter(function (x) { return x.category === 'X' && !x.exportRef; }), 'Zero-rating an export needs customs evidence that the goods left KSA (VAT IR Art. 33); without it the sale is standard-rated.', 'net');
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

  // ------------------------------------------------------------------ e-invoicing: ERP ↔ provider ↔ ZATCA
  // Most taxpayers do not talk to Fatoora directly: a third-party provider (or
  // POS / middleware) receives the ERP's invoices, signs them and clears or
  // reports them. An inspector compares what the ERP sold, what the provider
  // received and what ZATCA holds. Every gap is an invoice ZATCA may treat as
  // not issued, or a sale that never reached the return.
  function invKey(v) { return String(v == null ? '' : v).trim().toUpperCase(); }
  var ACCEPTED = { CLEARED: 1, REPORTED: 1, WARNING: 1 };

  // Phase 2 integration: the entity records the date ZATCA notified for its wave.
  function waveCheck(ctx) {
    var e = ctx.entity || {}, today = ctx.today || new Date().toISOString().slice(0, 10);
    var c = { id: 'E10', group: 'einv', title: 'Phase 2 (Fatoora) integration by the notified wave date', titleAr: 'الربط مع منصة فاتورة (المرحلة الثانية) في موعد الموجة', b: null, bLabel: '', diff: null };
    if (!e.einvDeadline) { c.status = 'na'; c.missing = 'Integration wave date on the entity'; return c; }
    if (e.einvIntegratedOn) { var d = daysBetween(e.einvDeadline, e.einvIntegratedOn); c.status = d > 0 ? 'warn' : 'pass'; c.a = Math.max(0, d); c.aLabel = 'Days late'; c.note = d > 0 ? 'Integrated after the wave deadline; e-invoicing fines may apply to invoices issued in between.' : ''; }
    else { var o = daysBetween(e.einvDeadline, today); c.status = o > 0 ? 'fail' : 'warn'; c.a = Math.max(0, o); c.aLabel = 'Days late'; c.note = o > 0 ? 'Wave deadline passed and integration is not recorded.' : 'Integration due on ' + e.einvDeadline + (e.einvWave ? ' (' + e.einvWave + ')' : '') + '.'; }
    return c;
  }
  E.runEinvoicing = function (ctx) {
    var r0 = E.runEinvoicingCore(ctx);
    r0.checks.push(waveCheck(ctx));
    return r0;
  };
  E.runEinvoicingCore = function (ctx) {
    var S = ctx.settings, D = ctx.data, checks = [];
    var erp = (D.sys_vat || []).filter(function (x) { return x.flow === 'S'; });
    var prov = D.einv_provider || [], zat = D.einv || [];
    var T = function (id, title, titleAr, items, failIfAny, extra) {
      var c = { id: id, group: 'einv', title: title, titleAr: titleAr, a: items.length, aLabel: 'Exceptions', b: 0, bLabel: '', diff: items.length,
        status: items.length ? (failIfAny ? 'fail' : 'warn') : 'pass', exceptions: { list: items.slice(0, 300) }, counts: { list: items.length } };
      if (extra) Object.keys(extra).forEach(function (k) { c[k] = extra[k]; });
      return c;
    };
    if (!prov.length && !zat.length) {
      return { checks: [{ id: 'E1', group: 'einv', title: 'E-invoicing: system vs provider vs ZATCA', titleAr: 'الفوترة الإلكترونية: النظام مقابل المزود مقابل الهيئة', status: 'na', missing: 'E-invoicing provider export' }], summary: null };
    }
    var byErp = {}, byProv = {}, byZat = {};
    erp.forEach(function (x) { byErp[invKey(x.invoice)] = x; });
    prov.forEach(function (x) { byProv[invKey(x.invoice)] = x; });
    zat.forEach(function (x) { byZat[invKey(x.invoice)] = x; });
    var hub = prov.length ? byProv : byZat, hubName = prov.length ? 'provider' : 'ZATCA';

    checks.push(T('E1', 'ERP sales invoices that never reached the ' + hubName, 'فواتير مبيعات في النظام لم تصل إلى ' + (prov.length ? 'المزود' : 'الهيئة'),
      erp.filter(function (x) { return !hub[invKey(x.invoice)]; }).map(function (x) { return Object.assign({}, x, { reason: 'Not in ' + hubName + ' export' }); }), true));
    checks.push(T('E2', 'Invoices at the ' + hubName + ' that are not in the ERP (issued outside the books)', 'فواتير لدى ' + (prov.length ? 'المزود' : 'الهيئة') + ' غير موجودة في النظام',
      (prov.length ? prov : zat).filter(function (x) { return !byErp[invKey(x.invoice)]; }).map(function (x) { return Object.assign({}, x, { reason: 'Sale may be missing from the return' }); }), true,
      { note: 'POS, branch or manual invoices sent to ZATCA but not booked are sales ZATCA can see and the return may not include.' }));
    if (prov.length) {
      var notAccepted = prov.filter(function (x) { return !ACCEPTED[x.status]; }).map(function (x) { return Object.assign({}, x, { reason: x.status ? 'Status ' + x.status + (x.message ? ': ' + x.message : '') : 'No ZATCA status' }); });
      if (zat.length) prov.forEach(function (x) { if (ACCEPTED[x.status] && !byZat[invKey(x.invoice)]) notAccepted.push(Object.assign({}, x, { reason: 'Provider shows ' + x.status + ' but ZATCA has no record' })); });
      checks.push(T('E3', 'Invoices not cleared / reported by ZATCA (rejected, pending, not sent)', 'فواتير لم تُعتمد أو يُبلغ عنها لدى الهيئة',
        notAccepted, true, { note: 'A rejected or unsent invoice is legally not a valid tax invoice. Fix and resubmit; repeated failures attract e-invoicing fines.' }));
    }
    var mism = [];
    Object.keys(byErp).forEach(function (k) {
      var e = byErp[k], p = byProv[k], z = byZat[k];
      [[p, 'provider'], [z, 'ZATCA']].forEach(function (pair) {
        var o = pair[0]; if (!o) return;
        var dv = r2((+e.vat || 0) - (+o.vat || 0)), dn = o.net == null || o.net === 0 && !e.net ? 0 : r2((+e.net || 0) - (+o.net || 0));
        if (Math.abs(dv) > S.tolAbs || Math.abs(dn) > S.tolAbs) mism.push({ invoice: e.invoice, date: e.date, party: e.party, net: e.net, vat: e.vat, other: pair[1], otherNet: o.net, otherVat: o.vat, reason: 'VAT differs by ' + dv + ' (' + pair[1] + ')' });
      });
    });
    checks.push(T('E4', 'Amounts differ between ERP, provider and ZATCA', 'اختلاف المبالغ بين النظام والمزود والهيئة', mism, true));
    if (prov.length) {
      var hrs = (S.einv && S.einv.simplifiedHours) || 24, mins = (S.einv && S.einv.standardMinutes) || 60, late = [];
      prov.forEach(function (x) {
        if (!x.issuedAt || !x.submittedAt) return;
        var m = minutesBetween(x.issuedAt, x.submittedAt), type = x.type || (E.validVatNo(x.buyerVat) ? 'standard' : 'simplified');
        if (type === 'simplified' && m > hrs * 60) late.push(Object.assign({}, x, { reason: 'Reported ' + Math.round(m / 60) + ' h after issue (limit ' + hrs + ' h)' }));
        if (type === 'standard' && m > mins) late.push(Object.assign({}, x, { reason: 'Cleared ' + Math.round(m / 60 * 10) / 10 + ' h after issue — a standard invoice must be cleared before it is shared' }));
      });
      checks.push(T('E5', 'Clearance / reporting time limits', 'المهل الزمنية للاعتماد والإبلاغ', late, true,
        { note: 'Standard (B2B) invoices are cleared before sharing; simplified (B2C) invoices are reported within ' + hrs + ' hours.' }));
      var byEgs = {}, chain = [];
      prov.forEach(function (x) { if (x.icv) (byEgs[x.egs || 'default'] = byEgs[x.egs || 'default'] || []).push(x); });
      Object.keys(byEgs).forEach(function (g) {
        var a = byEgs[g].slice().sort(function (p, q) { return p.icv - q.icv; });
        for (var i = 1; i < a.length; i++) {
          var d = a[i].icv - a[i - 1].icv;
          if (d === 0) chain.push({ egs: g, invoice: a[i].invoice, icv: a[i].icv, reason: 'Counter repeated (also ' + a[i - 1].invoice + ')' });
          else if (d > 1) chain.push({ egs: g, invoice: a[i].invoice, icv: a[i].icv, reason: (d - 1) + ' counter value(s) missing before this invoice' });
        }
      });
      checks.push(T('E6', 'Invoice counter (ICV) continuity per EGS unit', 'تسلسل عداد الفواتير لكل وحدة إصدار', chain, true,
        { note: 'Each EGS unit must number invoices with an unbroken counter and hash chain; a gap means an invoice was generated and never submitted.' }));
    }
    var notes = (prov.length ? prov : erp).filter(function (x) { return x.docType === 'CN' || x.docType === 'DN'; });
    var refs = Object.assign({}, byErp, byProv);
    checks.push(T('E7', 'Credit / debit notes without a valid reference to the original invoice', 'إشعارات دائنة/مدينة بدون مرجع صحيح للفاتورة الأصلية',
      notes.filter(function (x) { return !x.ref || !refs[invKey(x.ref)]; }).map(function (x) { return Object.assign({}, x, { reason: x.ref ? 'Reference ' + x.ref + ' not found' : 'No billing reference' }); }), true));
    if (prov.length) {
      var typ = [];
      prov.forEach(function (x) {
        var buyer = x.buyerVat || (byErp[invKey(x.invoice)] || {}).vatNo;
        if (x.type === 'simplified' && E.validVatNo(buyer)) typ.push(Object.assign({}, x, { reason: 'Customer has a TRN — a standard (cleared) tax invoice is required' }));
        if (x.type === 'standard' && !E.validVatNo(buyer) && buyer) typ.push(Object.assign({}, x, { reason: 'Standard invoice with an invalid buyer TRN' }));
      });
      checks.push(T('E8', 'Invoice type matches the customer (standard for B2B)', 'نوع الفاتورة يطابق العميل (قياسية للشركات)', typ, false));
      checks.push(T('E9', 'Accepted with warnings', 'مقبولة مع تحذيرات', prov.filter(function (x) { return x.status === 'WARNING'; }), false,
        { note: 'Warnings do not block clearance but are visible to ZATCA and usually point at a data-quality issue.' }));
    }
    var summary = { erp: erp.length, provider: prov.length, zatca: zat.length, byStatus: {} };
    prov.forEach(function (x) { summary.byStatus[x.status || '—'] = (summary.byStatus[x.status || '—'] || 0) + 1; });
    return { checks: checks, summary: summary };
  };

  // ------------------------------------------------------------------ filing & payment compliance
  // ctx.filing = { vatFiledOn, vatPaidOn, vatPaidAmount, whtFiledOn, whtPaidOn, whtPaidAmount }
  E.runFiling = function (ctx) {
    var S = ctx.settings, F = ctx.filing || {}, P = S.penalties, checks = [];
    var dl = E.deadlines(ctx.periodKey), ret = ctx.returnBoxes ? E.completeBoxes(JSON.parse(JSON.stringify(ctx.returnBoxes)), true) : null;
    var due = ret ? +ret[16].vat || 0 : null, today = ctx.today || new Date().toISOString().slice(0, 10);
    var monthsOrPart = function (a, b) { var d = daysBetween(a, b); return d <= 0 ? 0 : Math.ceil(d / 30); };
    var C = function (id, title, titleAr, status, a, aLabel, extra) { var c = { id: id, group: 'filing', title: title, titleAr: titleAr, status: status, a: a, aLabel: aLabel, b: null, bLabel: '', diff: null }; Object.keys(extra || {}).forEach(function (k) { c[k] = extra[k]; }); return c; };
    if (!F.vatFiledOn) checks.push(C('C1', 'VAT return filed by the deadline (' + dl.vat + ')', 'تقديم إقرار القيمة المضافة في موعده', 'na', null, '', { missing: 'Filing date' }));
    else {
      var lf = daysBetween(dl.vat, F.vatFiledOn);
      checks.push(C('C1', 'VAT return filed by the deadline (' + dl.vat + ')', 'تقديم إقرار القيمة المضافة في موعده', lf > 0 ? 'fail' : 'pass', lf > 0 ? lf : 0, 'Days late',
        { exposure: lf > 0 && due > 0 ? r2(due * P.vatLateFilingMinPct) : 0, note: lf > 0 ? 'Late filing: ' + Math.round(P.vatLateFilingMinPct * 100) + '%–' + Math.round(P.vatLateFilingMaxPct * 100) + '% of the tax due (minimum shown).' : '' }));
    }
    if (due != null && due <= 0) {
      checks.push(C('C2', 'VAT paid in full by the deadline', 'سداد الضريبة كاملة في موعدها', 'pass', 0, 'Nothing payable'));
      if (due < 0) checks.push(C('C4', 'Refund / credit position', 'مركز استرداد / رصيد دائن', 'warn', r2(-due), 'Credit claimed',
        { note: 'ZATCA reviews refund claims before paying (minimum application SAR ' + (S.refundMin || 5000).toLocaleString('en-US') + '). Expect a desk review of input VAT: keep every purchase invoice and customs declaration ready.' }));
    } else if (!F.vatPaidOn) checks.push(C('C2', 'VAT paid in full by the deadline', 'سداد الضريبة كاملة في موعدها', due == null ? 'na' : today > dl.vat ? 'fail' : 'warn', due, 'Due', { missing: due == null ? 'VAT return' : '', exposure: today > dl.vat && due > 0 ? r2(due * P.vatLatePaymentPctPerMonth * monthsOrPart(dl.vat, today)) : 0, note: today > dl.vat ? 'No payment recorded and the deadline has passed.' : 'Record the SADAD payment date.' }));
    else {
      var paid = F.vatPaidAmount === '' || F.vatPaidAmount == null ? due : +F.vatPaidAmount, short = r2(Math.max(0, due - paid));
      var ml = monthsOrPart(dl.vat, F.vatPaidOn), exp = r2(paid * P.vatLatePaymentPctPerMonth * ml + short * P.vatLatePaymentPctPerMonth * monthsOrPart(dl.vat, today));
      checks.push(C('C2', 'VAT paid in full by the deadline', 'سداد الضريبة كاملة في موعدها', ml || short > S.tolAbs ? 'fail' : 'pass', short || (ml ? daysBetween(dl.vat, F.vatPaidOn) : 0), short ? 'Unpaid' : 'Days late',
        { exposure: exp, note: ml ? 'Late payment: ' + Math.round(P.vatLatePaymentPctPerMonth * 100) + '% of the unpaid tax for each month or part (' + ml + ').' : short ? 'Paid less than the return shows.' : '' }));
    }
    if (ctx.whtApplies) {
      var wTax = ctx.whtTax || 0;
      if (!F.whtPaidOn && !F.whtFiledOn) checks.push(C('C3', 'WHT return filed and paid by ' + dl.wht, 'تقديم وسداد إقرار الاستقطاع قبل ' + dl.wht, 'na', null, '', { missing: 'WHT filing / payment date' }));
      else {
        var last = [F.whtFiledOn, F.whtPaidOn].filter(Boolean).sort().pop(), days = daysBetween(dl.wht, last);
        var fine = days < 30 ? 0 : r2(wTax * P.whtLatePctPer30Days * Math.floor(days / 30));
        checks.push(C('C3', 'WHT return filed and paid by ' + dl.wht, 'تقديم وسداد إقرار الاستقطاع قبل ' + dl.wht, days > 0 ? (days < 30 ? 'warn' : 'fail') : 'pass', days > 0 ? days : 0, 'Days late',
          { exposure: fine, note: days > 0 ? (days < 30 ? 'Late, but under 30 days: no delay fine (IR Art. 68).' : '1% of the tax for each 30 days of delay.') : '' }));
      }
    }
    return { checks: checks };
  };

  // ------------------------------------------------------------------ cross-tax: reverse charge ↔ withholding
  // A service bought from a non-resident usually triggers both: VAT under the
  // reverse charge (box 9) and WHT. Each tax's records should name the other.
  var NO_RCM = { dividends: 1, loan_returns: 1, insurance: 1, air_tickets_freight: 1 };
  function partyKey(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9؀-ۿ]/g, '').slice(0, 10); }
  E.runCrossTax = function (ctx) {
    var S = ctx.settings, D = ctx.data, checks = [];
    var rcm = (D.sys_vat || []).filter(function (x) { return x.flow === 'P' && x.category === 'RCM'; }), reg = D.wht_reg || [];
    if (!rcm.length && !reg.length) return { checks: [] };
    var regK = {}, rcmK = {};
    reg.forEach(function (w) { regK[partyKey(w.party)] = 1; });
    rcm.forEach(function (x) { rcmK[partyKey(x.party)] = 1; });
    var x1 = rcm.filter(function (x) { return !regK[partyKey(x.party)]; }).map(function (x) { return Object.assign({}, x, { reason: 'Reverse-charged service with no WHT line' }); });
    var x2 = reg.filter(function (w) { return !NO_RCM[w.paymentType] && !rcmK[partyKey(w.party)]; }).map(function (w) { return Object.assign({}, w, { reason: 'Non-resident service with no reverse-charge VAT' }); });
    var rate = S.vatRate, low = S.whtRates.technical_services || 0.05;
    checks.push({ id: 'X1', group: 'wht', title: 'Reverse-charge purchases without WHT', titleAr: 'مشتريات بالاحتساب العكسي بدون ضريبة استقطاع',
      status: !rcm.length ? 'na' : x1.length ? 'fail' : 'pass', missing: rcm.length ? '' : 'Reverse-charge purchases', a: r2(x1.reduce(function (s, x) { return s + (+x.net || 0); }, 0)), aLabel: 'Paid to non-residents, no WHT', b: 0, bLabel: '',
      exceptions: { list: x1 }, counts: { list: x1.length }, exposure: r2(x1.reduce(function (s, x) { return s + (+x.net || 0) * low; }, 0)), note: 'Exposure at the lowest WHT rate (5%); management fees, royalties and head-office services are 15–20%.' });
    checks[0].diff = checks[0].a;
    checks.push({ id: 'X2', group: 'wht', title: 'WHT payments without reverse-charge VAT', titleAr: 'مدفوعات استقطاع بدون ضريبة احتساب عكسي',
      status: !reg.length ? 'na' : x2.length ? 'fail' : 'pass', missing: reg.length ? '' : 'WHT register', a: r2(x2.reduce(function (s, w) { return s + (+w.gross || 0); }, 0)), aLabel: 'Services with no box 9 VAT', b: 0, bLabel: '',
      exceptions: { list: x2 }, counts: { list: x2.length }, exposure: r2(x2.reduce(function (s, w) { return s + (+w.gross || 0) * rate; }, 0)), note: 'Undeclared reverse-charge VAT is an incorrect return even when the same VAT is recoverable (penalty on the difference).' });
    checks[1].diff = checks[1].a;
    return { checks: checks };
  };

  // ------------------------------------------------------------------ input VAT recovery
  // ctx.recovery = { method: 'none'|'standard'|'special', directExemptVat, commonVat, ratioUsed }
  E.runRecovery = function (ctx) {
    var S = ctx.settings, D = ctx.data, map = (ctx.entity && ctx.entity.mapping) || {}, checks = [], rc = ctx.recovery || {};
    var purch = (D.sys_vat || []).filter(function (x) { return x.flow === 'P' && /^(S|IMP|RCM)$/.test(x.category) && (+x.vat || 0) > 0; });
    var hasDesc = purch.some(function (x) { return x.description || x.account; });
    var keys = String(S.blockedKeywords || '').toLowerCase().split(',').map(function (k) { return k.trim(); }).filter(Boolean);
    var blocked = purch.filter(function (x) { var d = (String(x.description || '') + ' ' + String(x.account || '') + ' ' + String(x.party || '')).toLowerCase(); return keys.some(function (k) { return d.indexOf(k) >= 0; }); })
      .map(function (x) { return Object.assign({}, x, { reason: 'Matches a blocked category (entertainment, hospitality, restricted vehicles…)' }); });
    var bv = r2(blocked.reduce(function (s, x) { return s + (+x.vat || 0); }, 0));
    checks.push({ id: 'V10', group: 'vat', title: 'Input VAT on blocked items', titleAr: 'ضريبة مدخلات على بنود غير قابلة للخصم', status: !purch.length ? 'na' : !hasDesc ? 'na' : blocked.length ? 'fail' : 'pass',
      missing: !purch.length ? 'System VAT report' : !hasDesc ? 'Purchase descriptions (optional column)' : '', a: bv, aLabel: 'Input VAT claimed', b: 0, bLabel: '', diff: bv, exposure: bv,
      exceptions: { list: blocked }, counts: { list: blocked.length }, note: 'Entertainment, hospitality, catering, cultural/sports services and restricted vehicles are not deductible (VAT IR Art. 50). Keywords are editable in Settings.' });

    var B = ctx.returnBoxes ? E.completeBoxes(JSON.parse(JSON.stringify(ctx.returnBoxes)), true) : (D.sys_vat && D.sys_vat.length ? E.boxesFromSystem(D.sys_vat) : null);
    if (B) {
      var taxable = [1, 2, 3, 4].reduce(function (s, n) { return s + (+B[n].amount || 0) + (+B[n].adj || 0); }, 0), exempt = (+B[5].amount || 0) + (+B[5].adj || 0);
      var ratio = taxable + exempt > 0 ? taxable / (taxable + exempt) : 1, inVat = +B[12].vat || 0;
      var c = { id: 'V11', group: 'vat', title: 'Input VAT apportionment for exempt supplies', titleAr: 'تخصيص ضريبة المدخلات للتوريدات المعفاة', a: Math.round(ratio * 10000) / 100, aLabel: 'Recoverable % (taxable ÷ total supplies)', b: rc.ratioUsed === '' || rc.ratioUsed == null ? null : +rc.ratioUsed, bLabel: 'Ratio applied %', ratio: ratio, exemptSales: r2(exempt) };
      if (exempt <= 0) { c.status = 'pass'; c.note = 'No exempt supplies this period: full recovery is allowed.'; c.b = null; }
      else if (!rc.method || rc.method === 'none') {
        c.status = 'fail'; c.exposure = r2(inVat * (1 - ratio)); c.diff = c.exposure;
        c.note = 'Exempt sales of SAR ' + r2(exempt).toLocaleString('en-US') + ' but no apportionment recorded. Input VAT on common costs must be restricted to the taxable share (VAT IR Art. 51). Exposure shown is the upper bound (all input VAT treated as common).';
      } else {
        var dir = +rc.directExemptVat || 0, com = +rc.commonVat || 0, disallowed = r2(dir + com * (1 - ratio));
        c.exposure = 0; c.disallowed = disallowed;
        var used = rc.ratioUsed === '' || rc.ratioUsed == null ? null : +rc.ratioUsed;
        c.status = used != null && Math.abs(used - ratio * 100) > 1 ? 'warn' : 'pass';
        c.diff = used == null ? null : r2(used - ratio * 100);
        c.note = 'Disallowed this period: SAR ' + disallowed.toLocaleString('en-US') + ' (direct exempt + common × exempt share). Recompute the ratio on actual annual supplies at year end.';
      }
      checks.push(c);
    }
    if (map.gifts) {
      var gm = E.accountMatcher(map.gifts), gifts = 0;
      (D.gl || []).forEach(function (x) { if (gm(x.account)) gifts += (+x.debit || 0) - (+x.credit || 0); });
      if (!D.gl || !D.gl.length) { var tm = E.tbMovement(D.tb, map.gifts, 'movement'); gifts = tm == null ? 0 : tm; }
      var relief = ((S.giftRelief && S.giftRelief.annualCap) || 50000) / 12, over = r2(Math.max(0, gifts - relief));
      checks.push({ id: 'V12', group: 'vat', title: 'Deemed supplies: gifts, samples and own use', titleAr: 'التوريدات الاعتبارية: الهدايا والعينات والاستخدام الخاص', status: gifts <= 0 ? 'pass' : over > 0 ? 'warn' : 'pass',
        a: r2(gifts), aLabel: 'Gifts & samples this period', b: r2(relief), bLabel: 'Monthly share of the SAR 50,000 relief', diff: over, exposure: r2(over * S.vatRate),
        note: 'Free goods above SAR ' + ((S.giftRelief && S.giftRelief.perRecipient) || 200) + ' per recipient per year (capped at SAR 50,000 a year) are deemed supplies: output VAT is due on them (VAT IR Art. 15).' });
    }
    return { checks: checks };
  };

  // ------------------------------------------------------------------ risk-engine trends
  // ZATCA's risk engine compares each return with the taxpayer's own history.
  // ctx.history: prior periods' summaries, newest first.
  E.periodFigures = function (B) {
    if (!B) return null;
    var sales = (+B[6].amount || 0) + (+B[6].adj || 0), zero = [3, 4, 5].reduce(function (s, n) { return s + (+B[n].amount || 0); }, 0);
    return { sales: r2(sales), outputVat: r2((+B[6].vat || 0) + (+B[9].vat || 0)), inputVat: r2(+B[12].vat || 0), netVat: r2(+B[16].vat || 0), zeroShare: sales ? r2(zero / sales * 100) : 0 };
  };
  E.runTrends = function (ctx) {
    var S = ctx.settings, T = S.trend || {}, hist = (ctx.history || []).filter(function (h) { return h && h.sales != null; }).slice(0, 3), tests = [];
    var B = ctx.returnBoxes ? E.completeBoxes(JSON.parse(JSON.stringify(ctx.returnBoxes)), true) : null, cur = E.periodFigures(B);
    var mk = function (id, title, titleAr, flag, value, avg, desc) {
      return { id: id, title: title, titleAr: titleAr, severity: 'medium', desc: desc, count: flag ? 1 : 0, amount: 0, status: !cur || hist.length < 2 ? 'na' : flag ? 'warn' : 'pass',
        items: flag ? [{ period: 'This period', value: value, average: avg, reason: desc }].concat(hist.map(function (h) { return { period: h.period, value: h[id === 'T1' ? 'sales' : id === 'T2' ? 'inputVat' : id === 'T3' ? 'zeroShare' : 'inputVat'] }; })) : [] };
    };
    if (!cur || hist.length < 2) {
      ['T1', 'T2', 'T3', 'T4'].forEach(function (id) { tests.push({ id: id, title: { T1: 'Sales against the last 3 periods', T2: 'Input VAT against the last 3 periods', T3: 'Zero-rated / exempt share against history', T4: 'Input VAT as a share of output VAT' }[id], titleAr: '', severity: 'medium', status: 'na', count: 0, amount: 0, items: [], desc: 'Needs this return and at least two earlier exercises.' }); });
      return tests;
    }
    var avg = function (k) { return hist.reduce(function (s, h) { return s + (+h[k] || 0); }, 0) / hist.length; };
    var aS = avg('sales'), aI = avg('inputVat'), aZ = avg('zeroShare');
    var drop = aS ? (aS - cur.sales) / aS * 100 : 0, jump = aI ? (cur.inputVat - aI) / aI * 100 : 0, zj = cur.zeroShare - aZ, io = cur.outputVat ? cur.inputVat / cur.outputVat * 100 : 0;
    tests.push(mk('T1', 'Sales against the last 3 periods', 'المبيعات مقارنة بآخر 3 فترات', drop > (T.salesDropPct || 25), cur.sales, r2(aS), 'Sales ' + (drop >= 0 ? 'fell ' : 'rose ') + Math.abs(Math.round(drop)) + '% against the average of the last ' + hist.length + ' periods.'));
    tests.push(mk('T2', 'Input VAT against the last 3 periods', 'ضريبة المدخلات مقارنة بآخر 3 فترات', jump > (T.inputJumpPct || 40), cur.inputVat, r2(aI), 'Input VAT ' + (jump >= 0 ? 'rose ' : 'fell ') + Math.abs(Math.round(jump)) + '% against the average.'));
    tests.push(mk('T3', 'Zero-rated / exempt share against history', 'حصة الصفرية والمعفاة مقارنة بالسابق', zj > (T.zeroShareJumpPts || 15), cur.zeroShare, r2(aZ), 'Zero-rated, export and exempt sales are ' + cur.zeroShare + '% of sales (average ' + r2(aZ) + '%).'));
    tests.push(mk('T4', 'Input VAT as a share of output VAT', 'ضريبة المدخلات كنسبة من المخرجات', io > (T.inputOutputMax || 90), r2(io), null, 'Input VAT is ' + Math.round(io) + '% of output VAT.'));
    return tests;
  };

  // ------------------------------------------------------------------ annual reconciliation
  // rows: one summary per period of the year. inputs: annual figures from outside
  // the returns (audited FS, Zakat / income tax return, annual GL, WHT statement).
  E.annualRecon = function (rows, inputs, S, expectedPeriods) {
    S = E.mergeSettings(S); inputs = inputs || {};
    var sum = function (k) { return r2(rows.reduce(function (s, r) { return s + (+r[k] || 0); }, 0)); };
    var tot = { sales: sum('sales'), outputVat: sum('outputVat'), inputVat: sum('inputVat'), netVat: sum('netVat'), whtTax: sum('whtTax') };
    var items = (inputs.items || []).reduce(function (s, i) { return s + (+i.amount || 0); }, 0);
    var line = function (key, label, labelAr, a, b, bLabel) {
      var l = { key: key, label: label, labelAr: labelAr, a: a, b: b === '' || b == null ? null : +b, bLabel: bLabel };
      l.diff = l.b == null ? null : r2(l.a - l.b);
      l.status = l.b == null ? 'na' : status(l.diff, Math.max(Math.abs(l.a), Math.abs(l.b)), S);
      return l;
    };
    var lines = [
      line('fs', 'Sales per VAT returns vs revenue per audited financial statements', 'المبيعات في الإقرارات مقابل الإيرادات في القوائم المالية المدققة', tot.sales + items, inputs.fsRevenue, 'Audited FS revenue'),
      line('zakat', 'Sales per VAT returns vs revenue per Zakat / income tax return', 'المبيعات في الإقرارات مقابل الإيرادات في إقرار الزكاة / الدخل', tot.sales + items, inputs.zakatRevenue, 'Zakat / CIT return revenue'),
      line('outvat', 'Output VAT per returns vs annual GL output VAT', 'ضريبة المخرجات في الإقرارات مقابل الأستاذ السنوي', tot.outputVat, inputs.glOutputVat, 'GL output VAT (year)'),
      line('invat', 'Input VAT per returns vs annual GL input VAT', 'ضريبة المدخلات في الإقرارات مقابل الأستاذ السنوي', tot.inputVat, inputs.glInputVat, 'GL input VAT (year)'),
      line('wht', 'WHT per monthly returns vs annual WHT statement / GL', 'الاستقطاع في الإقرارات الشهرية مقابل البيان السنوي / الأستاذ', tot.whtTax, inputs.whtAnnual, 'Annual WHT')
    ];
    var have = {}; rows.forEach(function (r) { have[r.period] = 1; });
    var missing = (expectedPeriods || []).filter(function (p) { return !have[p]; });
    return { totals: tot, explained: r2(items), lines: lines, missing: missing, status: missing.length ? 'fail' : worst(lines.map(function (l) { return l.status === 'na' ? 'pass' : l.status; })) };
  };
  E.periodsOfYear = function (year, freq) {
    var out = [];
    if (freq === 'quarterly') for (var q = 1; q <= 4; q++) out.push(year + '-Q' + q);
    else for (var m = 1; m <= 12; m++) out.push(year + '-' + pad(m));
    return out;
  };

  // ------------------------------------------------------------------ findings aging
  E.aging = function (findings, today) {
    today = today || new Date().toISOString().slice(0, 10);
    var b = { notDue: [], d30: [], d60: [], d90: [], over90: [], noDate: [] };
    (findings || []).filter(function (f) { return f.status !== 'closed'; }).forEach(function (f) {
      if (!f.due) return b.noDate.push(f);
      var d = daysBetween(f.due, today);
      (d <= 0 ? b.notDue : d <= 30 ? b.d30 : d <= 60 ? b.d60 : d <= 90 ? b.d90 : b.over90).push(Object.assign({}, f, { overdue: Math.max(0, d) }));
    });
    return b;
  };

  // ------------------------------------------------------------------ other taxes: marketplaces, RETT, excise
  var RE_WORDS = /\b(land|plot|villa|apartment|flat|building|warehouse|property|real estate)\b|أرض|ارض|قطعة|فيلا|شقة|عمارة|مستودع|عقار/i;
  E.runOtherTaxes = function (ctx) {
    var S = ctx.settings, D = ctx.data, checks = [], r = S.vatRate;
    var C = function (o) { o.group = 'other'; return o; };

    // M1 — platform operators: deemed-supplier supplies with no VAT accounted
    var mk = D.mkt_sales || [], q = ctx.mktException || {};
    // The platform escapes deemed-supplier status only if ALL hold: the real
    // seller is named as supplier (contract, invoice, receipt) and the platform
    // sets no terms or price, collects no payment, handles no complaints and
    // offers no promotions or compensation.
    var QK = ['named', 'noTerms', 'noPrice', 'noPayment', 'noComplaints', 'noPromos'];
    var answered = QK.filter(function (k) { return q[k] === 'yes' || q[k] === 'no'; }).length;
    var exceptionMet = answered === QK.length && QK.every(function (k) { return q[k] === 'yes'; });
    if (mk.length) checks.push(C({ id: 'M3', title: 'Deemed-supplier exception test (platform operators)', titleAr: 'اختبار استثناء المورد الاعتباري (مشغلو المنصات)', status: answered < QK.length ? 'warn' : 'pass',
      a: answered, aLabel: 'Questions answered (of 6)', b: null, bLabel: '', diff: null,
      note: answered < QK.length ? 'Answer the six questions on the Other taxes tab.' : exceptionMet ? 'All conditions met: the sellers, not the platform, account for VAT. Keep the contracts, invoices and receipts that show it.' : 'At least one condition fails: the platform is the deemed supplier for the supplies in scope.' }));
    if (mk.length && exceptionMet) mk = [];
    if (mk.length) {
      var deemed = mk.filter(function (x) {
        var nonRes = /^(n|no|false|0|non|غير)/i.test(String(x.sellerResident || '')), registered = E.validVatNo(x.sellerVat);
        var elec = /electronic|digital|إلكترون|رقمي/i.test(String(x.category || ''));
        var applies = (nonRes && elec && x.date >= (S.marketplace.nonResidentFrom || '2025-04-18')) || (!nonRes && !registered && x.date >= (S.marketplace.residentUnregisteredFrom || '2026-01-01'));
        return applies && Math.abs(+x.vat || 0) <= S.tolAbs;
      }).map(function (x) { return Object.assign({}, x, { reason: 'Platform is the deemed supplier but accounted no VAT' }); });
      var ex = r2(deemed.reduce(function (s, x) { return s + (+x.gross || 0) * r / (1 + r); }, 0));
      checks.push(C({ id: 'M1', title: 'Marketplace: VAT on supplies where the platform is the deemed supplier', titleAr: 'المنصات: الضريبة على التوريدات التي تعد المنصة فيها المورد', status: deemed.length ? 'fail' : 'pass',
        a: deemed.length, aLabel: 'Exceptions', b: 0, bLabel: '', diff: deemed.length, exposure: ex, exceptions: { list: deemed.slice(0, 300) }, counts: { list: deemed.length },
        note: 'From 1 Jan 2026 a platform that facilitates supplies by resident sellers who are not VAT-registered (and, since April 2025, electronic services by non-residents) accounts for the VAT itself, unless it meets the ZATCA guide\'s exceptions. Exposure assumes VAT-inclusive prices.' }));
    }
    // M2 — sellers: marketplace payouts in the bank must trace to sales booked for that platform
    var words = String(S.marketplace.payoutKeywords || '').toLowerCase().split(',').map(function (w) { return w.trim(); }).filter(Boolean);
    var payouts = (D.bank || []).filter(function (l) { var d = String(l.description || '').toLowerCase(); return (+l.credit || 0) > 0 && words.some(function (w) { return d.indexOf(w) >= 0; }); });
    if (payouts.length) {
      var sales = (D.sys_vat || []).filter(function (x) { return x.flow === 'S'; }), rows = [];
      words.forEach(function (w) {
        var p = payouts.filter(function (l) { return String(l.description || '').toLowerCase().indexOf(w) >= 0; });
        if (!p.length) return;
        var paid = r2(p.reduce(function (s, l) { return s + (+l.credit || 0); }, 0));
        var booked = r2(sales.filter(function (x) { return String(x.party || '').toLowerCase().indexOf(w) >= 0 || String(x.channel || '').toLowerCase().indexOf(w) >= 0; }).reduce(function (s, x) { return s + (+x.total || 0); }, 0));
        if (paid > booked + S.tolAbs) rows.push({ party: w, gross: paid, total: booked, reason: 'Payouts ' + paid.toLocaleString('en-US') + ' exceed sales booked for this platform (' + booked.toLocaleString('en-US') + ')' });
      });
      var gap = r2(rows.reduce(function (s, x) { return s + x.gross - x.total; }, 0));
      checks.push(C({ id: 'M2', title: 'Marketplace payouts traced to declared sales', titleAr: 'تتبع مدفوعات المنصات إلى المبيعات المقرة', status: rows.length ? 'fail' : 'pass',
        a: gap, aLabel: 'Payouts not covered by sales', b: 0, bLabel: '', diff: gap, exposure: r2(gap * r / (1 + r)), exceptions: { list: rows }, counts: { list: rows.length },
        note: 'Platform payouts are net of commission, so booked sales should always exceed them. If you sell as a VAT-registered business the sale is yours to declare; the platform is not the deemed supplier for you.' }));
    }

    // RETT — 5% of the disposal value, paid before the deed is transferred
    var re = D.rett || [], rr = S.rett || {};
    if (re.length) {
      var bad = [], late = [], due = 0;
      re.forEach(function (x) {
        var exempt = String(x.exemption || '').trim() !== '';
        var expected = exempt ? 0 : r2((+x.value || 0) * (rr.rate || 0.05)), short = r2(expected - (+x.rett || 0));
        if (short > S.tolAbs) { bad.push(Object.assign({}, x, { expected: expected, shortfall: short, reason: 'RETT paid ' + (+x.rett || 0) + ' of ' + expected })); due += short; }
        var dueBy = x.date ? new Date(Date.parse(x.date + 'T00:00:00Z') + (rr.dueDays || 30) * 86400000).toISOString().slice(0, 10) : '';
        if (!exempt && x.paidOn && dueBy && x.paidOn > dueBy) late.push(Object.assign({}, x, { due: dueBy, daysLate: daysBetween(dueBy, x.paidOn), reason: 'Paid ' + daysBetween(x.date, x.paidOn) + ' days after the transaction (limit ' + (rr.dueDays || 30) + ')' }));
      });
      var today = ctx.today || new Date().toISOString().slice(0, 10);
      var pen = r2(bad.reduce(function (s, x) { return s + x.shortfall * (rr.latePctPerMonth || 0.02) * Math.max(1, Math.ceil(daysBetween(x.date, today) / 30)); }, 0));
      checks.push(C({ id: 'R1', title: 'Real estate transaction tax: 5% paid on every taxable disposal', titleAr: 'ضريبة التصرفات العقارية: سداد 5% عن كل تصرف خاضع', status: bad.length ? 'fail' : 'pass',
        a: r2(due), aLabel: 'RETT unpaid', b: 0, bLabel: '', diff: r2(due), exposure: r2(due + pen), exceptions: { list: bad }, counts: { list: bad.length },
        note: 'Exposure = shortfall plus the late-payment rate for each month or part (editable in Settings; verify against the current RETT regulations). Exempt disposals need the exemption reference recorded.' }));
      var latePen = r2(late.reduce(function (s, x) { return s + (+x.rett || 0) * (rr.latePctPerMonth || 0.02) * Math.ceil(x.daysLate / 30); }, 0));
      checks.push(C({ id: 'R2', title: 'RETT paid within 30 days of the transaction', titleAr: 'سداد ضريبة التصرفات العقارية خلال 30 يوماً من التصرف', status: late.length ? 'fail' : 'pass',
        a: late.length, aLabel: 'Exceptions', b: 0, bLabel: '', diff: late.length, exposure: latePen, exceptions: { list: late }, counts: { list: late.length },
        note: 'Under the RETT Law effective April 2025 the tax is due within 30 days of the transaction date, and ZATCA can hold the deed registration until it is paid.' }));
    }
    var reVat = (D.sys_vat || []).filter(function (x) { return x.flow === 'S' && (+x.vat || 0) > 0 && RE_WORDS.test(String(x.description || '') + ' ' + String(x.category || '')); })
      .map(function (x) { return Object.assign({}, x, { reason: 'Looks like a real estate disposal: exempt from VAT and subject to RETT' }); });
    if (reVat.length || re.length) checks.push(C({ id: 'R3', title: 'Real estate sales charged with VAT instead of RETT', titleAr: 'مبيعات عقارية خضعت لضريبة القيمة المضافة بدلاً من ضريبة التصرفات', status: reVat.length ? 'warn' : 'pass',
      a: reVat.length, aLabel: 'Exceptions', b: 0, bLabel: '', diff: reVat.length, exceptions: { list: reVat }, counts: { list: reVat.length },
      note: 'Disposals of real estate are outside VAT and subject to 5% RETT; leases and services on property stay within VAT. Review each line.' }));

    // Excise — recomputed from the tax-inclusive retail price (or ZATCA's standard price if higher)
    var ek = D.excise || [];
    if (ek.length) {
      var rates = S.exciseRates || {}, diffs = [];
      var st = S.sugarTiers || {}, pe = ctx.periodKey ? E.periodRange(ctx.periodKey).end : '';
      ek.forEach(function (x) {
        if (E.exciseCat(x.category) === 'sweetened' && (x.date || pe) >= (st.from || '2026-01-01')) {
          if (x.sugar === '' || x.sugar == null || !(+x.litres)) { diffs.push(Object.assign({}, x, { reason: 'Sugar per 100 ml and litres needed (per-litre tiers since 1 Jan 2026)' })); return; }
          var tier = (st.tiers || []).filter(function (t) { return +x.sugar >= t[0] && +x.sugar < t[1]; })[0] || [0, 0, 0];
          var expL = r2(+x.litres * tier[2]);
          if (Math.abs(expL - (+x.excise || 0)) > Math.max(S.tolAbs, expL * 0.005)) diffs.push(Object.assign({}, x, { expected: expL, shortfall: r2(expL - (+x.excise || 0)), reason: 'Expected SAR ' + tier[2] + ' per litre for ' + x.sugar + ' g sugar / 100 ml' }));
          return;
        }
        var rate = x.rate ? +x.rate : rates[E.exciseCat(x.category)];
        if (rate == null) { diffs.push(Object.assign({}, x, { reason: 'Unknown excise category' })); return; }
        var base = Math.max(+x.retailPrice || 0, +x.standardPrice || 0);
        var exp = r2((+x.qty || 0) * base * rate / (1 + rate));
        if (Math.abs(exp - (+x.excise || 0)) > Math.max(S.tolAbs, exp * 0.005)) diffs.push(Object.assign({}, x, { expected: exp, shortfall: r2(exp - (+x.excise || 0)), reason: 'Expected ' + exp + ' at ' + Math.round(rate * 100) + '% of ' + base }));
      });
      var under = r2(diffs.reduce(function (s, x) { return s + Math.max(0, x.shortfall || 0); }, 0));
      checks.push(C({ id: 'K1', title: 'Excise recomputed per product line', titleAr: 'إعادة احتساب الضريبة الانتقائية لكل منتج', status: diffs.length ? 'fail' : 'pass',
        a: under, aLabel: 'Excise under-declared', b: 0, bLabel: '', diff: under, exposure: under, exceptions: { list: diffs }, counts: { list: diffs.length },
        note: 'Tobacco, energy drinks and e-cigarettes: quantity × price × rate ÷ (1 + rate) on the higher of the retail price (excl. VAT) and ZATCA\'s standard price. Sweetened and carbonated drinks from 1 Jan 2026: litres × SAR 0 / 0.79 / 1.09 by sugar per 100 ml (under 5 g / 5–7.99 g / 8 g or more).' }));
      var decl = ctx.exciseReturn;
      if (decl != null && decl !== '') {
        var reg = r2(ek.reduce(function (s, x) { return s + (+x.excise || 0); }, 0));
        checks.push(C(check('K2', 'other', 'Excise return vs excise register', 'إقرار الضريبة الانتقائية مقابل السجل', +decl, 'Excise return', reg, 'Register total', S)));
      }
    }
    // K3 — designated-zone stock: what is missing was released without excise
    var sk = D.excise_stock || [];
    if (sk.length) {
      var miss = [], relBy = {};
      sk.forEach(function (x) {
        var expected = (+x.opening || 0) + (+x.received || 0) - (+x.released || 0) - (+x.exported || 0), gap = r2(expected - (+x.closing || 0));
        if (gap > 0.0001) {
          var rate = rates_(S, x.category), unit = rate ? (+x.retailPrice || 0) * rate / (1 + rate) : 0;
          miss.push(Object.assign({}, x, { expected: r2(expected), shortfall: gap, excise: r2(gap * unit), reason: gap + ' units unaccounted for: treated as released for consumption' }));
        }
        relBy[String(x.product).toLowerCase()] = (+x.released || 0);
      });
      checks.push(C({ id: 'K3', title: 'Designated-zone stock reconciliation', titleAr: 'مطابقة مخزون المستودع المحدد', status: miss.length ? 'fail' : 'pass',
        a: miss.length, aLabel: 'Exceptions', b: 0, bLabel: '', diff: miss.length, exposure: r2(miss.reduce(function (s, x) { return s + x.excise; }, 0)),
        exceptions: { list: miss }, counts: { list: miss.length }, note: 'Opening + received − released − exported must equal the count. Losses not approved by ZATCA are taxed as releases (exposure shown for price-based categories).' }));
      if (ek.length) {
        var regQ = {}, gaps = [];
        ek.forEach(function (x) { var k = String(x.product).toLowerCase(); regQ[k] = (regQ[k] || 0) + (+x.qty || 0); });
        Object.keys(relBy).forEach(function (k) { if (regQ[k] != null && Math.abs(regQ[k] - relBy[k]) > 0.0001) gaps.push({ product: k, qty: regQ[k], expected: relBy[k], reason: 'Released ' + relBy[k] + ' but excise declared on ' + regQ[k] }); });
        checks.push(C({ id: 'K4', title: 'Quantities released vs quantities taxed', titleAr: 'الكميات المفرج عنها مقابل الكميات الخاضعة', status: gaps.length ? 'fail' : 'pass',
          a: gaps.length, aLabel: 'Exceptions', b: 0, bLabel: '', diff: gaps.length, exceptions: { list: gaps }, counts: { list: gaps.length } }));
      }
    }
    return { checks: checks };
  };
  function rates_(S, cat) { var c = E.exciseCat(cat); return c === 'sweetened' ? 0 : (S.exciseRates || {})[c] || 0; }
  E.exciseCat = function (v) {
    var s = String(v || '').toLowerCase();
    if (/tobacco|cigar|shisha|تبغ|دخان|سجائر|معسل/.test(s)) return 'tobacco';
    if (/energy|طاقة/.test(s)) return 'energy';
    if (/e-?cig|vape|electronic smok|liquid|سجائر إلكترونية|الكتروني/.test(s)) return 'ecig';
    if (/sweet|soft|carbon|sugar|محلا|غازي|سكر/.test(s)) return 'sweetened';
    return s;
  };

  // ------------------------------------------------------------------ Zakat worksheet
  // The classification of each balance is the preparer's judgement; the
  // arithmetic and the two hard rules (base never below adjusted net profit,
  // the rate for a Gregorian year) are the engine's.
  E.zakat = function (z, S) {
    S = E.mergeSettings(S); z = z || {};
    var n = function (k) { return +z[k] || 0; };
    var additions = n('capital') + n('reserves') + n('retainedEarnings') + n('provisions') + n('longTermFinancing') + n('otherAdditions') + n('adjustedNetProfit');
    var deductions = n('netFixedAssets') + n('longTermInvestments') + n('accumulatedLosses') + n('otherDeductions');
    var base = r2(additions - deductions), anp = r2(n('adjustedNetProfit'));
    var used = Math.max(base, anp), rate = (S.zakat.rate || 0.025) * (z.yearType === 'hijri' || (used === anp && anp > 0) ? 1 : (S.zakat.gregorianDays || 365) / 354);
    var res = { additions: r2(additions), deductions: r2(deductions), base: base, adjustedNetProfit: anp, baseUsed: r2(used), rate: Math.round(rate * 1000000) / 1000000, zakat: r2(used * rate), checks: [] };
    res.checks.push({ id: 'Z1', group: 'zakat', title: 'Zakat base not below adjusted net profit', titleAr: 'الوعاء الزكوي لا يقل عن صافي الربح المعدل', status: base >= anp ? 'pass' : 'warn', a: base, aLabel: 'Computed base', b: anp, bLabel: 'Adjusted net profit', diff: r2(base - anp),
      note: base >= anp ? '' : 'The base is raised to the adjusted net profit, taxed at 2.5% whatever the length of the year.' });
    if (z.fyEnd) {
      var due = new Date(Date.parse(z.fyEnd + 'T00:00:00Z') + (S.zakat.dueDays || 120) * 86400000).toISOString().slice(0, 10);
      res.dueDate = due;
      var filed = z.filedOn, late = filed ? daysBetween(due, filed) : daysBetween(due, z.today || new Date().toISOString().slice(0, 10));
      var zl = S.zakat, fine = late >= 30 ? r2(Math.min(res.zakat * (zl.latePctPer30Days || 0.01) * Math.floor(late / 30), res.zakat * (zl.lateCap || 0.25))) : 0;
      res.checks.push({ id: 'Z2', group: 'zakat', title: 'Zakat return filed and paid by ' + due, titleAr: 'تقديم وسداد إقرار الزكاة قبل ' + due, status: filed ? (late > 0 ? 'fail' : 'pass') : (late > 0 ? 'fail' : 'na'),
        a: late > 0 ? late : 0, aLabel: 'Days late', b: null, bLabel: '', diff: null, missing: filed ? '' : 'Filing date', exposure: fine,
        note: 'Due within 120 days of the year end (Zakat IR Art. 17). Late fine estimated at 1% per 30 days up to 25% (editable; verify).' });
    }
    if (z.declared != null && z.declared !== '') res.checks.push(check('Z3', 'zakat', 'Zakat declared vs worksheet', 'الزكاة المقرة مقابل ورقة العمل', +z.declared, 'Declared in the return', res.zakat, 'Worksheet', S));
    return res;
  };

  // Year-end TB balances for the worksheet. map: { line: 'account patterns' }.
  // Additions are credit balances (equity, provisions, financing); deductions
  // are debit balances (fixed assets, investments, losses).
  var ZAKAT_DEDUCT = { netFixedAssets: 1, longTermInvestments: 1, accumulatedLosses: 1, otherDeductions: 1 };
  E.zakatFromTb = function (tb, map) {
    var out = {};
    Object.keys(map || {}).forEach(function (k) {
      if (!map[k]) return;
      var b = E.tbBalance(tb, map[k], 'closing');
      if (b == null) return;
      out[k] = r2(ZAKAT_DEDUCT[k] ? b : -b);
    });
    return out;
  };

  // ------------------------------------------------------------------ storage shape of uploaded rows
  // Rows travel to Google Sheets as {cols, data}: the union of keys over every
  // row (optional columns may be missing from the first one), values by column.
  E.packRows = function (rows) {
    if (!rows || !rows.length) return { cols: [], data: [] };
    var seen = {}, cols = [];
    rows.forEach(function (r) { Object.keys(r).forEach(function (k) { if (!seen[k]) { seen[k] = 1; cols.push(k); } }); });
    return { cols: cols, data: rows.map(function (r) { return cols.map(function (c) { return r[c] === undefined ? null : r[c]; }); }) };
  };
  E.unpackRows = function (d) {
    if (!d) return [];
    if (d.rows) return d.rows;
    return (d.data || []).map(function (a) { var o = {}; d.cols.forEach(function (c, i) { if (a[i] !== null) o[c] = a[i]; }); return o; });
  };

  // ------------------------------------------------------------------ return integrity: box 14 and box 15
  // ctx.prevNetVatBox16: the previous period's box 16 (negative = credit).
  E.runReturnIntegrity = function (ctx) {
    var S = ctx.settings, checks = [];
    if (!ctx.returnBoxes) return { checks: checks };
    var b = E.completeBoxes(JSON.parse(JSON.stringify(ctx.returnBoxes)), true), th = S.vatCorrectionThreshold || 15000;
    var c14 = +b[14].vat || 0;
    checks.push({ id: 'V13', group: 'vat', title: 'Box 14 used only for corrections below SAR ' + th.toLocaleString('en-US'), titleAr: 'البند 14 للتصحيحات الأقل من ' + th.toLocaleString('en-US') + ' ريال فقط',
      status: Math.abs(c14) >= th ? 'fail' : 'pass', a: r2(c14), aLabel: 'Box 14 corrections', b: th, bLabel: 'Threshold', diff: null,
      note: Math.abs(c14) >= th ? 'A net error of SAR ' + th.toLocaleString('en-US') + ' or more must be corrected by amending the original return within 20 days, not through box 14 (VAT IR Art. 63).' : '' });
    var c15 = +b[15].vat || 0, prev = ctx.prevNetVatBox16;
    if (prev != null || c15) {
      var expected = prev != null && prev < 0 && !ctx.prevRefunded ? r2(-prev) : 0;
      checks.push(check('V14', 'vat', 'Box 15 credit carried forward matches the previous period', 'الرصيد المرحل في البند 15 يطابق الفترة السابقة', c15, 'Box 15 this return', expected, 'Credit left by the previous return', S,
        { note: prev == null ? 'No previous exercise on record: keep the previous return to support the credit.' : ctx.prevRefunded ? 'The previous credit was claimed as a refund, so nothing should be carried forward.' : '' }));
    }
    return { checks: checks };
  };

  // ------------------------------------------------------------------ cross-period duplicate input VAT
  // Short fingerprints of purchase invoices (supplier + invoice number), saved
  // with each exercise, so a later period can spot the same invoice claimed again.
  function fp(s) { var h = 5381; s = String(s); for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }
  function purchaseKey(x) { return fp(String(x.party || '').toLowerCase().replace(/[^a-z0-9؀-ۿ]/g, '') + '|' + String(x.invoice || '').toLowerCase().replace(/[^a-z0-9]/g, '')); }
  E.purchaseKeys = function (rows) {
    var out = [], seen = {};
    (rows || []).forEach(function (x) { if (x.flow === 'P' && (+x.vat || 0) > 0) { var k = purchaseKey(x); if (!seen[k]) { seen[k] = 1; out.push(k); } } });
    return out;
  };
  E.purchaseKey = purchaseKey;

  // ------------------------------------------------------------------ QR codes (TLV, base64)
  // Tags: 1 seller name, 2 seller VAT number, 3 timestamp, 4 invoice total incl. VAT, 5 VAT total.
  var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  function b64bytes(s) {
    s = String(s || '').replace(/[^A-Za-z0-9+/]/g, '');
    var out = [], buf = 0, bits = 0;
    for (var i = 0; i < s.length; i++) { buf = (buf << 6) | B64.indexOf(s[i]); bits += 6; if (bits >= 8) { bits -= 8; out.push((buf >> bits) & 255); } }
    return out;
  }
  function utf8(bytes) {
    var s = '', i = 0;
    while (i < bytes.length) {
      var c = bytes[i++];
      if (c < 128) s += String.fromCharCode(c);
      else if (c < 224) s += String.fromCharCode(((c & 31) << 6) | (bytes[i++] & 63));
      else if (c < 240) s += String.fromCharCode(((c & 15) << 12) | ((bytes[i++] & 63) << 6) | (bytes[i++] & 63));
      else { var cp = ((c & 7) << 18) | ((bytes[i++] & 63) << 12) | ((bytes[i++] & 63) << 6) | (bytes[i++] & 63); cp -= 0x10000; s += String.fromCharCode(0xD800 + (cp >> 10), 0xDC00 + (cp & 1023)); }
    }
    return s;
  }
  function utf8bytes(str) {
    var out = [];
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c >= 0xD800 && c < 0xDC00) { c = 0x10000 + ((c - 0xD800) << 10) + (str.charCodeAt(++i) - 0xDC00); }
      if (c < 128) out.push(c);
      else if (c < 2048) out.push(192 | (c >> 6), 128 | (c & 63));
      else if (c < 65536) out.push(224 | (c >> 12), 128 | ((c >> 6) & 63), 128 | (c & 63));
      else out.push(240 | (c >> 18), 128 | ((c >> 12) & 63), 128 | ((c >> 6) & 63), 128 | (c & 63));
    }
    return out;
  }
  E.decodeQr = function (b64) {
    var b = b64bytes(b64), i = 0, f = {};
    if (!b.length) return null;
    while (i + 1 < b.length) {
      var tag = b[i], len = b[i + 1];
      if (i + 2 + len > b.length) return null;
      f[tag] = b.slice(i + 2, i + 2 + len);
      i += 2 + len;
    }
    if (!f[1] || !f[2]) return null;
    return { sellerName: utf8(f[1]), vatNo: utf8(f[2]), timestamp: f[3] ? utf8(f[3]) : '', total: f[4] ? +utf8(f[4]) : null, vat: f[5] ? +utf8(f[5]) : null };
  };
  E.encodeQr = function (o) {
    var bytes = [];
    [o.sellerName, o.vatNo, o.timestamp, String(o.total), String(o.vat)].forEach(function (v, n) { var u = utf8bytes(String(v)); bytes.push(n + 1, u.length); bytes = bytes.concat(u); });
    var s = '', i;
    for (i = 0; i + 2 < bytes.length; i += 3) { var t = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2]; s += B64[t >> 18] + B64[(t >> 12) & 63] + B64[(t >> 6) & 63] + B64[t & 63]; }
    var rem = bytes.length - i;
    if (rem === 1) { var t1 = bytes[i] << 16; s += B64[t1 >> 18] + B64[(t1 >> 12) & 63] + '=='; }
    else if (rem === 2) { var t2 = (bytes[i] << 16) | (bytes[i + 1] << 8); s += B64[t2 >> 18] + B64[(t2 >> 12) & 63] + B64[(t2 >> 6) & 63] + '='; }
    return s;
  };
  E.runQr = function (ctx) {
    var S = ctx.settings, rows = (ctx.data.einv_provider || []).filter(function (x) { return x.qr; });
    if (!rows.length) return null;
    var trn = String((ctx.entity || {}).trn || '').replace(/\s/g, ''), bad = [];
    rows.forEach(function (x) {
      var q = E.decodeQr(x.qr), why = [];
      if (!q) why.push('QR cannot be decoded');
      else {
        if (trn && q.vatNo !== trn) why.push('Seller VAT no. in QR is ' + q.vatNo);
        var total = r2((+x.net || 0) + (+x.vat || 0));
        if (q.total != null && Math.abs(q.total - total) > S.tolAbs) why.push('QR total ' + q.total + ' vs invoice ' + total);
        if (q.vat != null && Math.abs(q.vat - (+x.vat || 0)) > S.tolAbs) why.push('QR VAT ' + q.vat + ' vs invoice ' + x.vat);
        if (q.timestamp && x.issuedAt && q.timestamp.slice(0, 10) !== x.issuedAt.slice(0, 10)) why.push('QR date ' + q.timestamp.slice(0, 10));
      }
      if (why.length) bad.push(Object.assign({}, x, { reason: why.join('; ') }));
    });
    return { id: 'E11', group: 'einv', title: 'QR code matches the invoice (seller TRN, total, VAT, date)', titleAr: 'رمز الاستجابة السريعة يطابق الفاتورة (الرقم الضريبي، الإجمالي، الضريبة، التاريخ)',
      status: bad.length ? 'fail' : 'pass', a: bad.length, aLabel: 'Exceptions', b: 0, bLabel: '', diff: bad.length, exceptions: { list: bad.slice(0, 300) }, counts: { list: bad.length },
      note: rows.length + ' QR codes decoded. The QR is what a customer\'s or inspector\'s phone reads; a wrong TRN or amount is an invoice-content violation.' };
  };

  // ------------------------------------------------------------------ POS / mada settlements
  E.runPos = function (ctx) {
    var S = ctx.settings, D = ctx.data, pos = D.pos || [], checks = [], r = S.vatRate;
    if (!pos.length) return { checks: checks };
    var gross = r2(pos.reduce(function (s, x) { return s + (+x.gross || 0); }, 0)), net = r2(pos.reduce(function (s, x) { return s + (+x.net || 0) || ((+x.gross || 0) - (+x.fees || 0)); }, 0));
    var prov = D.einv_provider || [], simpl;
    if (prov.length && prov.some(function (x) { return x.type; })) simpl = prov.filter(function (x) { return x.type === 'simplified'; }).reduce(function (s, x) { return s + (+x.net || 0) + (+x.vat || 0); }, 0);
    else simpl = (D.sys_vat || []).filter(function (x) { return x.flow === 'S' && !x.vatNo && x.category !== 'X'; }).reduce(function (s, x) { return s + (+x.total || 0); }, 0);
    simpl = r2(simpl);
    var c1 = check('P1', 'bank', 'Card takings (POS / mada) vs B2C sales declared', 'مقبوضات البطاقات (نقاط البيع / مدى) مقابل مبيعات الأفراد المقرة', gross, 'POS gross takings', simpl, 'Simplified (B2C) sales incl. VAT', S,
      { note: 'Card takings above simplified-invoice sales are the classic retail finding: sales rung up without an invoice. If business customers also pay by card, those must appear as standard invoices.' });
    if (c1.status !== 'na' && c1.diff > S.tolAbs) { c1.status = 'fail'; c1.exposure = r2(c1.diff * r / (1 + r)); }
    checks.push(c1);
    // whole words only: "pos" must not match "deposit"
    var POSW = /\b(mada|pos)\b|نقاط بيع|مدى/i;
    var bankPos = r2((D.bank || []).filter(function (l) { return (+l.credit || 0) > 0 && POSW.test(String(l.description || '')); }).reduce(function (s, l) { return s + (+l.credit || 0); }, 0));
    if ((D.bank || []).length) checks.push(check('P2', 'bank', 'POS settlements (net of fees) traced to the bank', 'تتبع تسويات نقاط البيع (بعد الرسوم) إلى البنك', net, 'POS net settlements', bankPos, 'Bank credits from POS / mada', S));
    return { checks: checks };
  };

  // ------------------------------------------------------------------ corrections register
  // Each VAT finding with a tax impact is an error to correct: amend within 20
  // days of discovery at or above the threshold, otherwise include it in the
  // return for the period of discovery.
  E.corrections = function (findings, S, today) {
    S = E.mergeSettings(S); today = today || new Date().toISOString().slice(0, 10);
    var th = S.vatCorrectionThreshold || 15000, days = S.correctionNotifyDays || 20;
    return (findings || []).filter(function (f) { return (f.tax || 'VAT') === 'VAT' && (+f.taxImpact || 0) !== 0; }).map(function (f) {
      var found = f.discoveredOn || String(f.createdAt || f.updatedAt || today).slice(0, 10), amend = Math.abs(+f.taxImpact) >= th;
      var due = amend ? new Date(Date.parse(found + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10) : E.deadlines(found.slice(0, 7)).vat;
      var done = amend ? !!f.correctedOn : !!(f.correctedPeriod || f.correctedOn);
      var st = done ? 'done' : today > due ? 'overdue' : 'open';
      return Object.assign({}, f, { route: amend ? 'amend' : 'next', discoveredOn: found, dueBy: due, state: st, daysLeft: daysBetween(today, due) });
    });
  };

  // ------------------------------------------------------------------ ZATCA requests and assessments
  // Information requests carry the deadline ZATCA gives; an assessment can be
  // objected to within 60 days of notification (holidays included), a committee
  // decision appealed within 30 days.
  E.requestDue = function (q, S, today) {
    S = E.mergeSettings(S); today = today || new Date().toISOString().slice(0, 10);
    var add = function (d, n) { return d ? new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10) : ''; };
    var due = q.dueOn || (q.type === 'assessment' ? add(q.receivedOn, S.disputes.objectionDays) : q.type === 'decision' ? add(q.receivedOn, S.disputes.appealDays) : '');
    var closed = q.status === 'closed' || q.status === 'responded';
    return { due: due, daysLeft: due ? daysBetween(today, due) : null, state: closed ? 'closed' : !due ? 'open' : today > due ? 'overdue' : daysBetween(today, due) <= 7 ? 'urgent' : 'open' };
  };

  // ------------------------------------------------------------------ penalties & readiness
  E.penaltyForFinding = function (f, S) {
    var P = S.penalties, tax = Math.abs(+f.taxImpact || 0), months = +f.monthsLate || 0;
    if (f.tax === 'WHT') { var dl = +f.daysLate || (+f.monthsLate || 0) * 30; return r2(tax * P.whtLatePctPer30Days * (dl < 30 ? 0 : Math.floor(dl / 30))); }
    var err = tax * P.vatErrorPct;
    var late = tax * P.vatLatePaymentPctPerMonth * months;
    return r2(err + late);
  };

  // VAT IR Art. 63. netVatImpact > 0 = tax under-declared, < 0 = over-declared.
  E.correctionRoute = function (netVatImpact, S) {
    var th = S.vatCorrectionThreshold || 15000;
    if (netVatImpact < 0) return 'Over-declared: deduct in a later return within ' + (S.overstatementYears || 5) + ' years from the end of the calendar year of the period';
    return Math.abs(netVatImpact) >= th
      ? 'Amend the original return — notify ZATCA within ' + (S.correctionNotifyDays || 20) + ' days of becoming aware (net difference ≥ SAR ' + th.toLocaleString('en-US') + ')'
      : 'Include in the return for the period in which the error was discovered (net difference below SAR ' + th.toLocaleString('en-US') + ')';
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
    ['WHT', 'Intercompany / head-office agreements', 'اتفاقيات الأطراف المرتبطة والمركز الرئيسي'],
    ['EINV', 'E-invoicing provider contract, scope and ZATCA-compliance evidence', 'عقد مزود الفوترة الإلكترونية ونطاقه وما يثبت توافقه'],
    ['EINV', 'CSID / cryptographic stamp certificates for every EGS unit (valid, not expired)', 'شهادات الختم التشفيري لكل وحدة إصدار (سارية)'],
    ['EINV', 'Provider submission log: cleared, reported, rejected and resubmitted invoices', 'سجل الإرسال لدى المزود: المعتمدة والمبلغ عنها والمرفوضة والمعاد إرسالها'],
    ['EINV', 'Procedure for invoices issued outside the ERP (POS, manual, branch systems)', 'إجراءات الفواتير الصادرة خارج النظام (نقاط البيع، يدوية، الفروع)'],
    ['VAT', 'Input VAT apportionment workings (exempt supplies, Art. 51)', 'أوراق احتساب النسبة القابلة للخصم (التوريدات المعفاة، المادة 51)'],
    ['VAT', 'Deemed supplies register (gifts, samples, own use)', 'سجل التوريدات الاعتبارية (الهدايا، العينات، الاستخدام الخاص)'],
    ['VAT', 'Error corrections log (amended returns and period-of-discovery adjustments)', 'سجل تصحيح الأخطاء (الإقرارات المعدلة والتسويات)'],
    ['VAT', 'Zakat / income tax return for the year (revenue reconciliation)', 'إقرار الزكاة / ضريبة الدخل للسنة (مطابقة الإيرادات)'],
    ['VAT', 'Electronic marketplace sales: deemed-supplier assessment (from 1 Jan 2026)', 'المبيعات عبر المنصات الإلكترونية: تقييم المورد الاعتباري (من 1 يناير 2026)'],
    ['OTHER', 'Marketplace settlement reports (payouts, commissions, refunds) for every platform', 'تقارير تسويات المنصات (المدفوعات والعمولات والمرتجعات) لكل منصة'],
    ['OTHER', 'RETT payment receipts and deeds for every property disposal (or exemption approval)', 'إيصالات سداد ضريبة التصرفات العقارية والصكوك (أو موافقة الإعفاء)'],
    ['OTHER', 'Excise registration, monthly excise returns and the excise goods register', 'التسجيل في الضريبة الانتقائية والإقرارات وسجل السلع الانتقائية'],
    ['OTHER', 'Zakat return, Zakat certificate and the Zakat base workings', 'إقرار الزكاة وشهادتها وأوراق احتساب الوعاء'],
    ['EINV', 'Phase 2 integration notification from ZATCA (wave and deadline)', 'إشعار الهيئة بالربط في المرحلة الثانية (الموجة والموعد)'],
    ['VAT', 'Records retained: 6 years (11 for movable capital assets, 15 for real estate)', 'حفظ السجلات: 6 سنوات (11 للأصول الرأسمالية المنقولة، 15 للعقارات)'],
    ['BANK', 'POS / mada settlement statements for every terminal', 'كشوف تسويات نقاط البيع / مدى لكل جهاز']
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
    parts.einv = r.einv ? score(r.einv) : null;
    parts.filing = r.filing ? score(r.filing) : null;
    parts.other = r.other && r.other.length ? score(r.other) : null;
    var tests = (r.analytics || []).filter(function (t) { return t.status !== 'na'; });
    parts.analytics = !r.analytics ? null : tests.length ? tests.reduce(function (a, t) { return a + (t.status === 'pass' ? 1 : t.status === 'warn' ? (t.severity === 'low' ? 0.85 : 0.6) : 0.2); }, 0) / tests.length : 0;
    var samples = r.samples || [];
    if (!samples.length) parts.sampling = 0;
    else {
      var flows = { S: 0, P: 0, W: 0 }, need = r.requiredFlows || (r.hasWht ? ['S', 'P', 'W'] : ['S', 'P']);
      samples.forEach(function (s) { flows[s.flow] = 1; });
      var cov = need.reduce(function (a, f) { return a + flows[f]; }, 0) / need.length;
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
    var hasWht = !(ctx.entity && ctx.entity.whtRegistered === false);
    var vat = E.runVatRecon(ctx), wht = E.runWhtRecon(ctx), bank = E.runBankRecon(ctx), an = E.runAnalytics(ctx);
    vat.checks = vat.checks.concat(E.runRecovery(ctx).checks, E.runReturnIntegrity(ctx).checks);
    bank.checks = bank.checks.concat(E.runPos(ctx).checks);
    if (hasWht) wht.checks = wht.checks.concat(E.runCrossTax(ctx).checks);
    var einv = E.runEinvoicing(ctx);
    var qr = E.runQr(ctx); if (qr) einv.checks.push(qr);
    ctx.whtApplies = hasWht;
    ctx.whtTax = r2((ctx.data.ret_wht || []).reduce(function (s, x) { return s + (+x.tax || 0); }, 0));
    var filing = E.runFiling(ctx);
    var other = E.runOtherTaxes(ctx);
    an.tests = an.tests.concat(E.runTrends(ctx));
    var res = { vat: vat, wht: wht, bank: bank, analytics: an, einv: einv, filing: filing, other: other };
    res.figures = E.periodFigures(ctx.returnBoxes ? E.completeBoxes(JSON.parse(JSON.stringify(ctx.returnBoxes)), true) : null);
    res.score = E.readiness({
      settings: ctx.settings, vat: vat.checks, wht: hasWht ? wht.checks : [], bank: bank.checks, analytics: an.tests,
      einv: einv.checks, filing: filing.checks, other: other.checks,
      samples: ctx.samples, checklist: ctx.checklist, findings: ctx.findings, hasWht: hasWht
    });
    // VAT and WHT are separate disciplines with separate readiness and exposure
    var isWhtFiling = function (c) { return c.id === 'C3'; };
    var vatFiling = filing.checks.filter(function (c) { return !isWhtFiling(c); }), whtFiling = filing.checks.filter(isWhtFiling);
    var byFlow = function (fl) { return (ctx.samples || []).filter(function (s) { return fl.indexOf(s.flow) >= 0; }); };
    var clArea = function (yes) { return (ctx.checklist || []).filter(function (c) { return yes(c.area); }); };
    var fTax = function (yes) { return (ctx.findings || []).filter(function (f) { return yes(f.tax || 'VAT'); }); };
    res.vatScore = E.readiness({ settings: ctx.settings, vat: vat.checks, wht: [], bank: bank.checks, analytics: an.tests, einv: einv.checks, filing: vatFiling, other: other.checks,
      samples: byFlow(['S', 'P']), requiredFlows: ['S', 'P'], checklist: clArea(function (a) { return a !== 'WHT'; }), findings: fTax(function (t) { return t !== 'WHT'; }) });
    res.whtScore = hasWht ? E.readiness({ settings: ctx.settings, vat: [], wht: wht.checks, bank: [], filing: whtFiling,
      samples: byFlow(['W']), requiredFlows: ['W'], checklist: clArea(function (a) { return a === 'WHT'; }), findings: fTax(function (t) { return t === 'WHT'; }) }) : null;
    var sumExp = function (list) { return r2(list.reduce(function (a, c) { return a + (c.exposure || 0); }, 0)); };
    res.vatExposure = sumExp(vat.checks.concat(bank.checks, einv.checks, vatFiling, other.checks));
    res.whtExposure = hasWht ? sumExp(wht.checks.concat(whtFiling)) : 0;
    var exp = 0;
    vat.checks.concat(hasWht ? wht.checks : [], bank.checks, einv.checks, filing.checks, other.checks).forEach(function (c) { if (c.exposure) exp += c.exposure; });
    res.exposure = r2(exp);
    return res;
  };

  root.ZEngine = E;
  if (typeof module !== 'undefined' && module.exports) module.exports = E;
})(typeof window !== 'undefined' ? window : this);
