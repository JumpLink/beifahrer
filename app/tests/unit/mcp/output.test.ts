/**
 * What the tools say they answer with (issue #26).
 *
 * An `outputSchema` is the only thing that lets an agent read a field out of an answer without
 * guessing: `tab_open` hands out the `tabId` every page tool needs, and until it declared the
 * wrapper an agent assumed a flat shape, got `undefined` and spent a call on the NEXT tool to be
 * told a key was missing — a complaint about the symptom, one layer from the mistake.
 *
 * So three things are asserted here, and the third is the one that bites:
 *
 * 1. the tools that hand out a handle declare a schema at all;
 * 2. a real answer validates against it — the samples are the protocol's own types, not a shape
 *    invented here;
 * 3. an answer carrying a key the schema does NOT name still validates. A strict schema refuses a
 *    real answer the moment the protocol grows a field, and the extension already adds keys of its
 *    own (`frames`, `framesUnavailable`) — that failure shows up in a CLIENT, as a validation error
 *    where the work succeeded, long after the tests were written.
 */

import { describe, expect, it } from '@gjsify/unit';
import type { Level, Method } from '@beifahrer/core';

import { BridgeError, type BrowserAccess } from '../../../src/bridge/bridge.ts';
import { applyReadOnlyGate } from '../../../src/frontends/mcp/runtime.ts';
import { registerTools } from '../../../src/frontends/mcp/tools.ts';
import { createRecorder, type Recorder } from './recorder.ts';

/** The tools whose answers carry a handle, an id or a finding — the ones an agent chains on. */
const WITH_SCHEMA = [
  'browsers_list',
  'tabs_list',
  'tab_active',
  'tab_open',
  'window_create',
  'page_find',
  'page_expect',
  'page_network',
];

/** The tab `tab_open` really answered on 2026-09-30 — a fresh tab, nothing read yet. */
const OPENED = {
  tab: {
    tabId: 245,
    windowId: 1,
    active: true,
    focusedWindow: true,
    host: null,
    level: 'none',
    index: 9,
    pinned: false,
  },
};

/** A tab at level "read", which is what the fields only present there look like. */
const READ_TAB = {
  tabId: 245,
  windowId: 1,
  active: true,
  focusedWindow: true,
  host: 'example.com',
  level: 'read',
  url: 'https://example.com/invoices/7',
  title: 'Invoice 7',
  index: 9,
  pinned: false,
};

/** A failed assertion — the answer `page_expect` exists for: what was wanted, and what was there. */
const EXPECT_SEEN = {
  pass: false,
  expected: 'a button named Save, enabled',
  seen: '2 elements named Save: 1 disabled, 1 enabled',
  matches: 2,
  frame: 2,
  waitedMs: 4000,
};

const SAMPLES: Record<string, unknown> = {
  browsers_list: {
    port: 47813,
    session: { label: 'claude-code · werkstatt', pid: 4711, version: '0.1.0' },
    browsers: [
      {
        id: 'f1',
        label: 'Firefox 141 on Linux',
        family: 'firefox',
        manifestVersion: 2,
        extensionVersion: '0.1.0',
        capabilities: ['tabs.open', 'page.read', 'page.screenshot'],
        unsupported: { 'page.screenshot': 'needs <all_urls>, which was not granted' },
        connectedAt: '2026-09-30T09:12:44.000Z',
      },
    ],
  },
  tabs_list: { tabs: [READ_TAB] },
  tab_active: { tab: READ_TAB },
  tab_open: OPENED,
  window_create: { windowId: 7, tabs: [READ_TAB, { ...READ_TAB, tabId: 246, index: 1 }] },
  page_find: {
    url: 'https://example.com/invoices/7',
    matches: [{ ref: 'e12', description: 'button "Download"' }],
    count: 1,
    truncated: false,
  },
  page_expect: EXPECT_SEEN,
  page_network: {
    requests: [
      {
        at: 1759218000000,
        method: 'POST',
        url: 'https://example.com/invoices/7/approve',
        status: 500,
        frame: 0,
        pending: false,
        type: 'xmlhttprequest',
      },
      {
        at: 1759218000100,
        method: 'GET',
        url: 'https://cdn.example.net/chart.js',
        error: 'net::ERR_BLOCKED_BY_CLIENT',
        frame: 0,
        pending: false,
        type: 'script',
      },
    ],
    kept: 2,
    truncated: false,
  },
};

const STATUS = {
  port: 47813,
  version: '0.1.0',
  session: {
    label: 'claude-code · werkstatt',
    pid: 4711,
    instance: 'a1b2',
    startedAt: '2026-09-30T09:00:00.000Z',
  },
  browsers: [
    {
      id: 'f1',
      browser: { family: 'firefox' as const, name: 'Firefox', version: '141' },
      extension: { version: '0.1.0', manifestVersion: 2 as const },
      capabilities: ['tabs.open', 'page.read'] as Method[],
      unsupported: { 'page.screenshot': 'needs <all_urls>, which was not granted' },
      connectedAt: '2026-09-30T09:12:44.000Z',
    },
  ],
};

/** A bridge that answers with the samples instead of talking to a browser. */
function stubBridge(): BrowserAccess {
  const results: Record<string, unknown> = {
    'tabs.open': OPENED,
    'tabs.list': SAMPLES.tabs_list,
    'tabs.active': SAMPLES.tab_active,
    'windows.create': SAMPLES.window_create,
    'page.find': SAMPLES.page_find,
    'page.expect': SAMPLES.page_expect,
    'page.network': SAMPLES.page_network,
  };
  return {
    call: ((method: Method) => Promise.resolve(results[method])) as BrowserAccess['call'],
    status: () => STATUS,
  };
}

