# 0031: Rules that cover sub-domains

- **Status:** accepted; to be built after the store launch
- **Date:** 2026-11-18
- **Decided by:** the person, 2026-11-18, on [PR #268](https://github.com/JumpLink/beifahrer/pull/268):
  the apex stays out, the ICANN list gets bundled, a pattern never writes quietly, no toolbar
  signal — and the agent must be able to ask for a pattern itself (§7).
- **Refs:** [#153](https://github.com/JumpLink/beifahrer/issues/153) (the withheld line, and the
  wildcard hint at the end of it)
- **Relates to:** [0010](0010-temporary-access-and-asking-on-demand.md) (the only wider scope
  there is today, and what `permissions.remove` does), [0013](0013-all-sites-without-asking.md)
  (quiet writes, and for which scope), [0016](0016-scripts-without-asking.md) (`confirmScripts`),
  [0018](0018-download-from-a-sister-origin.md) (the registrable-domain table and why it may only
  ever refuse)

## Context

`Policy.origins` is keyed by exact origin and `accessFor` looks a host up by name. Between one
site and all sites there is nothing.

The Azure portal is where that bites. Its Artifact Signing blades render in cross-origin frames on
`sandbox-1.reactblade.portal.azure.net`, `sandbox-4.…`, and the number changes with the blade. The
person raises the level for the host in front of them, the next blade arrives on a sibling, and
they are back at `none` — for a set of hosts that is one service, one operator, one decision. The
agent's half of this is already fixed: the walk says a frame was withheld and names its origin
(#153, `withheld.ts`). What it cannot say is what to ask for, because there is nothing to ask for
except that one host, again.

"All sites" is the wrong answer: it is temporary by design, it covers the whole web, and it is
what the person asked not to leave on. A pattern is the missing middle — and a pattern in a gate
is also the classic way to give away more than anyone meant to, so the shape matters more than
the feature.

## Decision

### 1. The rule shape

A pattern rule is a second kind of key in the same `Policy.origins` map:

```
https://*.reactblade.portal.azure.net
```

- **Scheme is explicit**, `https` or `http`, never `*`. A person who allows a portal over TLS has
  not allowed its plaintext twin.
- **No port, and the default port only.** `originOf` writes `https://host` for 443, so a pattern
  key carries no port either, and it covers no host served on another one. A non-default port
  keeps needing its own exact rule. (A port in a pattern would also be a promise the browser's own
  grant cannot keep — `originPattern` already drops the port because Firefox ignores it.)
- **Sub-domains only; the apex is NOT included.** `*.reactblade.portal.azure.net` covers
  `sandbox-4.reactblade.portal.azure.net` and `a.b.reactblade.portal.azure.net`, and does not
  cover `reactblade.portal.azure.net`. This differs from the browser's match patterns and from
  `urlPatternMatches` in `recipes.ts`, where `*.example.org` includes the apex. The divergence is
  deliberate and goes one way only: a recipe matcher decides which recipe to run and holds no gate
  (ADR 0006), while this decides what an agent may read. The apex is usually the login, the
  account page and the session — the person says it by name or not at all.
- Only `*.` at the front, one base host, lowercase, no `*` anywhere else, no path. Everything else
  is not a pattern and is dropped by `parsePolicy`.

**Storage and migration.** Nothing changes shape: pattern keys appear in `origins` only once the
person writes one. `parsePolicy` keeps a key when `originOf(key) === key` *or* when it parses as a
pattern; every other key is still dropped entry by entry. An older build reading a newer policy
drops the pattern keys, because they fail its `originOf` check — a downgrade loses the widening and
never mis-reads it, which is the direction a gate may fail in.

### 2. Precedence

`accessFor` gains one step. The chain, most specific first:

1. no http(s) origin → `none`;
2. an **exact rule** for the origin — including `none`, which stays absolute: no grant, no
   pattern, no prompt (ADR 0010, unchanged);
3. the **matching pattern with the most labels** in its base. Two different bases with the same
   label count cannot both match one host (both are suffixes of it, so they would be equal), so
   "most specific" is a total order and needs no tie-break;
4. a live `*` grant — only where neither 2 nor 3 matched. A pattern rule is the person's explicit
   decision, so it beats the wildcard exactly as an exact rule does, in both directions: a pattern
   at `read` is not raised to `write` by an "all sites: edit" grant;
5. a live grant for that one origin (an answered prompt) may raise the level from 3 or 4, as it
   may today from 2 — but never past a block.

**A block is never loosened from above, and only by name from below.** If any matching entry says
`none`, the result is `none` and `source: 'blocked'`, with one exception: an **exact** rule for
that origin. So `*.example.org: none` plus `*.pay.example.org: write` is `none` — a pattern may
widen the set of hosts it speaks for, never carve a hole in a block — while `*.example.org: none`
plus `https://ok.example.org: read` is `read`, because that is a host the person named while
looking at it. Pattern against pattern, `none` wins at any specificity.

New `AccessSource` values: `pattern` (and the existing `blocked`, now also reachable from a
pattern). `access.check` reports them, so a refusal can say which entry decided.

### 3. The public-suffix guard

A pattern must never cover a public suffix (`*.co.uk`), and never the parent of a bare registrable
domain (`*.example.org` is fine; `*.org` is not, and neither is `*.ma.us`). The check: the base
must be the registrable domain or a sub-domain of it.

**The table in `download.ts` does not suffice, and a public-suffix list is needed.** Not because it
is wrong, but because the direction of a wrong guess flips. For `page.capture` an unknown
multi-label suffix makes two hosts look *less* related, so it refuses a sister (ADR 0018). Here the
same miss makes a base look *narrower* than it is: `registrableDomain('pvt.k12.ma.us')` answers
`ma.us` with the short table, so `*.pvt.k12.ma.us` would pass the check above and cover a whole
registry. No fixed label count repairs that — three labels refuses the Azure case nothing is wrong
with, and still admits a four-label suffix.

So: the ICANN section of the Public Suffix List, bundled as data in `@beifahrer/core`, read by a
pure lookup, refreshed by a tool in `tools/` and never fetched at runtime (nothing leaves the
device). `page.capture` keeps its own table or moves to the same lookup — that is a separate, safe
change.

**Fail closed when unsure:** a base whose suffix the bundled data does not resolve is refused, in
the UI and in `parsePolicy` alike. Until the list ships, every pattern is refused, which is the
honest state of a feature whose guard is not there yet.

### 4. Host permissions

Setting `*.reactblade.portal.azure.net` at any level requests
`https://*.reactblade.portal.azure.net/*` in the person's click, like a site's own
`originPattern`. That browser pattern is wider than the rule — it includes the apex — and that is
acceptable for the same reason the missing port is: the policy is the gate and runs first; the
browser grant is the second fence, never the first.

Release has the shape ADR 0010 measured. Firefox removes exactly the listed patterns. **Chromium
subtracts by URL-pattern coverage**, so removing a pattern's permission also removes the
separately granted permission of every host under it — a site that had its own rule long before the
pattern existed. `hostsToRelease` therefore holds a pattern's permission back while any exact rule,
live grant or other pattern still needs a host it covers, the medicine the wildcard already gets,
and re-requests the narrower host patterns when it does let go. A pattern is not `<all_urls>` and
not `WILDCARD_PATTERNS`: ending one must never touch the other two.

### 5. What the person sees

- The **options page** gets a *Patterns* section above the site list, because a pattern is not a
  site: each row is the pattern as written, its level, and Remove. A site row that a pattern covers
  says so.
- The **popup** on a covered tab shows the level and the entry it came from in words ("Read, via
  `*.reactblade.portal.azure.net`"), so raising the level there is visibly a change to the pattern
  and not to this one host.
- No new toolbar signal. ADR 0010's blue dot marks a *temporary* widening that the person will
  forget is running; a pattern is a standing rule they wrote and can read in the options, like
  every other rule.
- **A pattern rule can never be quiet.** `confirmWrites` and `confirmScripts` are ignored on a
  pattern key; a write under a pattern always opens the confirmation window, and that window names
  the host it is about. ADR 0010 said a widening changes where the agent may go, never how quietly
  it changes things there; ADR 0013 relaxed that only for `*`, which sparkles in the toolbar and
  ends by itself. A pattern has neither property, so it keeps the stricter half. A person who wants
  no questions on one host sets an exact rule for that host, which is bounded.

### 6. What the agent is told

Only origins and levels, never anything from inside — the line in `withheld.ts` gains a hint:

```
— frame withheld: https://sandbox-4.reactblade.portal.azure.net (level none, needs read;
  a rule for *.reactblade.portal.azure.net would cover this)
```

The hint is the **narrowest** pattern that covers the host: drop exactly the leftmost label. It is
computed by the same guard as a real pattern, so when dropping that label reaches the registrable
domain, a public suffix, or anything the list cannot resolve, there is no hint and the line is what
it is today. `access.check` carries the same suggestion in `reason` and in a field beside it. This
reveals nothing new: the agent could already ask `access.check` for any URL (#153).

Where the person may be asked (`askable`), both say the agent may ask for the pattern itself (§7);
where they may not — paused, a feature off, *Ask for other sites* off, a block, a Deny already
given — both say to ask the person, as they do today. The hint never says which of those it was
beyond what `access.check` already answers.

### 7. The agent asks for a pattern

A hint the agent cannot act on is a detour with better wording. So the agent may ask — through
ADR 0010 §B's path, under exactly its conditions: not paused, the feature on, *Ask for other
sites* on, and the session not already denied this pattern.

**How it asks: an explicit method, `access.request({ pattern, level, reason? })`** (`access_request`
over MCP), not a prompt the gate opens by itself. The gate's own prompt fires when a call is
refused, and the case this ADR exists for is not a refusal: the walk *succeeds* and leaves a
withheld line. A window raised from inside a successful read is a window the person did not ask
for, and one sibling host per blade would make it a series of them. A pattern is also wider than
the call that prompted it — inferring one from a single frame means the extension guessing how far
the person meant to go, which is the guess §1 and §3 exist to avoid. An explicit method puts the
pattern in the agent's own words, where the person can read it. `pattern` may be given as a URL
instead, which the extension narrows to the hint of §6 and never further.

The answer has the gate's three shapes and no others: allowed (with the level given), `forbidden`
(Deny, a closed window, a guard), or the confirm timeout, which is `forbidden` too. Nothing in the
answer says what else the policy holds.

**The confirm window** names the pattern literally and says what it covers in one line —
"`https://*.reactblade.portal.azure.net`: every sub-domain, for example
`sandbox-4.reactblade.portal.azure.net`. Not `reactblade.portal.azure.net` itself." — with the
level asked for, the session asking, and the agent's `reason` where it gave one, marked as the
agent's words. Where the person has blocked hosts under the pattern, it says how many stay
blocked. The choices are **Allow once**, **For this session**, **Always** and **Deny**, nothing
preselected and never Always by default: this window widens more than ADR 0010's, so its quietest
answer must be the one the person picks last. *Always* writes the persistent pattern rule of §1.
*For this session* and *Allow once* become a **pattern-scoped `Grant`** — `Grant.scope` grows from
`'*' | origin` to `'*' | origin | pattern`, parsed by `parseGrants` with the same guard as a rule,
and ranked in `accessFor` where a pattern rule ranks, below any exact rule. *Allow once* stores
nothing and gives its host access back after the call, as it does today.

**Guards**, all of them before any window opens:

- The §3 PSL guard runs first. An invalid pattern, a public suffix, a bare registrable domain or a
  suffix the bundled list cannot resolve is `forbidden` with no window — the person is not asked a
  question whose answer would be refused anyway.
- A wider pattern may be asked for while a narrower rule exists; §2 then decides, and the narrower
  rule keeps winning where it matches.
- **A pattern never loosens an explicit `none`.** A blocked host under a granted pattern stays
  blocked (§2), and a `none` pattern cannot be asked around. One blocked host does not veto the
  request — that would let a single old block hide a whole portal — it simply stays blocked, and
  the window says so.
- After a Deny, the session may not ask again for that pattern **or for any pattern covering it**,
  until it reconnects. Asking for `*.azure.net` after `*.portal.azure.net` was denied is the same
  question, larger.
- **Rate limit:** one window at a time, at most one request per minute and five per session.
  Over either, the answer is `forbidden` without a window. Unlike the gate's prompt, this one has
  no refused call behind it, so nothing but the limit bounds how often an agent could knock.
- The level is capped at what the work needs: `read` unless the session has a write feature on, and
  the window never offers more than was asked for.
- Writes under a pattern grant confirm per §5 — a grant may not be quiet either, for the same
  reason a pattern rule may not.

## Consequences

The work, so this can become an issue:

- `packages/core/src/policy.ts` — pattern key parse and match, the precedence chain in `accessFor`,
  the block rule, `parsePolicy`, `withPattern`/`withoutPattern`, `hostsToRelease`, `AccessSource`.
- `packages/core/src/suffix.ts` (new) — the bundled PSL and the lookup; `tools/` refresh script;
  `download.ts` keeps or drops its table.
- `packages/core/src/withheld.ts`, `access-check.ts` — the hint and the `reason` text.
- `packages/core/src/policy.ts` again for §7 — `Grant.scope` with a pattern, `parseGrants`,
  `REQUIRED_LEVEL['access.request']` (`null`, like `access.check`: asking is not doing).
- The method: wire name in `protocol.ts`, `app/` MCP tool `access_request`, the per-session Deny
  and rate-limit state beside the prompt's own (`extension/src/access-prompt.ts`).
- `extension/src/settings.ts` (`originPattern` for a pattern key), `grants.ts` (hold and release),
  `handlers.ts` (the confirm window names the host).
- Confirm window: the pattern line, the covers/does-not-cover example, the blocked count, four
  choices with nothing preselected.
- Options page (*Patterns* section), popup (the source line), `_locales/en` + `de` — including
  `method_access_request`.
- Tests: the precedence table exhaustively, the guard against a list of suffixes, the Deny-covers-
  wider rule, the rate limit, the Chromium release behaviour in e2e where it can be seeded.
- `docs/security/access.md` and `policy.md`.

What it costs, stated plainly: one pattern at `read` makes every present and future host under a
base readable to a connected agent, including hosts that do not exist yet — and with §7 the agent
can be the one who raises the question. That is the point of it, and it is why the guard, the apex
exclusion, the no-quiet-writes rule and §7's limits are in the decision rather than in the backlog.
The person still answers every one of those windows, and the quietest answer is never the preselected
one.

**Order of work:** after the store launch. The withheld line of #153 already ships and is what makes
the gap visible; nothing here is urgent enough to sit in front of a submission.
