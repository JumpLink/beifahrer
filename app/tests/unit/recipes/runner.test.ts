import { describe, expect, it } from '@gjsify/unit';
import { parseRecipe, queryMatches, type ElementQuery, type FindRole, type Recipe } from '@beifahrer/core';

import { BridgeError } from '../../../src/bridge/bridge.ts';
import { runRecipe, TabProbe, type Call } from '../../../src/recipes/runner.ts';

/**
 * A fake extension: a page of elements, a log of every protocol call, and hooks to make a call
 * fail the way the real extension would (forbidden, denied). The runner must go through `call`
 * for everything — that is what keeps every step under the extension's gate.
 */
interface FakeEl {
  ref: string;
  role: FindRole;
  name: string;
}

function fakeExtension(opts: { url?: string; fail?: Record<string, BridgeError>; metas?: string[] } = {}) {
  let next = 1;
  const el = (role: FindRole, name: string): FakeEl => ({ ref: `e${next++}`, role, name });
  const page = {
    elements: [el('button', 'Einen Kommentar hinzufügen. @ tippen, um Personen zu benachrichtigen.')],
    editor: '',
    posted: [] as string[],
  };
  const calls: string[] = [];
  const url = 'url' in opts ? opts.url : 'https://op.example/work_packages/1';
  const found = (q: ElementQuery) => {
    const all = page.elements.filter((e) => queryMatches(q, { role: e.role, name: e.name, text: '' }));
    return q.nth !== undefined ? all.slice(q.nth, q.nth + 1) : all;
  };
  const call = (async (method: string, params: Record<string, unknown>) => {
    calls.push(method);
    const failure = opts.fail?.[method];
    if (failure) throw failure;
    switch (method) {
      case 'tabs.list':
        return {
          tabs: [
            {
              tabId: 7,
              windowId: 1,
              active: true,
              focusedWindow: true,
              host: 'op.example',
              level: url ? 'write' : 'none',
              ...(url ? { url } : {}),
            },
          ],
        };
      case 'page.find': {
        if (params.meta) {
          const name = (params.meta as { name: string }).name;
          return {
            url,
            matches: [],
            count: (opts.metas ?? ['app_base_path', 'app_title']).includes(name) ? 1 : 0,
            truncated: false,
          };
        }
        const { tabId: _t, maxResults: _m, ...q } = params;
        const m = found(q as ElementQuery).map((e) => ({ ref: e.ref, description: `${e.role} "${e.name}"` }));
        return { url, matches: m, count: m.length, truncated: false };
      }
      case 'page.click': {
        const target = page.elements.find((e) => e.ref === params.ref)!;
        if (target.name.startsWith('Einen Kommentar')) {
          page.elements = [el('richtext', 'Editor'), el('button', 'Kommentar absenden')];
        } else if (target.name === 'Kommentar absenden') {
          page.posted.push(page.editor);
        }
        return { ref: params.ref };
      }
      case 'page.fill':
        page.editor = params.text as string;
        return { ref: params.ref, value: page.editor };
      case 'page.wait': {
        const q = params.for as ElementQuery;
        const m = found(q)[0];
        if (!m) throw new BridgeError({ code: 'timeout', message: 'nothing matched' });
        return { waitedMs: 5, match: { ref: m.ref, description: m.name } };
      }
      case 'page.read':
        return { url, title: 't', text: page.editor, truncated: false };
      default:
        throw new Error(`unexpected ${method}`);
    }
  }) as unknown as Call;
  return { call, calls, page };
}

