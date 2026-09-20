// Hover and keyboard focus on a highlight. Delegated from the document, so the number
// of listeners does not grow with the number of flags.
import type { Flag } from '../types';

const FLAG_SELECTOR = 'span[data-badfaith="flag"]';
const OPEN_EVENTS = ['pointerover', 'focusin'] as const;
const CLOSE_EVENTS = ['pointerout', 'focusout'] as const;

export interface HoverHandlers {
  /** The flag a wrapper belongs to, or undefined if it is stale. */
  lookup(id: string): Flag | undefined;
  show(anchor: Element, flag: Flag): void;
  hide(): void;
  dismiss(): void;
}

function hit(target: EventTarget | null, lookup: HoverHandlers['lookup']) {
  if (!(target instanceof Element)) return null;

  const element = target.closest(FLAG_SELECTOR);
  const id = element?.getAttribute('data-flag-id');
  if (!element || !id) return null;

  const flag = lookup(id);
  return flag ? { element, flag } : null;
}

/** Registered once for the lifetime of the page. */
export function wireHighlightHover(handlers: HoverHandlers): void {
  for (const name of OPEN_EVENTS) {
    document.addEventListener(name, (event) => {
      const found = hit(event.target, handlers.lookup);
      if (found) handlers.show(found.element, found.flag);
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
