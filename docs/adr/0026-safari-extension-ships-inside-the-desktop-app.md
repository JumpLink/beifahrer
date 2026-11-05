# 0026: The Safari extension ships inside the desktop app, not its own Xcode shell

- **Status:** accepted (decided by the person, 2026-11-05: one app, well integrated, never Apple's
  template shell). Implementation (the window's Safari row, the Swift helper, Firefox/Chromium
  install rows) is a SEPARATE change — this ADR only records the decision and the probe it rests on.
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

**6. Notarisation is unaffected by the merge.** Embedding the `.appex` inside the already-Developer-ID
app does not change `docs/macos-run.md` §3.4's finding: a certificate exists now (this task
confirmed it in the keychain), notarisation itself is a separate Apple-side action needing the
person's explicit submission, out of scope here as before.

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
  installed; separately worth fixing, see § 7 below). `beifahrer token` (exercises the Node runtime
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

`gjsify ship darwin` has no notion of a second nested bundle under `Contents/PlugIns/`, and
`utils/ship/signing.ts`'s `signPayload` signs every Mach-O it finds flat, in one payload — it has no
step that would seal an INNER bundle (the `.appex`) before sealing the OUTER one, which is the
order this ADR's probe needed and had to do by hand (§3's "the appex is signed and sealed FIRST").
Named in `docs/gjsify-gaps.md`, not implemented here per the workspace's "fix at the core" rule: the
core capability — `--extra-plugin <dir>:<target-path>` or similar, staged like
`utils/ship/app-runtime.ts` stages a carried runtime, signed through the SAME `sealAddPrefix`
mechanism `signing.ts` already has for the outer bundle, recursively for the inner one — belongs in
`gjsify/gjsify`, in `packages/infra/cli/src/utils/ship/`, with its own test
(`tests/e2e/ship-layout` already states the darwin layout's file-set as an equality; a nested
bundle is a second equality one level in). Until it lands, Beifahrer's own build step does the
copy-then-sign-twice by hand, as measured in § 3.
