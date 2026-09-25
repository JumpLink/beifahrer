/**
 * `page_find` and `page_wait`: address elements by role + accessible name instead of reading
 * a whole outline, and wait for a page or an element instead of guessing with sleeps.
 *
 * Both are read-level: they see what `page_outline` sees, and hand out refs from the same
 * registry, so a ref from `page_find` works in `page_fill` / `page_click`.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { FIND_ROLES, MAX_WAIT_MS, QUERY_LIMITS, type ElementQuery } from '@beifahrer/core';

import { browserParam, failure, text, type Call } from './tools.ts';

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

/** The query fields of the tool arguments, without undefined keys (the extension refuses unknown keys, not absent ones). */
export function pickQuery(args: Record<string, unknown>): ElementQuery {
  const query: Record<string, unknown> = {};
  for (const key of ['role', 'name', 'text', 'nth']) if (args[key] !== undefined) query[key] = args[key];
  return query as ElementQuery;
}

export function registerFindTools(server: McpServer, call: Call): void {
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
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => {
      try {
        if (args.meta)
          return text(await call('page.find', { tabId: args.tabId, meta: args.meta }, args.browser));
        const query = pickQuery(args);
        return text(
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
}
