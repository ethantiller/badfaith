// Wraps flagged quotes in the live article. Never innerHTML, never node replacement:
// the news site's own listeners and React roots have to survive this.
import highlightCss from '../ui/highlight.css?inline';
import type { Citation, Claim, Flag, Rewrite } from '../types';

const STYLE_ID = 'badfaith-highlight-styles';
const FLAG_SELECTOR = 'span[data-badfaith="flag"]';
const CLAIM_SELECTOR = 'span[data-badfaith="claim"]';
const CITATION_SELECTOR = 'span[data-badfaith="citation"]';
// Operations that must not care which kind a wrapper is: clearing, the "off" toggle, restore.
const ANY_SELECTOR = 'span[data-badfaith]';
const PULSE_MS = 1800;

/** Shape both `Flag` and `Claim` satisfy — enough to locate and wrap a quote. */
interface Quoted {
  paragraph_id: number;
  quote: string;
}

/** One emitted character of normalized text, and the DOM text it came from. */
interface CharAnchor {
  node: Text;
  start: number;
  end: number;
}

export interface ApplyResult {
  applied: number;
  skipped: number;
}

/**
 * Only 1:1 character substitutions. Anything that changes length (NFKC, whitespace
 * collapsing) would invalidate the offset map, so it is not done here.
 */
function normalizeForMatch(text: string): string {
  return text
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”‟″]/g, '"')
    .replace(/[–—−]/g, '-')
    .replace(/[   ]/g, ' ');
}

/**
 * Rebuild the exact string paragraph_parser produced (textContent with whitespace
 * runs collapsed to one space, then trimmed) while recording where every character
 * came from. Collapsed whitespace anchors to its first whitespace character, and
 * merging by node later means the rest of the run ends up inside the wrapper too.
 */
function indexParagraph(element: HTMLElement): { text: string; anchors: CharAnchor[] } {
  const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const anchors: CharAnchor[] = [];
  let text = '';
  let pending: CharAnchor | null = null;

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const textNode = node as Text;
    const data = textNode.data;

    for (let i = 0; i < data.length; i += 1) {
      if (/\s/.test(data[i])) {
        // Leading whitespace is dropped, matching .trim().
        if (text.length === 0) continue;
        if (pending && pending.node === textNode) {
          pending.end = i + 1;
        } else if (!pending) {
          pending = { node: textNode, start: i, end: i + 1 };
        }
        continue;
      }

      if (pending) {
        text += ' ';
        anchors.push(pending);
        pending = null;
      }
      text += data[i];
      anchors.push({ node: textNode, start: i, end: i + 1 });
    }
  }

  // Trailing whitespace stays in `pending` and is discarded, matching .trim().
  return { text, anchors };
}

/** Consecutive anchors that share a text node become one wrappable range. */
function toSegments(anchors: CharAnchor[], from: number, to: number): CharAnchor[] {
  const segments: CharAnchor[] = [];

  for (let i = from; i < to; i += 1) {
    const anchor = anchors[i];
    const last = segments[segments.length - 1];
    if (last && last.node === anchor.node) {
      last.end = Math.max(last.end, anchor.end);
      last.start = Math.min(last.start, anchor.start);
    } else {
      segments.push({ node: anchor.node, start: anchor.start, end: anchor.end });
    }
  }

  return segments;
}

/** Everything a flag wrapper and a claim wrapper share; kind-specific bits layer on top. */
function buildWrapper(
  kind: 'flag' | 'claim' | 'citation',
  id: string,
  index: number,
  order: number,
  reveal: boolean,
  ariaLabel: string,
): HTMLSpanElement {
  const span = document.createElement('span');
  span.setAttribute('data-badfaith', kind);
  span.setAttribute(`data-${kind}-id`, id);
  // The stroke is drawn once, in reading order; highlight.css turns this into the
  // animation delay. Skipped when we are only restoring wrappers a site re-render
  // threw away — the reader already watched that happen.
  if (reveal) {
    span.setAttribute('data-bf-ink', '');
    span.style.setProperty('--bf-i', String(order));
    // Dropped as soon as it has run. Left on, it would restart every time another
    // rule stopped overriding it — so clicking a row in the report would end with
    // the highlight redrawing itself once the found-bloom cleared.
    span.addEventListener(
      'animationend',
      () => {
        span.removeAttribute('data-bf-ink');
        span.style.removeProperty('--bf-i');
      },
      { once: true },
    );
  }
  // Only the first segment is focusable, so one quote is one tab stop.
  if (index === 0) {
    span.setAttribute('tabindex', '0');
    span.setAttribute('role', 'button');
    span.setAttribute('aria-describedby', 'badfaith-tooltip');
    span.setAttribute('aria-label', ariaLabel);
  } else {
    span.setAttribute('aria-hidden', 'true');
  }
  return span;
}

