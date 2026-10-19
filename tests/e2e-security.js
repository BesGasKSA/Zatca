/* Script-injection test of the real UI (headless Chrome, demo mode).
   Every text a user can type or upload carries a payload that would set
   window.__xss if any screen rendered it as HTML. Then every screen is
   visited in both sections and languages. Needs `npm run dev` and Chrome.
   node tests/e2e-security.js [chromePath]                                  */
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const CHROME = process.argv[2] || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = 'http://127.0.0.1:5181/', PORT = 9337;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zr-sec-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws, seq = 0; const pend = {}, errors = [], fails = []; let passed = 0, step = '';
const send = (method, params) => new Promise((res, rej) => { const i = ++seq; pend[i] = { res, rej }; ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
async function ev(expr) {
  const r = await send('Runtime.evaluate', { expression: '(async () => { ' + expr + ' })()', awaitPromise: true, returnByValue: true, userGesture: true });
  if (r.exceptionDetails) throw new Error('[' + step + '] ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text));
  return r.result && r.result.value;
}
function ok(c, m) { if (c) passed++; else { fails.push('[' + step + '] ' + m); console.log('  FAIL ' + m); } }
async function go(h, w) { await ev("location.hash = '" + h + "'"); await sleep(w || 1100); }
async function click(sel, w) { const r = await ev('var el = document.querySelector(' + JSON.stringify(sel) + '); if (!el) return false; el.click(); return true;'); await sleep(w || 700); return r; }
async function setVal(sel, v) { return ev('var el = document.querySelector(' + JSON.stringify(sel) + '); if (!el) return false; el.value = ' + JSON.stringify(v) + '; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); return true;'); }

// payloads: each would fire only if rendered as markup
const X = (tag) => '<img src=x onerror="window.__xss=(window.__xss||[]).concat(\'' + tag + '\')">' + tag + '"><svg onload="window.__xss=1"></svg>\'';
let UPLOAD;

async function clean(where) {
  step = where;
  const r = await ev("return { xss: window.__xss || null, imgs: document.querySelectorAll('#main img[src=\"x\"], .modal img[src=\"x\"], img[onerror]').length, svgs: document.querySelectorAll('svg[onload]').length, txt: (document.querySelector('#main') || document.body).innerText.length }");
  ok(!r.xss, where + ': injected script ran (' + JSON.stringify(r.xss) + ')');
  ok(r.imgs === 0 && r.svgs === 0, where + ': injected markup in the page (' + r.imgs + ' img, ' + r.svgs + ' svg)');
  ok(r.txt > 30, where + ': page empty');
}

(async () => {
  const ch = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT, '--user-data-dir=' + path.join(tmp, 'p'), '--no-first-run', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
  let list; for (let i = 0; i < 160; i++) { try { list = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json(); if (list.length) break; } catch (e) {} await sleep(250); }
  ws = new WebSocket(list.find((p) => p.type === 'page').webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  ws.addEventListener('message', (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pend[d.id]) { (d.error ? pend[d.id].rej : pend[d.id].res)(d.result || d.error); delete pend[d.id]; return; }
    if (d.method === 'Runtime.exceptionThrown') errors.push('[' + step + '] ' + (d.params.exceptionDetails.exception ? d.params.exceptionDetails.exception.description : d.params.exceptionDetails.text).split('\n')[0]);
    if (d.method === 'Page.javascriptDialogOpening') { if (!/^(Delete|Sign off|Replace)/.test(d.params.message)) errors.push('[' + step + '] unexpected dialog: ' + d.params.message.slice(0, 80)); send('Page.handleJavaScriptDialog', { accept: true }); }
    if (d.method === 'Page.fileChooserOpened') send('DOM.setFileInputFiles', { files: [UPLOAD], backendNodeId: d.params.backendNodeId });
  });
  await send('Page.enable'); await send('Runtime.enable'); await send('DOM.enable');
  await send('Page.setInterceptFileChooserDialog', { enabled: true });
  await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: tmp });
  await send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 860, deviceScaleFactor: 1, mobile: false });

  UPLOAD = path.join(tmp, 'evil.csv');
  const q = (s) => '"' + s.replace(/"/g, '""') + '"';
  fs.writeFileSync(UPLOAD, ['Invoice No,Date,Customer/Supplier,VAT No,Type,Category,Net,VAT',
    [q(X('inv')), '2026-09-02', q(X('party')), '310000000000013', 'S', 'S', '10000', '1500'].join(','),
    [q('=HYPERLINK("http://evil","x")'), '2026-09-03', q('+cmd|calc!A1'), '', 'S', 'S', '5000', '750'].join(','),
    ['P-1', '2026-09-05', q(X('supplier')), '310000000000023', 'P', 'S', '2000', '300'].join(',')].join('\n'));

  step = 'boot';
  await send('Page.navigate', { url: BASE }); await sleep(2500);
  await ev("localStorage.setItem('zr_lang','en'); return 1"); await send('Page.reload'); await sleep(2500);
  if (await ev("return !!document.getElementById('authf')")) await click('[data-act="localmode"]', 1500);

  step = 'entity';
  await go('#/entities/new');
  await setVal('[name=name]', X('entname')); await setVal('[name=nameAr]', X('entar')); await setVal('[name=erp]', X('erp'));
  await setVal('[name=einvWave]', X('wave')); await setVal('[name=map_revenue]', X('map'));
  await ev("document.getElementById('entf').requestSubmit(); return 1"); await sleep(1500);
  ok(await ev('return Z.S.entities.length === 1'), 'entity with payloads saved');
  await clean('entity page');

  step = 'exercise';
  await click('[data-act="newexsel"]', 2000);
  const ex = await ev('return Z.S.ex.id');
  await click('[data-act="upload"][data-k="sys_vat"]', 2500);
  await clean('upload mapping dialog');
  await click('[data-act="upsave"]', 2500);
  ok(await ev('return (Z.S.data.sys_vat || []).length === 3'), 'payload rows uploaded');
  await go('#/vat/ex/' + ex + '/vat');
  await ev("var t = document.querySelector('textarea[data-chg=\"cnote\"]'); if (t) { t.value = " + JSON.stringify(X('note')) + "; t.dispatchEvent(new Event('change', { bubbles: true })); } return 1"); await sleep(900);
  await go('#/vat/ex/' + ex + '/findings');
  await click('.spread [data-act="editfinding"]', 900);
  await setVal('#ff [name=title]', X('ftitle')); await setVal('#ff [name=cause]', X('cause')); await setVal('#ff [name=action]', X('faction')); await setVal('#ff [name=owner]', X('owner'));
  await click('[data-act="savefinding"]', 1200);
  ok(await ev('return Z.S.findings.length === 1'), 'finding with payloads saved');
  await go('#/vat/ex/' + ex + '/checklist');
  await setVal('[data-chg="cl"][data-f="owner"]', X('clowner')); await sleep(600);
  await setVal('[data-chg="cl"][data-f="link"]', 'javascript:window.__xss=1'); await sleep(600);
  ok(await ev("return !Z.S.checklist.items.some(function (x) { return /^javascript:/i.test(x.link || ''); })"), 'javascript: link refused');
  await go('#/vat/ex/' + ex + '/sampling');
  await setVal('[data-chg="sf"][data-f="method"]', 'random'); await sleep(600);
  await click('[data-act="makesample"]', 1500);
  await setVal('[data-chg="sitem"][data-f="evidence"]', X('evidence')); await sleep(900);
  await setVal('[data-chg="snote"]', X('snote')); await sleep(900);

  step = 'requests';
  await go('#/vat/requests');
  await click('[data-act="editreq"]', 800);
  await setVal('#qf [name=reference]', X('ref')); await setVal('#qf [name=items]', X('items')); await setVal('#qf [name=owner]', X('rowner'));
  await click('[data-act="savereq"]', 1500);

  step = 'users';
  await go('#/vat/users');
  await click('.pagehead [data-act="edituser"]', 800);
  await setVal('#userf [name=name]', X('uname')); await setVal('#userf [name=email]', 'x@test.sa');
  await click('[data-act="saveuser"]', 1500);

  step = 'settings';
  await go('#/vat/settings');
  await ev("var f = document.getElementById('setf'); var n = f && f.querySelector('[name=orgName], [name=tenantName], [name=name]'); if (n) { n.value = " + JSON.stringify(X('org')) + "; } if (f) f.requestSubmit(); return 1"); await sleep(1500);

  // ---- every screen, both sections, both languages
  const VAT = ['overview', 'plan', 'data', 'filing', 'vat', 'einv', 'bank', 'other', 'analytics', 'sampling', 'checklist', 'findings', 'report'];
  const WHT = ['overview', 'plan', 'data', 'filing', 'wht', 'sampling', 'checklist', 'findings', 'report'];
  const ent = await ev('return Z.S.entities[0].id');
  for (const lang of ['en', 'ar']) {
    await ev("localStorage.setItem('zr_lang','" + lang + "'); return 1"); await send('Page.reload'); await sleep(3000);
    for (const s of ['vat', 'wht']) {
      for (const v of ['dashboard', 'insights/' + ent, 'entities', 'entity/' + ent, 'entity/' + ent + '/edit', 'requests', 'users', 'audit', 'settings', 'annual/' + ent + '/2026']) { await go('#/' + s + '/' + v, 1500); await clean(lang + ' ' + s + ' ' + v); }
      for (const tab of (s === 'vat' ? VAT : WHT)) { await go('#/' + s + '/ex/' + ex + '/' + tab, 1300); await clean(lang + ' ' + s + ' ex ' + tab); }
      for (const r of ['summary', 'portfolio', 'aging', 'exposure', 'corrections', 'calendar', 'beneficiaries']) { await go('#/' + s + '/reports/' + r, 1800); await clean(lang + ' ' + s + ' report ' + r); }
    }
    await go('#/vat/ex/' + ex + '/findings', 1200); await click('[data-act="editfinding"][data-id]', 900); await clean(lang + ' finding dialog'); await click('[data-act="closemodal"]', 400);
    await go('#/vat/requests', 1500); await click('[data-act="editreq"][data-id]', 900); await clean(lang + ' request dialog'); await click('[data-act="closemodal"]', 400);
    await go('#/vat/ex/' + ex + '/sampling', 1200); await click('[data-act="opensample"]', 900); await clean(lang + ' sample detail'); await click('[data-act="closesample"]', 400);
  }
  step = 'exports';
  await go('#/vat/ex/' + ex + '/report', 1500); await click('[data-act="exportxl"]', 2500);
  ok(fs.readdirSync(tmp).some((f) => /\.xlsx$/.test(f)), 'workbook still exports with payload data');
  await clean('after export');

  ws.close(); ch.kill();
  console.log('\n' + passed + ' checks passed, ' + fails.length + ' failed, ' + errors.length + ' JavaScript errors');
  [...new Set(errors)].forEach((e) => console.log('  ERROR ' + e));
  fails.forEach((f) => console.log('  FAIL  ' + f));
  setTimeout(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {} process.exit(fails.length || errors.length ? 1 : 0); }, 1500);
})().catch((e) => { console.error('aborted:', e.message); fails.forEach((f) => console.log('  FAIL  ' + f)); process.exit(2); });
