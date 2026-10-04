# Code traps already paid for

Measured facts about this codebase's own logic — the ones where correct-looking code silently did
the wrong thing. Moved out of [AGENTS.md](../AGENTS.md); the incident behind each rule stays with
it, so it cannot be "simplified" back into the bug.

Companion files: [traps-browser-platform.md](traps-browser-platform.md) ·
[traps-build-and-test.md](traps-build-and-test.md) · [gjsify-gaps.md](gjsify-gaps.md).

## Policy and refs

- **`decide()` returns a UNION, and the allowed branch carries no level.** `{ allow: true, confirm }`
  has no `have` and no `origin`; only the refused branch has them. So `atLeast(decision.have, 'read')`
  on a decision that ALLOWED is not a wrong value but **no value**, and `atLeast(undefined, 'read')` is
  false — a filter that rejects everything while reading like a policy check. Measured: every
  allowed frame was dropped, and the code was correct-looking TypeScript that `gjsify tsc` had no
  reason to complain about. **Ask a level with `levelFor(policy, url, ctx)`, which answers in both
  branches**; use `decide()` when you want the yes/no and the `confirm` flag, never for a level.
- **A frame's identity has three layers, and only the middle one belongs in a ref.** What the browser
  calls a frame is an internal counter: measured, **Firefox numbers a frame `10737418241`** and
  Chromium's numbers are small only by accident, and both are reassigned on navigation. What the
  agent needs is a short, document-ordered, stable name — so `extension/src/frames.ts` assigns
  Beifahrer's own `index` (1, 2, 3 … in announcement order) and the ref says `b2e12` while the
  browser's `10737418241` never leaves the extension. A ref built from the browser's id was measured
  failing outright: `page_click` refused its own outline's ref.
- **A frame's URL cannot be cached, and a cached one is a gate that can be wrong.** A frame that is
  still loading answers `about:blank`, and one that navigates answers something else than it did at
  injection time. So the announcement (`FRAME_HELLO`) is a HINT that only teaches the extension a frame
  exists, and the origin the policy is applied to is asked of the frame itself, every time, with the
  `where` request — immediately before the gate for a write, and again after the content for a read.
  The two are different messages, so a read is a window; the answer carries the frame's own
  `location.href` from the SAME message as its content, which is the smallest the platform allows.
- **A ref that names a frame has to go on to the page as its LOCAL part.** `routeFor` returns
  `route.ref` (the `e12` behind a `b2e12`) beside `route.frame` and `route.index`: the namespaced ref
  is for the AGENT, and each document resolves only its own. Forwarding the caller's ref through
  `page()` answers "no element with ref b1e4 in this document" from inside that very frame —
  measured, and it reads like a stale ref rather than a wrong one.

## TypeScript and bundling edges

- **`fail()` only narrows the type when the ANNOTATION is on the const.** TypeScript treats a call as
  a branch for an assertion/never-returning function only if the declaration carries an explicit type;
  `export const fail = (...): never => {}` leaves every line after a `fail(...)` reporting its value
  as possibly undefined, so handlers grow `!` and `as` that no one needed. `errors.ts` annotates the
  const, which is why `return fail(...)` is the way to write it there.

## Timers, listeners and UI

- **The extension never gives up probing.** A port with a socket is never probed, so a socket the
  browser does not close (a handshake that never ends, a bridge killed without a close frame) held
  its port until the person pressed reconnect. The round drops such a socket (`stalled` for one,
  `probeSilence` for the other) and schedules the next round in a `finally`, because a chain of
  rounds that ended with one error looks, from the person's side, like an extension that never
  reconnects. A socket is dropped for being silent only after it was **pinged** and stayed quiet
  another `SILENCE_MS`: a service worker that slept makes a healthy socket look dead, and tearing it
  down fails every call in flight on the bridge behind it. `BEIFAHRER_E2E_ONLY=reconnect` runs the
  restart scenario alone.

- **A `for` loop that re-reads the clock in its own update expression measures the GAP between
  iterations, not the work in them.** `for (let waited = Date.now(); Date.now() - waited < budget;
  waited = Date.now())` reads like a deadline and is not one: the condition is evaluated right after
  the update, so `Date.now() - waited` is always ~0 and the loop ends only if a single body happens
  to outlast the whole budget. Measured on `page.expect` (issue #35): an assertion asked with
  `timeoutMs: 600` polled a tab for a full minute — the caller's own MCP timeout — and never
  answered, while its log said `since 0 of 600` on every round. The deadline is ONE `started` outside
  the loop and nothing inside it may reset the clock; `page.wait` gets this right by racing a single
  `sleep(left)`, the other shape worth copying.
- **A `webRequest` listener has to exist before the request starts.** Chromium only delivers events
  to listeners registered at the time the request goes out, and an MV3 service worker that sleeps and
  wakes must find them again on wake — so `installNetworkWatch()` runs at load, unconditionally, and
  the RECORDING is what the feature switch decides (one `features.network` read per event, cached a
  second). Adding the listener when the person switches the feature on looks tidier and loses the
  requests that matter most: the ones right after they switched it.
- **`label.row { display: flex }` beats the `hidden` attribute.** The UA's `[hidden]` rule loses
  to any author `display`, so style.css forces `[hidden] { display: none !important }`. Without it
  the popup showed "Ask me before every change" at level Read.
- **CKEditor 5 and ProseMirror put `role="textbox"` on their contenteditable.** `kindOf` checks
  for a contenteditable host BEFORE the role, so those editors are `richtext` (and a recipe can
  wait for `{ role: "richtext" }`). Measured on OpenProject: the comment box and the
  description are buttons until clicked, and the editor mounts a moment later, hence
  `page.wait`.
- **An Adwaita row's `title` attribute is its heading**, not a tooltip; hover text goes on its
  label column, `.adw-action-row-text` in an action row but `.adw-row-text` in a switch row
  (`hoverText`, features.ts: looking for the second only left every action row bare), and a `<adw-switch-row>`
  notifies `notify::active` for a programmatic change too. Renders go through `setQuietly`
  (`src/ui/features.ts`), or redrawing a switch writes the value straight back.
- **`applyAdwaitaAccent` claims the root FOREVER, and `applySystemAccent` yields to it.**
  `adwaita-web` records the element in a `WeakSet` the moment you call `applyAdwaitaAccent`, and its
  desktop-appearance follower `return`s early on an element in that set. So the first accent a
  bridge reports pins the page to it: a later `applySystemAccent()` — the branch taken when the
  bridge goes away and the browser's own `AccentColor` should take over — silently does nothing.
  `src/ui/accent.ts` therefore calls `clearAdwaitaAccent()` first on the `system` branch, which
  hands the root back. The order is the whole fix; both calls in the other order, or neither, and
  the page keeps a stale accent with nothing in the code to explain why.
- **A recipe file must be listed in `app/src/recipes/builtin.ts`.** The bundle only carries what
  is imported; the `built-in recipes` unit test fails on a file left out.