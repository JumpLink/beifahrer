/**
 * A click, and the one retry that makes it reliable.
 *
 * Some custom elements (a `<v6_he-button>` in Partner Center, the Chrome Web Store's confirm button)
 * ignore the events a pointer sends and react only to `element.click()`. The first attempt sends the
 * pointer sequence; when the page did not change at all, `element.click()` is called once. The answer
 * says so (`fallback`), because an agent that was told "clicked" should know which way it was.
 */

export async function clickWithFallback<T extends { change: string }>(
  attempt: (fallback: boolean) => Promise<T>,
): Promise<T & { fallback?: 'element.click' }> {
  const first = await attempt(false);
  if (first.change !== 'none') return first;
  // The retry may fail where the first attempt did not (the element is gone now). Then the first
  // answer stands: it is the truthful one — nothing visibly happened.
  try {
    return { ...(await attempt(true)), fallback: 'element.click' };
  } catch {
    return first;
  }
}
