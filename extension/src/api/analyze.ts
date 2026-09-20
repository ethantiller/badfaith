import type { AnalyzeRequest, AnalyzeResponse } from '../types';
import { postJson } from './client';
import { buildAnalyzeRequest } from './contract';

export async function sendAnalyzeRequest(
  request: AnalyzeRequest,
): Promise<AnalyzeResponse> {
  // Conform to the Pydantic schema before spending a round trip on a 422.
  return postJson<AnalyzeResponse>('/api/v1/analyze', buildAnalyzeRequest(request));
}
