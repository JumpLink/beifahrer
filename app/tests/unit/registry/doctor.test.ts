import { describe, expect, it } from '@gjsify/unit';
import type { Check } from '@beifahrer/core';

import { renderChecks, runtimeName } from '../../../src/frontends/cli/doctor.ts';

export default async () => {
  await describe('beifahrer doctor', async () => {
    await it('marks each finding by its level and puts the fix under it', async () => {
      const checks: Check[] = [
        { id: 'version', level: 'ok', title: 'Beifahrer 0.1.4 on GJS' },
        { id: 'token', level: 'warn', title: 'No pairing token yet (/t)', fix: 'Run `beifahrer token`.' },
        { id: 'ports', level: 'fail', title: 'Every port is taken', fix: 'End a session.' },
      ];
      expect(renderChecks(checks)).toBe(
        [
          '✔ Beifahrer 0.1.4 on GJS',
          '! No pairing token yet (/t)',
          '    Run `beifahrer token`.',
          '✖ Every port is taken',
          '    End a session.',
        ].join('\n'),
      );
    });
  });

  await describe('runtimeName', async () => {
    await it('reads GJS from its own version number and not from the Node shim', async () => {
      expect(runtimeName({ imports: { system: { version: 18801 } } })).toBe('GJS 1.88.1');
    });

    await it('is Node.js where there is no `imports`', async () => {
      expect(runtimeName({})).toMatch(/^Node\.js \d+\.\d+\.\d+/);
    });
  });
};
