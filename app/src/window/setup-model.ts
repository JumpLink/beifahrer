/**
 * The setup assistant without a widget in it (ADR 0023): which step the person is on and what lets
 * them leave it, which coding agents and browsers this computer has, what the config step shows for
 * an agent's file, and where the extension comes from for a browser. Pure, like the other models;
 * `setup-page.ts` draws it, `setup-apply.ts` writes.
 *
 * Detection is a hint for the order of the lists and never a gate: a person whose agent or browser is
 * not found can still pick it.
 */

import {
  AGENTS,
  agentSections,
  planConfigEdit,
  renderDiff,
  serverSpec,
  snippetOf,
  userConfigPath,
  type AgentEntry,
  type AgentSection,
  type DiffLine,
  type EditPlan,
  type Install,
} from '@beifahrer/core';

import { agentLabel, guideSteps } from './guide.ts';
import type { Translate } from './i18n.ts';
import type { ApplyResult } from './setup-apply.ts';

export const STEPS = ['agent', 'config', 'extension', 'pairing'] as const;
export type StepId = (typeof STEPS)[number];
export type BrowserKind = 'firefox' | 'chromium';

/**
 * How the config step ended. `manual`: there is nothing the window may write (no known file, a
 * sandbox, a file it cannot read as a whole), the snippet is the way and the person goes on.
 */
export type ConfigOutcome = 'pending' | 'written' | 'unchanged' | 'manual';

export interface SetupState {
  step: StepId;
  agentId: string | null;
  allowWrite: boolean;
  config: ConfigOutcome;
  browser: BrowserKind;
  paired: boolean;
}

export function initialState(browser: BrowserKind = 'firefox', agentId: string | null = null): SetupState {
  return { step: 'agent', agentId, allowWrite: false, config: 'pending', browser, paired: false };
}

/** Another agent or another `--allow-write` is another file content: the config step starts over. */
export function chooseAgent(
  state: SetupState,
  agentId: string | null,
  allowWrite = state.allowWrite,
): SetupState {
  const same = agentId === state.agentId && allowWrite === state.allowWrite;
  return { ...state, agentId, allowWrite, config: same ? state.config : 'pending' };
}

export function chooseBrowser(state: SetupState, browser: BrowserKind): SetupState {
  return { ...state, browser };
}

export function finishConfig(state: SetupState, config: ConfigOutcome): SetupState {
  return { ...state, config };
}

export function markPaired(state: SetupState): SetupState {
  return { ...state, paired: true };
}

/** What has to be true before "Next" works on the current step. */
export function canLeave(state: SetupState): boolean {
  switch (state.step) {
    case 'agent':
      return state.agentId !== null;
    case 'config':
      return state.config !== 'pending';
    case 'extension':
      return true;
    case 'pairing':
      return state.paired;
  }
}

export function next(state: SetupState): SetupState {
  const at = STEPS.indexOf(state.step);
  return canLeave(state) && at < STEPS.length - 1 ? { ...state, step: STEPS[at + 1]! } : state;
}

export function back(state: SetupState): SetupState {
  const at = STEPS.indexOf(state.step);
  return at > 0 ? { ...state, step: STEPS[at - 1]! } : state;
}

export const isLast = (state: SetupState) => state.step === STEPS[STEPS.length - 1];

// -- what this computer has ------------------------------------------------------------------

export interface Probe {
  /** A file or folder exists at this absolute path. */
  has(path: string): boolean;
  /** A bare command resolves through PATH. */
  onPath(command: string): boolean;
}

const AGENT_COMMANDS: Record<string, string[]> = {
  'claude-code': ['claude'],
  opencode: ['opencode'],
  codex: ['codex'],
  'gemini-cli': ['gemini'],
  cursor: ['cursor'],
  vscode: ['code'],
  'claude-desktop': [],
  zed: ['zed', 'zeditor'],
  'lm-studio': ['lms'],
  anythingllm: [],
  jan: [],
  goose: ['goose'],
  'cherry-studio': [],
  jetbrains: [],
  other: [],
};

