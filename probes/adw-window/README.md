# adw-window

Spike sources for [desktop-app-spikes.md](../../docs/desktop-app-spikes.md): an Adwaita window
(`main.ts`) and a `Gio.FileMonitor` check (`monitor.ts`). Not a workspace member, not shipped.

The node build must sit inside the repository, or `@gjsify/node-gi` does not resolve:

```sh
gjsify build probes/adw-window/main.ts --app node --outfile probes/adw-window/out.node.mjs
node probes/adw-window/out.node.mjs     # opens a window for 1.5 s, exits 0
gjsify build probes/adw-window/main.ts --app gjs --outfile probes/adw-window/out.gjs.mjs
gjs -m probes/adw-window/out.gjs.mjs
```
