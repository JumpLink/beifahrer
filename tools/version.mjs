#!/usr/bin/env node
// One product version for the extension, the CLI, core and the root: the release workflow derives a
// single version from the tag and expects it in every artifact name, and the extension's version
// in a store and in updates.json may never go backwards.
// Usage: node tools/version.mjs set <x.y.z>   rewrite every place
//        node tools/version.mjs check [<tag>]  fail unless all agree (and, with a tag, equal `v<version>`)
import { readFileSync, writeFileSync } from 'node:fs';

const SEMVER = /^\d+\.\d+\.\d+$/;

// Edited with a pattern, not by parsing and re-serialising: `set` must change one line and leave
// the formatting of a hand-kept file alone.
const places = [
  { file: 'package.json', pattern: /^(\s*"version":\s*")([^"]+)(")/m },
  { file: 'app/package.json', pattern: /^(\s*"version":\s*")([^"]+)(")/m },
  { file: 'packages/core/package.json', pattern: /^(\s*"version":\s*")([^"]+)(")/m },
  { file: 'packages/local/package.json', pattern: /^(\s*"version":\s*")([^"]+)(")/m },
  { file: 'desktop/package.json', pattern: /^(\s*"version":\s*")([^"]+)(")/m },
  { file: 'extension/package.json', pattern: /^(\s*"version":\s*")([^"]+)(")/m },
  // Kept by hand because a JSON import would pull a whole manifest into the bundle.
  { file: 'app/src/version.ts', pattern: /^(export const VERSION = ')([^']+)(')/m },
];

const read = ({ file, pattern }) => {
  const match = readFileSync(file, 'utf8').match(pattern);
  if (!match) throw new Error(`${file}: no version found`);
  return match[2];
};

const [command, argument] = process.argv.slice(2);

if (command === 'set') {
  if (!argument || !SEMVER.test(argument)) {
    console.error('usage: node tools/version.mjs set <x.y.z>');
    process.exit(2);
  }
  for (const place of places) {
    const text = readFileSync(place.file, 'utf8');
    if (!place.pattern.test(text)) throw new Error(`${place.file}: no version found`);
    writeFileSync(place.file, text.replace(place.pattern, `$1${argument}$3`));
    console.log(`${place.file}: ${argument}`);
  }
} else if (command === 'check') {
  const found = places.map((place) => ({ file: place.file, version: read(place) }));
  const versions = new Set(found.map((f) => f.version));
  let failed = false;
  if (versions.size !== 1) {
    failed = true;
    console.error('the versions disagree, there must be exactly one:');
    for (const { file, version } of found) console.error(`  ${file}: ${version}`);
  }
  if (argument !== undefined) {
    // The one place a tag is compared: a tag that does not match must fail before anything builds.
    const [version] = versions;
    if (versions.size === 1 && argument !== `v${version}`) {
      failed = true;
      console.error(`tag ${argument} does not match the product version v${version}`);
    }
  }
  if (failed) process.exit(1);
  console.log(`version ${[...versions][0]}: ${found.length} places agree`);
} else {
  console.error('usage: node tools/version.mjs set <x.y.z> | check [<tag>]');
  process.exit(2);
}
