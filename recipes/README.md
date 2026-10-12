# Recipes

A recipe is a task on one web app, written down as data: "add a comment to an OpenProject work
package", "replace its description". The agent finds the recipes that fit a tab with
`recipes_for_tab` and runs one with `recipe_run`.

Every step is an ordinary beifahrer call, checked by the browser like one the agent made
itself: the site's level, the browser's grant, the confirmation window. A recipe cannot do
anything the agent could not do step by step, and it carries no code
([ADR 0006](../docs/adr/0006-recipes-are-data-run-as-ordinary-calls.md)).

## Where recipes live

| Source | For |
|---|---|
| `recipes/` in this repository (bundled into the app) | generic recipes for apps anyone can run: no domains, no company names |
| `$XDG_CONFIG_HOME/beifahrer/recipes/` (default `~/.config/beifahrer/recipes/`) | your own |
| each directory in `$BEIFAHRER_RECIPES` (colon-separated) | a team's shared directory, a private repository checkout |

A later source replaces an earlier one with the same `id`, in the order of the table (and of
`$BEIFAHRER_RECIPES`, left to right). Files are `*.json`, directly in a directory or one level
down (`openproject/add-comment.json`). They are read on every call, so an edit needs no restart.
A file that is not a valid recipe is listed under `refused` by `recipes_list` and skipped as a
whole.

**This repository is public.** A recipe that names a customer's domain, an internal process or
anything else about a company goes into your own directory, never into a pull request here.

## Format

```json
{
  "id": "openproject/add-comment",
  "title": "Add a comment to an OpenProject work package",
  "description": "What it does, for the agent reading it.",
  "version": "1.0.0",
  "match": { "fingerprint": [{ "meta": { "name": "app_base_path" } }, { "meta": { "name": "app_title" } }] },
  "params": [{ "name": "text", "type": "string", "description": "The comment (HTML allowed)", "required": true }],
  "steps": [
    { "id": "open-box", "action": "click", "target": { "role": "button", "name": ["Einen Kommentar hinzufügen", "Add a comment"] } },
    { "id": "wait-editor", "action": "wait", "for": { "role": "richtext" }, "timeoutMs": 10000 },
    { "id": "fill", "action": "fill", "target": { "role": "richtext" }, "param": "text", "as": "html" },
    { "id": "submit", "action": "submit", "target": { "role": "button", "name": ["Kommentar absenden", "Submit comment"] }, "requiresExplicitRequest": true }
  ]
}
```

| Field | Rules |
|---|---|
| `id` | `<app>/<task>`, lowercase letters, digits, `-` |
| `title`, `description` | for the agent: what it does, what it leaves for the person |
| `version` | `major.minor.patch` |
| `match` | one matcher or a list (any may match). A matcher has `urls` and/or `fingerprint`; every part given must hold |
| `match.urls` | patterns `<scheme>://<host><path>`: scheme `http`, `https` or `*`; host exact, `*.example.org` (with subdomains) or `*`; `:port` or `:*` (no port = the default port only); `*` in the path matches anything |
| `match.fingerprint` | checks on the page: `{ "find": <query> }` (an element exists) or `{ "meta": { "name": "…", "content": "…" } }` (a `<meta>` exists; `content` is a substring). How a self-hosted app is recognised on any domain. A meta check answers a count, never the content |
| `params` | up to 10: `name`, `type` (`"string"`, the only type), `description`, `required` |
| `steps` | 1 to 50, each with a unique `id`, an `action`, optional `note` |

**Queries** (`target`, `for`, `find`) name an element the way `page_outline` shows it:

| Key | Matches |
|---|---|
| `role` | `heading`, `link`, `button`, `textbox`, `richtext` (a contenteditable editor), `checkbox`, `radio`, `combobox`, `tab`, `menuitem` |
| `name` | a substring of the accessible name (label, `aria-label`, button text), case- and whitespace-insensitive. A list = any of them: put every UI language you know in it |
| `text` | a substring of the visible text |
| `nth` | the nth match from 0; default the first |

No refs (they belong to one page load), no CSS selectors, no code: the validator refuses those
keys by name, and any other key it does not know.

**Steps:**