function buildFlagWrapper(
  flag: Flag,
  id: string,
  index: number,
  order: number,
  reveal: boolean,
): HTMLSpanElement {
  const span = buildWrapper('flag', id, index, order, reveal, `Flagged phrase: ${flag.quote}`);
  span.setAttribute('data-bf-severity', flag.severity);
  return span;
}

function buildClaimWrapper(
  claim: Claim,
  id: string,
  index: number,
  order: number,
  reveal: boolean,
): HTMLSpanElement {
  return buildWrapper('claim', id, index, order, reveal, `Checkable claim: ${claim.quote}`);
}

function buildCitationWrapper(
  citation: Citation,
  id: string,
  index: number,
  order: number,
  reveal: boolean,
): HTMLSpanElement {
  const span = buildWrapper(
    'citation',
    id,
    index,
    order,
    reveal,
    `Quoted source, ${citation.speaker}: ${citation.quote}`,
  );
  span.setAttribute('data-bf-speaker', citation.speaker);
  return span;
}

export function ensureHighlightStyles(): void {
  const existing = document.getElementById(STYLE_ID);
  if (existing) return;

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = highlightCss;
  (document.head ?? document.documentElement).appendChild(style);
}

export function flagId(flag: Flag, index: number): string {
  return `f${index}-p${flag.paragraph_id}`;
}

/**
 * Wraps each item's quote inside the one paragraph element it names. A quote that
 * cannot be found, whose paragraph has since changed, or that overlaps an earlier
 * highlight is skipped and counted — never thrown. Shared by `applyFlags` and
 * `applyClaims`; only id assignment and wrapper construction differ between them.
 *
 * `reveal` draws each stroke on, staggered by reading order. Pass false to put
 * wrappers back silently after the site re-rendered them away.
 */
function applyHighlights<T extends Quoted>(
  items: T[],
  nodeMap: Map<number, HTMLElement>,
  reveal: boolean,
  idOf: (item: T, index: number) => string,
  buildItemWrapper: (
    item: T,
    id: string,
    index: number,
    order: number,
    reveal: boolean,
  ) => HTMLSpanElement,
): ApplyResult {
  ensureHighlightStyles();

  const byParagraph = new Map<number, Array<{ item: T; id: string; order: number }>>();
  items.forEach((item, index) => {
    const bucket = byParagraph.get(item.paragraph_id);
    const entry = { item, id: idOf(item, index), order: index };
    if (bucket) bucket.push(entry);
    else byParagraph.set(item.paragraph_id, [entry]);
  });

  let applied = 0;
  let skipped = 0;

  for (const [paragraphId, entries] of byParagraph) {
    const element = nodeMap.get(paragraphId);
    if (!element || !element.isConnected) {
      skipped += entries.length;
      continue;
    }

    const { text, anchors } = indexParagraph(element);
    const haystack = normalizeForMatch(text);
    const taken: Array<[number, number]> = [];
    const matches: Array<{
      id: string;
      item: T;
      order: number;
      start: number;
      end: number;
    }> = [];

    for (const { item, id, order } of entries) {
      const needle = normalizeForMatch(item.quote).replace(/\s+/g, ' ').trim();
      if (!needle) {
        skipped += 1;
        continue;
      }

      // First occurrence, the same rule the grounding gate and the eval runner use.
      const start = haystack.indexOf(needle);
      if (start < 0) {
        skipped += 1;
        console.debug('[badfaith] quote not found in paragraph', paragraphId, item.quote);
        continue;
      }

      const end = start + needle.length;
      if (taken.some(([a, b]) => start < b && a < end)) {
        skipped += 1;
        console.debug('[badfaith] quote overlaps an earlier highlight', item.quote);
        continue;
      }

      taken.push([start, end]);
      matches.push({ id, item, order, start, end });
    }

    // Descending order: splitting a text node at a later offset leaves every earlier
    // offset in that node valid, so no index we still hold goes stale.
    matches.sort((a, b) => b.start - a.start);

    for (const match of matches) {
      const segments = toSegments(anchors, match.start, match.end);
      const wrappers: HTMLSpanElement[] = [];

      try {
        for (let i = segments.length - 1; i >= 0; i -= 1) {
          const segment = segments[i];
          const range = document.createRange();
          range.setStart(segment.node, segment.start);
          range.setEnd(segment.node, segment.end);
          const wrapper = buildItemWrapper(match.item, match.id, i, match.order, reveal);
          range.surroundContents(wrapper);
          wrappers.push(wrapper);
        }
        applied += 1;
      } catch (error) {
        // Unwind this quote's partial work; the page must never be left half-wrapped.
        wrappers.forEach(unwrap);
        skipped += 1;
        console.debug('[badfaith] could not wrap quote', match.item.quote, error);
      }
    }
  }

  return { applied, skipped };
}

