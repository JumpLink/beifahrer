/**
 * Which browsers this computer has, which one the person uses, and whether Beifahrer's extension is
 * in each (ADR 0026). Pure: no GIO, no file, so the mapping and the parsers are tested without a
 * display or a profile. `browser-host.ts` is the edge that asks GIO and reads the files.
 *
 * Everything here is a hint for the order of lists and the words on a row, never a gate: a person
 * whose browser is not recognised can still pick any other, and nothing here writes to a browser.
 */

export type BrowserId = 'firefox' | 'chromium' | 'chrome' | 'brave' | 'edge' | 'safari';
export type BrowserKind = 'firefox' | 'chromium' | 'safari';

export interface BrowserSpec {
  id: BrowserId;
  kind: BrowserKind;
  name: string;
  /** Bare commands that resolve through PATH when the browser is installed. */
  commands: string[];
  /** Known install locations per `process.platform`. */
  files: Partial<Record<string, string[]>>;
}

const FLATPAK = (id: string) => [
  `/var/lib/flatpak/exports/bin/${id}`,
  `~/.local/share/flatpak/exports/bin/${id}`,
];

export const BROWSERS: readonly BrowserSpec[] = [
  {
    id: 'firefox',
    kind: 'firefox',
    name: 'Firefox',
    commands: ['firefox', 'firefox-esr'],
    files: {
      linux: [...FLATPAK('org.mozilla.firefox'), '/snap/bin/firefox'],
      darwin: ['/Applications/Firefox.app'],
      win32: [
        '%ProgramFiles%\\Mozilla Firefox\\firefox.exe',
        '%ProgramFiles(x86)%\\Mozilla Firefox\\firefox.exe',
      ],
    },
  },
  {
    id: 'chromium',
    kind: 'chromium',
    name: 'Chromium',
    commands: ['chromium', 'chromium-browser'],
    files: {
      linux: [...FLATPAK('org.chromium.Chromium'), '/snap/bin/chromium'],
      darwin: ['/Applications/Chromium.app'],
    },
  },
  {
    id: 'chrome',
    kind: 'chromium',
    name: 'Google Chrome',
    commands: ['google-chrome', 'google-chrome-stable'],
    files: {
      linux: FLATPAK('com.google.Chrome'),
      darwin: ['/Applications/Google Chrome.app'],
      win32: [
        '%ProgramFiles%\\Google\\Chrome\\Application\\chrome.exe',
        '%ProgramFiles(x86)%\\Google\\Chrome\\Application\\chrome.exe',
        '%LOCALAPPDATA%\\Google\\Chrome\\Application\\chrome.exe',
      ],
    },
  },
  {
    id: 'brave',
    kind: 'chromium',
    name: 'Brave',
    commands: ['brave', 'brave-browser'],
    files: {
      linux: FLATPAK('com.brave.Browser'),
      darwin: ['/Applications/Brave Browser.app'],
      win32: ['%ProgramFiles%\\BraveSoftware\\Brave-Browser\\Application\\brave.exe'],
    },
  },
  {
    id: 'edge',
    kind: 'chromium',
    name: 'Microsoft Edge',
    commands: ['microsoft-edge', 'microsoft-edge-stable'],
    files: {
      linux: FLATPAK('com.microsoft.Edge'),
      darwin: ['/Applications/Microsoft Edge.app'],
      win32: ['%ProgramFiles(x86)%\\Microsoft\\Edge\\Application\\msedge.exe'],
    },
  },
  // Recognised so the default can be named, never offered an install: its extension ships inside a
  // Mac app (ADR 0026 § 5).
  {
    id: 'safari',
    kind: 'safari',
    name: 'Safari',
    commands: [],
    files: { darwin: ['/Applications/Safari.app'] },
  },
];

export interface Probe {
  /** A file or folder exists at this absolute path. */
  has(path: string): boolean;
  /** A bare command resolves through PATH. */
  onPath(command: string): boolean;
}

