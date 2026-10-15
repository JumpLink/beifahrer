/**
 * What became of a file the BROWSER saved on its own (issue #126, #127).
 *
 * `page.capture` can only hand over bytes the page lets it fetch. When the click makes the browser
 * save a file itself, the extension watches that download through `downloads.onChanged` and reports
 * its end here: where the file is, how big, and whether it finished.
 *
 * The "ask where to save" dialog (#127) is not reported by any event. Measured: Chromium creates the
 * item and leaves `filename` empty while the dialog is open (a headless one cancels it with
 * `USER_CANCELED`), Firefox creates no item at all until the person answers. So an item that is still
 * running without a filename after the wait is the dialog, and no item at all is only a suspicion.
 */

export type DownloadEndState = 'complete' | 'interrupted' | 'timeout' | 'dialog';

export interface DownloadOutcome {
  state: DownloadEndState;
  /** Where the browser wrote the file; empty while no file name was chosen. */
  path: string;
  /** Bytes on disk, or received so far. */
  bytes: number;
  mime: string;
  /** Why it did not complete, in words for the agent. */
  reason?: string;
}

export interface DownloadSnapshot {
  state?: string;
  filename?: string;
  bytesReceived?: number;
  fileSize?: number;
  error?: string | null;
  mime?: string;
}

const REASONS: Record<string, string> = {
  USER_CANCELED:
    'the download was cancelled: by the person, or because the browser is set to ask where to save and no one answered the dialog',
  USER_SHUTDOWN: 'the browser shut down during the download',
  FILE_ACCESS_DENIED: 'the browser may not write to its downloads folder',
  FILE_NO_SPACE: 'the disk is full',
  FILE_NAME_TOO_LONG: 'the file name is too long',
  SERVER_FORBIDDEN: 'the server refused the download (403)',
  SERVER_UNAUTHORIZED: 'the server wants a login (401)',
  SERVER_BAD_CONTENT: 'the server does not have the file',
  NETWORK_FAILED: 'the network failed during the download',
  NETWORK_TIMEOUT: 'the network timed out during the download',
  NETWORK_DISCONNECTED: 'the network disconnected during the download',
};

export function describeDownloadError(code: string): string {
  return REASONS[code] ?? `the browser reported ${code}`;
}

/**
 * The outcome for the last thing the browser said. `timedOut` says the wait ran out while the
 * download was still unfinished, which is when a still-running item without a name means the dialog.
 */
export function describeDownload(item: DownloadSnapshot | undefined, timedOut: boolean): DownloadOutcome {
  if (!item) {
    return {
      state: 'timeout',
      path: '',
      bytes: 0,
      mime: '',
      reason:
        'the browser reported no download. If it is set to ask where to save, its dialog may still be open: ' +
        'only the person can answer it',
    };
  }
  const path = item.filename ?? '';
  const bytes = Math.max(item.fileSize ?? 0, item.bytesReceived ?? 0, 0);
  const mime = item.mime ?? '';
  if (item.state === 'complete') return { state: 'complete', path, bytes, mime };
  if (item.state === 'interrupted') {
    return {
      state: 'interrupted',
      path,
      bytes,
      mime,
      reason: describeDownloadError(item.error ?? 'unknown'),
    };
  }
  if (!timedOut) return { state: 'timeout', path, bytes, mime };
  return path === ''
    ? {
        state: 'dialog',
        path,
        bytes,
        mime,
        reason:
          'the browser has not chosen a file name: it is asking the person where to save. ' +
          'Only the person can answer; the download starts when they do. Do not click again',
      }
    : { state: 'timeout', path, bytes, mime, reason: 'the download was still running when the wait ended' };
}
