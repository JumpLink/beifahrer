/**
 * The window: two pages under a view switcher. Status says what is running; Browser holds the pairing
 * token. A view only; there is no button here that touches the browser's policy (ADR 0005, ADR 0017).
 *
 * Plain Adw/Gtk widgets from the GNOME HIG: `Adw.ViewStack` with an `Adw.ViewSwitcher` in the header,
 * an `Adw.StatusPage` for the state, `Adw.PreferencesGroup`s of rows for the lists, and an
 * `Adw.ToastOverlay` for "copied".
 */

import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';

import type { Translate } from './i18n.ts';
import { createPairingPage } from './pairing-page.ts';
import type { PairingView } from './pairing-model.ts';
import type { StatusView } from './status-model.ts';

export interface DesktopWindow {
  window: Adw.ApplicationWindow;
  showStatus(view: StatusView): void;
  showPairing(view: PairingView): void;
  copyToken(): boolean;
}

/** A page's content: centred, at a readable width, scrolling when the window is short. */
export function clamped(child: Gtk.Widget): Gtk.Widget {
  const clamp = new Adw.Clamp({
    maximumSize: 640,
    marginTop: 12,
    marginBottom: 24,
    marginStart: 12,
    marginEnd: 12,
  });
  clamp.set_child(child);
  const scroller = new Gtk.ScrolledWindow({ hscrollbarPolicy: Gtk.PolicyType.NEVER, vexpand: true });
  scroller.set_child(clamp);
  return scroller;
}

function createStatusPage(t: Translate) {
  const status = new Adw.StatusPage({ vexpand: false });
  const group = new Adw.PreferencesGroup({ title: t('sessions.title') });
  const note = new Gtk.Label({ wrap: true, xalign: 0, visible: false });
  note.add_css_class('dim-label');

  const column = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 24 });
  column.append(status);
  column.append(group);
  column.append(note);

  let rows: Adw.ActionRow[] = [];
  return {
    widget: clamped(column),
    show(view: StatusView) {
      status.set_icon_name(view.icon);
      status.set_title(view.title);
      status.set_description(view.description);
      for (const row of rows) group.remove(row);
      rows = view.sessions.map((s) => new Adw.ActionRow({ title: s.title, subtitle: s.subtitle }));
      for (const row of rows) group.add(row);
      group.set_visible(rows.length > 0);
      note.set_label(view.note ?? '');
      note.set_visible(view.note !== null);
    },
  };
}

export function createWindow(app: Adw.Application, t: Translate): DesktopWindow {
  const overlay = new Adw.ToastOverlay();
  const statusPage = createStatusPage(t);
  const pairingPage = createPairingPage(t, (title) =>
    overlay.add_toast(new Adw.Toast({ title, timeout: 2 })),
  );

  const stack = new Adw.ViewStack();
  stack.add_titled(statusPage.widget, 'status', t('page.status'));
  stack.add_titled(pairingPage.widget, 'browser', t('page.browser'));

  const toolbar = new Adw.ToolbarView();
  toolbar.add_top_bar(
    new Adw.HeaderBar({
      titleWidget: new Adw.ViewSwitcher({ stack, policy: Adw.ViewSwitcherPolicy.WIDE }),
    }),
  );
  toolbar.set_content(stack);
  overlay.set_child(toolbar);

  const window = new Adw.ApplicationWindow({
    application: app,
    title: t('app.title'),
    defaultWidth: 520,
    defaultHeight: 560,
  });
  window.set_content(overlay);

  return {
    window,
    showStatus: statusPage.show,
    showPairing: pairingPage.show,
    copyToken: pairingPage.copyToken,
  };
}
