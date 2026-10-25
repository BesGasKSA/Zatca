// Renders the app icons (the seal-check mark on the brand teal) to PNG with headless Chrome.
const { spawn } = require('child_process'); const fs = require('fs'), path = require('path');
const OUT = process.argv[2], CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe', PORT = 9391;
fs.mkdirSync(OUT, { recursive: true }); const prof = path.join(require('os').tmpdir(), 'icp' + Date.now());
const ch = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT, '--user-data-dir=' + prof, '--no-first-run', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)); let ws, id = 0; const pend = {};
const send = (m, p) => new Promise((res) => { const i = ++id; pend[i] = res; ws.send(JSON.stringify({ id: i, method: m, params: p || {} })); });
// full-bleed square for "maskable" (safe zone = inner 80%), rounded tile for "any"
const svg = (size, maskable) => '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size + '" viewBox="0 0 100 100">' +
  (maskable ? '<rect width="100" height="100" fill="#0f766e"/>' : '<rect x="4" y="4" width="92" height="92" rx="22" fill="#0f766e"/>') +
  '<g transform="translate(50 50) scale(' + (maskable ? 0.62 : 0.74) + ') translate(-50 -50)"><circle cx="50" cy="50" r="30" fill="none" stroke="#ccfbf1" stroke-width="6"/>' +
  '<path d="M36 51l10 10 19-22" fill="none" stroke="#ffffff" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/></g></svg>';
(async () => {
  let list; for (let i = 0; i < 100; i++) { try { list = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json(); if (list.length) break; } catch (e) {} await sleep(200); }
  ws = new WebSocket(list.find((p) => p.type === 'page').webSocketDebuggerUrl); await new Promise((r) => ws.addEventListener('open', r));
  ws.addEventListener('message', (m) => { const d = JSON.parse(m.data); if (d.id && pend[d.id]) { pend[d.id](d.result); delete pend[d.id]; } });
  for (const [name, size, mask] of [['icon-192.png', 192, false], ['icon-512.png', 512, false], ['maskable-512.png', 512, true], ['apple-touch-icon.png', 180, true]]) {
    await send('Emulation.setDeviceMetricsOverride', { width: size, height: size, deviceScaleFactor: 1, mobile: false });
    await send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
    await send('Page.navigate', { url: 'data:text/html,' + encodeURIComponent('<html><body style="margin:0;background:transparent">' + svg(size, mask) + '</body></html>') });
    await sleep(600);
    const r = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: size, height: size, scale: 1 } });
    fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64')); console.log('icon', name);
  }
  fs.writeFileSync(path.join(OUT, 'icon.svg'), svg(512, false));
  ws.close(); ch.kill(); setTimeout(() => { try { fs.rmSync(prof, { recursive: true, force: true }); } catch (e) {} process.exit(0); }, 800);
})();