const BASE = {
  id: 'openproject/add-comment',
  title: 't',
  description: 'd',
  version: '1.0.0',
  match: { fingerprint: [{ meta: { name: 'app_base_path' } }, { meta: { name: 'app_title' } }] },
  params: [{ name: 'text', type: 'string', description: 'x', required: true }],
  steps: [
    {
      id: 'open-box',
      action: 'click',
      target: { role: 'button', name: ['Einen Kommentar hinzufügen', 'Add a comment'] },
    },
    { id: 'wait-editor', action: 'wait', for: { role: 'richtext' } },
    { id: 'fill', action: 'fill', target: { role: 'richtext' }, param: 'text', as: 'html' },
    {
      id: 'submit',
      action: 'submit',
      target: { role: 'button', name: 'Kommentar absenden' },
      requiresExplicitRequest: true,
    },
  ],
};

function recipe(patch: Record<string, unknown> = {}): Recipe {
  const r = parseRecipe({ ...BASE, ...patch });
  if (typeof r === 'string') throw new Error(r);
  return r;
}

export default async () => {
  await describe('runRecipe', async () => {
    await it('runs the steps in order and stops BEFORE the explicit-request step', async () => {
      const ext = fakeExtension();
      const run = await runRecipe(ext.call, recipe(), { tabId: 7, params: { text: '<p>Hallo</p>' } });
      expect(run.status).toBe('stopped');
      expect(run.next).toBe('submit');
      expect(run.message).toMatch(/only when the person asked for exactly this action/);
      expect(run.log.map((l) => `${l.step}:${l.status}`).join(' ')).toBe(
        'open-box:ok wait-editor:ok fill:ok submit:stopped',
      );
      expect(ext.page.editor).toBe('<p>Hallo</p>');
      expect(ext.page.posted.length).toBe(0);
      // match (tabs.list + two meta checks), then find+click, wait, find+fill — and no second click.
      expect(ext.calls.join(',')).toBe(
        'tabs.list,page.find,page.find,page.find,page.click,page.wait,page.find,page.fill',
      );
    });

    await it('with explicitRequest, resumes from the submit step and posts', async () => {
      const ext = fakeExtension();
      await runRecipe(ext.call, recipe(), { tabId: 7, params: { text: 'Hallo' } });
      const run = await runRecipe(ext.call, recipe(), {
        tabId: 7,
        params: { text: 'Hallo' },
        from: 'submit',
        explicitRequest: true,
      });
      expect(run.status).toBe('done');
      expect(ext.page.posted.join('|')).toBe('Hallo');
    });

    await it('stops at the first failure and names the step; later steps never run', async () => {
      const ext = fakeExtension();
      ext.page.elements = []; // no comment button on this page
      const run = await runRecipe(ext.call, recipe(), { tabId: 7, params: { text: 'x' } });
      expect(run.status).toBe('failed');
      expect(run.message).toMatch(
        /step 1 "open-box" \(click\) failed: no button "Einen Kommentar hinzufügen" \| "Add a comment"/,
      );
      expect(run.next).toBe('open-box');
      expect(ext.calls.includes('page.click')).toBe(false);
      expect(ext.calls.includes('page.fill')).toBe(false);
    });

    await it("passes the extension's gate errors through unchanged", async () => {
      const ext = fakeExtension({
        fail: { 'page.click': new BridgeError({ code: 'denied', message: 'the person declined the click' }) },
      });
      const run = await runRecipe(ext.call, recipe(), { tabId: 7, params: { text: 'x' } });
      expect(run.status).toBe('failed');
      expect(run.message).toMatch(/"open-box" \(click\) failed: denied: the person declined the click/);
      expect(ext.calls.includes('page.wait')).toBe(false);

      const forbidden = fakeExtension({
        fail: {
          'page.find': new BridgeError({ code: 'forbidden', message: 'op.example is at level "none"' }),
        },
      });
      // While matching, before any step: thrown unchanged, like a single call's refusal.
      let thrown: unknown;
      await runRecipe(forbidden.call, recipe(), { tabId: 7, params: { text: 'x' } }).catch((err) => {
        thrown = err;
      });
      expect(thrown instanceof BridgeError && thrown.wire.code === 'forbidden').toBe(true);
      expect(forbidden.calls.includes('page.click')).toBe(false);
    });

    await it('a timeout in a wait step fails that step', async () => {
      const ext = fakeExtension();
      const r = recipe({
        steps: [{ id: 'wait', action: 'wait', for: { role: 'richtext' } }],
        params: [],
      });
      const run = await runRecipe(ext.call, r, { tabId: 7 });
      expect(run.message).toMatch(/step 1 "wait" \(wait\) failed: timeout: nothing matched/);
    });

    await it('refuses bad params before any call', async () => {
      const ext = fakeExtension();
      const missing = await runRecipe(ext.call, recipe(), { tabId: 7, params: {} });
      expect(missing.message).toMatch(/missing required param "text"/);
      const extra = await runRecipe(ext.call, recipe(), { tabId: 7, params: { text: 'x', ref: 'e1' } });
      expect(extra.message).toMatch(/unknown param "ref"/);
      const from = await runRecipe(ext.call, recipe(), { tabId: 7, params: { text: 'x' }, from: 'nope' });
      expect(from.message).toMatch(/no step "nope"/);
      expect(ext.calls.length).toBe(0);
    });

    await it('refuses a tab the recipe does not match, and one below read, without touching the page', async () => {
      const other = fakeExtension({ metas: [] });
      const run = await runRecipe(other.call, recipe(), { tabId: 7, params: { text: 'x' } });
      expect(run.message).toMatch(/does not match tab 7/);
      expect(other.calls.includes('page.click')).toBe(false);

      const hidden = fakeExtension({ url: undefined });
      const r2 = await runRecipe(hidden.call, recipe(), { tabId: 7, params: { text: 'x' } });
      expect(r2.message).toMatch(/below level "read"/);
      expect(hidden.calls.join(',')).toBe('tabs.list');

      const byUrl = recipe({ match: { urls: ['https://elsewhere.example/*'] } });
      const r3 = await runRecipe(fakeExtension().call, byUrl, { tabId: 7, params: { text: 'x' } });
      expect(r3.message).toMatch(/does not match/);
    });

    await it('stops at a checkpoint and at until; from resumes after a checkpoint', async () => {
      const r = recipe({
        steps: [
          BASE.steps[0],
          { id: 'look', action: 'checkpoint', message: 'Is this the right work package?' },
          BASE.steps[1],
          BASE.steps[2],
        ],
      });
      const ext = fakeExtension();
      const first = await runRecipe(ext.call, r, { tabId: 7, params: { text: 'x' } });
      expect(first.status).toBe('stopped');
      expect(first.message).toMatch(/right work package/);
      expect(first.next).toBe('wait-editor');
      const second = await runRecipe(ext.call, r, {
        tabId: 7,
        params: { text: 'x' },
        from: 'wait-editor',
        until: 'fill',
      });
      expect(second.status).toBe('stopped');
      expect(second.next).toBe('fill');
      expect(ext.page.editor).toBe('');
      const third = await runRecipe(ext.call, r, { tabId: 7, params: { text: 'x' }, from: 'fill' });
      expect(third.status).toBe('done');
      expect(ext.page.editor).toBe('x');
    });

    await it('an optional param left out skips its fill step', async () => {
      const r = recipe({
        params: [{ name: 'text', type: 'string', description: 'x', required: false }],
        steps: [BASE.steps[0], BASE.steps[1], BASE.steps[2]],
      });
      const run = await runRecipe(fakeExtension().call, r, { tabId: 7 });
      expect(run.status).toBe('done');
      expect(run.log[2]!.status).toBe('skipped');
    });
  });

  await describe('TabProbe', async () => {
    await it('asks each fingerprint check once per tab', async () => {
      const ext = fakeExtension();
      const probe = await TabProbe.open(ext.call, 7);
      expect(await probe.matches(recipe())).toBe(true);
      expect(await probe.matches(recipe({ id: 'openproject/other' }))).toBe(true);
      expect(ext.calls.filter((c) => c === 'page.find').length).toBe(2);
    });
  });
};
