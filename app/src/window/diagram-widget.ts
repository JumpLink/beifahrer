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
import Pango from 'gi://Pango?version=1.0';

import assets from './diagram-assets.json' with { type: 'json' };
import {
  prepareSvg,
  splitName,
  VERTICAL_CELLS,
  VERTICAL_UNIT,
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

/** A name or a word under a node: one line, ellipsized, the full text in the tooltip. */
function label(text: string, classes: string[], align: Gtk.Align): Gtk.Label {
  const l = new Gtk.Label({
    label: text,
    ellipsize: Pango.EllipsizeMode.END,
    maxWidthChars: 18,
    halign: align,
    xalign: align === Gtk.Align.START ? 0 : 0.5,
    tooltipText: text,
  });
  for (const c of classes) l.add_css_class(c);
  return l;
}

/** The word under a link: it may wrap, but never in the middle of "Nicht verbunden" when there is room. */
function linkLabel(text: string, classes: string[], align: Gtk.Align): Gtk.Label {
  const l = new Gtk.Label({
    label: text,
    wrap: true,
    maxWidthChars: 24,
    halign: align,
    justify: align === Gtk.Align.START ? Gtk.Justification.LEFT : Gtk.Justification.CENTER,
    xalign: align === Gtk.Align.START ? 0 : 0.5,
  });
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

/** A cell of the vertical column: a fixed height in the artwork's units, its content centred in it. */
function cell(content: Gtk.Widget, units: number): Gtk.Widget {
  content.set_valign(Gtk.Align.CENTER);
  const box = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, hexpand: true });
  box.set_size_request(-1, units * VERTICAL_UNIT);
  box.append(content);
  return box;
}

function arrange(vertical: boolean): Arrangement {
  const align = vertical ? Gtk.Align.START : Gtk.Align.CENTER;
  const picture = new Gtk.Picture({ canShrink: true });
  const box = () =>
    new Gtk.Box({
      orientation: Gtk.Orientation.VERTICAL,
      spacing: 2,
      valign: vertical ? Gtk.Align.CENTER : Gtk.Align.START,
      hexpand: true,
    });
  const nodes = { app: box(), beifahrer: box(), browser: box() };
  const links = { link1: box(), link2: box() };

  let widget: Gtk.Widget;
  if (vertical) {
    picture.set_size_request(140, VERTICAL_CELLS.reduce((a, b) => a + b, 0) * VERTICAL_UNIT);
    picture.set_halign(Gtk.Align.START);
    picture.set_valign(Gtk.Align.START);
    const column = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, hexpand: true });
    [nodes.app, links.link1, nodes.beifahrer, links.link2, nodes.browser].forEach((content, i) =>
      column.append(cell(content, VERTICAL_CELLS[i]!)),
    );
    const row = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 12 });
    // A picture's natural width is its texture's (2x); the clamp keeps the row from handing it that.
    const clamp = new Adw.Clamp({ maximumSize: 140, tighteningThreshold: 140, halign: Gtk.Align.START });
    clamp.set_child(picture);
    row.append(clamp);
    row.append(column);
    widget = row;
  } else {
    // Link cells are wider than the gap between the nodes: their words are short and centred on the link.
    const grid = new Gtk.Grid({ columnHomogeneous: true, rowSpacing: 6 });
    grid.attach(picture, 0, 0, 25, 1);
    grid.attach(nodes.app, 0, 1, 6, 1);
    grid.attach(links.link1, 5, 1, 6, 1);
    grid.attach(nodes.beifahrer, 10, 1, 5, 1);
    grid.attach(links.link2, 14, 1, 6, 1);
    grid.attach(nodes.browser, 19, 1, 6, 1);
    widget = grid;
  }

  const fillNode = (target: Gtk.Box, name: string, n: NodeLabels, pill: string | null) => {
    clear(target);
    for (const text of n.names.length > 0 ? n.names : [name]) {
      const { main, rest } = splitName(text);
      target.append(label(main, ['heading'], align));
      if (rest !== null) target.append(label(rest, ['dim-label', 'caption'], align));
    }
    if (n.gone) target.append(label(n.gone, ['diagram-gone'], align));
    if (n.more) target.append(label(n.more, ['dim-label', 'caption'], align));
    if (n.caption) target.append(label(n.caption, ['dim-label', 'caption'], align));
    if (pill) target.append(label(pill, ['diagram-pill'], align));
  };
  const fillLink = (target: Gtk.Box, state: LinkState, text: string) => {
    clear(target);
    target.append(linkLabel(text, ['caption', LINK_CLASS[state]], align));
  };

  return {
    widget,
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
  /** The picture and the words around it: goes where a status page has its icon. */
  widget: Gtk.Widget;
  /** The sentence and the button under a failing link; goes below the page's title. */
  fix: Gtk.Widget;
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

  const fix = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 12, visible: false });
  fix.append(sentence);
  fix.append(button);

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
    widget: stack,
    fix,
    show(view) {
      last = view;
      horizontal.show(view, t);
      vertical.show(view, t);
      draw();
      sentence.set_label(view.fix?.sentence ?? '');
      sentence.set_visible(view.fix !== null);
      fix.set_visible(view.fix !== null);
      action = view.fix?.action?.id ?? null;
      button.set_label(view.fix?.action?.label ?? '');
      button.set_visible(action !== null);
    },
    setVertical(v) {
      stack.set_visible_child_name(v ? 'vertical' : 'horizontal');
    },
  };
}
