/* Accessibility scan (WCAG 2.1 A and AA) of every screen with axe-core, in
   English and Arabic, light and dark. Needs `npm run dev`, Chrome and network
   access to cdnjs for axe-core.  node tests/e2e-a11y.js [chromePath]        */
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const CHROME = process.argv[2] || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = 'http://127.0.0.1:5181/', PORT = 9342, AXE = 'https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.10.2/axe.min.js';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zr-a11y-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws, seq = 0; const pend = {};
const send = (method, params) => new Promise((res, rej) => { const i = ++seq; pend[i] = { res, rej }; ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
async function ev(expr) { const r = await send('Runtime.evaluate', { expression: '(async () => { ' + expr + ' })()', awaitPromise: true, returnByValue: true, userGesture: true }); if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception || {}).description || r.exceptionDetails.text); return r.result && r.result.value; }

(async () => {
  const axeSrc = await (await fetch(AXE)).text();
  if (!/axe/.test(axeSrc.slice(0, 2000))) throw new Error('could not load axe-core');
  const ch = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT, '--user-data-dir=' + path.join(tmp, 'p'), '--no-first-run', 'about:blank'], { stdio: 'ignore' });
  let list; for (let i = 0; i < 160; i++) { try { list = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json(); if (list.length) break; } catch (e) {} await sleep(250); }
  ws = new WebSocket(list.find((p) => p.type === 'page').webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  ws.addEventListener('message', (m) => { const d = JSON.parse(m.data); if (d.id && pend[d.id]) { (d.error ? pend[d.id].rej : pend[d.id].res)(d.result || d.error); delete pend[d.id]; } if (d.method === 'Page.javascriptDialogOpening') send('Page.handleJavaScriptDialog', { accept: true }); });
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 860, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: BASE }); await sleep(2500);
  await ev("localStorage.setItem('zr_lang','en'); return 1"); await send('Page.reload'); await sleep(2500);
  if (await ev("return !!document.getElementById('authf')")) await ev("document.querySelector('[data-act=localmode]').click(); return 1");
  await sleep(1500);
  await ev('Z.ACT.loaddemo(); return 1');
  for (let i = 0; i < 80 && !(await ev("var x = Z.S.ex; return !!x && Z.S.loaded && Z.S.datasets.length >= 10")); i++) await sleep(500);
  const ex = await ev('return Z.S.ex.id'), ent = await ev('return Z.S.ex.entityId');
  const pages = ['vat/dashboard', 'vat/insights/' + ent, 'vat/ex/' + ex + '/overview', 'vat/ex/' + ex + '/plan', 'vat/ex/' + ex + '/data', 'vat/ex/' + ex + '/filing', 'vat/ex/' + ex + '/vat', 'vat/ex/' + ex + '/einv', 'vat/ex/' + ex + '/bank',
    'vat/ex/' + ex + '/other', 'vat/ex/' + ex + '/analytics', 'vat/ex/' + ex + '/sampling', 'vat/ex/' + ex + '/checklist', 'vat/ex/' + ex + '/findings', 'vat/ex/' + ex + '/report',
    'wht/dashboard', 'wht/insights/' + ent, 'wht/ex/' + ex + '/overview', 'wht/ex/' + ex + '/wht', 'vat/reports/summary', 'vat/reports/corrections', 'wht/reports/beneficiaries', 'vat/entities', 'vat/entity/' + ent, 'vat/entity/' + ent + '/edit',
    'vat/requests', 'vat/settings', 'vat/users', 'vat/audit', 'vat/annual/' + ent + '/2025', 'vat/account/' + ent, 'vat/refunds', 'vat/disputes', 'vat/calendar'];
  const found = {};
  async function scan(tag) {
    for (const p of pages) {
      await ev("location.hash = '#/" + p + "'; return 1"); await sleep(p.indexOf('insights') >= 0 || p.indexOf('beneficiaries') >= 0 ? 3000 : 1400);
      await ev("document.querySelectorAll('*').forEach(function (el) { el.style.animation = 'none'; }); return 1");   // judge the final state, not mid-animation
      if (!(await ev('return typeof axe !== "undefined"'))) await send('Runtime.evaluate', { expression: axeSrc });
      const v = await ev("return axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }, resultTypes: ['violations'] }).then(function (r) { return r.violations.map(function (x) { return { id: x.id, impact: x.impact, help: x.help, n: x.nodes.length, sample: x.nodes.slice(0, 2).map(function (n) { return n.target.join(' ') + ' :: ' + (n.failureSummary || '').split('\\n').slice(1, 2).join(''); }), pairs: x.id !== 'color-contrast' ? [] : x.nodes.map(function (n) { var d = (n.any[0] || {}).data || {}; return d.fgColor + ' on ' + d.bgColor + ' = ' + d.contrastRatio + ' ' + n.target.join(' ').slice(-40); }) }; }); })");
      v.forEach((x) => { const f = found[x.id] = found[x.id] || { impact: x.impact, help: x.help, pages: [], n: 0, sample: x.sample, pairs: {} }; f.n += x.n; (x.pairs || []).forEach((pr) => { f.pairs[tag + ' ' + pr] = (f.pairs[tag + ' ' + pr] || 0) + 1; }); if (f.pages.length < 6) f.pages.push(tag + ' ' + p.split('/').slice(0, 2).join('/') + (p.indexOf('/ex/') >= 0 ? '/' + p.split('/').pop() : '')); });
    }
  }
  await scan('EN');
  await ev("localStorage.setItem('zr_lang','ar'); return 1"); await send('Page.reload'); await sleep(3000);
  await scan('AR');
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
  await ev("localStorage.setItem('zr_lang','en'); return 1"); await send('Page.reload'); await sleep(3000);
  await scan('DARK');
  ws.close(); ch.kill();
  const ids = Object.keys(found).sort((a, b) => ['critical', 'serious', 'moderate', 'minor'].indexOf(found[a].impact) - ['critical', 'serious', 'moderate', 'minor'].indexOf(found[b].impact));
  console.log('\n' + pages.length * 3 + ' screens scanned, ' + ids.length + ' kinds of violation');
  ids.forEach((id) => { const f = found[id]; console.log('\n[' + f.impact + '] ' + id + ' — ' + f.help + ' (' + f.n + ' elements)\n   pages: ' + f.pages.join(', ') + '\n   e.g. ' + f.sample.join('\n        ') + (Object.keys(f.pairs).length ? '\n   colour pairs:\n' + Object.keys(f.pairs).sort((a, b) => f.pairs[b] - f.pairs[a]).slice(0, 60).map((k) => '     ' + f.pairs[k] + 'x ' + k).join('\n') : '')); });
  setTimeout(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {} process.exit(ids.length ? 1 : 0); }, 1500);
})().catch((e) => { console.error('aborted:', e.message); process.exit(2); });
