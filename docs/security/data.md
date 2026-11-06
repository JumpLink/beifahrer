# Data handling, connections and recipes

## Nothing leaves the device

No telemetry, no remote endpoint. The Firefox manifest declares
`data_collection_permissions: none`, and that must stay true.

## One connection per agent session

Each bridge binds its own port of the range (`listenInRange`), and the extension
admits every socket on its own: loopback, an extension Origin in the handshake, the
token (constant time), then the person's dismissal. No bridge relays for another; a
hub would bring back #13 (an old session blocking new methods). The extension only
ever builds `ws://127.0.0.1:<port>/` from a port of the range, and treats a session's
label as untrusted text (`cleanSessionLabel`, set as text)
([ADR 0007](../adr/0007-one-connection-per-agent-session.md)).

## Recipes are data and hold no gate

The bridge runs a recipe as ordinary calls (`app/src/recipes/runner.ts`), so the
extension checks every step; the extension never learns what a recipe is. Steps
address elements by role + name, never by ref, selector or code, and `parseRecipe`
(core) refuses any key it does not know. A publishing step is a `submit` with
`requiresExplicitRequest: true`. The public `recipes/` holds generic recipes only:
company domains and processes go in the operator's own directory
([ADR 0006](../adr/0006-recipes-are-data-run-as-ordinary-calls.md)).

## Fixtures are synthetic

Never commit a captured page or a screenshot of a real site. What the extension reads
is the person's private data.

## i18n

Every string the PERSON reads goes through i18n; what the AGENT reads stays English
([ADR 0008](../adr/0008-ui-on-adwaita-web.md)). The pages say only what is not
normal ([ADR 0009](../adr/0009-quiet-pages.md)); the build refuses unused keys and
dashes, `!` or curly quotes in the copy. Pages, confirm window, pill, tooltip and any
error in them: `t('key')` (`extension/src/i18n.ts`) or `data-i18n*` in the HTML, with
the key in EVERY `extension/_locales/*/messages.json` (the build fails otherwise).
MCP tool descriptions and wire error messages are never translated. A new method
needs `method_<name>` (activity words) in every locale, or `gjsify tsc` fails.
