// Embeds data/diagram/*.svg into app/src/window/diagram-assets.json, so the bundle (and the Flatpak,
// which ships only the bundle) carries the artwork without reading a file at run time. The leading
// XML comment is dropped: the image loader refuses a file that does not start with the root element.
// `--check` fails when the committed JSON is stale; the unit tests run the same comparison.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const strip = (name) =>
  readFileSync(join(root, 'data', 'diagram', name), 'utf8').replace(/^\s*<!--[\s\S]*?-->\s*/, '');
const out = join(root, 'app', 'src', 'window', 'diagram-assets.json');
const json =
  JSON.stringify(
    { horizontal: strip('connection.svg'), vertical: strip('connection-vertical.svg') },
    null,
    2,
  ) + '\n';

if (process.argv.includes('--check')) {
  if (readFileSync(out, 'utf8') !== json) {
    console.error('diagram-assets.json is stale: run `node app/scripts/embed-diagram.mjs`');
    process.exit(1);
  }
} else writeFileSync(out, json);
