export const VISIBLE_POLLING_DELAYS_MS = [
  1000, 2000, 4000, 8000, 8000, 8000, 8000, 8000, 8000, 8000,
];

export const BACKGROUND_POLL_INTERVAL_MS = 8000;

export const BACKGROUND_POLL_WINDOW_MS = 300000;

export async function runBackgroundPoll(
  fetchFn: () => Promise<{ status: string }>,
  onConfirmed: () => void,
  intervalMs: number,
  windowMs: number,
): Promise<void> {
  const startTime = Date.now();
  const maxAttempts = Math.floor(windowMs / intervalMs);

  for (let i = 0; i < maxAttempts; i++) {
    if (Date.now() - startTime >= windowMs) {
      break;
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));

    try {
      const result = await fetchFn();
      if (result.status === "active" || result.status === "trialing") {
        onConfirmed();
        return;
      }
    } catch {
      // continue polling
    }
  }
}
