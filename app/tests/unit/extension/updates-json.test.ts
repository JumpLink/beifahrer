import { describe, expect, it } from '@gjsify/unit';

import { GECKO_ID, GECKO_STRICT_MIN_VERSION, UPDATE_URL } from '../../../../extension/manifest.ts';
import { updatesJson } from '../../../../extension/scripts/updates-json.ts';

/**
 * The shape of `updates.json` (issue #3). Mozilla's, not ours, and Firefox enforces it: a wrong key
 * or a missing `update_hash` does not fail loudly, it produces an update that is never offered. So
 * this suite asserts the whole document rather than one field.
 */
const HASH = 'a'.repeat(64);
const entry = (over: Partial<Parameters<typeof updatesJson>[0]> = {}) =>
  updatesJson({
    id: GECKO_ID,
    version: '0.2.0',
    file: 'beifahrer-0.2.0.xpi',
    tag: 'v0.2.0',
    hash: HASH,
    strictMinVersion: GECKO_STRICT_MIN_VERSION,
    ...over,
  }).addons[GECKO_ID].updates[0];

export default async () => {
  await describe('updatesJson', async () => {
    await it('keys the document by the add-on id AMO signed', async () => {
      // Not a constant check: the key is what an installed copy matches itself against, so an id
      // that drifts from the manifest (extension/manifest.ts) updates nobody.
      const document = updatesJson({
        id: GECKO_ID,
        version: '0.2.0',
        file: 'beifahrer-0.2.0.xpi',
        tag: 'v0.2.0',
        hash: HASH,
        strictMinVersion: GECKO_STRICT_MIN_VERSION,
      });
      expect(Object.keys(document.addons)).toEqualArray([GECKO_ID]);
    });

    await it('names one update, at the version and the release it came from', async () => {
      const update = entry();
      expect(update.version).toBe('0.2.0');
      // The link is per release and per asset: this is what changes every time, while update_url
      // (manifest.ts) is the one thing that must not.
      expect(update.update_link).toBe(
        'https://github.com/JumpLink/beifahrer/releases/download/v0.2.0/beifahrer-0.2.0.xpi',
      );
    });

    await it('carries the hash with its prefix, so a swapped file is refused', async () => {
      expect(entry().update_hash).toBe(`sha256:${HASH}`);
    });

    await it('carries strict_min_version, so an old Firefox does not take a new build', async () => {
      expect(entry().applications.gecko.strict_min_version).toBe(GECKO_STRICT_MIN_VERSION);
    });

    await it('refuses a tag without the v, rather than building a dead link', async () => {
      // A link to releases/download/0.2.0 does not 404 — it 404s later, on the person's machine.
      let refused = '';
      try {
        entry({ tag: '0.2.0' });
      } catch (error) {
        refused = (error as Error).message;
      }
      expect(refused).toBe('tag "0.2.0" does not start with "v"');
    });

    await it('refuses anything that is not a hex SHA-256', async () => {
      // The prefix lives inside updatesJson, so a caller cannot pass one and get `sha256:sha256:…`.
      for (const hash of [`sha256:${HASH}`, 'sha1', '', HASH.slice(0, 63)]) {
        let refused = false;
        try {
          entry({ hash });
        } catch {
          refused = true;
        }
        expect(refused).toBe(true);
      }
    });

    await it('points update_url at an https URL that does not carry a version', async () => {
      // Firefox follows update_url from the INSTALLED version forever, so both halves are load
      // bearing: `latest/download` resolves per release, and a version in the asset name would make
      // the URL dead the moment the next release cuts.
      expect(UPDATE_URL).toBe('https://github.com/JumpLink/beifahrer/releases/latest/download/updates.json');
    });
  });
};