/** The browsers whose command resolves or whose known install location exists, in table order. */
export function detectBrowsers(
  platform: string,
  expand: (path: string) => string,
  probe: Probe,
): BrowserId[] {
  return BROWSERS.filter(
    (b) =>
      b.commands.some((c) => probe.onPath(c)) || (b.files[platform] ?? []).some((f) => probe.has(expand(f))),
  ).map((b) => b.id);
}

export const specOf = (id: BrowserId): BrowserSpec => BROWSERS.find((b) => b.id === id)!;

// -- the default browser ---------------------------------------------------------------------

/**
 * The browser behind an application id or executable name, whatever the platform calls it:
 * `org.mozilla.firefox.desktop` and `firefox-esr.desktop` (Linux), `firefox.exe`, `msedge.exe`
 * (Windows, where GIO's id is the executable), `com.google.Chrome` or `com.microsoft.edgemac`
 * (macOS bundle ids). Null for anything else: a mail client, or a browser this list does not know.
 *
 * Order is load-bearing: `chrome` is a substring of nothing but Chrome, while Edge and Brave are
 * checked first because their ids can carry the word of the engine they are built on.
 */
export function browserOfApp(...names: (string | null | undefined)[]): BrowserId | null {
  for (const raw of names) {
    if (!raw) continue;
    const name = (raw.split(/[\\/]/).pop() ?? raw).toLowerCase().replace(/\.(desktop|exe)$/, '');
    if (name.includes('edge')) return 'edge';
    if (name.includes('brave')) return 'brave';
    if (name.includes('firefox')) return 'firefox';
    if (name.includes('chromium')) return 'chromium';
    if (name.includes('chrome')) return 'chrome';
    if (name.includes('safari')) return 'safari';
  }
  return null;
}

/** What a connected browser calls itself in `Hello` (core `browserFromUserAgent`), as a browser here. */
export function browserOfName(name: string): BrowserId | null {
  const n = name.toLowerCase();
  if (n.includes('edge')) return 'edge';
  if (n.includes('brave')) return 'brave';
  if (n.includes('firefox')) return 'firefox';
  if (n.includes('chromium')) return 'chromium';
  if (n.includes('chrome')) return 'chrome';
  return null;
}

export interface BrowserEntry {
  id: BrowserId;
  kind: BrowserKind;
  name: string;
  /** Found on this computer (or is the default, which proves it). */
  detected: boolean;
  isDefault: boolean;
}

/**
 * The list the person chooses from: the default browser first, then the others found on this
 * computer, then the rest that could be installed. Safari is listed only when it is the default or
 * found, because there is nothing to choose it for.
 */
export function browserChoices(found: readonly BrowserId[], defaultId: BrowserId | null): BrowserEntry[] {
  const entry = (b: BrowserSpec): BrowserEntry => ({
    id: b.id,
    kind: b.kind,
    name: b.name,
    detected: found.includes(b.id) || b.id === defaultId,
    isDefault: b.id === defaultId,
  });
  const all = BROWSERS.map(entry);
  const rank = (e: BrowserEntry) => (e.isDefault ? 0 : e.detected ? 1 : 2);
  return all
    .filter((e) => e.kind !== 'safari' || e.detected)
    .map((e, at) => ({ e, at }))
    .sort((a, b) => rank(a.e) - rank(b.e) || a.at - b.at)
    .map(({ e }) => e);
}

/** The browser to preselect: the first of the list. Firefox when nothing is known, as before. */
export const preselected = (choices: readonly BrowserEntry[]): BrowserId => choices[0]?.id ?? 'firefox';

// -- is the extension in it ------------------------------------------------------------------

/** Our add-on id (`browser_specific_settings.gecko.id` in extension/manifest.ts, pinned by a test). */
export const GECKO_ID = 'beifahrer@jumplink.eu';

/** What a store-installed Chromium extension is called in its manifest. */
export const EXTENSION_NAME = 'Beifahrer';

/**
 * Chromium extension ids of the store listings. Empty until a listing exists: an unpacked
 * extension's id is derived from its folder, so it cannot be named here and is found by the name in
 * its manifest instead. A store id added here is matched without reading anything else.
 */
