export interface RetryOptions {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  onRetry?: (attempt: number, error: Error) => void;
}

const DEFAULT_OPTIONS: RetryOptions = {
  maxAttempts: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
};

export async function withRetry<T>(
  fn: () => Promise<T>,
  options?: Partial<RetryOptions>,
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < opts.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      lastError = err instanceof Error ? err : new Error(String(err));

      if (attempt < opts.maxAttempts - 1) {
        opts.onRetry?.(attempt + 1, lastError);

        const exponentialDelay = opts.baseDelayMs * Math.pow(2, attempt);
        const capped = Math.min(exponentialDelay, opts.maxDelayMs);
        // Add ±25% jitter to prevent thundering herd
        const jitter = capped * (0.75 + Math.random() * 0.5);
        await new Promise(resolve => setTimeout(resolve, jitter));
      }
    }
  }

  throw lastError;
}

export function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
