// Probe for ADR 0019: is `downloads.onCreated` early enough to read a blob the page is saving?
// Not shipped. Synthetic page only. Reports one JSON line per download to the driver (run.mjs).
const api = typeof browser !== 'undefined' ? browser : chrome;
const REPORT = 'http://127.0.0.1:__PORT__/report';

const send = (row) => fetch(REPORT, { method: 'POST', body: JSON.stringify(row) }).catch(() => undefined);

function askPage(tabId, url) {
  return new Promise((resolve) => {
    const done = (r) => resolve(r ?? { ok: false, error: 'no answer: ' + (api.runtime.lastError?.message ?? '') });
    try {
      const p = api.tabs.sendMessage(tabId, { probe: 'fetch', url }, done);
      if (p && p.then) p.then(done, (e) => resolve({ ok: false, error: String(e) }));
    } catch (e) {
      resolve({ ok: false, error: String(e) });
    }
  });
}

api.downloads.onCreated.addListener(async (item) => {
  const seenAt = Date.now();
  const row = {
    event: 'onCreated',
    id: item.id,
    url: item.url,
    finalUrl: item.finalUrl,
    filename: item.filename,
    mime: item.mime,
    state: item.state,
    hasTabId: "tabId" in item,
  };
  const tabs = await api.tabs.query({ url: 'http://127.0.0.1/*' });
  const tab = tabs.find((t) => /\/page/.test(t.url));
  row.tab = tab ? tab.id : null;
  if (tab && item.url.startsWith('blob:')) row.read = await askPage(tab.id, item.url);
  row.readMs = Date.now() - seenAt;
  // cancel + erase, as the feature would
  try {
    await api.downloads.cancel(item.id);
    row.cancel = 'ok';
  } catch (e) {
    row.cancel = String(e);
  }
  // A blob this small is complete before the event is delivered, so the cancel above is too late;
  // the file is then removed from disk explicitly (what the feature has to do to save nothing).
  try {
    await new Promise((r) => setTimeout(r, 300));
    await api.downloads.removeFile(item.id);
    row.removeFile = 'ok';
  } catch (e) {
    row.removeFile = String(e);
  }
  try {
    await api.downloads.erase({ id: item.id });
    row.erase = 'ok';
  } catch (e) {
    row.erase = String(e);
  }
  const after = await api.downloads.search({ id: item.id });
  row.stateAfter = after[0]?.state ?? 'erased';
  await send(row);
});

api.downloads.onChanged.addListener((d) => send({ event: 'onChanged', id: d.id, state: d.state?.current, error: d.error?.current }));
send({ event: 'started' });
