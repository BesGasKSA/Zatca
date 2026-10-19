/* Edge cases of the real UI (headless Chrome, demo mode): a quarterly filer
   without WHT going back to 2018, an exercise with no data at all, a signed-off
   exercise that must be read-only everywhere, deleting things, and broken links.
   Needs `npm run dev` and Chrome.  node tests/e2e-edge.js [chromePath]        */
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const CHROME = process.argv[2] || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = 'http://127.0.0.1:5181/', PORT = 9338;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zr-edge-'));
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
async function audit(label) {
  step = label;
  const a = await ev(`var m = document.querySelector('#main'), txt = m ? m.innerText : '';
    return { len: txt.trim().length, bad: (txt.match(/\\bundefined\\b|\\bNaN\\b|\\[object Object\\]|Infinity|null%/g) || []).slice(0, 3), sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth };`);
  ok(a.len > 30, label + ': page is empty');
  ok(!a.bad.length, label + ': shows ' + a.bad.join(', '));
  ok(a.sw <= a.cw + 1, label + ': horizontal overflow');
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
    if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') errors.push('[' + step + '] console.error: ' + d.params.args.map((x) => x.value || x.description).join(' ').slice(0, 160));
    if (d.method === 'Page.javascriptDialogOpening') send('Page.handleJavaScriptDialog', { accept: true });
  });
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 860, deviceScaleFactor: 1, mobile: false });
  step = 'boot';
  await send('Page.navigate', { url: BASE }); await sleep(2500);
  await ev("localStorage.setItem('zr_lang','en'); return 1"); await send('Page.reload'); await sleep(2500);
  if (await ev("return !!document.getElementById('authf')")) await click('[data-act="localmode"]', 1500);

  // ---- a quarterly filer that pays no non-residents, back in 2018
  step = 'quarterly entity';
  await go('#/entities/new');
  await setVal('[name=name]', 'Quarterly Co'); await setVal('[name=trn]', '311111111100003'); await setVal('[name=vatFreq]', 'quarterly'); await setVal('[name=whtRegistered]', '0');
  await ev("document.getElementById('entf').requestSubmit(); return 1"); await sleep(1500);
  const q = await ev('return Z.S.entities[0].id');
  ok(await ev("return Z.S.entities[0].vatFreq === 'quarterly' && Z.S.entities[0].whtRegistered === false"), 'quarterly, no WHT saved');
  await setVal('[data-chg="ppyear"]', '2018'); await sleep(600);
  ok(await ev("return [].some.call(document.querySelectorAll('#newp option'), function (o) { return o.value === '2018-Q1'; })"), 'can pick Q1 2018');
  await setVal('#newp', '2018-Q1');
  await click('[data-act="newexsel"]', 2000);
  const ex = await ev('return Z.S.ex && Z.S.ex.id');
  ok(await ev("return Z.S.ex.period === '2018-Q1'"), 'exercise 2018-Q1 created');
  ok(await ev("var cur = Z.S.ex; return true"), 'ok');
  // the period picker never offers the future
  await go('#/vat/entity/' + q);
  await setVal('[data-chg="ppyear"]', String(new Date().getFullYear())); await sleep(500);
  ok(await ev("var now = new Date().toISOString().slice(0, 7); return [].every.call(document.querySelectorAll('#newp option'), function (o) { return !o.value || o.value.slice(0, 4) < now.slice(0, 4) || (o.value.indexOf('Q') > 0 ? (+o.value.slice(-1) - 1) * 3 + 1 <= +now.slice(5) : o.value <= now); })"), 'no future periods offered');

  // ---- an exercise with no data at all: every page must still make sense
  for (const tab of ['overview', 'plan', 'data', 'filing', 'vat', 'einv', 'bank', 'other', 'analytics', 'sampling', 'checklist', 'findings', 'report']) { await go('#/vat/ex/' + ex + '/' + tab); await audit('empty VAT ' + tab); }
  step = 'empty plan';
  await go('#/vat/ex/' + ex + '/plan');
  ok(await ev("return !/Every action is done/.test(document.querySelector('#main').innerText)"), 'an exercise with no data does not claim every action is done');
  await go('#/vat/insights/' + q, 2500); await audit('empty company 360');
  ok(await ev("return !/Every action is done/.test(document.querySelector('#main').innerText)"), 'Company 360 with no data does not claim everything is done');
  await go('#/wht/ex/' + ex + '/overview'); await audit('WHT section of a non-WHT entity');
  ok(await ev("return /not registered for withholding tax/i.test(document.querySelector('#main').innerText)"), 'WHT section explains the entity is not registered');
  await go('#/wht/insights', 2000); await audit('WHT 360 without WHT entities');
  await go('#/wht/dashboard'); await audit('WHT dashboard without WHT entities');
  for (const r of ['summary', 'portfolio', 'aging', 'exposure', 'corrections', 'calendar']) { await go('#/vat/reports/' + r, 1500); await audit('quarterly report ' + r); }

  // ---- signed off: nothing can change
  step = 'sign-off';
  await go('#/vat/ex/' + ex + '/report');
  await click('[data-act="exstatus"][data-s="closed"]', 1500);
  ok(await ev("return Z.S.ex.status === 'closed'"), 'signed off');
  const FILTERS = ['bankfilter', 'planlevel', 'planshow', 'upsheet', 'insent', 'entity'];
  for (const tab of ['overview', 'plan', 'data', 'filing', 'vat', 'einv', 'bank', 'other', 'analytics', 'sampling', 'checklist', 'findings', 'report']) {
    await go('#/vat/ex/' + ex + '/' + tab);
    step = 'locked ' + tab;
    const open = await ev("var F = " + JSON.stringify(FILTERS) + "; return [].filter.call(document.querySelectorAll('#main [data-chg]:not([disabled]), #main input:not([disabled]):not([type=hidden]), #main textarea:not([disabled])'), function (el) { return F.indexOf(el.dataset.chg) < 0 && !el.closest('nav') && el.type !== 'checkbox'; }).map(function (el) { return (el.dataset.chg || el.name || el.tagName) + ''; })");
    ok(!open.length, 'editable fields on a signed-off exercise: ' + open.slice(0, 5).join(', '));
    const acts = await ev("return [].map.call(document.querySelectorAll('#main [data-act=upload], #main [data-act=raise], #main [data-act=raisea], #main [data-act=makesample], #main [data-act=actdone], #main [data-act=deldata], #main [data-act=additem], #main [data-act=retfromsys]'), function (b) { return b.dataset.act; })");
    ok(!acts.length, 'action buttons on a signed-off exercise: ' + acts.join(', '));
  }
  await click('[data-act="exstatus"][data-s="in_progress"]', 1500);

  // ---- deleting things
  step = 'delete';
  await ev('Z.ACT.loaddemo(); return 1');
  // wait until the demo import has finished: its exercise is open with all its files
  for (let i = 0; i < 80 && !(await ev("var x = Z.S.ex; return Z.S.entities.some(function (e) { return e.demo && x && e.id === x.entityId; }) && Z.S.loaded && Z.S.datasets.length >= 10")); i++) await sleep(500);
  const dx = await ev('return Z.S.ex.id');
  await go('#/vat/ex/' + dx + '/data', 1500);
  const nds = await ev('return Z.S.datasets.length');
  const tDel = Date.now();
  await click('[data-act="deldata"]', 100);
  for (let i = 0; i < 100 && (await ev('return Z.S.loaded ? Z.S.datasets.length : -1')) !== nds - 1; i++) await sleep(100);
  const delMs = Date.now() - tDel;
  ok(await ev('return Z.S.datasets.length === ' + (nds - 1)), 'dataset removed (' + nds + ' → ' + await ev('return Z.S.datasets.length') + ')');
  ok(delMs < 4000, 'removing a file takes ' + delMs + ' ms');
  console.log('  removing a file took ' + delMs + ' ms');
  await audit('after deleting a dataset');
  await go('#/vat/ex/' + dx + '/findings', 1200);
  await click('.spread [data-act="editfinding"]', 800); await setVal('#ff [name=title]', 'temp'); await click('[data-act="savefinding"]', 1200);
  const nf = await ev('return Z.S.findings.length');
  await click('[data-act="editfinding"][data-id]', 800); await click('[data-act="delfinding"]', 1500);
  ok(await ev('return Z.S.findings.length === ' + (nf - 1)), 'finding deleted');
  await go('#/vat/entity/' + q + '/edit', 1200);
  await click('[data-act="delent"]', 2000);
  ok(await ev("return !Z.S.entities.some(function (e) { return e.id === '" + q + "'; })"), 'entity deleted');
  for (const v of ['dashboard', 'insights', 'entities', 'reports/summary', 'reports/calendar']) { await go('#/vat/' + v, 1800); await audit('after deleting an entity: ' + v); }

  // ---- broken links never crash
  for (const h of ['#/vat/ex/NOPE/overview', '#/vat/entity/NOPE', '#/vat/insights/NOPE', '#/nonsense/route', '#/vat/reports/nope', '#/vat/ex/' + dx + '/nope', '#/vat/annual/NOPE/2026']) {
    step = 'link ' + h; await go(h, 1500);
    ok(await ev("return document.querySelector('#main') && document.querySelector('#main').innerText.trim().length > 10"), 'broken link ' + h + ' shows something useful');
  }

  ws.close(); ch.kill();
  console.log('\n' + passed + ' checks passed, ' + fails.length + ' failed, ' + errors.length + ' JavaScript errors');
  [...new Set(errors)].forEach((e) => console.log('  ERROR ' + e));
  fails.forEach((f) => console.log('  FAIL  ' + f));
  setTimeout(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {} process.exit(fails.length || errors.length ? 1 : 0); }, 1500);
})().catch((e) => { console.error('aborted:', e.message); [...new Set(errors)].forEach((x) => console.log('  ERROR ' + x)); fails.forEach((f) => console.log('  FAIL  ' + f)); process.exit(2); });
