#!/usr/bin/env node
// Checks that every relative markdown link in a file resolves on disk.
// Usage: node tools/check-doc-links.mjs [file …]   (default: AGENTS.md + README.md + docs/**)
import { existsSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const repo = resolve('.');

// Every markdown file the repo tracks, so a link from an ADR or a store listing is checked too.
// `git ls-files` rather than a hand-kept list: a new doc that nobody added to the list would
// otherwise be the one file whose links nobody verifies.
const trackedMarkdown = () =>
  execFileSync('git', ['ls-files', '*.md'], { encoding: 'utf8' }).split('\n').filter(Boolean);

const files = process.argv.slice(2).length ? process.argv.slice(2) : trackedMarkdown();

let broken = 0;
let outside = 0;
let checked = 0;
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  // [label](target) — skip images, absolute URLs and pure anchors
  for (const [, label, target] of text.matchAll(/\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    if (/^(https?:|mailto:|data:|#)/.test(target)) continue;
    const [path] = target.split('#');
    if (!path) continue;
    checked++;
    const full = resolve(dirname(file), path);
    if (existsSync(full)) continue;
    // A link out of the repo (../../AGENTS.md = the werkstatt hub) is correct in the real checkout
    // and unresolvable from a bare clone or worktree — report it, do not fail on it.
    if (relative(repo, full).startsWith('..')) {
      outside++;
      console.warn(`${file}: into the submodule parent, not checked: ${target}`);
      continue;
    }
    broken++;
    console.error(`${file}: broken link [${label}](${target})`);
  }
}
console.log(
  broken === 0
    ? `ok: ${checked} relative links in ${files.length} files resolve (${outside} into the parent)`
    : `${broken} broken link(s)`,
);
process.exit(broken === 0 ? 0 : 1);
