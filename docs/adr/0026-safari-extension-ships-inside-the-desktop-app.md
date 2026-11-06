# 0026: The Safari extension ships inside the desktop app, not its own Xcode shell

- **Status:** accepted (decided by the person, 2026-11-05: one app, well integrated, never Apple's
  template shell; amended the same day with the Variant-1-now decision: Developer-ID download first,
  App Sandbox for that download later, the Mac App Store last, with the same app throughout). The
  window's Safari row and the Swift helper that reads its state ship together with this amendment;
  Firefox/Chromium install rows stay a separate change.
- **Date:** 2026-11-05
- **Relates to:** [0017](0017-native-desktop-app.md) (the window is a view, never a policy — kept
  here), [0002](0002-build-on-gjs-not-wxt.md) (the extension is bundled on GJS), `docs/macos-run.md`
  §3 (the Xcode packaging step this ADR builds on, not replaces)
- **Asked for by:** the person, 2026-11-05: ship Safari's `.appex` inside the existing GJS desktop
  app, well integrated — a Safari row in the window (state, "Open Safari Settings", a pairing hint),
  translated — and a longer-term goal of helping with every browser's install/enable step from one
  app, without becoming a policy surface.

## Context

`xcrun safari-web-extension-packager` (§3.2) already produces a working, ad-hoc-signed
`Beifahrer.app` that carries the extension as an `.appex` under `Contents/PlugIns/` — Apple's own
template shell: a Swift container with one window that only says "the extension is on/off", in
English, under the SAME bundle id as the desktop app (`eu.jumplink.beifahrer`). Two apps cannot
both own that id. The question this ADR answers is which app wins, and whether the other one's
`.appex` can be grafted onto it.

## Decision

**1. One app. The GJS desktop app (ADR 0017) is the container; the template shell is discarded.**
The packager is still useful — it is the only tool that turns `extension/.output/safari-mv3` into a
correctly-shaped `.appex` with Safari's own extension-point metadata — but only as a *source* of
that one directory. What ships to a person is the existing `Beifahrer.app` from `gjsify ship
darwin`, with the `.appex` copied into its own `Contents/PlugIns/` and both re-signed as one unit.
**Measured, § 3 below: this works.** macOS registers the extension with the GJS app as its parent
bundle, by the path and the identifier alone — nothing about the template project is special.

