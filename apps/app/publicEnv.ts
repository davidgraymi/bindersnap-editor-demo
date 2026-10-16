/**
 * Read an optional `BUN_PUBLIC_` build variable.
 *
 * Bun swaps `process.env.BUN_PUBLIC_…` for its value only when the build has
 * the variable. Unset, the code still says `process.env.…`, and a browser has
 * no `process`, so the read throws. A `typeof process` guard does not work: it
 * is false in a browser even when the value was inlined beside it. So the
 * read is passed in as a function, and unset becomes "".
 *
 *     publicEnv(() => process.env.BUN_PUBLIC_FEEDBACK_URL)
 */
export function publicEnv(read: () => string | undefined): string {
  try {
    return read() ?? "";
  } catch {
    return "";
  }
}
