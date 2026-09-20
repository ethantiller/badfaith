import { buildHeaders, generateRequestId, makeAuthenticatedRequest } from './api_helpers';
import { getIdToken } from './auth';
const SERVER_API_BASE = import.meta.env.API_BASE || '0.0.0.0:8000';
export async function sendCoverageRequest(request) {
    const token = await getIdToken();
    return makeAuthenticatedRequest(async () => {
        return fetch(`http://${SERVER_API_BASE}/api/v1/coverage`, {
            method: 'POST',
            headers: buildHeaders({ token, requestId: generateRequestId() }),
            body: JSON.stringify(request),
        });
    });
}
