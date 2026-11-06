# Beifahrer overview

Beifahrer is a WebExtension (Firefox MV2, Chromium MV3, bundled by gjsify on GJS)
plus a loopback bridge exposed as an MCP server. Together they let an agent use the
person's *own* browser under a per-site policy the person sets in that browser.

Why an extension plus a bridge, and what else was considered:
[ADR 0001](adr/0001-a-browser-extension-not-a-driven-browser.md).

## Runtimes

Linux ships GJS; any host with Node 24 can run the bridge. GJS is the default
because the Linux releases are built and tested there, but the e2e run starts the
bridge with plain `node` to exercise the whole chain.

Each runtime needs its own bundle, because gjsify rewrites GJS-only imports per
`--app` *while building*: a build difference, not a source one
([build facts](traps-build-and-test.md)).