export interface Expand {
  (path: string): string;
}

/** The ids of the agents whose command resolves, or whose user-level config file already exists. */
export function detectAgents(platform: string, expand: Expand, probe: Probe): Set<string> {
  const found = new Set<string>();
  for (const agent of AGENTS) {
    const file = userConfigPath(agent, platform);
    const byFile = file !== null && probe.has(expand(file));
    if (byFile || (AGENT_COMMANDS[agent.id] ?? []).some((c) => probe.onPath(c))) found.add(agent.id);
  }
  return found;
}

/** The table's order, with the detected agents first. */
export function agentsDetectedFirst(detected: ReadonlySet<string>): AgentEntry[] {
  return [...AGENTS.filter((a) => detected.has(a.id)), ...AGENTS.filter((a) => !detected.has(a.id))];
}

/**
 * The first step's list: AI apps, coding agents, other; only what `platform` can use; detected ones
 * first inside each group. "Other" stays last because the groups keep their order.
 */
export function setupSections(platform: string, detected: ReadonlySet<string>): AgentSection[] {
  return agentSections(platform).map((s) => ({
    group: s.group,
    agents: [...s.agents.filter((a) => detected.has(a.id)), ...s.agents.filter((a) => !detected.has(a.id))],
  }));
}

interface BrowserSpec {
  kind: BrowserKind;
  name: string;
  commands: string[];
  files: Partial<Record<string, string[]>>;
}

const FLATPAK = (id: string) => [
  `/var/lib/flatpak/exports/bin/${id}`,
  `~/.local/share/flatpak/exports/bin/${id}`,
];

const BROWSERS: readonly BrowserSpec[] = [
  {
    kind: 'firefox',
    name: 'Firefox',
    commands: ['firefox', 'firefox-esr'],
    files: {
      linux: [...FLATPAK('org.mozilla.firefox'), '/snap/bin/firefox'],
      darwin: ['/Applications/Firefox.app'],
      win32: [
        '%ProgramFiles%\\Mozilla Firefox\\firefox.exe',
        '%ProgramFiles(x86)%\\Mozilla Firefox\\firefox.exe',
      ],
    },
  },
  {
    kind: 'chromium',
    name: 'Chromium',
    commands: ['chromium', 'chromium-browser'],
    files: {
      linux: [...FLATPAK('org.chromium.Chromium'), '/snap/bin/chromium'],
      darwin: ['/Applications/Chromium.app'],
    },
  },
  {
    kind: 'chromium',
    name: 'Google Chrome',
    commands: ['google-chrome', 'google-chrome-stable'],
    files: {
      linux: FLATPAK('com.google.Chrome'),
      darwin: ['/Applications/Google Chrome.app'],
      win32: [
        '%ProgramFiles%\\Google\\Chrome\\Application\\chrome.exe',
        '%ProgramFiles(x86)%\\Google\\Chrome\\Application\\chrome.exe',
        '%LOCALAPPDATA%\\Google\\Chrome\\Application\\chrome.exe',
      ],
    },
  },
  {
    kind: 'chromium',
    name: 'Brave',
    commands: ['brave', 'brave-browser'],
    files: {
      linux: FLATPAK('com.brave.Browser'),
      darwin: ['/Applications/Brave Browser.app'],
      win32: ['%ProgramFiles%\\BraveSoftware\\Brave-Browser\\Application\\brave.exe'],
    },
  },
  {
    kind: 'chromium',
    name: 'Microsoft Edge',
    commands: ['microsoft-edge', 'microsoft-edge-stable'],
    files: {
      linux: FLATPAK('com.microsoft.Edge'),
      darwin: ['/Applications/Microsoft Edge.app'],
      win32: ['%ProgramFiles(x86)%\\Microsoft\\Edge\\Application\\msedge.exe'],
    },
  },
];

