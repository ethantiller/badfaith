import type { CoverageRequest, CoverageResponse } from '../types';
import { postJson } from './client';
import { buildCoverageRequest } from './contract';

export async function sendCoverageRequest(
  request: CoverageRequest,
): Promise<CoverageResponse> {
  // Conform to the Pydantic schema before spending a round trip on a 422.
  return postJson<CoverageResponse>('/api/v1/coverage', buildCoverageRequest(request));
}
