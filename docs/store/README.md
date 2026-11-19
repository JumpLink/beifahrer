# Store submissions

The material a person needs to put Beifahrer into the browser extension stores, and what is still
undecided. The listing text, permission justifications, icons and screenshots are not written here: `gjsify webext
listing` derives them from `data/eu.jumplink.beifahrer.metainfo.xml`, the German catalogue in
`docs/store/po/de.po` and the `gjsify.webext.listing` block in `package.json`. `gjsify webext listing
--out <dir>` writes the kit, and CI runs `gjsify webext listing --check`.

## What is scripted, and what stays with a person

- **Chrome and Edge.** The `submit-stores` job in
  [`release.yml`](../../.github/workflows/release.yml) uploads a **draft** after a release. It waits
  behind the `store-release` Environment, so the store secrets reach a runner only after the required
  reviewer approves.
- **Credential check.** [`store-check.yml`](../../.github/workflows/store-check.yml) runs
  `webext submit --dry-run` on demand, behind the same Environment. It makes one read call per store
  and uploads nothing. Run it before the first upload and before the Edge key expires.
- **The first submission for review, and any switch to public, stay with the person.** The job never
  does either.
- **Firefox** has ONE channel per version, because AMO accepts a version number once across listed
  and unlisted. Until the public listing exists, `sign-firefox` signs unlisted. Once it does, the
  repo variable `FIREFOX_CHANNEL=listed` switches the same job to AMO's listed channel. It uploads
  the `firefox-amo` zip (the build without `update_url`, see `manifest.ts`), which only validates
  it. With `submit_for_review` (or `FIREFOX_AUTO_SUBMIT=true`), it creates the version and sends it
  to review. After approval, `extension/scripts/amo-listed.sh` attaches AMO's signed file and an
  `updates.json` to the release. GitHub installs take that update and from then on update from AMO.
  The first listed version is submitted by hand in the Developer Hub.
- **Safari** is manual: Xcode and App Store Connect.

## What each store wants, and which file answers it