export function applyFlags(
  flags: Flag[],
  nodeMap: Map<number, HTMLElement>,
  reveal = true,
): ApplyResult {
  return applyHighlights(flags, nodeMap, reveal, flagId, buildFlagWrapper);
}

/** Same matching and wrapping machinery as `applyFlags`, keyed by `claim.id` directly. */
export function applyClaims(
  claims: Claim[],
  nodeMap: Map<number, HTMLElement>,
  reveal = true,
): ApplyResult {
  return applyHighlights(claims, nodeMap, reveal, (claim) => claim.id, buildClaimWrapper);
}

/** Citations share the matching machinery; they are wrapped under their own `s<n>` id. */
export function applyCitations(
  citations: Citation[],
  nodeMap: Map<number, HTMLElement>,
  reveal = true,
): ApplyResult {
  return applyHighlights(citations, nodeMap, reveal, (citation) => citation.id, buildCitationWrapper);
}

function unwrap(span: Element): void {
  const parent = span.parentNode;
  if (!parent) return;
  while (span.firstChild) parent.insertBefore(span.firstChild, span);
  parent.removeChild(span);
  parent.normalize();
}

// The article's own wording, per text node, while a neutral rewrite is showing. Text nodes
// are edited in place (never replaced), so the site's listeners and roots survive.
const originalText = new WeakMap<Text, string>();

function textNodesOf(root: Element): Text[] {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node as Text);
  return nodes;
}

/** Puts the article's own wording back over every rewritten quote. */
export function restoreRewrites(): void {
  for (const span of document.querySelectorAll(FLAG_SELECTOR)) {
    for (const node of textNodesOf(span)) {
      const original = originalText.get(node);
      if (original === undefined) continue;
      node.data = original;
      originalText.delete(node);
    }
  }
}

/**
 * Swaps each flagged quote's text for its neutral rewrite. A rewrite belongs to the flag
 * with the same paragraph and quote. The new wording goes in the quote's first text node
 * and the rest of a split quote is emptied, so the highlight wrappers stay where they are.
 */
export function applyRewrites(rewrites: Rewrite[], flags: Flag[]): number {
  restoreRewrites();
  const byQuote = new Map(rewrites.map((r) => [`${r.paragraph_id}\u0000${r.original}`, r.rewrite]));
  let applied = 0;

  flags.forEach((flag, index) => {
    const rewrite = byQuote.get(`${flag.paragraph_id}\u0000${flag.quote}`);
    if (rewrite === undefined) return;

    const nodes = Array.from(segmentsOf(FLAG_SELECTOR, 'data-flag-id', flagId(flag, index))).flatMap(textNodesOf);
    if (nodes.length === 0) return;

    nodes.forEach((node, i) => {
      originalText.set(node, node.data);
      node.data = i === 0 ? rewrite : '';
    });
    applied += 1;
  });

  return applied;
}

