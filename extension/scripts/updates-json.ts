/**
 * Build `updates.json`, the manifest Firefox fetches to find a newer signed build (issue #3).
 *
 *   gjsify workspace beifahrer-extension updates <signed.xpi> <tag>
 *
 * AMO's `sign.sh` produces a signed .xpi a person installs once, and nothing afterwards tells their
 * Firefox that a newer one exists — a self-distributed add-on updates itself ONLY through this file
 * (Extension Workshop, "Distributing an add-on yourself"). The shape is Mozilla's, not ours:
 *
 *   { "addons": { "<id>": { "updates": [ { version, update_link, update_hash } ] } } }
 *
 * `update_link` must be `https`, and GitHub's release-asset URLs are. `update_hash` is the SHA-256 of
 * the SAME .xpi, so a truncated or swapped download is refused instead of installed — which is why
 * this runs on the signed artefact rather than on the unsigned zip: it has to describe the bytes
 * Firefox will actually fetch.
 *
 * Two things are read back OUT of the .xpi rather than taken from the build, because both would
 * silently produce an update that never installs:
 *
 *   version     Firefox compares it against the installed version, and web-ext signs the manifest's
 *               own version. An entry that disagrees with the signed bytes is skipped, not applied.
 *   gecko.id    The add-on key. AMO keys the signed add-on by the id it signed, so a mismatch means
 *               the file updates a copy that does not exist.
 *
 * `updatesJson()` is pure and exported so the unit suite can check the shape without an .xpi; this
 * module is the thin shell around it that finds the file, hashes it and writes the result.
 */

import GLib from 'gi://GLib';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { unzipSync } from 'fflate';

import { GECKO_ID, GECKO_STRICT_MIN_VERSION, UPDATE_URL } from '../manifest.ts';

/** The owner/repo this file is published under; every `update_link` is built from it. */
const REPO = 'https://github.com/JumpLink/beifahrer';

/** One entry of `addons[*].updates[*]`, in Mozilla's own key names. */
export interface UpdateEntry {
  version: string;
  update_link: string;
  update_hash: string;
  applications: { gecko: { strict_min_version: string } };
}

/** What `updates.json` is, for one add-on. */
export interface UpdatesManifest {
  addons: Record<string, { updates: UpdateEntry[] }>;
}

/**
 * The manifest for `version`, as Mozilla's update manifest needs it.
 *
 * `hash` is the bare hex digest of the signed .xpi; the `sha256:` prefix is this function's job, so a
 * caller that already has one cannot forget it. `strictMinVersion` travels with the entry because
 * Firefox uses it to decide whether the RUNNING browser may take the update at all — an add-on whose
 * new version needs a newer Firefox must not install over an older one.
 */
export function updatesJson(options: {
  id: string;
  version: string;
  /** The asset's file name, which is its name on the release page. */
  file: string;
  /** The release tag, `v…`. It goes in `update_link`, so it must be the tag the file was cut from. */
  tag: string;
  /** Hex SHA-256 of the .xpi, no prefix. */
  hash: string;
  strictMinVersion: string;
}): UpdatesManifest {
  if (!options.tag.startsWith('v')) {
    throw new Error(`tag "${options.tag}" does not start with "v"`);
  }
  if (!/^[0-9a-f]{64}$/.test(options.hash)) {
    throw new Error(`hash "${options.hash.slice(0, 12)}…" is not a hex SHA-256 digest`);
  }
  return {
    addons: {
      [options.id]: {
        updates: [
          {
            version: options.version,
            update_link: `${REPO}/releases/download/${options.tag}/${options.file}`,
            update_hash: `sha256:${options.hash}`,
            applications: { gecko: { strict_min_version: options.strictMinVersion } },
          },
        ],
      },
    },
  };
}

/** The SHA-256 of a file's bytes, as hex. GLib does the digest; the file is read as bytes first. */
function sha256(path: string): string {
  const checksum = GLib.Checksum.new(GLib.ChecksumType.SHA256);
  checksum.update(readFileSync(path));
  return checksum.get_string() as string;
}

/** `manifest.json` out of a signed .xpi, which is a zip. */
function manifestIn(xpi: string): { version: string; gecko?: { id?: string; update_url?: string } } {
  const entry = unzipSync(readFileSync(xpi))['manifest.json'];
  if (!entry) throw new Error(`${xpi} carries no manifest.json`);
  return JSON.parse(new TextDecoder().decode(entry)) as {
    version: string;
    gecko?: { id?: string; update_url?: string };
  };
}

// ---------------------------------------------------------------------------------------------
// The shell: argument handling, reading the artefact, writing the file. Kept below the pure part so
// importing this module (as the unit suite does) never runs any of it.

const isMain = process.argv[1]?.endsWith('updates-json.gjs.mjs');
if (isMain) {
  const xpi = process.argv[2];
  const tag = process.argv[3];
  if (!xpi || !tag) {
    throw new Error('usage: updates-json <signed.xpi> <tag, e.g. v0.1.0>');
  }
  const manifest = manifestIn(xpi);
  // Both are refusals rather than corrections: a signed .xpi whose manifest disagrees with this
  // repository was built from something else, and "fixing" the entry would publish an update for a
  // version nobody can install.
  if (manifest.gecko?.id !== GECKO_ID) {
    throw new Error(`the signed build carries gecko id ${manifest.gecko?.id}, expected ${GECKO_ID}`);
  }
  if (manifest.gecko?.update_url !== UPDATE_URL) {
    throw new Error(
      'the signed build carries no matching update_url — manifest.ts and this script must agree',
    );
  }
  const json = `${JSON.stringify(
    updatesJson({
      id: GECKO_ID,
      version: manifest.version,
      file: basename(xpi),
      tag,
      hash: sha256(xpi),
      strictMinVersion: GECKO_STRICT_MIN_VERSION,
    }),
    null,
    2,
  )}\n`;
  const out = `${process.cwd()}/updates.json`;
  GLib.file_set_contents(out, json);
  console.log(`wrote ${out}: beifahrer ${manifest.version} from ${tag}`);
}