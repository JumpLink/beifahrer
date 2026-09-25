/**
 * MCP tools for tab and window management and saved sessions.
 *
 * They sit behind two feature switches the person flips in the browser, "Manage tabs and
 * windows" and "Saved sessions", both off by default; the extension enforces them (FEATURE_OF in
 * core's features.ts), not this file. Sorting is the agent's job: tabs_list gives index, pinned and group, tabs_move takes
 * an index.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { GROUP_COLORS, type Method, type Params, type Result } from '@beifahrer/core';

import { browserParam, failure, text } from './tools.ts';

type Call = <M extends Method>(method: M, params: Params<M>, browser?: string) => Promise<Result<M>>;

const DECISION =
  'A "feature_disabled" or "forbidden" error is their decision, not a malfunction: tell them what you want to do and let them decide.';
const MANAGE_NOTE =
  'Needs the feature "Manage tabs and windows", which the person switches on in the beifahrer popup or options — off by default. ' +
  DECISION;
const SESSIONS_NOTE =
  'Needs the feature "Saved sessions", which the person switches on in the beifahrer popup or options — off by default. ' +
  DECISION;

const tabIds = z.array(z.number().int()).min(1).describe('Tab ids from tabs_list');
const sessionName = z.string().min(1).max(100).describe('Session name');

const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const DESTRUCTIVE = { ...WRITE, destructiveHint: true };
const READ = { readOnlyHint: true, openWorldHint: false };

export function registerTabTools(server: McpServer, call: Call): void {
  const run =
    <M extends Method>(method: M, pick: (args: Record<string, unknown>) => Params<M>) =>
    async (args: Record<string, unknown>) => {
      try {
        return text(await call(method, pick(args), args.browser as string | undefined));
      } catch (err) {
        return failure(err);
      }
    };

  server.registerTool(
    'tabs_move',
    {
      title: 'Move tabs',
      description:
        'Move tabs to a position, within their window or into another (windowId). Several tabs land in the given order from index on; ' +
        'index -1 = the end. Pinned tabs always stay before unpinned ones — the browser clamps. To sort, read index/pinned/groupId from tabs_list and move. ' +
        MANAGE_NOTE,
      inputSchema: {
        tabIds,
        index: z.number().int().min(-1).describe('Target position from 0; -1 = end'),
        windowId: z.number().int().optional().describe('Target window; default: where the tabs are'),
        browser: browserParam,
      },
      annotations: WRITE,
    },
    run('tabs.move', (a) => ({
      tabIds: a.tabIds as number[],
      index: a.index as number,
      windowId: a.windowId as number | undefined,
    })),
  );

  server.registerTool(
    'tabs_pin',
    {
      title: 'Pin or unpin tabs',
      description: 'Pin (pinned=true) or unpin tabs. ' + MANAGE_NOTE,
      inputSchema: { tabIds, pinned: z.boolean(), browser: browserParam },
      annotations: WRITE,
    },
    run('tabs.pin', (a) => ({ tabIds: a.tabIds as number[], pinned: a.pinned as boolean })),
  );

  server.registerTool(
    'tabs_close',
    {
      title: 'Close tabs or a window',
      description:
        'Close the given tabs, or every tab of one window (windowId). The person confirms in a browser window that lists the tabs, unless they switched that off — this may take up to two minutes. ' +
        'Save a session first when the person may want them back. ' +
        MANAGE_NOTE,
      inputSchema: {
        tabIds: tabIds.optional(),
        windowId: z.number().int().optional().describe('Close this whole window instead of single tabs'),
        browser: browserParam,
      },
      annotations: DESTRUCTIVE,
    },
    run('tabs.close', (a) => ({
      tabIds: a.tabIds as number[] | undefined,
      windowId: a.windowId as number | undefined,
    })),
  );

  server.registerTool(
    'tabs_group',
    {
      title: 'Group tabs',
      description:
        'Put tabs into a tab group — a new one, or groupId from tabs_list — and optionally name, colour or collapse it. ' +
        'Chromium and Firefox ≥ 139 have tab groups; elsewhere this answers "unsupported". Pinned tabs cannot be grouped. ' +
        MANAGE_NOTE,
      inputSchema: {
        tabIds,
        groupId: z.number().int().optional().describe('Add to this existing group'),
        title: z.string().max(100).optional(),
        color: z.enum(GROUP_COLORS).optional(),
        collapsed: z.boolean().optional(),
        browser: browserParam,
      },
      annotations: WRITE,
    },
    run('tabs.group', (a) => ({
      tabIds: a.tabIds as number[],
      groupId: a.groupId as number | undefined,
      title: a.title as string | undefined,
      color: a.color as (typeof GROUP_COLORS)[number] | undefined,
      collapsed: a.collapsed as boolean | undefined,
    })),
  );

  server.registerTool(
    'tabs_ungroup',
    {
      title: 'Take tabs out of their group',
      description: 'Remove tabs from their tab group. ' + MANAGE_NOTE,
      inputSchema: { tabIds, browser: browserParam },
      annotations: WRITE,
    },
    run('tabs.ungroup', (a) => ({ tabIds: a.tabIds as number[] })),
  );

  server.registerTool(
    'window_create',
    {
      title: 'Open a new window',
      description:
        'A new window with new tabs (tabs: url + pinned), existing tabs moved into it (tabIds), or both — existing ones first. ' +
        'Every new URL needs level "read" on its site, like tab_open. ' +
        MANAGE_NOTE,
      inputSchema: {
        tabs: z
          .array(z.object({ url: z.string(), pinned: z.boolean().optional() }))
          .optional()
          .describe('New tabs to open, in order'),
        tabIds: tabIds.optional().describe('Existing tabs to move into the new window'),
        browser: browserParam,
      },
      annotations: { ...WRITE, openWorldHint: true },
    },
    run('windows.create', (a) => ({
      tabs: a.tabs as { url: string; pinned?: boolean }[] | undefined,
      tabIds: a.tabIds as number[] | undefined,
    })),
  );

  server.registerTool(
    'sessions_save',
    {
      title: 'Save windows as a session',
      description:
        "Save the person's windows — all, or the given window ids — with tab order, pinned state and tab groups, under a name, in the browser (not on this computer's disk, not with you). " +
        'Saving under an existing name replaces it. Tabs on sites below "read" are saved too; you see them as host only. ' +
        SESSIONS_NOTE,
      inputSchema: {
        name: sessionName,
        windows: z
          .union([z.literal('all'), z.array(z.number().int()).min(1)])
          .optional()
          .describe('"all" (default) or window ids from tabs_list'),
        browser: browserParam,
      },
      annotations: WRITE,
    },
    run('sessions.save', (a) => ({
      name: a.name as string,
      windows: a.windows as 'all' | number[] | undefined,
    })),
  );

  server.registerTool(
    'sessions_list',
    {
      title: 'Saved sessions',
      description:
        'Saved sessions, newest first: name, kind (saved, agent, auto = automatic snapshot), time, window and tab counts, and the tabs. ' +
        'Automatic snapshots come as counts only unless you ask for one by name. Tabs on sites below "read" show their host only. ' +
        SESSIONS_NOTE,
      inputSchema: {
        name: z.string().optional().describe('Only this session, with its tabs'),
        browser: browserParam,
      },
      annotations: READ,
    },
    run('sessions.list', (a) => ({ name: a.name as string | undefined })),
  );

  server.registerTool(
    'sessions_restore',
    {
      title: 'Restore a saved session',
      description:
        "Reopen a saved session: each saved window as a new window (default), or all tabs into the current window. Tabs load lazily where the browser allows. The person's own saved tabs all come back; " +
        'in a session you defined, sites that are no longer at "read" are skipped. ' +
        SESSIONS_NOTE,
      inputSchema: {
        name: sessionName,
        into: z.enum(['new-windows', 'current']).optional(),
        browser: browserParam,
      },
      annotations: WRITE,
    },
    run('sessions.restore', (a) => ({
      name: a.name as string,
      into: a.into as 'new-windows' | 'current' | undefined,
    })),
  );

  server.registerTool(
    'sessions_delete',
    {
      title: 'Delete a saved session',
      description: 'Delete a saved session by name. ' + SESSIONS_NOTE,
      inputSchema: { name: sessionName, browser: browserParam },
      annotations: { ...DESTRUCTIVE, idempotentHint: true },
    },
    run('sessions.delete', (a) => ({ name: a.name as string })),
  );

  server.registerTool(
    'sessions_define',
    {
      title: 'Define a workspace',
      description:
        'Store a session you put together for a task — windows of URLs, pinned or not — to restore later with sessions_restore. ' +
        'Every URL needs level "read" on its site. Pinned tabs are put first in each window. ' +
        SESSIONS_NOTE,
      inputSchema: {
        name: sessionName,
        windows: z
          .array(
            z.object({
              tabs: z.array(z.object({ url: z.string(), pinned: z.boolean().optional() })).min(1),
            }),
          )
          .min(1),
        browser: browserParam,
      },
      annotations: WRITE,
    },
    run('sessions.define', (a) => ({
      name: a.name as string,
      windows: a.windows as { tabs: { url: string; pinned?: boolean }[] }[],
    })),
  );

  server.registerTool(
    'sessions_recently_closed',
    {
      title: 'Recently closed windows and tabs',
      description:
        "The browser's own list of recently closed windows and tabs, newest first, with a sessionId for sessions_restore_closed. " +
        'Tabs on sites below "read" show their host only. ' +
        SESSIONS_NOTE,
      inputSchema: {
        maxResults: z.number().int().min(1).max(25).optional(),
        browser: browserParam,
      },
      annotations: READ,
    },
    run('sessions.recentlyClosed', (a) => ({ maxResults: a.maxResults as number | undefined })),
  );

  server.registerTool(
    'sessions_restore_closed',
    {
      title: 'Reopen a closed window or tab',
      description:
        'Reopen a window or tab from sessions_recently_closed, as the browser remembers it. ' + SESSIONS_NOTE,
      inputSchema: { sessionId: z.string().min(1), browser: browserParam },
      annotations: WRITE,
    },
    run('sessions.restoreClosed', (a) => ({ sessionId: a.sessionId as string })),
  );
}
