export interface DocumentSearchParams {
  ownerUsername?: string;
  memberUsername?: string;
  freeText?: string;
}

export function parseDocumentSearchQuery(
  rawQ: string,
  currentUsername: string,
): DocumentSearchParams {
  const resolve = (u: string) =>
    u === "@me" || u === "me" ? currentUsername : u.replace(/^@/, "");

  let remainder = rawQ;
  let ownerUsername: string | undefined;
  let memberUsername: string | undefined;

  const ownerMatch = /(?:^|\s)owner:@(\S+)/.exec(remainder);
  if (ownerMatch) {
    ownerUsername = resolve(ownerMatch[1]!);
    remainder = remainder.replace(ownerMatch[0], "");
  }

  const memberMatch = /(?:^|\s)contributed-by:@(\S+)/.exec(remainder);
  if (memberMatch) {
    memberUsername = resolve(memberMatch[1]!);
    remainder = remainder.replace(memberMatch[0], "");
  }

  const freeText = remainder.trim() || undefined;
  return { ownerUsername, memberUsername, freeText };
}
