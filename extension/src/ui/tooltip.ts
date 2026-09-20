// The hover summary. Rendered in the shadow host, never inside the article, so the
// site's layout and stylesheet are untouched.
import type { Citation, Flag } from '../types';
import {
  SEVERITY_LABELS,
  SPEAKER_ROLE_LABELS,
  SPEAKER_ROLE_NOTES,
  TECHNIQUE_LABELS,
} from './labels';
import { el } from './dom';

const GAP = 10;
const EDGE = 12;
const SHOW_DELAY = 120;
const HIDE_DELAY = 220;

export interface TooltipView {
  element: HTMLElement;
  /** Schedules a show against the given anchor. */
  open(anchor: Element, flag: Flag): void;
  /** Same tooltip, showing who a quote is credited to and what kind of source they are. */
  openCitation(anchor: Element, citation: Citation): void;
  /** Schedules a hide; cancelled if the pointer lands on the tooltip. */
  close(): void;
  closeNow(): void;
}

export function createTooltip(): TooltipView {
  const name = el('span', { className: 'bf-tip-name' });
  const chip = el('span', { className: 'bf-chip' });
  const confidence = el('span', { className: 'bf-tip-confidence' });
  const body = el('p', { className: 'bf-tip-body' });
  const meta = el('p', { className: 'bf-tip-meta' });

  const element = el('div', {
    className: 'bf-tip',
    attrs: { id: 'badfaith-tooltip', role: 'tooltip' },
    children: [
      el('div', { className: 'bf-tip-head', children: [name, chip, confidence] }),
      body,
      meta,
    ],
  });

  let showTimer = 0;
  let hideTimer = 0;

  function position(anchor: Element): void {
    const rect = anchor.getBoundingClientRect();
    const own = element.getBoundingClientRect();

    // Below by default; flip above when the bottom of the viewport is closer.
    const below = rect.bottom + GAP;
    const above = rect.top - GAP - own.height;
    const top = below + own.height + EDGE > window.innerHeight && above > EDGE ? above : below;

    const centred = rect.left + rect.width / 2 - own.width / 2;
    const left = Math.min(Math.max(centred, EDGE), window.innerWidth - own.width - EDGE);

    element.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;

    // Scale out from the edge nearest the phrase, so the summary reads as coming
    // from that phrase rather than arriving on its own.
    const anchorX = rect.left + rect.width / 2 - left;
    const originX = Math.min(Math.max(anchorX, 0), own.width || 1);
    element.style.setProperty(
      '--bf-tip-origin',
      `${Math.round(originX)}px ${top === above ? '100%' : '0%'}`,
    );
  }

  function schedule(anchor: Element, fill: () => void): void {
    window.clearTimeout(hideTimer);
    window.clearTimeout(showTimer);

    showTimer = window.setTimeout(() => {
      fill();
      element.dataset.open = 'true';
      position(anchor);
    }, SHOW_DELAY);
  }

  function open(anchor: Element, flag: Flag): void {
    schedule(anchor, () => {
      name.textContent = TECHNIQUE_LABELS[flag.technique];
      chip.textContent = SEVERITY_LABELS[flag.severity];
      chip.dataset.severity = flag.severity;
      confidence.textContent = `${Math.round(flag.confidence * 100)}% confident`;
      body.textContent = flag.explanation;
      meta.textContent = `Paragraph ${flag.paragraph_id + 1}`;
    });
  }

  function openCitation(anchor: Element, citation: Citation): void {
    schedule(anchor, () => {
      name.textContent = citation.speaker;
      chip.textContent = SPEAKER_ROLE_LABELS[citation.speaker_role];
      delete chip.dataset.severity;
      confidence.textContent = '';
      body.textContent = SPEAKER_ROLE_NOTES[citation.speaker_role];
      meta.textContent = `Quoted source · Paragraph ${citation.paragraph_id + 1}`;
    });
  }

  function closeNow(): void {
    window.clearTimeout(showTimer);
    window.clearTimeout(hideTimer);
    element.dataset.open = 'false';
  }

  function close(): void {
    window.clearTimeout(showTimer);
    hideTimer = window.setTimeout(closeNow, HIDE_DELAY);
  }

  // Let the pointer travel onto the tooltip without it vanishing.
  element.addEventListener('pointerenter', () => window.clearTimeout(hideTimer));
  element.addEventListener('pointerleave', close);

  return { element, open, openCitation, close, closeNow };
}
