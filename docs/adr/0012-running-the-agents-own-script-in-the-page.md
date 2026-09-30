# 0012 — The agent's own script in the page, behind a switch the person sets

- **Status:** accepted
- **Date:** 2026-09-30
- **Supersedes:** the "No `evaluate`" rule in AGENTS.md, which said *no method runs agent-supplied
  JavaScript*. It is narrowed, not deleted: no method runs it by default, and the one that can is
  behind a switch that starts off.

## Context

beifahrer's whole design follows from one rule: every capability is a **named method** with a level
in `REQUIRED_LEVEL` (policy.ts) and one feature in `FEATURE_OF` (features.ts), and there is no
"run this JavaScript" escape hatch, because an escape hatch would make the per-origin levels
meaningless. An agent that can run code can do anything a write can do, in one call, without a
named operation anyone reviewed.

That rule has a cost, and it is a real one. A page agent is a visitor, not a keyboard. It can:

- not press **Enter** to submit a form, or **Escape** to close a menu, or type into a widget that
  only answers a key sequence (a combobox filter, a date picker, a code editor);
- not hover, so a menu that opens on hover stays shut;
- not drag, so no drag-and-drop at all;
- not act on state the eight verbs do not model — a `<canvas>`, a custom scroll container, a widget
  whose value lives in a framework object.

For those pages the agent is stuck at "I can see it and I cannot touch it", and the honest
alternative was telling the user to reach for Playwright — which is the thing this project exists
to replace, because Playwright launches a *different* browser with none of the person's sessions.

The user asked for it, understood the risk, and asked for it to be a switch like the others. The
question this ADR answers is not *whether*, but **what has to be true for it to be safe enough to
ship at all**.

## Decision

Ship `page.evaluate`. Four things make it defensible; remove any one and it is not. And one platform
fact decides *where* it works at all, which is why it comes first.

## The platform fact: Firefox yes, Chromium no

Running a string of code means compiling it, and whether a content script may compile a string is
fixed by the manifest version, not by beifahrer:

- **A Manifest V2 content script has no content security policy of its own.** `new Function` works.
  beifahrer's Firefox build is Manifest V2, so a script runs there.
- **A Manifest V3 content script shares the extension's policy.** And that policy cannot be
  relaxed: Chrome rejects an install whose `content_security_policy.extension_pages` contains
  `'unsafe-eval'` — `script-src` there may only name `self`, `none`, `wasm-unsafe-eval`, and (unpacked
  only) localhost. So on Chromium, and on any other Manifest V3 build, the call throws an `EvalError`.

The two doors around it are not beifahrer's to open: Chromium's `userScripts` API needs *Allow user
scripts* switched on for the extension in `chrome://extensions` — developer mode under another name,
and a power a person did not ask for — and `chrome.debugger` attaches a debugger to the person's
browser. Neither is a capability an agent should have because the person wanted a comment posted.

So **Chromium answers `unsupported` with that reason, and the e2e run measures which engine it is on
rather than assuming.** A capability that is refused by a documented platform limit, with the reason
in the message, is worth more than one that half-works where the platform lets it and is claimed
where it does not. Safari is Manifest V3 and gets the same answer, for the same reason, without
anyone having to think about it.

Measured, not assumed: the page agent probes `new Function('')` once and remembers the answer
(`codeExecutionAllowed`, page-agent.ts), because the fact lives in the browser, not in a manifest
field beifahrer would have to interpret.

### 1. A switch of its own, off by default

`script` joins `FEATURES` (`features.ts`) and `DEFAULT_FEATURES.script = false`, beside
`screenshot`, `download`, `manageTabs` and `sessions` — the capabilities that reach past the one
page in front of the person. Nothing about it is on unless the person switches it on in their own
browser. It is not a per-site level, because it is not about a site: it is about what may ever run
here.

### 2. The site must be at `read + edit`, never `read`

