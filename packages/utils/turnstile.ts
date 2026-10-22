/**
 * Ask Turnstile whether a token is real. Each token works once and lives five
 * minutes, which is why the dialog fetches a fresh one when it is sent, not
 * when it opens.
 */

const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export interface TurnstileVerdict {
  success: boolean;
  /** Turnstile's reasons, for the log. Never shown to the person. */
  errorCodes: string[];
}

export async function verifyTurnstile(
  secret: string,
  token: string,
  remoteIp: string | null,
  fetcher: typeof fetch = fetch,
): Promise<TurnstileVerdict> {
  const form = new FormData();
  form.append("secret", secret);
  form.append("response", token);
  if (remoteIp) form.append("remoteip", remoteIp);

  try {
    const response = await fetcher(SITEVERIFY, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(10_000),
    });
    const result = (await response.json()) as {
      success?: boolean;
      "error-codes"?: string[];
    };
    return {
      success: result.success === true,
      errorCodes: result["error-codes"] ?? [],
    };
  } catch {
    return { success: false, errorCodes: ["siteverify-unreachable"] };
  }
}
