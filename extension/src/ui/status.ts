import { describeRange } from '@beifahrer/core';
import type { Status } from '../bridge-client.ts';

export function describeStatus(status: Status | undefined): string {
  switch (status?.state) {
    case 'connected': {
      const n = status.sessions.length;
      return `Connected to ${n} agent session${n === 1 ? '' : 's'} (ports ${describeRange(status.range)}).`;
    }
    case 'offline':
      return `No agent session on ports ${describeRange(status.range)} — each starts with your agent. Looking every few seconds.`;
    case 'unauthorized':
      return 'An agent session refused the pairing token. Paste the current one in the options.';
    case 'protocol':
      return `An agent session and the extension do not match${status.detail ? `: ${status.detail}` : ''}. Update the older one.`;
    case 'unpaired':
    default:
      return 'Not paired yet — open the options and paste the token from `beifahrer token`.';
  }
}
