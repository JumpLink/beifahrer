import { describe, expect, it } from '@gjsify/unit';
import { relative } from 'node:path';

import pkg from '../../../package.json' with { type: 'json' };
import { registryDir } from '../../../src/registry/registry-dir.ts';

export default async () => {
  await describe('registryDir', async () => {
    await it('prefers the runtime directory where there is one', async () => {
      expect(registryDir({ XDG_RUNTIME_DIR: '/run/user/1000' }, '/tmp', 'p')).toBe(
        '/run/user/1000/beifahrer/sessions',
      );
    });

    await it('falls back to a per-user directory in the temp directory (macOS, Windows)', async () => {
      expect(registryDir({}, '/var/folders/x/T', 'pascal')).toBe(
        '/var/folders/x/T/beifahrer-pascal/sessions',
      );
    });

    await it('treats an empty XDG_RUNTIME_DIR as unset, rather than rooting the directory at ./', async () => {
      expect(registryDir({ XDG_RUNTIME_DIR: '' }, '/tmp', 'p')).toBe('/tmp/beifahrer-p/sessions');
    });

    await it('keeps a user name out of the path structure', async () => {
      expect(registryDir({}, '/tmp', '../etc/x y')).toBe('/tmp/beifahrer-.._etc_x_y/sessions');
    });

    // Under Flatpak the sandbox's XDG_RUNTIME_DIR is not the host's. Only a grant that names the
    // directory registryDir() resolves to makes the host's app and the sandboxed bridge meet.
    await it('the flatpak grant names the directory the registry lives in', async () => {
      const grants: string[] = pkg.gjsify.ship.flatpak.finishArgs;
      const dir = registryDir({ XDG_RUNTIME_DIR: '/run/user/1000' }, '/tmp', 'p');
      // `xdg-run/<x>` grants `$XDG_RUNTIME_DIR/<x>`, and the registry's sessions live below it.
      const granted = relative('/run/user/1000', dir).split('/')[0];
      expect(grants).toContain(`--filesystem=xdg-run/${granted}:create`);
    });

    await it('BEIFAHRER_REGISTRY_DIR wins over both', async () => {
      expect(registryDir({ BEIFAHRER_REGISTRY_DIR: '/x', XDG_RUNTIME_DIR: '/run' }, '/tmp', 'p')).toBe('/x');
    });
  });
};
