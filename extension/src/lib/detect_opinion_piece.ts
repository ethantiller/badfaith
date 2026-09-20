const OPINION_KEYWORDS = [
  'opinion',
  'editorial',
  'op-ed',
  'column',
  'commentary',
  'analysis',
  'perspective',
  'viewpoint',
];

type OpinionResult = 'opinion' | null;

export function detectOpinionPiece(doc: Document, url: string): OpinionResult {
  return (
    detectOpinionFromUrl(url) ??
    detectOpinionFromMetaTags(doc) ??
    detectOpinionFromJsonLd(doc)
  );
}

function detectOpinionFromUrl(url: string): OpinionResult {
  try {
    const pathSegments = new URL(url).pathname
      .split('/')
      .filter(Boolean)
      .map((segment) => segment.toLowerCase());

    return pathSegments.some((segment) => OPINION_KEYWORDS.includes(segment))
      ? 'opinion'
      : null;
  } catch (error) {
    console.error('Error parsing URL:', error);
    return null;
  }
}

function detectOpinionFromMetaTags(doc: Document): OpinionResult {
  const metaSelectors = [
    'meta[property="article:section"]',
    'meta[name="article:section"]',
    'meta[property="cg:section"]',
    'meta[name="cg:section"]',
  ];

  for (const selector of metaSelectors) {
    const content = doc.querySelector(selector)?.getAttribute('content') ?? '';
    if (containsOpinionKeyword(content)) {
      return 'opinion';
    }
  }

  return null;
}

function detectOpinionFromJsonLd(doc: Document): OpinionResult {
  for (const script of doc.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const data: unknown = JSON.parse(script.textContent ?? '');
      const records = Array.isArray(data) ? data : [data];

      for (const record of records) {
        if (isOpinionJsonLdRecord(record)) {
          return 'opinion';
        }
      }
    } catch (error) {
      console.error('Error parsing JSON-LD:', error);
    }
  }

  return null;
}

function isOpinionJsonLdRecord(value: unknown): boolean {
  if (value === null || typeof value !== 'object') {
    return false;
  }

  const record = value as Record<string, unknown>;
  if (isOpinionArticleType(record['@type'])) {
    return true;
  }

  const sections = [
    ...getArticleSections(record),
    ...getGraphSections(record['@graph']),
  ];

  return sections.some((section) =>
    typeof section === 'string' && containsOpinionKeyword(section),
  );
}

function isOpinionArticleType(articleType: unknown): boolean {
  return articleType === 'OpinionNewsArticle'
    || (Array.isArray(articleType) && articleType.includes('OpinionNewsArticle'));
}

function getArticleSections(record: Record<string, unknown>): unknown[] {
  const articleSection = record.articleSection;
  return Array.isArray(articleSection) ? articleSection : [articleSection];
}

function getGraphSections(graph: unknown): unknown[] {
  if (!Array.isArray(graph)) {
    return [];
  }

  return graph.flatMap((item) => {
    if (item === null || typeof item !== 'object') {
      return [];
    }

    return getArticleSections(item as Record<string, unknown>);
  });
}

function containsOpinionKeyword(value: string): boolean {
  const normalizedValue = value.toLowerCase().trim();
  return OPINION_KEYWORDS.some((keyword) => normalizedValue.includes(keyword));
}