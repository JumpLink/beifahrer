# docs

Reference material for Beifahrer. The rules an agent needs on nearly every task are in
[AGENTS.md](../AGENTS.md) — this directory holds what is read when a task reaches for it.

| Document | Holds |
|---|---|
| [adr/](adr/) | The design decisions, one file each, numbered and immutable once accepted. A rule in `AGENTS.md` that names an ADR points here |
| [store/](store/) | Store submissions: listing text, privacy policy, screenshots, and what is still undecided ([index](store/README.md)) |
| [macos-run.md](macos-run.md) | Running this repository on an Apple-silicon MacBook: prerequisites, build, run, and the failures that only look like Beifahrer bugs |
| [traps-browser-platform.md](traps-browser-platform.md) | Engine facts paid for: Safari's dead worker, the MV3 CSP that forbids `eval`, `permissions.remove` subtracting by coverage, synthetic input, headless drivers |
| [traps-extension-code.md](traps-extension-code.md) | Code facts paid for: `decide()`'s union, the three layers of a frame's identity, the loop that measured the gap instead of the work |
| [traps-build-and-test.md](traps-build-and-test.md) | Build and test facts paid for: the stale test bundle, `gjsify check`'s colours, `update_url`, the person's port range, what the e2e cannot do headless |
| [desktop-app-spikes.md](desktop-app-spikes.md) | What was measured before the native app: an Adwaita window under node-gi, one project vs two packages, registry liveness |
| [gjsify-gaps.md](gjsify-gaps.md) | gjsify capabilities this project lacks and how each is worked around — each gap fixed UPSTREAM, never around |