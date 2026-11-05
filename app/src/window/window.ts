/**
 * The window: until setup is finished the assistant alone (ADR 0023 § 6), then three pages under a view
 * switcher. Status says what is running; Browser holds the pairing token; Agent holds the snippet that
 * connects a coding agent. The menu runs the assistant again, full window, with Cancel back to the tabs. The only thing the window writes is an agent's MCP config, from Setup, after a
 * confirmation. There is no button here that touches the browser's policy (ADR 0005, ADR 0017).
 *
 * Plain Adw/Gtk widgets from the GNOME HIG: `Adw.ViewStack` with an `Adw.ViewSwitcher` in the header,
 * an `Adw.StatusPage` for the state, `Adw.PreferencesGroup`s of rows for the lists, and an
 * `Adw.ToastOverlay` for "copied".
 */

import Adw from 'gi://Adw?version=1';
import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';

import { agentCommands } from '../frontends/cli/install.ts';
import { createAgentsPage } from './agents-page.ts';
import { createDiagram } from './diagram-widget.ts';
import type { DiagramAction, DiagramView } from './diagram-model.ts';
import type { Translate } from './i18n.ts';
import type { BrowserRow } from './browser-model.ts';
import { createPairingPage } from './pairing-page.ts';
import type { PairingView } from './pairing-model.ts';
import type { SafariView } from './safari-model.ts';
import { createSetupPage } from './setup-page.ts';
import { startView } from './setup-state-model.ts';
import type { StatusView } from './status-model.ts';

export interface DesktopWindow {
  window: Adw.ApplicationWindow;
  showStatus(view: StatusView, diagram: DiagramView): void;
  showPairing(view: PairingView): void;
  showBrowsers(rows: readonly BrowserRow[]): void;
  showSafari(view: SafariView): void;
  /** Setup is finished: remember it (once) and show the tabs. */
  onSetupFinished(): void;
  /** A message in the window's toast overlay. */
  toast(title: string, timeout?: number): void;
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

function createStatusPage(t: Translate, onAction: (id: DiagramAction) => void) {
  const diagram = createDiagram(t, onAction);
  // Text first, so it is read before the picture and says what the picture is for; the diagram gets
  // air on both sides (24 margin + 12 spacing = 36 px) instead of sitting against the sentence.
  diagram.widget.set_margin_top(24);
  diagram.widget.set_margin_bottom(24);
  const heading = new Gtk.Label({ wrap: true, justify: Gtk.Justification.CENTER });
  heading.add_css_class('title-1');
  const body = new Gtk.Label({ wrap: true, justify: Gtk.Justification.CENTER });
  const status = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 12 });
  for (const w of [heading, body, diagram.widget, diagram.fix]) status.append(w);
  const group = new Adw.PreferencesGroup({ title: t('sessions.title') });
  const warnings = new Adw.PreferencesGroup({ visible: false });
  const note = new Gtk.Label({ wrap: true, xalign: 0, visible: false });
  note.add_css_class('dim-label');

  const column = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 24 });
  column.append(status);
  column.append(warnings);
  column.append(group);
  column.append(note);

  const widget = clamped(column) as Gtk.ScrolledWindow;
  let rows: Adw.ActionRow[] = [];
  let warningRows: Adw.ActionRow[] = [];
  return {
    widget,
    setVertical(vertical: boolean) {
      diagram.setVertical(vertical);
      // After the new arrangement is measured: the old scroll offset belongs to the other one.
      GLib.idle_add(GLib.PRIORITY_LOW, () => {
        widget.get_vadjustment().set_value(0);
        return GLib.SOURCE_REMOVE;
      });
    },
    show(view: StatusView, picture: DiagramView) {
      diagram.show(picture);
      heading.set_label(view.title);
      // The fix sentence already says what to do; the page's own sentence would say it twice.
      body.set_label(view.description);
      body.set_visible(picture.fix === null);
      for (const row of rows) group.remove(row);
      rows = view.sessions.map(
        (s) => new Adw.ActionRow({ title: s.title, subtitle: s.subtitle, focusable: false }),
      );
      for (const row of rows) group.add(row);
      group.set_visible(rows.length > 0);
      for (const row of warningRows) warnings.remove(row);
      warningRows = view.warnings.map((w) => {
        const row = new Adw.ActionRow({ title: w.title, subtitle: w.description, focusable: false });
        row.add_prefix(new Gtk.Image({ iconName: 'dialog-warning-symbolic' }));
        return row;
      });
      for (const row of warningRows) warnings.add(row);
      warnings.set_visible(warningRows.length > 0);
      note.set_label(view.note ?? '');
      note.set_visible(view.note !== null);
    },
  };
}

