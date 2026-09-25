/** Which symbolic icon stands for what, shared by popup and options so they never disagree. */

import { FEATURE_OF, type Feature, type Method } from '@beifahrer/core';

export const FEATURE_ICON: Record<Feature, string> = {
  tabs: 'view-paged-symbolic',
  read: 'format-justify-left-symbolic',
  outline: 'system-search-symbolic',
  screenshot: 'camera-photo-symbolic',
  fill: 'insert-text-symbolic',
  click: 'input-mouse-symbolic',
  open: 'tab-new-symbolic',
  manageTabs: 'view-grid-symbolic',
  sessions: 'document-save-symbolic',
};

/** An activity entry shows the icon of the feature its method belongs to. */
export const methodIcon = (method: Method): string => FEATURE_ICON[FEATURE_OF[method]];