**2. Plan B, not chosen: a second small app with its own id (`eu.jumplink.beifahrer.safari` or
similar), shipped alongside the desktop app.** Rejected because it reintroduces exactly what ADR
0017 avoided for the window — a second surface a person has to find and keep updated — for a
feature (enabling one browser's extension) that belongs beside the Firefox/Chromium rows the
desktop app will also grow. One app, one icon, one "Beifahrer helps you turn on your browser"
story.

**3. The window gains a Safari row, under ADR 0017's existing limits — nothing new is granted.**
State (`enabled` / `disabled` / `unknown`, read-only), a button "Open Safari Settings", and a short
hint about pairing (§3.5 of `docs/macos-run.md`). **No pause, no resume, no feature switch, no site
level** — the row reads Safari's own answer to "is this extension on", never Beifahrer's policy, so
ADR 0017 §2's test (a pause/level field cannot be added to the status view by accident) still holds:
this is a THIRD kind of field, "is the host app's extension enabled", disjoint from both the
forbidden fields and the registry ADR 0015 already exposes. Every string the person reads goes
through gettext (en source, de catalogue), per the workspace's "every app is multilingual" rule
(root `AGENTS.md`) and this repo's i18n discipline (`AGENTS.md` § Leitplanken).

**Safari is optional, never a requirement, on macOS exactly as Firefox and Chromium are** (decided
by the maintainer, 2026-11-05): the person picks the browser they use, and nothing here steers that
choice. Embedding the `.appex` into the release build (§ 1) and shipping `Contents/Helpers/
safari-ext-helper` beside it (§ 4) activate nothing by themselves — Safari only turns an extension
on when the person checks it in Safari's own Settings (`docs/macos-run.md` §3.3), the same gate a
Developer-ID-signed, notarised extension has always needed regardless of this app. The window's row
reflects that: it is worded as one option among several ("Safari (optional)"), "off" is read as the
row's normal resting state and not as a warning, and it carries no colour, icon or wording that
would make a person feel they are missing a required step. It also plays no part in the connection
ladder (ADR 0014) or the window's overall status — a person who never touches Safari sees exactly
the same "Ready" state as one who does.

**4. Reading state and opening Settings needs a small Swift helper in the bundle — measured
viable, § 4.** `SFSafariExtensionManager.getStateOfSafariExtension` and
`SFSafariApplication.showPreferencesForExtension` are Objective-C/Swift APIs with no
GObject-Introspection surface, so neither `gi://` nor `@gjsify/node-gi` can reach them — this is not
a gjsify gap, it is a different binding technology entirely. The window execs a tiny Swift binary
(`Contents/Helpers/safari-ext-helper`, built with `swiftc`, no Xcode project needed) via
`Gio.Subprocess`, one argv, parses one line of stdout — the same shape the workspace already
requires for "shelling out where an API exists" (gjsify AGENTS.md § anti-patterns: never an
interpolated command line, always an argv array; here there is no GI API at all, which is the
narrow exception that rule already allows).

**5. Signing: the Developer-ID-signed container needs no `disable-library-validation`; the ad-hoc
path from §3.2 still does.** Measured, § 3 below, confirms gjsify's own finding
(`packages/infra/cli/src/utils/ship/signing.ts`): a NAMED identity signs the whole closure (GJS
binary, node-gi, the whole GTK/libadwaita closure, the Safari `.appex`) with one Team ID, so
`dyld`'s library-validation check has nothing to object to — the entitlement that exists only to
route around an ad-hoc signature's missing team is not needed here. The appex keeps its own
sandbox entitlements (`com.apple.security.app-sandbox`, file access) exactly as the packager wrote
them; the container app needs `allow-jit`, `allow-unsigned-executable-memory`,
`disable-executable-page-protection` and `allow-dyld-environment-variables` — SpiderMonkey's JIT
and `@gjsify/node-gi`'s `DYLD_*` re-exec, both already named in gjsify's own entitlement set, and
nothing beyond them.

**6. Notarisation already runs in CI — `docs/macos-run.md` §3.4's "not done here" is out of date.**
The macOS release job already signs with a Developer ID certificate and notarises through
`notarytool`, then staples the ticket (`.github/workflows/ci.yml`'s `macos` job: secrets
`APPLE_DEVELOPER_ID_P12_BASE64`/`_PASSWORD`, `APPLE_NOTARY_KEY_P8`/`_ID`/`_ISSUER_ID`, invoked by
`release.yml` passing `sign: true`); a shipped release already carries `"notarized": true` in its
`.gjsify-release.json` (v0.1.25 on). Once gjsify closes § 6 below and embeds the `.appex` before the
outer bundle is sealed, the embedded extension is notarised automatically in the SAME submission —
`notarytool` inspects the whole signed bundle, inner Mach-Os included, so there is no separate
Apple-side action for the extension beyond what the app's own release already does.
<verify: whether the first real submission after embedding lands raises a notary finding specific to
the `.appex` (its own sandbox entitlements, its extension-point `Info.plist` keys) that a plain GJS
app never triggered> — unmeasured, because no embedded build has been submitted yet.

## § 3 — Probe: embedding, signing, and launch (measured 2026-11-05, macOS 27 / Xcode 27.1 / arm64)

Done under throwaway ids (`eu.jumplink.beifahrer.probe[2]`) so the running agent session's own
paired Safari extension (`eu.jumplink.beifahrer.Extension`) was never touched; both probes were
unregistered (`pluginkit -r`, `lsregister -u`) and deleted from `/tmp` before this ADR was written,
and the real extension's registration was re-checked afterwards and is unchanged.

- **Embedding + registration.** Copied the real `.appex` (built by §3.2) into a copy of the GJS
  app's `gjsify ship darwin --stage` output, at `Contents/PlugIns/`, with both bundle ids rewritten
  to the probe's own (`…probe.Extension` nested under `…probe`). `pluginkit -a` plus
  `lsregister -dump` show the system reading it correctly: `pluginIdentifier:
  eu.jumplink.beifahrer.probe.Extension`, `parent: Beifahrer (0x…)`, `extension point ID:
  com.apple.Safari.web-extension` — registered under the GJS app as parent, from the path alone.
  `pluginkit -m` (the "matched" view, as opposed to the registration the dump shows) did not list
  it, consistent with Safari's own UI being the only place that turns registration into an enabled
  extension (`docs/macos-run.md` §3.3) — not evidence against embedding.
- **Signing + Hardened Runtime.** Re-signed the appex's executable, re-sealed the appex, signed
  every Mach-O in the GJS app's closure (106+ images: the GTK/libadwaita/node-gi closure,
  `node_gi.node`, the `node` helper) with `codesign --force --sign "Developer ID Application:
  Pascal Garber (XB8ZR5XCD5)" --options runtime --timestamp`, then sealed the outer bundle.
  `codesign --verify --deep --strict` exits 0. `spctl -a -vv` answers `rejected … source=Unnotarized
  Developer ID` — expected and unrelated to the embedding (same verdict the un-merged app already
  gave in `docs/macos-run.md` §3.4).
