// Probe for #197: does a viewer tab on the downloaded file appear, and when? Not shipped.
const api = typeof browser !== 'undefined' ? browser : chrome;
const REPORT = 'http://127.0.0.1:__PORT__/report';
const t0 = Date.now();
const send = (row) => fetch(REPORT, { method: 'POST', body: JSON.stringify({ t: Date.now() - t0, ...row }) }).catch(() => undefined);
api.tabs.onCreated.addListener((tab) => send({ event: 'tabCreated', id: tab.id, url: tab.url, pending: tab.pendingUrl }));
api.tabs.onUpdated.addListener((id, info) => info.url && send({ event: 'tabUrl', id, url: info.url }));
api.downloads.onCreated.addListener((item) => send({ event: 'dlCreated', id: item.id, state: item.state, filename: item.filename, url: item.url }));
api.downloads.onChanged.addListener(async (d) => {
  if (d.state?.current !== 'complete') return;
  const [item] = await api.downloads.search({ id: d.id });
  send({ event: 'dlComplete', id: d.id, filename: item?.filename });
  for (const wait of [0, 300, 1000, 2500]) {
    await new Promise((r) => setTimeout(r, wait));
    const files = (await api.tabs.query({ url: 'file:///*' }).catch((e) => String(e)));
    const all = (await api.tabs.query({})).map((t) => t.url);
    send({ event: 'afterComplete', wait, fileTabs: Array.isArray(files) ? files.map((t) => t.url) : files, all });
  }
});
send({ event: 'started' });
