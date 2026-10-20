/* End-to-end test of the real UI in headless Chrome (demo mode, no backend).
   Drives clicks, form input, a real file upload, confirm dialogs and Excel
   downloads; visits every page in both tax sections, both languages and at
   phone width; fails on any JavaScript error or broken page.

   Needs the dev server (npm run dev) and Google Chrome.
   node tests/e2e.js [chromePath]                                          */
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');

const CHROME = process.argv[2] || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = 'http://127.0.0.1:5181/', PORT = 9335;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zr-e2e-'));
const dl = path.join(tmp, 'downloads'); fs.mkdirSync(dl);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let ws, seq = 0; const pend = {}, errors = [], fails = []; let passed = 0, step = '';
const send = (method, params) => new Promise((res, rej) => { const i = ++seq; pend[i] = { res, rej }; ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
async function ev(expr) {
  const r = await send('Runtime.evaluate', { expression: '(async () => { ' + expr + ' })()', awaitPromise: true, returnByValue: true, userGesture: true });
  if (r.exceptionDetails) throw new Error('evaluate failed in [' + step + ']: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text));
  return r.result && r.result.value;
}
function ok(cond, msg) { if (cond) passed++; else { fails.push('[' + step + '] ' + msg); console.log('  FAIL ' + msg); } }
async function go(hash, wait) { await ev("location.hash = '" + hash + "'"); await sleep(wait || 900); await idle(); }
async function idle() { for (let i = 0; i < 40; i++) { if (await ev("return !document.querySelector('#main') || !/Loading|جار/.test(document.querySelector('#main').innerText.slice(0, 40))")) return; await sleep(150); } }
async function click(sel, wait) { const r = await ev('var el = document.querySelector(' + JSON.stringify(sel) + '); if (!el) return false; el.click(); return true;'); await sleep(wait || 700); return r; }
async function setVal(sel, val) { return ev('var el = document.querySelector(' + JSON.stringify(sel) + '); if (!el) return false; el.value = ' + JSON.stringify(val) + '; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); return true;'); }

// what every rendered page must satisfy
async function audit(label) {
  step = label;
  const a = await ev(`
    var m = document.querySelector('#main'), txt = m ? m.innerText : '';
    var bad = (txt.match(/\\bundefined\\b|\\bNaN\\b|\\[object Object\\]|Infinity/g) || []);
    var tabs = [].slice.call(document.querySelectorAll('#main nav.tabs')).every(function (n) { return n.scrollWidth <= n.clientWidth + 1; });
    var tabInfo = tabs ? '' : [].slice.call(document.querySelectorAll('#main nav.tabs')).map(function (n) { return n.clientWidth + '/' + n.scrollWidth + ' ' + [].slice.call(n.children).map(function (c) { return (c.tagName === 'DETAILS' ? 'MORE' : c.textContent.trim().slice(0, 12)) + ':' + Math.round(c.getBoundingClientRect().width); }).join(' | '); }).join(' ;; ');
    var untranslated = 0;
    if (document.documentElement.lang === 'ar') { untranslated = (txt.match(/\\b(Loading|Save|Cancel|Delete|Upload|Status|Total|Period|Entity)\\b/g) || []).length; }
    return { len: txt.trim().length, bad: bad.slice(0, 3), sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, tabs: tabs, notFound: /not found|غير موجود/i.test(txt.slice(0, 200)), untranslated: untranslated, tabInfo: tabInfo };`);
  ok(a.len > 40, label + ': page is empty');
  ok(!a.bad.length, label + ': shows ' + a.bad.join(', '));
  ok(a.sw <= a.cw + 1, label + ': horizontal overflow ' + a.sw + ' > ' + a.cw);
  ok(a.tabs, label + ': tab strip wraps or scrolls ' + a.tabInfo);
  ok(!a.notFound, label + ': says not found');
  ok(!a.untranslated, label + ': English words left in Arabic (' + a.untranslated + ')');
  return a;
}

(async () => {
  const prof = path.join(tmp, 'profile');
  const ch = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT, '--user-data-dir=' + prof, '--no-first-run', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
  let list; for (let i = 0; i < 60; i++) { try { list = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json(); if (list.length) break; } catch (e) {} await sleep(250); }
  ws = new WebSocket(list.find((p) => p.type === 'page').webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  ws.addEventListener('message', async (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pend[d.id]) { (d.error ? pend[d.id].rej : pend[d.id].res)(d.result || d.error); delete pend[d.id]; return; }
    if (d.method === 'Runtime.exceptionThrown') errors.push('[' + step + '] ' + (d.params.exceptionDetails.exception ? d.params.exceptionDetails.exception.description : d.params.exceptionDetails.text).split('\n')[0]);
    if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') errors.push('[' + step + '] console.error: ' + d.params.args.map((a) => a.value || a.description).join(' ').slice(0, 200));
    if (d.method === 'Log.entryAdded' && d.params.entry.level === 'error' && !/favicon/.test(d.params.entry.url || '')) errors.push('[' + step + '] ' + d.params.entry.text.slice(0, 200) + ' ' + (d.params.entry.url || ''));
    if (d.method === 'Page.javascriptDialogOpening') send('Page.handleJavaScriptDialog', { accept: true });
    if (d.method === 'Page.fileChooserOpened') send('DOM.setFileInputFiles', { files: [UPLOAD], backendNodeId: d.params.backendNodeId });
  });
  await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable'); await send('DOM.enable');
  await send('Page.setInterceptFileChooserDialog', { enabled: true });
  await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dl });
  await send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 860, deviceScaleFactor: 1, mobile: false });

  // a small ERP tax report to upload: 6 sales and 4 purchases
  var UPLOAD = path.join(tmp, 'erp-vat-report.csv');
  fs.writeFileSync(UPLOAD, ['Invoice No,Date,Customer/Supplier,VAT No,Type,Category,Net,VAT',
    'S-001,2026-09-02,Alpha Co,310000000000013,S,S,10000,1500', 'S-002,2026-09-05,Beta Co,310000000000023,S,S,20000,3000',
    'S-003,2026-09-09,Cash customer,,S,S,5000,750', 'S-004,2026-09-12,Gamma LLC,310000000000033,S,Z,8000,0',
    'S-005,2026-09-18,Delta Co,310000000000043,S,S,12000,1800', 'S-006,2026-09-25,Epsilon,,S,E,3000,0',
    'P-001,2026-09-03,Supplier A,310000000000053,P,S,6000,900', 'P-002,2026-09-10,Supplier B,310000000000063,P,S,4000,600',
    'P-003,2026-09-15,Supplier C,310000000000073,P,S,9000,1350', 'P-004,2026-09-28,Supplier D,310000000000083,P,S,2000,300'].join('\n'));

  step = 'boot';
  await send('Page.navigate', { url: BASE }); await sleep(2500);
  await ev("localStorage.setItem('zr_lang', 'en'); return 1"); await send('Page.reload'); await sleep(2500);
  // the dev build has no backend: it opens straight in demo mode; with a backend it shows sign-in first
  if (await ev("return !!document.getElementById('authf')")) ok(await click('[data-act="localmode"]', 1500), 'demo link present');
  ok(await ev("return Z.S.api.mode === 'local' && !!document.querySelector('.shell')"), 'app opens in demo mode');

  // ---- first-time journey
  step = 'get started';
  ok(await ev("return !!document.querySelector('.getstarted')"), 'get-started card on an empty account');
  await audit('empty dashboard');

  step = 'new entity';
  await go('#/entities/new');
  await setVal('[name=name]', 'Test Trading Co.'); await setVal('[name=nameAr]', 'شركة الاختبار التجارية');
  await setVal('[name=trn]', '310000000000003'); await setVal('[name=map_outputVat]', '2210'); await setVal('[name=map_inputVat]', '1410');
  await setVal('[name=map_revenue]', '4*'); await setVal('[name=map_receivables]', '1200'); await setVal('[name=map_whtPayable]', '2230');
  await ev("document.getElementById('entf').requestSubmit(); return 1"); await sleep(1500);
  ok(await ev("return Z.S.entities.length === 1 && /entity\\//.test(location.hash)"), 'entity saved and opened');
  await audit('entity page');

  step = 'start exercise';
  ok(await click('[data-act="newexsel"]', 2000), 'start button');
  ok(await ev("return Z.S.exercises.length === 1 && /\\/data$/.test(location.hash)"), 'exercise created, data tab open');
  await audit('data tab (new exercise)');

  step = 'return boxes';
  await ev("var d = document.querySelector('details'); if (d) d.open = true; return 1");
  await setVal('[data-chg="box"][data-n="1"][data-f="amount"]', '55000'); await sleep(500);
  await setVal('[data-chg="box"][data-n="1"][data-f="vat"]', '8250'); await sleep(500);
  ok(await ev("return Z.S.ex.returnBoxes && +Z.S.ex.returnBoxes[1].vat === 8250 && +Z.S.ex.returnBoxes[16].vat === 8250"), 'box 1 entered, box 16 computed');

  step = 'upload';
  ok(await click('[data-act="upload"][data-k="sys_vat"]', 2500), 'upload button');
  ok(await ev("return !!document.querySelector('[data-act=\"upsave\"]')"), 'mapping dialog opened');
  ok(await ev("var b = document.querySelector('[data-act=\"upsave\"]'); return b && !b.disabled"), 'required columns mapped automatically');
  await click('[data-act="upsave"]', 2500);
  ok(await ev("return (Z.S.data.sys_vat || []).length === 10"), 'ten invoice rows saved (got ' + await ev("return (Z.S.data.sys_vat || []).length") + ')');

  // ---- every tab of the new exercise, both sections
  const exId = await ev('return Z.S.ex.id');
  for (const tab of ['overview', 'data', 'filing', 'vat', 'einv', 'bank', 'other', 'analytics', 'sampling', 'checklist', 'findings', 'report']) { await go('#/vat/ex/' + exId + '/' + tab); await audit('VAT ' + tab); }
  for (const tab of ['overview', 'data', 'filing', 'wht', 'sampling', 'checklist', 'findings', 'report']) { await go('#/wht/ex/' + exId + '/' + tab); await audit('WHT ' + tab); }

  step = 'sampling';
  await go('#/vat/ex/' + exId + '/sampling');
  await setVal('[data-chg="sf"][data-f="method"]', 'random'); await sleep(700);
  await click('[data-act="makesample"]', 1500);
  ok(await ev('return Z.S.samples.length === 1'), 'sales sample created');
  await click('[data-act="attr"]', 500);
  ok(await ev('return Object.keys(Z.S.samples[0].items[0].tests).length === 1'), 'attribute marked');
  await audit('sample detail');
  await click('[data-act="closesample"]');

  step = 'filing';
  await go('#/vat/ex/' + exId + '/filing');
  await setVal('[data-chg="filing"][data-f="vatFiledOn"]', '2026-10-05'); await sleep(800);
  ok(await ev("return (Z.S.ex.filing || {}).vatFiledOn === '2026-10-05'"), 'filing date saved');

  step = 'finding';
  await go('#/vat/ex/' + exId + '/vat');
  ok(await click('[data-act="raise"]', 900), 'raise-finding button on a failed check');
  await setVal('#ff [name=owner]', 'Tax team');
  await click('[data-act="savefinding"]', 1200);
  ok(await ev('return Z.S.findings.length === 1'), 'finding saved');
  await go('#/wht/ex/' + exId + '/findings');
  ok(await ev("return !/Tax team/.test(document.querySelector('#main').innerText)"), 'VAT finding not listed in the WHT section');

  step = 'documents';
  await go('#/vat/ex/' + exId + '/checklist');
  await setVal('[data-chg="cl"][data-f="status"]', 'available'); await sleep(700);
  ok(await ev("return Z.S.checklist.items.some(function (x) { return x.status === 'available'; })"), 'document status saved');

  step = 'export';
  await go('#/vat/ex/' + exId + '/report');
  await click('[data-act="exportxl"]', 2500);
  ok(fs.readdirSync(dl).some((f) => /^vat-inspection-pack.*\.xlsx$/.test(f)), 'VAT workbook downloaded');
  await go('#/wht/ex/' + exId + '/report');
  await click('[data-act="exportxl"]', 2500);
  ok(fs.readdirSync(dl).some((f) => /^wht-inspection-pack.*\.xlsx$/.test(f)), 'WHT workbook downloaded');

  step = 'sign-off';
  await go('#/vat/ex/' + exId + '/report');
  await click('[data-act="exstatus"][data-s="closed"]', 1500);
  ok(await ev("return Z.S.ex.status === 'closed'"), 'signed off');
  await go('#/vat/ex/' + exId + '/data');
  ok(await ev("return !document.querySelector('[data-act=\"upload\"]')"), 'no upload buttons once signed off');
  await go('#/vat/ex/' + exId + '/report');
  await click('[data-act="exstatus"][data-s="in_progress"]', 1500);
  ok(await ev("return Z.S.ex.status === 'in_progress'"), 'reopened');

  step = 'requests';
  await go('#/vat/requests');
  await click('[data-act="editreq"]', 800);
  await setVal('#qf [name=reference]', 'ZATCA-TEST-1'); await setVal('#qf [name=type]', 'assessment');
  await click('[data-act="savereq"]', 1500);
  ok(await ev("return /ZATCA-TEST-1/.test(document.querySelector('#main').innerText)"), 'request recorded and listed');
  await audit('requests');

  step = 'settings';
  await go('#/vat/settings'); await audit('settings');
  await ev("document.getElementById('setf').requestSubmit(); return 1"); await sleep(1200);
  for (const v of ['users', 'audit', 'entities']) { await go('#/vat/' + v); await audit(v); }

  step = 'users and company access';
  await go('#/vat/users');
  ok(await ev("return !!document.querySelector('table.access')"), 'access matrix shown');
  await click('.pagehead [data-act="edituser"]', 800);
  await setVal('#userf [name=name]', 'Sara Preparer'); await setVal('#userf [name=email]', 'sara@test.sa'); await setVal('#userf [name=role]', 'preparer');
  await ev("var b = document.querySelector('#userf [name=ent]'); if (b) b.checked = true; return 1");
  await click('[data-act="saveuser"]', 1500);
  const sara = "Z.S.users.filter(function (u) { return u.email === 'sara@test.sa'; })[0]";
  ok(await ev('var u = ' + sara + "; return !!u && u.role === 'preparer' && u.entityIds.length === 1 && u.entityIds[0] === Z.S.entities[0].id"), 'user added with one company');
  await ev('var u = ' + sara + "; var el = document.querySelector('[data-chg=\"uacc\"][data-u=\"' + u.id + '\"]'); el.checked = false; el.dispatchEvent(new Event('change', { bubbles: true })); return 1"); await sleep(1200);
  ok(await ev('var u = ' + sara + '; return u.entityIds.length === 0'), 'unticking the only company leaves no access (not all)');
  await ev('var u = ' + sara + "; var el = document.querySelector('[data-chg=\"uall\"][data-u=\"' + u.id + '\"]'); el.checked = true; el.dispatchEvent(new Event('change', { bubbles: true })); return 1"); await sleep(1200);
  ok(await ev('var u = ' + sara + "; return u.entityIds[0] === '*'"), 'all companies ticked');
  await ev('var u = ' + sara + "; var el = document.querySelector('[data-chg=\"urole\"][data-u=\"' + u.id + '\"]'); el.value = 'manager'; el.dispatchEvent(new Event('change', { bubbles: true })); return 1"); await sleep(1200);
  ok(await ev('var u = ' + sara + "; return u.role === 'manager'"), 'role changed in the matrix');
  ok(await ev("return document.querySelectorAll('[data-chg=\"uacc\"][data-u=\"local\"]:not([disabled])').length === 0"), 'your own row is locked');
  await audit('users matrix');

  // ---- the demo company: every page, both sections, both languages, desktop and phone
  step = 'demo';
  await ev('Z.ACT.loaddemo(); return 1');
  for (let i = 0; i < 60 && !(await ev("return Z.S.entities.some(function (e) { return e.demo; }) && location.hash.indexOf('/ex/') >= 0 && !!Z.S.R")); i++) await sleep(500);
  ok(await ev('return Z.S.entities.length === 3'), 'demo company (two entities) added next to ours');
  const demo = await ev("var ids = Z.S.entities.filter(function (x) { return x.demo; }).map(function (x) { return x.id; }); var x = Z.S.exercises.filter(function (y) { return ids.indexOf(y.entityId) >= 0 && y.status !== 'closed'; })[0]; return { e: x.entityId, x: x.id };");
  const VAT = ['overview', 'plan', 'data', 'filing', 'vat', 'einv', 'bank', 'other', 'analytics', 'sampling', 'checklist', 'findings', 'report'];
  const WHT = ['overview', 'plan', 'data', 'filing', 'wht', 'sampling', 'checklist', 'findings', 'report'];
  const RV = ['summary', 'portfolio', 'aging', 'exposure', 'corrections', 'calendar'], RW = ['summary', 'beneficiaries', 'portfolio', 'aging', 'exposure', 'calendar'];
  async function sweep(tag) {
    for (const s of ['vat', 'wht']) {
      await go('#/' + s + '/dashboard'); await audit(tag + ' ' + s + ' dashboard');
      await go('#/' + s + '/insights/' + demo.e, 3000); await audit(tag + ' ' + s + ' company 360');
      for (const tab of (s === 'vat' ? VAT : WHT)) { await go('#/' + s + '/ex/' + demo.x + '/' + tab, 1100); await audit(tag + ' ' + s + ' ex ' + tab); }
      for (const r of (s === 'vat' ? RV : RW)) { await go('#/' + s + '/reports/' + r, r === 'beneficiaries' || r === 'aging' ? 2200 : 1000); await audit(tag + ' ' + s + ' report ' + r); }
      for (const v of ['entities', 'entity/' + demo.e, 'annual/' + demo.e + '/2025', 'requests', 'account/' + demo.e, 'refunds', 'disputes', 'calendar', 'settings', 'users', 'audit']) { await go('#/' + s + '/' + v, 1500); await audit(tag + ' ' + s + ' ' + v); }
    }
  }
  await sweep('EN');

  step = 'demo checks';
  await go('#/vat/ex/' + demo.x + '/overview', 1500);
  ok(await ev("return Z.S.R.vatScore.score === Z.S.ex.summary.vatScore && Z.S.R.whtScore.score === Z.S.ex.summary.whtScore"), 'saved summary matches the engine for both sections');
  ok(await ev("return !!document.querySelector('details.more') || document.querySelector('nav.tabs').scrollWidth <= document.querySelector('nav.tabs').clientWidth"), 'tabs fit with a More menu');
  step = 'company 360';
  await go('#/vat/insights/' + demo.e, 3000);
  ok(await ev("return document.querySelectorAll('.pair').length === 11 && document.querySelectorAll('.act').length >= 3 && !!document.querySelector('.chart svg .cbar')"), '360 shows the match map, actions and the returns chart');
  ok(await ev("var p = Z.planFor(); return p.avoided > 0 && p.costLater > p.costNow"), 'acting now saves money');
  await go('#/vat/ex/' + demo.x + '/plan', 1500);
  const firstAct = await ev("var b = document.querySelector('[data-act=\"actdone\"]'); return b ? b.dataset.id : null");
  await click('[data-act="actdone"]', 1500);
  ok(await ev("return !!(Z.S.ex.actionsDone || {})['" + firstAct + "']"), 'an action can be marked done and is saved');
  await go('#/wht/entity/' + demo.e, 1200);
  ok(await ev("var w = Z.S.ex.summary.whtScore, v = Z.S.ex.summary.vatScore; var t = document.querySelector('#main').innerText; return w !== v && t.indexOf(w + '% ') >= 0 && t.indexOf(v + '% ') < 0"), 'entity page shows the WHT score in the WHT section');
  await go('#/vat/reports/summary', 1200); await click('[data-act="rexport"]', 2000);
  await go('#/wht/reports/beneficiaries', 2500); await click('[data-act="rexport"]', 2000);
  ok(fs.readdirSync(dl).some((f) => /^vat-report-summary/.test(f)) && fs.readdirSync(dl).some((f) => /^wht-report-beneficiaries/.test(f)), 'report exports downloaded');
  step = 'ZATCA account';
  await go('#/vat/account/' + demo.e, 2000);
  ok(await ev("var t = document.querySelector('#main').innerText; return t.indexOf('59,325.00') >= 0 && t.indexOf('56,500.00') >= 0 && t.indexOf('2,830.00') >= 0"), 'statement balance, GL and exposure in accounting format');
  ok(await ev("return document.querySelectorAll('#main .check').length === 5 && /1 \\/ 5/.test(document.querySelector('.score-chip').textContent)"), 'five statement checks, one agrees');
  ok(await ev("return document.querySelectorAll('.zk-run svg .pen').length >= 1"), 'penalties marked on the balance chart');
  await click('[data-drill="soa:pen"]', 900);
  ok(await ev("var d = document.querySelector('.drawer'); return !!d && d.querySelectorAll('.dr-row').length === 2 && /12,325\\.00/.test(d.innerText)"), 'penalties drill lists both penalties');
  await ev('Z.closeDrawer(true); return 1');
  await click('[data-act="soaline"]', 800);
  await setVal('#sf [name=description]', 'Test adjustment'); await setVal('#sf [name=debit]', '100'); await setVal('#sf [name=period]', '2026-09');
  await click('[data-act="soalinesave"]', 1500);
  ok(await ev("return /59,425\\.00/.test(document.querySelector('.zk-bal').innerText)"), 'a manual line moves the balance');
  await ev("var b = [].slice.call(document.querySelectorAll('[data-act=soadel]')).filter(function (x) { return /Test adjustment/.test(x.getAttribute('aria-label')); })[0]; b.click(); return 1"); await sleep(1500);
  ok(await ev("return /59,325\\.00/.test(document.querySelector('.zk-bal').innerText)"), 'and removing it moves it back');
  await go('#/vat/refunds', 1500);
  ok(await ev("return document.querySelectorAll('.zk-case').length === 3 && /38,400\\.00/.test(document.querySelector('.kpis').innerText)"), 'three refunds, 38,400.00 outstanding');
  await go('#/vat/disputes', 1500);
  ok(await ev("return document.querySelectorAll('.zk-case').length === 3 && /79,750\\.00/.test(document.querySelector('.kpis').innerText)"), 'three disputes, 79,750.00 at stake');
  await go('#/vat/calendar', 2500);
  ok(await ev("return document.querySelectorAll('.zk-d.has').length > 0 && document.querySelectorAll('.zk-agenda .zk-it').length > 3"), 'calendar month and agenda filled');
  await click('[data-act="calics"]', 2000);
  ok(fs.readdirSync(dl).some((f) => /^tax-calendar-.*\.ics$/.test(f)), 'calendar exported as .ics');
  await click('[data-act="caltax"][data-k="WHT"]', 600);
  ok(await ev("return [].every.call(document.querySelectorAll('.zk-agenda .zk-it .tx'), function (i) { return i.classList.contains('tx-wht'); })"), 'tax filter shows WHT only');
  step = 'review notes';
  await go('#/vat/ex/' + demo.x + '/vat', 1500);
  await click('[data-act="rvadd"][data-id="V1"]', 800);
  await setVal('#rvf [name=text]', 'Explain the box 1 gap');
  await click('[data-act="rvsave"]', 1500);
  ok(await ev("return Z.openReviews().length === 1 && !!document.querySelector('#c-V1 .zk-rv.open')"), 'review note shown on the check');
  await go('#/vat/ex/' + demo.x + '/report', 1500);
  ok(await ev("return !document.querySelector('[data-act=exstatus][data-s=closed]') && !!document.querySelector('.zk-rvsum.open')"), 'sign-off held while a note is open');
  await go('#/vat/ex/' + demo.x + '/vat', 1500);
  await click('#c-V1 [data-act="rvclear"]', 1500);
  await go('#/vat/ex/' + demo.x + '/report', 1500);
  ok(await ev("return !!document.querySelector('[data-act=exstatus][data-s=closed]')"), 'sign-off available once cleared');
  await click('[data-act="theme"]', 500);
  ok(await ev("return !!document.documentElement.dataset.theme"), 'theme toggles');

  step = 'arabic';
  await ev("localStorage.setItem('zr_lang', 'ar'); return 1"); await send('Page.reload'); await sleep(3000);
  ok(await ev("return document.documentElement.dir === 'rtl'"), 'Arabic is right-to-left');
  await sweep('AR');

  step = 'phone';
  await ev("localStorage.setItem('zr_lang', 'en'); return 1");
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send('Page.reload'); await sleep(3000);
  for (const h of ['#/vat/dashboard', '#/vat/ex/' + demo.x + '/overview', '#/vat/ex/' + demo.x + '/vat', '#/wht/ex/' + demo.x + '/wht', '#/vat/ex/' + demo.x + '/report', '#/wht/reports/beneficiaries', '#/vat/settings', '#/vat/account', '#/vat/refunds', '#/vat/disputes', '#/vat/calendar']) { await go(h, 1800); await audit('phone ' + h.split('/').slice(1, 4).join(' ')); }
  await click('[data-act="menu"]', 600);
  ok(await ev("return getComputedStyle(document.querySelector('.rail')).visibility === 'visible'"), 'menu opens the sidebar on a phone');

  // ---- report
  ws.close(); ch.kill();
  console.log('\n' + passed + ' checks passed, ' + fails.length + ' failed, ' + errors.length + ' JavaScript errors');
  [...new Set(errors)].forEach((e) => console.log('  ERROR ' + e));
  fails.forEach((f) => console.log('  FAIL  ' + f));
  setTimeout(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {} process.exit(fails.length || errors.length ? 1 : 0); }, 1500);
})().catch((e) => { console.error('E2E aborted:', e.message); [...new Set(errors)].forEach((x) => console.log('  ERROR ' + x)); fails.forEach((f) => console.log('  FAIL  ' + f)); process.exit(2); });
