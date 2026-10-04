# Store listings

The copy for each store's form. Every line is traced to the file it comes from, so the text cannot
drift from the product: if a string changes in `_locales`, the line below it changes with it, and
the build already refuses a string the stores cannot hold.

## Where each string comes from

| Source file | What it supplies | Length |
|---|---|---|
| [`extension/_locales/en/messages.json`](../../extension/_locales/en/messages.json), key `extName` | the name, in every store form and in the manifest | 9 characters |
| [`extension/_locales/en/messages.json`](../../extension/_locales/en/messages.json), key `extDescription` | the short description, which is also the manifest's `description` (`extension/manifest.ts:105`) | 88 characters |
| [`extension/_locales/de/messages.json`](../../extension/_locales/de/messages.json), same two keys | the German name and description, used wherever a store offers a German listing | 9 / 104 characters |
| the `feature_*_label`, `level_*`, `confirm_*` and `pill_*` keys in the same two files | the phrases quoted in the descriptions and in the screenshots | — |
| [`extension/_locales/en/messages.json`](../../extension/_locales/en/messages.json), key `extDescription` | the manifest description, which Edge reads as the store's *short description* | 88 characters |

Both locale files carry the same 204 keys, and the build refuses a key that is missing from one
([`extension/scripts/locales.ts`](../../extension/scripts/locales.ts)). The build also enforces the
two store limits: 45 characters for the name, 132 for the description
(`extension/scripts/locales.ts:31`), which is why the short description below can be pasted into
Chrome and Edge as it is.

The two strings, verbatim:

> **Beifahrer**
> Let an AI agent use this browser. You choose, site by site, what it may read and change.

> **Beifahrer**
> Lass einen KI-Agenten diesen Browser nutzen. Du legst für jede Seite fest, was er lesen und ändern darf.

The full descriptions below are **not** in `_locales`: nothing in the extension shows them, so there
is no key to keep them honest. They are written here, and the phrases they quote are traced to their
keys. A person who changes a quoted phrase must change the key, or change this file to match — the
build will not catch it, and that is worth knowing.

---

## Firefox, listed on addons.mozilla.org

