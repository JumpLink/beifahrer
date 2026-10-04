/**
 * The status window: the registry's state in words, and the live sessions under it. A view only;
 * there is no button here that touches the browser's policy (ADR 0005, ADR 0017).
 *
 * Plain Adw/Gtk widgets from the GNOME HIG: a header bar, an `Adw.StatusPage` for the state and an
 * `Adw.PreferencesGroup` of `Adw.ActionRow`s for the sessions. The nav shell of `@gjsify/adwaita-app`
 * joins when a second page does.
 */

import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';

import type { Translate } from './i18n.ts';
import type { StatusView } from './status-model.ts';

export interface StatusWindow {
  window: Adw.ApplicationWindow;
  show(view: StatusView): void;
}

export function createStatusWindow(app: Adw.Application, t: Translate): StatusWindow {
  const status = new Adw.StatusPage({ vexpand: false });
  const group = new Adw.PreferencesGroup({ title: t('sessions.title') });
  const note = new Gtk.Label({ wrap: true, xalign: 0, visible: false });
  note.add_css_class('dim-label');

  const column = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 24 });
  column.append(status);
  column.append(group);
  column.append(note);

  const clamp = new Adw.Clamp({
    maximumSize: 640,
    marginTop: 12,
    marginBottom: 24,
    marginStart: 12,
    marginEnd: 12,
  });
  clamp.set_child(column);
  const scroller = new Gtk.ScrolledWindow({ hscrollbarPolicy: Gtk.PolicyType.NEVER, vexpand: true });
  scroller.set_child(clamp);

  const toolbar = new Adw.ToolbarView();
  toolbar.add_top_bar(
    new Adw.HeaderBar({
      titleWidget: new Adw.WindowTitle({ title: t('app.title'), subtitle: t('status.title') }),
    }),
  );
  toolbar.set_content(scroller);

  const window = new Adw.ApplicationWindow({
    application: app,
    title: t('app.title'),
    defaultWidth: 520,
    defaultHeight: 560,
  });
  window.set_content(toolbar);

  let rows: Adw.ActionRow[] = [];
  return {
    window,
    show(view) {
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
