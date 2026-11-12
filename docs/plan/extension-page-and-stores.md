# Plan — the public pages, the two product pictures, and the way into the stores

- **Written:** 2026-11-12
- **Covers:** two repositories — Beifahrer (this one) and gjsify (`@gjsify/site`, the generator
  behind `https://jumplink.eu/beifahrer/<lang>/` and `/<lang>/extension/`)
- **Goal:** a person who is not a developer understands, on the page, what Beifahrer is and what it
  does to their browser — and can install it from a store.

This is a plan, not a record. The main session executes it autonomously: open pull requests, check
them, merge them, cut releases. Every step below names its repository, branch, files, the gate that
proves it, what it depends on, which model tier runs it, and whether it may run beside its
neighbours. **An acceptance criterion is a file, a screenshot or a green check — never an agent's
report.**

## Table of contents

- [What is already true](#what-is-already-true)
- [The four questions this plan answers](#the-four-questions-this-plan-answers)
- [Decision 1 — where the explanation lives](#decision-1--where-the-explanation-lives)
- [Decision 2 — how the two pictures are produced](#decision-2--how-the-two-pictures-are-produced)
- [Decision 3 — the order of the streams](#decision-3--the-order-of-the-streams)
- [Stream A — unblock gjsify and lift Beifahrer onto it](#stream-a--unblock-gjsify-and-lift-beifahrer-onto-it)
- [Stream B — the two product pictures](#stream-b--the-two-product-pictures)
- [Stream C — the "how it works" band in the generator](#stream-c--the-how-it-works-band-in-the-generator)
- [Stream D — GNOME Web (Epiphany) on GNOME 51](#stream-d--gnome-web-epiphany-on-gnome-51)
- [Stream E — agent comfort](#stream-e--agent-comfort)
- [Stream F — the store preview tool](#stream-f--the-store-preview-tool)
- [Stream G — the way into the stores](#stream-g--the-way-into-the-stores)
- [Where the person is shown something](#where-the-person-is-shown-something)
- [Risks](#risks)
- [Questions only the person can answer](#questions-only-the-person-can-answer)

## What is already true

Read before touching anything; each line was checked in the tree on 2026-11-12.

| Fact | Where |
|---|---|
| The extension page is live in DE and EN, with per-language and light/dark screenshots; the app page's download dialog also runs on it; the two pages link to each other | gjsify #2605, merged |
| Brand icons with multicolour hover are **open, not merged** | gjsify #2606, `OPEN` |
| Firefox (Fontisto, MIT) and Edge (Font Awesome 7 Free, CC BY 4.0) marks sit on a branch off #2606 and must be rebased onto `main` once #2606 lands | `feat/site-brand-icons-fontisto`, commit `55c417014f`, worktree `/home/jumplink/Projekte/.worktrees/gjsify-brand-icons` |
| Beifahrer pins `@gjsify/*` at 0.64.30; gjsify is at v0.64.33 | `package.json`, `app/package.json`, `extension/package.json`, `gjsify-lock.json` |
| The page body's prose is the metainfo `<description>` — one source for the app page, the extension page and all four store listings | `data/eu.jumplink.beifahrer.metainfo.xml`, `gjsify.site.metainfo` |
| The generator has no "how it works" concept. Sections are: masthead, badges, description blocks, screenshot band, components/downloads, releases, links, related apps, support | `packages/infra/site/src/render/pages.ts` |
| The connection diagram already exists as **text-free, state-via-CSS-class SVG**, in two arrangements | `data/diagram/connection.svg`, `data/diagram/connection-vertical.svg` (ADR 0025) |
| Real extension-page screenshots are produced reproducibly, per language, light and dark, at 2× | `tests/e2e/ui-pages.mjs`, driven by `tests/e2e/browsers.e2e.mjs chromium` |
| `<screenshots>` holds popup, options, confirm — three light, three dark, each with a `xml:lang="de"` twin. **The dark twins pair by document order**, nothing else | `data/…metainfo.xml:49-86` |
| `gjsify webext listing` already derives per-store name/summary/description/permissions, scales and letterboxes screenshots to each store's exact size, and checks every length | `packages/infra/site/README.md` § Store listings, ADR 0135 |
| Epiphany's blocker is no longer the crash; it is a `tabs` namespace that does not answer (50.6) and a background page that never starts (51.1 nightly), measured 2026-10-01 | ADR 0001 § 3, `probes/epiphany/README.md`, issue #6 (`OPEN`) |

## The four questions this plan answers

1. **Both pages must explain the product.** Agent ↔ the bridge inside the app ↔ the extension ↔
   the browser; what stays on the device; what the person grants and takes back (pause, all sites,
   confirmations). In DE and EN, light and dark, and legible on a 390 px phone held upright.
2. **A hero picture** — a neutral, fictional browser window with the extension's options page open
   *and* the Beifahrer app beside it, everything green and connected.
3. **A second picture** — a fictional agent chat operating that browser, with the tool calls visible.
4. **GNOME Web measured again** on GNOME 51, and supported if it passes.

## Decision 1 — where the explanation lives

**Split it in two, and ship the cheap half first.**

### 1a. Prose belongs in the metainfo (Beifahrer only, no generator change)

The `<description>` already feeds four surfaces at once. Rewriting it for a non-developer therefore
improves the app page, the extension page, Flathub and every store listing in a single commit, and
costs no release of gjsify. Do this first (step B1), so the person sees better words before any
expensive work starts.

AppStream permits only `<p>`, `<ul>` and `<ol>` there. That is the limit this half must respect: no
image, no two-column layout, no per-step icon.

### 1b. The picture of the chain belongs in the generator (gjsify, with a test)

The explanation the person asked for is a *drawing with steps beside it*, which `<description>`
cannot hold and which would read badly on Flathub if forced into it. So add one optional section to
`@gjsify/site`:

```json
"howItWorks": {
  "diagram": { "wide": "data/diagram/connection.svg", "narrow": "data/diagram/connection-vertical.svg", "class": "l1-ok l2-ok" },
  "steps": [
    { "icon": "robot", "title": "Your agent asks", "text": "…" },
    …
  ]
}
```

Rendered as one band between the masthead and the screenshot band, on **both** the app page and the
extension page. Nothing about Beifahrer is compiled in — the generator's own rule — and the titles
and texts are English msgids translated through `pageTranslations`, like every other page string.

**Why this is worth a core change rather than hand-written HTML in Beifahrer:** the generator is
the only place that owns the page's layout, its dark-mode query, its phone breakpoint and its
translation pipeline. A hand-built band in Beifahrer would duplicate all four and drift from them.
That is the "fix it at the core" rule, and `@gjsify/site` is a core project.

**Why the diagram is the extension's own artwork and not a new drawing:** the person sees exactly
that picture in the extension's options page today (ADR 0025). Showing a *different* drawing on the
website would teach a second mental model of the same chain. Reusing the file makes the website and
the product agree by construction, and the two arrangements already solve the phone: `connection.svg`
wide, `connection-vertical.svg` below ~420 px, which is the breakpoint the extension already uses.

**The implementation risk, and its answer:** inlining a caller-supplied SVG collides on `id` and on
`url(#…)` references when two of them are on one page. The generator must prefix every `id` and
every internal reference on inline, and a spec test must assert that two bands on one page keep
their own gradients. The artwork carries no text and no colour variables (librsvg cannot read
either), so the labels are rendered *beside* it as the numbered step list — which is what the
extension does, and what makes the band work upright on a phone.

## Decision 2 — how the two pictures are produced

**An HTML/CSS composition, rendered headless by the Playwright Chromium the e2e already uses,
driven by a script in this repository, fed by the real screenshots.**

```
tests/e2e/ui-pages.mjs  ──▶  options-*.png, popup-*.png   (real extension pages, already reproducible)
app, under headless-run ──▶  app-*.png                     (real app window)
                                 │
                 tools/compose-shots.mjs  ──▶  hero-*.png, agent-chat-*.png   (1280×800 CSS at 2×)
                                 │
                 metainfo <screenshots>  ──▶  the web page, Flathub
                 gjsify webext listing   ──▶  the store screenshots
```

**Why not an image generator.** It cannot write correct UI text, cannot produce the same picture
twice, cannot do DE and EN from one source, and anything it draws is a claim about a product
feature that may not exist. The repository's rule that fixtures stay synthetic is about honesty,
and an invented screenshot breaks it from the other side.

**Why not a photo-editor composition by hand.** It would have to be redone for every one of the
eight variants (2 languages × 2 schemes × 2 pictures) and again on every UI change.

**Why HTML/CSS and not SVG by hand.** The frame needs rounded corners, shadows, a tab strip, dark
mode and a 2× render — all of which CSS does for free and a hand-written SVG does badly — and the
screenshots drop in as `<img>`.

**Where it lives:** Beifahrer, `tools/compose-shots.mjs` plus `tools/compose/` (one HTML template
per picture, one stylesheet, the strings in a small JSON per language). `@gjsify/site` *consumes*
images; it does not author them. The neutral browser frame becomes a candidate for gjsify the day a
second app wants one — note that trigger in the script's header comment, do not pre-port it.

### What is drawn and what is captured

| Part | Source | Rule |
|---|---|---|
| Browser window frame, tab strip, address bar, toolbar | drawn in CSS | **fictional and neutral**: no vendor shape, no vendor colour, no logo. One tab, a synthetic `example.org` address, no profile avatar |
| The Beifahrer toolbar icon in that frame | the real `data/icons/hicolor/scalable/apps/eu.jumplink.beifahrer.svg` | it is the product's own mark and must be recognisable |
| The extension's options page inside the window | real screenshot from `ui-pages.mjs` | never redrawn |
| The Beifahrer app window beside it | real screenshot of the app under `headless-run` | never redrawn |
| Page content behind the extension UI | the e2e's synthetic fixture page | never a real site |
| Agent chat panel (second picture) | drawn in CSS | **fictional and neutral**: no Claude, no ChatGPT, no vendor colour. A generic assistant name from the strings file |
| The tool-call lines in that chat | the real method names (`tabs.list`, `page.read`, `page.click`) | they stay **English in both languages** — that is literally what an agent reads, and the repository's i18n rule says so |
| Chat bubbles around them | translated | DE and EN |

Every state shown is a success state: both links connected, the dot green, and — because colour
never speaks alone here either — the words beside it saying so.

### Files, sizes and wiring

Canvas **1280 × 800 CSS px, rendered at `deviceScaleFactor: 2` → 2560 × 1600**. That is the store
size at 2×, so nothing has to be re-composed for a store later; `gjsify webext listing` scales down
and refuses an enlargement beyond 2×, and a 2560 px source never triggers that.

Naming follows the convention already in `docs/images/`:

```
docs/images/hero-light.png        hero-dark.png        hero-de-light.png        hero-de-dark.png
docs/images/agent-chat-light.png  agent-chat-dark.png  agent-chat-de-light.png  agent-chat-de-dark.png
```

In the metainfo they go **first**, before popup/options/confirm, because the first screenshot is
what the page and Flathub lead with. The dark block must then list its five entries in exactly the
same order as the light block — the generator pairs the n-th dark with the n-th light by document
order and nothing else, so a reordered dark block silently captions the wrong picture. The spec
step (B6) asserts the pairing, not the eye.

## Decision 3 — the order of the streams

```
A1 merge #2606 ─▶ A2 rebase icons ─▶ A3 icon PR ─▶ A4 specs PR ─▶ A5 release ─▶ A6 bump Beifahrer ─▶ A7 page rebuild
                                                                                        │
C1 design band ─▶ C2 build band ─▶ C3 band tests ─▶ C4 release ────────────────────────▶ C5 wire Beifahrer
                                                                                        ▲
B1 metainfo prose ─▶ B2 frame ─▶ B3 hero ─▶ B4 chat ─▶ B5 variants ─▶ B6 metainfo wiring
D1 refresh ─▶ D2 measure ─▶ D3 document ─▶ (D4 epiphany-mv2, only if it passes)
E1 agent comfort
F1 listing gap ─▶ F2 store preview ─▶ F3 retire listing.md
G  blocked on the person
```

Streams **B, D and E start immediately and in parallel with A** — none of them touches gjsify.
Stream **C** may be designed in parallel but merges after A, because both touch the site package and
`main` has a merge queue.

**Two gjsify releases, not one.** The icon work is ready now and unblocks the version bump; the band
is design work that will iterate. Holding the release for the band would hold the bump hostage to a
drawing. Patch releases are cheap.

### Model tier for every step

All of this is published open-source code, so the data tier is public. But the Go quota is spent and
the Gemini window is empty, so **no free or Go agent is used in this plan** — the company Claude
account only. `paid-opus` is reserved for the two genuinely hard pieces of design; everything else is
`paid-sonnet`. At most 10 Claude agents at once; this plan never needs more than four.

## Stream A — unblock gjsify and lift Beifahrer onto it

| # | Step | Repo / worktree | Branch | Files | Acceptance | Gate | Depends | Tier | Parallel |
|---|---|---|---|---|---|---|---|---|---|
| A1 | Land the multicolour brand icons | gjsify, `/home/jumplink/Projekte/.worktrees/gjsify-dev` (read-only use) | — | — | `gh pr view 2606 --json state` says `MERGED` | the PR's three required checks | — | `paid-sonnet` | with B, D, E |
| A2 | Rebase `feat/site-brand-icons-fontisto` onto the new `main` | gjsify, `/home/jumplink/Projekte/.worktrees/gjsify-brand-icons` | same | `packages/infra/site/src/render/icons.ts`, the icon assets | `git log --oneline origin/main..HEAD` shows one commit, `git merge-base --is-ancestor origin/main HEAD` succeeds | `gjsify workspace @gjsify/site run test` | A1 | `paid-sonnet` | — |
| A3 | Open and merge the icon PR | same worktree | same | — | PR `MERGED`; the licence of each mark (Fontisto MIT, Font Awesome 7 Free CC BY 4.0) named in the file that uses it | three required checks; commit-message lint | A2 | `paid-sonnet` | — |
| A4 | The missing render tests | gjsify, new worktree `gjsify-site-specs` | `test/site-page-fragments` | `packages/infra/site/src/render/pages.spec.ts` | the file asserts (a) `extensionCard` renders a link to `/<lang>/extension/` and is absent without `gjsify.site.extension`, (b) `downloadWidget(ctx, only)` restricted to the extension's targets emits only those and no OS tab strip | `gjsify workspace @gjsify/site run test`; PR green | — (may start before A1, merges after A3) | `paid-sonnet` | with A1–A3 |
| A5 | Cut a patch release | gjsify | — | — | `gh release view` shows the new tag with the icon commit in it | `gh workflow run release-cut.yml --repo gjsify/gjsify -f increment=patch -f dry_run=false`, then the run is green | A3, A4 | `paid-sonnet` | — |
| A6 | Lift Beifahrer onto it | beifahrer, `main` | `chore/bump-gjsify` | `package.json`, `app/package.json`, `extension/package.json`, `gjsify-lock.json` | every `@gjsify/*` pin is the same new version; `gjsify upgrade --check` exits 0 | `gjsify foreach -A check`, `oxfmt --check .`, `gjsify run lint`, app unit tests (delete `app/dist-test` first), `node tests/e2e/browsers.e2e.mjs all` | A5 | `paid-sonnet` | — |
| A7 | Rebuild and publish the pages | beifahrer | — | — | `https://jumplink.eu/beifahrer/en/extension/` shows the new brand icons; a 390 px-wide screenshot of it is attached to the PR | `GITHUB_TOKEN=$(gh auth token) gjsify site build` locally first | A6 | `paid-sonnet` | — |

## Stream B — the two product pictures

| # | Step | Repo | Branch | Files | Acceptance | Gate | Depends | Tier | Parallel |
|---|---|---|---|---|---|---|---|---|---|
| B1 | Rewrite the description for a non-developer | beifahrer | `docs/metainfo-prose` | `data/eu.jumplink.beifahrer.metainfo.xml`, `docs/store/po/*.po` | the `<description>` names the chain in order (agent → the app's bridge → the extension → the browser), says nothing leaves the device, and names pause, per-site levels and confirmation; DE catalogue complete | `gjsify webext listing --check` (lengths per store), `node tools/check-doc-links.mjs` | — | `paid-opus` (the words are the product) | with A, D, E |
| B2 | The neutral browser frame | beifahrer | `feat/compose-shots` | `tools/compose-shots.mjs`, `tools/compose/frame.html`, `tools/compose/compose.css`, `tools/compose/strings.{en,de}.json` | running the script writes one PNG of an empty neutral frame at 2560×1600; no vendor mark anywhere in the markup | `oxfmt --check .`, `gjsify run lint` | — | `paid-opus` (the look is the decision) | — |
| B3 | **The hero** — frame + real options page + real app window | beifahrer | same | `tools/compose/hero.html`, app-window capture under `./scripts/headless-run` | `docs/images/hero-light.png` exists at 2560×1600; the options page inside it is byte-identical content to `docs/images/options-light.png`, not a redraw; every status in both halves reads connected | script re-run produces the same file | B2 | `paid-opus` | — |
| B4 | **The agent chat** | beifahrer | same | `tools/compose/agent-chat.html` | `docs/images/agent-chat-light.png` at 2560×1600; the assistant is unbranded; the tool-call lines are real method names and are English; the browser beside it is the same neutral frame | re-run is byte-stable | B2 | `paid-opus` | after B3 |
| B5 | All eight variants | beifahrer | same | — | eight files exist with the names in Decision 2, each 2560×1600; the `-de-` ones differ from the English ones in the chat text and the UI screenshot, not only in file name | `ls -l docs/images/{hero,agent-chat}-*.png`; a byte-compare proves DE ≠ EN | B3, B4 | `paid-sonnet` | — |
| B6 | Wire them into the metainfo | beifahrer | same | `data/eu.jumplink.beifahrer.metainfo.xml` | hero first, chat second, then popup/options/confirm — and the `gnome:dark` block in the **same order**; each has its `xml:lang="de"` image; captions per language | a local `gjsify site build` renders five slides in both languages and both schemes with no "dropped without a partner" warning; `appstreamcli validate` clean | B5, and the generator from A5 | `paid-sonnet` | — |
| B7 | PR with the pictures in its body | beifahrer | same | orphan `pr-assets/product-shots` | the PR body embeds the four light/dark heroes over `raw.githubusercontent.com`, plus a 390 px-wide shot of the rendered page | full Beifahrer gate incl. e2e | B6 | `paid-sonnet` | — |

**Checkpoint:** after B3, stop and show the person the first hero before the other seven variants are
produced. A frame they dislike is cheap to change once and expensive to change eight times.

## Stream C — the "how it works" band in the generator

| # | Step | Repo / worktree | Branch | Files | Acceptance | Gate | Depends | Tier | Parallel |
|---|---|---|---|---|---|---|---|---|---|
| C1 | Design the band | gjsify, new worktree `gjsify-howitworks` | `feat/site-how-it-works` | a short design note in the PR body, not a doc | the note fixes: the config shape, where the band sits on both pages, the phone arrangement (vertical SVG above the steps below ~420 px), how ids are namespaced, and how dark mode is reached without JavaScript | — | — | `paid-opus` | with A, B |
| C2 | Build it | same | same | `packages/infra/site/src/site-data/config.ts`, `types.ts`, `src/render/how-it-works.ts` (new), `pages.ts`, `extension.ts`, `src/styles/`, `po/` | `gjsify.site.howItWorks` renders on both pages; absent config renders nothing; a missing SVG file fails the build naming the path (the same contract `extension.manifests` has) | `gjsify workspace @gjsify/site run test` | C1 | `paid-sonnet` | — |
| C3 | Test it | same | same | `src/render/how-it-works.spec.ts`, `pages.spec.ts` | tests assert: no config → no band; two inlined diagrams on one page keep their own gradients (id prefixing); the step titles come from the catalogue, not the config literal, in a non-source language; the narrow arrangement is present in the markup, not swapped by script | `gjsify workspace @gjsify/site run test`, PR green | C2 | `paid-sonnet` | — |
| C4 | Merge and release | gjsify | — | — | second patch tag published | three required checks; `release-cut.yml` green | C3, A5 | `paid-sonnet` | — |
| C5 | Configure the band for Beifahrer | beifahrer | `feat/site-how-it-works` | root `package.json` (`gjsify.site.howItWorks`), `site/po/de.po`, reusing `data/diagram/*.svg` | the built page shows the band in DE and EN, light and dark; at 390 px the vertical diagram sits above the steps and nothing is clipped | local `gjsify site build`; screenshots at 390 px and 1280 px in the PR body | C4, A6 | `paid-sonnet` | — |

**Checkpoint:** after C2, show the person a locally built page before the tests and the release are
written — the band is the piece most likely to come back with "not like that".

## Stream D — GNOME Web (Epiphany) on GNOME 51

The system is now GNOME Shell 51.1 with Web 51.1. The previous verdict (2026-10-01) was: the crash
is gone, but `tabs` does not answer on stable and the nightly starts no background page.

| # | Step | Repo | Files | Acceptance | Gate | Depends | Tier |
|---|---|---|---|---|---|---|---|
| D1 | Refresh both Flatpaks and record the exact versions | beifahrer | — | the two version strings are written into the run's notes before anything is measured | `flatpak info org.gnome.Epiphany` and `…Epiphany.Devel` | — | `paid-sonnet` |
| D2 | Run the probe on a throwaway profile | beifahrer | `probes/epiphany/` (unchanged unless a check is missing) | `report.jsonl` exists with a line per check for each of the two builds | exactly the recipe in `probes/epiphany/README.md`: profile under `$HOME/.var/app/org.gnome.Epiphany/probe`, `default-browser=false` in the keyfile, server on **port 47951** (47813–47822 are the person's), the browser under `./scripts/headless-run -- …`, `run_in_background`. **Never the person's real profile.** | D1 | `paid-sonnet` |
| D3 | Write down what it says | beifahrer | ADR 0001 § 3 (append a dated measurement row — the section is explicitly "measured, not claimed" and has been appended to before), `probes/epiphany/README.md` § Last measured, a comment on issue #6 | the ADR and the probe README state the same verdict with the same two version strings; issue #6 carries the result | `node tools/check-doc-links.mjs`, `oxfmt --check .` | D2 | `paid-sonnet` |
| D4 | **Only if it passes:** an `epiphany-mv2` target | beifahrer | `extension/manifest.ts` (`TARGETS`), the build, `docs/traps-browser-platform.md` | the target builds; the extension connects from Web 51.1; no screenshot method is offered on it (`captureVisibleTab` does not exist) and tab state is polled, because only `onCreated`/`onRemoved` fire | full Beifahrer gate; a manual run on the throwaway profile, captured as a screenshot | D3 | `paid-sonnet`, escalate to `paid-opus` if the polling model touches `policy.ts` |
| D5 | **Only if it fails:** an issue in *this* repository | beifahrer | — | an issue titled `Upstream (Epiphany, file by hand): …` holding the facts, so the person can file it at GNOME himself. **Never open anything at GNOME.** | — | D3 | `paid-sonnet` |

## Stream E — agent comfort

| # | Step | Repo | Branch | Scope | Acceptance | Gate | Tier |
|---|---|---|---|---|---|---|---|
| E1 | One PR for issues #143, #153, #154, #210 | beifahrer | `feat/agent-comfort` | read each issue first; keep the commits atomic inside the one PR | each issue's stated behaviour is covered by a test in this repository, named in the PR body next to the issue number | full Beifahrer gate incl. e2e | `paid-sonnet` |

Independent of everything else; runs from day one. If any of the four turns out to touch `policy.ts`,
`preflight.ts` or `gate.ts`, it leaves this PR and gets its own, with `paid-opus` — the hard rules are
not refactored as a side effect of comfort work.

## Stream F — the store preview tool

A **developer tool, never published**. Before building anything, measure the gap: `gjsify webext
listing` already writes per-store name, summary, description, `permissions.md`, scaled and
letterboxed screenshots and the icon, and already fails on a length violation.

| # | Step | Repo | Files | Acceptance | Gate | Depends | Tier |
|---|---|---|---|---|---|---|---|
| F1 | Write down what is missing | gjsify, worktree `gjsify-store-preview` | the PR body | a table: for each store form field, whether `listing` emits it today | — | A5 | `paid-sonnet` |
| F2 | Close the gap | gjsify | `packages/infra/site/src/listing/` | whatever F1 found is missing — expected: `--stores` for all at once, a `store.json` describing the submission, and the promo tile. Each with a test | `gjsify workspace @gjsify/site run test` | F1 | `paid-sonnet` |
| F3 | Retire `docs/store/listing.md` | beifahrer | `docs/store/listing.md`, `docs/store/README.md`, `docs/README.md` | the generated output replaces the hand-written copy; what remains in `listing.md` is only what no tool can derive, and the `<verify>` markers survive | `node tools/check-doc-links.mjs`, `gjsify webext listing --check` | F2 | `paid-sonnet` |

## Stream G — the way into the stores

The order, once the accounts exist (they do not yet — see the questions):

1. **Chrome Web Store, unlisted first.** A real submission that nobody can find yet: it is the only
   way to learn what the review actually asks before the listing is public.
2. **Edge, hidden.** Same package, same reason.
3. **Firefox, self-distributed.** `extension/scripts/sign.sh <tag>` signs the XPI and writes
   `updates.json`; the update URL is already fixed in `extension/manifest.ts` and cannot be moved
   later. The asset must be named exactly `updates.json` on the release.
4. **Never a Chromium install outside the stores.** No sideload instructions for Chrome or Edge.
5. Safari waits for the MacBook and for a certificate that does not exist yet.

Nothing in this stream is started by an agent: each one needs an account a person holds, and the
release workflow deliberately has no store step.

## Where the person is shown something

The main session stops and shows a picture at these four points, and does not proceed past them
without a word back:

1. **After B3** — the first hero, before the other seven variants exist.
2. **After C2** — the "how it works" band in a locally built page, before its tests and release.
3. **After B6 / C5** — the finished page at 1280 px and at 390 px, DE and EN, light and dark.
4. **After D3** — the Epiphany verdict in one paragraph, because it decides whether D4 happens at all.

## Risks

1. **The hero is a taste decision, and taste is not a gate.** Eight variants of a frame the person
   dislikes is the single most wasteful outcome in this plan. Mitigated by the B3 checkpoint, and by
   building the frame (B2) before any content goes in it.
2. **Inlining a caller-supplied SVG into a generated page.** Id collisions, a gradient that does not
   paint inside `display: none`, and dark mode reached by a class the site does not set. All three
   have already bitten this artwork once inside the extension. Mitigated by the id-prefixing test in
   C3 — and if it proves fragile, fall back to two `<img>` elements with a `<picture>` media query,
   which loses the CSS states the website does not need anyway.
3. **The dark screenshot pairing is positional.** Adding two pictures at the front of the metainfo
   means editing two blocks that must stay in lockstep; a mistake captions the wrong image and the
   build only warns. Mitigated by B6's acceptance being a rendered page, not a valid XML file.
4. **Two gjsify releases plus a merge queue** make Stream A a long serial chain. If #2606 stalls in
   review, A2–A7 all stall with it, and B is the only stream still moving. Accepted deliberately:
   B needs nothing from gjsify until B6.
5. **The Epiphany measurement may half-pass** — a background page that runs but a `tabs` namespace
   that answers only sometimes. That is the worst case, because it invites shipping a target that
   fails in the person's hands. The rule for D4 is a run the person can see, not a green probe.
6. **`appstreamcli` and the store validators disagree about screenshot rules.** The stores want
   1280×800 full-bleed; AppStream wants honest renditions. Composing at exactly 1280×800 at 2×
   satisfies both, but only as long as nobody crops the output later.

## Questions only the person can answer

1. **The two store accounts.** Chrome Web Store (registered developer, one-time fee) and Microsoft
   Partner Center. Nothing in Stream G starts without them. Is the Chrome registration done?
2. **The promo tile.** Chrome requires a 440×280 tile, and no artwork for it exists. Should the
   composition script (B2) also produce it from the hero, or is this a drawing the person wants to
   make himself?
3. **The Chrome icon padding.** The bus spans 108×93 of the 128×128 canvas; Chrome wants 96×96 of
   artwork centred. Shrink the app icon, wrap it in a padded canvas for Chrome only, or accept the
   downscale? This is a product change and the docs may not make it.
4. **Store categories.** `Developer Tools` (CWS) and `Developer tools` (Edge) are configured today.
   For a product aimed at people who are not developers, is that still right — or `Productivity`?
5. **The agent's name in the second picture.** A generic label ("your AI assistant") or an invented
   neutral product name? Generic is the safer default and this plan assumes it.
6. **How the fictional browser should read.** Neutral-but-plausible (a tab strip and an address bar
   that look like any browser) or deliberately stylised, so nobody mistakes it for a real product?
   This plan assumes neutral-but-plausible.
7. **Windows signing** (Azure Artifact Signing, identity check in progress) and **Safari on the
   MacBook** — both outside this plan, both blocking their own targets.
