// Hand-mirror of backend/app/types.py. Python is the source of truth; there is no
// codegen. When the contract changes, both files and the docs change together.
import type { User, Session } from '@supabase/supabase-js';

// --- Request size caps (mirrors backend/app/types.py) ---

export const MAX_PARAGRAPHS = 400;
export const MAX_PARAGRAPH_CHARS = 5_000;
export const MAX_URL_CHARS = 2_048;
export const MAX_TITLE_CHARS = 512;

// --- Enums ---

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

export const TECHNIQUES: readonly Technique[] = [
  'loaded_language',
  'name_calling',
  'repetition',
  'exaggeration_minimization',
  'doubt',
  'appeal_to_fear',
  'flag_waving',
  'causal_oversimplification',
  'slogans',
  'appeal_to_authority',
  'false_dilemma',
  'thought_terminating_cliche',
  'whataboutism',
  'straw_man',
  'red_herring',
  'bandwagon',
];

export type Severity = 'low' | 'medium' | 'high';
export type VerificationStatus = 'supported' | 'contradicted' | 'unverified';
export type DocType = 'news' | 'news_with_heavy_bias' | 'news_with_slight_bias' | 'opinion' | 'other';
export type DocTypeSource = 'metadata' | 'model';
export type ClaimType = 'statistic' | 'attributed_quote' | 'date_or_count';

/** What the content script scraped from the page. `null` means nothing found. */
export type SectionHint = 'opinion' | 'news' | null;

// --- Analysis ---

export interface Paragraph {
  id: number;
  text: string;
}

export interface Flag {
  paragraph_id: number;
  quote: string;
  technique: Technique;
  severity: Severity;
  confidence: number;
  explanation: string;
}

export interface Claim {
  id: string;
  paragraph_id: number;
  quote: string;
  claim_type: ClaimType;
  entities: string[];
}

export interface AnalyzeMeta {
  cached: boolean;
  doc_hash: string;
  model_route: string;
  latency_ms: number;
  flags_dropped: number;
}

export interface AnalyzeRequest {
  url: string;
  title: string;
  section_hint: SectionHint;
  paragraphs: Paragraph[];
}

export interface AnalyzeResponse {
  doc_type: DocType;
  doc_type_source: DocTypeSource;
  flags: Flag[];
  claims: Claim[];
  meta: AnalyzeMeta;
}

// --- Coverage ---

export interface CoverageRequest {
  doc_hash: string;
  claim_id: string;
  quote: string;
  entities: string[];
  title: string;
}

export interface RelatedSource {
  outlet: string;
  url: string;
  headline: string;
  snippet: string;
  seendate: string;
}

export interface Omission {
  summary: string;
  corroborating_urls: string[];
}

export interface CoverageMeta {
  sources_queried: number;
  latency_ms: number;
}

export interface CoverageResponse {
  claim_id: string;
  status: VerificationStatus;
  related: RelatedSource[];
  omissions: Omission[];
  meta: CoverageMeta;
}

export interface HealthResponse {
  status: 'ok';
}

// --- Auth ---

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

// --- Message envelope ---
// Content script and popup both talk to the background worker, which is the only
// context holding a token or calling the backend.

export type BgErrorCode =
  | 'unauthenticated'
  | 'rate_limited'
  | 'network'
  | 'server'
  /** The payload did not satisfy the contract; retrying would not help. */
  | 'invalid_request';

export type BgResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: BgErrorCode; message: string };

export interface AuthState {
  signedIn: boolean;
  email: string | null;
}

export interface CoverageSearchRequest {
  doc_hash: string;
  url: string;
  title: string;
}

export type BgRequest =
  | { kind: 'ANALYZE_REQUEST'; payload: AnalyzeRequest }
  | { kind: 'COVERAGE_REQUEST'; payload: CoverageSearchRequest }
  | { kind: 'AUTH_STATUS' }
  | { kind: 'AUTH_SIGN_IN'; email: string; password: string }
  | { kind: 'AUTH_SIGN_UP'; email: string; password: string; isAgeVerified: boolean }
  | { kind: 'AUTH_SIGN_OUT' }
  | { kind: 'AUTH_RESET'; email: string }
  | {
      kind: 'AUTH_RECOVER';
      accessToken: string;
      refreshToken: string;
      newPassword: string;
    };

// --- Popup to content script ---
// The Analyze trigger lives in the popup, so the extension puts nothing on a page
// until the user asks for it. The popup addresses the active tab directly; no token
// is involved, so this does not go through the background worker.

export type PageState = 'idle' | 'loading' | 'done' | 'stale' | 'error';

/** Re-exported from ui/labels so the message envelope does not depend on the UI. */
export type DisplayDocType = DocType | 'unknown';

export interface PageStatus {
  /** False on anything without a real article container, including this whole site. */
  isArticle: boolean;
  paragraphs: number;
  state: PageState;
  flags: number;
  /** What to print, so `unknown` never has to exist on the wire. Null before a run. */
  docType: DisplayDocType | null;
  message: string | null;
}

export type TabRequest = { kind: 'PAGE_STATUS' } | { kind: 'RUN_ANALYZE' };