| Store | Route in this repo | Questions its form asks | Answered in |
|---|---|---|---|
| Firefox — listed on AMO | `.xpi` from the Developer Hub, or `web-ext sign` | name, summary, description, categories, support email + website, license, privacy policy, notes for reviewers | generated (`--stores amo`); [listing.md](listing.md) for the rest, [privacy.md](privacy.md) |
| Firefox — unlisted | [`extension/scripts/sign.sh`](../../extension/scripts/sign.sh) | nothing but an AMO API key | already scripted |
| Firefox — staying up to date | `sign.sh <tag>` also writes `updates.json` | an asset named exactly `updates.json` on the release | scripted; the URL is fixed in [`extension/manifest.ts`](../../extension/manifest.ts) and cannot be moved later |
| Chrome Web Store | `beifahrer-0.1.0-chrome-mv3.zip` | name, summary, description, single purpose, per-permission justification, remote-code declaration, data-use certification, privacy-policy URL, icon, small promo tile, 1–5 screenshots | generated; questionnaires in [listing.md](listing.md), [privacy.md](privacy.md), [screenshots.md](screenshots.md) |
| Edge Add-ons | `beifahrer-0.1.0-edge-mv3.zip` | name, short description, per language, logo, optional tile and 6 screenshots, single purpose, privacy-policy URL | generated; questionnaires in [listing.md](listing.md), [privacy.md](privacy.md), [screenshots.md](screenshots.md) |
| Opera | `beifahrer-0.1.0-chrome-mv3.zip` | summary, screenshots at 612×408, icons, privacy | [listing.md](listing.md), [screenshots.md](screenshots.md) |
| Safari | `beifahrer-0.1.0-safari-mv3.zip`, or the Xcode project from `extension/scripts/safari-build.sh` | App Store: a person signs in Xcode against a provisioning profile and uploads through App Store Connect. Outside the store: Developer ID + notarization (Safari 18.4+) — no certificate exists yet | a person; researched in [listing.md](listing.md#safari) and [macos-run.md §3.4](../macos-run.md#34-developer-id-distribution-outside-the-mac-app-store-researched-not-built) |

The Edge package is the `chrome-mv3` manifest in full — Edge is Chromium, so it needs no branch of
its own ([`extension/manifest.ts:14`](../../extension/manifest.ts): `edge-mv3` is in `TARGETS`, and
the manifest function keys the flavour off the engine, not off the target's name).

## Read `<verify>` as a question, not a gap

Every number a store charges, every deadline, and every account requirement in these documents is
marked `<verify>` unless a fetched page stated it. A `<verify>` names the page to read. Nothing in
these files may be pasted into a store form before the `<verify>` is answered — the store pages
change, and a wrong fee or a wrong screenshot size costs a review cycle.

What is **not** `<verify>` is every claim about what the code does: those carry a `file:line` and
were read in the tree this was written against (`0.1.0`, branch off `b79a9bd`).

## The order that avoids wasted work

1. **Accounts first, and the ones with fees.** Chrome Web Store requires a registered developer
   account and a one-time registration fee before anything can be published
   ([register](https://developer.chrome.com/docs/webstore/register) — the page states a fee is
   required, the amount is `<verify>`). Edge states there is no registration fee but requires a
   Microsoft account as the account's Primary Owner
   ([create-dev-account](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/create-dev-account)).
   AMO needs a Mozilla account; whether listing costs anything is `<verify>`. Do this before writing
   a word of copy: it is the only step that can be blocked by something outside this repository.
2. **The URLs.** Every store asks for a homepage, a support URL and a privacy-policy URL. The
   homepage is live (`https://jumplink.eu/beifahrer/`); support and the privacy policy are not — see
   the list below. A page that 404s is a rejection, and the cheapest fix is publishing the remaining
   two pages first.
3. **Screenshots.** A script renders the three extension pages today; the two shots that show what
   the agent does on a page need a person's hands. [screenshots.md](screenshots.md) says which is
   which, so the accounts and the URLs can be done while they are being taken.
4. **The listing copy.** `gjsify webext listing` writes it from the AppStream metainfo, so it cannot
   drift from the product. Read the output, change the inputs you disagree with, never a copy.
   [listing.md](listing.md) holds only the questionnaires the generator cannot answer.
5. **Submit.** Store by store. A rejection on one store is not a rejection on another, and the
   review is where a wrong `<verify>` finally shows up.

## What a person must still do

Nothing below can be derived from the repository. Each item is a decision, a name, or an account.

- **The homepage is settled.** `https://jumplink.eu/beifahrer/` — `gjsify.site.url`, built by
  `gjsify site build` from the AppStream metainfo and deployed by
  [`deploy-site.yml`](../../.github/workflows/deploy-site.yml); now also `package.json` → `homepage`.
  The repository remote is `git@github.com:JumpLink/beifahrer.git` and it is **already public**
  (measured with `gh repo view --json visibility`), which is what AMO's listed review wants to see
  for the source. `"private": true` in `package.json` is the npm-publish guard and has nothing to do
  with the repository's visibility — do not read it as "not public".
- **Two URLs are still open: support and the privacy policy.** Someone has to decide whether support
  is the homepage, a dedicated page, or the issue tracker, and where `privacy.md` gets hosted — see
  below for the privacy-policy page question.
- **Decide who the support contact is.** AMO asks for a support email and a support website; both
  are a person's decision, not a string the project can pick.
- **Answer the fee and account questions.** Every `<verify>` in these four files.
- **Decide the AMO categories** ([listing.md](listing.md)). Chrome's and Edge's are set in
  `package.json`; the pick is a judgement about who the extension is for.
- **Do the Safari submission by hand**, or decide not to. It is the one store with no scripted route
  at all.
- **Approve each upload, and make the first submission.** `submit-stores` waits for the
  `store-release` approval, leaves a draft, and a person submits the first one for review and decides
  when a listing goes public.

## Files here

- **[privacy.md](privacy.md)** — the privacy statement, every substantive claim cited to
  `file:line`, with the one thing that cannot be verified in code named as such.
- **[listing.md](listing.md)** — only what the generator cannot write: the Firefox, Opera and Safari
  routes, the Chrome and Edge questionnaires, and the decisions that stay with a person.
- **[screenshots.md](screenshots.md)** — what each store requires, and a production plan that says
  which shot a script can render today and which needs a person.
