import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from '@gjsify/unit';
import type { RegistryEntry } from '@beifahrer/core';

import {
  NO_BROWSERS,
  WAIT_MS,
  connectedBrowsers,
  diagramOf,
  linkOne,
  linkTwo,
  prepareSvg,
  splitName,
  VERTICAL_CELLS,
  VERTICAL_UNIT,
  trackBrowsers,
} from '../../../src/window/diagram-model.ts';
import assets from '../../../src/window/diagram-assets.json' with { type: 'json' };
import { createTranslate } from '../../../src/window/i18n.ts';

const NOW = new Date('2026-10-04T12:00:00.000Z');
const t = createTranslate('en');
const entry = (
  instance: string,
  browsers: string[] = [],
  label = `claude-code · ${instance}`,
  startedAgoMs = 60_000,
): RegistryEntry => ({
  v: 1,
  instance,
  label,
  pid: 1,
  port: 47813,
  startedAt: new Date(NOW.getTime() - startedAgoMs).toISOString(),
  updatedAt: NOW.toISOString(),
  bridgeVersion: '0.1.4',
  browsers: browsers.map((name, i) => ({
    id: `${instance}-${i}`,
    family: 'firefox' as const,
    name,
    version: '155.0',
    extensionVersion: '0.1.4',
    connectedAt: NOW.toISOString(),
  })),
});
const none = { skipped: 0, unregistered: 0 };
const diagram = (sessions: RegistryEntry[], memory = NO_BROWSERS, skipped = 0, unregistered: number[] = []) =>
  diagramOf(sessions, skipped, unregistered, memory, NOW, t);

