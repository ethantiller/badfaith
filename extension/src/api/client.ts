// The one place that speaks HTTP to the backend. Everything about a call that is not
// its path and body — the base URL, the token, the headers, the 401 retry, the error
// shape — lives here, so a new endpoint is one short function.
import { getIdToken, refreshSession } from '../auth';

// Vite only exposes VITE_-prefixed vars. The scheme lives in the value so a deployed
// HTTPS base is a rebuild, not a code change.
const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000';
const MAX_DETAIL_CHARS = 500;

export class ApiError extends Error {
  constructor(
    public status: number,
    public statusText: string,
    message?: string,
    /** Raw response body, truncated. FastAPI's 422 detail is worth reading. */
    public detail?: string,
  ) {
    super(message || `API request failed: ${status} ${statusText}`);
    this.name = 'ApiError';
  }
}

export function generateRequestId(): string {
  return crypto.randomUUID();
}

export interface ApiRequestOptions {
  token: string;
  requestId?: string;
}

export function buildHeaders(options: ApiRequestOptions): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    Authorization: `Bearer ${options.token}`,
    'X-Request-ID': options.requestId || generateRequestId(),
  };
}

export async function handleApiResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    // Read the body before throwing: a 422 says exactly which field failed, and that is
    // the whole value of it while a route is being brought up.
    const detail = await response
      .text()
      .then((text) => text.slice(0, MAX_DETAIL_CHARS))
      .catch(() => '');

    throw new ApiError(response.status, response.statusText, undefined, detail);
  }
  return response.json() as Promise<T>;
}

export async function makeAuthenticatedRequest<T>(
  request: () => Promise<Response>,
): Promise<T> {
  let response = await request();

  if (response.status === 401) {
    const refreshed = await refreshSession();
    if (!refreshed) throw new Error('Not authenticated. Please sign in.');
    response = await request();
  }

  return handleApiResponse<T>(response);
}

/**
 * POST a JSON body to an authenticated endpoint, refreshing the token once on a 401.
 * `sendAnalyzeRequest` and `sendCoverageRequest` are each a validated call to this.
 */
export async function postJson<T>(path: string, body: unknown): Promise<T> {
  const token = await getIdToken();

  return makeAuthenticatedRequest<T>(() =>
    fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: buildHeaders({ token, requestId: generateRequestId() }),
      body: JSON.stringify(body),
    }),
  );
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.status) {
      case 401:
        return 'Please sign in again';
      case 429:
        return 'Too many requests. Please wait a moment.';
      case 400:
        return 'Invalid request. Please check your input.';
      case 404:
        return 'That endpoint is not available on the server.';
      case 422:
        return 'The server rejected the request format.';
      case 500:
        return 'Server error. Please try again later.';
      default:
        return error.message || 'An error occurred';
    }
  }

  if (error instanceof Error) return error.message;
  return 'An unknown error occurred';
}