- **Does it start?** Built a fresh **arm64** stage (`gjsify ship darwin --stage` — the repo's
  existing stage was a stale x64 one, unrunnable on this host without Rosetta, which is not
  installed; unrelated to this ADR and not fixed here). `beifahrer token` (exercises the Node runtime
  + `@beifahrer/local`'s file access) ran and printed a token. Launching the full window (`beifahrer`,
  no args) stayed alive past 4 s with no `dyld … different Team IDs` error and only a benign
  `Gdk-WARNING` — the GTK4/libadwaita/node-gi closure loads under Hardened Runtime with the four
  entitlements of § 5, confirming gjsify's own measurement (`disable-library-validation` is an
  ad-hoc-only grant) now holds for a REAL Developer ID identity too, not only in gjsify's own test
  fixtures.

## § 4 — Probe: reading extension state from GJS (measured 2026-11-05)

No GI binding exists for `SafariServices`. A bare Swift source
(`SFSafariExtensionManager.getStateOfSafariExtension(withIdentifier:completionHandler:)`, blocked
on a `DispatchGroup` to bridge the completion handler to one line of stdout) compiles with plain
`swiftc` — no Xcode project — and runs as a standalone executable, no app-bundle context needed for
the query itself. Run against a nonexistent id it answers `SFErrorDomain` cleanly; run against the
real `eu.jumplink.beifahrer.Extension` id was deliberately NOT done here, as a read of the real
state still means invoking Apple's framework against the person's live Safari, and the task scope
draws the line at "no Safari UI, no Safari state change" — a query the person has not asked for yet
is still an unasked-for touch. The pattern a future implementation should take: the same helper
binary also exposes `SFSafariApplication.showPreferencesForExtension` for the window's "Open Safari
Settings" button — that call DOES open Safari UI, so it must only ever run from the person's own
click, never probed or called automatically.

## Consequences

- The window's Safari row is new UI, deferred to a follow-up change — this ADR only clears the
  architecture and the signing path.
- `extension/scripts/safari-build.sh` (a3cbd26) stays as the step that produces the `.appex` — a
  new step after it copies that `.appex` into the GJS app's stage before `gjsify ship darwin`
  signs the whole thing; the Xcode-built *container* app is discarded, not its extension payload.
- Firefox and Chromium install rows (open a signed unlisted `.xpi`; link to the store listing) are
  the stated longer-term direction and are out of scope for this ADR; each needs its own measurement
  before a row is added, same as Safari's.
- <verify: whether the Swift helper needs code-signing entitlements of its own> — the probe ran it
  unsigned, outside any app bundle. Once it ships inside `Contents/Helpers/`, it is one more Mach-O
  the darwin signer in gjsify's `signing.ts` must find and sign; it took no entitlements in the
  probe and none are expected (it opens no files, makes no network call), but this is unmeasured
  inside a sealed, Hardened-Runtime bundle.
- <verify: whether `showPreferencesForExtension` requires the calling process to be a GUI app in the
  foreground> — unmeasured; the probe never called it. Relevant because the helper would be exec'd
  as a background subprocess of the GJS app, not a foreground app itself.

## § 5 — Firefox/Chromium, for the same "help installing" goal, with their own ceilings

