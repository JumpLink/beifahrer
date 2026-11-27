/**
 * Did a file field take the files we gave it?
 *
 * The answer is read from the field BEFORE the page hears about it. A page's `change` handler
 * usually reads the files and then clears the field (`input.value = ''`, so the same file can be
 * picked twice); judging after the events saw an empty list and reported `accepted: false` for an
 * upload the page had in fact consumed. What the field held right after the assignment is the
 * browser's verdict (it drops a file it does not take); what it holds after the events is the page's
 * business and reported as `cleared`, not as a refusal.
 */

export interface Held {
  name: string;
}

export interface UploadCheck {
  /** The field held every file we sent, by name and order, when the page was told. */
  accepted: boolean;
  /** The page emptied the field after the events: it consumed the files. */
  cleared: boolean;
}

export function checkUpload(
  sent: readonly string[],
  assigned: readonly Held[],
  after: readonly Held[],
): UploadCheck {
  const accepted = assigned.length === sent.length && assigned.every((f, i) => f.name === sent[i]);
  return { accepted, cleared: accepted && after.length === 0 };
}
