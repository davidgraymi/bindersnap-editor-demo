/**
 * Words these customers use for the same thing (ADR 0007, §7).
 *
 * Applied to the query, never to the index: "handwashing" is searched as
 * `handwashing OR "hand hygiene"`, so changing this list changes the next
 * search and rebuilds nothing.
 *
 * Each group is a set of ways of writing one thing, and every one finds the
 * others. Add a group only for words a policy manager would take as the same
 * thing — "fall" and "fall risk" are not, and finding one for the other is a
 * wrong answer, not a generous one. Reviewed like code.
 */
export const SYNONYM_GROUPS: readonly (readonly string[])[] = [
  ["hand hygiene", "handwashing", "hand washing"],
  [
    "c diff",
    "cdiff",
    "c difficile",
    "clostridioides difficile",
    "clostridium difficile",
  ],
  ["ppe", "personal protective equipment"],
  ["mrsa", "methicillin resistant staphylococcus aureus"],
  ["cpr", "cardiopulmonary resuscitation"],
  ["aed", "automated external defibrillator"],
  ["dnr", "do not resuscitate"],
  ["uti", "urinary tract infection"],
  ["sds", "msds", "safety data sheet", "material safety data sheet"],
];