`REQUIRED_LEVEL['page.evaluate'] = 'write'` (policy.ts). A site the person left at *Read* — a bank,
an insurer, a portal where injected text could do harm — refuses a script even with the switch on.
That is the line the levels were drawn for, and this method does not get to be the exception.

### 3. It always confirms, and it shows the code

`ALWAYS_CONFIRM` (policy.ts) is a set of methods a site rule may not silence. `confirmWrites: false`
means "this origin needs no confirmation" — true for a form the person watches the agent fill in.
It must not extend to a method whose reach the level table does not describe, or the answer to
"don't ask me again" would cover code the person has never seen.

So every run opens the confirmation window with **the script in full**, in a scrollable block, and
two answers: Allow and Deny. There is deliberately no "Always allow": a per-site rule must never
become standing permission for code that has not been written yet. A script longer than
`MAX_SCRIPT_CHARS` (20 000) is refused before it reaches the window, because a script too long to
read is not something anyone can consent to.

### 4. What comes back is bounded and honest

`projectValue` (core/evaluate.ts) turns the result into JSON-safe data under a character budget,
with a depth limit, an item limit, a per-string clip and a node counter. Anything it cannot
represent is *named*
rather than dropped (`[circular]`, `[function answer]`, `[Uint8Array of 4]`, `[throws RangeError]`),
and `truncated: true` travels with the result: a truncated result is not the whole answer, and the
flag exists so an agent does not fill the gap by guessing.

Two properties the walk owes, both about size, because the result crosses a bridge and fills a
model's context:

- **The text never exceeds what the caller allowed.** Every node charges the JSON it can produce and
  charges at least that much, every string is clipped against what is left of the budget, and a
  container leaves ONE `[omitted]` for everything past the cap rather than one per missing key. A
  result that is over the cap while saying `truncated: false` would be a flag describing something
  the bridge had already refused to send.
- **The walk ends.** A structure can grow faster in visits than in characters — `a = [a, a, a, …]`
  is 100^depth visits for a few thousand bytes of JSON — so `MAX_NODES` terminates it
  independently, and ends it with the flag set rather than with a hung tab.

The activity log gets a line with the first 40 characters of the script — the agent's own text, the
same treatment a `page.fill` gets, never page text.

### 5. The script does not get the extension

A content script's isolated world carries the **extension's own APIs as globals**: `chrome` (or
`browser`), and through it `storage.local` — which holds the pairing token, the whole per-origin
policy, the feature switches and the pause flag (`settings.ts`). A script that could read them could
clear the pause and widen every level, so one approved run would unmake the model for every later
call. So the script is compiled as `new AsyncFunction('beifahrer', 'chrome', 'browser', 'globalThis',
'self', 'top', 'parent', 'frames', 'opener', body)` and those names are shadowed for its whole run:
the APIs are `undefined` inside it, while the window and frame references still resolve to the
page's own, so `location` and `document` stay available.

Stated plainly, because it is easy to overread: **this is not a sandbox.** The script runs in that
realm and can reach anything reachable from a realm global that is not on that list. The short list
plus the isolated world is what stands between a script and the extension, which is precisely why the
capability is off by default, confirmed every time and limited to sites at `write` — not a licence to
relax any of those.

### 6. A window the person answered for a page that is still that page

A confirmation can sit open for two minutes, and in that time the tab can navigate — the page can do
it itself, and so can the person. The person answered for the origin the window named, so the
background re-reads the tab's URL and the pause after the answer and refuses if either moved. For
`page.fill` and `page.click` a stale ref simply fails afterwards; a script has no ref to go stale,
which is why the check belongs here.

## The isolated world, and what it does and does not hide

The script runs in the **page agent's isolated world**: the DOM is there. In scope is `beifahrer`,
the same eight verbs a recipe has — `find`, `describe`, `click`, `fill`, `read`, `outline`, `meta`,
`sleep` — so a script reads like a recipe and does not have to reach into the DOM blind.