export interface BrowserFound {
  kind: BrowserKind;
  name: string;
}

export function detectBrowsers(platform: string, expand: Expand, probe: Probe): BrowserFound[] {
  return BROWSERS.filter(
    (b) =>
      b.commands.some((c) => probe.onPath(c)) || (b.files[platform] ?? []).some((f) => probe.has(expand(f))),
  ).map(({ kind, name }) => ({ kind, name }));
}

/** Firefox when nothing was found: it is the browser whose build updates itself. */
export function defaultBrowser(found: readonly BrowserFound[]): BrowserKind {
  return found[0]?.kind ?? 'firefox';
}

// -- the config step -------------------------------------------------------------------------

export type ConfigKind = 'create' | 'update' | 'unchanged' | 'unparseable' | 'sandbox' | 'nofile' | 'guide';

export interface ConfigView {
  kind: ConfigKind;
  title: string;
  description: string;
  /** The file the change is for; null where the agent's docs name none. */
  file: string | null;
  diff: DiffLine[];
  /** The change as text, for a screen reader and for the tests. */
  diffText: string;
  /** What to paste by hand when the window does not write. Empty for an app that takes fields, not JSON. */
  snippet: string;
  /** For an app set up in its own screens: what to click and type, in order. */
  steps: string[];
  /** The "Write" button exists only for a change the window may make. */
  writable: boolean;
  /** The text the diff was made from, which the writer checks is still the file's. */
  shown: string | null;
}

export interface ConfigInput {
  agent: AgentEntry;
  allowWrite: boolean;
  platform: string;
  install: Install;
  /** The expanded path of the agent's user-level file, or null. */
  file: string | null;
  /** The file's text: null when it does not exist. An `Error` when it exists and could not be read. */
  text: string | null | Error;
}

export function configView(input: ConfigInput, t: Translate): ConfigView {
  const { agent, file } = input;
  const server = serverSpec({ allowWrite: input.allowWrite, install: input.install });
  const snippet = snippetOf(agent, server);
  const base = { file, diff: [], diffText: '', snippet, steps: [], writable: false, shown: null };
  if (agent.guide !== null) {
    // Before the sandbox case: an app set up in its own screens needs no file access.
    return {
      ...base,
      kind: 'guide',
      file: null,
      snippet: agent.guide === 'json' ? snippet : '',
      steps: guideSteps(agent, server, input.install, t),
      title: t('setup.config.guide.title', { name: agentLabel(agent, t) }),
      description: t('setup.config.guide.description'),
    };
  }
  if (input.install.flatpak) {
    return {
      ...base,
      kind: 'sandbox',
      title: t('setup.config.sandbox.title'),
      description: t('setup.config.sandbox.description'),
    };
  }
  if (file === null) {
    return {
      ...base,
      kind: 'nofile',
      title: t('setup.config.nofile.title'),
      description: t('setup.config.nofile.description'),
    };
  }
  if (input.text instanceof Error) {
    return {
      ...base,
      kind: 'unparseable',
      title: t('setup.config.unreadable.title'),
      description: t('setup.config.unreadable.description', { reason: input.text.message }),
    };
  }
  const plan: EditPlan = planConfigEdit(agent, input.text, server);
  switch (plan.kind) {
    case 'unchanged':
      return {
        ...base,
        kind: 'unchanged',
        title: t('setup.config.unchanged.title'),
        description: t('setup.config.unchanged.description', { name: agent.name }),
      };
    case 'unparseable':
      return {
        ...base,
        kind: 'unparseable',
        title: t('setup.config.unparseable.title'),
        description: t(`setup.config.unparseable.${plan.reason}`),
      };
    case 'create':
      return {
        ...base,
        kind: 'create',
        title: t('setup.config.create.title'),
        description: t('setup.config.create.description'),
        diff: plan.diff,
        diffText: renderDiff(plan.diff),
        writable: true,
        shown: null,
      };
    case 'update':
      return {
        ...base,
        kind: 'update',
        title: t('setup.config.update.title'),
        description: t('setup.config.update.description'),
        diff: plan.diff,
        diffText: renderDiff(plan.diff),
        writable: true,
        shown: plan.before,
      };
  }
}

