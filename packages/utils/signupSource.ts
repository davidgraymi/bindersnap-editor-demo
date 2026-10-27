/**
 * Where a signup came from: the page of bindersnap.com a visit began on, the
 * page the person pressed "Start free trial" on, the site that sent them, and
 * any campaign tags on the address they arrived at.
 *
 * The public site adds these to every link to the app's signup page
 * (`apps/site/signupSource.ts`), the app carries them into `POST /auth/signup`,
 * and the API keeps them beside the account (`services/api/signup-sources.ts`)
 * so we can count which pages bring in customers without sending account data
 * to Google. The same rules clean them on both sides of the wire.
 */
export interface SignupSource {
  /** The first page of bindersnap.com the visit opened on. */
  entryPath?: string;
  /** The page the signup link was on. */
  fromPath?: string;
  /** The other site that sent the visit, as a bare host name. */
  referrerHost?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
}

/** The query parameters the site adds to the signup link, and the field each fills. */
export const SIGNUP_SOURCE_PARAMS = {
  entry: "entryPath",
  from: "fromPath",
  ref: "referrerHost",
  utm_source: "utmSource",
  utm_medium: "utmMedium",
  utm_campaign: "utmCampaign",
} as const satisfies Record<string, keyof SignupSource>;

const PATH = /^\/[A-Za-z0-9/_.-]{0,199}$/;
const HOST = /^[a-z0-9.-]{1,253}$/;
const TAG = /^[\w .+-]{1,100}$/;

function clean(field: keyof SignupSource, value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (field === "entryPath" || field === "fromPath") {
    return PATH.test(trimmed) ? trimmed : undefined;
  }
  if (field === "referrerHost") {
    const host = trimmed.toLowerCase();
    return HOST.test(host) ? host : undefined;
  }
  const tag = trimmed.toLowerCase();
  return TAG.test(tag) ? tag : undefined;
}

/**
 * Only the fields above, each of the shape it should have: a path, a host, a
 * short tag. Anything else (an email pasted into a tag, a query string on a
 * path) is dropped rather than stored. `null` when nothing is left.
 */
export function cleanSignupSource(input: unknown): SignupSource | null {
  if (!input || typeof input !== "object") return null;
  const source: SignupSource = {};
  for (const field of Object.values(SIGNUP_SOURCE_PARAMS)) {
    const value = clean(field, (input as Record<string, unknown>)[field]);
    if (value) source[field] = value;
  }
  // A campaign tag that is an address is someone's email, not a campaign.
  for (const field of ["utmSource", "utmMedium", "utmCampaign"] as const) {
    if (source[field]?.includes("@")) delete source[field];
  }
  return Object.keys(source).length ? source : null;
}

/** The fields named by a signup link's query string, cleaned. */
export function signupSourceFromQuery(search: string): SignupSource | null {
  const params = new URLSearchParams(search);
  const raw: Record<string, string> = {};
  for (const [param, field] of Object.entries(SIGNUP_SOURCE_PARAMS)) {
    const value = params.get(param);
    if (value) raw[field] = value;
  }
  return cleanSignupSource(raw);
}
