# Plan — the public pages, the product pictures, and the way into the stores

- **Written:** 2026-11-12 · **Reviewed and rewritten:** 2026-11-16
- **Covers:** two repositories — Beifahrer (this one) and gjsify (`@gjsify/site`, the generator
  behind `https://jumplink.eu/beifahrer/<lang>/` and `/<lang>/extension/`)
- **Goal:** a person who is not a developer understands, on the page, what Beifahrer is and what it
  does to their browser — and can install it from a store.

This is a plan, not a record. Every open step below names its **owner** (agent or Pascal), its
**precondition** and its **done-criterion**. An acceptance criterion is a file, a screenshot or a
green check — never an agent's report.

## Status

| Stream | What it is | State | Next |
|---|---|---|---|
| A | Unblock gjsify, lift Beifahrer onto it | A1–A5 done; the pin bump is blocked | a gjsify release ≥ 0.64.46 with #2673 ([webext-submit.md](webext-submit.md) S6b) |
| B | The two product pictures | B1 done; B2–B7 open, and B6 changed | build the neutral frame (B2) |
| C | The "how it works" band in the generator | not started | design it (C1) |
| D | GNOME Web (Epiphany) on GNOME 51 | **done, verdict: not supported** | nothing; D4 does not happen |
| E | Agent comfort (#143, #153, #154, #210) | done, all four closed 2026-11-16 | — |
| F | The store listing kit and preview | F1/F2 done in gjsify #2628; F3 open | retire `docs/store/listing.md` (F3) |
| G | The way into the stores | accounts and secrets exist; uploads pending | the first upload per store, by hand |
| H | **New: the metainfo's dark screenshots pair wrong** | open, and it is a live bug | add the missing dark window shots (H1) |

## What is true today

Checked in the tree and against the two repositories' PRs on 2026-11-16.

| Fact | Where |
|---|---|
| The extension page is live in DE and EN, with per-language and light/dark screenshots; the app page's download dialog runs on it too; the two pages link to each other | gjsify #2605 |
| Multicolour brand icons on hover, including the Firefox (Fontisto, MIT) and Edge (Font Awesome 7 Free, CC BY 4.0) marks | gjsify #2606, #2617 |
| The render tests for the extension card and the scoped download widget exist | gjsify #2616 |
| `webext listing` writes every store at once (`--stores`), a `store.json` per store with every form field and its limit, promo tiles at 440×280 and 1400×560 from the icon and tagline, and a `preview.html` per store (light/dark, EN/DE, usable at 390 px) | gjsify #2628, ADR 0135 |
| `webext submit` uploads a version to Chrome and Edge, released in gjsify v0.64.45 | gjsify #2631, #2633, #2634 |
| gjsify's newest release is **v0.64.45**; Beifahrer pins `@gjsify/*` at **0.64.40** | `package.json`, `app/package.json`, `extension/package.json`, `gjsify-lock.json` |
| The `<description>` is written for a non-developer: the chain in order, "sends nothing out", the per-site levels, temporary access, confirmations, pause, and what stays off | `data/eu.jumplink.beifahrer.metainfo.xml`, landed in #220 |
| That prose is the one source for the app page, the extension page, Flathub and all four store listings | `gjsify.site.metainfo`, `gjsify.webext.listing.metainfo` |
| `gjsify.webext.targets` is `chrome-mv3`, `edge-mv3`, `firefox-mv2`, `safari-mv3` — the same four as `extension/manifest.ts` | `package.json` (added in PR #252), `extension/manifest.ts:16` |
| The toolbar button is already a status light: monochrome bus when connected and idle, coloured while the agent works, a yellow dot while paused, red without a bridge | `extension/src/toolbar.ts:1-3` |
| The connection diagram exists as text-free, state-via-CSS-class SVG, in a wide and a vertical arrangement | `data/diagram/connection.svg`, `…-vertical.svg`, ADR 0025 |
| Real extension-page screenshots are reproducible per language, light and dark, at 2× | `tests/e2e/ui-pages.mjs`, driven by `tests/e2e/browsers.e2e.mjs chromium` |
| The generator has no "how it works" concept and no hero slot. Its sections: masthead, badges, description blocks, screenshot band, components/downloads, releases, links, related apps, support | gjsify `packages/infra/site/src/render/pages.ts` |
| Epiphany does not start the extension's background page on 51.1 or 51.2, so `tabs` could not even be asked. **Not supported; no `epiphany-mv2` target** | [ADR 0001](../adr/0001-a-browser-extension-not-a-driven-browser.md) § 3, [`probes/epiphany/README.md`](../../probes/epiphany/README.md), issue #6 |
| Chrome has a draft item (nothing submitted). Edge has a product with no package yet. All eight store secrets are set | [webext-submit.md](webext-submit.md) |

## The decisions that stand

### 1. The explanation lives in two places, and the cheap half shipped first

**Prose in the metainfo** (done, #220): one `<description>` feeds four surfaces, so rewriting it for
a non-developer improved the app page, the extension page, Flathub and every store listing in one
commit and cost no gjsify release. AppStream allows only `<p>`, `<ul>` and `<ol>` there — no image,
no column, no per-step icon. That limit is why the second half exists.

**The picture of the chain in the generator** (Stream C): a drawing with steps beside it cannot live
in `<description>` and would read badly on Flathub if forced into it. So `@gjsify/site` gains one
optional section:

```json
"howItWorks": {
  "diagram": { "wide": "data/diagram/connection.svg", "narrow": "data/diagram/connection-vertical.svg", "class": "l1-ok l2-ok" },
  "steps": [{ "icon": "robot", "title": "Your agent asks", "text": "…" }]
}
```

Rendered as one band between the masthead and the screenshot band, on both pages. Nothing about
Beifahrer is compiled into the generator, and the titles are English msgids translated through
`pageTranslations` like every other page string.

*Why a core change and not hand-written HTML here:* the generator owns the page's layout, its
dark-mode query, its phone breakpoint and its translation pipeline. A hand-built band in Beifahrer
would duplicate all four and drift. `@gjsify/site` is a core project; that is the "fix it at the
core" rule.

*Why the existing diagram and not a new drawing:* the person sees exactly that picture in the
extension's options page (ADR 0025). A different drawing on the website would teach a second mental
model of the same chain. The two arrangements already solve the phone — wide above ~420 px, vertical
below, the breakpoint the extension already uses.

*The implementation risk:* inlining a caller-supplied SVG collides on `id` and on `url(#…)` when two
sit on one page. The generator must prefix every `id` and every internal reference on inline, with a
spec test that two bands keep their own gradients. The artwork carries no text and no colour
variables (librsvg reads neither), so labels are rendered *beside* it as the numbered step list.

### 2. The pictures are composed from real captures, by a script in this repository

```
tests/e2e/ui-pages.mjs  ──▶  options-*.png, popup-*.png   (real extension pages, reproducible)
app, under headless-run ──▶  desktop-*.png                 (real app window)
                                 │
                 tools/compose-shots.mjs  ──▶  hero-*.png, agent-chat-*.png   (1280×800 CSS at 2×)
                                 │
                 the website only  ──▶  never the metainfo <screenshots>
```

**Composed images go on the website, never into the metainfo screenshots.** Pascal decided this on
2026-11-16: a metainfo screenshot is a rendition of the app, and a frame drawn around it is
marketing. The metainfo keeps real captures only. This replaces the earlier plan to put the hero
first in `<screenshots>`.

*Why no image generator:* it cannot write correct UI text, cannot produce the same picture twice,
cannot do DE and EN from one source, and anything it draws is a claim about a feature that may not
exist. The repository's rule that fixtures stay synthetic is about honesty; an invented screenshot
breaks it from the other side.

*Why not a photo editor:* eight variants (2 languages × 2 schemes × 2 pictures), redone on every UI
change.

*Why HTML/CSS and not hand-written SVG:* rounded corners, shadows, a tab strip, dark mode and a 2×
render are free in CSS and bad by hand, and the screenshots drop in as `<img>`.

*Where it lives:* Beifahrer — `tools/compose-shots.mjs` plus `tools/compose/` (one HTML template per
picture, one stylesheet, the strings in a small JSON per language). `@gjsify/site` *consumes* images;
it does not author them. The neutral browser frame becomes a candidate for gjsify the day a second
app wants one — note that trigger in the script's header comment, do not pre-port it.

| Part | Source | Rule |
|---|---|---|
| Browser frame, tab strip, address bar, toolbar | drawn in CSS | **fictional and neutral**: no vendor shape, colour or logo. One tab, a synthetic `example.org` address, no profile avatar |
| The Beifahrer toolbar icon in that frame | the real `data/icons/hicolor/scalable/apps/eu.jumplink.beifahrer.svg` | the product's own mark, and it must be recognisable |
| The extension's options page inside the window | a real capture from `ui-pages.mjs` | never redrawn |
| The app window beside it | a real capture under `./scripts/headless-run` | never redrawn |
| Page content behind the extension UI | the e2e's synthetic fixture page | never a real site |
| The agent chat panel | drawn in CSS | **fictional and neutral**: no vendor name, no vendor colour; a generic assistant label from the strings file |
| The tool-call lines in that chat | the real method names (`tabs.list`, `page.read`, `page.click`) | **English in both languages** — that is literally what an agent reads |
| The chat bubbles around them | translated | DE and EN |

Every state shown is a success state, and because colour never speaks alone here either, the words
beside the green dot say so too.

Canvas **1280 × 800 CSS px at `deviceScaleFactor: 2` → 2560 × 1600**: the store size at 2×, so
nothing is re-composed for a store later. `webext listing` scales down and refuses an enlargement
beyond 2×, which a 2560 px source never triggers. Naming follows `docs/images/`:

```
docs/images/hero-light.png        hero-dark.png        hero-de-light.png        hero-de-dark.png
docs/images/agent-chat-light.png  agent-chat-dark.png  agent-chat-de-light.png  agent-chat-de-dark.png
```

**Promo tiles are settled:** Pascal approved the banner design, and `webext listing` already
generates 440×280 and 1400×560 tiles from the icon and the tagline (gjsify #2628). No hand-drawn
tile, and the hero is not a tile.

**Every view must work at 390 px, in DE and EN, light and dark.** That applies to the pages, the
band, and the store preview.

### 3. The order

```
A6 bump Beifahrer ─▶ A7 page rebuild
        ▲
   (gjsify ≥ 0.64.46, see webext-submit.md S6b)

B2 frame ─▶ B3 hero ─▶ B4 chat ─▶ B5 variants ─▶ B6 put them on the website
C1 design band ─▶ C2 build band ─▶ C3 band tests ─▶ C4 release ─▶ C5 wire Beifahrer
H1 dark window shots ─▶ H2 metainfo order
F3 retire listing.md
G1 store preview ─▶ G2 first uploads ─▶ G3 draft run ─▶ G4 public
```

Streams **B, H and F3 start now** — none of them needs gjsify. **C** may be designed in parallel but
merges after the pin bump, because both touch the site package and gjsify's `main` has a merge queue.
**C4 is a second gjsify release, deliberately:** holding one release for a drawing would hold the pin
bump hostage.

**Model tier:** everything here is published open-source code, so the data tier is public. Before
dispatching to a free or Go agent, check the quota (`kontingent`) — an exhausted window means Claude,
not a quiet downgrade. `paid-opus` is for the two genuinely hard design pieces (B2/B3 and C1);
everything else is `paid-sonnet`.

## Stream A — lift Beifahrer onto the current gjsify

| # | Step | Owner | Precondition | Done when |
|---|---|---|---|---|
| A1–A5 | Brand icons (#2606), Fontisto/Font Awesome marks (#2617), render tests (#2616), the release | — | — | **done**: all merged, released in v0.64.45 |
| A6 | Bump every `@gjsify/*` pin 0.64.40 → ≥ 0.64.46 | agent | gjsify #2673 released ([webext-submit.md](webext-submit.md) S6b) | `gjsify upgrade --check` exits 0; `gjsify foreach -A check`, `gjsify run lint`, `oxfmt --check .`, the app unit tests (delete `app/dist-test` first) and `node tests/e2e/browsers.e2e.mjs all` all pass |
| A7 | Rebuild and publish the pages | agent | A6 merged | `https://jumplink.eu/beifahrer/en/extension/` shows the new brand icons; a 390 px-wide capture of it hangs in the PR |

A6 is one bump for two plans: the `submit-stores` job (PR #252) and the page's brand icons are both
waiting on it.

## Stream B — the two product pictures

| # | Step | Owner | Precondition | Done when |
|---|---|---|---|---|
| B1 | A `<description>` a non-developer understands | — | — | **done** (#220): the chain in order, "sends nothing out", levels, temporary access, confirmations, pause, what stays off; DE complete |
| B2 | The neutral browser frame | agent (`paid-opus`) | — | the script writes one PNG of an empty neutral frame at 2560×1600; no vendor mark anywhere in the markup; `oxfmt --check .` and `gjsify run lint` pass |
| B3 | The hero: frame + real options page + real app window | agent (`paid-opus`) | B2 | `docs/images/hero-light.png` at 2560×1600; the options page inside it is the unretouched content of `docs/images/options-light.png`; every status in both halves reads connected; a re-run writes the same file |
| B4 | The agent chat | agent (`paid-opus`) | B3 approved | `docs/images/agent-chat-light.png` at 2560×1600; the assistant is unbranded; the tool-call lines are real method names and English; a re-run is byte-stable |
| B5 | All eight variants | agent | B3, B4 | the eight files exist, each 2560×1600; a byte-compare proves the `-de-` ones differ from the English ones in chat text and UI capture, not only in name |
| B6 | Put them on the website — **not in the metainfo** | agent | B5, and a decision on the mechanism (see the questions) | the extension page and the app page show the hero and the chat picture in DE and EN, light and dark, nothing clipped at 390 px; `data/eu.jumplink.beifahrer.metainfo.xml` is unchanged by this step |
| B7 | One PR carrying the pictures | agent | B6 | the PR body embeds the four light/dark heroes over `raw.githubusercontent.com` plus a 390 px capture of the rendered page; the full Beifahrer gate including e2e is green |

**Checkpoint:** after B3, stop and show Pascal the first hero before the other seven variants exist.
A frame he dislikes is cheap to change once and expensive to change eight times.

## Stream C — the "how it works" band in the generator

| # | Step | Owner | Precondition | Done when |
|---|---|---|---|---|
| C1 | Design the band | agent (`paid-opus`) | — | a design note in the PR body (not a doc) fixes the config shape, where the band sits on both pages, the arrangement below ~420 px, how ids are namespaced, and how dark mode is reached without JavaScript |
| C2 | Build it | agent | C1 | `gjsify.site.howItWorks` renders on both pages; absent config renders nothing; a missing SVG fails the build naming the path (the contract `extension.manifests` already has); `gjsify workspace @gjsify/site run test` passes |
| C3 | Test it | agent | C2 | specs assert: no config → no band; two inlined diagrams on one page keep their own gradients; the step titles come from the catalogue in a non-source language, not from the config literal; the narrow arrangement is in the markup, not swapped by script |
| C4 | Merge and release | agent | C3, A6 | a second patch tag is published and its run is green |
| C5 | Configure the band for Beifahrer | agent | C4 | the built page shows the band in DE and EN, light and dark; at 390 px the vertical diagram sits above the steps with nothing clipped; captures at 390 px and 1280 px hang in the PR |

**Checkpoint:** after C2, show Pascal a locally built page before the tests and the release are
written — the band is the piece most likely to come back with "not like that".

## Stream D — GNOME Web (Epiphany): closed

Re-measured 2026-11-13 against `org.gnome.Epiphany` 51.1 (Fedora Flatpak) and 51.2 (Flathub), on a
throwaway profile, probe on port 47951. **Neither build starts the extension's background page:**
Epiphany logs the extension loading, but the probe's server sees nothing — no WebSocket, no boot
`fetch` — so no API check ran at all. Recorded in
[ADR 0001](../adr/0001-a-browser-extension-not-a-driven-browser.md) § 3,
[`probes/epiphany/README.md`](../../probes/epiphany/README.md) and a comment on issue #6.

**Verdict: not supported. There is no `epiphany-mv2` target and this plan does not add one.** The
earlier blocker (a `tabs` namespace that never answered on 50.6) is kept in both records as history,
because it is the reason the probe asks the background page first and the API second.

What remains, if anything: an issue in *this* repository titled `Upstream (Epiphany, file by hand):
…` holding the facts, so Pascal can file it at GNOME himself. **Never open anything at GNOME.**
Whether issue #6 already serves that purpose is unverified — it holds the measurement, not an
upstream-shaped report.

## Stream E — agent comfort: closed

Issues #143 (`page.rows` stopping early on lazily loaded lists), #153 (say a frame was withheld),
#154 (`access_check` suggesting `page.read`) and #210 (warn when the connected extension is older
than the app) were all closed as completed on 2026-11-16. The mapping of issue to PR is unverified;
the issues' own threads hold it.

The rule that produced them stays: if a comfort change touches `policy.ts`, `preflight.ts` or
`gate.ts`, it leaves the comfort PR and gets its own with `paid-opus`. The hard rules are not
refactored as a side effect of comfort work.

## Stream F — the store listing kit

F1 (measure the gap) and F2 (close it) landed as gjsify #2628: `--stores`, `store.json` per store
with every form field and its limit, promo tiles, and `preview.html` per store. **The preview is a
developer tool and is never published** — it does not go on the website and is not linked from it.

| # | Step | Owner | Precondition | Done when |
|---|---|---|---|---|
| F3 | Retire `docs/store/listing.md` | agent | A6 (the pinned CLI must be the one that writes the kit) | the generated output replaces the hand-written copy; what stays in [`listing.md`](../store/listing.md) is only what no tool can derive, the `<verify>` markers survive, [`docs/store/README.md`](../store/README.md) and [`docs/README.md`](../README.md) point at the generator; `node tools/check-doc-links.mjs` and `gjsify webext listing --check` pass |

`docs/store/README.md` still says the release workflow "deliberately has no store step" and that
nobody has decided whether CI holds the store secrets. Both are now false — PR #252 adds the step
and the secrets are set. F3 fixes that sentence too.

## Stream G — the way into the stores

The order, and who may do each part. **The agent may do everything for publishing except:** create
an account, enter personal data, accept an agreement, pay, pass an identity or 2FA check, create a
provider key, make the **first submission for review**, and **any switch to public**.

| # | Step | Owner | Precondition | Done when |
|---|---|---|---|---|
| G1 | Generate the store preview and show it to Pascal | agent | A6 | `preview.html` exists for all four stores, in DE and EN, light and dark, legible at 390 px, and Pascal has seen it |
| G2 | The first upload per store, by hand | Pascal | G1 approved; the tag's zips | Chrome's draft item holds a version (**unlisted**); Edge's product holds a package (**hidden**) |
| G3 | A dispatch run that uploads a draft | agent | G2, PR #252 merged | both stores show a new draft version from CI and nothing was submitted |
| G4 | The first submission for review, then public | Pascal | G3; promo tiles and the preview approved; Chrome's trader confirmation and the data-use attestations done | the listings are public |

**Visibility:** Chrome **unlisted** first — a real submission nobody can find is the only way to
learn what the review actually asks before the listing is public. Edge **hidden** first, for the same
reason; Edge has no "unlisted" like Chrome, and its mechanism must be read up before G2 (unverified).

**Firefox is self-distributed, not listed on AMO.** `extension/scripts/sign.sh <tag>` signs the XPI
and writes `updates.json`, and the `sign-firefox` job in
[`release.yml`](../../.github/workflows/release.yml) already does it on every tag. The update URL is
fixed in `extension/manifest.ts` and cannot be moved later, so the release asset must be named
exactly `updates.json`.

**Safari is manual:** the `.appex` ships inside the desktop app
([ADR 0026](../adr/0026-safari-extension-ships-inside-the-desktop-app.md)) and needs the MacBook plus
App Store Connect. The Mac App Store path is deferred — Developer ID download first, per that ADR.

**Never a Chromium install outside the stores.** No sideload instructions for Chrome or Edge.

Two side facts that belong to the same release, not to a store: Windows ships unsigned for now (Azure
Artifact Signing identity validation has been pending since 2026-10-30), macOS ships signed and
notarised.

## Stream H — the metainfo's dark screenshots pair with the wrong slides

Found on 2026-11-16 while reviewing this plan, and it is shipping today.

`data/eu.jumplink.beifahrer.metainfo.xml` lists four light screenshots (window, popup, options,
confirm) and **three** `environment="gnome:dark"` ones (popup, options, confirm). The generator pairs
the n-th dark with the n-th light **by document order and nothing else**
(gjsify `src/site-data/metainfo.ts`, `parseScreenshots`). So today the window slide's dark rendition
is the popup, the popup's is the options page, the options page's is the confirmation, and the
confirmation has no dark rendition at all. The build does not fail; it only warns when a dark
screenshot has no light partner, which is not the case here.

| # | Step | Owner | Precondition | Done when |
|---|---|---|---|---|
| H1 | Capture the app window in dark, in both languages | agent | — | `docs/images/desktop-dark.png` and `desktop-de-dark.png` exist, produced the same reproducible way as the light pair |
| H2 | Add them as the first dark screenshot | agent | H1 | the dark block lists window, popup, options, confirm in the same order as the light block; a local `gjsify site build` shows each slide's dark rendition matching its caption in both languages; `appstreamcli validate` is clean |

If a dark capture of the window turns out to be impossible, the fallback is to move the window slide
**last** among the light screenshots so the three existing dark renditions line up — but that
demotes the app's own window below the popup on the page and on Flathub, so H1 is the preferred fix.

## Where Pascal is shown something

The main session stops at these points and does not proceed without a word back:

1. **After B3** — the first hero, before the other seven variants exist.
2. **After C2** — the "how it works" band in a locally built page, before its tests and release.
3. **After B6 / C5 / H2** — the finished page at 1280 px and 390 px, DE and EN, light and dark.
4. **At G1** — the store preview. This is the **only** thing Pascal wants to see before anything is
   submitted, and nothing is submitted or made public without him.

## Risks

1. **The hero is a taste decision, and taste is not a gate.** Eight variants of a frame Pascal
   dislikes is the most wasteful outcome here. Mitigated by the B3 checkpoint and by building the
   frame before any content goes in it.
2. **Inlining a caller-supplied SVG into a generated page.** Id collisions, a gradient that does not
   paint inside `display: none`, and dark mode reached by a class the site never sets — all three
   have already bitten this artwork inside the extension. Mitigated by C3's id-prefixing spec; if it
   proves fragile, fall back to two `<img>` elements behind a `<picture>` media query, which only
   loses the CSS states the website does not need.
3. **The dark pairing is positional** — Stream H is the proof that this bites in practice. Any future
   screenshot added to one block must be added to the other in the same position, and the acceptance
   is a rendered page, never a valid XML file.
4. **One version pin blocks three things.** The page's brand icons (A7), the store job (PR #252) and
   F3 all wait on the same bump, which waits on one open gjsify PR. Stream B, C1 and H are
   deliberately independent of it.
5. **A store key dies quietly.** The Edge API key expires 72 days after 2026-11-14 and announces
   itself as a 401 in a release run. Renewal date and the renewal path live in
   [webext-submit.md](webext-submit.md).
6. **`appstreamcli` and the store validators disagree about screenshots.** The stores want 1280×800
   full-bleed; AppStream wants honest renditions. Composing at exactly 1280×800 at 2× satisfies both
   — but only because composed images stay off the metainfo (Decision 2) and nobody crops the output
   later.

## Questions only Pascal can answer

1. **How does a composed hero reach the page?** The generator has no hero slot, and Decision 2 keeps
   composed images out of the metainfo — so B6 has no mechanism yet. Options: a new optional
   `gjsify.site.hero` in the generator (another core change plus a release), or fold the hero into
   the "how it works" band from Stream C (one change instead of two, but it couples the two
   decisions). **Recommendation: fold it into the band.**
2. **Store categories.** `Developer Tools` (Chrome) and `Developer tools` (Edge) are configured in
   `package.json` today. For a product aimed at people who are not developers, is that still right,
   or `Productivity`?
3. **The Chrome icon padding.** The bus spans 108×93 of the 128×128 canvas; Chrome wants 96×96 of
   artwork centred. Shrink the app icon, wrap it in a padded canvas for Chrome only, or accept the
   downscale? This is a product change, and the docs may not make it.
4. **Where `webext submit` is documented for agents**, given that gjsify's cli `AGENTS.md` is 2 bytes
   under its size limit — see [webext-submit.md](webext-submit.md) S7.
5. **The agent's name in the second picture.** A generic label ("your AI assistant") or an invented
   neutral product name? This plan assumes generic.
6. **How the fictional browser should read.** Neutral-but-plausible, or deliberately stylised so
   nobody mistakes it for a real product? This plan assumes neutral-but-plausible.
7. **Two unverified listing details to confirm before the first submission:** the AMO listing name's
   capitalisation ("Beifahrer") and a reported host-permission mismatch on AMO. Both only matter if
   Firefox is ever listed rather than self-distributed.
8. **Still with Pascal, outside this plan but blocking their own targets:** Chrome's trader
   confirmation via the payments profile (before public), the privacy and data-use attestations,
   Azure Artifact Signing identity validation (pending since 2026-10-30), and App Store Connect for
   Safari, which needs the MacBook.
