/**
 * The Setup page: the assistant of ADR 0023 in four steps (agent, config, extension, pairing). All
 * decisions are in `setup-model.ts` and the write is `setup-apply.ts`; this file only draws them and
 * routes clicks. It holds no state of its own besides `state`, so re-running the assistant is just
 * opening the page again: the config step reads the file anew and says "already set up" when it is.
 *
 * The one write sits behind one button, `Write changes`, which is the person's confirmation. Nothing
 * on this page writes on its own, on open or on a step change.
 */

import { existsSync } from 'node:fs';

import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';

import { findAgent, serverSpec, userConfigPath, type AgentEntry } from '@beifahrer/core';

import { detectInstall, expandPath, resolvesOnHost } from '../frontends/cli/install.ts';
import { VERSION } from '../version.ts';
import { copyText } from './clipboard.ts';
import { agentLabel } from './guide.ts';
import type { Translate } from './i18n.ts';
import type { PairingView } from './pairing-model.ts';
import { applyConfigEdit } from './setup-apply.ts';
import { diskOps } from './setup-fs.ts';
import {
  STEPS,
  setupSections,
  applyView,
  back,
  canLeave,
  chooseAgent,
  chooseBrowser,
  configView,
  defaultBrowser,
  detectAgents,
  detectBrowsers,
  extensionView,
  finishConfig,
  initialState,
  isLast,
  markPaired,
  next,
  outcomeOfView,
  type BrowserKind,
  type ConfigView,
  type Probe,
  type SetupState,
  type StepId,
} from './setup-model.ts';
import { clamped } from './window.ts';

export interface SetupPage {
  widget: Gtk.Widget;
  showPairing(view: PairingView): void;
  /** Back to the first step, for "run setup again". */
  reset(): void;
}

function label(text: string, css?: string): Gtk.Label {
  const l = new Gtk.Label({ label: text, wrap: true, xalign: 0 });
  if (css) l.add_css_class(css);
  return l;
}

function clear(box: Gtk.Box) {
  let child = box.get_first_child();
  while (child) {
    const following = child.get_next_sibling();
    box.remove(child);
    child = following;
  }
}

function column(spacing = 18): Gtk.Box {
  return new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing });
}

