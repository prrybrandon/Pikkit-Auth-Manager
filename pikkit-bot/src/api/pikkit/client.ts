/**
 * The single, shared Pikkit API client.
 *
 * Every Pikkit HTTP request in this project must go through
 * `pikkitApiClient.get()`. This keeps three things centralized instead
 * of duplicated per-endpoint:
 *   - authentication (delegated entirely to auth/session.ts)
 *   - retries (1s, 2s, 5s backoff, 3 attempts max, per SPEC.md section 17)
 *   - error logging
 */
import type { APIRequestContext } from "playwright";
import { createAuthenticatedRequestContext } from "../../auth/session.js";

const RETRY_DELAYS_MS = [1000, 2000, 5000];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class PikkitApiClient {
  private context: APIRequestContext | null = null;

  private async getContext(): Promise<APIRequestContext> {
    if (!this.context) {
      this.context = await createAuthenticatedRequestContext();
    }
    return this.context;
  }

  /**
   * GETs `url` and returns the parsed JSON body as `T`, retrying on
   * failure per the schedule above. Throws if all attempts fail.
   */
  async get<T>(url: string): Promise<T> {
    const context = await this.getContext();
    let lastError: unknown;

    for (let attempt = 1; attempt <= RETRY_DELAYS_MS.length + 1; attempt++) {
      try {
        const response = await context.get(url);
        if (!response.ok()) {
          throw new Error(
            `Pikkit API request failed: ${response.status()} ${response.statusText()} (${url})`,
          );
        }
        return (await response.json()) as T;
      } catch (error) {
        lastError = error;
        console.error(`[pikkit-api] Attempt ${attempt} failed for ${url}:`, error);

        const delay = RETRY_DELAYS_MS[attempt - 1];
        if (delay !== undefined) {
          await sleep(delay);
        }
      }
    }

    throw lastError;
  }

  /** Releases the underlying browser-context resources. Call once on shutdown. */
  async dispose(): Promise<void> {
    await this.context?.dispose();
    this.context = null;
  }
}

export const pikkitApiClient = new PikkitApiClient();
