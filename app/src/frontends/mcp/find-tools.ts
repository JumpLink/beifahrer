/**
 * `page_find`, `page_wait` and `page_expect`: address elements by role + accessible name instead of
 * reading a whole outline, wait for a page or an element instead of guessing with sleeps, and assert a
 * state instead of reading the page once more to find out whether it happened.
 *
 * All three are read-level: they see what `page_outline` sees, and hand out refs from the same
 * registry, so a ref from `page_find` works in `page_fill` / `page_click` / `page_expect`.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  EXPECT_STATES,
  FIND_ROLES,
  MAX_EXPECT_MS,
  MAX_EXPECT_TEXT,
  MAX_WAIT_MS,
  QUERY_LIMITS,
  type ElementQuery,
} from '@beifahrer/core';

import { answer, browserParam, failure, foundElement, text, type Call } from './tools.ts';

const POLICY_NOTE =
  'Needs level "read" on the site. A "forbidden" error is the person\'s decision, not a malfunction: tell them which site and which level it needs.';

export const queryShape = {
  role: z.enum(FIND_ROLES).optional().describe('Element role as page_outline shows it'),
  name: z
    .union([
      z.string().min(1).max(QUERY_LIMITS.chars),
      z.array(z.string().min(1).max(QUERY_LIMITS.chars)).min(1).max(QUERY_LIMITS.names),
    ])
    .optional()
    .describe(
      'Part of the accessible name (label, aria-label, button text), case-insensitive. Several strings = any of them (e.g. the German and the English label).',
    ),
  text: z.string().min(1).max(QUERY_LIMITS.chars).optional().describe("Part of the element's visible text"),
  nth: z.number().int().min(0).max(QUERY_LIMITS.maxNth).optional().describe('Only the nth match, from 0'),
};

/**
 * The query fields of the tool arguments, without undefined keys (the extension refuses unknown keys,
 * not absent ones). `except` drops the fields that mean something ELSE in the calling tool.
 */
export function pickQuery(args: Record<string, unknown>, except: string[] = []): ElementQuery {
  const query: Record<string, unknown> = {};
  for (const key of ['role', 'name', 'text', 'nth'])
    if (args[key] !== undefined && !except.includes(key)) query[key] = args[key];
  return query as ElementQuery;
}

