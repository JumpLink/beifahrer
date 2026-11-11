import { describe, expect, it } from '@gjsify/unit';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { FEATURE_ICON } from '../../../../extension/src/ui/icon-names.ts';

/**
 * A name in FEATURE_ICON that neither our GResource nor the adwaita-web stylesheet holds renders
 * as the missing-image placeholder, and nothing fails loudly (the popup and options rows showed
 * exactly that for `document-save-as`, `network-transmit-receive` and `document-send`).
 */
const ROOT = join(process.cwd(), '..');
const DATA = join(ROOT, 'extension', 'src', 'ui', 'data');

const bundled = (): Map<string, string> => {
  const xml = readFileSync(join(DATA, 'eu.jumplink.Beifahrer.data.gresource.xml'), 'utf8');
  const files = new Map<string, string>();
  for (const m of xml.matchAll(/<file>(icons\/[^<]+\/([a-z0-9-]+-symbolic)\.svg)<\/file>/g))
    files.set(m[2], join(DATA, m[1]));
  return files;
};

/** The icons `@gjsify/adwaita-web` compiles into its stylesheet as `--icon-<name>` custom properties. */
const compiledIn = (): Set<string> => {
  const css = readFileSync(
    join(ROOT, 'node_modules', '@gjsify', 'adwaita-web', 'dist', 'adwaita-web.css'),
    'utf8',
  );
  return new Set([...css.matchAll(/--icon-([a-z0-9-]+):/g)].map((m) => `${m[1]}-symbolic`));
};

export default async () => {
  await describe('FEATURE_ICON names resolve', async () => {
    await it('has every name in the GResource manifest or the adwaita-web stylesheet', async () => {
      const own = bundled();
      const web = compiledIn();
      const missing = Object.values(FEATURE_ICON).filter((name) => !own.has(name) && !web.has(name));
      expect(missing.join(', ')).toBe('');
    });

    await it('ships a file for every manifest entry', async () => {
      for (const [name, path] of bundled()) expect(`${name}:${existsSync(path)}`).toBe(`${name}:true`);
    });
  });
};