function recorded(): Recorder {
  const rec = createRecorder();
  applyReadOnlyGate(rec.server, true);
  registerTools(rec.server, { bridge: stubBridge() });
  return rec;
}

function schemaOf(rec: Recorder, name: string) {
  const schema = rec.find(name)?.outputSchema;
  if (!schema) throw new Error(`${name} declares no outputSchema`);
  return schema;
}

export default async () => {
  await describe('output schemas (issue #26)', async () => {
    await it('declares what every tool that hands out a handle answers with', async () => {
      const rec = recorded();
      for (const name of WITH_SCHEMA) expect(schemaOf(rec, name)).toBeTruthy();
    });

    await it('a real answer validates against the schema it published', async () => {
      const rec = recorded();
      for (const name of WITH_SCHEMA) {
        expect(schemaOf(rec, name).safeParse(SAMPLES[name]).success).toBe(true);
      }
    });

    await it('takes a key the schema does not name — the extension adds its own', async () => {
      const rec = recorded();
      // What the extension really sends for a frame's answer: `frames` and `framesUnavailable` are
      // its own bookkeeping and are in no protocol type. A schema that refused them would break the
      // tool in the CLIENT, where nobody would think of this test.
      const withExtras = {
        tab: { ...OPENED.tab, frames: 2, framesUnavailable: 'frames could not be reached' },
      };
      expect(schemaOf(rec, 'tab_open').safeParse(withExtras).success).toBe(true);
      expect(schemaOf(rec, 'page_expect').safeParse({ ...EXPECT_SEEN, frames: 2 }).success).toBe(true);
    });

    await it('still refuses an answer that is not the one it promised', async () => {
      const rec = recorded();
      expect(schemaOf(rec, 'tab_open').safeParse({}).success).toBe(false);
      expect(schemaOf(rec, 'tab_open').safeParse({ tab: { tabId: '245' } }).success).toBe(false);
      expect(schemaOf(rec, 'tabs_list').safeParse({ tabs: [{ host: 'example.com' }] }).success).toBe(false);
    });

    await it('knows every level the protocol has, and nothing else', async () => {
      const rec = recorded();
      for (const level of ['none', 'read', 'write'] satisfies Level[]) {
        expect(schemaOf(rec, 'tabs_list').safeParse({ tabs: [{ ...READ_TAB, level }] }).success).toBe(true);
      }
      expect(schemaOf(rec, 'tabs_list').safeParse({ tabs: [{ ...READ_TAB, level: 'owner' }] }).success).toBe(
        false,
      );
    });

    await it('answers tab_open with the id the next call needs, as structured content', async () => {
      const rec = recorded();
      const result = await rec.invoke('tab_open', { url: 'https://example.com/invoices/7' });
      const structured = result.structuredContent as { tab: { tabId: number } };
      expect(structured.tab.tabId).toBe(245);
      // The text stays beside it: a client that ignores structured content still gets the answer,
      // and the value is the same one, not a second rendering of it.
      const textBlock = result.content[0] as { type: string; text: string };
      expect(textBlock.type).toBe('text');
      expect(textBlock.text).toBe(JSON.stringify(OPENED, null, 2));
    });

    await it('hands out structured content for every tool that declared a schema', async () => {
      const rec = recorded();
      for (const name of WITH_SCHEMA) {
        const result = await rec.invoke(name, { url: 'https://example.com/invoices/7', tabId: 245 });
        expect(result.structuredContent !== undefined).toBe(true);
      }
    });

    await it('browsers_list says WHY the list is empty, when the bridge knows (issue #28)', async () => {
      // The person's dismissal and a browser that went away are the two closes an agent used to
      // read as one sentence, and they need opposite next moves.
      for (const by of ['person', 'lost'] as const) {
        const gone = {
          port: 47813,
          version: '0.1.0',
          session: STATUS.session,
          browsers: [],
          disconnected: { by, browser: 'Firefox 155.0 (e12cd41c)', at: '2026-09-30T10:00:00.000Z' },
        };
        const rec = createRecorder();
        applyReadOnlyGate(rec.server, true);
        registerTools(rec.server, { bridge: { ...stubBridge(), status: () => gone } });
        const result = await rec.invoke('browsers_list');
        const out = result.structuredContent as { browsers: unknown[]; disconnected?: { by: string } };
        expect(out.browsers).toEqualArray([]);
        expect(out.disconnected?.by).toBe(by);
        // The published schema has to accept it, or a client sees a validation error where the
        // work succeeded.
        expect(schemaOf(rec, 'browsers_list').safeParse(result.structuredContent).success).toBe(true);
      }
    });

    await it('a refusal carries no structured content — an error is not an answer', async () => {
      const rec = createRecorder();
      applyReadOnlyGate(rec.server, true);
      const failing = {
        call: () => Promise.reject(new BridgeError({ code: 'forbidden', message: 'needs "read"' })),
        status: () => STATUS,
      } as unknown as BrowserAccess;
      registerTools(rec.server, { bridge: failing });
      const result = await rec.invoke('tabs_list');
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toBeUndefined();
    });
  });
};
