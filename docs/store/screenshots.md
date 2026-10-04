# Screenshots

## What each store asks for

| Store | Count | Size | Other rules | Source |
|---|---|---|---|---|
| Chrome Web Store | at least 1, at most 5 | 1280×800 preferred, or 640×400 | square corners, no padding, full bleed; all screenshots are downscaled to 640×400 | [supplying images](https://developer.chrome.com/docs/webstore/images) |
| Edge Add-ons | optional, at most 6 | 640×480 or 1280×800 | a screenshot can be duplicated into every other language | [publish an extension](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension) |
| Firefox (AMO) | no practical limit; one set, with per-language captions | 1280×800 recommended, otherwise 1.6:1 | annotate to highlight, but explain the annotation in the caption rather than on the image | [create an appealing listing](https://extensionworkshop.com/documentation/publish/create-an-appealing-listing/) |
| Opera | no stated maximum | **612×408 preferred, 800×600 maximum** | white background; the extension's own button visible in the browser UI; not interlaced PNG | [publishing guidelines](https://help.opera.com/en/extensions/publishing-guidelines/), [acceptance criteria](https://help.opera.com/en/extensions/acceptance-criteria/) |

**Browser chrome may show.** Every store above expects a screenshot *of a browser*, not of a
detached page: Opera says so outright, and AMO asks that the extension's location in the browser UI
be visible. Chrome's rule is only that the image be square-cornered and full bleed — it does not ask
for the frame to be cropped away. So: keep the browser's own window, title bar and toolbar in the
picture, and crop nothing but the surrounding desktop.

Chrome also needs two images that are not screenshots: the 128×128 icon inside the zip, and a
**mandatory** 440×280 small promo tile.

The icon is 128×128, rendered from `extension/icons/sparkles.svg` by
`extension/scripts/icons.ts` — but it does **not** yet meet Chrome's padding rule, and the docs must
not say it does. Measured on `extension/.output/chrome-mv3/icons/idle-128.png`: the opaque artwork
is 121 × 107 px inside the 128 × 128 canvas, with margins L7 R0 T5 B16 — the second sparkle runs to
the right edge. Chrome wants 96×96 of artwork centred in 128×128, so the artwork has to shrink by
about a fifth on each axis. The source SVG is a single 128×128 `viewBox`, so this is a change to
`extension/icons/sparkles.svg` (or a wrapper canvas around it), and it is a **product** change, not
one these docs may make. It is a decision for a person: shrink the artwork, or keep the icon and
accept that Chrome downscales it.

The promo tile is artwork nobody has made yet.

## The rule about what may be in the picture

**Fixtures stay synthetic. Never a captured real site.** What the extension reads is the person's
private data, so a screenshot of a real page is a screenshot of someone's work
([`AGENTS.md`](../../AGENTS.md), hard rules). Every shot below comes from a page this repository
serves itself, on `127.0.0.1`, written by the test suite.

That is not a limitation to apologise for in the plan. The e2e fixtures are already the right
subject matter: a ticket with a heading, a plain comment field, a rich-text editor, a form, a
country dropdown, a terms checkbox
([`tests/e2e/browsers.e2e.mjs:68`](../../tests/e2e/browsers.e2e.mjs)), and a second synthetic page
shaped like a work-package tracker, with a description that is a button until you click it and a
comment box that turns into an editor a moment later
([`tests/e2e/browsers.e2e.mjs:247`](../../tests/e2e/browsers.e2e.mjs)). Those are honest pictures of
what Beifahrer does, and they are pictures of nothing.

## Which shots a script can render today

Three of the five Chrome screenshots, and three of the six Edge ones, are the extension's own pages,
and a script already renders them. [`tests/e2e/ui-pages.mjs`](../../tests/e2e/ui-pages.mjs) opens
`popup.html`, `options.html` and `confirm.html` as the real extension pages in the browser the e2e
already runs, and with `BEIFAHRER_E2E_SCREENSHOTS=<dir>` writes Chromium screenshots of each in light
and dark and Firefox screenshots at two widths. The pages it opens are a fixed list
(`tests/e2e/ui-pages.mjs:25`) at fixed widths (`:26`), with the confirm window on the request an e2e
build holds for it (`:28`).

The images already committed under [`docs/images/`](../../docs/images) came out of exactly that, and
their measured sizes are the honest starting point:

| Existing file | Measured size | What it is |
|---|---|---|
| `popup-light.png`, `popup-dark.png` | 360 × 685 | the toolbar popup |
| `options-light.png`, `options-dark.png` | 800 × 1951 | the options page, full length |
| `confirm-light.png`, `confirm-dark.png` | 520 × 241 | the confirmation window |
| `popup-de-*.png`, `options-de-dark.png` | as above | the same, in German (`BEIFAHRER_E2E_LANG=de`) |

**None of these is store-ready**, and the reason is size, not content: a store wants 1280×800, and
these are 360 px wide. The three shots therefore need one thing a person does with an image editor,
or a small script: capture at the store's aspect ratio with the browser window around it. Until then
they are the *content* of the store shots, and the plan is to compose them, not to re-invent them.

## The production plan

Run the e2e once with a screenshots directory and a language:

```sh
BEIFAHRER_E2E_SCREENSHOTS=/tmp/beifahrer-shots node tests/e2e/browsers.e2e.mjs chromium
```

Everything below uses the output of that one run, on the synthetic fixtures already described.

### 1. The popup — *script can render the content, a person composes the frame*

- **Page:** the toolbar popup, `popup.html`, width 360 (`tests/e2e/ui-pages.mjs:26`).
- **State to show:** a session connected, the per-site level group, the activity log with two or three
  host-only rows. The log's words come from the `method_*` keys — `method_page_read`,
  `method_page_outline` — and the levels from `level_none` / `level_read` / `level_write`, both in
  [`_locales/en/messages.json`](../../extension/_locales/en/messages.json).
- **Framing:** the popup alone is 360×685, so it must be placed inside a 1280×800 window with a real
  browser frame around it. The pixel content exists; the composition does not.
- **Script or person:** the render is scripted; the composition is a person, or a small image script
  that pastes the render into a browser-window template.

### 2. The options page, level group — *script can render the content*

- **Page:** `options.html`. The level group is `level_group_label` ("Access for this site") with the
  three `level_*` values and their `level_*_tip` explanations, one per level
  (`_locales/en/messages.json`).
- **Why this shot:** it is the picture of the central claim — three levels, per origin, the person's
  choice.
- **Framing:** the full page is 800×1951, far taller than 16:10, so this shot needs either a
  scrolled-to-the-levels crop inside a browser frame, or a narrower window. A person decides which;
  a 1951 px page cut in half is a bad screenshot.
- **Script or person:** render scripted, crop a person.

### 3. The options page, feature switches — *script can render the content*

- **Page:** `options.html`, the feature list: `feature_screenshot_label`, `feature_network_label`,
  `feature_manageTabs_label`, `feature_sessions_label`, `feature_script_label` — five of the
  capabilities that are off by default (`packages/core/src/features.ts:95-116`).
- **Why this shot:** "the capabilities you did not ask for are off" is a claim a screenshot carries
  better than a sentence.
- **Framing:** as above.
- **Script or person:** render scripted, crop a person.

### 4. The in-page pill on the synthetic fixture — **needs a person, and a small script change**

- **Page:** the e2e fixture at `http://127.0.0.1:<port>` (`tests/e2e/browsers.e2e.mjs:68`), with the
  agent mid-read, so the pill is showing: "Agent is reading" (`pill_reading`) or, with a session
  label, `$SESSION$ is reading` (`pill_reading_session`).
- **Why this shot:** it is the proof that the person sees the agent. No other shot carries that.
- **What is missing:** nothing renders this today. `BEIFAHRER_E2E_SCREENSHOTS` only writes the three
  extension *pages* (`tests/e2e/ui-pages.mjs:25`); the pill lives in a fixture tab, and no script
  takes a screenshot of a fixture tab. The e2e does drive the fixture through a read, so the state is
  reachable — someone has to add the capture. Concretely: at the point in
  `tests/e2e/browsers.e2e.mjs` where a `page.read` is in flight, call
  `Page.captureScreenshot` over the same DevTools connection `ui-pages.mjs` already uses, with the
  browser window visible.
- **Script or person:** a person writes the ten lines; after that the shot is reproducible.

### 5. The confirmation window over the fixture — **needs a person, and a small script change**

- **Page:** `confirm.html` as a real window on top of the fixture, mid-run. The e2e opens it
  (`tests/e2e/ui-pages.mjs:28` opens it in a tab for the render; `browsers.e2e.mjs` opens it as the
  real popup window during a `confirm` build).
- **Why this shot:** "a change opens a window first, naming the site and the element" —
  `confirm_heading_change` ("Allow this change?"), `confirm_site`, `confirm_click` ("Click
  $TARGET$"), `confirm_allow`, `confirm_deny` (`_locales/en/messages.json`). The window over a page
  is the shot; the window alone is shot 1's neighbour and much weaker.
- **What is missing:** the same as shot 4 — a window composited over a tab in one capture. A person
  decides whether that is two images stitched or one real window, and a person takes it.
- **Script or person:** a person, once, by hand, on the synthetic fixture.

### The 440×280 promo tile — **needs a person, an artist**

Nothing in the repository produces a store promo tile, and a screenshot is the wrong source for one.
It is a designed image: the sparkles mark, the name, on a flat background. `extension/icons/` holds
the two SVG sources, which is a legitimate starting point; the layout is a decision. Mandatory on
Chrome, optional on Edge.

## Which shots, for which store

| Shot | Chrome (5 max) | Edge (6 max) | AMO | Opera (612×408) |
|---|---|---|---|---|
| 1 popup | yes | yes | yes | yes, cropped |
| 2 levels | yes | yes | yes | optional |
| 3 feature switches | yes | yes | yes | no — too tall for 3:2 |
| 4 in-page pill | yes | yes | yes | no |
| 5 confirm window | yes | yes | yes | no |
| promo tile 440×280 | **mandatory**, not a screenshot | optional | no | no |
| icon 128×128 | in the zip, already there | per language | already there | already there |

AMO wants one set of screenshots with captions, so the German captions can be written without new
images ([create an appealing listing](https://extensionworkshop.com/documentation/publish/create-an-appealing-listing/)).
Edge's **Duplicate** action copies a screenshot into the other languages, so upload once.

## A human decision remains in

1. **Whether to spend a subject's attention on a fixture that looks like a test page.** The e2e
   fixtures are honest but plain. A person has to decide whether that is the right picture for a
   store listing, or whether a purpose-built synthetic page — still synthetic, still served by this
   repository, never a captured real site — is worth writing. That is the single biggest decision on
   this page, and it changes shots 4 and 5 most.
2. **The chrome around the extension pages.** Composing 360×685 into a 1280×800 browser window is
   work with no correct answer. A person picks the window size, the tab layout and whether a real
   desktop background shows.
3. **The promo tile's design**, and whether the name goes on it.
4. **Light, dark, or both.** The render produces both. Most stores show one screenshot set per
   language, not per theme. A person decides which is the store's and which stays in the repository.
5. **Whether the in-page pill shot needs a real person in the frame.** Nothing in the extension
   requires one, and inventing a face for a store listing is a decision, not a task.
6. **The icon's padding.** The artwork is 121 × 107 px inside 128 × 128, not the 96 × 96 Chrome asks
   for. Shrinking it is a change to `extension/icons/sparkles.svg` — product work, and the one item
   here that touches the shipped extension rather than the store material.