- **Firefox:** a signed, unlisted `.xpi` can be opened directly (`open -a Firefox path.xpi` or
  Firefox's own file association) and Firefox's own UI takes over from there — no code can finish
  the install for the person, same ceiling as Safari's "allow unsigned extensions" checkbox
  (`docs/macos-run.md` §3.3).
- **Chromium:** no unpacked-load path survives branded Chrome ≥ 137 (`docs/macos-run.md` §2.1) — the
  only route for a real person is the Web Store listing, so the app's row there is a link, not an
  install action.
- Both are **unmeasured in this task** (scope was Safari only) and are named here only so a later
  ADR revising this one does not have to re-derive why Safari, Firefox and Chromium each get a
  different verb (open Settings / open a file / open a link) rather than one shared "install"
  button.

## § 6 — gjsify gaps named, not fixed here

**CLOSED at gjsify 0.64.21** (gjsify#2548, `c2b66a81d`, "ship darwin nested bundles and
helpers"): `gjsify.ship.nestedBundles` + `gjsify.ship.helperExecutables` (darwin-only,
`resolveShipNestedBundles`/`resolveShipHelperExecutables` in `utils/ship/settings.ts`) stage a
`.appex` under `Contents/PlugIns/` and a prebuilt executable under `Contents/Helpers/`, and
`signPayload` seals the inner bundle FIRST through the same `sealAddPrefix` mechanism, recursively
— exactly the core capability this section asked for. Beifahrer's own config is
`app/package.json#gjsify.ship.nestedBundles`/`.helperExecutables`, pointing at the stable output
paths `extension/scripts/safari-build.sh` and `app/native/safari-ext-helper/build.sh` now produce
(`extension/.output-safari-appex/`, `app/native/safari-ext-helper/.build/safari-ext-helper`); the
hand-rolled copy-then-sign-twice this section used to describe is gone — `gjsify ship darwin`
does it.

Below is kept as the record of what was true before 0.64.21, per this workspace's rule against
deleting the incident a fix answers: `gjsify ship darwin` had no notion of a second nested bundle
under `Contents/PlugIns/`, and `utils/ship/signing.ts`'s `signPayload` signed every Mach-O it found
flat, in one payload — it had no step that would seal an INNER bundle (the `.appex`) before
sealing the OUTER one, which is the order this ADR's probe needed and had to do by hand (§3's "the
appex is signed and sealed FIRST").

Store metadata is a second, separate gjsify gap, named here for Stufe 3 (§ 8) and not fixed in this
task: gjsify's ADR 0135 (`gjsify/gjsify/docs/adr/0135-store-listings-come-from-the-metainfo.md`,
Proposed) already derives Chrome Web Store / Edge / AMO listings from
`data/eu.jumplink.beifahrer.metainfo.xml` plus the gettext catalogues (`gjsify webext listing`,
`packages/infra/site/src/listing/`), so hand-written store text never drifts from the one source.
Two things that command does not cover yet, both App
Store Connect only: **(a)** ADR 0135 names no App Store Connect target — name → App Name, summary →
Subtitle, description → the long description, keywords → Keywords, `<releases>` → "What's New",
`<url>` entries → Support/Marketing/Privacy URL, `<categories>` → primary category, the OARS
`content_rating` → age rating, and screenshots fitted to the Mac sizes App Store Connect wants
(`<verify: the exact field length limits>` — unmeasured here, Apple's limits were not looked up for
this task); **(b)** `packages/infra/cli/src/utils/ship/plist.ts` deliberately omits
`LSApplicationCategoryType` and `NSHumanReadableCopyright` (its own header names them as left out
because "nothing a reader here can derive" them) — both ARE derivable from the metainfo
(`<categories>` and `<project_license>`/developer name) and the Mac App Store wants them in
`Info.plist`. Nothing in gjsify is changed by this task; both points go in `docs/gjsify-gaps.md`
for whoever builds Stufe 3.

## § 7 — Updates

The Safari extension has **no update channel of its own** — unlike Firefox and Chromium, it never
checks anywhere for a newer version; it updates only when the person installs a newer `Beifahrer.app`
(App Store or Developer-ID download, Stufe-dependent). This is not a gap to close, it is what "ships
inside the app" (§ 1) already means: Safari resolves an extension's version from its parent app's
bundle, the same way `pluginkit` resolved its identity in § 3. Contrast with the other two builds,
each on its own ceiling:

- **Firefox** carries `update_url` in its manifest (`extension/manifest.ts`, `UPDATE_URL`,
  `https://github.com/JumpLink/beifahrer/releases/latest/download/updates.json`) — the browser polls
  that file itself and updates the `.xpi` without the app's involvement at all.
- **Chromium** updates through its Web Store entry once one exists (§ 5); until then it has no update
  path either, same as today.