export function registerFindTools(server: McpServer, call: Call): void {
  // `url` is the tab's OWN url, not the document a match came from: a match in a frame says which
  // frame in its ref (b2e12), and a `meta` check answers a count with no matches at all.
  const findAnswer = answer({
    url: z.string().describe("The tab's own URL"),
    matches: z.array(foundElement).describe('Each ref works in page_fill / page_click / page_expect'),
    count: z.number().int().describe('How many matched; for a meta check, how many there are'),
    truncated: z.boolean().describe('True when more matched than maxResults'),
  });

  server.registerTool(
    'page_find',
    {
      title: 'Find elements by role and name',
      description:
        'Elements of a tab that match a role and/or part of their accessible name or text, each with a ref for page_fill / page_click — ' +
        'the same refs page_outline gives. Cheaper than a full outline when you know what you are looking for ("the button named Submit comment"). ' +
        'No CSS selectors: role + name is the query. ' +
        POLICY_NOTE,
      inputSchema: {
        tabId: z.number().int().describe('Tab id from tabs_list or tab_active'),
        ...queryShape,
        maxResults: z.number().int().min(1).max(200).optional().describe('Default 20'),
        meta: z
          .object({
            name: z.string().min(1).max(QUERY_LIMITS.chars),
            content: z.string().min(1).max(QUERY_LIMITS.chars).optional(),
          })
          .optional()
          .describe(
            'Instead of an element: does a <meta name=…> exist (content = substring)? Answers a count only, never the content — for recognising an app.',
          ),
        browser: browserParam,
      },
      outputSchema: findAnswer.schema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => {
      try {
        if (args.meta)
          return findAnswer.result(
            await call('page.find', { tabId: args.tabId, meta: args.meta }, args.browser),
          );
        const query = pickQuery(args);
        return findAnswer.result(
          await call('page.find', { tabId: args.tabId, maxResults: args.maxResults, ...query }, args.browser),
        );
      } catch (err) {
        return failure(err);
      }
    },
  );

  server.registerTool(
    'page_wait',
    {
      title: 'Wait for a page or an element',
      description:
        'Wait until a tab has finished loading (for="load", e.g. right after tab_open), or until an element matching role/name/text is there ' +
        "(e.g. the editor that appears after clicking a comment box). Returns the element's ref. " +
        `Gives up after timeoutMs (default 10000, at most ${MAX_WAIT_MS}) with a "timeout" error. ` +
        POLICY_NOTE,
      inputSchema: {
        tabId: z.number().int().describe('Tab id from tabs_list or tab_active'),
        for: z.enum(['load', 'element']).describe('"load" for the document, "element" for the query below'),
        ...queryShape,
        timeoutMs: z.number().int().min(100).max(MAX_WAIT_MS).optional(),
        browser: browserParam,
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => {
      try {
        const target = args.for === 'load' ? 'load' : pickQuery(args);
        return text(
          await call(
            'page.wait',
            { tabId: args.tabId, for: target, timeoutMs: args.timeoutMs },
            args.browser,
          ),
        );
      } catch (err) {
        return failure(err);
      }
    },
  );

  // Every field is there on a pass as well as on a failure: `seen` says what WAS true, and on a
  // pass that is the expectation itself. A FAILED assertion is an answer, not an error, so it
  // arrives here as one and never as a refusal.
  const expectAnswer = answer({
    pass: z.boolean().describe('True when the condition held; false is an answer, not an error'),
    expected: z.string().describe('The condition in words, so a failure names what was wanted'),
    seen: z.string().describe('What the elements were actually in — act on this, not on another read'),
    matches: z.number().int().describe('How many elements the query matched in the deciding document'),
    frame: z
      .number()
      .int()
      .describe("Which document decided: 0 is the page, otherwise Beifahrer's own frame index"),
    waitedMs: z.number().int().describe('How long the assertion waited before it answered'),
  });

  server.registerTool(
    'page_expect',
    {
      title: 'Assert a state and hear what you got instead',
      description:
        'Check a condition on a page and WAIT for it, up to timeoutMs (default 10000, at most ' +
        `${MAX_EXPECT_MS}): the Save button ENABLED, the spinner GONE (state "hidden" on a query that ` +
        'matches it), the field holding a value, the confirmation text on the screen, the number of matches. ' +
        'Give either a ref (one element, e.g. e12 — b2e12 if it is in a frame) or a query (every element of that kind, in the page and in ' +
        'any embedded page the person allowed). At least one of state / value / text / count is required — there is nothing to assert otherwise, ' +
        'and Beifahrer refuses rather than answer "pass" about an element nobody described. ' +
        'A QUERY is a claim about the page: "hidden" means NO match is visible (that is "the spinner is gone"), ' +
        'every other state means AT LEAST ONE match is in it. The query picks elements by role, accessible name and position; ' +
        '`count` is with a query only — a ref is one element by definition. value is compared exactly, text as a substring of the text the element HAS. ' +
        'A FAILED assertion is an answer, not an error: the result carries pass=false together with `seen` — what the elements are actually in, ' +
        'their values, how many there were — and `frame` if a frame decided it. That is the point of the tool: act on `seen` instead of reading the page again. ' +
        'Re-check the same condition only after changing the page. ' +
        POLICY_NOTE,
      inputSchema: {
        tabId: z.number().int().describe('Tab id from tabs_list or tab_active'),
        ref: z
          .string()
          .optional()
          .describe('Element ref from page_outline / page_find; not together with a query'),
        // The query WITHOUT its `text` field, and that is deliberate rather than an omission. In this
        // tool `text` is the CONDITION ("the element says Save"), while in a query it would be a
        // SELECTOR ("the element whose text is Save") — the same key meaning two things, and the one
        // an agent would read as a condition silently turning into a filter. So the query selects by
        // role, accessible name and position; text, value, state and count are all conditions.
        role: queryShape.role,
        name: queryShape.name,
        nth: queryShape.nth,
        state: z
          .enum(EXPECT_STATES)
          .optional()
          .describe(
            'visible, hidden, enabled, disabled, checked, unchecked or focused. "hidden" on a query = no match is visible',
          ),
        value: z.string().max(MAX_EXPECT_TEXT).optional().describe("The control's value, compared exactly"),
        text: z
          .string()
          .max(MAX_EXPECT_TEXT)
          .optional()
          .describe(
            "CONDITION: part of the matched element's own text, compared as a substring. Not a selector here",
          ),
        count: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe('Exactly this many matches (with a query, never with a ref)'),
        timeoutMs: z.number().int().min(100).max(MAX_EXPECT_MS).optional(),
        browser: browserParam,
      },
      outputSchema: expectAnswer.schema,
      annotations: { readOnlyHint: true, idempotentHint: false, openWorldHint: true },
    },
    async (args) => {
      try {
        // `text` is the condition here, never part of the query — see the note on the schema. An
        // all-empty query is absent, not an empty object: the extension's parser refuses a query with
        // no fields in it, and "ref OR query" is its rule to judge.
        const picked = pickQuery(args, ['text']);
        const query = Object.keys(picked).length ? picked : undefined;
        return expectAnswer.result(
          await call(
            'page.expect',
            {
              tabId: args.tabId,
              ref: args.ref,
              query,
              state: args.state,
              value: args.value,
              text: args.text,
              count: args.count,
              timeoutMs: args.timeoutMs,
            },
            args.browser,
          ),
        );
      } catch (err) {
        return failure(err);
      }
    },
  );
}
