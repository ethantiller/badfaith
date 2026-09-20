// Client-side mirror of backend/app/types.py::AnalyzeRequest. Nothing leaves the
// extension without passing through here, so a malformed payload is caught where the
// message is useful rather than coming back as an opaque 422.
import {
  MAX_PARAGRAPHS,
  MAX_PARAGRAPH_CHARS,
  MAX_TITLE_CHARS,
  MAX_URL_CHARS,
} from '../types';
import type { AnalyzeRequest, Paragraph, SectionHint } from '../types';

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
