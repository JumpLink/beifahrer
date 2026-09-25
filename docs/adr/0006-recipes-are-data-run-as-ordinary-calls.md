# 0006: Recipes are data, run as ordinary calls

- **Status:** accepted
- **Date:** 2026-09-25

## Context

Some tasks come back again and again on the same web app, and they take several steps that an
agent has to rediscover each time. The case that started this, measured in the person's Firefox
on an OpenProject work package: the comment box and the description are *buttons* until
clicked. A click mounts a CKEditor 5 instance a moment later; only then can it be filled; and a
second button ("Kommentar absenden") posts. An agent working from `page_outline` alone sees no
text field, guesses, and sleeps. OpenProject is self-hosted, so the same task lives on many
domains.

The person wants these tasks written down once, shared with others, and kept apart: generic
ones in this public repository, company-specific ones (a customer's domain, an internal process)
somewhere private.

Options considered:

| Option | Why not |
|---|---|
| Site scripts (JavaScript per site) run by the extension | That is `evaluate` with extra steps. A shared script would run with whatever level the person gave the site, and nobody reviews a community script the way they review a policy |
| The extension knows recipes and runs them | Two places would decide what a step may do. The extension's gate should stay the one that sees every single call, whatever issued it |
| CSS selectors in recipes | A selector is a small program and breaks with every class-name refactor. Role + accessible name is what `page_outline` already shows, and it survives redesigns better |
| Nothing: let agents figure it out each time | This is what happened on OpenProject, and it costs a dozen round trips and a sleep per comment |

## Decision

**A recipe is JSON data, validated fail-closed in `packages/core`, and the bridge runs it as a
macro of ordinary protocol calls.**

- **Steps** are only `find`, `click`, `submit`, `fill`, `wait`, `read`, `outline` and
  `checkpoint`. Each maps to exactly one existing method (`page.find`, `page.click`, `page.fill`,
  `page.wait`, `page.read`, `page.outline`) or to none (`checkpoint` only stops the run). There
  is no step that carries code, and the validator refuses any key it does not know, naming
  `ref`, `selector` and `script` explicitly.
- **Elements are named by role + accessible name** (+ visible text, + `nth`), the query
  `page.find` takes. Never by ref: a ref belongs to one page load.
- **The extension does not know recipes exist.** Every step is one call, checked there like a
  call the agent made itself: pause, feature switch, per-site level, host grant, confirmation
  window. A recipe can do nothing the agent could not do step by step, and it cannot skip a gate.
- **Publishing needs the person's explicit request.** A step that publishes is a `submit`, and
  the validator refuses a `submit` not marked `requiresExplicitRequest: true`. The runner stops
  before such a step unless the run says `explicitRequest: true`; the tool description tells the
  agent that it may only say so when the person asked for exactly that action. Without it, the
  draft stays on the page for the person to read.
- **Matching** is URL patterns and/or a fingerprint of `page.find` checks, including `<meta>`
  checks. A meta check answers a count, never the content, because a `csrf-token` is a meta too.
  A tab below `read` matches nothing, since looking at it would already be a read.
- **Sources**, later wins by id: built-in `recipes/` (bundled into the app at build time), then
  `$XDG_CONFIG_HOME/beifahrer/recipes/`, then each directory of `$BEIFAHRER_RECIPES`
  (colon-separated, left to right). An invalid file is reported and skipped as a whole, so it
  cannot shadow a valid recipe of the same id.

Two new read-level methods make this possible, and they are useful on their own: `page.find`
(elements by role + name, with refs from the outline's registry) and `page.wait` (for the
document to load, or for an element to appear; bounded to 30 s). `page.wait` for load polls
`tabs.get`, because Epiphany fires no `tabs.onUpdated` (issue #2). Both belong to the `outline`
feature, since they read the same element model.

## Consequences

- A recipe from a stranger is as safe as the person's per-site levels. Reviewing one means
  reading its steps, which are plain data.
- The page agent now classifies a contenteditable host as `richtext` even when it carries
  `role="textbox"` (CKEditor 5, ProseMirror). `page_outline` shows such editors as `richtext`
  instead of `textbox`, which also tells the agent that `as: "html"` keeps formatting.
- `recipe_run` is a write tool for the MCP read-only gate: without `--allow-write` it does not
  exist, even for a recipe that only reads.
- The built-in OpenProject recipes use the German labels measured in the person's instance and
  the English ones from OpenProject's own locale files (`label_type_to_comment`,
  `label_submit_comment`, `button_save`). Other UI languages need their labels added to `name`.
- Measured: unit tests (validator, matcher, runner with a fake extension, sources) on GJS and
  Node; the e2e runs both OpenProject recipes against a synthetic OpenProject-like page in
  headless Chromium and Firefox, first stopping before the submit, then posting with
  `explicitRequest`.