export const CHROMIUM_STORE_IDS: readonly string[] = [];

/**
 * Where each browser's store page for Beifahrer is, once there is one. EMPTY on purpose: while a
 * browser has no entry the extension step shows the manual steps (ADR 0026 § 3). Chrome, Brave and
 * Edge share Chrome's store; Edge also has its own add-ons site.
 */
export const STORE_URLS: Partial<Record<BrowserId, string>> = {};

/** The user-data folders of a browser, one per way of installing it, with `expand` applied by the caller. */
export function profileRoots(id: BrowserId, platform: string): string[] {
  const win = (rel: string) => `%LOCALAPPDATA%\\${rel}\\User Data`;
  const mac = (rel: string) => `~/Library/Application Support/${rel}`;
  switch (id) {
    case 'firefox':
      return platform === 'darwin'
        ? [mac('Firefox')]
        : platform === 'win32'
          ? ['%APPDATA%\\Mozilla\\Firefox']
          : [
              '~/.mozilla/firefox',
              '~/.var/app/org.mozilla.firefox/.mozilla/firefox',
              '~/snap/firefox/common/.mozilla/firefox',
            ];
    case 'chromium':
      return platform === 'darwin'
        ? [mac('Chromium')]
        : platform === 'win32'
          ? [win('Chromium')]
          : [
              '~/.config/chromium',
              '~/.var/app/org.chromium.Chromium/config/chromium',
              '~/snap/chromium/common/chromium',
            ];
    case 'chrome':
      return platform === 'darwin'
        ? [mac('Google/Chrome')]
        : platform === 'win32'
          ? [win('Google\\Chrome')]
          : ['~/.config/google-chrome', '~/.var/app/com.google.Chrome/config/google-chrome'];
    case 'brave':
      return platform === 'darwin'
        ? [mac('BraveSoftware/Brave-Browser')]
        : platform === 'win32'
          ? [win('BraveSoftware\\Brave-Browser')]
          : [
              '~/.config/BraveSoftware/Brave-Browser',
              '~/.var/app/com.brave.Browser/config/BraveSoftware/Brave-Browser',
            ];
    case 'edge':
      return platform === 'darwin'
        ? [mac('Microsoft Edge')]
        : platform === 'win32'
          ? [win('Microsoft\\Edge')]
          : ['~/.config/microsoft-edge', '~/.var/app/com.microsoft.Edge/config/microsoft-edge'];
    case 'safari':
      return [];
  }
}

const join = (dir: string, name: string) => `${dir.replace(/[\\/]+$/, '')}/${name}`;

/**
 * The profile folders a Firefox `profiles.ini` names, absolute. `Path` is relative to the root
 * unless `IsRelative=0`; `[Install…]` sections name the profile the install really uses, which
 * newer Firefox keeps apart from the `[Profile…]` list.
 */
export function firefoxProfileDirs(profilesIni: string, root: string): string[] {
  const dirs: string[] = [];
  let section = '';
  let path: string | null = null;
  let relative = true;
  const flush = () => {
    if (/^Profile\d+$/i.test(section) && path) dirs.push(relative ? join(root, path) : path);
    if (/^Install/i.test(section) && path) dirs.push(join(root, path));
    path = null;
    relative = true;
  };
  for (const raw of profilesIni.split(/\r?\n/)) {
    const line = raw.trim();
    const head = /^\[(.+)\]$/.exec(line);
    if (head) {
      flush();
      section = head[1]!;
      continue;
    }
    const [key, ...rest] = line.split('=');
    const value = rest.join('=').trim();
    if (/^profile\d+$/i.test(section) || /^install/i.test(section)) {
      if (key === 'Path' && /^profile/i.test(section)) path = value;
      else if (key === 'Default' && /^install/i.test(section)) path = value;
      else if (key === 'IsRelative') relative = value !== '0';
    }
  }
  flush();
  return [...new Set(dirs)];
}

