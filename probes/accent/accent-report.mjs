#!/usr/bin/env node
/**
 * The OS half of the accent measurement (issue #18), so the browser half has something fixed to be
 * compared against: what this machine's own settings say the desktop accent is.
 *
 * It is deliberately separate from the bridge. The bridge runs on GJS and already reads the GNOME
 * accent (`app/src/bridge/desktop.ts`); this runs on plain Node, reads the macOS and Windows
 * equivalents, and prints them next to the GNOME one. Nothing here is used by the product, and a
 * key that cannot be read is a finding, not a failure: the script always exits 0, because "the key
 * is absent" is an answer about the platform.
 */

import { execFileSync } from 'node:child_process';
import process from 'node:process';

/** The Adwaita accent each macOS accent index names. -1 is "graphite", which libadwaita calls slate. */
const APPLE_ACCENTS = new Map([
  [-1, 'slate'],
  [0, 'red'],
  [1, 'orange'],
  [2, 'yellow'],
  [3, 'green'],
  [4, 'blue'],
  [5, 'purple'],
  [6, 'pink'],
]);

const PLATFORM = process.platform;

const MANUAL_STEP = [
  'Still to do by hand, once per browser: open probes/accent/probe.html in it, and copy the JSON',
  'out of the tab title (the compact copy) or out of the <pre>. Do it for Safari, Chrome and',
  'Firefox on macOS and for Edge, Chrome and Firefox on Windows, with the desktop accent set to',
  'something unmistakable such as purple, and run this script again — a browser that only ever',
  'reports a blue fallback cannot be told from one that follows the system.',
  'Merging: a browser run is exactly one object of the probe.html shape ({ probe, version, browser,',
  'page, accentColor, prefersColorScheme, systemColors, notes }). Put it in the `browserRuns` array',
  'of this script\'s --json output, one entry per browser and platform, and add the "os" and "osName"',
  'fields to it — the system value it is to be compared against.',
].join(' ');

