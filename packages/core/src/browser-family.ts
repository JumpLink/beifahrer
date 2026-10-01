/**
 * Which browser an extension is running in, read off the user agent.
 *
 * It is a RUNTIME reading, not the build target, and that is not an accident. One build runs on
 * every Chromium: `chrome-mv3` and `edge-mv3` ship the same bundle, because a target says what to
 * PACKAGE, and the person may have Chrome, Edge, Brave or a Chromium build of their own. So the
 * two axes stay separate — a target name never reaches the wire, and a family is never guessed from
 * the folder the build came out of.
 *
 * Edge is therefore a `chromium` with the name `Microsoft Edge`, which is exactly what
 * `browsers_list` prints and what `browser:` is matched against (app/src/bridge/bridge.ts). Giving
 * Edge a family of its own would have added a wire value that changes no decision anywhere: the
 * manifest is the same file, the APIs are the same APIs, and the only difference is the label.
 */
import type { BrowserFamily } from './protocol.ts';

/** What the agent is told about a connected browser: its family, and what it calls itself. */
export interface BrowserIdentity {
  family: BrowserFamily;
  name: string;
  version: string;
}

/** One entry of `navigator.userAgentData.brands` (Chromium only; absent on Firefox and Safari). */
export interface UserAgentBrand {
  brand: string;
  version: string;
}

const UNKNOWN: BrowserIdentity = { family: 'unknown', name: 'unknown', version: '' };

/**
 * The browser behind a user agent. Pure, so it is unit-testable on Node and GJS (extension/
 * src/browser-info.ts holds only the runtime wiring, and Firefox's `runtime.getBrowserInfo`, which
 * needs the extension API and outranks everything here).
 *
 * The order is load-bearing: Safari must come last, because every engine above it also says
 * `Safari/` in its user agent, and Epiphany must come before Chromium, because it says `Chrome/`
 * too.
 */
export function browserFromUserAgent(ua: string, brands?: readonly UserAgentBrand[]): BrowserIdentity {
  const epiphany = /Epiphany\/([\d.]+)/.exec(ua);
  if (epiphany) return { family: 'epiphany', name: 'Epiphany', version: epiphany[1] ?? '' };

  // `userAgentData` names the browser in the order the browser chooses, and always carries the two
  // entries that name nobody ("Not?A?Brand" — the GREASE entries — and "Chromium"), so the first
  // one that is neither is the browser itself: "Microsoft Edge", "Brave", "Google Chrome".
  const brand =
    brands?.find((b) => !/Not.?A.?Brand|Chromium/i.test(b.brand)) ??
    brands?.find((b) => /Chromium/.test(b.brand));
  const chrome = /Chrome\/([\d.]+)/.exec(ua);
  if (brand || chrome) {
    return {
      family: 'chromium',
      name: brand?.brand ?? 'Chromium',
      // The brand's version where there is one: Chromium's own entry lags the real browser, and
      // the person is told what they are running.
      version: brand?.version ?? chrome?.[1] ?? '',
    };
  }

  // What only Safari has is `Version/<n>` without a `Chrome/` token.
  const safari = /Version\/([\d.]+).*Safari\//.exec(ua);
  if (safari) return { family: 'safari', name: 'Safari', version: safari[1] ?? '' };
  return UNKNOWN;
}
