const api = typeof browser !== 'undefined' ? browser : chrome;
api.runtime.onMessage.addListener((msg, _s, reply) => {
  if (msg?.probe !== 'fetch') return undefined;
  fetch(msg.url)
    .then((r) => r.arrayBuffer())
    .then((b) => reply({ ok: true, bytes: b.byteLength }))
    .catch((e) => reply({ ok: false, error: String(e) }));
  return true;
});
