import type { Status } from '../bridge-client.ts';

export function describeStatus(status: Status | undefined): string {
  switch (status?.state) {
    case 'connected':
      return `Connected to the bridge on port ${status.port}.`;
    case 'connecting':
      return `Connecting to port ${status.port}…`;
    case 'offline':
      return `No bridge on port ${status.port} — it starts with your agent. Retrying.`;
    case 'unauthorized':
      return 'The bridge refused the pairing token. Paste the current one in the options.';
    case 'protocol':
      return `Bridge and extension do not match: ${status.reason}. Update the older one.`;
    case 'unpaired':
    default:
      return 'Not paired yet — open the options and paste the token from `beifahrer token`.';
  }
}
