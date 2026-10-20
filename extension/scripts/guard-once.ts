/**
 * Wrap a classic-script bundle so it evaluates at most once per realm.
 *
 * The page agent is injected before EVERY request into the same document (src/inject.ts), so its
 * bundle evaluates more than once per realm — and a dependency's top-level side effect does not
 * survive that: `@gjsify/adwaita-core`'s `gio-resource.js` claims the Gio resource registry at
 * module top level and throws when it sees a second copy in one realm (ADR 0116 § 3, issue
 * #138). The agent's own state already guarded itself against a re-run (`__beifahrer`,
 * `__beifahrerListening`), but that guard sits inside the bundle and never gets reached once a
 * dependency has thrown — so the guard has to wrap the WHOLE bundle, which only the build can do.
 *
 * The flag lives on `globalThis` like the agent's own guards, and an isolated world is a realm:
 * a navigation creates a new one, so a reloaded document gets a fresh agent again.
 */
export function oncePerRealm(code: string, flag = '__beifahrerAgentLoaded'): string {
  return `if (!globalThis.${flag}) {\nglobalThis.${flag} = true;\n${code}\n}\n`;
}