/** One command's result, or the reason it could not be run. Never throws. */
function run(argv) {
  try {
    const stdout = execFileSync(argv[0], argv.slice(1), {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    return { ran: true, stdout: stdout.trim(), stderr: '' };
  } catch (error) {
    const code = error && typeof error === 'object' ? error : {};
    return {
      ran: false,
      stdout: typeof code.stdout === 'string' ? code.stdout.trim() : '',
      stderr: typeof code.stderr === 'string' ? code.stderr.trim() : String(error),
    };
  }
}

function row(what, source, value, verdict) {
  return { what: what, source: source, value: value, verdict: verdict };
}

/** macOS: one `defaults read -g` key. Absent is a VALUE here, so absent is not an error. */
function defaultsRead(key) {
  const out = run(['defaults', 'read', '-g', key]);
  if (out.ran) return { present: true, value: out.stdout };
  if (/Could not find key|does not exist/i.test(out.stderr)) {
    // `defaults` prints this on stderr and exits 1 for a key nobody ever set. On macOS that is
    // the DEFAULT, not an unknown: no AppleAccentColor is blue/multicolour, no
    // AppleInterfaceStyle is light.
    return { present: false, value: null, reason: 'key absent — macOS means its default by this' };
  }
  return { present: null, value: null, reason: out.stderr || 'defaults read failed' };
}

const APPLE_ACCENT_SOURCE = 'defaults read -g AppleAccentColor';
const APPLE_STYLE_SOURCE = 'defaults read -g AppleInterfaceStyle';
const DWM_ACCENT = 'HKCU\\Software\\Microsoft\\Windows\\DWM';
const PERSONALIZE = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize';
const DWM_ACCENT_SOURCE = `reg query ${DWM_ACCENT} /v AccentColor`;
const PERSONALIZE_SOURCE = `reg query ${PERSONALIZE} /v AppsUseLightTheme`;

function macosRows() {
  // Every source is listed even where it cannot be read: a row that is missing reads as a row that
  // was forgotten, and the whole point of the report is which columns are filled in.
  if (PLATFORM !== 'darwin') {
    return [
      row(
        'macos accent',
        APPLE_ACCENT_SOURCE,
        'not macos',
        'no macOS source on this host, so this column can only be filled on a Mac',
      ),
      row('macos appearance', APPLE_STYLE_SOURCE, 'not macos', 'no macOS source on this host'),
    ];
  }
  const rows = [];
  const accent = defaultsRead('AppleAccentColor');
  let name = null;
  if (accent.present === true) {
    const index = /^-?\d+$/.test(accent.value) ? Number(accent.value) : null;
    name = index === null ? null : (APPLE_ACCENTS.get(index) ?? null);
    if (name === null) {
      rows.push(
        row(
          'macos accent',
          APPLE_ACCENT_SOURCE,
          `${accent.value} (an index macOS does not define)`,
          'unusable — the value is not an accent any Adwaita has; the report cannot judge a match',
        ),
      );
    } else {
      rows.push(
        row(
          'macos accent',
          APPLE_ACCENT_SOURCE,
          `${accent.value} (${name})`,
          'compare this with a browser run: if the browser reports the same hue, Safari and Chrome need no bridge here',
        ),
      );
    }
  } else if (accent.present === false) {
    rows.push(
      row(
        'macos accent',
        APPLE_ACCENT_SOURCE,
        'absent (default: blue / multicolor)',
        'an absent key is a value here, not a gap — a browser reporting blue cannot be distinguished from the default without a second accent',
      ),
    );
  } else {
    rows.push(row('macos accent', APPLE_ACCENT_SOURCE, 'unknown', accent.reason));
  }

  const style = defaultsRead('AppleInterfaceStyle');
  const auto = defaultsRead('AppleInterfaceStyleSwitchesAutomatically');
  if (style.present === true) {
    const flips = auto.present === true && auto.value === '1';
    rows.push(
      row(
        'macos appearance',
        APPLE_STYLE_SOURCE,
        `${style.value} (${style.value === 'Dark' ? 'dark' : 'light'})`,
        flips
          ? 'it also switches by itself, so a bridge on macOS must re-read, not watch once'
          : 'a fixed appearance, so one read is enough',
      ),
    );
  } else if (style.present === false) {
    rows.push(
      row(
        'macos appearance',
        APPLE_STYLE_SOURCE,
        'absent (default: light)',
        'absent means light, so a browser reporting no dark must be read as this, not as a broken query',
      ),
    );
  } else {
    rows.push(row('macos appearance', 'defaults read -g AppleInterfaceStyle', 'unknown', style.reason));
  }
  return rows;
}

/** Windows: one `reg query` value, printed by reg as `0x99ccff` for a DWORD. */
function regQuery(key, value) {
  if (PLATFORM !== 'win32') return { present: null, value: null, reason: 'not windows' };
  const out = run(['reg', 'query', key, '/v', value]);
  if (out.ran) {
    const match = /\s+REG_(?:DWORD|QWORD)\s+0x([0-9a-fA-F]+)/.exec(out.stdout);
    if (match) return { present: true, value: match[1] };
    return { present: null, value: null, reason: `no REG_DWORD in reg's output: ${out.stdout}` };
  }
  if (/unable to find|cannot find/i.test(out.stderr)) {
    // Windows writes these keys itself, so an absent one is a genuine unknown — NOT the default,
    // which is the opposite of macOS above.
    return { present: false, value: null, reason: 'key absent — unknown, Windows always writes it' };
  }
  return { present: null, value: null, reason: out.stderr || 'reg query failed' };
}

function windowsRows() {
  if (PLATFORM !== 'win32') {
    return [
      row(
        'windows accent',
        DWM_ACCENT_SOURCE,
        'not windows',
        'no Windows source on this host, so this column can only be filled on Windows',
      ),
      row('windows appearance', PERSONALIZE_SOURCE, 'not windows', 'no Windows source on this host'),
    ];
  }
  const rows = [];
  const accent = regQuery(DWM_ACCENT, 'AccentColor');
  if (accent.present === true) {
    const packed = Number.parseInt(accent.value, 16);
    // A Windows COLORREF is 0x00BBGGRR, so the RED byte is the LOW one. Reprinting it as #RRGGBB
    // is what makes it comparable with a browser's `AccentColor`: same hex, same accent.
    const r = packed & 0xff;
    const g = (packed >> 8) & 0xff;
    const b = (packed >> 16) & 0xff;
    const hex = `#${[r, g, b].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
    rows.push(
      row(
        'windows accent',
        DWM_ACCENT_SOURCE,
        `0x${accent.value} -> rgb ${hex.replace('#', '')} (${hex})`,
        'an arbitrary colour, so the browser comparison is exact: equal hex means the browser followed the system',
      ),
    );
  } else {
    rows.push(
      row(
        'windows accent',
        DWM_ACCENT_SOURCE,
        accent.present === false ? 'absent (unknown)' : 'unknown',
        accent.reason ?? '',
      ),
    );
  }

  const light = regQuery(PERSONALIZE, 'AppsUseLightTheme');
  if (light.present === true) {
    const isLight = Number.parseInt(light.value, 16) === 1;
    rows.push(
      row(
        'windows appearance',
        PERSONALIZE_SOURCE,
        isLight ? '1 (light)' : '0 (dark)',
        'a fixed value, so one read is enough for a bridge, unlike macOS with Auto',
      ),
    );
  } else {
    rows.push(row('windows appearance', PERSONALIZE_SOURCE, 'unknown', light.reason ?? ''));
  }
  return rows;
}

/**
 * The GNOME accent, read the way the bridge reads it: `gsettings`, and only in a GNOME session.
 * The session check is not a nicety — Homebrew installs `gsettings-desktop-schemas` on macOS, so
 * gsettings answers there with the schema's DEFAULT and the "measured" accent is `blue` whatever
 * the person chose (this is why `isGnomeSession` exists in `app/src/bridge/desktop.ts`).
 */
function gnomeRows() {
  const desktop = (process.env.XDG_CURRENT_DESKTOP ?? '').split(':');
  const gnome = desktop.some((entry) => /^GNOME/i.test(entry.trim()));
  if (!gnome) {
    return [
      row('gnome session', 'XDG_CURRENT_DESKTOP', desktop.join(':') || '(unset)', 'not a GNOME session'),
      row(
        'gnome accent',
        'gsettings org.gnome.desktop.interface accent-color',
        'unknown',
        'no GNOME session to ask — deliberately, see the comment above',
      ),
    ];
  }
  const out = run(['gsettings', 'get', 'org.gnome.desktop.interface', 'accent-color']);
  const value = out.ran ? out.stdout : null;
  return [
    row(
      'gnome session',
      'XDG_CURRENT_DESKTOP',
      desktop.join(':'),
      'a GNOME session, so the schema exists here',
    ),
    row(
      'gnome accent',
      'gsettings org.gnome.desktop.interface accent-color',
      value ?? 'unknown',
      value
        ? 'the source the bridge already follows, so this platform needs no new path'
        : out.stderr || 'gsettings read failed',
    ),
  ];
}

function build() {
  const rows = [
    row('platform', 'process.platform', PLATFORM, 'the platform decides which source below is asked at all'),
    ...gnomeRows(),
    ...macosRows(),
    ...windowsRows(),
  ];
  return {
    probe: 'beifahrer-accent',
    version: 1,
    tool: 'accent-report',
    host: {
      platform: PLATFORM,
      xdgCurrentDesktop: process.env.XDG_CURRENT_DESKTOP ?? null,
    },
    rows: rows,
    // Where a browser run (the object probe.html prints) belongs. Empty until a person fills it.
    browserRuns: [],
    manualStep: MANUAL_STEP,
  };
}

/** A plain table, the verdicts under it, and what the person still has to do. */
function printText(report) {
  const width = Math.min(28, Math.max(...report.rows.map((one) => one.what.length)));
  for (const one of report.rows) {
    process.stdout.write(
      `${one.what.padEnd(width)}  ${one.value}\n${' '.repeat(width)}  from ${one.source}\n`,
    );
  }
  process.stdout.write('\n');
  for (const one of report.rows) {
    if (one.verdict) process.stdout.write(`- ${one.what}: ${one.verdict}\n`);
  }
  process.stdout.write('\nby hand, still to do:\n');
  for (const line of MANUAL_STEP.split(/(?<=\.)\s+/)) {
    process.stdout.write(`  ${line}\n`);
  }
  process.stdout.write('\nno browser runs yet — `browserRuns` in the --json output is where they go.\n');
}

function main(argv) {
  const asJson = argv.includes('--json');
  const report = build();
  if (asJson) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else printText(report);
  return 0;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  // A source that cannot be read has already been recorded as unknown above, so reaching this is
  // a bug in the script and must not be dressed up as a finding.
  process.stderr.write(`accent-report: ${error && error.stack ? error.stack : error}\n`);
  process.exitCode = 1;
}
