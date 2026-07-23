type RetryContext = {
  attempt: number;
  maxAttempts: number;
  delayMs: number;
  error: unknown;
  operation: string;
};

export type RetryOptions = {
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitterRatio?: number;
  shouldRetry?: (error: unknown, attempt: number) => boolean;
  onRetry?: (context: RetryContext) => void | Promise<void>;
};

type CircuitState = "closed" | "open" | "half_open";

export type CircuitBreakerOptions = {
  failureThreshold?: number;
  openMs?: number;
  halfOpenMaxInFlight?: number;
  onStateChange?: (from: CircuitState, to: CircuitState) => void;
};

const sleep = async (ms: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ms));
};

const computeDelayMs = (
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
  jitterRatio: number,
): number => {
  const exponent = Math.max(0, attempt - 1);
  const raw = Math.min(maxDelayMs, baseDelayMs * 2 ** exponent);
  const jitterWindow = raw * Math.max(0, Math.min(jitterRatio, 1));
  const min = raw - jitterWindow;
  const max = raw + jitterWindow;
  return Math.max(0, Math.round(min + Math.random() * (max - min)));
};

export class CircuitOpenError extends Error {
  override name = "CircuitOpenError";

  constructor(
    public readonly circuitName: string,
    public readonly retryAfterMs: number,
  ) {
    super(`Circuit '${circuitName}' is open. Retry after ${retryAfterMs} ms.`);
  }
}

export class CircuitBreaker {
  private readonly failureThreshold: number;
  private readonly openMs: number;
  private readonly halfOpenMaxInFlight: number;
  private readonly onStateChange?: (from: CircuitState, to: CircuitState) => void;

  private state: CircuitState = "closed";
  private failureCount = 0;
  private openedAt = 0;
  private halfOpenInFlight = 0;

  constructor(
    private readonly name: string,
    options?: CircuitBreakerOptions,
  ) {
    this.failureThreshold = Math.max(1, options?.failureThreshold ?? 5);
    this.openMs = Math.max(1, options?.openMs ?? 15000);
    this.halfOpenMaxInFlight = Math.max(1, options?.halfOpenMaxInFlight ?? 1);
    this.onStateChange = options?.onStateChange;
  }

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    const now = Date.now();

    if (this.state === "open") {
      const elapsed = now - this.openedAt;
      if (elapsed < this.openMs) {
        throw new CircuitOpenError(this.name, this.openMs - elapsed);
      }
      this.transition("half_open");
    }

    if (this.state === "half_open" && this.halfOpenInFlight >= this.halfOpenMaxInFlight) {
      throw new CircuitOpenError(this.name, this.openMs);
    }

    let enteredHalfOpen = false;
    if (this.state === "half_open") {
      this.halfOpenInFlight += 1;
      enteredHalfOpen = true;
    }

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    } finally {
      if (enteredHalfOpen) {
        this.halfOpenInFlight = Math.max(0, this.halfOpenInFlight - 1);
      }
    }
  }

  private onSuccess() {
    this.failureCount = 0;
    if (this.state !== "closed") {
      this.transition("closed");
    }
  }

  private onFailure() {
    if (this.state === "half_open") {
      this.open();
      return;
    }
    this.failureCount += 1;
    if (this.failureCount >= this.failureThreshold) {
      this.open();
    }
  }

  private open() {
    this.openedAt = Date.now();
    this.failureCount = this.failureThreshold;
    this.transition("open");
  }

  private transition(next: CircuitState) {
    const prev = this.state;
    if (prev === next) return;
    this.state = next;
    if (next === "half_open") {
      this.halfOpenInFlight = 0;
    }
    this.onStateChange?.(prev, next);
  }
}

const RETRYABLE_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EPIPE",
  "ENOTFOUND",
  "ESOCKETTIMEDOUT",
  "ERR_SOCKET_CLOSED",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_SOCKET",
  "UND_ERR_HEADERS_TIMEOUT",
]);

const RETRYABLE_MESSAGE_PARTS = [
  "timeout",
  "timed out",
  "connection reset",
  "connection refused",
  "socket hang up",
  "network",
  "temporarily unavailable",
  "broken pipe",
  "service unavailable",
  "fetch failed",
  "server disconnected",
];

const getStatusCode = (error: unknown): number | undefined => {
  const status = (error as any)?.status ?? (error as any)?.response?.status;
  return typeof status === "number" ? status : undefined;
};

export const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const isRetryableNetworkError = (error: unknown): boolean => {
  if (error instanceof CircuitOpenError) return false;
  if ((error as any)?.name === "AbortError") return true;

  const status = getStatusCode(error);
  if (typeof status === "number") {
    if (status === 408 || status === 425 || status === 429 || status >= 500) return true;
    if (status >= 400 && status < 500) return false;
  }

  const code = (error as any)?.code;
  if (typeof code === "string" && RETRYABLE_CODES.has(code)) return true;

  const message = errorMessage(error).toLowerCase();
  return RETRYABLE_MESSAGE_PARTS.some((part) => message.includes(part));
};

export async function withRetry<T>(
  operation: string,
  fn: (attempt: number) => Promise<T>,
  options?: RetryOptions,
): Promise<T> {
  const maxAttempts = Math.max(1, options?.attempts ?? 3);
  const baseDelayMs = Math.max(1, options?.baseDelayMs ?? 250);
  const maxDelayMs = Math.max(baseDelayMs, options?.maxDelayMs ?? 2500);
  const jitterRatio = options?.jitterRatio ?? 0.2;
  const shouldRetry = options?.shouldRetry ?? isRetryableNetworkError;

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      const canRetry = attempt < maxAttempts && shouldRetry(error, attempt);
      if (!canRetry) {
        throw error;
      }
      const delayMs = computeDelayMs(attempt, baseDelayMs, maxDelayMs, jitterRatio);
      if (options?.onRetry) {
        await options.onRetry({
          attempt,
          maxAttempts,
          delayMs,
          error,
          operation,
        });
      }
      await sleep(delayMs);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`${operation} failed after retries`);
}
