# Accent probe — does the browser already report the desktop accent?

The measurement behind [issue #18](https://github.com/JumpLink/beifahrer/issues/18), the first
sentence of it: **before writing any Windows or macOS accent code, find out whether the BROWSER
already hands the page the system's accent colour.** If it does, the bridge path is only needed
where it does not. Nobody had that measurement, so producing it is the whole of this directory.

This is a measurement, not a feature. It touches no product code: the bridge
(`app/src/bridge/desktop.ts`) and the GNOME-only shim (`extension/src/accent.ts`) are unchanged,
and nothing here is imported by the extension, the bridge or the build.

## The question, precisely

beifahrer's pages paint themselves in the desktop's accent, and adwaita-web has no way to follow
the browser's `AccentColor` ([gjsify#1821](https://github.com/gjsify/gjsify/issues/1821)). So the
accent reaches the page over a bridge: the bridge reads the setting where it runs and reports it
in its welcome, and the extension remembers it. That works on GNOME today.

Two other desktops run this bridge, and the question is whether they need the same path at all:

- **macOS** — Safari, Chrome, Firefox
- **Windows** — Edge, Chrome, Firefox

## How to run it

### The OS side, on any host

```sh
node probes/accent/accent-report.mjs          # a table plus one verdict per row
node probes/accent/accent-report.mjs --json   # the same content, machine-readable
```

Zero dependencies, plain Node, nothing installed. It reads what the OS itself says and prints
**every** source, including the ones this host cannot answer, so a missing column reads as "not
filled in here" rather than as "not checked":

| Source | How | Absent means |
|---|---|---|
| GNOME | `gsettings get org.gnome.desktop.interface accent-color`, only in a GNOME session | — |
| macOS accent | `defaults read -g AppleAccentColor`, then the Adwaita name of that index | **blue** (the default) |
| macOS appearance | `defaults read -g AppleInterfaceStyle` | **light** |
| Windows accent | `reg query HKCU\Software\Microsoft\Windows\DWM /v AccentColor`, unpacked from COLORREF `0x00BBGGRR` to `#RRGGBB` | unknown |
| Windows appearance | `reg query HKCU\...\Themes\Personalize /v AppsUseLightTheme` | unknown |

Two asymmetries in that table are load-bearing, and both are in the code with the reason:

- **On macOS an absent key is a value, not a gap.** Nobody who never touched the accent has
  `AppleAccentColor`, and nobody in light mode has `AppleInterfaceStyle` — absent is blue and light
  respectively. Reading absent as "unknown" would report a correct system as unreadable. On Windows
  it is the other way round: Windows writes both keys itself, so absent is a genuine unknown.
- **The GNOME read is gated on the session, not on gsettings existing.** Homebrew installs
  `gsettings-desktop-schemas` on macOS and KDE and Xfce carry it too, so `gsettings` answers
  *there* with the schema's default `'blue'` — a measurement that looks fine and is fiction. This
  is the same gate as `isGnomeSession()` in `app/src/bridge/desktop.ts`, and the same accident
  measured there: the bridge sent `'blue'` over Firefox's purple `AccentColor`.

The script exits 0 even when it can read nothing: "the key is absent" is a finding about the
platform, not a crash.

### The browser side, by hand

Open `probes/accent/probe.html` in the browser. **It works as a plain `file://` page** — nothing
loads, no server, no origin — and the page says so in its own output (`page.needsHttpOrigin`).
Set the desktop accent to something unmistakable such as purple first, or a browser that always
answers with a blue fallback cannot be told from one that follows the system.

Then copy the JSON: the compact copy is in the **tab title**, the readable one in the `<pre>`. The
title carries it so a tab listing can read it, the way beifahrer reads tabs.

What it reports:

- `accentColor` — whether `CSS.supports('accent-color', 'red')`, what `getComputedStyle` says, and
  the colour the engine actually **painted** into a swatch, with a native checkbox, radio and
  progress bar next to it that no JavaScript touches.
- `prefersColorScheme` — the query and its `.matches`, plus whether the engine has the query at
  all, so an engine without it is not recorded as `false` (which would read as "this engine says
  light").
- `systemColors` — `AccentColor`, `AccentColorText` and `AccentColorDark`, each reported as
  `supported` / `unsupported` / `unknown` and **never** as a colour that may be a fallback.
- `page` — the origin it ran at, and whether any check needed an http origin.

### Merging the two

A browser run is exactly one object of the `probe.html` shape (`{ probe, version, browser, page,
accentColor, prefersColorScheme, systemColors, notes }`). Put it in the **`browserRuns` array** of
the script's `--json` output — one entry per browser and platform — and add `os` and `osName` to
it, the system value it is to be compared against. The script prints these instructions itself, so
nobody has to come back to this file to find them.

## What the answer MEANS

The question is not "does the browser support the CSS property" but "does the value it hands the
page change when the desktop accent changes". A browser that reports `AccentColor` as a fixed
colour is not an answer, and the probe is built so that cannot be mistaken for one: on macOS the
system blue **is** the default accent, so a single run with the default accent set proves nothing,
which is why the probe must be run with a second accent.

Per browser, the verdict is one of three:

| Measurement | What it means for the implementation |
|---|---|
| `AccentColor` follows the system accent | No bridge path needed. The page can read the colour itself, and the fix belongs in **adwaita-web** ([gjsify#1821](https://github.com/gjsify/gjsify/issues/1821)), not in beifahrer's bridge |
| `AccentColor` exists but is a fixed fallback | A bridge path **is** needed there, and the bridge is already the only place that can supply it |
| `AccentColor` unsupported | Same, plus the gap is larger than a colour: the pages have nothing to read at all |

Whatever the per-browser answer turns out to be, these two rules hold and are already encoded in
the code:

- **The nearest-Adwaita mapping is not beifahrer's to add.** An arbitrary RGB has to become the
  nearest `AdwAccentColor` the way libadwaita does it (`adw_accent_color_nearest_from_rgba()`), so
  the UI stays Adwaita in the person's hue. That function belongs in **`@gjsify/adwaita-core`**
  (gjsify), never in this repo. **It is not there**: `@gjsify/adwaita-core` 0.52.0 ships
  `adwaitaAccentBgColor`, `adwaitaAccentColor`, `adwaitaStandaloneColor`, the nine-name table
  `ADW_ACCENT_BG_COLORS` and the measured `ACCENT_COLOR_VECTORS` — the *for* direction only, from
  an accent name to a colour. Nothing takes a colour in. So mapping a Windows `AccentColor` to an
  Adwaita accent is blocked on a gjsify addition, and this probe adds nothing towards it.

  The probe deliberately does **not** map anything. The comparison it enables is exact — an
  arbitrary `#RRGGBB` from the registry against the browser's `AccentColor` — so a nearest-accent
  guess could only blur the one reading that decides the work.

- **The GNOME read is already done and is not what this measures.** `app/src/bridge/desktop.ts`
  reads `org.gnome.desktop.interface accent-color` in a GNOME session and polls it, and the
  macOS `AppleAccentColor` → Adwaita name mapping is there too. What is missing there is Windows,
  and — the subject of this directory — the measurement of whether any of it is needed at all.

## What has not been measured yet

This directory contains the instrument, not the readings. It has been run on **Linux only**
(Chromium 153 and Firefox 155, both headless, both at a `file://` origin, both reporting the GNOME
accent blue). The macOS and Windows columns and all six browser rows are still empty, and they need
a person at those machines. Until they are filled in, do not claim that a browser does or does not
report the desktop accent.

One finding is already worth keeping, measured on this host in both engines: `getComputedStyle`
returns the **keyword `auto`** for `accent-color`, not a colour. The used accent therefore cannot
be read back out of that property at all; the probe paints the swatch from `AccentColor` in CSS and
reads that back, cross-checking it against the system-colour probe. An implementation that reads
`accent-color` expecting an RGB will get `auto`.