export default async () => {
  await describe('link 1', async () => {
    await it('fails with no session and says so', async () => {
      expect(linkOne([], NOW, none)).toBe('fail');
    });
    await it('is unknown when a file was unreadable or a stranger holds a port', async () => {
      expect(linkOne([], NOW, { skipped: 1, unregistered: 0 })).toBe('unknown');
      expect(linkOne([], NOW, { skipped: 0, unregistered: 1 })).toBe('unknown');
    });
    await it('is ok once the client has named itself', async () => {
      expect(linkOne([entry('a')], NOW, none)).toBe('ok');
    });
    await it('waits while the label still says mcp, and fails after WAIT_MS', async () => {
      const young = entry('a', [], 'mcp · a', WAIT_MS - 1);
      const old = entry('a', [], 'mcp · a', WAIT_MS);
      expect(linkOne([young], NOW, none)).toBe('wait');
      expect(linkOne([old], NOW, none)).toBe('fail');
    });
    await it('is ok when any one session introduced itself', async () => {
      expect(linkOne([entry('a', [], 'mcp · a', WAIT_MS * 5), entry('b')], NOW, none)).toBe('ok');
    });
  });

  await describe('link 2', async () => {
    await it('cannot be seen without a session', async () => {
      expect(linkTwo([])).toBe('unknown');
    });
    await it('fails with a session and no browser, is ok with one', async () => {
      expect(linkTwo([entry('a')])).toBe('fail');
      expect(linkTwo([entry('a'), entry('b', ['Firefox'])])).toBe('ok');
    });
  });

  await describe('browser memory', async () => {
    const one = connectedBrowsers([entry('a', ['Firefox', 'Chromium'])]);
    await it('remembers a browser that left', async () => {
      const first = trackBrowsers(NO_BROWSERS, one);
      const later = trackBrowsers(first, connectedBrowsers([entry('a', ['Firefox'])]));
      expect([...later.gone.values()].join()).toBe('Chromium');
    });
    await it('forgets it when it returns or when none is left', async () => {
      const first = trackBrowsers(NO_BROWSERS, one);
      const half = trackBrowsers(first, connectedBrowsers([entry('a', ['Firefox'])]));
      expect(trackBrowsers(half, one).gone.size).toBe(0);
      expect(trackBrowsers(half, new Map())).toBe(NO_BROWSERS);
    });
  });

  await describe('diagram view', async () => {
    await it('shows a fail on link 1 with the setup button when nothing runs', async () => {
      const v = diagram([]);
      expect(v.classes.join(' ')).toBe('l1-fail l2-unknown here-window');
      expect(v.fix?.action?.id).toBe('setup');
      expect(v.captions.link2).toBe('Not visible');
    });
    await it('shows the token button when a session has no browser', async () => {
      const v = diagram([entry('a')]);
      expect(v.classes.join(' ')).toBe('l1-ok l2-fail here-window');
      expect(v.fix?.action?.id).toBe('token');
    });
    await it('says nothing under a healthy chain', async () => {
      const v = diagram([entry('a', ['Firefox'])]);
      expect(v.classes.join(' ')).toBe('l1-ok l2-ok here-window');
      expect(v.fix).toBe(null);
    });
    await it('names a stalled session and keeps the setup button', async () => {
      const v = diagram([entry('a', [], 'mcp · a', WAIT_MS * 2)]);
      expect(v.link1).toBe('fail');
      expect(v.fix?.sentence).toContain('never answered');
      expect(v.fix?.action?.id).toBe('setup');
    });
    await it('explains an unreadable file without a button', async () => {
      const v = diagram([], NO_BROWSERS, 1);
      expect(v.link1).toBe('unknown');
      expect(v.fix?.action).toBe(null);
    });
    await it('stacks sessions and browsers, names two and counts the rest', async () => {
      const v = diagram([
        entry('a', ['Firefox']),
        entry('b', ['Chromium']),
        entry('c', ['Brave']),
        entry('d'),
      ]);
      expect(v.classes).toContain('stacked-3');
      expect(v.classes).toContain('browsers-3');
      expect(v.app.names.length).toBe(2);
      expect(v.app.more).toBe('+ 2 more');
      expect(v.browser.more).toBe('+ 1 more');
    });
    await it('draws a half-connected pair with a dashed card and link 2 still ok', async () => {
      const first = trackBrowsers(NO_BROWSERS, connectedBrowsers([entry('a', ['Firefox', 'Chromium'])]));
      const memory = trackBrowsers(first, connectedBrowsers([entry('a', ['Firefox'])]));
      const v = diagram([entry('a', ['Firefox'])], memory);
      expect(v.link2).toBe('ok');
      expect(v.classes).toContain('browsers-2');
      expect(v.classes).toContain('browser-gone');
      expect(v.browser.gone).toBe('Chromium');
      expect(v.browser.caption).toBe('1 of 2 connected');
    });
    await it('speaks German', async () => {
      const v = diagramOf([], 0, [], NO_BROWSERS, NOW, createTranslate('de'));
      expect(v.fix?.action?.label).toBe('App einrichten');
    });
  });

  await describe('vertical layout', async () => {
    await it('has a cell for all five parts, summing to the drawing height', async () => {
      expect(VERTICAL_CELLS.length).toBe(5);
      expect(VERTICAL_CELLS.reduce((a, b) => a + b, 0) * VERTICAL_UNIT).toBe(490);
    });
    await it('splits a session name at the dot', async () => {
      expect(splitName('claude-code · werkstatt').main).toBe('claude-code');
      expect(splitName('claude-code · werkstatt').rest).toBe('werkstatt');
      expect(splitName('mcp').main).toBe('mcp');
      expect(splitName('mcp').rest).toBe(null);
    });
    await it('words the half-connected pair as its own sentence with the token button', async () => {
      const first = trackBrowsers(NO_BROWSERS, connectedBrowsers([entry('a', ['Firefox', 'Chromium'])]));
      const memory = trackBrowsers(first, connectedBrowsers([entry('a', ['Firefox'])]));
      const v = diagramOf([entry('a', ['Firefox'])], 0, [], memory, NOW, t);
      expect(v.fix?.sentence).toContain('Chromium is disconnected');
      expect(v.fix?.action?.id).toBe('token');
    });
  });

  await describe('artwork', async () => {
    await it('is prepared with the class list, the dark class and a scaled size', async () => {
      const svg = prepareSvg(assets.horizontal, ['l1-ok', 'l2-fail'], true, 2);
      expect(svg).toContain('class="l1-ok l2-fail dark"');
      expect(svg).toContain('width="1200" height="200"');
      expect(svg.startsWith('<svg')).toBe(true);
    });
    await it('embeds the vertical drawing too', async () => {
      expect(prepareSvg(assets.vertical, [], false, 1)).toContain('width="140" height="490"');
    });
    await it('matches data/diagram, so a regenerated drawing is embedded again', async () => {
      const strip = (s: string) => s.replace(/^\s*<!--[\s\S]*?-->\s*/, '');
      const file = (name: string) =>
        strip(readFileSync(join(process.cwd(), '..', 'data', 'diagram', name), 'utf8'));
      expect(assets.horizontal).toBe(file('connection.svg'));
      expect(assets.vertical).toBe(file('connection-vertical.svg'));
    });
  });
};
