// Human-readable names for the contract's enum values. Sentence case, because the
// UI reads as prose next to the article, not as a database dump.
import type {
  AnalyzeResponse,
  ClaimType,
  DisplayDocType,
  DocTypeSource,
  Severity,
  Technique,
} from '../types';

// `DisplayDocType` is `DocType | 'unknown'`. The wire contract has no `unknown`:
// `section_hint` is `"opinion" | null`, and a null hint is what makes /analyze work the
// section out from the paragraphs, so a response always carries a real classification.
// Unknown is what the UI prints if one ever does not — better than asserting "News
// report" over a document nothing classified.
export type { DisplayDocType };

export const TECHNIQUE_LABELS: Record<Technique, string> = {
  loaded_language: 'Loaded language',
  name_calling: 'Name calling',
  repetition: 'Repetition',
  exaggeration_minimization: 'Exaggeration or minimisation',
  doubt: 'Doubt',
  appeal_to_fear: 'Appeal to fear',
  flag_waving: 'Flag waving',
  causal_oversimplification: 'Causal oversimplification',
  slogans: 'Slogan',
  appeal_to_authority: 'Appeal to authority',
  false_dilemma: 'False dilemma',
  thought_terminating_cliche: 'Thought-terminating cliché',
  whataboutism: 'Whataboutism',
  straw_man: 'Straw man',
  red_herring: 'Red herring',
  bandwagon: 'Bandwagon',
};

export const SEVERITY_LABELS: Record<Severity, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
};

export const DOC_TYPE_LABELS: Record<DisplayDocType, string> = {
  news: 'News report',
  news_with_heavy_bias: 'News with heavy bias',
  news_with_slight_bias: 'News with slight bias',
  opinion: 'Opinion',
  other: 'Other',
  unknown: 'Unknown',
};

export const DOC_TYPE_SOURCE_LABELS: Record<DocTypeSource, string> = {
  metadata: 'from the page metadata',
  model: 'classified by the model',
};

/**
 * What the badge, the card and the popup print for this result.
 *
 * The allowlist is `DOC_TYPE_LABELS` itself rather than a second list of strings:
 * `Record<DisplayDocType, string>` is exhaustiveness-checked, so adding a member to
 * `DocType` fails the build until it has a label. A standalone `satisfies DocType[]`
 * array does not — a subset of the union satisfies it, which is how
 * `news_with_heavy_bias` once reached the UI as "Unknown".
 *
 * `Object.hasOwn`, not `in`: a wire value of `"constructor"` is on the prototype and
 * would otherwise index to a function.
 */
export function displayDocType(result: AnalyzeResponse): DisplayDocType {
  return Object.hasOwn(DOC_TYPE_LABELS, result.doc_type) ? result.doc_type : 'unknown';
}

export function docTypeSourceLabel(docType: DisplayDocType, source: DocTypeSource): string {
  if (docType === 'unknown') return 'nothing on the page named a section';
  return DOC_TYPE_SOURCE_LABELS[source];
}

export const CLAIM_TYPE_LABELS: Record<ClaimType, string> = {
  statistic: 'Statistic',
  attributed_quote: 'Attributed quote',
  date_or_count: 'Date or count',
};

export function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}
