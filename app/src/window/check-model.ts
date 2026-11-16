/**
 * What the "Check connection" row says (ADR 0017 § 7). Pure: a state in, words and an icon out, so
 * every outcome is tested without a display.
 *
 * A refusal is an answer: the browser replied and said no. It is shown as such and never worked
 * around, and it never offers to lift the refusal (ADR 0005: only the person resumes, in the browser).
 */

import type { Translate } from './i18n.ts';

export type Refusal = 'paused' | 'feature_disabled' | 'refused';

/** The outcome of one check. `browsers` are the names the browsers gave, "Firefox 155.0". */
export type CheckResult =
  | { kind: 'answered'; browsers: string[]; tabs: number }
  | { kind: 'refused'; reason: Refusal; browsers: string[] }
  | { kind: 'nobrowser' }
  | { kind: 'failed'; reason: string };

export type CheckState = { kind: 'idle' } | { kind: 'running' } | CheckResult;

export interface CheckView {
  title: string;
  subtitle: string;
  button: string;
  /** A check is under way: the button is off and a spinner shows. */
  busy: boolean;
  /** Icon name beside the title, or null. The words carry the meaning; the icon only backs them. */
  icon: string | null;
}

export function checkView(state: CheckState, t: Translate): CheckView {
  const base = { title: t('check.title'), button: t('check.button'), busy: false, icon: null };
  switch (state.kind) {
    case 'idle':
      return { ...base, subtitle: t('check.idle'), icon: null };
    case 'running':
      return { ...base, subtitle: t('check.running'), busy: true };
    case 'answered':
      return {
        ...base,
        button: t('check.again'),
        icon: 'emblem-ok-symbolic',
        subtitle: t(state.tabs === 1 ? 'check.answered.one' : 'check.answered.many', {
          browser: state.browsers.join(', '),
          count: state.tabs,
        }),
      };
    case 'refused':
      return {
        ...base,
        button: t('check.again'),
        icon: 'dialog-warning-symbolic',
        subtitle: t(`check.refused.${state.reason}`, { browser: state.browsers.join(', ') }),
      };
    case 'nobrowser':
      return {
        ...base,
        button: t('check.again'),
        icon: 'dialog-warning-symbolic',
        subtitle: t('check.nobrowser'),
      };
    case 'failed':
      return {
        ...base,
        button: t('check.again'),
        icon: 'dialog-warning-symbolic',
        subtitle: t('check.failed', { reason: state.reason }),
      };
  }
}
