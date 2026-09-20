// One set of words for every failure a BgResult can carry, so the content script and
// the side panel never disagree about what "network" means to a reader.
import type { BgErrorCode } from '../types';

const ERROR_MESSAGES: Partial<Record<BgErrorCode, string>> = {
  unauthenticated: 'Sign in from the extension icon.',
  rate_limited: 'Too many requests. Try again later.',
  network: 'Could not reach Bad Faith. Try again.',
  server: 'Bad Faith had a problem. Try again.',
};

/** Retrying these changes nothing, so the UI offers no retry. */
const FINAL_ERRORS = new Set<BgErrorCode>(['rate_limited', 'unauthenticated', 'invalid_request']);

/**
 * A contract failure names the offending field, which a generic string would hide;
 * everything else gets the shared wording.
 */
export function describeError(failure: { code: BgErrorCode; message: string }): string {
  if (failure.code === 'invalid_request') return failure.message;
  return ERROR_MESSAGES[failure.code] ?? failure.message;
}

export function isRetryable(code: BgErrorCode): boolean {
  return !FINAL_ERRORS.has(code);
}
