// Hand-mirror of backend/app/types.py. Python is the source of truth; there is no
// codegen. When the contract changes, both files and the docs change together.
import type { User, Session } from '@supabase/supabase-js';

// --- Request size caps (mirrors backend/app/types.py) ---

export const MAX_PARAGRAPHS = 400;
export const MAX_PARAGRAPH_CHARS = 5_000;
export const MAX_URL_CHARS = 2_048;
export const MAX_TITLE_CHARS = 512;
/** Client-side cap until the backend defines one for /coverage. */
export const MAX_ENTITIES = 20;
export const MAX_ENTITY_CHARS = 200;
export const MAX_REWRITE_ITEMS = 40;
export const MAX_QUOTE_CHARS = 1_000;

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
export type DocType = 'news' | 'news_with_heavy_bias' | 'news_with_slight_bias' | 'opinion' | 'other';
export type DocTypeSource = 'metadata' | 'model';
export type ClaimType = 'statistic' | 'attributed_quote' | 'date_or_count';

/** What a quoted speaker is, from search evidence. Locked list; mirrors `SpeakerRole` in app/types.py. */
export type SpeakerRole =
  | 'government_official'
  | 'elected_politician'
  | 'journalist'
  | 'academic_expert'
  | 'industry_corporate'
  | 'funder_donor'
  | 'advocacy_activist'
  | 'think_tank'
  | 'legal_court'
  | 'private_individual'
  | 'anonymous'
  | 'unknown';

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

export interface Citation {
  id: string;
  paragraph_id: number;
  quote: string;
  /** As the paragraph names them, or "anonymous". */
  speaker: string;
  speaker_role: SpeakerRole;
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
  citations: Citation[];
  meta: AnalyzeMeta;
}

// --- Coverage ---

export interface CoverageRequest {
  doc_hash: string;
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


export interface CoverageMeta {
  sources_queried: number;
  latency_ms: number;
}

export interface CoverageResponse {
  doc_hash: string;
  summary: string;
  related: RelatedSource[];
  meta: CoverageMeta;
}

// --- Neutral rewrite ---

export interface RewriteItem {
  paragraph_id: number;
  /** The whole paragraph, for context. `quote` must appear verbatim in it. */
  text: string;
  quote: string;
  technique: Technique | null;
  /** The labeler's one-sentence reason for the flag; steers the rewrite. */
  explanation: string;
}

export interface RewriteRequest {
  doc_hash: string;
  title: string;
  items: RewriteItem[];
}

export interface Rewrite {
  paragraph_id: number;
  /** Echoed from the request, so it is always the article's own wording. */
  original: string;
  rewrite: string;
}

/** Which wording the article currently shows. */
export type RewriteView = 'before' | 'after';

export interface RewriteMeta {
  model_route: string;
  latency_ms: number;
}

export interface RewriteResponse {
  doc_hash: string;
  rewrites: Rewrite[];
  meta: RewriteMeta;
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
// Content script and side panel both talk to the background worker, which is the only
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

export type BgRequest =
  | { kind: 'ANALYZE_REQUEST'; payload: AnalyzeRequest }
  | { kind: 'COVERAGE_REQUEST'; payload: CoverageRequest }
  | { kind: 'REWRITE_REQUEST'; payload: RewriteRequest }
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

// --- Side panel to content script ---
// The Analyze trigger lives in the side panel, so the extension puts nothing on a page
// until the user asks for it. The panel addresses the active tab directly; no token
// is involved, so this does not go through the background worker.

export type PageState = 'idle' | 'loading' | 'done' | 'stale' | 'error';

/** Re-exported from ui/labels so the message envelope does not depend on the UI. */
export type DisplayDocType = DocType | 'unknown';

export interface PageStatus {
  /** False on anything without a real article container, including this whole site. */
  isArticle: boolean;
  paragraphs: number;
  /** `document.title`, so the panel can ask for coverage without a second round trip. */
  title: string;
  state: PageState;
  flags: number;
  /** What to print, so `unknown` never has to exist on the wire. Null before a run. */
  docType: DisplayDocType | null;
  message: string | null;
  /** The full result, so the side panel can render the report without a second request. */
  result: AnalyzeResponse | null;
  highlightsVisible: boolean;
  /** A neutral rewrite has been fetched, so the article can show it. */
  rewriteReady: boolean;
  /** The rewrites the article is carrying; the content script is their only home. */
  rewrites: Rewrite[] | null;
  rewriteView: RewriteView;
}

export type TabRequest =
  | { kind: 'PAGE_STATUS' }
  | { kind: 'RUN_ANALYZE' }
  | { kind: 'RUN_REWRITE' }
  | { kind: 'SET_REWRITE_VIEW'; view: RewriteView }
  /** Scroll the article to the passage a rewrite replaced. */
  | { kind: 'FOCUS_REWRITE'; paragraph_id: number; original: string }
  | { kind: 'FOCUS_FLAG'; id: string }
  | { kind: 'FOCUS_CLAIM'; id: string }
  | { kind: 'FOCUS_CITATION'; id: string }
  | { kind: 'SET_HOT_FLAG'; id: string | null }
  | { kind: 'TOGGLE_HIGHLIGHTS'; visible: boolean }
  | { kind: 'CLEAR' };

/** Content script to side panel: no tab address, so this goes over `chrome.runtime.sendMessage`. */
export type HoverBroadcast = { kind: 'HOVER_FLAG'; id: string | null };
