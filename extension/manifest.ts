/**
 * The manifest, per build target. One function instead of a framework config: the two flavours
 * differ in five keys, and spelling those out is shorter than learning which ones a tool converts.
 */

export type Target = 'chrome-mv3' | 'firefox-mv2' | 'safari-mv3';

export const TARGETS: readonly Target[] = ['chrome-mv3', 'firefox-mv2', 'safari-mv3'];

// Host access is OPTIONAL and granted per host, at the moment the person raises a site above
// `none` in the popup. The browser's own permission prompt therefore mirrors beifahrer's policy: a
// site the person never allowed is one the extension cannot even inject into, so a bug in the
// policy check cannot widen access past what the browser granted.
//
// `<all_urls>` is optional too, for one reason only: Chromium's `captureVisibleTab` accepts nothing
// narrower (and Firefox does not even define it without). It is requested separately, from the
// options page, when the person switches screenshots on.
const HOSTS = ['http://*/*', 'https://*/*', '<all_urls>'];

/**
 * The manifest's suggested binding for `toggle-pause`. The person can rebind it in the browser
 * (extension/src/shortcut.ts reads what they actually have, via `commands.getAll()`); this is
 * only the default, and the fallback where that API does not exist.
 */
export const TOGGLE_PAUSE_SHORTCUT = 'Alt+Shift+B';

/** Toolbar and store icons, all derived from icons/sparkles.svg (scripts/icons.ts). */
export const ICON_SIZES = [16, 32, 48, 128] as const;

/** Sizes drawn from icons/sparkles-small.svg, the fuller toolbar form. */
export const isSmall = (size: number): boolean => size <= 32;
export const ICON_VARIANTS = ['idle', 'active', 'paused', 'offline'] as const;
export type IconVariant = (typeof ICON_VARIANTS)[number];

/**
 * Where an icon lives in the build: PNGs rendered from the SVG sources (scripts/icons.ts), for
 * every browser. Firefox was given the SVGs at first — they showed in about:debugging and stayed
 * BLANK in the toolbar button (measured, Firefox 155, 2026-09-25), so it gets the PNGs Chromium
 * already had.
 */
export function iconPaths(_target: Target, variant: IconVariant): Record<string, string> {
  const out: Record<string, string> = {};
  for (const size of ICON_SIZES) out[String(size)] = `icons/${variant}-${size}.png`;
  return out;
}

export interface ManifestInput {
  version: string;
  /** E2E builds only: host patterns granted up front, because a test cannot click a prompt. */
  e2eHosts?: string[];
}

export function manifestFor(
  target: Target,
  { version, e2eHosts = [] }: ManifestInput,
): Record<string, unknown> {
  // Safari takes the Chromium flavour: MV3, a service worker, `scripting`. What it lacks
  // (tab groups, the recently-closed list, per-origin optional hosts) is feature-detected at
  // run time, like on every other engine, rather than trimmed from the manifest.
  const mv3 = target !== 'firefox-mv2';
  // `sessions`: the browser's recently-closed list, so a window closed by mistake comes back.
  // `tabGroups`: naming and colouring tab groups (Chromium; Firefox ≥ 139). Both are used only
  // behind the person's "Let the agent manage tabs and windows" switch, and for the person's own
  // restore buttons in the options page.
  const permissions = ['tabs', 'storage', 'alarms', 'sessions', 'tabGroups', ...(mv3 ? ['scripting'] : [])];
  const action = {
    default_title: '__MSG_extName__',
    default_popup: 'popup.html',
    // "Not connected" until the background knows better (src/toolbar.ts).
    default_icon: iconPaths(target, 'offline'),
  };
  return {
    manifest_version: mv3 ? 3 : 2,
    name: '__MSG_extName__',
    // Store listings and the browser's extension list show these in the person's language
    // (_locales/, checked by scripts/locales.ts). `en` is the fallback for every other one.
    default_locale: 'en',
    description: '__MSG_extDescription__',
    version,
    icons: iconPaths(target, 'active'),
    permissions: mv3 ? permissions : [...permissions, ...e2eHosts],
    ...(mv3
      ? { optional_host_permissions: HOSTS, ...(e2eHosts.length ? { host_permissions: e2eHosts } : {}) }
      : { optional_permissions: HOSTS }),
    // Firefox puts a new extension's button into the Extensions (puzzle) menu unless the manifest
    // asks for the toolbar. The icon IS the "an agent is in your browser" signal, so it must be
    // visible without the person digging for it. Chromium has no equivalent: pinning there is manual.
    ...(mv3 ? { action } : { browser_action: { ...action, default_area: 'navbar' } }),
    // Safari gets a non-persistent background PAGE, not a service worker: in Safari 27's extension
    // service worker `new WebSocket('ws://127.0.0.1:…')` blocks the worker for good — no error, no
    // CPU, no further event, so every page waiting on it stays white. The same bundle in a
    // background page connects at once (measured 2026-09-25, AGENTS.md "Traps").
    background:
      target === 'safari-mv3'
        ? { scripts: ['background.js'], persistent: false }
        : mv3
          ? { service_worker: 'background.js' }
          : { scripts: ['background.js'] },
    options_ui: { page: 'options.html', open_in_tab: true },
    // The kill switch from the keyboard. Only the person can press it; the bridge cannot.
    commands: {
      'toggle-pause': {
        suggested_key: { default: TOGGLE_PAUSE_SHORTCUT },
        description: '__MSG_commandTogglePause__',
      },
    },
    ...(target === 'firefox-mv2'
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
  };
}
