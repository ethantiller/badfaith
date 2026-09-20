import type { AnalyzeRequest, AnalyzeResponse } from '../types';
import { postJson } from './client';
import { buildAnalyzeRequest } from './contract';

/**
 * Display threshold, kept equal to the backend's `MIN_FLAG_CONFIDENCE` in
 * pipeline/orchestrate.py, which already drops these flags before counting bias. This
 * is a second guard so no low-confidence flag ever reaches the UI.
 */
export const MIN_FLAG_CONFIDENCE = 0.85;

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
