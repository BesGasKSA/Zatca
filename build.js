// node build.js — inlines web/ into one HTML file:
//   apps-script/Index.html   served by the Apps Script web app itself (talks via google.script.run)
//   dist/index.html          host anywhere; connect to the backend in Settings
//   docs/index.html, index.html  the GitHub Pages copy (root and /docs), with the
//                            backend URL from deploy.json baked in so visitors land on sign-in
var fs = require('fs'), path = require('path');
var W = path.join(__dirname, 'web');
var html = fs.readFileSync(path.join(W, 'index.html'), 'utf8');
var read = function (f) { return fs.readFileSync(path.join(W, f), 'utf8'); };

html = html.replace(/<!--build:css-->[\s\S]*?<!--\/build-->/, function (block) {
  return block.match(/href="([^"]+)"/g).map(function (m) { return '<style>\n' + read(m.slice(6, -1)) + '\n</style>'; }).join('\n');
});
html = html.replace(/<!--build:js-->[\s\S]*?<!--\/build-->/, function (block) {
  // "</script" inside a script body would end the tag early
  return block.match(/src="([^"]+)"/g).map(function (m) { return '<script>\n' + read(m.slice(5, -1)).replace(/<\/script/gi, '<\\/script') + '\n</script>'; }).join('\n');
});

function out(rel, content) {
  var f = path.join(__dirname, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, content);
}
out('apps-script/Index.html', html);
out('dist/index.html', html);

var deploy = {};
try { deploy = JSON.parse(fs.readFileSync(path.join(__dirname, 'deploy.json'), 'utf8')); } catch (e) {}
if (deploy.apiUrl) {
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(deploy.apiUrl)) throw new Error('deploy.json apiUrl must be an Apps Script /exec URL');
  var pages = html.replace('<body>', '<body>\n<script>window.ZR_API_URL = ' + JSON.stringify(deploy.apiUrl) + ';</script>');
  // Pages may publish from /docs or from the repo root; serve the app from both
  out('docs/index.html', pages);
  out('docs/.nojekyll', '');
  out('index.html', pages);
  out('.nojekyll', '');
}
console.log('built apps-script/Index.html, dist/index.html' + (deploy.apiUrl ? ', docs/index.html (Pages → ' + deploy.apiUrl.slice(0, 60) + '…)' : '') + ' — ' + Math.round(html.length / 1024) + ' KB');
