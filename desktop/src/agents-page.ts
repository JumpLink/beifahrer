/**
 * The Agent page: pick a coding agent, get the snippet that registers Beifahrer with it and where it
 * goes. A view and a clipboard: it writes into no agent's config and starts nothing (ADR 0017).
 */

import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';

import { AGENTS } from '@beifahrer/core';

import { agentView } from './agents-model.ts';
import { copyText } from './clipboard.ts';
import type { Translate } from './i18n.ts';
import { clamped } from './window.ts';

export interface AgentsPage {
  widget: Gtk.Widget;
}

export function createAgentsPage(t: Translate, toast: (title: string) => void): AgentsPage {
  const pick = new Adw.ComboRow({
    title: t('agents.agent'),
    model: Gtk.StringList.new(AGENTS.map((a) => a.name)),
  });
  const write = new Adw.SwitchRow({
    title: t('agents.write.title'),
    subtitle: t('agents.write.subtitle'),
  });
  const choose = new Adw.PreferencesGroup({
    title: t('agents.title'),
    description: t('agents.description'),
  });
  choose.add(pick);
  choose.add(write);

  const userFile = new Adw.ActionRow({ title: t('agents.userfile'), subtitleSelectable: true });
  const projectFile = new Adw.ActionRow({ title: t('agents.projectfile'), subtitleSelectable: true });
  const command = new Adw.ActionRow({ title: t('agents.command'), subtitleSelectable: true });
  const docs = new Gtk.LinkButton({ label: t('agents.docs'), valign: Gtk.Align.CENTER });
  const where = new Adw.PreferencesGroup({ title: t('agents.snippet') });
  for (const row of [userFile, projectFile, command]) where.add(row);
  const docsRow = new Adw.ActionRow({ title: t('agents.docs') });
  docsRow.add_suffix(docs);
  where.add(docsRow);

  const snippet = new Gtk.Label({
    selectable: true,
    xalign: 0,
    wrap: true,
    marginTop: 12,
    marginBottom: 12,
    marginStart: 12,
    marginEnd: 12,
  });
  snippet.add_css_class('monospace');
  const card = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL });
  card.add_css_class('card');
  card.append(snippet);
  const copy = Gtk.Button.new_with_label(t('agents.copy'));
  copy.add_css_class('suggested-action');
  copy.add_css_class('pill');
  copy.set_halign(Gtk.Align.START);

  const checked = new Gtk.Label({ wrap: true, xalign: 0 });
  checked.add_css_class('dim-label');
  const note = new Gtk.Label({ wrap: true, xalign: 0, label: t('agents.note') });
  note.add_css_class('dim-label');

  const column = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 24 });
  for (const w of [choose, where, card, copy, checked, note]) column.append(w);

  const render = () => {
    const agent = AGENTS[pick.get_selected()] ?? AGENTS[0]!;
    const view = agentView(agent, write.get_active(), process.platform, t);
    snippet.set_label(view.snippet);
    userFile.set_subtitle(view.userFile);
    projectFile.set_subtitle(view.projectFile ?? '');
    projectFile.set_visible(view.projectFile !== null);
    command.set_subtitle(view.command ?? '');
    command.set_visible(view.command !== null);
    docs.set_uri(view.docs);
    checked.set_label(view.checked);
  };
  pick.connect('notify::selected', render);
  write.connect('notify::active', render);
  copy.connect('clicked', () => {
    if (copyText(snippet.get_label())) toast(t('agents.copied'));
  });
  render();

  return { widget: clamped(column) };
}
