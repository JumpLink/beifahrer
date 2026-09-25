# beifahrer

**Let an AI agent ride along in the browser you already use, with you in the driver's seat.**

Agents keep needing the browser that is already open in front of you. They need to know which tab
you are looking at, to read a page you are logged into, or to rewrite a ticket description in
place while you watch. The usual tools start a *separate* browser with no sessions and no idea of
what you see. The ones that attach to your own browser only work with Chromium.

beifahrer is a WebExtension for **Firefox and Chromium-based browsers** plus a small local
**MCP server**. The agent gets a narrow set of tools: list tabs, read a page, outline its fields,
take a screenshot, fill a field, click, open a URL. **You decide, site by site, what it may do.**

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
- The **policy lives in your browser.** Every site is at one of three levels:

  | Level | The agent may |
  |---|---|
  | **Nothing** (default) | see that a tab on that site is open (host only: no title, no path) |
  | **Read** | read the text, get an outline of links, buttons and fields, take a screenshot |
  | **Read + edit** | also fill fields and click. You confirm each change in a browser window unless you switch that off for the site. |

  When you raise a site's level, the browser asks you to grant access to that site. beifahrer has
  no host access until you do.

## What it will never do

- **Run arbitrary JavaScript for the agent.** There is no `evaluate`: every action is one of the
  tools above, so the levels mean what they say.
- **Fill a password field.** You type those yourself.
- **Hold your credentials.** It uses the session you are already logged into.
- **Send anything off your computer.** The only channel is the loopback socket to the bridge you
  run yourself.
- **Switch your tab behind your back.** A screenshot is only taken of the tab you are showing.

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
gjsify workspace beifahrer-cli test           # unit tests, on GJS and Node
node tests/e2e/browsers.e2e.mjs all           # the full chain in headless Chromium + Firefox
```

Design decisions: [docs/adr/](docs/adr/). Contributor and agent rules: [AGENTS.md](AGENTS.md).

## License

[AGPL-3.0-or-later](LICENSE)