/** Firefox keeps its add-on database as `extensions.json` in the profile: `{ addons: [{ id, … }] }`. */
export function firefoxHasExtension(extensionsJson: string, id: string = GECKO_ID): boolean {
  try {
    const parsed = JSON.parse(extensionsJson) as { addons?: { id?: unknown }[] };
    return Array.isArray(parsed.addons) && parsed.addons.some((a) => a?.id === id);
  } catch {
    return false;
  }
}

/** The folders of a Chromium user-data directory that are profiles. */
export const chromiumProfileDirs = (names: readonly string[]): string[] =>
  names.filter((n) => n === 'Default' || /^Profile \d+$/.test(n));

/**
 * The name in an extension's `manifest.json`, with a `__MSG_key__` placeholder looked up in the
 * messages of its default locale (`readMessages` returns that file's text, or null). Our manifest
 * uses the placeholder, so the raw name alone says nothing.
 */
export function manifestName(
  manifestJson: string,
  readMessages: (locale: string) => string | null,
): string | null {
  try {
    const manifest = JSON.parse(manifestJson) as { name?: unknown; default_locale?: unknown };
    if (typeof manifest.name !== 'string') return null;
    const key = /^__MSG_(.+)__$/.exec(manifest.name)?.[1];
    if (key === undefined) return manifest.name;
    if (typeof manifest.default_locale !== 'string') return null;
    const text = readMessages(manifest.default_locale);
    if (text === null) return null;
    const messages = JSON.parse(text) as Record<string, { message?: unknown } | undefined>;
    const hit = Object.entries(messages).find(([k]) => k.toLowerCase() === key.toLowerCase())?.[1];
    return typeof hit?.message === 'string' ? hit.message : null;
  } catch {
    return null;
  }
}

/**
 * Whether a Chromium `Preferences` / `Secure Preferences` file lists Beifahrer under
 * `extensions.settings`, measured on Chromium 149: a store install carries its `manifest`; an
 * unpacked one (location 4 from the UI, 8 from `--load-extension`) carries only a `path`, and the
 * name is in that folder's manifest, which `nameAtPath` reads.
 */
export function chromiumHasExtension(
  preferencesJson: string,
  nameAtPath: (path: string) => string | null,
  storeIds: readonly string[] = CHROMIUM_STORE_IDS,
): boolean {
  let settings: Record<string, { manifest?: { name?: unknown }; path?: unknown } | undefined>;
  try {
    const parsed = JSON.parse(preferencesJson) as { extensions?: { settings?: typeof settings } };
    settings = parsed.extensions?.settings ?? {};
  } catch {
    return false;
  }
  return Object.entries(settings).some(([id, e]) => {
    if (storeIds.includes(id)) return true;
    if (e?.manifest?.name === EXTENSION_NAME) return true;
    return typeof e?.path === 'string' && nameAtPath(e.path) === EXTENSION_NAME;
  });
}

// -- what the person sees --------------------------------------------------------------------

/**
 * `connected`: a session has this browser. `installed`: the extension is in it but no session has
 * it. `not-installed`: the profile was read and the extension is not in it. `not-connected`: the
 * profile could not be read (sandbox, never started), so the only claim left is the connection.
 */
export type ExtensionState = 'connected' | 'installed' | 'not-installed' | 'not-connected';

export function extensionState(installed: boolean | null, connected: boolean): ExtensionState {
  if (connected) return 'connected';
  if (installed === null) return 'not-connected';
  return installed ? 'installed' : 'not-installed';
}

export interface BrowserRow {
  id: BrowserId;
  name: string;
  isDefault: boolean;
  state: ExtensionState;
}

/** One row per browser worth a line: found, the default, connected, or with the extension in it. */
export function browserRows(
  choices: readonly BrowserEntry[],
  installed: ReadonlyMap<BrowserId, boolean | null>,
  connected: ReadonlySet<BrowserId>,
): BrowserRow[] {
  return choices
    .filter((e) => e.detected || connected.has(e.id) || installed.get(e.id) === true)
    .map((e) => ({
      id: e.id,
      name: e.name,
      isDefault: e.isDefault,
      state: extensionState(installed.get(e.id) ?? null, connected.has(e.id)),
    }));
}
