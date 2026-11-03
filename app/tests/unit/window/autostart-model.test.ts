import { describe, expect, it } from '@gjsify/unit';

import {
  afterAnswer,
  afterQuestion,
  autostartBackend,
  autostartCommandline,
  OFF,
  parseState,
  serializeState,
  shouldAsk,
  showSwitch,
  startsHidden,
  withoutFlag,
} from '../../../src/window/autostart-model.ts';
import { pickMode } from '../../../src/dispatch.ts';

export default async () => {
  await describe('autostart backend', async () => {
    await it('is the portal only in a Flatpak on Linux', async () => {
      expect(autostartBackend(true, 'linux')).toBe('portal');
      expect(autostartBackend(false, 'linux')).toBe('none');
      expect(autostartBackend(true, 'darwin')).toBe('none');
      expect(autostartBackend(false, 'win32')).toBe('none');
    });

    await it('shows the switch and asks only where there is a backend', async () => {
      const paired = { enabled: false, asked: false };
      expect(showSwitch('portal')).toBe(true);
      expect(showSwitch('none')).toBe(false);
      expect(shouldAsk('portal', paired, true)).toBe(true);
      expect(shouldAsk('none', paired, true)).toBe(false);
    });
  });

  await describe('the question', async () => {
    await it('waits for a pairing that worked', async () => {
      expect(shouldAsk('portal', OFF, false)).toBe(false);
    });

    await it('is never asked again after any answer, a No included', async () => {
      expect(shouldAsk('portal', afterAnswer(false, false), true)).toBe(false);
      expect(shouldAsk('portal', afterAnswer(true, true), true)).toBe(false);
    });

    await it('stores on only when the portal granted it', async () => {
      expect(JSON.stringify(afterAnswer(true, true))).toBe(JSON.stringify({ asked: true, enabled: true }));
      expect(JSON.stringify(afterAnswer(true, false))).toBe(JSON.stringify({ asked: true, enabled: false }));
      expect(JSON.stringify(afterAnswer(false, true))).toBe(JSON.stringify({ asked: true, enabled: false }));
    });
  });

  await describe('the question', async () => {
    await it('tells the person when a yes was refused or the portal failed', async () => {
      expect(afterQuestion(true, 'granted').refused).toBe(false);
      expect(afterQuestion(true, 'denied').refused).toBe(true);
      expect(afterQuestion(true, 'unavailable').refused).toBe(true);
      expect(afterQuestion(true, 'denied').state.asked).toBe(true);
    });

    await it('says nothing to a no', async () => {
      expect(afterQuestion(false, 'denied').refused).toBe(false);
      expect(afterQuestion(false, 'denied').state.enabled).toBe(false);
    });
  });

  await describe('stored state', async () => {
    await it('round-trips', async () => {
      const back = parseState(serializeState({ enabled: true, asked: true }));
      expect(`${back.enabled}/${back.asked}`).toBe('true/true');
    });

    await it('is off for no file, damage or anything but a literal true', async () => {
      expect(JSON.stringify(parseState(null))).toBe(JSON.stringify(OFF));
      expect(JSON.stringify(parseState('{nope'))).toBe(JSON.stringify(OFF));
      expect(JSON.stringify(parseState('null'))).toBe(JSON.stringify(OFF));
      expect(JSON.stringify(parseState('{"autostart":{"enabled":"true","asked":1}}'))).toBe(
        JSON.stringify(OFF),
      );
    });
  });

  await describe('hidden start', async () => {
    await it('takes the flag out of the arguments', async () => {
      expect(JSON.stringify(withoutFlag(['--background']))).toBe(
        JSON.stringify({ requested: true, rest: [] }),
      );
      expect(JSON.stringify(withoutFlag([]))).toBe(JSON.stringify({ requested: false, rest: [] }));
    });

    await it('needs the flag, the portal and an enabled switch', async () => {
      const on = { enabled: true, asked: true };
      expect(startsHidden(true, 'portal', on)).toBe(true);
      expect(startsHidden(false, 'portal', on)).toBe(false);
      expect(startsHidden(true, 'none', on)).toBe(false);
      expect(startsHidden(true, 'portal', OFF)).toBe(false);
    });

    await it('is what the autostart entry runs, and it opens the window', async () => {
      expect(JSON.stringify(autostartCommandline())).toBe(JSON.stringify(['beifahrer', '--background']));
      expect(pickMode(['--background'])).toBe('window');
      expect(pickMode(['--background', 'mcp'])).toBe('cli');
    });
  });
};
