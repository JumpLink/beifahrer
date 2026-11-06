# Conventions

## Commits

* Conventional commits (`feat(extension): …`, `fix(bridge): …`), imperative, subject
  ≤ 50 chars.
* Atomic; each leaves the codebase working.

## Versioning

**One product version** for the extension, the CLI, core and the root. Bump with
`node tools/version.mjs set <x.y.z>` (never by hand: five files carry it), so the
commit is `chore: bump to <x.y.z>`, not `chore(extension): …`. `version:check` runs
in CI and, against the tag, first in the release.

## Submodules

This repo is a submodule of werkstatt: commit here first, then bump the pointer in
the parent.

## Dependencies

All `@gjsify/*` pins are the same exact version; `gjsify upgrade --check` is the gate
(offline, 30 deps) and `gjsify upgrade --align` the fix.

## Licences

Apps (`app/`, `extension/`) and the root are AGPL-3.0-or-later; every package under
`packages/` is LGPL-3.0-or-later (own `LICENSE` + `COPYING`). A package never depends
on an AGPL workspace. No SPDX headers in sources.

## Docs and comments

Docs in English. Comments explain *why*.

## Pull requests

A PR that changes anything visible shows it in its body: screenshots (headless,
`headless-run`) pushed to an orphan branch `pr-assets/<topic>` and embedded via
`https://raw.githubusercontent.com/JumpLink/beifahrer/pr-assets/<topic>/<file>.png`,
before/after where there is a before.
