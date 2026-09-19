import type { AnalyzeRequest, AnalyzeResponse } from '../types';
import { buildHeaders, generateRequestId, makeAuthenticatedRequest } from './api_helpers';
import { getIdToken } from './auth';

const SERVER_API_BASE = import.meta.env.API_BASE || '0.0.0.0:8000';

export async function sendAnalyzeRequest(
  request: AnalyzeRequest,
): Promise<AnalyzeResponse> {
  const token = await getIdToken();

  return makeAuthenticatedRequest<AnalyzeResponse>(async () => {
    return fetch(`http://${SERVER_API_BASE}/api/v1/analyze`, {
      method: 'POST',
      headers: buildHeaders({ token, requestId: generateRequestId() }),
      body: JSON.stringify(request),
    });
  });
}