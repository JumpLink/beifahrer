# beifahrer

**Let an AI agent ride along in the browser you already use, with you in the driver's seat.**

Agents keep needing the browser that is already open in front of you. They need to know which tab
you are looking at, to read a page you are logged into, or to rewrite a ticket description in
place while you watch. The usual tools start a *separate* browser with no sessions and no idea of
what you see. The ones that attach to your own browser only work with Chromium.

beifahrer is a WebExtension for **Firefox and Chromium-based browsers** plus a small local
**MCP server**. The agent gets a narrow set of tools: list tabs, read a page, outline its fields,
take a screenshot, fill a field, click, open a URL, and, if you allow it, sort, pin, close, save and
reopen your tabs. **You decide, site by site, what it may do.**

> **Status: early (0.1).** Works end-to-end in Chromium and Firefox. Not yet on the add-on stores.

## How it works

```
Firefox / Chromium
  └─ beifahrer extension ─ WebSocket, 127.0.0.1 only, paired with a token ─┐
                                                                            │
                                        beifahrer mcp  (MCP over stdio) ────┘
                                               │
                                             agent
```

- The **extension** connects to the bridge on loopback. It serves requests only after you have
  paired it once with a token, and the bridge refuses any connection whose origin is a web page.
- The **bridge** (`beifahrer mcp`) is an MCP server over stdio that your agent starts. It routes
  requests and holds no policy.
- **Several agent sessions share one browser connection.** The first `beifahrer mcp` owns the port
  (the *hub*); every later one connects to it with the same pairing token and relays its calls
  (a *peer*). When the hub's session ends, a peer takes the port over and the extension reconnects
  to it by itself. `browsers_list` shows which role a session has and how many share the
  connection. Why: [ADR 0003](docs/adr/0003-share-one-bridge-between-agent-sessions.md).
- The **policy lives in your browser.** Every site is at one of three levels:

  | Level | The agent may |
  |---|---|
  | **Nothing** (default) | see that a tab on that site is open (host only: no title, no path) |
  | **Read** | read the text, get an outline of links, buttons and fields, take a screenshot (if screenshots are on) |
  | **Read + edit** | also fill fields and click. You confirm each change in a browser window unless you switch that off for the site. |

  When you raise a site's level, the browser asks you to grant access to that site. beifahrer has
  no host access until you do.

## Seeing it, and stopping it

**The toolbar button tells you what is going on.** Its icon is a set of sparkles:

| Icon | Means |
|---|---|
| grey sparkles | connected to an agent, nothing happening |
| **coloured** sparkles | an agent is using this browser right now (and for 5 s after its last request) |
| grey + **red dot** | paused: the agent gets nothing |
| grey + **amber dot** | not paired, or no agent running: nothing can reach the browser |

Hover it for the same in words. Click it for the popup: the pause switch at the top, the level of
the site you are on, the list of features, and the **activity** of the last 20 requests (time,
what, which site by host, and why a request was refused). The activity list holds no page text
and is gone when the browser closes.

**While the agent reads or edits a page, the page shows it**: a small pill, "beifahrer is
reading" or "is editing", with a **Stop** button, top right. It disappears a few seconds after
the last action, never appears in a screenshot, and the page itself cannot read it.

**Pause stops everything at once.** Press *Stop* on that pill, flip the switch in the popup or the
options, or press **Alt+Shift+B**. While paused, every tool the agent calls, even listing tabs,
answers `paused`, and the agent is told to ask you. Only you can resume, in the popup, the options
or with the shortcut: nothing the agent sends can.

**Features.** On top of the per-site levels, you choose which capabilities the agent may use at
all (popup and options):

| Feature | Tools | Default |
|---|---|---|
| See open tabs | `tabs_list`, `tab_active` (sites below *Read* show their host only) | on |
| Read page text | `page_read` | on |
| Outline pages | `page_outline` | on |
| Take screenshots | `page_screenshot` (Chromium also needs the all-sites grant in the options) | **off** |
| Fill fields | `page_fill`, still only at *Read + edit*, and you confirm | on |
| Click | `page_click`, still only at *Read + edit*, and you confirm | on |
| Open tabs | `tab_open`, only sites at *Read* or higher | on |
| Manage tabs and windows | `tabs_move`, `tabs_pin`, `tabs_close`, `tabs_group`, `tabs_ungroup`, `window_create` | **off** |
| Saved sessions | `sessions_*` | **off** |

A tool whose feature is off answers `feature_disabled` and names the feature. Why and how:
[ADR 0005](docs/adr/0005-the-person-sees-and-stops-the-agent.md).

## Tabs, windows and saved sessions

Two features, **"Manage tabs and windows"** and **"Saved sessions"** (popup and options, both off
by default), let the agent tidy up your browser for you:

| Tool | Does |
|---|---|
| `tabs_move`, `tabs_pin` | reorder tabs (also into another window), pin and unpin |
| `tabs_close` | close tabs or a whole window. You confirm in a window that lists them, unless you switch that off |
| `tabs_group`, `tabs_ungroup` | tab groups, where the browser has them (Chromium, Firefox ≥ 139) |
| `window_create` | a new window with new tabs and/or tabs moved over |
| `sessions_save`, `sessions_list`, `sessions_restore`, `sessions_delete` | save windows (order, pins, groups) under a name and reopen them later, lazily |
| `sessions_define` | a workspace the agent puts together for a task |
| `sessions_recently_closed`, `sessions_restore_closed` | the browser's own list of closed windows and tabs |

Sessions are stored **in your browser**, not with the agent ([ADR 0004](docs/adr/0004-sessions-live-in-the-browser.md)).
The options page lists them with Restore and Delete, saves the current windows under a name, and
shows your recently closed windows. It works without any agent. It also keeps automatic
snapshots of your windows (the last 20), so a window you close by mistake comes back in one click.

The per-site levels still apply: the agent sees a saved tab on a site below *Read* as its host
only, and it can only put URLs of sites at *Read* or higher into a new window or workspace.

## What it will never do

- **Run arbitrary JavaScript for the agent.** There is no `evaluate`: every action is one of the
  tools above, so the levels mean what they say.
- **Fill a password field.** You type those yourself.
- **Hold your credentials.** It uses the session you are already logged into.
- **Send anything off your computer.** The only channel is the loopback socket to the bridge you
  run yourself.
- **Switch your tab behind your back.** A screenshot is only taken of the tab you are showing.
- **Rearrange or close your tabs unless you let it.** Managing tabs and windows is a feature,
  off by default, and closing tabs asks you first.
- **Keep going after you press Stop.** Paused means every request is refused until you resume.

Page text is written by whoever runs the site, and an agent reading it can be steered by it
(prompt injection). That is the reason for the per-site levels: keep your bank at *Read*, and an
injected instruction has nothing to write with.

## Install (from source, for now)

Requires [gjsify](https://github.com/gjsify/gjsify) and GJS, nothing else: the app runs on GJS and the
extension is bundled on GJS too ([ADR 0002](docs/adr/0002-build-on-gjs-not-wxt.md)).

```sh
gjsify install
gjsify workspace beifahrer-cli build          # app/dist/beifahrer.gjs.mjs
gjsify workspace beifahrer-extension build    # extension/.output/{chrome-mv3,firefox-mv2}, on GJS
```

- **Chromium:** `chrome://extensions` → Developer mode → *Load unpacked* → `extension/.output/chrome-mv3`
- **Firefox, to try it:** `about:debugging#/runtime/this-firefox` → *Load Temporary Add-on* → `extension/.output/firefox-mv2/manifest.json`. Firefox forgets it on restart.
- **Firefox, to keep it:** sign it as an unlisted add-on (AMO signs it, nothing is published):
  put `WEB_EXT_API_KEY` / `WEB_EXT_API_SECRET` from [your AMO API key page](https://addons.mozilla.org/developers/addon/api/key/)
  into `~/.config/beifahrer/amo.env`, run `gjsify workspace beifahrer-extension sign`, and open
  the `.xpi` from `extension/.output/signed/` in Firefox.

Pair it:

```sh
gjsify run app/dist/beifahrer.gjs.mjs token   # prints the token; paste it in the extension's options
```

Register the MCP server with your agent. It needs `mcp`, and `--allow-write` if the agent may
fill and click at all (the browser still asks you):

```json
{
  "mcpServers": {
    "beifahrer": {
      "command": "gjsify",
      "args": ["run", "/path/to/beifahrer/app/dist/beifahrer.gjs.mjs", "mcp", "--allow-write"]
    }
  }
}
```

Then open a site, click the beifahrer toolbar button, and pick a level.

## Browsers

| | Chromium (Chrome, Brave, Edge, …) | Firefox | Epiphany (GNOME Web) |
|---|---|---|---|
| Manifest | MV3 | MV2 | MV2 |
| Status | ✅ | ✅ | ⏸ blocked upstream: [measured](docs/adr/0001-a-browser-extension-not-a-driven-browser.md#3-engine-support-is-measured-not-claimed) |

## Development

```sh
gjsify workspace beifahrer-extension dev            # Firefox with the extension, rebuilt + reloaded on every change
gjsify workspace beifahrer-extension dev:chromium   # the same in Chromium (Playwright's build or $BEIFAHRER_E2E_CHROMIUM)
```

The dev browser runs in its own persistent profile (`~/.cache/beifahrer/dev-*`), is paired
automatically with your local token, and talks to port **47814**, so it never shares the hub
with your everyday browser. Drive it with `gjsify run app/dist/beifahrer.gjs.mjs call <method> --port 47814`.

```sh
gjsify workspace beifahrer-cli test           # unit tests, on GJS and Node
node tests/e2e/browsers.e2e.mjs all           # the full chain in headless Chromium + Firefox
```

Design decisions: [docs/adr/](docs/adr/). Contributor and agent rules: [AGENTS.md](AGENTS.md).

## License

[AGPL-3.0-or-later](LICENSE)
