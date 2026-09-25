import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
const PORT = 47813;
const log = (s) => { fs.appendFileSync(new URL('./report.jsonl', import.meta.url), s + '\n'); };
const page = `<!doctype html><html><head><title>werkstatt probe page</title></head><body>
<h1>Probe</h1><textarea></textarea><div contenteditable="true" style="border:1px solid">x</div>
<button>klick</button><p>inputs: <span id="inputs">0</span> clicks: <span id="clicks">0</span></p>
<script>window.pageVar = 42; let i=0,c=0; document.addEventListener('input',()=>{document.getElementById('inputs').textContent=++i});
document.querySelector('button').addEventListener('click',()=>{document.getElementById('clicks').textContent=++c});
document.cookie='probe=1';</script></body></html>`;
const srv = http.createServer((req, res) => {
  log(JSON.stringify({ name: 'http', method: req.method, url: req.url, origin: req.headers.origin ?? null }));
  if (req.url.startsWith('/test.html')) { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(page); }
  if (req.url === '/sample.pdf') { res.writeHead(200, { 'content-type': 'application/pdf' }); return res.end('%PDF-1.4\n%probe\n'); }
  if (req.url === '/fallback') { let b = ''; req.on('data', (d) => b += d); req.on('end', () => { log(JSON.stringify({ name: 'fallback', detail: b })); res.end('ok'); }); return; }
  res.writeHead(200, { 'access-control-allow-origin': '*' }); res.end('pong');
});
srv.on('upgrade', (req, sock) => {
  const accept = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  sock.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  log(JSON.stringify({ name: 'ws-upgrade', origin: req.headers.origin ?? null }));
  let buf = Buffer.alloc(0);
  sock.on('data', (d) => {
    buf = Buffer.concat([buf, d]);
    while (buf.length >= 2) {
      let len = buf[1] & 127, off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
      if (buf.length < off + 4 + len) return;
      const mask = buf.subarray(off, off + 4); const data = Buffer.from(buf.subarray(off + 4, off + 4 + len));
      for (let i = 0; i < data.length; i++) data[i] ^= mask[i % 4];
      const op = buf[0] & 15; buf = buf.subarray(off + 4 + len);
      if (op === 1) log(data.toString());
      if (op === 8) sock.end();
    }
  });
  sock.on('error', () => {});
});
srv.listen(PORT, '127.0.0.1', () => log(JSON.stringify({ name: 'server-up' })));
