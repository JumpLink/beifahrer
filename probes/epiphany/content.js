const b = globalThis.browser ?? globalThis.chrome;
b.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.kind === 'ping') {
    const r = { pong: true, title: document.title, textLen: document.body.innerText.length };
    sendResponse(r);
    return true;
  }
});