/** The outcome a view settles into without a write, for the cases where there is nothing to confirm. */
export function outcomeOfView(view: ConfigView): ConfigOutcome {
  if (view.kind === 'unchanged') return 'unchanged';
  return view.writable ? 'pending' : 'manual';
}

export interface ApplyView {
  ok: boolean;
  message: string;
  outcome: ConfigOutcome | null;
}

export function applyView(result: ApplyResult, t: Translate): ApplyView {
  switch (result.status) {
    case 'written':
      return {
        ok: true,
        outcome: 'written',
        message: result.backup
          ? t('setup.apply.written', { backup: result.backup })
          : t('setup.apply.created'),
      };
    case 'unchanged':
      return { ok: true, outcome: 'unchanged', message: t('setup.apply.unchanged') };
    case 'not-confirmed':
      return { ok: false, outcome: null, message: t('setup.apply.notconfirmed') };
    case 'changed-meanwhile':
      return { ok: false, outcome: null, message: t('setup.apply.changed') };
    case 'unparseable':
      return { ok: false, outcome: 'manual', message: t('setup.apply.unparseable') };
    case 'backup-failed':
      return { ok: false, outcome: null, message: t('setup.apply.backupfailed', { reason: result.reason }) };
    case 'write-failed':
      return {
        ok: false,
        outcome: null,
        message: result.backup
          ? t('setup.apply.writefailedbackup', { reason: result.reason, backup: result.backup })
          : t('setup.apply.writefailed', { reason: result.reason }),
      };
  }
}

// -- the extension step ----------------------------------------------------------------------

export const RELEASES_URL = 'https://github.com/JumpLink/beifahrer/releases';

export const XPI_URL = `${RELEASES_URL}/latest/download/beifahrer.xpi`;

export interface ExtensionView {
  title: string;
  body: string;
  linkLabel: string;
  url: string;
  /** What to do with the download, in order. */
  steps: string[];
  /** Says plainly that no store carries the extension yet. */
  store: string;
}

/**
 * Firefox gets the signed `.xpi` of the latest release: opening it in Firefox installs it, and Firefox
 * updates it through `updates.json` from then on. Mozilla's signing picks the file's own name (a hash
 * and the version), so the release workflow attaches a second copy under the fixed name `beifahrer.xpi`
 * for this link. `latest` is the newest release, which is not always this app's version, and that is
 * fine: the extension and the app talk a versioned protocol.
 * Chromium gets the zip from the same release, which the browser loads unpacked.
 */
export function extensionView(browser: BrowserKind, version: string, t: Translate): ExtensionView {
  if (browser === 'firefox') {
    return {
      title: t('setup.extension.firefox.title'),
      body: t('setup.extension.firefox.body'),
      linkLabel: t('setup.extension.firefox.link'),
      url: XPI_URL,
      steps: [
        t('setup.extension.firefox.step1'),
        t('setup.extension.firefox.step2'),
        t('setup.extension.firefox.step3'),
      ],
      store: t('setup.extension.nostore'),
    };
  }
  return {
    title: t('setup.extension.chromium.title'),
    body: t('setup.extension.chromium.body'),
    linkLabel: t('setup.extension.chromium.link'),
    url: `${RELEASES_URL}/download/v${version}/beifahrer-${version}-chrome-mv3.zip`,
    steps: [
      t('setup.extension.chromium.step1'),
      t('setup.extension.chromium.step2'),
      t('setup.extension.chromium.step3'),
      t('setup.extension.chromium.step4'),
    ],
    store: t('setup.extension.nostore'),
  };
}
