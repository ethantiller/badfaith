// Client-side mirror of backend/app/types.py::AnalyzeRequest. Nothing leaves the
// extension without passing through here, so a malformed payload is caught where the
// message is useful rather than coming back as an opaque 422.
import {
  MAX_ENTITIES,
  MAX_ENTITY_CHARS,
  MAX_PARAGRAPHS,
  MAX_PARAGRAPH_CHARS,
  MAX_QUOTE_CHARS,
  MAX_REWRITE_ITEMS,
  MAX_TITLE_CHARS,
  MAX_URL_CHARS,
} from '../types';
import type {
  AnalyzeRequest,
  CoverageRequest,
  Paragraph,
  RewriteItem,
  RewriteRequest,
  SectionHint,
} from '../types';

const SECTION_HINTS: readonly SectionHint[] = ['opinion', 'news', null];

export class ContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContractError';
  }
}

/**
 * Returns a request that satisfies the Pydantic schema, or throws.
 *
 * Size overflow is clamped rather than rejected: a live blog can legitimately run past
 * the paragraph ceiling, and losing the tail is better than losing the analysis. IDs are
 * assigned by the parser and left untouched, so every `paragraph_id` the backend returns
 * still resolves against the content script's element map. Structural problems throw,
 * because they mean a bug on this side.
 */
export function buildAnalyzeRequest(input: AnalyzeRequest): AnalyzeRequest {
  if (typeof input.url !== 'string' || input.url.length === 0) {
    throw new ContractError('The page has no URL to analyze.');
  }
  if (input.url.length > MAX_URL_CHARS) {
    throw new ContractError(`This page's URL is longer than ${MAX_URL_CHARS} characters.`);
  }
  if (!SECTION_HINTS.includes(input.section_hint)) {
    throw new ContractError(`"${String(input.section_hint)}" is not a valid section hint.`);
  }
  if (!Array.isArray(input.paragraphs)) {
    throw new ContractError('The article parsed to no paragraphs.');
  }

  const paragraphs: Paragraph[] = [];
  for (const paragraph of input.paragraphs.slice(0, MAX_PARAGRAPHS)) {
    if (!Number.isInteger(paragraph.id) || paragraph.id < 0) {
      throw new ContractError(`Paragraph id ${String(paragraph.id)} is not a whole number.`);
    }

    const text = paragraph.text.slice(0, MAX_PARAGRAPH_CHARS);
    // The schema rejects an empty body, and a blank paragraph is nothing to analyze.
    if (text.length === 0) continue;

    paragraphs.push({ id: paragraph.id, text });
  }

  if (paragraphs.length === 0) {
    throw new ContractError('The article parsed to no paragraphs.');
  }

  return {
    url: input.url,
    title: (input.title ?? '').slice(0, MAX_TITLE_CHARS),
    section_hint: input.section_hint,
    paragraphs,
  };
}

/**
 * Client-side mirror of backend/app/types.py::CoverageRequest. Entities are deduped
 * and clamped like paragraphs are: a long entity list should lose its tail, not fail.
 */
export function buildCoverageRequest(input: CoverageRequest): CoverageRequest {
  if (typeof input.doc_hash !== 'string' || input.doc_hash.length === 0) {
    throw new ContractError('Analyze the article before searching for coverage.');
  }

  const seen = new Set<string>();
  const entities: string[] = [];
  for (const raw of Array.isArray(input.entities) ? input.entities : []) {
    const entity = String(raw).trim().slice(0, MAX_ENTITY_CHARS);
    const key = entity.toLowerCase();
    if (entity.length === 0 || seen.has(key)) continue;
    seen.add(key);
    entities.push(entity);
    if (entities.length === MAX_ENTITIES) break;
  }

  return {
    doc_hash: input.doc_hash,
    entities,
    title: (input.title ?? '').slice(0, MAX_TITLE_CHARS),
  };
}

/**
 * Client-side mirror of backend/app/types.py::RewriteRequest. An item whose quote no
 * longer sits verbatim in its (clamped) paragraph would 422 the whole request, so it is
 * dropped here instead; the rest of the rewrite still goes through.
 */
export function buildRewriteRequest(input: RewriteRequest): RewriteRequest {
  if (typeof input.doc_hash !== 'string' || input.doc_hash.length === 0) {
    throw new ContractError('Analyze the article before rewriting it.');
  }

  const items: RewriteItem[] = [];
  for (const item of input.items) {
    const text = item.text.slice(0, MAX_PARAGRAPH_CHARS);
    const quote = item.quote.slice(0, MAX_QUOTE_CHARS);
    if (quote.length === 0 || !text.includes(quote)) continue;
    items.push({ paragraph_id: item.paragraph_id, text, quote,
      technique: item.technique,
      explanation: (item.explanation ?? '').slice(0, 1_000),
    });
    if (items.length === MAX_REWRITE_ITEMS) break;
  }

  if (items.length === 0) {
    throw new ContractError('There are no flagged passages to rewrite.');
  }

  return { doc_hash: input.doc_hash, title: (input.title ?? '').slice(0, 500), items };
}
