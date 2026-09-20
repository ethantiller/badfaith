// The report card. Expands from the badge, scrolls internally, and never grows past
// 70% of the viewport — the article underneath stays readable.
import type { AnalyzeResponse, Claim, Flag, Technique } from '../types';
import { flagId } from '../article/highlight';
import {
  CLAIM_TYPE_LABELS,
  DOC_TYPE_LABELS,
  SEVERITY_LABELS,
  TECHNIQUE_LABELS,
  displayDocType,
  docTypeSourceLabel,
  plural,
} from './labels';
import { button, el, glowable } from './dom';

export interface CardHandlers {
  onClose(): void;
  onFlagClick(id: string): void;
  /** The pointer entered a flag's row, or left every row (null). */
  onFlagHover(id: string | null): void;
  onToggleHighlights(visible: boolean): void;
  onClear(): void;
}

export interface CardView {
  element: HTMLElement;
  render(result: AnalyzeResponse): void;
  setHighlightsVisible(visible: boolean): void;
  /** Lights a row because the pointer is on that phrase in the article. */
  setHotFlag(id: string | null): void;
}

function section(title: string, ...body: Node[]): HTMLElement {
  return el('section', {
    className: 'bf-section',
    children: [el('h3', { className: 'bf-section-title', text: title }), ...body],
  });
}

function note(text: string): HTMLElement {
  return el('p', { className: 'bf-empty', text });
}

function severityChip(flag: Flag): HTMLElement {
  return el('span', {
    className: 'bf-chip',
    text: SEVERITY_LABELS[flag.severity],
    attrs: { 'data-severity': flag.severity },
  });
}

function quoted(text: string): string {
  return `“${text}”`;
}

function tally(flags: Flag[]): HTMLElement {
  const counts = new Map<Technique, number>();
  for (const flag of flags) counts.set(flag.technique, (counts.get(flag.technique) ?? 0) + 1);

  const rows = [...counts]
    .sort((a, b) => b[1] - a[1])
    .flatMap(([technique, count]) => [
      el('dt', { text: TECHNIQUE_LABELS[technique] }),
      el('dd', { text: String(count) }),
    ]);

  return el('dl', { className: 'bf-tally', children: rows });
}

function flagRow(
  flag: Flag,
  id: string,
  onClick: (id: string) => void,
  onHover: (id: string | null) => void,
): HTMLElement {
  const head = el('span', {
    className: 'bf-row-technique',
    children: [
      el('span', { className: 'bf-row-name', text: TECHNIQUE_LABELS[flag.technique] }),
      severityChip(flag),
    ],
  });

  const row = button({
    className: 'bf-row',
    attrs: { 'data-flag-id': id },
    onClick: () => onClick(id),
    children: [
      // The list is in reading order, so the paragraph number is information.
      el('span', { className: 'bf-row-index', text: String(flag.paragraph_id + 1) }),
      el('span', {
        className: 'bf-row-main',
        children: [head, el('span', { className: 'bf-row-quote', text: quoted(flag.quote) })],
      }),
    ],
  });

  // Hovering the row lights the phrase in the article, and hovering the phrase
  // lights this row: one list, one page, one gesture.
  row.addEventListener('pointerenter', () => onHover(id));
  row.addEventListener('pointerleave', () => onHover(null));
  row.addEventListener('focus', () => onHover(id));
  row.addEventListener('blur', () => onHover(null));

  return el('li', { children: [glowable(row)] });
}

function claimRow(claim: Claim): HTMLElement {
  const verify = glowable(button({ className: 'bf-ghost-button', children: ['Verify'] }));
  verify.disabled = true;
  verify.title = 'Coming soon';

  const quote = el('div', {
    className: 'bf-claim-quote',
    children: [
      quoted(claim.quote),
      el('span', {
        className: 'bf-claim-type',
        text: `${CLAIM_TYPE_LABELS[claim.claim_type]}, paragraph ${claim.paragraph_id + 1}`,
      }),
    ],
  });

  return el('div', { className: 'bf-claim', children: [quote, verify] });
}

export function createCard(handlers: CardHandlers): CardView {
  const title = el('h2', { className: 'bf-card-title' });
  const subtitle = el('p', { className: 'bf-card-sub' });
  const body = el('div', { className: 'bf-card-body' });

  const heading = el('div', { children: [title, subtitle] });
  heading.style.flex = '1';
  heading.style.minWidth = '0';

  const head = el('header', {
    className: 'bf-card-head',
    children: [
      heading,
      button({
        className: 'bf-icon-button',
        text: '×',
        attrs: { 'aria-label': 'Minimise the report' },
        onClick: handlers.onClose,
      }),
    ],
  });

  const toggle = el('input');
  toggle.type = 'checkbox';
  toggle.checked = true;
  toggle.addEventListener('change', () => handlers.onToggleHighlights(toggle.checked));

  const foot = el('footer', {
    className: 'bf-card-foot',
    children: [
      el('label', { className: 'bf-toggle', children: [toggle, 'Show highlights'] }),
      button({ className: 'bf-text-button', text: 'Clear', onClick: handlers.onClear }),
    ],
  });

  const element = el('div', {
    className: 'bf-card',
    attrs: { role: 'dialog', 'aria-label': 'Bad Faith report' },
    children: [head, body, foot],
  });

  function flagSections(result: AnalyzeResponse): HTMLElement[] {
    if (result.flags.length === 0) {
      return [section('Flagged phrases', note('No flagged phrases in this article.'))];
    }

    const list = el('ul', {
      className: 'bf-list',
      children: result.flags.map((flag, index) =>
        flagRow(flag, flagId(flag, index), handlers.onFlagClick, handlers.onFlagHover),
      ),
    });

    return [
      section(plural(result.flags.length, 'flagged phrase', 'flagged phrases'), tally(result.flags)),
      section('In reading order', list),
    ];
  }

  function claimsSection(result: AnalyzeResponse): HTMLElement {
    const title = plural(result.claims.length, 'checkable claim', 'checkable claims');
    if (result.claims.length === 0) {
      return section(title, note('No checkable claims were extracted.'));
    }
    return section(title, ...result.claims.map(claimRow));
  }

  function groundingSection(result: AnalyzeResponse): HTMLElement[] {
    if (result.meta.flags_dropped === 0) return [];

    const dropped = plural(result.meta.flags_dropped, 'flag was', 'flags were');
    return [section('Grounding', note(`${dropped} dropped for not matching the article text.`))];
  }

  function render(result: AnalyzeResponse): void {
    const docType = displayDocType(result);
    title.textContent = DOC_TYPE_LABELS[docType];
    subtitle.textContent = docTypeSourceLabel(docType, result.doc_type_source);

    body.replaceChildren(
      ...flagSections(result),
      claimsSection(result),
      ...groundingSection(result),
    );
  }

  return {
    element,
    render,
    setHighlightsVisible(visible: boolean) {
      toggle.checked = visible;
    },
    setHotFlag(id: string | null) {
      for (const row of body.querySelectorAll('.bf-row[data-hot]')) {
        row.removeAttribute('data-hot');
      }
      if (!id) return;
      body.querySelector(`.bf-row[data-flag-id="${CSS.escape(id)}"]`)?.setAttribute('data-hot', '');
    },
  };
}
