/**
 * A click, and the one retry that makes it reliable — for custom elements only.
 *
 * Some custom elements (a `<v6_he-button>` in Partner Center, the Chrome Web Store's confirm button)
 * ignore the events a pointer sends and react only to `element.click()`. The first attempt sends the
 * pointer sequence; when the page did not change at all, `element.click()` is called once. The answer
 * says so (`fallback`), because an agent that was told "clicked" should know which way it was.
 *
 * `change: none` is weaker than it sounds: it means no mutation was SEEN, so a retry is skipped when
 * it could repeat an action that worked:
 *  - the page agent says the target is not a custom element (`fallbackOk`, see `fallbackEligible`);
 *  - a request started in the tab since the first click (`requestsStarted`): a submit or a delete
 *    whose DOM update is slow would be sent twice. Without the `webRequest` grant nothing is
 *    counted, and the custom-element retry still runs: that is the Partner Center case itself.
 */

function shown<T extends { fallbackOk?: boolean }>(r: T): Omit<T, 'fallbackOk'> {
  const copy: Record<string, unknown> = { ...r };
  delete copy.fallbackOk;
  return copy as Omit<T, 'fallbackOk'>;
}

export async function clickWithFallback<T extends { change: string; fallbackOk?: boolean }>(
  attempt: (fallback: boolean) => Promise<T>,
  requestsStarted: () => boolean = () => false,
): Promise<Omit<T, 'fallbackOk'> & { fallback?: 'element.click' }> {
  const first = await attempt(false);
  const answer = shown(first);
  if (first.change !== 'none' || first.fallbackOk !== true || requestsStarted()) return answer;
  // The retry may fail where the first attempt did not (the element is gone now). Then the first
  // answer stands: it is the truthful one — nothing visibly happened.
  try {
    return { ...shown(await attempt(true)), fallback: 'element.click' };
  } catch {
    return answer;
  }
}
