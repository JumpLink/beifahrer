/**
 * Running a recipe: a macro over the ordinary protocol calls.
 *
 * Every step becomes one call (`page.find`, `page.click`, `page.fill`, `page.wait`, …) that the
 * extension checks exactly like a call the agent made itself — per-site level, the browser's host
 * permission, the confirmation window. That is the whole security argument for recipes: this file
 * holds no gate, needs none, and must never grow one (ADR 0005). The extension does not know
 * recipes exist.
 *
 * Errors before the first step (while matching the tab) are thrown unchanged, so the agent sees
 * the extension's `paused` or `forbidden` as it would for a single call.
 *
 * What this file does decide is WHEN to stop:
 * - at the first failure, naming the step;
 * - before a step marked `requiresExplicitRequest` unless the run says the person asked for
 *   exactly that (`explicitRequest`);
 * - at a `checkpoint`, so the agent can look before it goes on (`from` resumes after it);
 * - before the step named by `until`.
 */

import {
  checkRunParams,
  describeQuery,
  QUERY_LIMITS,
  urlsMatch,
  type ElementQuery,
  type FingerprintCheck,
  type Method,
  type Params,
  type Recipe,
  type Result,
  type Step,
} from '@beifahrer/core';

import { BridgeError } from '../bridge/bridge.ts';

export type Call = <M extends Method>(method: M, params: Params<M>, browser?: string) => Promise<Result<M>>;

export interface StepLog {
  step: string;
  action: Step['action'];
  status: 'ok' | 'skipped' | 'failed' | 'stopped';
  detail?: string;
  /** What a read / outline / find step returned, for the agent. */
  result?: unknown;
}

export interface RunResult {
  recipe: string;
  status: 'done' | 'stopped' | 'failed';
  message: string;
  /** The step to pass as `from` to continue. */
  next?: string;
  log: StepLog[];
}

export interface RunOptions {
  tabId: number;
  params?: unknown;
  /** Start at this step (resume after a stop). */
  from?: string;
  /** Stop before this step. */
  until?: string;
  /** The person asked for exactly the action the recipe's final step performs. */
  explicitRequest?: boolean;
  browser?: string;
}

class StepFailed extends Error {}

function describeError(err: unknown): string {
  if (err instanceof BridgeError) return `${err.wire.code}: ${err.wire.message}`;
  return err instanceof Error ? err.message : String(err);
}

/** The tab's URL as the agent may see it — absent when the site is below `read`. */
async function tabUrl(call: Call, tabId: number, browser?: string): Promise<string | undefined> {
  const { tabs } = await call('tabs.list', {}, browser);
  const tab = tabs.find((t) => t.tabId === tabId);
  if (!tab)
    throw new BridgeError({ code: 'not_found', message: `no tab ${tabId} — call tabs_list for current ids` });
  return tab.url;
}

/**
 * Evaluates fingerprint checks on one tab, remembering each answer: `recipes_for_tab` asks the
 * same "is this OpenProject?" for every OpenProject recipe, and the page does not change between.
 */
export class TabProbe {
  #cache = new Map<string, Promise<boolean>>();

  constructor(
    private readonly call: Call,
    readonly tabId: number,
    readonly url: string | undefined,
    private readonly browser?: string,
  ) {}

  static async open(call: Call, tabId: number, browser?: string): Promise<TabProbe> {
    return new TabProbe(call, tabId, await tabUrl(call, tabId, browser), browser);
  }

  check(check: FingerprintCheck): Promise<boolean> {
    const key = JSON.stringify(check);
    let answer = this.#cache.get(key);
    if (!answer) {
      const params =
        'meta' in check
          ? { tabId: this.tabId, meta: check.meta }
          : { tabId: this.tabId, ...check.find, maxResults: 1 };
      answer = this.call('page.find', params, this.browser).then((r) => r.count > 0);
      this.#cache.set(key, answer);
    }
    return answer;
  }