export function createSetupPage(
  t: Translate,
  toast: (title: string) => void,
  onFinish: () => void,
): SetupPage {
  const platform = process.platform;
  const install = detectInstall();
  const probe: Probe = { has: existsSync, onPath: (command) => resolvesOnHost(command) };
  const detected = detectAgents(platform, expandPath, probe);
  const sections = setupSections(platform, detected);
  const browsers = detectBrowsers(platform, expandPath, probe);

  const fresh = (): SetupState =>
    initialState(
      defaultBrowser(browsers),
      sections.flatMap((x) => x.agents).find((a) => detected.has(a.id))?.id ?? null,
    );
  let state: SetupState = fresh();
  let view: ConfigView | null = null;
  let token: string | null = null;

  const progress = label('', 'dim-label');
  const heading = label('', 'title-2');
  const stack = new Gtk.Stack({ transitionType: Gtk.StackTransitionType.CROSSFADE });

  // -- step 1: the agent ---------------------------------------------------------------------
  const groupTitles = {
    apps: t('setup.group.apps'),
    coding: t('setup.group.coding'),
    other: t('setup.group.other'),
  } as const;
  const agentGroups: Adw.PreferencesGroup[] = [];
  let first: Gtk.CheckButton | null = null;
  for (const section of sections) {
    const group = new Adw.PreferencesGroup({
      title: groupTitles[section.group],
    });
    agentGroups.push(group);
    for (const agent of section.agents) {
      const check = new Gtk.CheckButton({ active: agent.id === state.agentId });
      if (first) check.set_group(first);
      else first = check;
      const row = new Adw.ActionRow({
        title: agentLabel(agent, t),
        subtitle: detected.has(agent.id) ? t('setup.agent.found') : t('setup.agent.notfound'),
      });
      row.add_prefix(check);
      row.set_activatable_widget(check);
      group.add(row);
      check.connect('toggled', () => {
        if (!check.get_active()) return;
        state = chooseAgent(state, agent.id);
        render();
      });
    }
  }
  const writeSwitch = new Adw.SwitchRow({
    title: t('agents.write.title'),
    subtitle: t('agents.write.subtitle'),
  });
  const writeGroup = new Adw.PreferencesGroup();
  writeGroup.add(writeSwitch);
  writeSwitch.connect('notify::active', () => {
    state = chooseAgent(state, state.agentId, writeSwitch.get_active());
    render();
  });
  const agentStep = column();
  agentStep.append(label(t('setup.agent.description'), 'dim-label'));
  for (const g of agentGroups) agentStep.append(g);
  agentStep.append(writeGroup);
  stack.add_named(agentStep, 'agent');

  // -- step 2: the config -------------------------------------------------------------------
  const fileRow = new Adw.ActionRow({ title: t('setup.config.file'), subtitleSelectable: true });
  const fileGroup = new Adw.PreferencesGroup();
  fileGroup.add(fileRow);
  const configTitle = label('', 'heading');
  const configText = label('');
  const stepsBox = column(6);
  const diffBox = column(0);
  diffBox.add_css_class('card');
  const snippetLabel = new Gtk.Label({
    selectable: true,
    xalign: 0,
    wrap: true,
    marginTop: 12,
    marginBottom: 12,
    marginStart: 12,
    marginEnd: 12,
  });
  snippetLabel.add_css_class('monospace');
  const snippetBox = column(0);
  snippetBox.add_css_class('card');
  snippetBox.append(snippetLabel);
  const copy = Gtk.Button.new_with_label(t('agents.copy'));
  copy.set_halign(Gtk.Align.START);
  const backupNote = label(t('setup.config.backup'), 'dim-label');
  const write = Gtk.Button.new_with_label(t('setup.config.write'));
  write.add_css_class('suggested-action');
  write.add_css_class('pill');
  const result = label('');
  const configStep = column();
  for (const w of [
    fileGroup,
    configTitle,
    configText,
    stepsBox,
    diffBox,
    snippetBox,
    copy,
    backupNote,
    result,
  ])
    configStep.append(w);
  stack.add_named(configStep, 'config');

  const serverOf = () => serverSpec({ allowWrite: state.allowWrite, install });
  const agentOf = (): AgentEntry | undefined => (state.agentId ? findAgent(state.agentId) : undefined);
  const fileOf = (agent: AgentEntry): string | null => {
    const path = userConfigPath(agent, platform);
    return path === null ? null : expandPath(path);
  };

  /** Reads the file and shows what writing would do. It reads; it never writes. */
  const refreshConfig = () => {
    const agent = agentOf();
    if (!agent) return;
    const file = fileOf(agent);
    let text: string | null | Error = null;
    if (file !== null) {
      try {
        text = diskOps.read(file);
      } catch (err) {
        text = err instanceof Error ? err : new Error(String(err));
      }
    }
    view = configView({ agent, allowWrite: state.allowWrite, platform, install, file, text }, t);
    state = finishConfig(state, outcomeOfView(view));
    fileRow.set_subtitle(file ?? t('agents.nofile'));
    fileRow.set_visible(view.kind !== 'guide');
    fileGroup.set_visible(view.kind !== 'guide');
    clear(stepsBox);
    view.steps.forEach((step, i) => {
      const l = label(`${i + 1}. ${step}`);
      l.set_selectable(true);
      stepsBox.append(l);
    });
    configTitle.set_label(view.title);
    configText.set_label(view.description);
    clear(diffBox);
    for (const line of view.diff) {
      const l = new Gtk.Label({
        label: line.op === '…' ? '…' : `${line.op} ${line.text}`,
        xalign: 0,
        wrap: true,
        selectable: true,
        marginStart: 12,
        marginEnd: 12,
      });
      l.add_css_class('monospace');
      if (line.op === '+') l.add_css_class('success');
      if (line.op === '-') l.add_css_class('error');
      diffBox.append(l);
    }
    diffBox.set_visible(view.diff.length > 0);
    const manual = !view.writable && view.kind !== 'unchanged';
    snippetLabel.set_label(view.snippet);
    snippetBox.set_visible(manual && view.snippet !== '');
    copy.set_visible(manual && view.snippet !== '');
    backupNote.set_visible(view.writable && view.kind === 'update');
    write.set_sensitive(true);
    result.set_label('');
  };

  write.connect('clicked', () => {
    const agent = agentOf();
    if (!agent || !view?.writable) return;
    const file = fileOf(agent);
    if (file === null) return;
    // The click on this button, after the diff above was on screen, is the confirmation.
    const done = applyView(
      applyConfigEdit(
        { agent, file, server: serverOf(), shown: view.shown, confirmed: true, now: new Date() },
        diskOps,
      ),
      t,
    );
    result.set_label(done.message);
    result.remove_css_class('error');
    if (!done.ok) result.add_css_class('error');
    if (done.outcome) state = finishConfig(state, done.outcome);
    if (done.ok) write.set_sensitive(false);
    render();
  });
  copy.connect('clicked', () => {
    if (view && copyText(view.snippet)) toast(t('agents.copied'));
  });

  // -- step 3: the extension ----------------------------------------------------------------
  const browserPick = new Adw.ComboRow({
    title: t('setup.browser.pick'),
    model: Gtk.StringList.new([t('setup.browser.firefox'), t('setup.browser.chromium')]),
  });
  const kinds: BrowserKind[] = ['firefox', 'chromium'];
  browserPick.set_selected(kinds.indexOf(state.browser));
  const browserGroup = new Adw.PreferencesGroup({
    title: t('setup.browser.title'),
    description: t('setup.browser.description'),
  });
  browserGroup.add(browserPick);
  const browserFound = label(
    browsers.length > 0
      ? t('setup.browser.found', { names: browsers.map((b) => b.name).join(', ') })
      : t('setup.browser.none'),
    'dim-label',
  );
  const extTitle = label('', 'heading');
  const extBody = label('');
  const extSteps = column(6);
  const extLink = new Gtk.LinkButton({ label: '', halign: Gtk.Align.START });
  const extStore = label('', 'dim-label');
  const extensionStep = column();
  for (const w of [browserGroup, browserFound, extTitle, extBody, extSteps, extLink, extStore])
    extensionStep.append(w);
  stack.add_named(extensionStep, 'extension');
  browserPick.connect('notify::selected', () => {
    state = chooseBrowser(state, kinds[browserPick.get_selected()] ?? 'firefox');
    render();
  });

  const refreshExtension = () => {
    const ext = extensionView(state.browser, VERSION, t);
    extTitle.set_label(ext.title);
    extBody.set_label(ext.body);
    clear(extSteps);
    ext.steps.forEach((s, i) => extSteps.append(label(`${i + 1}. ${s}`)));
    extLink.set_label(ext.linkLabel);
    extLink.set_uri(ext.url);
    extStore.set_label(ext.store);
  };

  // -- step 4: the pairing ------------------------------------------------------------------
  const tokenRow = new Adw.PasswordEntryRow({ title: t('pairing.token') });
  tokenRow.set_editable(false);
  const tokenCopy = Gtk.Button.new_from_icon_name('edit-copy-symbolic');
  tokenCopy.add_css_class('flat');
  tokenCopy.set_valign(Gtk.Align.CENTER);
  tokenCopy.set_tooltip_text(t('pairing.copy'));
  tokenRow.add_suffix(tokenCopy);
  const tokenGroup = new Adw.PreferencesGroup({ description: t('setup.pairing.description') });
  tokenGroup.add(tokenRow);
  const tokenError = label('', 'error');
  const pasted = Gtk.Button.new_with_label(t('setup.pairing.done'));
  pasted.add_css_class('suggested-action');
  pasted.add_css_class('pill');
  pasted.set_halign(Gtk.Align.START);
  const pairingStep = column();
  for (const w of [tokenGroup, tokenError, pasted]) pairingStep.append(w);
  stack.add_named(pairingStep, 'pairing');
  tokenCopy.connect('clicked', () => {
    if (token !== null && copyText(token)) toast(t('pairing.copied'));
  });
  // The token is pasted by the person and confirmed by them: nothing here sends or fetches it.
  pasted.connect('clicked', () => {
    state = markPaired(state);
    toast(t('setup.pairing.donetoast'));
    render();
  });

  // -- navigation ---------------------------------------------------------------------------
  const backButton = Gtk.Button.new_with_label(t('setup.back'));
  const nextButton = Gtk.Button.new_with_label(t('setup.next'));
  nextButton.add_css_class('suggested-action');
  nextButton.add_css_class('pill');
  const nav = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 12 });
  const spacer = new Gtk.Box({ hexpand: true });
  nav.append(backButton);
  nav.append(spacer);
  // In the bar, not under the diff: a long diff pushed the button out of view while Next was greyed out.
  nav.append(write);
  nav.append(nextButton);

  let scroller: Gtk.ScrolledWindow;
  let shown: StepId | null = null;
  const render = () => {
    if (shown !== state.step) {
      shown = state.step;
      if (state.step === 'config') refreshConfig();
      if (state.step === 'extension') refreshExtension();
    }
    progress.set_label(t('setup.progress', { n: STEPS.indexOf(state.step) + 1, total: STEPS.length }));
    heading.set_label(t(`setup.step.${state.step}`));
    stack.set_visible_child_name(state.step);
    write.set_visible(state.step === 'config' && view?.writable === true);
    backButton.set_sensitive(state.step !== STEPS[0]);
    nextButton.set_label(isLast(state) ? t('setup.finish') : t('setup.next'));
    nextButton.set_sensitive(canLeave(state));
    if (state.step === 'extension') refreshExtension();
  };
  const go = (to: SetupState) => {
    if (to === state) return;
    state = to;
    render();
    // A new step starts at its top, not where the previous one was scrolled to.
    scroller.get_vadjustment().set_value(0);
  };
  backButton.connect('clicked', () => {
    shown = null;
    go(back(state));
  });
  nextButton.connect('clicked', () => {
    if (isLast(state)) {
      if (canLeave(state)) onFinish();
      return;
    }
    go(next(state));
  });

  // Only the steps scroll: Back and Next stay in view however many agents the first step lists.
  const body = column(18);
  for (const w of [progress, heading, stack]) body.append(w);
  const navClamp = new Adw.Clamp({
    maximumSize: 640,
    marginTop: 12,
    marginBottom: 12,
    marginStart: 12,
    marginEnd: 12,
  });
  navClamp.set_child(nav);
  const page = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, vexpand: true });
  scroller = clamped(body) as Gtk.ScrolledWindow;
  page.append(scroller);
  page.append(new Gtk.Separator());
  page.append(navClamp);
  render();

  return {
    widget: page,
    reset() {
      shown = null;
      state = fresh();
      render();
      scroller.get_vadjustment().set_value(0);
    },
    showPairing(pairing) {
      token = pairing.token;
      // Only when it changed: setting the text of a row the person is looking at resets its reveal state.
      if (pairing.token !== null && tokenRow.get_text() !== pairing.token) tokenRow.set_text(pairing.token);
      tokenGroup.set_visible(pairing.token !== null);
      tokenError.set_label(pairing.error ?? '');
      tokenError.set_visible(pairing.error !== null);
    },
  };
}
