/**
 * Turn a browser tab into what the agent is allowed to see of it.
 *
 * Listing tabs needs no level — "which tabs are open" is the first thing an agent asks, and a
 * refusal there makes the whole tool useless. What protects the person is that a tab on an origin
 * below `read` shows up as its HOST ONLY: no path, no query, no title. A bank's tab stays "a tab
 * on the bank", never "Kontoauszug März — Kontostand …".
 */

import { levelFor, originOf, type Policy } from './policy.ts';
import type { TabInfo } from './protocol.ts';

export interface RawTab {
  id?: number;
  windowId?: number;
  active?: boolean;
  url?: string;
  title?: string;
  index?: number;
  pinned?: boolean;
  groupId?: number;
}

export function hostOf(url: string | undefined | null): string | null {
  const origin = originOf(url);
  return origin ? new URL(origin).host : null;
}

export function toTabInfo(tab: RawTab, policy: Policy, focusedWindowId: number | null): TabInfo | null {
  if (typeof tab.id !== 'number' || typeof tab.windowId !== 'number') return null;
  const level = levelFor(policy, tab.url);
  const info: TabInfo = {
    tabId: tab.id,
    windowId: tab.windowId,
    active: tab.active === true,
    focusedWindow: focusedWindowId !== null && tab.windowId === focusedWindowId,
    host: hostOf(tab.url),
    level,
  };
  // Position, pin and group say nothing about a page's content; the agent needs them to sort.
  if (typeof tab.index === 'number') info.index = tab.index;
  if (typeof tab.pinned === 'boolean') info.pinned = tab.pinned;
  if (typeof tab.groupId === 'number' && tab.groupId >= 0) info.groupId = tab.groupId;
  if (level !== 'none') {
    info.url = tab.url;
    info.title = tab.title ?? '';
  }
  return info;
}
