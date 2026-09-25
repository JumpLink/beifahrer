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
| `click` | clicks it | `target` |
| `fill` | puts a param's value into a field or editor | `target`, `param`, `as` (`text`/`html`), `mode` (`replace`/`append`) |
| `wait` | waits for the page to load or an element to appear | `for` (`"load"` or a query), `timeoutMs` (≤ 30000) |
| `read`, `outline` | returns the page text / outline in the run log | `maxChars` / `maxItems` |
| `checkpoint` | stops the run with a message, so the agent looks before it goes on | `message` |
| `submit` | a click that publishes (posts, saves, sends) | `target`; must have `"requiresExplicitRequest": true` |

Any step may carry `"requiresExplicitRequest": true`. The run stops before it unless the agent
passes `explicitRequest: true`, which it may only do when the person asked for exactly that
action. A run also stops before `until: "<step id>"`, and continues with `from: "<step id>"`.
It stops at the first failing step and names it.

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
