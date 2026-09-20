import type { RewriteRequest, RewriteResponse } from '../types';
import { postJson } from './client';
import { buildRewriteRequest } from './contract';

export async function sendRewriteRequest(request: RewriteRequest): Promise<RewriteResponse> {
  // Conform to the Pydantic schema before spending a round trip on a 422.
  return postJson<RewriteResponse>('/api/v1/rewrite', buildRewriteRequest(request));
}
