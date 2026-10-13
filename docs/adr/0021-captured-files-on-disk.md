# 0021: Captured files on disk, in a directory the person chose

- **Status:** accepted (decided by the agent on behalf of the person, at their request, 2026-10-13)
- **Date:** 2026-10-13
- **Refines:** [0018](0018-download-from-a-sister-origin.md) (`page.capture`)
- **Asked for by:** the person, 2026-10-13: an agent that only hands a downloaded document to
  another MCP server (a Paperless upload taking `file_path`) should not carry the bytes.

## Context

`page.capture` (and the `capture` step of a recipe such as `atruvia/download-document`) returns the
file as base64 in the tool result. The agent reads every byte of it as context, then has to write
it out again to pass it on. A 2 MB statement is ~2.7 MB of tokens-worth of text nobody needs.

Writing to disk is a new reach: the bridge would put a file where the agent says. An agent that
chooses the path chooses what gets overwritten.

## Options

1. **Leave it.** Safe; the cost stays.
2. **`saveDir` taken as given.** Cheap, and lets an agent write anywhere the user can.
3. **`saveDir` only inside a directory the person configured.** Chosen.
4. **Write from the extension** (the `downloads` API). Rejected: the extension has no business on
   the disk, and the bytes already travel to the bridge.

## Decision

1. The MCP server takes `--save-dir <abs dir>` or `BEIFAHRER_SAVE_DIR` (`mcp` and `tool`). Unset
   means no saving, ever. A relative value fails at startup.
2. `page_capture` and `recipe_run` take an optional `saveDir`: an absolute directory equal to, or
   below, the configured one. Without it, behaviour is unchanged (base64). `page_download` does
   not take it: it is a read tool, and a read tool that writes files breaks the read-only gate.
3. With `saveDir`, the file is written by the bridge and the answer is
   `{path, filename, mime, size, sha256, via}` (in a recipe, in the capture step's log entry). No
   `base64`.
4. The check runs BEFORE the click, so a refused directory does not cost a document its "unread"
   state on a portal that marks it read on download.

## Guards

- Fail closed: no configured directory, or a path outside it (lexically, by `..`, a sibling with the
  same prefix, or a symlink inside the root leading out), is refused with a message naming the
  allowed directory. The symlink check runs before anything is created.
- The filename is only a name: path parts, control characters and leading dots are stripped, 120
  characters at most, `download` if nothing is left.
- Files are created with `wx` (never overwrite; a clash becomes `name (1).ext`) and mode `0600`;
  directories made below the root are `0700`.
- The extension and the policy are untouched; saving adds no protocol method. What the extension
  allowed the page to hand over is all that can be written.

## Consequences

- The agent can chain `path` into another tool without the bytes passing through it.
- The person decides where captured documents land; nothing lands anywhere until they say so.
- A file stays on disk after the session. Cleaning the directory is the person's job.
