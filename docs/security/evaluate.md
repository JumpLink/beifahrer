# `page.evaluate`

No method runs agent-supplied JavaScript *by default*. Every capability is a named
method in `REQUIRED_LEVEL` (`policy.ts`) with its level, and in `FEATURE_OF`
(`features.ts`) with exactly ONE feature. Adding a method means adding both there
first.

`page.evaluate` is the one exception and it is the load-bearing one
([ADR 0012](../adr/0012-running-the-agents-own-script-in-the-page.md)):

* own feature switch `script`, **off by default**;
* `write` level, never `read`;
* `ALWAYS_CONFIRM` (`policy.ts`), so no `confirmWrites: false` can silence it — only
  its OWN switch `confirmScripts: false`, per rule or `*` grant, set by the person
  behind a warning ([ADR 0016](../adr/0016-scripts-without-asking.md));
* the confirm window shows the whole script and offers no "Always allow";
* the result is projected into bounded JSON with a `truncated` flag;
* the extension's own `chrome`/`browser` globals are shadowed out of the script's
  scope, because a script that could read `storage` could clear the pause and widen
  every level;
* the tab's origin is re-read before every run, window or not, since the person
  answered for a page and the page can move;
* it runs in the page agent's isolated world;
* `world: "main"` is refused with a reason — no extension API runs its own code as a
  string in a page's world.

Removing any of those conditions removes the reason it may exist; changing them is
an ADR, not a patch.

One more condition is not ours: **a Manifest V3 content script cannot compile a
string into code at all** (it shares the extension's CSP, which cannot name
`unsafe-eval`), so the page agent probes `new Function('')` once and answers
`unsupported` on Chromium and Safari; Firefox's Manifest V2 build runs the script.
Probe it, never infer it from a manifest field
([engine facts](../traps-browser-platform.md)).
