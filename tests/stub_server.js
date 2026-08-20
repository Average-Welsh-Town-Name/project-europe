// Test stub: serves the game statically on :3100 and hands it a fake
// socket.io — emits are recorded in window.__emitted, and window.__fire
// drives inbound events by hand. Run from the repo root (or set GAME_ROOT):
//   node tests/stub_server.js
const http = require('http');
const fs = require('fs');
const path = require('path');
const ROOT = process.env.GAME_ROOT || path.join(__dirname, '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.svg': 'image/svg+xml',
    '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
    '.css': 'text/css', '.wav': 'audio/wav', '.mp3': 'audio/mpeg' };
const FAKE_IO = `
window.__emitted = [];
window.__handlers = {};
window.io = function () {
  window.__socket = {
    id: 'sock_me',
    on: function (ev, fn) { (window.__handlers[ev] = window.__handlers[ev] || []).push(fn); return this; },
    once: function (ev, fn) { return this.on(ev, fn); },
    emit: function () { window.__emitted.push(Array.prototype.slice.call(arguments)); return this; },
    off: function () { return this; }, disconnect: function () {}, connect: function () {},
    io: { on: function () {} }, connected: true
  };
  return window.__socket;
};
window.__fire = function (ev) {
  var args = Array.prototype.slice.call(arguments, 1);
  (window.__handlers[ev] || []).forEach(function (f) { try { f.apply(null, args); } catch (e) { console.error(e); } });
};
`;
http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    if (url === '/socket.io/socket.io.js') {
        res.writeHead(200, { 'Content-Type': 'text/javascript' });
        return res.end(FAKE_IO);
    }
    const file = path.resolve(path.join(ROOT, url === '/' ? 'index.html' : url));
    if (!file.startsWith(path.resolve(ROOT))) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (err, data) => {
        if (err) { res.writeHead(404); return res.end('not found'); }
        res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
        res.end(data);
    });
}).listen(process.env.PORT || 3100, () => console.log('stub up on ' + (process.env.PORT || 3100)));
