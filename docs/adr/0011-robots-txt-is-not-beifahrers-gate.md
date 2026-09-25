# 0011: robots.txt is not beifahrer's gate

- **Status:** accepted
- **Date:** 2026-09-25
- **Supersedes:** the same decision taken in the (now mothballed) `abholer` project, 2026-09-22.

## Context

beifahrer's first portal use came from a real incident: an AOK *Ruhensbescheid* arrived by post
because the contribution assessment and the dunning letter before it had been delivered into an
app inbox nobody was watching. Measuring the mailbox afterwards found a second, larger blind spot
at the bank's ePostfach. Both are documents the person is entitled to, sitting behind a login.

Two sibling projects in this workspace already fetch things from the web, and they answer the
robots question in opposite ways:

- **troedler** reads *other people's* public listings anonymously. Its hardest rule is
  "robots.txt is a gate, not a hint" — parsed per host, checked before every request.
- **beifahrer** works inside the person's own browser, in a session they authenticated
  themselves, on documents that are theirs.

Copying troedler's rule looks like the safe, consistent choice. Measured against a real bank it
is not: `vobaeg.de/robots.txt` carries `Disallow: /services_cloud/portal/`, and that path is
where the bank's own online banking lives. There is no separate banking host. The same rule would
therefore refuse every bank portal, and most insurer portals with it.

## Decision

**The Robots Exclusion Protocol binds clients that fetch URLs on their own initiative. beifahrer
is not one, so robots.txt is not consulted.**

What makes that true, and what must stay true for it to remain true:

- beifahrer never invents a URL and never follows a link to discover one. It reads the page the
  person opened.
- Every access runs inside the person's own browser, under their own session, on their own
  machine. Nothing is fetched out-of-band.
- The gate that *does* apply is stricter and more specific than a crawl directive: the **per-site
  level the person sets in their browser**, plus the browser's host grant, plus — for writes —
  their confirmation. A robots directive is a site operator's instruction to crawlers; the
  person's policy is the account holder's instruction about their own browser.

Read the other way, a `Disallow:` on a banking path would forbid the bank's own customers from
banking through a path the bank built for them. That reading is not tenable.

**This is a general rule and takes no per-site exceptions.** A gate with exceptions is not a
gate; if a future source only works by carving one out, the answer is that the source does not
work.

## What this does not change

- No crawling, no link discovery, no enumerating document ids.
- A 403, a rate limit or a captcha ends the attempt with a plain error. Automation is not evasion
  (this is `Never circumvent`, already a Leitplanke).
- A provider portal stays at level `read`. A recipe for a bank or insurer only reads — it never
  sends, confirms, pays, deletes, or marks a message read, because an unread marker is often the
  person's own to-do list.
- Where a documented protocol (FinTS, ELSTER's Datenabholung) already reaches the document, no
  recipe is written for it. That question is settled in the source record before the recipe
  exists, because it decides whether the recipe should exist at all.

## Consequences

troedler and beifahrer now hold opposite rules about the same file, and that is correct: they are
in different situations, not inconsistent. Anyone reading both should see the distinction stated
here rather than conclude one of them is wrong — which is why this ADR exists instead of a line
in a Leitplanke.
