/**
 * What the Browser page shows: the token to paste into each browser's extension, where it lives, and
 * a warning when a SECOND token file exists with another token in it. Pure, like `status-model.ts`.
 *
 * The token is a secret that stays on this machine. It is shown masked by default (the row's own
 * reveal button) and copied on request; it is not logged, and nothing else here ever holds it.
 */

import type { PairingInfo } from '@beifahrer/local';

import type { Translate } from './i18n.ts';

export interface PairingView {
  /** Null when it could not be read: the page then shows `error` and nothing to copy. */
  token: string | null;
  path: string | null;
  error: string | null;
  /** Zero or one: a token file that would NOT pair the browsers the window's token pairs. */
  warnings: { title: string; description: string }[];
}

export function pairingView(info: PairingInfo | Error, t: Translate): PairingView {
  if (info instanceof Error) {
    return { token: null, path: null, error: t('pairing.error', { reason: info.message }), warnings: [] };
  }
  return {
    token: info.token,
    path: info.path,
    error: null,
    warnings: info.other
      ? [
          {
            title: t('pairing.other.title'),
            description: t('pairing.other.description', { path: info.other }),
          },
        ]
      : [],
  };
}
