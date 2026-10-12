/**
 * "Ask before running scripts", and the warning that stands in front of switching it off
 * (ADR 0016).
 *
 * The switch itself is one `adw-switch-row` like every other switch, and the promise it makes is
 * the one `confirmWrites` makes: ON means the person is asked, and the switch is only shown where a
 * script could run at all. What is not like every other switch is the OFF position: a script can do
 * what a write does and more, so turning asking off is not written the moment it is clicked. The
 * switch snaps back, a warning opens with what the agent would then be able to do unasked, and only
 * "Allow anyway" writes `confirmScripts: false`.
 *
 * Shared by the popup's two rows and by the options page's per-site rows, so the warning a person
 * reads before agreeing to it is the same sentence everywhere it is offered.
 */

import type { Adw } from '@gjsify/adwaita-web';
import { t } from '../i18n.ts';
import { onToggle, setQuietly } from './features.ts';

/** How far the promise reaches, which is what the warning has to say. */
export type ScriptScope = 'site' | 'wide';

export interface ScriptQuietControl {
  /** The row itself: `active` is "ask before running a script". */
  row: Adw.SwitchRow;
  /** The standing note, shown whenever the switch is off. */
  note: Adw.ActionRow;
  /** Show or hide all three. Only where a script could run: feature on, level/grant `write`. */
  setVisible(visible: boolean): void;
  /** Paint the stored value. Never writes it back, and never hides an open warning. */
  render(quiet: boolean): void;
}

const NOTE_KEY: Record<ScriptScope, 'scripts_note_site' | 'scripts_note_wide'> = {
  site: 'scripts_note_site',
  wide: 'scripts_note_wide',
};

const WARNING_KEY: Record<ScriptScope, 'scripts_warning_site' | 'scripts_warning_wide'> = {
  site: 'scripts_warning_site',
  wide: 'scripts_warning_wide',
};

/**
 * Wire one switch to the warning in front of it. `save` is called only with the answer the person
 * gave: `false` from the switch, `true` from "Allow anyway".
 */
export function scriptQuietControl(options: {
  row: Adw.SwitchRow;
  note: Adw.ActionRow;
  /** Where the warning's two buttons go; the note's own row sits next to them. */
  warning: Adw.ActionRow;
  scope: ScriptScope;
  save: (quiet: boolean) => void | Promise<void>;
}): ScriptQuietControl {
  const { row, note, warning, scope, save } = options;
  note.setAttribute('title', t(NOTE_KEY[scope]));
  warning.setAttribute('title', t(WARNING_KEY[scope]));

  const cancel = document.createElement('gtk-button');
  cancel.setAttribute('label', t('action_cancel'));
  cancel.addEventListener('click', () => {
    warning.hidden = true;
    render(false);
  });
  const allow = document.createElement('gtk-button');
  allow.setAttribute('label', t('action_allow_anyway'));
  allow.addEventListener('click', () => {
    warning.hidden = true;
    render(true);
    void save(true);
  });
  warning.append(cancel, allow);

  // OFF is the direction that needs the warning, so the click itself writes nothing: the switch
  // goes back to where it was and the warning opens. "Ask" is the ordinary answer and is stored.
  onToggle(row, (ask) => {
    if (ask) {
      warning.hidden = true;
      render(false);
      void save(false);
      return;
    }
    setQuietly(row, true);
    warning.hidden = false;
  });

  function render(quiet: boolean): void {
    setQuietly(row, !quiet);
    note.hidden = !quiet;
  }

  return {
    row,
    note,
    setVisible: (visible) => {
      row.hidden = !visible;
      if (!visible) {
        note.hidden = true;
        warning.hidden = true;
      }
    },
    render,
  };
}
