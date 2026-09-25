import { defineConfig } from 'wxt';

// Host access is OPTIONAL and granted per origin, at the moment the person raises that origin
// above `none` in the popup. The browser's own permission prompt therefore mirrors beifahrer's
// policy: an origin the person never allowed is one the extension cannot even inject into, so a
// bug in the policy check cannot widen access past what the browser granted.
//
// `<all_urls>` is listed as optional too, for one reason only: Chromium's `captureVisibleTab`
// accepts nothing narrower. It is requested separately, from the options page, when the person
// switches screenshots on.
const HOSTS = ['http://*/*', 'https://*/*', '<all_urls>'];

/**
 * E2E builds only (tests/e2e): BEIFAHRER_E2E_SEED='{"token","port","policy"}' pre-pairs the
 * extension and pre-grants the fixture origins, because a test cannot click the browser's
 * permission prompt. Such a build goes to its own output directory and is never zipped or shipped;
 * without the variable none of this exists in the bundle.
 */
const E2E_SEED = process.env.BEIFAHRER_E2E_SEED ?? '';
const e2eOrigins = E2E_SEED
  ? Object.keys((JSON.parse(E2E_SEED) as { policy?: { origins?: object } }).policy?.origins ?? {}).map(
      // Host only, no port — see originPattern() in src/settings.ts for why.
      (o) => `${new URL(o).protocol}//${new URL(o).hostname}/*`,
    )
  : [];

export default defineConfig({
  ...(E2E_SEED ? { outDir: '.output-e2e' } : {}),
  vite: () => ({ define: { __E2E_SEED__: JSON.stringify(E2E_SEED) } }),
  manifest: ({ manifestVersion, browser }) => ({
    name: 'beifahrer',
    description:
      'Let an AI agent ride along in this browser — see your tabs, read and edit pages you allow, site by site.',
    permissions: ['tabs', 'storage', 'alarms', ...(manifestVersion === 3 ? ['scripting'] : [])],
    ...(manifestVersion === 3 ? { optional_host_permissions: HOSTS } : { optional_permissions: HOSTS }),
    ...(e2eOrigins.length
      ? manifestVersion === 3
        ? { host_permissions: e2eOrigins }
        : { permissions: ['tabs', 'storage', 'alarms', ...e2eOrigins] }
      : {}),
    ...(browser === 'firefox'
      ? {
          browser_specific_settings: {
            gecko: {
              id: 'beifahrer@jumplink.eu',
              strict_min_version: '140.0',
              // Nothing leaves the device: the only channel is the loopback socket to the bridge the
              // person runs themselves. Mozilla's category for that is "none".
              data_collection_permissions: { required: ['none'] },
            },
          },
        }
      : {}),
    action: { default_title: 'beifahrer' },
  }),
});
