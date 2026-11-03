/**
 * The connection diagram of ADR 0025 as a widget: the shared artwork as one picture, the words in GTK
 * around it. The SVG holds no text, so the labels come out of the window's own catalogue and follow
 * its font and language; the picture only changes by the class list on its root (see `prepareSvg`).
 *
 * Two arrangements, one breakpoint (ADR 0025 § 7a): the horizontal chain labels its nodes in the row
 * under the picture, the vertical one in a column beside it. Both are `Gtk.Grid`s whose cells are
 * counted in the artwork's own units (24 per column, 10 per row), so a label sits under the node it
 * names without measuring anything.
 */

import Adw from 'gi://Adw?version=1';
import Gdk from 'gi://Gdk?version=4.0';
import GLib from 'gi://GLib?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';

import assets from './diagram-assets.json' with { type: 'json' };
import {
  prepareSvg,
  type DiagramAction,
  type DiagramView,
  type LinkState,
  type NodeLabels,
} from './diagram-model.ts';
import type { Translate } from './i18n.ts';

const CSS = `
.diagram-pill { background: alpha(@accent_bg_color, 0.22); color: @accent_color; border-radius: 99px;
  padding: 1px 10px; font-size: small; font-weight: bold; }
.diagram-gone { opacity: 0.35; font-style: italic; }
`;
let styled = false;
function installStyle() {
  if (styled) return;
  const display = Gdk.Display.get_default();
  if (!display) return;
  const css = new Gtk.CssProvider();
  css.load_from_string(CSS);
  Gtk.StyleContext.add_provider_for_display(display, css, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
  styled = true;
}

const LINK_CLASS: Record<LinkState, string> = {
  ok: 'success',
  wait: 'warning',
  fail: 'error',
  unknown: 'dim-label',
};

function label(text: string, classes: string[], align: Gtk.Align): Gtk.Label {
  const l = new Gtk.Label({ label: text, wrap: true, maxWidthChars: 20, halign: align, xalign: 0.5 });
  if (align === Gtk.Align.START) l.set_xalign(0);
  for (const c of classes) l.add_css_class(c);
  return l;
}

function clear(box: Gtk.Box) {
  let child = box.get_first_child();
  while (child) {
    box.remove(child);
    child = box.get_first_child();
  }
}

interface Arrangement {
  widget: Gtk.Widget;
  picture: Gtk.Picture;
  show(view: DiagramView, t: Translate): void;
}

function arrange(vertical: boolean): Arrangement {
  const align = vertical ? Gtk.Align.START : Gtk.Align.CENTER;
  const picture = new Gtk.Picture({ canShrink: true });
  const box = () =>
    new Gtk.Box({
      orientation: Gtk.Orientation.VERTICAL,
      spacing: 2,
      valign: Gtk.Align.CENTER,
      hexpand: true,
    });
  const nodes = { app: box(), beifahrer: box(), browser: box() };
  const links = { link1: box(), link2: box() };

  const grid = new Gtk.Grid({
    columnHomogeneous: !vertical,
    rowHomogeneous: vertical,
    rowSpacing: vertical ? 0 : 6,
  });
  if (vertical) {
    picture.set_size_request(140, 490);
    picture.set_halign(Gtk.Align.START);
    picture.set_valign(Gtk.Align.START);
    grid.set_column_spacing(12);
    grid.attach(picture, 0, 0, 1, 49);
    grid.attach(nodes.app, 1, 0, 1, 11);
    grid.attach(links.link1, 1, 11, 1, 8);
    grid.attach(nodes.beifahrer, 1, 19, 1, 11);
    grid.attach(links.link2, 1, 30, 1, 9);
    grid.attach(nodes.browser, 1, 39, 1, 10);
  } else {
    grid.attach(picture, 0, 0, 25, 1);
    grid.attach(nodes.app, 0, 1, 6, 1);
    grid.attach(links.link1, 6, 1, 4, 1);
    grid.attach(nodes.beifahrer, 10, 1, 5, 1);
    grid.attach(links.link2, 15, 1, 4, 1);
    grid.attach(nodes.browser, 19, 1, 6, 1);
  }

  const fillNode = (target: Gtk.Box, name: string, n: NodeLabels, pill: string | null) => {
    clear(target);
    for (const text of n.names.length > 0 ? n.names : [name]) target.append(label(text, ['heading'], align));
    if (n.gone) target.append(label(n.gone, ['diagram-gone'], align));
    if (n.more) target.append(label(n.more, ['dim-label', 'caption'], align));
    if (n.caption) target.append(label(n.caption, ['dim-label', 'caption'], align));
    if (pill) target.append(label(pill, ['diagram-pill'], align));
  };
  const fillLink = (target: Gtk.Box, state: LinkState, text: string) => {
    clear(target);
    target.append(label(text, ['caption', LINK_CLASS[state]], align));
  };

  return {
    widget: grid,
    picture,
    show(view, t) {
      fillNode(nodes.app, t('diagram.node.app'), view.app, null);
      fillNode(
        nodes.beifahrer,
        t('diagram.node.beifahrer'),
        { names: [], gone: null, more: null, caption: null },
        t('diagram.here.window'),
      );
      fillNode(nodes.browser, t('diagram.node.browser'), view.browser, null);
      fillLink(links.link1, view.link1, view.captions.link1);
      fillLink(links.link2, view.link2, view.captions.link2);
    },
  };
}

export interface Diagram {
  widget: Gtk.Widget;
  show(view: DiagramView): void;
  /** The 420sp breakpoint: the vertical arrangement. */
  setVertical(vertical: boolean): void;
}

/** `onAction`: the button under a failing link was pressed. */
export function createDiagram(t: Translate, onAction: (id: DiagramAction) => void): Diagram {
  installStyle();
  const horizontal = arrange(false);
  const vertical = arrange(true);
  const stack = new Gtk.Stack({ hhomogeneous: false, vhomogeneous: false });
  stack.add_named(horizontal.widget, 'horizontal');
  stack.add_named(vertical.widget, 'vertical');

  const sentence = new Gtk.Label({ wrap: true, justify: Gtk.Justification.CENTER, visible: false });
  const button = new Gtk.Button({ halign: Gtk.Align.CENTER, visible: false });
  button.add_css_class('pill');
  let action: DiagramAction | null = null;
  button.connect('clicked', () => {
    if (action) onAction(action);
  });

  const widget = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 12 });
  widget.append(stack);
  widget.append(sentence);
  widget.append(button);

  const style = Adw.StyleManager.get_default();
  let last: DiagramView | null = null;
  const draw = () => {
    if (!last) return;
    for (const [arrangement, source] of [
      [horizontal, assets.horizontal],
      [vertical, assets.vertical],
    ] as const) {
      try {
        const svg = prepareSvg(source, last.classes, style.get_dark());
        arrangement.picture.set_paintable(
          Gdk.Texture.new_from_bytes(new GLib.Bytes(new TextEncoder().encode(svg))),
        );
      } catch {
        arrangement.picture.set_paintable(null);
      }
    }
  };
  style.connect('notify::dark', draw);

  return {
    widget,
    show(view) {
      last = view;
      horizontal.show(view, t);
      vertical.show(view, t);
      draw();
      sentence.set_label(view.fix?.sentence ?? '');
      sentence.set_visible(view.fix !== null);
      action = view.fix?.action?.id ?? null;
      button.set_label(view.fix?.action?.label ?? '');
      button.set_visible(action !== null);
    },
    setVertical(v) {
      stack.set_visible_child_name(v ? 'vertical' : 'horizontal');
    },
  };
}
