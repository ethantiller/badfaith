// Hover and keyboard focus on a highlight. Delegated from the document, so the number
// of listeners does not grow with the number of flags.
import type { Citation, Flag } from '../types';

const HIGHLIGHT_SELECTOR = 'span[data-badfaith="flag"], span[data-badfaith="citation"]';
const OPEN_EVENTS = ['pointerover', 'focusin'] as const;
const CLOSE_EVENTS = ['pointerout', 'focusout'] as const;

/** What a hovered highlight stands for: a flagged phrase or a quoted source. */
export type HoverTarget =
  | { kind: 'flag'; flag: Flag }
  | { kind: 'citation'; citation: Citation };

export interface HoverHandlers {
  /** The target a wrapper belongs to, or undefined if it is stale. */
  lookup(kind: HoverTarget['kind'], id: string): HoverTarget | undefined;
  show(anchor: Element, target: HoverTarget): void;
  hide(): void;
  dismiss(): void;
}

function hit(target: EventTarget | null, lookup: HoverHandlers['lookup']) {
  if (!(target instanceof Element)) return null;

  const element = target.closest(HIGHLIGHT_SELECTOR);
  if (!element) return null;

  const kind = element.getAttribute('data-badfaith') === 'citation' ? 'citation' : 'flag';
  const id = element.getAttribute(`data-${kind}-id`);
  if (!id) return null;

  const found = lookup(kind, id);
  return found ? { element, target: found } : null;
}

/** Registered once for the lifetime of the page. */
export function wireHighlightHover(handlers: HoverHandlers): void {
  for (const name of OPEN_EVENTS) {
    document.addEventListener(name, (event) => {
      const found = hit(event.target, handlers.lookup);
      if (found) handlers.show(found.element, found.target);
    });
  }

  for (const name of CLOSE_EVENTS) {
    document.addEventListener(name, (event) => {
      if (hit(event.target, handlers.lookup)) handlers.hide();
    });
  }

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') handlers.dismiss();
  });

  window.addEventListener('scroll', handlers.dismiss, { passive: true });
}
