import { refreshSession } from './auth';

export class ApiError extends Error {
  constructor(
    public status: number,
    public statusText: string,
    message?: string,
  ) {
    super(message || `API request failed: ${status} ${statusText}`);
    this.name = 'ApiError';
  }
}

export function generateRequestId(): string {
  return crypto.randomUUID();
}

export async function handleApiResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw new ApiError(response.status, response.statusText);
  }
  return response.json() as Promise<T>;
}

export interface ApiRequestOptions {
  token: string;
  requestId?: string;
}

export function buildHeaders(options: ApiRequestOptions): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'Authorization': `Bearer ${options.token}`,
    'X-Request-ID': options.requestId || generateRequestId(),
  };
}

export async function makeAuthenticatedRequest<T>(
  request: () => Promise<Response>,
): Promise<T> {
  let response = await request();

  if (response.status === 401) {
    const refreshed = await refreshSession();

    if (!refreshed) {
      throw new Error('Not authenticated. Please sign in.');
    }

    response = await request();
  }

  return handleApiResponse<T>(response);
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
      case 500:
        return 'Server error. Please try again later.';
      default:
        return error.message || 'An error occurred';
    }
  }

  if (error instanceof Error) {
    return error.message;
  }

  return 'An unknown error occurred';
}