| `action` | Does | Extra fields |
|---|---|---|
| `find` | fails unless the element is there | `target` |
| `click` | clicks it | `target`, `optional` (skipped when the element is not there) |
| `fill` | puts a param's value into a field or editor | `target`, `param`, `as` (`text`/`html`), `mode` (`replace`/`append`) |
| `wait` | waits for the page to load or an element to appear | `for` (`"load"` or a query), `timeoutMs` (≤ 30000), `failMessage` (what the failure says when the wait times out) |
| `read`, `outline` | returns the page text / outline in the run log | `maxChars` / `maxItems` |
| `rows` | returns the rows of the list on the page (scrolls a virtual-scroll list) | `maxRows` |
| `click-row` | clicks the row whose text contains a param's value | `param` |
| `capture` | clicks a button that hands over a document and returns the file; may end on a sister origin of the site, which needs its own level (ADR 0018) | `target`, `maxBytes` |
| `checkpoint` | stops the run with a message, so the agent looks before it goes on | `message` |
| `person` | ends the run with `needs_person` when the page shows `when` (one query) or any of `whenAny`; skipped otherwise | `kind` (`login`, `code`, `approval`, `device`), `when` or `whenAny`, `prompt` (short English sentence), `codeParam` (the param the relayed code comes back in) |
| `enter-code` | types a one-time code the person relayed, into a field marked as one (`page.enterCode`, needs the switch *Type one-time codes you relay*) | `target`, `param` |
| `submit` | a click that publishes (posts, saves, sends) | `target`; must have `"requiresExplicitRequest": true` |

Any step may carry `"requiresExplicitRequest": true`. The run stops before it unless the agent
passes `explicitRequest: true`, which it may only do when the person asked for exactly that
action. A run also stops before `until: "<step id>"`, and continues with `from: "<step id>"`.
It stops at the first failing step and names it.

A param may carry `"secret": true`; its value is replaced by `••••` in every message, log and
result of the run. The param of an `enter-code` or `person` step is secret whether or not the file
says so.

**`needs_person`.** A `person` step that matches ends the run with
`{status: "needs_person", message, next, person: {kind, origin, prompt, acceptsCode, codeParam?}}`.
The agent tells the person `prompt`, then resumes with `from: next`; when `acceptsCode` is true the
code the person gave goes in the param named `codeParam`. A site recipe declares a code step by
putting a `person` step (kind `code`, `codeParam`) in front of an `enter-code` step that targets the
code field by role and name.

## Contributing a recipe

1. Write it against the app's **labels**, not its markup. Take them from the app's own locale
   files where it has them, and list every language you can confirm.
2. Make the last write a `submit` if it publishes anything.
3. Add the file to `app/src/recipes/builtin.ts` (the unit tests fail on a file left out) and
   run `gjsify workspace beifahrer-cli test`.
4. If you can, cover it in `tests/e2e/` against a **synthetic** page. Never commit a captured
   page of a real site.

## Shipped

| id | Matches | Labels from |
|---|---|---|
| `openproject/add-comment` | OpenProject (metas `app_base_path` + `app_title`), any domain | de: measured; en: OpenProject's `label_type_to_comment`, `label_submit_comment` |
| `openproject/edit-description` | same | de: measured + `js-de.yml` `placeholders.description`, `inplace.button_save`; en: `js-en.yml` |
| `atruvia/login` | the logged-out page and the login page of an Atruvia / VR banking portal, any bank's domain (by path) | de: measured on the portal |

`atruvia/login` gets an agent back into a postbox after the short bank session ended. It only
**clicks**: the browser's own password manager fills the VR-NetKey and the PIN, and Beifahrer never
reads, types or fills either (a password field is out of reach for every method). When the PIN is
not filled, or the portal asks for a second factor (TAN, SecureGo, a new device), the last `wait`
times out and the run fails with a message telling the agent to ask the person to log in. Then
run `atruvia/list-postbox` or `atruvia/download-document` on the start page's postbox.

Since 1.1.0 the second factor is no longer a plain failure: a TAN field ends the run with
`needs_person` kind `code` (resume at `enter-tan` with the TAN in param `code`), a SecureGo or
new-device page with kind `device`, and a login page that stays open with kind `login`.

**Unverified until a live run:** the headings and the TAN field name for the device and TAN pages
(written from generic Atruvia wording), the names of the confirm button after a TAN, and that the
TAN field passes the one-time-code guard on the real page.
