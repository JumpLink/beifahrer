/**
 * The line that stands where a frame the person did not allow would have been (issue #153).
 *
 * Silence reads as "this page embeds nothing", and an agent then cannot tell that from "there is a
 * frame I may not see". The line names the ORIGIN and the levels only: never a path, a title or a
 * ref, because the frame's content is exactly what the person withheld.
 */
export function withheldFrameLine(origin: string, have: string, need: string): string {
  return `— frame withheld: ${origin} (level ${have}, needs ${need})`;
}
