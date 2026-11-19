# Plan — `gjsify webext submit`: the packages into Chrome and Edge from a command

- **Written:** 2026-11-13 · **Reviewed and rewritten:** 2026-11-16
- **What it is:** the automatable part of Stream G in
  [extension-page-and-stores.md](extension-page-and-stores.md) — a gjsify command that uploads a
  built package to the Chrome Web Store and Edge Add-ons, and a Beifahrer release step that calls it
  behind a person's approval.

The command exists. What is left is one gjsify fix, the version pin, and the uploads only a person
may do.

## Status

| # | Step | State | Blocked by |
|---|---|---|---|
| S0 | ADR 0077 §7 amended with the measured API facts | done — gjsify #2627 | — |
| S1 | `store.json` and `--stores` in `webext listing` | done — gjsify #2628 | — |
| S2 | Store table and types (`StoreBackend`, env credentials, injectable `fetch`) | done — gjsify #2627 | — |
| S3 | Chrome backend, API v2 | done — gjsify #2631 | — |
| S4 | Edge backend, API v1.1 | done — gjsify #2631 | — |
| S5 | Bounded poll/retry layer | done — gjsify #2633 | — |
| S6 | `webext submit --store … [--dry-run] [--submit]` | done — gjsify #2634, released in v0.64.45 | — |
| S6b | **Fix: `submit` must not demand a `webext` project shape** | done — gjsify #2673, released in v0.64.46; a local `--dry-run` now passes preflight and stops only at the missing credentials | — |
| S7 | Document the command for agents in gjsify's cli `AGENTS.md` | open; decided: split the webext part into its own file | the file is 32,766 B of a 32,768 B limit |
| S8 | Beifahrer: `submit-stores` job in `release.yml` | written — Beifahrer PR #252; plus `store-check.yml`, a dispatch-only `--dry-run` of both stores behind `store-release` | the pin bump (#263) |
| S8b | Bump Beifahrer's `@gjsify/*` pins 0.64.40 → ≥ 0.64.46 | done (0.64.46) | S6b released |
| S9 | The first upload per store, by hand | open — Pascal | Edge: a working drag-in or extension ≥ 0.1.31 |

**Why S6b blocks everything:** `resolveSubmitProject` required a project to declare
`gjsify.webext` with targets *and* a build shape; Beifahrer declares `gjsify.webext.listing` plus
`targets` and nothing else, so `submit` refused the very project it was written for. The command in
v0.64.45 therefore cannot run against this repository at all.

## What the review measured, and what it changed (kept as the record)

| Draft said | Measured | Consequence |
|---|---|---|
| New command `webext publish` | ADR 0077 §7 already decided `webext sign` / `webext submit`; `publish` collides with the npm command | the command is `webext submit` |
| Chrome API v1 | v1 ended 2026-10-15; v2 puts the **publisher id** in the path (`/v2/publishers/{PUB}/items/{EXT}:upload\|:publish\|:fetchStatus`, upload via `/upload/v2/…`) | the env list carries `CHROME_WEB_STORE_PUBLISHER_ID`; the refresh-token exchange stays |
| Edge wants client id, secret and an API token | v1.1 wants `Authorization: ApiKey <key>` + `X-ClientID`; no token exchange; the key **expires after 72 days** | a 401 must name where to renew it |
| The calls are synchronous | both are asynchronous: Chrome `uploadState` then `fetchStatus`; Edge `202` + `Location: <operationId>` then poll | a bounded poll layer and an exit code for "accepted, never resolved" |
| Tests need a mock server | the house standard is an injected `fetch` (`publish-readback.ts`) | no mock server; the specs run on Node and on GJS |
| Leave AMO out | ADR 0077 §7 lists AMO in the same table | the store table has an AMO slot with no backend behind it |
| `store.json` carries the listing | neither API changes listing text; Edge takes one free-text field (certification notes) | `store.json` is **preflight**, not payload |

Neither API can **create a product**. The first upload per store is by hand; `submit` only ever adds
a version to an existing product. Chrome also needs one manual publish in the dashboard after a
visibility change, or the API refuses `publish`.

## Rules that do not bend

- Credentials from the environment only — never a file, never an argument. A redaction function over
  header names, with a test.
- `--dry-run` **checks** the credentials with exactly one read call (Chrome `fetchStatus`; Edge an
  operation GET on an unknown id). It never uploads.
- Default is upload as a draft. `--submit` is explicit and refuses when `$GITHUB_REF` is not a tag.
- Idempotent re-runs: the same version again is "already there" (exit 0), not a red run. Edge
  `NoModulesUpdated` and `InProgressSubmission` exit 0 with a note; `SubmissionValidationError` and
  `ModuleStateUnPublishable` are real errors. Chrome `cancelSubmission` is the documented way out and
  is named in the command's help.
- The workflow step sits behind a GitHub Environment **with a required reviewer** — never behind a
  dispatch input alone, never behind the tag push alone.