The page's own JavaScript objects are a different matter, and this is where the first draft of this
ADR was wrong. In Chromium an isolated world has its own `window`, so `window.appState` is genuinely
invisible. **In Firefox it is not:** a content script sees the page's window through Xray vision, so
`window.wrappedJSObject.appState` reaches the page's objects — `wrappedJSObject` is how a page and an
extension share state in that browser, and every content script has it. The honest form of the
promise is therefore per engine: a script does not get the page's *variables* by name, and on Firefox
it can ask for them one wrapper deeper. That is a property of the platform, not a choice made here,
and the confirm window is where a person reads a script that tries.

`world: 'main'` exists in the type and is refused at the handler with `unsupported`, not silently
downgraded. The reason is a platform fact, measured rather than assumed: an extension a person
installed has **no API** that runs its own code as a string inside a page's world —
`scripting.executeScript` takes a function, not code. Into a page's world there are three roads, and
each costs more than this feature is worth:

- inject a `<script>` element, which the page's content security policy blocks on most sites and the
  page can see;
- Chromium's `userScripts` API (`userScripts.execute`, Chrome 120+), which needs *Allow user scripts*
  turned on for the extension in `chrome://extensions` — developer mode under another name, and a
  power beifahrer does not ask a person for;
- Firefox's Xray `wrappedJSObject`, which is the same reach and already present, which is why the
  world is not a boundary there.

So the answer is `unsupported` with that reason, not a fake. Note that this refusal is a DIFFERENT
one from the manifest-version refusal above, and the two are independent: a Manifest V2 Firefox could
in principle reach the page's world through Xray, and a Manifest V3 Chromium cannot run the script at
all. The door stays in the type for the day a browser offers one properly.

## What this does not buy, stated plainly

- **The page is still the least trusted thing in the room.** A script can read whatever the DOM
  shows, including a token in a hidden field, and hand it back as JSON. The per-origin levels are
  still the protection; a site at *Read* is a site a script cannot touch. And a script can do
  everything a `write` can do on that origin, in one call — including reading a password field's
  value, which `page_fill` refuses. That widening is the feature, not a bug in it, and it is why the
  switch is off until a person turns it on and the level is `write`.
- **A runaway script cannot be stopped from inside, if it never yields.** `while (true)` holds the
  tab's main thread; no message from the background is processed until it returns and no timeout can
  fire. The person closes or reloads the tab. What *can* be stopped is the part that yields: an async
  script's `beifahrer.*` calls carry the run's token and throw once the call has ended or beifahrer
  is paused, `beifahrer.sleep` rejects on the same, and every step re-asserts the in-page pill so the
  Stop button survives. A fire-and-forget script therefore cannot keep clicking after its call
  returned. A script that reaches for `document` and `fetch` itself is outside all of this, which is
  why the tool description says it, not only this ADR.
- **It is not a debugging channel for the page's own state.** No `window.__DATA__`, no framework
  internals, on Chromium; on Firefox, no `window.__DATA__` either without reaching for
  `wrappedJSObject` (above). That is the cost of the isolated world, and the price of not defeating
  CSP.

## Consequences

- The AGENTS.md guardrail is rewritten: no `evaluate` **by default**, and the one method that runs
  code has its own switch, its own confirmation, and a code review that starts at the confirm
  window.
- Every capability check in `preflight` applies unchanged, because `page.evaluate` has an entry in
  both tables — the type system refuses a method that has not got one.
- The e2e suite gains a case for each of the four refusals: switch off, level too low, denied in
  the window, `world: "main"` — plus the manifest-version one, which is why the script run is
  engine-dependent in the suite rather than a straight line of green checks.
- A consequence worth naming: on Chromium the switch buys nothing today, because the browser refuses
  the call. The switch, the level, the confirm window and the projection are all still built, tested
  and in the options page, because Firefox honours them and a Manifest V3 browser with a
  content-script exception is the obvious future. What Chromium does *not* get is a promise.
