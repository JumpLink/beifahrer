console.log('[probe] background start', typeof browser, typeof chrome, typeof WebSocket, location.href);
const b = globalThis.browser ?? globalThis.chrome;
try { b.tabs.create({ url: 'http://127.0.0.1:47813/alive?' + encodeURIComponent(Object.keys(b).join(',')) }); } catch (e) { console.log('[probe] tabs.create threw', e.message); }
const PORT = 47813;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws;
const out = [];
function rep(name, ok, detail) {
  const line = { name, ok, detail: detail === undefined ? null : detail };
  out.push(line);
  try { ws && ws.readyState === 1 && ws.send(JSON.stringify(line)); } catch (e) {}
}
async function t(name, fn) {
  try { const d = await Promise.race([fn(), sleep(5000).then(() => { throw new Error('timeout 5s'); })]); rep(name, true, d); return d; }
  catch (e) { rep(name, false, String(e && e.message || e)); }
}
const events = {};
function watch(ns, ev) {
  const o = b[ns] && b[ns][ev];
  if (!o || !o.addListener) { events[ns + '.' + ev] = 'missing'; return; }
  events[ns + '.' + ev] = 0;
  try { o.addListener(() => { events[ns + '.' + ev]++; }); } catch (e) { events[ns + '.' + ev] = 'addListener threw: ' + e.message; }
}
async function run() {
  rep('env', true, { ua: navigator.userAgent, hasBrowser: !!globalThis.browser, hasChrome: !!globalThis.chrome, namespaces: Object.keys(b).sort() });
  rep('api-shape', true, Object.fromEntries(['tabs', 'windows', 'runtime', 'cookies', 'scripting', 'webNavigation', 'webRequest', 'debugger'].map((n) => [n, b[n] ? Object.keys(b[n]).sort() : null])));
  for (const [ns, ev] of [['tabs','onActivated'],['tabs','onUpdated'],['tabs','onCreated'],['tabs','onRemoved'],['windows','onFocusChanged'],['windows','onCreated']]) watch(ns, ev);

  await t('fetch localhost', async () => (await fetch(`http://127.0.0.1:${PORT}/ping`)).status);
  await t('tabs.query all', async () => { const ts = await b.tabs.query({}); return { count: ts.length, fields: ts[0] ? Object.keys(ts[0]).sort() : [], urlsPresent: ts.filter((x) => x.url).length }; });
  await t('tabs.query active+currentWindow', async () => { const ts = await b.tabs.query({ active: true, currentWindow: true }); return { count: ts.length, hasUrl: !!(ts[0] && ts[0].url), hasTitle: !!(ts[0] && ts[0].title) }; });
  await t('tabs.query lastFocusedWindow', async () => (await b.tabs.query({ active: true, lastFocusedWindow: true })).length);
  await t('windows.getAll', async () => { const w = await b.windows.getAll({ populate: true }); return { count: w.length, fields: w[0] ? Object.keys(w[0]).sort() : [], focused: w.filter((x) => x.focused).length }; });
  await t('windows.getLastFocused', async () => Object.keys(await b.windows.getLastFocused()).sort());

  const tab = await t('tabs.create test page', async () => { const x = await b.tabs.create({ url: `http://127.0.0.1:${PORT}/test.html`, active: true }); return { id: x.id, fields: Object.keys(x).sort() }; });
  await sleep(2500);
  const id = tab && tab.id;
  await t('tabs.get after load', async () => { const x = await b.tabs.get(id); return { status: x.status, url: x.url, title: x.title }; });
  await t('executeScript read title', async () => b.tabs.executeScript(id, { code: 'document.title' }));
  await t('executeScript return object', async () => b.tabs.executeScript(id, { code: '({a:1, n: document.querySelectorAll("*").length})' }));
  await t('executeScript async (promise result)', async () => b.tabs.executeScript(id, { code: 'new Promise(r => setTimeout(() => r("resolved"), 100))' }));
  await t('executeScript throws', async () => b.tabs.executeScript(id, { code: 'throw new Error("boom")' }));
  await t('executeScript file', async () => b.tabs.executeScript(id, { file: '/content.js' }));
  await t('executeScript allFrames', async () => b.tabs.executeScript(id, { code: 'location.href', allFrames: true }));
  await t('write textarea + input event', async () => b.tabs.executeScript(id, { code: `(() => { const el = document.querySelector('textarea'); el.focus(); el.value = 'von der Erweiterung'; el.dispatchEvent(new Event('input', {bubbles:true})); return [el.value, document.getElementById('inputs').textContent]; })()` }));
  await t('write contenteditable via execCommand', async () => b.tabs.executeScript(id, { code: `(() => { const el = document.querySelector('[contenteditable]'); el.focus(); const ok = document.execCommand('insertText', false, 'Kommentar per insertText'); return [ok, el.textContent, document.getElementById('inputs').textContent]; })()` }));
  await t('page-world access (window.pageVar)', async () => b.tabs.executeScript(id, { code: 'typeof window.pageVar + ":" + (window.wrappedJSObject ? "xray" : "no-xray")' }));
  await t('click button', async () => b.tabs.executeScript(id, { code: `(() => { document.querySelector('button').click(); return document.getElementById('clicks').textContent; })()` }));
  await t('tabs.sendMessage to content script', async () => b.tabs.sendMessage(id, { kind: 'ping' }));
  await t('tabs.insertCSS', async () => b.tabs.insertCSS(id, { code: 'body{outline:3px solid red}' }));
  await t('tabs.captureVisibleTab', async () => { const d = await b.tabs.captureVisibleTab(); return d ? d.slice(0, 30) + '… len ' + d.length : d; });
  await t('tabs.update navigate', async () => { await b.tabs.update(id, { url: `http://127.0.0.1:${PORT}/test.html?nav=1` }); await sleep(1500); return (await b.tabs.get(id)).url; });
  await t('tabs.reload', async () => { await b.tabs.reload(id); return true; });
  await t('cookies.getAll 127.0.0.1', async () => { const c = await b.cookies.getAll({ domain: '127.0.0.1' }); return c.map((x) => x.name); });
  await t('cookies.getAll (all stores, count only)', async () => (await b.cookies.getAll({})).length);
  await t('downloads.download', async () => b.downloads.download({ url: `http://127.0.0.1:${PORT}/sample.pdf`, filename: 'werkstatt-probe-sample.pdf' }));
  await t('tabs.goBack', async () => { if (!b.tabs.goBack) throw new Error('missing'); await b.tabs.goBack(id); return true; });
  // switch active tab to trigger onActivated
  await t('tabs.update active=false→other', async () => { const all = await b.tabs.query({}); const other = all.find((x) => x.id !== id); if (!other) return 'no other tab'; await b.tabs.update(other.id, { active: true }); await sleep(500); await b.tabs.update(id, { active: true }); await sleep(500); return true; });
  await t('tabs.remove test tab', async () => { await b.tabs.remove(id); await sleep(500); return true; });
  rep('events fired', true, events);
  rep('done', true, out.filter((x) => !x.ok).map((x) => x.name));
}
function connect() {
  try { ws = new WebSocket(`ws://127.0.0.1:${PORT}/bridge`); } catch (e) { fetch(`http://127.0.0.1:${PORT}/fallback`, { method: 'POST', body: 'ws ctor threw ' + e.message }); return; }
  ws.onclose = (e) => console.log('[probe] ws close', e.code, e.reason);
  ws.onopen = () => { console.log('[probe] ws open'); rep('websocket open', true); run(); };
  ws.onerror = (e) => { console.log('[probe] ws error', e && e.type); fetch(`http://127.0.0.1:${PORT}/fallback`, { method: 'POST', body: 'ws error' }).catch(() => {}); };
}
connect();
fetch(`http://127.0.0.1:${PORT}/fallback`, { method: 'POST', body: 'boot fetch' }).then((r) => console.log('[probe] boot fetch', r.status), (e) => console.log('[probe] boot fetch failed', e.message));
