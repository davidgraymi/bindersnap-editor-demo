/**
 * What a copy of a policy is called: "Hand Hygiene Copy", then
 * "Hand Hygiene Copy 2" when that is taken, so the copy sorts beside the
 * original and is plainly not it.
 *
 * **No brackets**, unlike Finder's: a name is kept as an address, and the
 * address has no room for punctuation, so "(copy)" came back as "Copy"
 * anyway — the name asked for is the name shown.
 *
 * `taken` is every name already filed in the folder the copy goes into,
 * compared without case, because two addresses that differ only in case are
 * one address to the server.
 */
export function copyName(name: string, taken: readonly string[]): string {
  const base = name.replace(/ copy(?: \d+)?$/i, "");
  const used = new Set(taken.map((entry) => entry.trim().toLowerCase()));
  for (let n = 1; ; n += 1) {
    const next = n === 1 ? `${base} Copy` : `${base} Copy ${n}`;
    if (!used.has(next.toLowerCase())) return next;
  }
}
