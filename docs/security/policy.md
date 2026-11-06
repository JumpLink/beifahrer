# Policy enforcement and core gates

## Policy is enforced in the extension, never the bridge

The bridge is the process the agent talks to; a gate there is a gate the agent's
side controls. `packages/core/src/policy.ts` decides, and `extension/src/handlers.ts`
calls it before *every* page access.

## Fail closed

An unknown origin is `none`. A non-http(s) URL has no origin. An unknown method is
refused. A malformed stored policy entry is dropped, not widened. The MCP read-only
gate drops a tool that forgot its annotation.

## Check order

In `runMethod` and the handlers the order is: paused → feature → per-site level →
host grant → confirm. `preflight` (core) does the first two before any handler, so
none can forget them.

Features are the person's switches, parsed fail-closed; tab management, sessions
and screenshots are off by default. A new URL the agent supplies still needs `read`;
closing asks first. Sessions live in the extension's storage, never on the bridge
([ADR 0004](../adr/0004-sessions-live-in-the-browser.md)).

## Only the person resumes

Pause (`paused` in storage) refuses EVERY method, `tabs.list` too. The popup,
options, the in-page Stop button and the shortcut set it; only the popup, options
and shortcut clear it. No protocol method may touch it, and a content script may
only ever set it ([ADR 0005](../adr/0005-the-person-sees-and-stops-the-agent.md)).

## The person sees the agent

Toolbar icon (`toolbarLook`, core), popup activity log (host only, never page text),
and the in-page pill in a CLOSED shadow root outside `<body>`, hidden before every
screenshot. Do not make any of them optional.

One ladder, loudest first, in `alarmOf` (core): **not connected is red** and outranks
the pause (yellow) and the live grant (blue), because without a bridge the extension
does nothing ([ADR 0014](../adr/0014-not-connected-speaks-first.md)). Colour never
says it alone: the state word, the tooltip and the one shared banner
(`src/ui/banner.ts`) carry the same state beside it.

## No `page_console`

A content script shares the page's DOM but not its JavaScript world and no API
bridges the two; the only route into the page's world is defeating the page's CSP,
which [ADR 0012](../adr/0012-running-the-agents-own-script-in-the-page.md) refuses.
A tool answering "no entries" would be a lie, and a lie there is worse than a gap —
an agent debugs with it and concludes the page logged nothing when it cannot know.
"The button did nothing" is answered by `page.network` (optional `webRequest`
feature); the gap is a decision to keep, not a backlog item
([engine facts](../traps-browser-platform.md)).