Submission is the Developer Hub, "On this site" ([submitting an add-on](https://extensionworkshop.com/documentation/publish/submitting-an-add-on/)).
The listing fields below are the ones that page names.

| Field | Value | Source |
|---|---|---|
| Name | Beifahrer | `_locales/*/messages.json` → `extName` |
| Summary (≤ 250 characters) | Let an AI agent ride along in the browser you already use. You decide, site by site, what it may do. | 100 characters. Written here; the 250 limit is stated by [create an appealing listing](https://extensionworkshop.com/documentation/publish/create-an-appealing-listing/), and no `_locales` key holds it |
| Description | the full description below | here |
| Category (up to 2) | *a person decides* — candidates: Productivity, Developer Tools | AMO allows two |
| Support email | *a person's address* | — |
| Support website | *a URL that must resolve* | — |
| License | GNU Affero GPL v3.0 or later | `package.json` → `license` |
| "This add-on has a privacy policy" | tick, and paste [privacy.md](privacy.md) into the field | Beifahrer transmits nothing off the device, so the honest answer is the tick **and** the text — AMO asks for a policy whenever any data is transmitted, and a policy that says "nothing" is still the clearest answer to a reviewer |
| Notes for Reviewers | see below | — |
| Experimental flag | *a person decides* — the honest answer today is yes | Beifahrer is `0.1.0`; the flag is AMO's own reduced-visibility marker |
| Add-on URL | assigned from the name; *a person may change it* | — |

### Full description (English)

> Beifahrer lets an AI agent work in the browser you already have open — your tabs, your sessions,
> your logins — under a policy you set, site by site.
>
> Most tools that drive a browser start a second one: no logins, no history, no idea what you are
> looking at. Beifahrer uses yours. You see what it does, you can stop it, and you decide what it
> may do on each site.
>
> **You choose, per site, what the agent may do.** Three levels, per origin:
> **None** (only the host is visible), **Read** (read the page, change nothing), **Edit** (read, fill
> in fields and click). Nothing is allowed until you allow it, and a site you have not allowed shows
> only its address — never its title or its path.
>
> **You see it working.** A small pill in the tab says the agent is reading or editing, with a Stop
> button on it. The toolbar button changes while it works. A change — a filled field, a click, a
> closed tab — opens a window first, naming the site and the element. You can turn that off for a
> site you watch.
>
> **The capabilities you did not ask for are off.** Screenshots, downloads, saved sessions, tab
> management, the request log and running the agent's own script in a page all start switched off, in
> the extension's own settings, in your browser.
>
> **Nothing leaves your machine.** There is no account, no telemetry and no server. The extension
> talks to a small local program you run yourself, over a connection that only accepts this
> extension. What it stores — your policy, your switches, your saved sessions — stays in your
> browser profile.
>
> Beifahrer is an MCP client for your coding agent. It works with the agent you already use; it does
> not bring one.

### Notes for Reviewers

AMO's form asks for what a reviewer needs, in plain text ([submitting an add-on](https://extensionworkshop.com/documentation/publish/submitting-an-add-on/)).
A draft, for a person to check before pasting:

> Beifahrer is a WebExtension plus a separate local bridge program. The extension is the add-on;
> the bridge is not part of it and is not required for the add-on to install.
>
> The extension has no network code except a WebSocket to `ws://127.0.0.1:<port>`, where `<port>` is
> a port from a range the user configures in the options page (default 47813–47822). The server side
> is a program the user runs themselves; it is not shipped with the add-on and there is no hosted
> service. Firefox users who do not want to run anything get a toolbar button, a per-site policy
> page, a per-site access level, and an in-page indicator — the extension is inert without the bridge.
>
> The add-on requests no host permissions at install. `http://*/*`, `https://*/*` and `<all_urls>` are
> optional host permissions, requested at the moment the user raises a level for a site, turns on
> screenshots, or uses the temporary "all sites" grant. `webRequest` is an optional permission,
> requested in the same click as the "See page requests" switch, which is off by default.
>
> `browser_specific_settings.gecko.data_collection_permissions.required` is `["none"]`, matching
> Mozilla's taxonomy. The only transmission the add-on makes is to the loopback socket above.
>
> The add-on is not minified, and its source is the repository linked in the listing: the build is a
> TypeScript bundle produced by `gjsify`, with the sources and the build steps in the repository.

**A person must check the source-code answer before submitting.** AMO's policy requires a source
package for code that is transpiled or minified, with build instructions
([add-on policies §3](https://extensionworkshop.com/documentation/publish/add-on-policies/)). The
`Reviewers may ask you to refactor parts of the code if it is not reviewable` sentence in that
paragraph is not decorative. Beifahrer's bundle is a real build; the answer is "yes, source in the
repository, here is the build" *only if* the public repository is decided on — see
[README.md](README.md). If it is not public, the add-on's AMO source submission needs a
machine-readable bundle, and that is a piece of work nobody has scheduled.

### Two AMO facts worth knowing before the review

- Automated validation runs first, and signing "can take up to 24 hours … or longer if your
  submission is selected for manual review" ([signing and distribution](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/)). All add-ons, listed or unlisted, are subject to manual review at any time. So the schedule is *unknown*, not *one day* — do not promise a date.
- The listed path exists in parallel with the unlisted one already scripted in [`extension/scripts/sign.sh`](../../extension/scripts/sign.sh). Unlisted needs only the AMO API key; listed needs the listing fields above.

Whether listing on AMO costs anything is `<verify>`: read
[developer-accounts](https://extensionworkshop.com/documentation/publish/developer-accounts/) and
[firefox-add-on-distribution-agreement](https://extensionworkshop.com/documentation/publish/firefox-add-on-distribution-agreement/).
The listing pages read while writing this file state no fee; absence of a fee is not a statement that
there is none.

---

## Chrome Web Store

Package: `beifahrer-0.1.0-chrome-mv3.zip` from the release.

| Field | Value | Source |
|---|---|---|
| Name (≤ 45 characters) | Beifahrer | `_locales/*/messages.json` → `extName`; the limit is enforced at `extension/scripts/locales.ts:31` |
| Summary (≤ 132 characters) | Let an AI agent use this browser. You choose, site by site, what it may read and change. | `_locales/*/messages.json` → `extDescription`, 88 characters. Chrome states the 132 limit in [prepare your extension](https://developer.chrome.com/docs/webstore/prepare) |
| Description | the full description below | here |
| Category | *a person decides* — candidates: Productivity, Developer Tools, Workflow & Planning | — |
| Homepage, support URL | *URLs that must resolve* | — |
| Privacy policy URL | *a URL that must resolve*, serving [privacy.md](privacy.md) | — |
| Single purpose | see below | — |
| Language | English (United States); German available | `_locales/` carries `en` and `de` |
| Icon | 128×128 PNG in the zip, 96×96 artwork with 16 px transparent padding | the store's rule is in [supplying images](https://developer.chrome.com/docs/webstore/images). The icon sizes come from `extension/manifest.ts:48`; the artwork is **not** yet inside 96×96 — measured 121 × 107 px of opaque pixels with margins L7 R0 T5 B16, see [screenshots.md](screenshots.md) |
| Small promo tile (mandatory) | 440×280 | [supplying images](https://developer.chrome.com/docs/webstore/images) |
| Screenshots | 1–5, see [screenshots.md](screenshots.md) | [supplying images](https://developer.chrome.com/docs/webstore/images) |

### Single purpose

Chrome asks for one sentence describing the extension's primary functionality, and warns that
installing or launching another extension or web page is not an acceptable one
([programme policies](https://developer.chrome.com/docs/webstore/program-policies/policies)). A
draft:

> Lets an AI agent act in the user's own browser on web pages the user has allowed, under a per-site
> access policy the user sets in the extension.

### Full description (English)

> Beifahrer lets an AI agent work in the browser you already have open — your tabs, your sessions,
> your logins — under a policy you set, site by site.
>
> Most tools that drive a browser start a second one: no logins, no history, no idea what you are
> looking at. Beifahrer uses yours. You see what it does, you can stop it, and you decide what it
> may do on each site.
>
> **You choose, per site, what the agent may do.** Three levels, per origin: **None** (only the host
> is visible), **Read** (read the page, change nothing), **Edit** (read, fill in fields and click).
> Nothing is allowed until you allow it, and a site you have not allowed shows only its address —
> never its title or its path.
>
> **You see it working.** A small pill in the tab says the agent is reading or editing, with a Stop
> button on it. A change — a filled field, a click, a closed tab — opens a window first, naming the
> site and the element.
>
> **The capabilities you did not ask for are off.** Screenshots, downloads, saved sessions, tab
> management, the request log and running the agent's own script in a page all start switched off.
>
> **Nothing leaves your machine.** No account, no telemetry, no server. The extension talks to a
> small local program you run yourself, over a connection that accepts this extension and nothing
> else. Your policy, your switches and your saved sessions stay in your browser profile.
>
> Requires a local bridge program to be useful; without it the extension installs and does nothing.

The last paragraph is a requirement, not a hedge: a reviewer who installs the zip and sees nothing
happen should be told why, in the listing.

### Per-permission justification

Chrome's form asks why each permission is needed, and the answer is a table of the declared
permissions (`extension/manifest.ts:92` and the optional lists at `extension/manifest.ts:114-120`).
Drafts, each naming the feature it serves:

| Permission | Justification to paste |
|---|---|
| `tabs` | List the user's open tabs, their URLs and their titles, so the agent can address the page the user is looking at. Used by the "See tabs" switch. |
| `storage` | Store the user's own settings in the extension's local storage: the per-site access policy, the feature switches, the pause state, the saved sessions and the pairing token. Nothing is read from another extension's storage and nothing is sent anywhere. |
| `alarms` | Wake the background periodically to look for a local bridge on the configured port range, and to end a temporary access grant when it expires. |
| `sessions` | Read and restore the browser's recently-closed list, so a window the agent closed by mistake — or the user closed by mistake — comes back. Behind the "Saved sessions" switch, which is off by default. |
| `tabGroups` | Name and colour tab groups. Behind the "Manage tabs and windows" switch, off by default. |
| `scripting` | Inject the page agent into a tab the policy has already allowed, and remove it afterwards. No host permission is required for this; the code is only injected after the user's per-site level and the browser's own host grant both say yes. |
| `webRequest` *(optional)* | Show the user what a page requested, with timings, so they can see why a page misbehaves. Off by default, requested in the same click as the switch, and not narrowable to a single site — which is why it is the user's own click and not part of the install. |
| `http://*/*`, `https://*/*` *(optional host)* | The user's temporary "all sites" access, used for saved sessions and tab management, and for a grant the user starts from the popup. Removed again when the grant ends. Not requested at install. |
| `<all_urls>` *(optional host)* | Required by the browser's own `captureVisibleTab` API for the screenshot feature, which is off by default. Firefox does not define the API without this grant. |

The two questions Chrome asks that are **not** about permissions, and that a person must answer on
the form:

- **Remote code.** The answer is no, and the code that supports it is `AGENTS.md`'s rule that no
  capability runs agent-supplied JavaScript by default, plus the runtime refusal
  (`extension/src/handlers.ts`, the `unsupported` branch of `page.evaluate`, which refuses
  `world: "main"`). The exact wording Chrome wants, and whether it asks about the *agent's* script
  specifically, is `<verify>`: read
  [programme policies](https://developer.chrome.com/docs/webstore/program-policies/policies) and the
  Privacy tab in the dashboard.
- **Data use certification.** The honest answer is that Beifahrer collects no data and shares none —
  see [privacy.md](privacy.md) §4 and §5. The certification asks for declarations per data type;
  whether the form can express "no data of any type" without a warning, is `<verify>`.

The one-time registration fee, and its amount, is `<verify>`: the page
([register](https://developer.chrome.com/docs/webstore/register)) states a fee is required before
publishing, and the amount is set on the payment page in the dashboard.

---

## Edge Add-ons

Package: `beifahrer-0.1.0-edge-mv3.zip` — the `chrome-mv3` manifest in full, deliberately
(`extension/manifest.ts:86`).

Edge's flow is a Partner Center account, a `.zip`, and a form
([publish an extension](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension)).
Edge says there is **no registration fee**, and that the account needs a Microsoft account as its
Primary Owner ([create a dev account](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/create-dev-account)).

| Field | Value | Source |
|---|---|---|
| Extension name | Beifahrer | `_locales/*/messages.json` → `extName` |
| Short description | Let an AI agent use this browser. You choose, site by site, what it may read and change. | `_locales/*/messages.json` → `extDescription`. Edge reads this field from the manifest, so changing it means a new package |
| Description (per language) | the full description below, in `en-US` and `de-DE` | here; the English is the Chrome text above, the German a translation a person must check |
| Extension logo (per language) | 1:1, 300×300 recommended, 128×128 minimum | the store rule is on [publish an extension](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension); the source artwork is `extension/icons/sparkles.svg`, rendered by `extension/scripts/icons.ts` |
| Screenshots (optional, up to 6) | 640×480 or 1280×800 | [publish an extension](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension) — see [screenshots.md](screenshots.md) |
| Small promo tile (optional) | 440×280 | same page |
| Large promo tile (optional) | 1400×560 | same page |
| Category | *a person decides* | same page |
| Single purpose description | the same sentence as Chrome's, above | — |
| Privacy policy URL | *a URL that must resolve*, serving [privacy.md](privacy.md) | Edge requires one if the extension accesses, transmits or collects any personal information |
| Privacy statement in the form | *a person's summary; [privacy.md](privacy.md) is longer than the field wants* | — |
| Support / contact | *a person's address* | — |

Edge copies assets between languages with a **Duplicate** action on the form, so the logo and the
screenshots only have to be uploaded once per asset
([publish an extension](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension)).
Use it; do not re-upload a German logo for the German listing.

Edge asks for a single purpose description, not a per-permission justification. If a reviewer asks
anyway, the table in the Chrome section is the answer, and it is the same package.

---

## Opera

Package: `beifahrer-0.1.0-chrome-mv3.zip`.

Opera publishes through its own extensions repository, with a review
([publishing guidelines](https://help.opera.com/en/extensions/publishing-guidelines/)). The rules are
short and specific:

| Field | Value | Source |
|---|---|---|
| Summary | one sentence: Let an AI agent use your own browser, under a per-site policy you set. | 70 characters. Opera's guidance is "summarizing its purpose and functionality in one sentence"; whether the form enforces a character cap is `<verify>` — read the guidelines before pasting |
| Description | the Chrome full description | here |
| Screenshots | 612×408 preferred, 800×600 maximum, white background, the extension shown in the browser UI | [publishing guidelines](https://help.opera.com/en/extensions/publishing-guidelines/) — see [screenshots.md](screenshots.md) |
| Icons | anti-aliased PNG, transparent background, **not interlaced** | [acceptance criteria](https://help.opera.com/en/extensions/acceptance-criteria/) |
| Licence | pick the one the form offers that matches AGPL-3.0-or-later; if none does, *a person decides* | `package.json` |
| Privacy | *whatever the form asks* | [privacy.md](privacy.md) |

Whether Opera charges anything, and whether a Chrome Web Store listing is accepted as an Opera
submission or whether the package must be re-uploaded, is `<verify>`: read
[publishing guidelines](https://help.opera.com/en/extensions/publishing-guidelines/) and
[acceptance criteria](https://help.opera.com/en/extensions/acceptance-criteria/).

---

## Safari

There is no listing to write. A Safari web extension is signed in Xcode against a provisioning
profile and uploaded through App Store Connect by a person, which is why
[`.github/workflows/release.yml:58-61`](../../.github/workflows/release.yml) says so and why
`safari-mv3` ships unsigned on purpose.

What is written down: the target builds and passes its end-to-end test
(`README.md`'s engine table), and the manifest takes the Chromium flavour with a background **page**
instead of a service worker, because Safari's extension service worker hangs on the loopback socket
(`extension/manifest.ts:125-134`). Whether Apple's submission accepts that, and what the review
requires, is `<verify>`:
[developer.apple.com/documentation/safariservices](https://developer.apple.com/documentation/safariservices/safari-web-extensions/).

---

## A human decision remains in

1. **The categories.** Each store asks for one or two, and the right answer is a judgement about who
   this is for. Candidates are written above; the pick is not.
2. **The URLs** — homepage, support, privacy policy. None exists in the repository
   ([README.md](README.md)).
3. **The support contact**, and whether it is a person, a mailing list, or an issue tracker that
   somebody actually reads.
4. **The experimental flag on AMO**, and the honesty of the summary line: the summary says "works",
   and a person has to decide whether that is true of a `0.1.0` whose README calls itself early.
5. **The German listing.** `_locales/de` is written by a person who speaks German; a translation of
   the *full* description has not been made. Edge wants a description per language, so this is not
   optional for the Edge listing — it is a piece of work, not a formality.
6. **Whether the "0.1.0, early" framing stays.** Every store shows the version. A person decides
   whether the first submission says `0.1.0` or waits for a number that means something.
