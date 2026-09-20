import type { CoverageRequest, CoverageResponse } from '../types';
import { postJson } from './client';

export async function sendCoverageRequest(
  request: CoverageRequest,
): Promise<CoverageResponse> {
  return postJson<CoverageResponse>('/api/v1/coverage', request);
}
