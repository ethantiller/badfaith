import type { Paragraph } from '../types';

const ARTICLE_SELECTORS = [
  '[itemprop="articleBody"]',
  '[class*="article-body"]',
  '[class*="article-content"]',
  '[class*="story-body"]',
  '[class*="post-content"]',
  '[class*="post-body"]',
  '[class*="entry-content"]',
  'main',
  '[role="main"]',
];

const EXCLUDED_SECTIONS = [
  'header',
  'footer',
  'nav',
  'aside',
  '[role="navigation"]',
  '[role="complementary"]',
  '[role="banner"]',
  '[role="contentinfo"]',
].join(',');

// Short label-style lines only, so "By the time..." or "Shares of X fell" survive.
const METADATA_PATTERN = /^(share|published|updated|by|read more|advertisement|sponsored)\b/i;
const MAX_METADATA_LENGTH = 80;
const MIN_PARAGRAPH_LENGTH = 10;
const MIN_ARTICLE_PARAGRAPHS = 3;
const MIN_ARTICLE_TEXT_LENGTH = 500;

interface CandidateParagraph {
  element: HTMLParagraphElement;
  text: string;
}

function normalizeText(raw: string | null): string {
  return (raw ?? '').replace(/\s+/g, ' ').trim();
}

function getIncludedParagraphs(container: Element): CandidateParagraph[] {
  const result: CandidateParagraph[] = [];

  container.querySelectorAll('p').forEach((element) => {
    // Only exclude sections inside the container, not ones the container itself sits in.
    const excluded = element.closest(EXCLUDED_SECTIONS);
    if (excluded && container.contains(excluded)) return;

    // Skip hidden paragraphs (display:none, collapsed ads, etc.)
    if (element.getClientRects().length === 0) return;

    const text = normalizeText(element.textContent);
    if (text.length < MIN_PARAGRAPH_LENGTH) return;
    if (text.length <= MAX_METADATA_LENGTH && METADATA_PATTERN.test(text)) return;

    result.push({ element, text });
  });

  return result;
}

function isValidArticleContainer(container: Element): boolean {
  const paragraphs = getIncludedParagraphs(container);
  if (paragraphs.length < MIN_ARTICLE_PARAGRAPHS) return false;

  const totalLength = paragraphs.reduce((sum, p) => sum + p.text.length, 0);
  return totalLength >= MIN_ARTICLE_TEXT_LENGTH;
}

// Returns every valid container from the first strategy that yields any, so
// pages with several <article> blocks (live blogs) are not truncated to one.
function findArticleElements(document: Document): Element[] {
  const articles = Array.from(document.querySelectorAll('article')).filter(isValidArticleContainer);
  if (articles.length > 0) return articles;

  for (const selector of ARTICLE_SELECTORS) {
    const matches = Array.from(document.querySelectorAll(selector)).filter(isValidArticleContainer);
    if (matches.length > 0) return matches;
  }

  return [];
}

export interface ParsedArticle {
  paragraphs: Paragraph[];
  /** Paragraph id to the live element it came from. Never crosses a message boundary. */
  nodeMap: Map<number, HTMLElement>;
  /** False when we fell back to document.body, which is what gates the Analyze button. */
  foundArticleContainer: boolean;
  /** The containers we read from, for the staleness observer. */
  roots: Element[];
}

export function parseParagraphs(document: Document): ParsedArticle {
  const containers = findArticleElements(document);
  const foundArticleContainer = containers.length > 0;

  let roots: Element[];
  if (foundArticleContainer) {
    roots = containers;
  } else if (document.body) {
    roots = [document.body];
  } else {
    roots = [];
  }

  // Nested or overlapping containers can match the same <p>; dedupe by element.
  const unique = new Map<HTMLParagraphElement, string>();
  for (const root of roots) {
    for (const { element, text } of getIncludedParagraphs(root)) {
      unique.set(element, text);
    }
  }

  const ordered = Array.from(unique.entries()).sort(([a], [b]) =>
    a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
  );

  const paragraphs: Paragraph[] = [];
  const nodeMap = new Map<number, HTMLElement>();
  ordered.forEach(([element, text], id) => {
    paragraphs.push({ id, text });
    nodeMap.set(id, element);
  });

  return { paragraphs, nodeMap, foundArticleContainer, roots };
}
