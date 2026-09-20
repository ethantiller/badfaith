const OPINION_KEYWORDS = ["opinion", "editorial", "op-ed", "column", "commentary", "analysis", "perspective", "viewpoint"];

export function detectOpinionPiece(doc: Document, url: string): "opinion" | null {
  // Part 1: try the URL path segment first.
  try {
    const urlPathSegments = new URL(url).pathname
      .split("/")
      .filter(Boolean)
      .map((segment) => segment.toLowerCase());

    if (urlPathSegments.some((segment) => OPINION_KEYWORDS.includes(segment))) {
      return "opinion";
    }
  } catch (error){
    console.error("Error parsing URL:", error);
    
  }

  // Part 2: news sites commonly expose the section through meta tags.
  const metaSelectors = [
    'meta[property="article:section"]',
    'meta[name="article:section"]',
    'meta[property="cg:section"]',
    'meta[name="cg:section"]',
  ];

  for (const selector of metaSelectors) {
    const content = doc.querySelector(selector)?.getAttribute("content");
    const normalizedContent = content?.toLowerCase() ?? "";
    if (OPINION_KEYWORDS.some((keyword) => normalizedContent.includes(keyword))) {
      return "opinion";
    }
  }

  // Part 3: modern news sites embed article metadata in JSON-LD script blocks.
  for (const script of doc.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const jsonLdData: unknown = JSON.parse(script.textContent ?? "");
      const jsonLdItems = Array.isArray(jsonLdData) ? jsonLdData : [jsonLdData];

      for (const item of jsonLdItems) {
        if (item === null || typeof item !== "object") {
          continue;
        }

        const record = item as Record<string, unknown>;
        const articleType = record["@type"];
        if (articleType === "OpinionNewsArticle" ||
          (Array.isArray(articleType) && articleType.includes("OpinionNewsArticle"))) {
          return "opinion";
        }

        const sections: unknown[] = [];
        const articleSection = record.articleSection;
        if (Array.isArray(articleSection)) {
          sections.push(...articleSection);
        } else {
          sections.push(articleSection);
        }

        if (Array.isArray(record["@graph"])) {
          for (const graphItem of record["@graph"]) {
            if (graphItem === null || typeof graphItem !== "object") {
              continue;
            }

            const graphSection = (graphItem as Record<string, unknown>).articleSection;
            if (Array.isArray(graphSection)) {
              sections.push(...graphSection);
            } else {
              sections.push(graphSection);
            }
          }
        }

        for (const section of sections) {
          const normalizedSection = typeof section === "string"
            ? section.toLowerCase().trim()
            : "";

          if (OPINION_KEYWORDS.some((keyword) => normalizedSection.includes(keyword))) {
            return "opinion";
          }
        }
      }
    } catch (error) {
      console.error("Error parsing JSON-LD:", error);
    }
  }

  return null;
}