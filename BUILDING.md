# Building Beifahrer from source

This page rebuilds the browser extension from a source archive, for example GitHub's tag zipball
(`https://github.com/JumpLink/beifahrer/archive/refs/tags/v<version>.zip`). The CI job
`Build from source archive` follows these steps literally on every pull request, so they stay true.

## Requirements

Tested on Fedora 44 (x86_64), in a fresh `registry.fedoraproject.org/fedora:44` container.

- **System packages:**

  ```sh
  dnf install -y --setopt=install_weak_deps=False \
    gjs libsoup3 gdk-pixbuf2 librsvg2 glib2-devel unzip xz
  ```

  The build runs on GJS, not Node. `gdk-pixbuf2` and `librsvg2` render the toolbar icons from
  SVG; `glib2-devel` provides `glib-compile-resources`. Without them the build fails.

- **Node 24** from [nodejs.org](https://nodejs.org/en/download) (the official `linux-x64`
  tarball) or `actions/setup-node`. Node only bootstraps the `gjsify` CLI.
  **Do not use Fedora's `nodejs24` package:** it crashes (segfault in V8's `Intl.Segmenter`)
  while `gjsify install` runs.

- **The `gjsify` CLI**, at the exact version the repository pins:

  ```sh
  VERSION=$(node -p "require('./app/package.json').devDependencies['@gjsify/cli']")
  npm install -g "@gjsify/cli@$VERSION"
  ```

## Steps

Unpack the archive and work from its root:

```sh
unzip beifahrer-<tag>.zip && cd beifahrer-*/
VERSION=$(node -p "require('./app/package.json').devDependencies['@gjsify/cli']")
npm install -g "@gjsify/cli@$VERSION"
gjsify install --immutable        # installs the pinned dependencies from gjsify-lock.json
cd extension && gjsify run zip    # bundles and packs every target
```

## Result

`extension/.output/` holds one zip per target, named `beifahrer-<version>-<target>.zip`:

| File | Store |
|---|---|
| `beifahrer-<version>-firefox-amo.zip` | Firefox, addons.mozilla.org (listed channel) |
| `beifahrer-<version>-firefox-mv2.zip` | Firefox, self-hosted `.xpi` (the signed unlisted build) |
| `beifahrer-<version>-chrome-mv3.zip` | Chrome Web Store |
| `beifahrer-<version>-edge-mv3.zip` | Microsoft Edge Add-ons |
| `beifahrer-<version>-safari-mv3.zip` | Safari web-extension sources (the app wrapper needs macOS and Xcode) |

The extension's version is `version` in `extension/package.json`. The add-on is not minified: the
bundle is TypeScript compiled and joined by `gjsify`.

## Compare with a release asset

Zip bytes differ between builds because of file timestamps, so compare the contents:

```sh
mkdir mine released
unzip -q extension/.output/beifahrer-<version>-firefox-amo.zip -d mine
unzip -q /path/to/beifahrer-<version>-firefox-amo.zip -d released
diff -r mine released && echo identical
```

## Containers

In an unprivileged container the image loader (GdkPixbuf / glycin) starts a `bwrap` sandbox that
fails with `Loader process exited early`. Run the container with `podman run --privileged` (or
`docker run --privileged`). A normal desktop does not have this problem.
