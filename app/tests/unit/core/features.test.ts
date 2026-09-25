import { describe, expect, it } from '@gjsify/unit';

import {
  ACTIVE_MS,
  ACTIVITY_LIMIT,
  DEFAULT_FEATURES,
  FEATURES,
  FEATURE_INFO,
  FEATURE_OF,
  REQUIRED_LEVEL,
  activityEntry,
  featureOf,
  parseFeatures,
  parsePaused,
  preflight,
  preflightMessage,
  pushActivity,
  toolbarLook,
  type ActivityEntry,
  type Features,
  type Method,
} from '@beifahrer/core';

// The kill switch and the feature allowlist sit in front of the per-site policy. Every case below
// is a way the person's "stop" or "not this" could fail to hold.
export default async () => {
  const methods = Object.keys(REQUIRED_LEVEL) as Method[];
  const allOn = Object.fromEntries(FEATURES.map((f) => [f, true])) as Features;
  const allOff = Object.fromEntries(FEATURES.map((f) => [f, false])) as Features;

  await describe('feature table', async () => {
    await it('maps every method to exactly one known feature, and no more', async () => {
      expect(Object.keys(FEATURE_OF).sort()).toEqualArray([...methods].sort());
      for (const m of methods) expect(FEATURES.includes(featureOf(m)!)).toBe(true);
    });
    await it('uses every feature and describes each one', async () => {
      const used = new Set(Object.values(FEATURE_OF));
      for (const f of FEATURES) {
        expect(used.has(f)).toBe(true);
        expect(FEATURE_INFO[f].label.length > 0).toBe(true);
      }
    });
    await it('refuses a method with no feature instead of waving it on', async () => {
      expect(featureOf('page.evaluate')).toBeNull();
      expect(featureOf('__proto__')).toBeNull();
      expect(preflight({ paused: false, features: allOn }, 'page.evaluate')).toStrictEqual({
        allow: false,
        code: 'feature_disabled',
        feature: null,
      });
    });
    await it('splits tab management from sessions', async () => {
      expect(featureOf('tabs.close')).toBe('manageTabs');
      expect(featureOf('windows.create')).toBe('manageTabs');
      expect(featureOf('sessions.restore')).toBe('sessions');
      expect(featureOf('sessions.recentlyClosed')).toBe('sessions');
    });
  });

  await describe('defaults', async () => {
    await it('reading, outlining, opening and page writes on; the far-reaching ones off', async () => {
      expect(DEFAULT_FEATURES).toStrictEqual({
        tabs: true,
        read: true,
        outline: true,
        screenshot: false,
        fill: true,
        click: true,
        open: true,
        manageTabs: false,
        sessions: false,
      });
    });
    await it('are what a fresh install parses to', async () => {
      expect(parseFeatures(undefined)).toStrictEqual(DEFAULT_FEATURES);
    });
  });

  await describe('parseFeatures', async () => {
    await it('switches a feature on only for a literal true', async () => {
      for (const v of ['true', 1, {}, [], 'yes']) expect(parseFeatures({ read: v }).read).toBe(false);
      expect(parseFeatures({ screenshot: true }).screenshot).toBe(true);
    });
    await it('keeps the default for a switch never set', async () => {
      expect(parseFeatures({ fill: false })).toStrictEqual({ ...DEFAULT_FEATURES, fill: false });
    });
    await it('switches everything off when the stored value is not an object', async () => {
      for (const raw of ['x', 42, true, ['read']]) expect(parseFeatures(raw)).toStrictEqual(allOff);
    });
    await it("carries PR #8's manageTabs grant over to both tab management and sessions", async () => {
      const f = parseFeatures(undefined, { manageTabs: true });
      expect(f.manageTabs).toBe(true);
      expect(f.sessions).toBe(true);
      expect(parseFeatures(undefined, { manageTabs: 'true' }).manageTabs).toBe(false);
    });
    await it('lets an explicit switch win over the legacy grant', async () => {
      const f = parseFeatures({ sessions: false }, { manageTabs: true });
      expect(f.manageTabs).toBe(true);
      expect(f.sessions).toBe(false);
    });
  });

  await describe('pause', async () => {
    await it('refuses every method while paused, listing tabs included', async () => {
      for (const m of methods)
        expect(preflight({ paused: true, features: allOn }, m)).toStrictEqual({
          allow: false,
          code: 'paused',
        });
    });
    await it('parses fail-closed: never set runs, anything but a boolean pauses', async () => {
      expect(parsePaused(undefined)).toBe(false);
      expect(parsePaused(false)).toBe(false);
      expect(parsePaused(true)).toBe(true);
      for (const v of ['false', 0, {}, 'no']) expect(parsePaused(v)).toBe(true);
    });
    await it('tells the agent to ask the person', async () => {
      expect(preflightMessage({ allow: false, code: 'paused' }, 'tabs.list')).toMatch(/ask them to resume/);
    });
  });

  await describe('check order', async () => {
    await it('pause comes before the feature switch', async () => {
      expect(preflight({ paused: true, features: allOff }, 'page.read')).toStrictEqual({
        allow: false,
        code: 'paused',
      });
    });
    await it('a disabled feature refuses, naming it', async () => {
      const r = preflight({ paused: false, features: { ...allOn, screenshot: false } }, 'page.screenshot');
      expect(r).toStrictEqual({ allow: false, code: 'feature_disabled', feature: 'screenshot' });
      if (!r.allow) expect(preflightMessage(r, 'page.screenshot')).toMatch(/Take screenshots/);
    });
    await it('lets through what is switched on, for the per-site level to decide next', async () => {
      for (const m of methods)
        expect(preflight({ paused: false, features: allOn }, m)).toStrictEqual({
          allow: true,
          feature: FEATURE_OF[m],
        });
    });
  });

  await describe('toolbarLook', async () => {
    const base = { paused: false, inFlight: 0, lastActivityAt: 0, now: 100_000 };
    await it('has an amber dot without a bridge or a pairing', async () => {
      for (const connection of ['unpaired', 'offline', 'connecting', 'unauthorized', 'protocol'] as const) {
        const look = toolbarLook({ ...base, connection, inFlight: 2 });
        expect(look.icon).toBe('offline');
        expect(look.title).toMatch(/beifahrer — /);
      }
    });
    await it('is monochrome and quiet when connected and idle', async () => {
      const look = toolbarLook({ ...base, connection: 'connected' });
      expect(look.icon).toBe('idle');
      expect(look.badge).toBe('');
      expect(look.title).toMatch(/idle/);
    });
    await it('turns colour while a request runs and for ACTIVE_MS after', async () => {
      expect(toolbarLook({ ...base, connection: 'connected', inFlight: 1 }).icon).toBe('active');
      const recent = { ...base, connection: 'connected' as const, lastActivityAt: base.now - ACTIVE_MS + 1 };
      expect(toolbarLook(recent).icon).toBe('active');
      expect(toolbarLook(recent).badge).toBe('AI');
      expect(toolbarLook({ ...recent, lastActivityAt: base.now - ACTIVE_MS }).icon).toBe('idle');
    });
    await it('shows the red paused dot over every other state', async () => {
      for (const connection of ['connected', 'offline', 'unpaired'] as const) {
        const look = toolbarLook({ ...base, connection, paused: true, inFlight: 3 });
        expect(look.icon).toBe('paused');
        expect(look.badge).toBe('II');
        expect(look.title).toMatch(/paused/);
      }
    });
  });

  await describe('activity log', async () => {
    await it('keeps the host, never the path, query or page text', async () => {
      const e = activityEntry({
        at: 1,
        method: 'page.read',
        params: { tabId: 3 },
        url: 'https://bank.example/konto?iban=DE00',
      });
      expect(e.host).toBe('bank.example');
      expect(JSON.stringify(e).includes('iban')).toBe(false);
      expect(e.outcome).toBe('ok');
    });
    await it('caps the preview of a fill', async () => {
      const e = activityEntry({ at: 1, method: 'page.fill', params: { text: 'x'.repeat(500) }, url: null });
      expect(e.preview!.length <= 40).toBe(true);
    });
    await it('shows no preview for anything but a fill', async () => {
      expect(
        activityEntry({ at: 1, method: 'page.click', params: { text: 'secret' } }).preview,
      ).toBeUndefined();
    });
    await it('logs refusals with their reason', async () => {
      const e = activityEntry({ at: 1, method: 'tabs.list', params: {}, error: { code: 'paused' } });
      expect(e.outcome).toBe('refused');
      expect(e.reason).toBe('paused');
      expect(
        activityEntry({ at: 1, method: 'page.read', params: {}, error: { code: 'failed' } }).outcome,
      ).toBe('failed');
    });
    await it('keeps the newest ACTIVITY_LIMIT entries', async () => {
      let log: ActivityEntry[] = [];
      for (let i = 0; i < ACTIVITY_LIMIT + 5; i++)
        log = pushActivity(log, activityEntry({ at: i, method: 'tabs.list', params: {} }));
      expect(log.length).toBe(ACTIVITY_LIMIT);
      expect(log[0]!.at).toBe(ACTIVITY_LIMIT + 4);
    });
  });
};
