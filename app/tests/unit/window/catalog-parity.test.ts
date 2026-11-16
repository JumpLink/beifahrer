import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from '@gjsify/unit';

import { CATALOGS, type Locale } from '../../../src/window/i18n.ts';

/**
 * ADR 0028: the window and the extension keep two catalogs (ADR 0017 § 5), so a word both show is
 * written twice. This suite makes sure the two copies never disagree, and that a new duplicate is
 * mapped (or reworded) instead of drifting unseen.
 *
 * window key -> extension key. Add a pair here when the check below names an unmapped duplicate.
 */
const SHARED: Record<string, string> = {
  'app.title': 'extName',
  'status.ready.title': 'state_ready',
  'pairing.title': 'token_title',
  'about.privacy': 'privacy_link',
  'about.legal': 'legal_link',
  'setup.cancel': 'action_cancel',
  'setup.browser.title': 'diagram_node_browser',
  'diagram.node.app': 'diagram_node_app',
  'diagram.node.beifahrer': 'diagram_node_beifahrer',
  'diagram.node.browser': 'diagram_node_browser',
  'diagram.link.ok': 'diagram_link_ok',
  'diagram.link.wait': 'diagram_link_wait',
  'diagram.link.fail': 'diagram_link_fail',
  'diagram.link.unknown': 'diagram_link_unknown',
  'diagram.more': 'diagram_more',
  'browser.state.connected': 'pairing_connected',
  'browser.state.not-connected': 'state_offline',
  'safari.state.disabled': 'reason_feature_disabled',
};

const LOCALES: readonly Locale[] = ['en', 'de'];

/** The extension catalog, read from disk: it is not a module the app bundle may import. */
const extensionCatalog = (locale: Locale): Record<string, string> => {
  const file = join(process.cwd(), '..', 'extension', '_locales', locale, 'messages.json');
  const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, { message: string }>;
  return Object.fromEntries(Object.entries(raw).map(([key, entry]) => [key, entry.message]));
};

/** `$NAME$` (extension) and `{name}` (window) become one token; case does not count. */
const normalise = (text: string): string =>
  text
    .replace(/\$[A-Za-z0-9_@]+\$/g, '\u0000')
    .replace(/\{\w+\}/g, '\u0000')
    .toLowerCase();

export default async () => {
  const extension = { en: extensionCatalog('en'), de: extensionCatalog('de') };

  await describe('window and extension catalogs', async () => {
    await it('name only keys that exist', async () => {
      for (const [windowKey, extensionKey] of Object.entries(SHARED)) {
        expect(`${windowKey}:${windowKey in CATALOGS.en}`).toBe(`${windowKey}:true`);
        expect(`${extensionKey}:${extensionKey in extension.en}`).toBe(`${extensionKey}:true`);
      }
    });

    await it('say the same thing for every shared pair, in every language', async () => {
      for (const locale of LOCALES) {
        for (const [windowKey, extensionKey] of Object.entries(SHARED)) {
          const windowText = CATALOGS[locale][windowKey]!;
          const extensionText = extension[locale][extensionKey]!;
          expect(`${locale} ${windowKey} / ${extensionKey}: ${normalise(windowText)}`).toBe(
            `${locale} ${windowKey} / ${extensionKey}: ${normalise(extensionText)}`,
          );
        }
      }
    });

    await it('map every window string the extension already says', async () => {
      const byText = new Map<string, string[]>();
      for (const [key, text] of Object.entries(extension.en)) {
        const norm = normalise(text);
        byText.set(norm, [...(byText.get(norm) ?? []), key]);
      }
      const unmapped: string[] = [];
      for (const [windowKey, text] of Object.entries(CATALOGS.en)) {
        if (windowKey in SHARED) continue;
        const same = byText.get(normalise(text));
        if (same)
          unmapped.push(
            `window "${windowKey}" repeats extension "${same.join('" / "')}" ("${text}"): add it to SHARED in catalog-parity.test.ts, or reword one of them`,
          );
      }
      expect(unmapped.join('\n')).toBe('');
    });
  });
};
