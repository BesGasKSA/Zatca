// node tools/serve.js [dir] [port] — static dev server that never lets the browser cache.
var http = require('http'), fs = require('fs'), path = require('path');
var root = path.resolve(process.argv[2] || 'web'), port = +(process.argv[3] || 5180);
var TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
http.createServer(function (req, res) {
  var p = decodeURIComponent(req.url.split('?')[0]);
  var f = path.join(root, p === '/' ? 'index.html' : p);
  if (f.indexOf(root) !== 0) { res.writeHead(403); return res.end(); }
  fs.readFile(f, function (err, buf) {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(buf);
  });
}).listen(port, '127.0.0.1', function () { console.log('serving ' + root + ' on http://127.0.0.1:' + port); });
