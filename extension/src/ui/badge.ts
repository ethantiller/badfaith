// The in-page badge. It does not exist until the user clicks Analyze in the popup,
// so an ordinary page carries none of this. From then on it reports the result and
// expands into the card.
import type { AnalyzeResponse, PageState } from '../types';
import { DOC_TYPE_LABELS, displayDocType, plural } from './labels';
import { button, el } from './dom';

export interface BadgeDetail {
  result?: AnalyzeResponse;
  message?: string;
  retryable?: boolean;
}

export interface BadgeView {
  element: HTMLButtonElement;
  render(state: PageState, detail?: BadgeDetail): void;
}

interface Shape {
  /** A spinner instead of the status dot. */
  busy?: boolean;
  label: string;
  /** Right-hand segment, after a hairline rule. */
  count?: string;
  ariaLabel?: string;
  disabled?: boolean;
}

function shapeFor(state: PageState, detail: BadgeDetail): Shape | null {
  switch (state) {
    case 'loading':
      return { busy: true, label: 'Analyzing…', disabled: true };

    case 'done': {
      const flags = detail.result?.flags.length ?? 0;
      return {
        label: detail.result ? DOC_TYPE_LABELS[displayDocType(detail.result)] : 'Analyzed',
        count: flags === 0 ? 'no flags' : plural(flags, 'flag', 'flags'),
        ariaLabel: 'Open the Bad Faith report',
      };
    }

    case 'stale':
      return {
        label: 'Analyze again',
        ariaLabel: 'The article changed. Analyze it again',
      };

    case 'error':
      return {
        label: detail.message ?? 'Something went wrong',
        ariaLabel: detail.message ?? 'Analysis failed',
        disabled: detail.retryable === false,
      };

    case 'idle':
      return null;
  }
}

export function createBadge(onActivate: (event: MouseEvent) => void): BadgeView {
  const element = button({ className: 'bf-pill' });
  element.addEventListener('click', onActivate);

  function render(state: PageState, detail: BadgeDetail = {}): void {
    element.dataset.state = state;

    const shape = shapeFor(state, detail);
    if (!shape) {
      element.replaceChildren();
      return;
    }

    element.disabled = shape.disabled ?? false;
    if (shape.ariaLabel) element.setAttribute('aria-label', shape.ariaLabel);
    else element.removeAttribute('aria-label');

    element.replaceChildren(
      el('span', { className: shape.busy ? 'bf-spinner' : 'bf-dot' }),
      el('span', { className: 'bf-pill-label', text: shape.label }),
      ...(shape.count ? [el('span', { className: 'bf-pill-count', text: shape.count })] : []),
    );
  }

  render('loading');
  return { element, render };
}
