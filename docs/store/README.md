# Store submissions

The material a person needs to put beifahrer into the browser extension stores, and what is still
undecided. Nothing here is a machine that submits anything: every store needs an account a person
holds, and the release workflow deliberately has no store step
([`.github/workflows/release.yml:43-65`](../../.github/workflows/release.yml)). The zips hung on a
GitHub release are the distribution until then.

## What each store wants, and which file answers it

| Store | Route in this repo | Questions its form asks | Answered in |
|---|---|---|---|
| Firefox — listed on AMO | `.xpi` from the Developer Hub, or `web-ext sign` | name, summary, description, categories, support email + website, license, privacy policy, notes for reviewers | [listing.md](listing.md), [privacy.md](privacy.md) |
| Firefox — unlisted | [`extension/scripts/sign.sh`](../../extension/scripts/sign.sh) | nothing but an AMO API key | already scripted |
| Chrome Web Store | `beifahrer-0.1.0-chrome-mv3.zip` | name, summary, description, single purpose, per-permission justification, remote-code declaration, data-use certification, privacy-policy URL, icon, small promo tile, 1–5 screenshots | [listing.md](listing.md), [privacy.md](privacy.md), [screenshots.md](screenshots.md) |
| Edge Add-ons | `beifahrer-0.1.0-edge-mv3.zip` | name, short description, per language, logo, optional tile and 6 screenshots, single purpose, privacy-policy URL | [listing.md](listing.md), [privacy.md](privacy.md), [screenshots.md](screenshots.md) |
| Opera | `beifahrer-0.1.0-chrome-mv3.zip` | summary, screenshots at 612×408, icons, privacy | [listing.md](listing.md), [screenshots.md](screenshots.md) |
| Safari | `beifahrer-0.1.0-safari-mv3.zip` | a person signs in Xcode against a provisioning profile and uploads through App Store Connect | a person, no document here yet |

The Edge package is the `chrome-mv3` manifest in full — Edge is Chromium, so it needs no branch of
its own ([`extension/manifest.ts:86`](../../extension/manifest.ts)).

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
2. **The URLs.** Every store asks for a homepage, a support URL and a privacy-policy URL. None exists
   yet — see the list below. A page that 404s is a rejection, and the cheapest fix is publishing
   three short pages first.
3. **Screenshots.** A script renders the three extension pages today; the two shots that show what
   the agent does on a page need a person's hands. [screenshots.md](screenshots.md) says which is
   which, so the accounts and the URLs can be done while they are being taken.
4. **The listing copy.** [listing.md](listing.md) is already written, from the strings the extension
   already ships, so it cannot drift from the product. Read it, change what you disagree with.
5. **Submit.** Store by store. A rejection on one store is not a rejection on another, and the
   review is where a wrong `<verify>` finally shows up.

## What a person must still do

Nothing below can be derived from the repository. Each item is a decision, a name, or an account.

- **Choose the public URLs.** The repository remote is `git@github.com:JumpLink/beifahrer.git` and it
  is **already public** (measured with `gh repo view --json visibility`), which is what AMO's listed
  review wants to see for the source. What is missing is not the repository but a place to point a
  store at: `package.json` carries no `homepage`, so nothing in the tree names a homepage, a
  support site or a privacy-policy URL, and no such page is hosted. `"private": true` in
  `package.json` is the npm-publish guard and has nothing to do with the repository's visibility —
  do not read it as "not public". Someone has to decide what the three pages say and where they live.
- **Decide who the support contact is.** AMO asks for a support email and a support website; both
  are a person's decision, not a string the project can pick.
- **Answer the fee and account questions.** Every `<verify>` in these four files.
- **Decide the categories** in [listing.md](listing.md). The candidates are written; the pick is a
  judgement about who the extension is for.
- **Do the Safari submission by hand**, or decide not to. It is the one store with no scripted route
  at all.
- **Decide whether the release workflow gets a store step.** The secrets are already named in
  [`.github/workflows/release.yml:47-61`](../../.github/workflows/release.yml); nobody has decided
  that CI should hold them.

## Files here

- **[privacy.md](privacy.md)** — the privacy statement, every substantive claim cited to
  `file:line`, with the one thing that cannot be verified in code named as such.
- **[listing.md](listing.md)** — the copy for every store's form, each line traced to the
  `_locales` file it comes from, plus the per-permission justification Chrome and Edge ask for.
- **[screenshots.md](screenshots.md)** — what each store requires, and a production plan that says
  which shot a script can render today and which needs a person.
