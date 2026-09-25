/**
 * The manifest, per build target. One function instead of a framework config: the two flavours
 * differ in five keys, and spelling those out is shorter than learning which ones a tool converts.
 */

export type Target = 'chrome-mv3' | 'firefox-mv2';

export const TARGETS: readonly Target[] = ['chrome-mv3', 'firefox-mv2'];

// Host access is OPTIONAL and granted per host, at the moment the person raises a site above
// `none` in the popup. The browser's own permission prompt therefore mirrors beifahrer's policy: a
// site the person never allowed is one the extension cannot even inject into, so a bug in the
// policy check cannot widen access past what the browser granted.
//
// `<all_urls>` is optional too, for one reason only: Chromium's `captureVisibleTab` accepts nothing
// narrower (and Firefox does not even define it without). It is requested separately, from the
// options page, when the person switches screenshots on.
const HOSTS = ['http://*/*', 'https://*/*', '<all_urls>'];

/** Toolbar and store icons, all derived from icons/sparkles.svg (scripts/icons.ts). */
export const ICON_SIZES = [16, 32, 48, 128] as const;

/** Sizes drawn from icons/sparkles-small.svg, the fuller toolbar form. */
export const isSmall = (size: number): boolean => size <= 32;
export const ICON_VARIANTS = ['idle', 'active', 'paused', 'offline'] as const;
export type IconVariant = (typeof ICON_VARIANTS)[number];

/**
 * Where an icon lives in the build. Firefox renders the SVG sharp at every size; Chromium wants
 * PNGs, which scripts/icons.ts renders from the same SVG at build time.
 */
export function iconPaths(target: Target, variant: IconVariant): Record<string, string> {
  const out: Record<string, string> = {};
  for (const size of ICON_SIZES)
    out[String(size)] =
      target === 'firefox-mv2'
        ? `icons/${variant}${isSmall(size) ? '-small' : ''}.svg`
        : `icons/${variant}-${size}.png`;
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
  const mv3 = target === 'chrome-mv3';
  // `sessions`: the browser's recently-closed list, so a window closed by mistake comes back.
  // `tabGroups`: naming and colouring tab groups (Chromium; Firefox ≥ 139). Both are used only
  // behind the person's "Let the agent manage tabs and windows" switch, and for the person's own
  // restore buttons in the options page.
  const permissions = ['tabs', 'storage', 'alarms', 'sessions', 'tabGroups', ...(mv3 ? ['scripting'] : [])];
  const action = {
    default_title: 'beifahrer',
    default_popup: 'popup.html',
    // "Not connected" until the background knows better (src/toolbar.ts).
    default_icon: iconPaths(target, 'offline'),
  };
  return {
    manifest_version: mv3 ? 3 : 2,
    name: 'beifahrer',
    description:
      'Let an AI agent ride along in this browser — see your tabs, read and edit pages you allow, site by site.',
    version,
    icons: iconPaths(target, 'active'),
    permissions: mv3 ? permissions : [...permissions, ...e2eHosts],
    ...(mv3
      ? { optional_host_permissions: HOSTS, ...(e2eHosts.length ? { host_permissions: e2eHosts } : {}) }
      : { optional_permissions: HOSTS }),
    ...(mv3 ? { action } : { browser_action: action }),
    background: mv3 ? { service_worker: 'background.js' } : { scripts: ['background.js'] },
    options_ui: { page: 'options.html', open_in_tab: true },
    // The kill switch from the keyboard. Only the person can press it; the bridge cannot.
    commands: {
      'toggle-pause': {
        suggested_key: { default: 'Alt+Shift+B' },
        description: 'Pause or resume beifahrer (the agent gets nothing while paused)',
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
