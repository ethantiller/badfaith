// Wraps flagged quotes in the live article. Never innerHTML, never node replacement:
// the news site's own listeners and React roots have to survive this.
import highlightCss from '../ui/highlight.css?inline';
import type { Flag } from '../types';

const STYLE_ID = 'badfaith-highlight-styles';
const FLAG_SELECTOR = 'span[data-badfaith="flag"]';
const PULSE_MS = 1800;

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

function buildWrapper(flag: Flag, flagId: string, index: number): HTMLSpanElement {
  const span = document.createElement('span');
  span.setAttribute('data-badfaith', 'flag');
  span.setAttribute('data-flag-id', flagId);
  span.setAttribute('data-bf-severity', flag.severity);
  // Only the first segment is focusable, so one quote is one tab stop.
  if (index === 0) {
    span.setAttribute('tabindex', '0');
    span.setAttribute('role', 'button');
    span.setAttribute('aria-describedby', 'badfaith-tooltip');
    span.setAttribute('aria-label', `Flagged phrase: ${flag.quote}`);
  } else {
    span.setAttribute('aria-hidden', 'true');
  }
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
 * Wraps each flag's quote inside the one paragraph element it names. A quote that
 * cannot be found, whose paragraph has since changed, or that overlaps an earlier
 * highlight is skipped and counted — never thrown.
 */
export function applyFlags(flags: Flag[], nodeMap: Map<number, HTMLElement>): ApplyResult {
  ensureHighlightStyles();

  const byParagraph = new Map<number, Array<{ flag: Flag; id: string }>>();
  flags.forEach((flag, index) => {
    const bucket = byParagraph.get(flag.paragraph_id);
    const entry = { flag, id: flagId(flag, index) };
    if (bucket) bucket.push(entry);
    else byParagraph.set(flag.paragraph_id, [entry]);
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
    const matches: Array<{ id: string; flag: Flag; start: number; end: number }> = [];

    for (const { flag, id } of entries) {
      const needle = normalizeForMatch(flag.quote).replace(/\s+/g, ' ').trim();
      if (!needle) {
        skipped += 1;
        continue;
      }

      // First occurrence, the same rule the grounding gate and the eval runner use.
      const start = haystack.indexOf(needle);
      if (start < 0) {
        skipped += 1;
        console.debug('[badfaith] quote not found in paragraph', paragraphId, flag.quote);
        continue;
      }

      const end = start + needle.length;
      if (taken.some(([a, b]) => start < b && a < end)) {
        skipped += 1;
        console.debug('[badfaith] quote overlaps an earlier highlight', flag.quote);
        continue;
      }

      taken.push([start, end]);
      matches.push({ id, flag, start, end });
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
          const wrapper = buildWrapper(match.flag, match.id, i);
          range.surroundContents(wrapper);
          wrappers.push(wrapper);
        }
        applied += 1;
      } catch (error) {
        // Unwind this quote's partial work; the page must never be left half-wrapped.
        wrappers.forEach(unwrap);
        skipped += 1;
        console.debug('[badfaith] could not wrap quote', match.flag.quote, error);
      }
    }
  }

  return { applied, skipped };
}

function unwrap(span: Element): void {
  const parent = span.parentNode;
  if (!parent) return;
  while (span.firstChild) parent.insertBefore(span.firstChild, span);
  parent.removeChild(span);
  parent.normalize();
}

/** Leaves the article exactly as it was found. */
export function clearHighlights(): void {
  document.querySelectorAll(FLAG_SELECTOR).forEach(unwrap);
  document.documentElement.removeAttribute('data-badfaith-highlights');
}

export function highlightCount(): number {
  return document.querySelectorAll(FLAG_SELECTOR).length;
}

export function setHighlightsVisible(visible: boolean): void {
  if (visible) document.documentElement.removeAttribute('data-badfaith-highlights');
  else document.documentElement.setAttribute('data-badfaith-highlights', 'off');
}

/** A quote that crossed an inline element is several spans sharing one flag id. */
function segmentsOf(id: string): NodeListOf<Element> {
  return document.querySelectorAll(`${FLAG_SELECTOR}[data-flag-id="${CSS.escape(id)}"]`);
}

function setPulse(nodes: Iterable<Element>, on: boolean): void {
  for (const node of nodes) {
    if (on) node.setAttribute('data-bf-pulse', '');
    else node.removeAttribute('data-bf-pulse');
  }
}

export function findFlagElement(id: string): HTMLElement | null {
  return segmentsOf(id)[0] as HTMLElement | undefined ?? null;
}

export function focusFlag(id: string): void {
  const element = findFlagElement(id);
  if (!element) return;

  element.scrollIntoView({ behavior: 'smooth', block: 'center' });
  setPulse(document.querySelectorAll(`${FLAG_SELECTOR}[data-bf-pulse]`), false);
  setPulse(segmentsOf(id), true);

  window.setTimeout(() => setPulse(segmentsOf(id), false), PULSE_MS);
}