**One product version (AGENTS.md § Conventions) is what makes the coupling harmless.** Core and the
extension's wire protocol stay version-stamped and checked at connect time regardless of which half
updated when (`packages/core`'s handshake), so a person running an older Safari build against a newer
bridge — or the reverse, for the short window between an app update landing and Safari re-registering
it — sees a mismatch the same way Firefox or Chromium already would, not a new failure mode Safari
invents.

**Follow-up, not decided here:** whether the window should show an update hint or check itself (today
ADR 0017 §3 says "no network access at all, updates arrive through the package manager" for the
Flatpak/deb/rpm builds — a Developer-ID download has no package manager doing that for it). Named as
a question, left `<verify: whether and how the window should notice a newer Developer-ID build exists>` — no
code, no decision.

## § 8 — Stufenplan (decided by the person, 2026-11-05: Variante 1 jetzt, Rest schrittweise)

**Stufe 1 — now.** Developer-ID-signed, notarised download (§ 6 of the Decision, § 3 probe). The
container app is **unsandboxed** (no `com.apple.security.app-sandbox` entitlement — only the four
Hardened-Runtime ones § 5 names); the `.appex` keeps the `app-sandbox` entitlement the packager wrote
for it (§ 5), because Safari requires every extension to be sandboxed regardless of its host. This is
the state § 3's probe measured and the window's Safari row (this change) ships against.

**Stufe 2 — App Sandbox for the Developer-ID download too**, later, analogous to how the Flatpak
build is already confined (`gjsify.ship.flatpak.finishArgs` in `app/package.json`:
`--filesystem=xdg-config/beifahrer:create` etc., pinned by the test in
`app/tests/unit/bridge/config-dir.test.ts`) — the maintainer's own comparison is "App Sandbox is to
Developer ID what Flatpak already is to Linux: a good security model, not a store requirement."
Nothing below is measured; every line is `<verify>`:

- <verify: which mechanism shares the pairing token between the sandboxed container app and the
  `.appex`> — two candidates, neither tried: an **App Group**
  (`com.apple.security.application-groups`, team-ID-prefixed, shared between both bundle ids) with the
  token moved out of `configDir()`'s plain `~/Library/Application Support/beifahrer` into the group
  container; or the **CLI running from the same signed bundle** (same container, so the existing
  `configDir()` path is already inside the sandbox's own home and needs no entitlement at all) —
  cheaper if it is sufficient, since it adds nothing new to verify.
- <verify: which network entitlement the sandboxed bridge needs> — `com.apple.security.network.server`
  (it listens on loopback for the extension) and possibly `.client`; unmeasured inside a sealed
  sandboxed container, where § 3's unsandboxed probe never had to ask.
- <verify: `com.apple.security.inherit` for the Swift helper> — a sandboxed parent's child process
  needs this entitlement to inherit the parent's sandbox rather than running unsandboxed itself or
  failing to spawn; untried here, since Stufe 1's container is unsandboxed and the helper (§ 4, this
  change) was never run under App Sandbox.
- The entitlement declaration itself is a cross-platform modelling gap, not a Beifahrer-specific one:
  Flatpak's `finishArgs`, macOS entitlements and (eventually) MSIX capabilities all say the same thing
  — "this sandboxed app may reach this resource" — in three incompatible vocabularies that
  `app/package.json`'s `gjsify.ship` block today encodes three separate ways. Named here and in
  `docs/gjsify-gaps.md`, NOT built: a shared permission model belongs in gjsify
  (`packages/infra/cli/src/utils/ship/`), the same "fix at the core" rule § 6 above already applies to
  the nested-bundle gap.

**Stufe 3 — Mac App Store, same app.** Needs: an **Apple Distribution** certificate (not Developer
ID) and a matching **provisioning profile**; a `.pkg` built with `productbuild`, signed with a
**Mac Installer Distribution** certificate (a third identity, distinct from both signing certs
above); upload through the **App Store Connect API** (an ASC API key, the same family of credential
`notarytool` already uses for Stufe 1, but a different endpoint); **App Review is not guaranteed** —
unlike Developer-ID notarisation, which is close to automatic once the signing is correct, a human
reviews the submission and can reject it, for reasons unmeasured here. **Plan B, not chosen for Stufe
3 either:** a small separate sandboxed app with its own id (`eu.jumplink.beifahrer.safari`) carrying
only the extension — the same "second surface" objection the Decision's § 2 already raised against
doing this for Stufe 1, restated because the Mac App Store is the one distribution channel where a
thin wrapper is a common pattern and still rejected here for the same reason. **If a person ever has
both the Developer-ID app and the Mac-App-Store app installed**, Safari would show two entries for
what is, from the person's side, the same product — named here as a consequence to watch for, not
solved (the two would need to carry the same extension id and differ only in their container's,
which already breaks Safari's "two apps cannot both own that id" rule from the Context above, so this
is actually a reason Stufe 3 must replace Stufe 1's install, not sit beside it; `<verify>` how the two
distribution channels are meant to coexist on one machine, if at all). **Licence:** the project is
AGPL-3.0-or-later (AGENTS.md § Conventions); App Store Review Guidelines do not forbid AGPL code, and
with Pascal as sole author there is no second copyright holder whose consent an App-Store-specific
term would need — this stops being true the day a second contributor's PR is merged, at which point
consent (or a licence carve-out) becomes necessary before a Stufe-3 submission. **iOS:** Safari Web
Extensions on iOS/iPadOS ship ONLY through the App Store — there is no Developer-ID or "allow unsigned
extensions" path there at all, so an iOS release is Stufe 3 or nothing, never Stufe 1 or 2.
