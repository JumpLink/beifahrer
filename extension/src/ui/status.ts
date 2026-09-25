import { describeRange } from '@beifahrer/core';
import type { Status } from '../bridge-client.ts';
import { t } from '../i18n.ts';

export function describeStatus(status: Status | undefined): string {
  switch (status?.state) {
    case 'connected': {
      const n = status.sessions.length;
      const range = describeRange(status.range);
      return n === 1 ? t('status_connected_one', range) : t('status_connected_other', n, range);
    }
    case 'offline':
      return t('status_offline', describeRange(status.range));
    case 'unauthorized':
      return t('status_unauthorized');
    case 'protocol':
      return status.detail ? t('status_protocol_detail', status.detail) : t('status_protocol');
    case 'unpaired':
    default:
      return t('status_unpaired');
  }
}
