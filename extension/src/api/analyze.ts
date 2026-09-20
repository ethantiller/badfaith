import type { AnalyzeRequest, AnalyzeResponse } from '../types';
import { postJson } from './client';
import { buildAnalyzeRequest } from './contract';

/**
 * Display threshold. The backend never filters by confidence (the eval needs every
 * grounded flag), so low-confidence flags are dropped here, before any UI sees them.
 */
export const MIN_FLAG_CONFIDENCE = 0.8;

export async function sendAnalyzeRequest(
  request: AnalyzeRequest,
): Promise<AnalyzeResponse> {
  // Conform to the Pydantic schema before spending a round trip on a 422.
  const response = await postJson<AnalyzeResponse>(
    '/api/v1/analyze',
    buildAnalyzeRequest(request),
  );
  return {
    ...response,
    flags: response.flags.filter((flag) => flag.confidence >= MIN_FLAG_CONFIDENCE),
  };
}
