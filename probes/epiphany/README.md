# Epiphany probe

The probe behind [ADR 0001 § 3](../../docs/adr/0001-a-browser-extension-not-a-driven-browser.md#3-engine-support-is-measured-not-claimed).
A minimal MV2 extension whose background page connects to `server.mjs` on `127.0.0.1:47813` and
reports, one JSON line per check, which WebExtension APIs work. Re-run it before claiming that an
Epiphany release is supported.

```sh
node server.mjs &            # writes report.jsonl next to itself
```

Run Epiphany **isolated**, never on your own profile. With the Flatpak, `flatpak run --env=XDG_…`
does NOT isolate: Flatpak overrides those variables and you get your real profile. Set them
inside the sandbox instead:

```sh
B=$HOME/.var/app/org.gnome.Epiphany/probe
mkdir -p $B/data/epiphany/web_extensions/probe $B/config/glib-2.0/settings
cp manifest.json background.js content.js $B/data/epiphany/web_extensions/probe/
printf "[org/gnome/epiphany/web]\nenable-webextensions=true\nwebextensions-active=['werkstatt-probe']\n\n[org.gnome.Epiphany]\ndefault-browser=false\ndevelopermode=true\n" \
  > $B/config/glib-2.0/settings/keyfile
flatpak run --command=sh org.gnome.Epiphany -c \
  "export GSETTINGS_BACKEND=keyfile XDG_DATA_HOME=$B/data XDG_CONFIG_HOME=$B/config XDG_CACHE_HOME=$B/cache EPHY_LOG_MODULES=all; exec epiphany"
```

`webextensions-active` lists extension **names** (the manifest's `name`), and
`enable-webextensions` only reveals the preferences page; it does not gate loading.

`default-browser=false` is not cosmetic. A fresh profile makes Epiphany ask *set as default
browser?* on first start, and while that modal is up the extension's WebSocket completes its
handshake and then never fires `open` — measured 2026-10-01, the same profile answers at once with
the key set. A run without it looks like a browser that never starts the background page, which is
a different and much cheaper bug to fix.

## Last measured: 2026-10-01 (issue #6)

Fedora workstation, both Flatpaks installed: `org.gnome.Epiphany` 50.6 and
`org.gnome.Epiphany.Devel` 51.1. The probe ran from a copy on port 47951, because 47813–47822 belong
to the person's own sessions. Two things the older runs could not tell apart, now separated:

| | 50.6 | 51.1 (nightly) |
|---|---|---|
| Extension loads, background page runs | yes | **no**, silently |
| `websocket open` (with `default-browser=false`) | yes | never gets there |
| `env`, `api-shape`, `fetch` to loopback | pass | — |
| `tabs.query({})` | **never answers** (5 s timeout, timers still running) | — |
| Tab created by the extension | **never requests its URL**, stays *wird geladen …* | — |
| UI process | no longer aborts (#2801's fix reached stable) | stable |

A tab that never finishes loading also wedges everything behind it: while it is pending, every later
`tabs.*` call blocks and the background page's own timers stop, so the report ends mid-run with no
failures listed. That is the *consequence* of the broken tab load, not the fault itself — the
`tabs.query` timeout above comes from a run where the extension created no tab at all.

Ruling out the server was cheap and worth doing: a plain `ws` client connects to `server.mjs` and
reports immediately, so a socket that never opens is the browser's, not the probe's.

Verdict: **still not supported**, and no longer because of the abort. The `tabs` namespace is the
blocker, in stable and in nightly alike.
