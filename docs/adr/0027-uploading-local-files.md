# 0027: Uploading local files into a page, from a folder the person chose

- **Status:** accepted (decided by the agent on behalf of the person, at their request, 2026-11-05)
- **Date:** 2026-11-05
- **Mirrors:** [0021](0021-captured-files-on-disk.md) (the person's folder, in the other direction)
- **Asked for by:** the person, 2026-11-05: an agent that fills a form needs to attach a document
  (an invoice, a scan) to the page's "Choose file" field.

## Context

A page's `<input type="file">` cannot be filled by typing, and a script may not set its value. The
picker is a native dialog nobody can drive from an extension. Without a way in, a form that wants an
attachment is a dead end for the agent.

Reading the person's disk is a new reach: an agent that chooses the path chooses what leaves the
machine, and the receiving side is a website.

## Options

1. **Not at all.** Safe; the dead end stays.
2. **Any path the person's user can read.** Rejected: an agent could send `~/.ssh` to any site.
3. **Paths inside one folder the person configured, behind a switch and a confirmation.** Chosen.
4. **The extension reads the disk** (native messaging). Rejected: it needs another install step and
   gives the extension a disk reach the design avoids (ADR 0021).

## Decision

1. The MCP server takes `--upload-dir <abs dir>` or `BEIFAHRER_UPLOAD_DIR` (`mcp` and `tool`). Unset
   means no upload, ever. A relative value fails at startup.
2. `page_upload` takes `tabId`, `ref` and `paths`. `ref` is the file field, a label, or the button
   that opens it; the page agent also accepts the single file field nearest to a button, and refuses
   a guess between several. Every path must resolve, after `..` and symlinks, to a regular file inside
   the folder; anything else is refused by the bridge BEFORE the browser is asked.
3. The bridge reads the files and sends `{name, mime, size, base64}` to the extension. This is a
   deliberate exception to "the extension has no business on the disk": the page needs the bytes and
   only the bridge can read them. The folder check lives in the bridge, the SITE check in the extension.
4. In the extension it is a write like any other: its own feature switch **Upload files** (off by
   default), level *Read + edit* on the site, and the person's confirmation unless switched off. The
   window lists each file's name and size, never its content.
5. Limits, shared in `@beifahrer/core`: 10 files, 10 MiB each, 20 MiB in all. Checked in the bridge
   (real size, after reading) and again in the extension.
6. The page agent builds `File`s from the bytes, sets them through `DataTransfer`, honours `multiple`
   and `accept`, and fires `input` and `change`. The answer holds name, size and type per file as the
   page now holds them, and `accepted`. File bytes never go back to the agent.
7. File fields appear in `page_outline` and `page_find` with the role `file`, so an agent can get a ref.

## Consequences

- The person who sets no folder, or leaves the switch off, loses nothing.
- Anything in the folder can be sent to a site the person allowed at *Read + edit*: keep only what may
  be sent there.
- A page that reads a file with its own listener, not on `change`, may not notice; `accepted` says only
  that the field holds the files.
- Large frames: the bytes travel base64 in one request frame, hence the 20 MiB cap.
