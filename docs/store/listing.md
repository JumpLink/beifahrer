# What the listing generator does not write

`gjsify webext listing` derives the text of every store form: name, summary, description, category,
single purpose, per-permission justifications, icon, promo tiles and screenshots. The inputs are
`data/eu.jumplink.beifahrer.metainfo.xml`, the German catalogue in `docs/store/po/de.po` and the
`gjsify.webext.listing` block in `package.json`. Run `gjsify webext listing --out <dir>` to write the
kit (`--stores cws,edge,amo` picks stores) and `gjsify webext listing --check` to validate it against
the store limits; CI runs the check. **Change a listing text in those inputs, never here.**

This file holds only what no tool can derive: answers to questionnaires, the Firefox, Opera and
Safari routes (the generator writes no Opera kit and no Safari listing), and the decisions that stay
with a person. Every `<verify>` below is a question, not a gap: read the page it names before
pasting anything into a store form ([README.md](README.md)).

---

## Firefox, listed on addons.mozilla.org

Submission is the Developer Hub, "On this site" ([submitting an add-on](https://extensionworkshop.com/documentation/publish/submitting-an-add-on/)).
The generator writes the name, summary, description, icon and screenshots (`--stores amo`). These
fields it leaves to a person:

| Field | Value |
|---|---|
| Category (up to 2) | *a person decides*; AMO allows two |
| Support email | *a person's address* |
| Support website | <https://jumplink.eu/beifahrer/> is live; a dedicated support page or the issue tracker is a person's decision |
| License | GNU Affero GPL v3.0 or later (`package.json` → `license`) |
| "This add-on has a privacy policy" | tick, and paste [privacy.md](privacy.md) into the field. Beifahrer transmits nothing off the device, so the honest answer is the tick **and** the text; a policy that says "nothing" is still the clearest answer to a reviewer |
| Experimental flag | *a person decides*; the honest answer today is yes. Beifahrer is `0.1.0`, and the flag is AMO's own reduced-visibility marker |
| Add-on URL | assigned from the name; *a person may change it* |

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
paragraph is not decorative. Beifahrer's bundle is a real build, and the repository is public (`gh repo view --json visibility`), so the answer is "yes, source in the repository, here is the build".

### Two AMO facts worth knowing before the review

- Automated validation runs first, and signing "can take up to 24 hours … or longer if your
  submission is selected for manual review" ([signing and distribution](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/)). All add-ons, listed or unlisted, are subject to manual review at any time. So the schedule is *unknown*, not *one day* — do not promise a date.
- A version number exists once across BOTH channels ([addons-server API](https://mozilla.github.io/addons-server/topics/api/addons.html): "unique across all channels, and for listed versions, higher than all previously signed versions"). So listed REPLACES the unlisted path in [`extension/scripts/sign.sh`](../../extension/scripts/sign.sh) rather than running beside it: 0.1.34 was the last unlisted version, and the first listed one is the next. The upload is `beifahrer-<version>-firefox-amo.zip`, which drops `update_url` because AMO refuses it on a listed version (MANIFEST_UPDATE_URL).

Whether listing on AMO costs anything is `<verify>`: read
[developer-accounts](https://extensionworkshop.com/documentation/publish/developer-accounts/) and
[firefox-add-on-distribution-agreement](https://extensionworkshop.com/documentation/publish/firefox-add-on-distribution-agreement/).
The listing pages read while writing this file state no fee; absence of a fee is not a statement that
there is none.

---

## Chrome Web Store and Edge Add-ons

The generator writes both forms except the questionnaires below. The one-time Chrome registration fee
is covered under "Chrome's questions".

### Chrome's questions

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

### Edge's questions

- **Certification notes.** The one free-text field Edge offers; the generator marks it `manual`.
  A person writes it from the data-use answer above.
- **Privacy statement in the form.** *A person's summary*; [privacy.md](privacy.md) is longer than the
  field wants.
- **Support contact.** *A person's address.*
- **Registration.** Edge states there is no registration fee and that the account needs a Microsoft
  account as its Primary Owner
  ([create a dev account](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/create-dev-account)).

---

## Opera

Package: `beifahrer-0.1.0-chrome-mv3.zip`.

Opera publishes through its own extensions repository, with a review
([publishing guidelines](https://help.opera.com/en/extensions/publishing-guidelines/)). The rules are
short and specific:

| Field | Value | Source |
|---|---|---|
| Summary | one sentence: Let an AI agent use your own browser, under a per-site policy you set. | 70 characters. Opera's guidance is "summarizing its purpose and functionality in one sentence"; whether the form enforces a character cap is `<verify>` — read the guidelines before pasting |
| Description | the Chrome description from the generated kit (`cws/en/description.txt`) |
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

There is no store listing to write, but there are now **two** distribution routes, not one — see
[macos-run.md §3.4](../macos-run.md#34-developer-id-distribution-outside-the-mac-app-store-researched-not-built)
for the sourced detail:

1. **Mac App Store.** Signed in Xcode against a provisioning profile, uploaded through App Store
   Connect by a person — why [`.github/workflows/release.yml:58-61`](../../.github/workflows/release.yml)
   says so, and why `safari-mv3` ships unsigned on purpose.
2. **Developer ID + notarization, outside the App Store** (Safari 18.4+ / macOS Sequoia 15.4+,
   [Apple's own page](https://developer.apple.com/documentation/safariservices/distributing-your-safari-web-extension#Distribute-your-Developer-ID-signed-and-notarized-extension-outside-the-Mac-App-Store)):
   the same `.dmg`/`.zip` a Developer-ID Mac app ships as, no store review. Blocked today on a
   Developer ID Application certificate that does not exist yet for this account.

What is written down either way: the target builds and passes its end-to-end test (`README.md`'s
engine table), the manifest takes the Chromium flavour with a background **page** instead of a
service worker because Safari's extension service worker hangs on the loopback socket
(`extension/manifest.ts:125-134`), and `extension/scripts/safari-build.sh` produces an ad-hoc-signed,
locally-runnable `.app` for development (macos-run.md §3.2) — neither store's signing, but the same
Xcode project either route would sign.

---

## A human decision remains in

1. **The categories on AMO.** The CWS and Edge categories are set in `package.json`; AMO's are not.
2. **The support contact**, and whether it is a person, a mailing list, or an issue tracker that
   somebody actually reads.
3. **The experimental flag on AMO**, and the honesty of the summary line: the summary says "works",
   and a person has to decide whether that is true of a `0.1.0` whose README calls itself early.
4. **Whether the "0.1.0, early" framing stays.** Every store shows the version. A person decides
   whether the first submission says `0.1.0` or waits for a number that means something.
