// Human-readable names for the contract's enum values. Sentence case, because the
// UI reads as prose next to the article, not as a database dump.
import type {
  AnalyzeResponse,
  ClaimType,
  DisplayDocType,
  DocTypeSource,
  Severity,
  SpeakerRole,
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

export const SPEAKER_ROLE_LABELS: Record<SpeakerRole, string> = {
  government_official: 'Government official',
  elected_politician: 'Elected politician',
  journalist: 'Journalist',
  academic_expert: 'Academic expert',
  industry_corporate: 'Industry or corporate',
  funder_donor: 'Funder or donor',
  advocacy_activist: 'Advocacy or activist',
  think_tank: 'Think tank',
  legal_court: 'Legal or court',
  private_individual: 'Private individual',
  anonymous: 'Anonymous source',
  unknown: 'Unknown',
};

// Fixed caveats keyed by role. The model never writes these, so the UI cannot assert bias
// the pipeline did not establish; they say what to weigh, not that the speaker is wrong.
export const SPEAKER_ROLE_NOTES: Record<SpeakerRole, string> = {
  government_official: 'Speaks for an institution with its own interests to present.',
  elected_politician: 'Has political incentives; statements may serve a party or campaign.',
  journalist: 'Reporting or commentary; check whether it is news or opinion.',
  academic_expert: 'Usually independent, but check who funds the research.',
  industry_corporate: 'Has a financial interest in how the topic is framed.',
  funder_donor: 'Funds the cause or topic at hand, which may shape their view.',
  advocacy_activist: 'Advocates for a position; expect a one-sided framing.',
  think_tank: 'May have a policy agenda or funders behind it.',
  legal_court: 'A legal filing or ruling; one party’s argument is not a finding.',
  private_individual: 'A personal account; not independently verified.',
  anonymous: 'The source is unnamed, so their motive cannot be checked.',
  unknown: 'We could not find who this is, so their perspective is unassessed.',
};

export function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}
