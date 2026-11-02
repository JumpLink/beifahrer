import { describe, expect, it } from '@gjsify/unit';
import { findAgent } from '@beifahrer/core';

import { createTranslate } from '../../../src/window/i18n.ts';
import {
  agentsDetectedFirst,
  applyView,
  back,
  canLeave,
  chooseAgent,
  detectAgents,
  extensionView,
  finishConfig,
  initialState,
  markPaired,
  next,
  type SetupState,
} from '../../../src/window/setup-model.ts';

const t = createTranslate('en');

export default async () => {
  await describe('setup steps', async () => {
    await it('cannot leave the agent step before an agent is chosen', async () => {
      const s = initialState();
      expect(canLeave(s)).toBe(false);
      expect(next(s).step).toBe('agent');
      expect(next(chooseAgent(s, 'cursor')).step).toBe('config');
    });

    await it('needs the config step finished, and starts it over for another agent', async () => {
      let s = next(chooseAgent(initialState(), 'cursor'));
      expect(next(s).step).toBe('config');
      s = finishConfig(s, 'written');
      expect(next(s).step).toBe('extension');
      expect(chooseAgent(s, 'cursor').config).toBe('written');
      expect(chooseAgent(s, 'zed').config).toBe('pending');
    });

    await it('ends on pairing, which needs the person to confirm', async () => {
      let s: SetupState = { ...initialState(), step: 'pairing' };
      expect(next(s).step).toBe('pairing');
      expect(canLeave(s)).toBe(false);
      s = markPaired(s);
      expect(canLeave(s)).toBe(true);
      expect(back(s).step).toBe('extension');
    });
  });

  await describe('setup detection', async () => {
    await it('lists detected agents first', async () => {
      const found = detectAgents('linux', (p) => p, { has: () => false, onPath: (c) => c === 'zed' });
      expect([...found]).toStrictEqual(['zed']);
      expect(agentsDetectedFirst(found)[0]!.id).toBe('zed');
    });
  });

  await describe('setup views', async () => {
    await it('links Firefox to the signed file and Chromium to this version and says there is no store listing', async () => {
      const ff = extensionView('firefox', '1.2.3', t);
      expect(ff.url).toBe('https://github.com/JumpLink/beifahrer/releases/latest/download/beifahrer.xpi');
      const cr = extensionView('chromium', '1.2.3', t);
      expect(cr.url).toBe(
        'https://github.com/JumpLink/beifahrer/releases/download/v1.2.3/beifahrer-1.2.3-chrome-mv3.zip',
      );
      expect(ff.store).toMatch(/store/i);
    });

    await it('does not count a refused write as done', async () => {
      expect(applyView({ status: 'not-confirmed' }, t).outcome).toBe(null);
      expect(applyView({ status: 'changed-meanwhile' }, t).ok).toBe(false);
      expect(applyView({ status: 'unparseable' }, t).outcome).toBe('manual');
      expect(applyView({ status: 'unchanged' }, t).outcome).toBe('unchanged');
      expect(applyView({ status: 'written', backup: '/a.bak' }, t).message).toContain('/a.bak');
      expect(findAgent('cursor')).toBeDefined();
    });
  });
};