  /** Does any of the recipe's matchers hold on this tab? */
  async matches(recipe: Recipe): Promise<boolean> {
    // No URL = the site is below `read`: nothing about the page may be looked at, so nothing matches.
    if (!this.url) return false;
    for (const matcher of recipe.match) {
      if (urlsMatch(matcher, this.url) === false) continue;
      let all = true;
      for (const check of matcher.fingerprint ?? []) {
        if (!(await this.check(check))) {
          all = false;
          break;
        }
      }
      if (all) return true;
    }
    return false;
  }
}

export async function runRecipe(call: Call, recipe: Recipe, opts: RunOptions): Promise<RunResult> {
  const log: StepLog[] = [];
  const result = (status: RunResult['status'], message: string, next?: string): RunResult => ({
    recipe: recipe.id,
    status,
    message,
    ...(next ? { next } : {}),
    log,
  });

  const params = checkRunParams(recipe, opts.params);
  if (typeof params === 'string') return result('failed', `${recipe.id}: ${params}`);

  const ids = recipe.steps.map((s) => s.id);
  for (const [name, id] of [
    ['from', opts.from],
    ['until', opts.until],
  ] as const) {
    if (id !== undefined && !ids.includes(id))
      return result('failed', `${recipe.id} has no step "${id}" (${name}); its steps: ${ids.join(', ')}`);
  }

  const { tabId, browser } = opts;
  // Before the first step: an error here (paused, a feature switched off, a site below `read`)
  // is the extension's answer to the agent, not a step failing, so it is thrown unchanged.
  const probe = await TabProbe.open(call, tabId, browser);
  if (!(await probe.matches(recipe)))
    return result(
      'failed',
      `${recipe.id} does not match tab ${tabId}` +
        (probe.url ? '' : ' (its site is below level "read", so Beifahrer cannot look at it)') +
        ' — recipes_for_tab lists the recipes that do',
    );

  // A step's `nameParam` narrows its target to the element whose name also carries the param's value.
  // A missing value is a failed step: running on with the plain target would pick the first match,
  // which is the wrong row's button.
  const narrow = (target: ElementQuery, nameParam: string | undefined): ElementQuery => {
    if (nameParam === undefined) return target;
    const value = params[nameParam]?.trim();
    if (!value) throw new StepFailed(`param "${nameParam}" is empty — the target is named by it`);
    return { ...target, nameAlso: value.slice(0, QUERY_LIMITS.chars) };
  };

  const resolve = async (target: ElementQuery): Promise<string> => {
    const found = await call('page.find', { tabId, ...target, nth: target.nth ?? 0 }, browser);
    const ref = found.matches[0]?.ref;
    if (!ref) throw new StepFailed(`no ${describeQuery(target)} on the page`);
    return ref;
  };

  const start = opts.from ? ids.indexOf(opts.from) : 0;
  for (let i = start; i < recipe.steps.length; i++) {
    const step = recipe.steps[i]!;
    const entry: StepLog = { step: step.id, action: step.action, status: 'ok' };
    if (step.note) entry.detail = step.note;

    if (step.id === opts.until) {
      log.push({ ...entry, status: 'stopped', detail: 'stopped here: until' });
      return result('stopped', `stopped before step "${step.id}" as asked (until)`, step.id);
    }
    if (step.requiresExplicitRequest && opts.explicitRequest !== true) {
      log.push({ ...entry, status: 'stopped', detail: 'needs the explicit request of the person' });
      return result(
        'stopped',
        `stopped before step "${step.id}" (${step.action}): it runs only when the person asked for exactly this action. ` +
          `If they did, continue with from: "${step.id}" and explicitRequest: true.`,
        step.id,
      );
    }
    if (step.action === 'checkpoint' && step.id !== opts.from) {
      log.push({ ...entry, status: 'stopped', detail: step.message });
      const next = recipe.steps[i + 1]?.id;
      return result('stopped', `checkpoint "${step.id}": ${step.message}`, next);
    }

    try {
      switch (step.action) {
        case 'checkpoint':
          entry.detail = 'resumed here';
          break;
        case 'find': {
          const target = narrow(step.target, step.nameParam);
          const r = await call('page.find', { tabId, ...target }, browser);
          if (r.count === 0) throw new StepFailed(`no ${describeQuery(target)} on the page`);
          entry.result = r.matches.map((m) => m.description);
          break;
        }
        case 'click':
        case 'submit': {
          const target = narrow(step.target, step.nameParam);
          if (step.action === 'click' && step.optional) {
            // Absent is fine, e.g. a redirect button that only one of two entry pages shows.
            const found = await call('page.find', { tabId, ...target, nth: target.nth ?? 0 }, browser);
            if (!found.matches[0]) {
              entry.status = 'skipped';
              entry.detail = `no ${describeQuery(target)} on the page (optional)`;
              break;
            }
          }
          const ref = await resolve(target);
          await call('page.click', { tabId, ref }, browser);
          break;
        }
        case 'fill': {
          const text = params[step.param];
          if (text === undefined) {
            entry.status = 'skipped';
            entry.detail = `param "${step.param}" not given`;
            break;
          }
          const ref = await resolve(step.target);
          const r = await call('page.fill', { tabId, ref, text, as: step.as, mode: step.mode }, browser);
          entry.result = r.value;
          break;
        }
        case 'wait': {
          const wanted = step.for === 'load' ? step.for : narrow(step.for, step.nameParam);
          const r = await call('page.wait', { tabId, for: wanted, timeoutMs: step.timeoutMs }, browser).catch(
            (err: unknown) => {
              // Only the timeout is the recipe's to explain; a forbidden or paused stays the extension's word.
              if (step.failMessage && err instanceof BridgeError && err.wire.code === 'timeout')
                throw new StepFailed(step.failMessage);
              throw err;
            },
          );
          entry.detail = `after ${r.waitedMs} ms${r.match ? `: ${r.match.description}` : ''}`;
          break;
        }
        case 'read':
          entry.result = await call('page.read', { tabId, maxChars: step.maxChars }, browser);
          break;
        case 'outline':
          entry.result = (await call('page.outline', { tabId, maxItems: step.maxItems }, browser)).outline;
          break;
        case 'rows': {
          // With a param, the list is scrolled to that row and left there (a virtual list only has
          // the rows near the viewport); nothing is clicked.
          const match = step.param === undefined ? undefined : params[step.param];
          if (step.param !== undefined && !match)
            throw new StepFailed(`param "${step.param}" is empty — a row is named by its text`);
          const r = await call('page.rows', { tabId, maxRows: step.maxRows, match }, browser);
          if (match && !r.ref) throw new StepFailed(`no row containing "${match}" on the page`);
          entry.detail = `${r.count} rows${r.truncated ? ' (cut)' : ''}`;
          entry.result = r.rows;
          break;
        }
        case 'click-row': {
          // A row has no role to ask `page.find` for, so it is looked up by the text the person
          // reads on it. The click is an ordinary `page.click` on the ref that comes back.
          const match = params[step.param];
          if (!match) throw new StepFailed(`param "${step.param}" is empty — a row is named by its text`);
          const rows = await call('page.rows', { tabId, match }, browser);
          if (!rows.ref) throw new StepFailed(`no row containing "${match}" on the page`);
          await call('page.click', { tabId, ref: rows.ref }, browser);
          break;
        }
        case 'capture': {
          const ref = await resolve(narrow(step.target, step.nameParam));
          const doc = await call('page.capture', { tabId, ref, maxBytes: step.maxBytes }, browser);
          entry.detail = `${doc.filename} (${doc.mime}, ${doc.size} bytes, via ${doc.via})`;
          entry.result = doc;
          break;
        }
      }
    } catch (err) {
      const why = err instanceof StepFailed ? err.message : describeError(err);
      log.push({ ...entry, status: 'failed', detail: why });
      return result('failed', `step ${i + 1} "${step.id}" (${step.action}) failed: ${why}`, step.id);
    }
    log.push(entry);
  }
  return result('done', `${recipe.id}: all steps done`);
}
