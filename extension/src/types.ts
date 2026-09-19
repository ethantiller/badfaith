// API Contract types that mirror the Python backend schemas
import type { User, Session } from '@supabase/supabase-js';

// SemEval-2020 Task 11: Propaganda Techniques Identification. Covers all 14 SemEval classes;
// whataboutism, straw_man and red_herring are one merged class in SemEval.
// https://aclanthology.org/2020.semeval-1.186/
export type Technique =
  | 'loaded_language'
  | 'name_calling'
  | 'repetition'
  | 'exaggeration_minimization'
  | 'doubt'
  | 'appeal_to_fear'
  | 'flag_waving'
  | 'causal_oversimplification'
  | 'slogans'
  | 'appeal_to_authority'
  | 'false_dilemma'
  | 'thought_terminating_cliche'
  | 'whataboutism'
  | 'straw_man'
  | 'red_herring'
  | 'bandwagon';

export interface Flag {
  technique: Technique;
  span_start: number;
  span_end: number;
  confidence: number;
  evidence?: string;
}

export interface Claim {
  id: string;
  text: string;
  paragraph_id: string;
  quote: string; // Verbatim quote from source
  techniques: Technique[];
  confidence: number;
}

export interface ParagraphAnalysis {
  paragraph_id: string;
  text: string;
  flags: Flag[];
  claims: Claim[];
  doc_type?: string;
}

export interface AnalyzeRequest {
  url: string;
  paragraphs: Array<{
    id: string;
    text: string;
    section_hint?: string;
  }>;
}

export interface AnalyzeResponse {
  doc_type: string;
  paragraphs: ParagraphAnalysis[];
  metadata?: Record<string, unknown>;
}

export interface CoverageRequest {
  doc_hash: string;
  claim_id: string;
  claim_text: string;
  entities: string[];
}

export interface CoverageResult {
  source_url: string;
  title: string;
  snippet: string;
  date?: string;
}

export interface CoverageResponse {
  claim_id: string;
  results: CoverageResult[];
}

export interface HealthResponse {
  status: 'ok';
}

export interface UserSignInRequest {
  email: string;
  password: string;
}

export interface UserSignInResponse {
  user: User;
  session: Session;
}

export interface UserSignUpRequest {
  email: string;
  password: string;
  isAgeVerified: boolean;
}

export interface UserSignUpResponse {
  user: User | null;
  session: Session | null;
}