import { refreshSession } from './auth';
export class ApiError extends Error {
    constructor(status, statusText, message) {
        super(message || `API request failed: ${status} ${statusText}`);
        Object.defineProperty(this, "status", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: status
        });
        Object.defineProperty(this, "statusText", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: statusText
        });
        this.name = 'ApiError';
    }
}
export function generateRequestId() {
    return crypto.randomUUID();
}
export async function handleApiResponse(response) {
    if (!response.ok) {
        throw new ApiError(response.status, response.statusText);
    }
    return response.json();
}
export function buildHeaders(options) {
    return {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Bearer ${options.token}`,
        'X-Request-ID': options.requestId || generateRequestId(),
    };
}
export async function makeAuthenticatedRequest(request) {
    let response = await request();
    if (response.status === 401) {
        const refreshed = await refreshSession();
        if (!refreshed) {
            throw new Error('Not authenticated. Please sign in.');
        }
        response = await request();
    }
    return handleApiResponse(response);
}
export function getErrorMessage(error) {
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
