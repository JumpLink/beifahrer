/**
 * Open the options page from the popup.
 *
 * `runtime.openOptionsPage()` is a promise, and the popup used to fire it with `void`: a rejection was
 * swallowed and nothing opened. So a failure falls back to the page's own URL in a tab, the same call
 * the "show all" link already makes for a hash. The popup closes afterwards, since Firefox keeps it
 * open over the new tab and Chromium and Safari leave it standing too.
 */

export type OptionsApi = {
  runtime: { openOptionsPage(): Promise<void>; getURL(path: string): string };
  tabs: { create(options: { url: string }): Promise<unknown> };
};

export async function openOptions(
  api: OptionsApi,
  hash = '',
  close: () => void = () => window.close(),
): Promise<void> {
  const inTab = () => api.tabs.create({ url: api.runtime.getURL(`/options.html${hash ? `#${hash}` : ''}`) });
  try {
    if (hash) await inTab();
    else await api.runtime.openOptionsPage();
  } catch {
    if (!hash) await inTab().catch(() => undefined);
  }
  close();
}