/** `preferences`: the menu offers Preferences; only where there is a setting in them (autostart). */
export function createWindow(
  app: Adw.Application,
  t: Translate,
  preferences = false,
  /** The stored flag; `markDone` stores it. */
  setupDone = false,
  markDone: () => void = () => {},
  /** Must only ever run from the Safari row's own button click (ADR 0026 § 4). */
  onOpenSafariSettings: () => void = () => {},
): DesktopWindow {
  const overlay = new Adw.ToastOverlay();
  let onDiagramAction: (id: DiagramAction) => void = () => {};
  const statusPage = createStatusPage(t, (id) => onDiagramAction(id));
  const toast = (title: string, timeout = 2) => overlay.add_toast(new Adw.Toast({ title, timeout }));
  const pairingPage = createPairingPage(t, toast, onOpenSafariSettings);
  const agentsPage = createAgentsPage(t, toast);

  const stack = new Adw.ViewStack();
  // A page without an icon name is drawn with `image-missing` in the switcher, so each one names one.
  stack.add_titled_with_icon(
    statusPage.widget,
    'status',
    t('page.status'),
    'network-transmit-receive-symbolic',
  );
  stack.add_titled_with_icon(pairingPage.widget, 'browser', t('page.browser'), 'web-browser-symbolic');
  stack.add_titled_with_icon(agentsPage.widget, 'agent', t('page.agent'), 'utilities-terminal-symbolic');
  stack.set_visible_child_name('status');

  // The assistant takes the whole window while setup is open: no tabs, only title and menu. The stored
  // flag is the signal; an agent's config naming Beifahrer is a hint where those files are readable.
  let agentConfigured = false;
  try {
    agentConfigured = agentCommands().length > 0;
  } catch {
    agentConfigured = false;
  }
  let finished = startView(setupDone, agentConfigured) === 'tabs';

  const root = new Gtk.Stack();
  const switcher = new Adw.ViewSwitcher({ stack, policy: Adw.ViewSwitcherPolicy.WIDE });
  // Narrow: the tabs move from the header to a bar at the bottom, where three names fit (GNOME HIG).
  const switcherBar = new Adw.ViewSwitcherBar({ stack, reveal: false });
  let narrowNow = false;
  const syncBar = () => {
    switcher.set_visible(!narrowNow);
    switcherBar.set_reveal(narrowNow && root.get_visible_child_name() === 'tabs');
  };
  const plainTitle = new Adw.WindowTitle({ title: t('app.title'), subtitle: '' });
  const header = new Adw.HeaderBar();
  const cancel = Gtk.Button.new_with_label(t('setup.cancel'));
  header.pack_start(cancel);

  const showTabs = () => {
    root.set_visible_child_name('tabs');
    header.set_title_widget(switcher);
    cancel.set_visible(false);
    syncBar();
  };
  const showSetup = () => {
    root.set_visible_child_name('setup');
    header.set_title_widget(plainTitle);
    // Cancel only where there is something to go back to.
    cancel.set_visible(finished);
    syncBar();
  };
  const setupPage = createSetupPage(t, toast, () => {
    finished = true;
    markDone();
    stack.set_visible_child_name('status');
    showTabs();
  });
  root.add_named(setupPage.widget, 'setup');
  root.add_named(stack, 'tabs');
  cancel.connect('clicked', showTabs);
  if (finished) showTabs();
  else showSetup();

  const menu = new Gio.Menu();
  menu.append(t('menu.setup'), 'app.setup');
  if (preferences) menu.append(t('menu.preferences'), 'app.preferences');
  menu.append(t('menu.about'), 'app.about');
  menu.append(t('menu.quit'), 'app.quit');
  header.pack_end(new Gtk.MenuButton({ iconName: 'open-menu-symbolic', menuModel: menu, primary: true }));
  const setupAction = new Gio.SimpleAction({ name: 'setup' });
  setupAction.connect('activate', () => {
    setupPage.reset();
    showSetup();
  });
  app.add_action(setupAction);
  onDiagramAction = (id) => {
    if (id === 'setup') setupAction.activate(null);
    else stack.set_visible_child_name('browser');
  };

  const toolbar = new Adw.ToolbarView();
  toolbar.add_top_bar(header);
  toolbar.set_content(root);
  toolbar.add_bottom_bar(switcherBar);
  overlay.set_child(toolbar);

  const window = new Adw.ApplicationWindow({
    application: app,
    title: t('app.title'),
    defaultWidth: 680,
    defaultHeight: 640,
    widthRequest: 360,
  });
  window.set_content(overlay);
  // Below 420sp the three nodes no longer fit side by side with their words (ADR 0025 § 7a).
  const narrow = new Adw.Breakpoint({ condition: Adw.BreakpointCondition.parse('max-width: 420sp') });
  narrow.connect('apply', () => {
    statusPage.setVertical(true);
    narrowNow = true;
    syncBar();
  });
  narrow.connect('unapply', () => {
    statusPage.setVertical(false);
    narrowNow = false;
    syncBar();
  });
  window.add_breakpoint(narrow);

  return {
    window,
    showStatus: statusPage.show,
    showPairing(view) {
      pairingPage.show(view);
      setupPage.showPairing(view);
    },
    showBrowsers(rows) {
      pairingPage.showBrowsers(rows);
      setupPage.showBrowsers(rows);
    },
    showSafari: pairingPage.showSafari,
    onSetupFinished() {
      if (finished) return;
      finished = true;
      markDone();
      showTabs();
    },
    toast,
    copyToken: pairingPage.copyToken,
  };
}
