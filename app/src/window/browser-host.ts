/**
 * The edge of `browser-model.ts` (ADR 0026): asks GIO which browser is the default and which can
 * open a link, and reads the browsers' own profile files to see whether the extension is in them.
 * It only reads. Launching a browser with a link is the one action, and it is the person's click.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';

import Gio from 'gi://Gio?version=2.0';

import { detectInstall, expandPath, resolvesOnHost } from '../frontends/cli/install.ts';
import {
  BROWSERS,
  browserChoices,
  browserOfApp,
  chromiumHasExtension,
  chromiumProfileDirs,
  detectBrowsers,
  firefoxHasExtension,
  firefoxProfileDirs,
  manifestName,
  profileRoots,
  type BrowserEntry,
  type BrowserId,
} from './browser-model.ts';

const read = (path: string): string | null => {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
};

const names = (path: string): string[] => {
  try {
    return readdirSync(path);
  } catch {
    return [];
  }
};

/** The browser the person opens links with, or null when GIO names none or one we do not know. */
export function defaultBrowserId(): BrowserId | null {
  try {
    const app = Gio.AppInfo.get_default_for_uri_scheme('https');
    return app ? browserOfApp(app.get_id(), app.get_executable()) : null;
  } catch {
    return null;
  }
}

/** The list to choose from: the default browser first, then what was found on this computer. */
export function currentChoices(platform: string = process.platform): BrowserEntry[] {
  const found = detectBrowsers(platform, expandPath, { has: existsSync, onPath: (c) => resolvesOnHost(c) });
  return browserChoices(found, defaultBrowserId());
}

function firefoxInstalled(roots: string[]): boolean {
  for (const root of roots) {
    const ini = read(`${root}/profiles.ini`);
    if (ini === null) continue;
    for (const dir of firefoxProfileDirs(ini, root)) {
      const json = read(`${dir}/extensions.json`);
      if (json !== null && firefoxHasExtension(json)) return true;
    }
  }
  return false;
}

function chromiumInstalled(roots: string[]): boolean {
  const nameAtPath = (path: string) => {
    const manifest = read(`${path}/manifest.json`);
    return manifest === null
      ? null
      : manifestName(manifest, (locale) => read(`${path}/_locales/${locale}/messages.json`));
  };
  for (const root of roots) {
    for (const profile of chromiumProfileDirs(names(root))) {
      for (const file of ['Preferences', 'Secure Preferences']) {
        const json = read(`${root}/${profile}/${file}`);
        if (json !== null && chromiumHasExtension(json, nameAtPath)) return true;
      }
    }
  }
  return false;
}

/**
 * Per browser: is the extension in one of its profiles. Null where the window cannot look: inside a
 * Flatpak sandbox the profiles are not visible, and the only claim left is the connection.
 */
export function installedExtensions(
  platform: string = process.platform,
  sandboxed: boolean = detectInstall().flatpak === true,
): Map<BrowserId, boolean | null> {
  const found = new Map<BrowserId, boolean | null>();
  for (const b of BROWSERS) {
    if (b.kind === 'safari') continue;
    if (sandboxed) {
      found.set(b.id, null);
      continue;
    }
    const roots = profileRoots(b.id, platform)
      .map((r) => expandPath(r))
      .filter((r) => existsSync(r));
    found.set(b.id, b.kind === 'firefox' ? firefoxInstalled(roots) : chromiumInstalled(roots));
  }
  return found;
}

/** Opens `uri` in the default handler: the way out when no browser can be addressed. */
export function openWithDefault(uri: string): boolean {
  try {
    return Gio.AppInfo.launch_default_for_uri(uri, null);
  } catch {
    return false;
  }
}

/**
 * Opens `uri` IN the given browser, so a signed file or a store page lands where the person wants
 * the extension. Falls back to the default handler when no such application is known, it cannot take
 * a link, the launch fails, or the window is sandboxed (a portal opens the link there anyway).
 */
export function openInBrowser(
  id: BrowserId,
  uri: string,
  sandboxed: boolean = detectInstall().flatpak === true,
): boolean {
  if (!sandboxed) {
    try {
      const app = Gio.AppInfo.get_all().find(
        (a) => a.should_show() && a.supports_uris() && browserOfApp(a.get_id(), a.get_executable()) === id,
      );
      if (app && app.launch_uris([uri], null)) return true;
    } catch {
      // fall through to the default handler
    }
  }
  return openWithDefault(uri);
}