- Going public, the first submission, and every privacy or data-use declaration stay with Pascal.

## The open steps

| # | Step | Owner | Precondition | Done when |
|---|---|---|---|---|
| S6b | Land gjsify #2673 and cut a patch release | agent | #2673 CI green | `npm view @gjsify/cli version` ≥ 0.64.46 and that version's `submit` accepts a `listing`-only project |
| S8b | Bump every `@gjsify/*` pin in `package.json`, `app/`, `extension/`, `gjsify-lock.json` | agent | S6b released | `gjsify upgrade --check` exits 0; `gjsify foreach -A check`, `gjsify run lint`, `oxfmt --check .`, app unit tests and `node tests/e2e/browsers.e2e.mjs all` all pass |
| S8 | Merge PR #252 | agent | S8b merged; the secrets live only in GitHub, so the dry run is `store-check.yml` (needs `main` and the person's approval) | the `submit-stores` job appears in a dispatch run and stops at the `store-release` approval |
| S7 | Document `submit` for agents | agent | S6b | the command, its env names and the 72-day trap are findable from gjsify's cli docs, and `check-agent-context-size.mjs --check` passes |
| S9a | Chrome: upload the first package by hand, keep the item **unlisted** | Pascal | the tag's `chrome-mv3` zip; the store preview approved | the draft item holds a version and the review queue has it |
| S9b | Edge: upload the first package | Pascal (or agent via `page_upload` once the extension is ≥ 0.1.31) | the tag's `edge-mv3` zip | the Edge product holds a package |
| S9c | A dispatch run with `submit_for_review` off, to prove the draft upload path | agent | S8 merged, S9a/S9b done | both stores show a new draft version, nothing submitted |

**S7 — decided 2026-11-16: split.** gjsify's cli `AGENTS.md` is 2 bytes under
`project_doc_max_bytes` (32 KiB), past which Codex truncates the tail without saying so. Three ways
out: trim something stale from that file and add a short section; add one pointer line there and put
the detail in a README (gjsify's `packages/infra/site/README.md` already describes the listing and
submission flow); or split the webext part of `AGENTS.md` into its own file. The last was chosen on 2026-11-16 (see the main plan, "Decided"): it is the
cheapest to keep true.

**The Edge upload trap:** Partner Center's file field lives inside a shadow root, and the installed
extension 0.1.30 cannot reach it, so the upload fails silently. Extension 0.1.31+ carries the fix;
until it is installed, Pascal drags the zip in. This is why S9b has two owners.

## Secret names and their renewal

Set with `gh secret set <NAME> --repo JumpLink/beifahrer`; the value is prompted for and never goes
through a chat.

| Store | Secrets | State |
|---|---|---|
| Chrome | `CHROME_WEB_STORE_PUBLISHER_ID`, `CHROME_WEB_STORE_ITEM_ID`, `CHROME_WEB_STORE_CLIENT_ID`, `CHROME_WEB_STORE_CLIENT_SECRET`, `CHROME_WEB_STORE_REFRESH_TOKEN` | all five set; validity unchecked until the first CI run |
| Edge | `EDGE_ADDONS_PRODUCT_ID`, `EDGE_ADDONS_CLIENT_ID`, `EDGE_ADDONS_API_KEY` | all three set; the key was created 2026-11-14 |

- **Chrome OAuth:** GCP project `beifahrer-publishing`, consent screen in production, desktop client.
  A refresh token from a test-mode consent screen expires after seven days — that is why it is in
  production.
- **Edge key renewal: by 2027-01-20.** The key is valid 72 days from 2026-11-14; Partner Center
  shows the exact date (→ Publish API → Create API credentials). Renew before the date, not after a
  red run: a dead key only announces itself as a 401 on a release.

## Checks the first real run must answer

Each of these is **unverified**: the behaviour is documented nowhere we trust, so the first run
writes the answer back into this table and into gjsify's cli docs.

| Question | Why it matters |
|---|---|
| Does Chrome report `IN_PROGRESS` or `UPLOAD_IN_PROGRESS`? | the poll layer matches on the string |
| What is an item's publish status right after a visibility change? | decides whether `publish` is refused and a manual step is needed |
| Is `deployPercentage` accepted without `STAGED_PUBLISH`? | an accepted-but-ignored field would silently not stage |
| What format does Edge want publish notes in? | a rejected body costs a review cycle |
| Does Edge always return the `Location` header, or sometimes only a body? | the operation id is read from it |
| 404 or 401 on an unknown operation id? | `--dry-run`'s liveness check distinguishes the two |

## Out of scope

Safari (Xcode and App Store Connect — [ADR 0026](../adr/0026-safari-extension-ships-inside-the-desktop-app.md)),
creating a product, and changing listing text through an API. AMO came later than this plan: the
listed channel runs in `release.yml`'s `sign-firefox` job behind `FIREFOX_CHANNEL=listed`
([store/README.md](../store/README.md)).
