// API Contract types that mirror the Python backend schemas

// SemEval-2021 Task 6: Propaganda Techniques Identification (14 techniques)
export type Technique =
  | 'loaded_language'
  | 'name_calling'
  | 'repetition'
  | 'exaggeration_minimization'
  | 'appeal_to_fear'
  | 'appeal_to_authority'
  | 'doubt'
  | 'causal_oversimplification'
  | 'appeal_to_common_belief'
  | 'false_dilemma'
  | 'straw_man'
  | 'red_herring'
  | 'whataboutism'
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
