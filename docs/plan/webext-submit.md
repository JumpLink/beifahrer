# Plan — `gjsify webext submit`: the packages into Chrome and Edge from a command

Stream G of [extension-page-and-stores.md](extension-page-and-stores.md) names the way into the
stores. This plan is the part that can be automated: a command in gjsify that uploads a built
package to the Chrome Web Store and Edge Add-ons, and a release step that calls it behind a
person's approval. Reviewed by Opus on 2026-11-13; the review's corrections are folded in below.

## What the review changed

| Draft said | Measured | Consequence |
|---|---|---|
| New command `webext publish` | gjsify ADR 0077 §7 already decided `webext sign` and `webext submit`; `publish` collides with the npm command | name it **`webext submit`**; amend ADR 0077, no new ADR for the "whether" |
| Chrome API v1 | v1 ended 2026-10-15; v2 needs the **publisher id** in the path (`/v2/publishers/{PUB}/items/{EXT}:upload\|:publish\|:fetchStatus`, upload via `/upload/v2/…`) | env list gains `CHROME_WEB_STORE_PUBLISHER_ID`; refresh-token exchange stays |
| Edge: client id, secret, API token (release.yml comment) | v1.1: `Authorization: ApiKey <key>` + `X-ClientID`; no token exchange; the key **expires after 72 days** | fix the workflow comment; a 401 must say where to renew (Partner Center → Publish API → Create API credentials) |
| Calls are synchronous | both are asynchronous: Chrome `uploadState: IN_PROGRESS` then `fetchStatus`; Edge `202` + `Location: <operationId>` then poll | a bounded poll layer and an exit code for "accepted, never resolved" |
| Mock server in tests | house standard is an injected `fetch` (`publish-readback.ts`) | no mock server; runs on Node and GJS |
| Leave AMO out | ADR 0077 §7 has AMO in the same table | the store table has an AMO slot; no backend in the first slice |
| `store.json` carries the listing | neither API changes listing text; Edge takes one free-text field (certification notes) | `store.json` is **preflight**, not payload: resolve ids, check the manifest version against the last published, run `listing --check` first |

Both APIs can **not create a product**. The first upload per store is by hand; `submit` only ever
adds a version to an existing one. Chrome also needs one manual publish after every visibility
change in the dashboard, or the API refuses `publish`. Edge has no "unlisted" like Chrome: what the
plan calls "hidden" is a different mechanism, to be read up before Stream G step 2.

## Rules that do not bend

- Credentials from the environment only, never a file, never an argument. A redaction function over
  header names, with a test.
- `--dry-run` **checks** the credentials with exactly one read call (Chrome `fetchStatus`; Edge an
  operation GET on an unknown id: 404 means a live key, 401 a dead one). It never uploads.
- Default is upload as a draft. `--submit` is explicit, and refuses when `$GITHUB_REF` is not a tag.
- Idempotent re-runs: the same version again is "already there" (exit 0), not a red run. Edge
  `NoModulesUpdated` and `InProgressSubmission` exit 0 with a note; `SubmissionValidationError` and
  `ModuleStateUnPublishable` are real errors. Chrome `cancelSubmission` is the documented way out
  and belongs in the command's help.
- The workflow step sits behind a GitHub Environment **with a required reviewer**, never behind a
  dispatch input alone, never behind the tag push alone.
- Going public, the first submission, privacy and data-use declarations stay with the person.

## Steps

| # | Step | Where | Gate | Needs | Model |
|---|---|---|---|---|---|
| S0 | Amend ADR 0077 §7 with the measured API facts; decide whether store credentials join `ship credentials` (ADR 0126) or get their own table | gjsify `docs/adr/` | `gjsify` doc gates | — | `paid-opus` |
| S1 | `store.json` and `--stores` in `webext listing` (Stream F2) | gjsify `packages/infra/site/src/listing/` | `gjsify workspace @gjsify/site run test` | — | `paid-sonnet` |
| S2 | Store table and types: `StoreBackend` with `upload`, `publish`, `status`; credentials from env; `fetchImpl` injectable | gjsify `packages/infra/cli/src/utils/webext/stores/index.ts` | `gjsify workspace @gjsify/cli run test:node` | S0 | `paid-sonnet` |
| S3 | Chrome backend, v2, with specs for every error class | `stores/chrome.ts` + spec | test:node, test:gjs | S2 | `paid-sonnet` |
| S4 | Edge backend, v1.1, with specs (72-day message, `202` + operation poll) | `stores/edge.ts` + spec | test:node, test:gjs | S2 | `paid-sonnet` |
| S5 | Shared poll/retry layer: bounded, timeout flag, own exit code, idempotency classes | `stores/poll.ts` + spec | test:node, test:gjs | S3, S4 | `paid-opus` |
| S6 | Subcommand `webext submit --store chrome\|edge [--dry-run] [--submit]`, redaction, preflight against `store.json` | `commands/webext/subcommands.ts`, `utils/webext/submit.ts` | `gjsify foreach -A check`, lint | S5, S1 | `paid-sonnet` |
| S7 | Docs: cli `AGENTS.md` (command, measured traps), README | gjsify | `check-agent-context-size.mjs --check` | S6 | `go-flash` |
| S8 | Beifahrer: fix the `release.yml` comment block (v1.1 / v2 shapes), add the step behind an Environment with reviewer, env names including the publisher id | beifahrer `.github/workflows/release.yml` | `node tools/check-doc-links.mjs` | S6 | `go-flash` |
| S9 | First uploads by hand (Chrome unlisted, Edge) | the person, or Beifahrer `page_upload` | — | accounts | person |

S3 and S4 run in parallel. Everything before S9 needs no account.

## Secret names (final)

Set by the person with `gh secret set <NAME> --repo JumpLink/beifahrer`; the value is prompted for
and never goes through chat.

| Store | Secrets |
|---|---|
| Chrome | `CHROME_WEB_STORE_PUBLISHER_ID`, `CHROME_WEB_STORE_ITEM_ID`, `CHROME_WEB_STORE_CLIENT_ID`, `CHROME_WEB_STORE_CLIENT_SECRET`, `CHROME_WEB_STORE_REFRESH_TOKEN` |
| Edge | `EDGE_ADDONS_PRODUCT_ID`, `EDGE_ADDONS_CLIENT_ID`, `EDGE_ADDONS_API_KEY` (expires after 72 days) |

## Out of scope

Safari (Xcode and App Store Connect, ADR 0026), AMO as a backend (signing already runs in the
release workflow), creating products, changing listing text through an API.
