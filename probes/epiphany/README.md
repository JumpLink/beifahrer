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
printf "[org/gnome/epiphany/web]\nenable-webextensions=true\nwebextensions-active=['werkstatt-probe']\n" \
  > $B/config/glib-2.0/settings/keyfile
flatpak run --command=sh org.gnome.Epiphany -c \
  "export GSETTINGS_BACKEND=keyfile XDG_DATA_HOME=$B/data XDG_CONFIG_HOME=$B/config XDG_CACHE_HOME=$B/cache EPHY_LOG_MODULES=all; exec epiphany"
```

`webextensions-active` lists extension **names** (the manifest's `name`), and
`enable-webextensions` only reveals the preferences page; it does not gate loading.