/** Leaves the article exactly as it was found. */
export function clearHighlights(): void {
  restoreRewrites();
  document.querySelectorAll(ANY_SELECTOR).forEach(unwrap);
  document.documentElement.removeAttribute('data-badfaith-highlights');
}

export function highlightCount(): number {
  return document.querySelectorAll(FLAG_SELECTOR).length;
}

export function claimHighlightCount(): number {
  return document.querySelectorAll(CLAIM_SELECTOR).length;
}

export function citationHighlightCount(): number {
  return document.querySelectorAll(CITATION_SELECTOR).length;
}

export function setHighlightsVisible(visible: boolean): void {
  if (visible) document.documentElement.removeAttribute('data-badfaith-highlights');
  else document.documentElement.setAttribute('data-badfaith-highlights', 'off');
}

/** A quote that crossed an inline element is several spans sharing one flag/claim id. */
function segmentsOf(selector: string, attr: string, id: string): NodeListOf<Element> {
  return document.querySelectorAll(`${selector}[${attr}="${CSS.escape(id)}"]`);
}

function setPulse(nodes: Iterable<Element>, on: boolean): void {
  for (const node of nodes) {
    if (on) node.setAttribute('data-bf-pulse', '');
    else node.removeAttribute('data-bf-pulse');
  }
}

/**
 * Lights one flag's highlight from somewhere else — the pointer is on that flag's
 * row in the report, not on the phrase. Passing null puts every highlight back.
 * Every segment of a quote that broke across an inline element lights together, so
 * a split phrase never half-lights.
 */
export function setFlagHot(id: string | null): void {
  for (const node of document.querySelectorAll(`${FLAG_SELECTOR}[data-bf-hot]`)) {
    node.removeAttribute('data-bf-hot');
  }
  if (!id) return;
  for (const node of segmentsOf(FLAG_SELECTOR, 'data-flag-id', id)) node.setAttribute('data-bf-hot', '');
}

export function findFlagElement(id: string): HTMLElement | null {
  return segmentsOf(FLAG_SELECTOR, 'data-flag-id', id)[0] as HTMLElement | undefined ?? null;
}

export function findClaimElement(id: string): HTMLElement | null {
  return segmentsOf(CLAIM_SELECTOR, 'data-claim-id', id)[0] as HTMLElement | undefined ?? null;
}

export function findCitationElement(id: string): HTMLElement | null {
  return segmentsOf(CITATION_SELECTOR, 'data-citation-id', id)[0] as HTMLElement | undefined ?? null;
}

export function focusFlag(id: string): void {
  const element = findFlagElement(id);
  if (!element) return;

  element.scrollIntoView({ behavior: 'smooth', block: 'center' });
  setPulse(document.querySelectorAll(`${FLAG_SELECTOR}[data-bf-pulse]`), false);
  setPulse(segmentsOf(FLAG_SELECTOR, 'data-flag-id', id), true);

  window.setTimeout(() => setPulse(segmentsOf(FLAG_SELECTOR, 'data-flag-id', id), false), PULSE_MS);
}

/** Same navigate-and-pulse behavior as `focusFlag`, scoped to claim wrappers. */
export function focusClaim(id: string): void {
  const element = findClaimElement(id);
  if (!element) return;

  element.scrollIntoView({ behavior: 'smooth', block: 'center' });
  setPulse(document.querySelectorAll(`${CLAIM_SELECTOR}[data-bf-pulse]`), false);
  setPulse(segmentsOf(CLAIM_SELECTOR, 'data-claim-id', id), true);

  window.setTimeout(() => setPulse(segmentsOf(CLAIM_SELECTOR, 'data-claim-id', id), false), PULSE_MS);
}

/** Same navigate-and-pulse behavior as `focusClaim`, scoped to citation wrappers. */
export function focusCitation(id: string): void {
  const element = findCitationElement(id);
  if (!element) return;

  element.scrollIntoView({ behavior: 'smooth', block: 'center' });
  setPulse(document.querySelectorAll(`${CITATION_SELECTOR}[data-bf-pulse]`), false);
  setPulse(segmentsOf(CITATION_SELECTOR, 'data-citation-id', id), true);

  window.setTimeout(
    () => setPulse(segmentsOf(CITATION_SELECTOR, 'data-citation-id', id), false),
    PULSE_MS,
  );
}
