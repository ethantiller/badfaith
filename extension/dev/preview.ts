// Dev-only harness. Renders a fake article and drives the real UI modules so the
// injected surfaces can be reviewed in a plain browser tab, without loading the
// extension. Not part of dist/ and never shipped.
import { applyFlags, ensureHighlightStyles, flagId, focusFlag, setHighlightsVisible } from '../src/article/highlight';
import { parseParagraphs } from '../src/article/paragraph_parser';
import { createCard } from '../src/ui/card';
import { createHost } from '../src/ui/host';
import { createBadge } from '../src/ui/badge';
import { createTooltip } from '../src/ui/tooltip';
import type { AnalyzeResponse, Flag, PageState, Paragraph } from '../src/types';

// A fixed fixture, not a mock analyzer: this harness exists to look at the UI, so the
// content is hand-picked to exercise every state. Quotes are taken verbatim out of the
// paragraphs the parser produces, exactly as a grounded response would be.
const FIXTURE: Array<{ words: [number, number]; technique: Flag['technique']; severity: Flag['severity']; confidence: number; explanation: string }> = [
  { words: [8, 20], technique: 'loaded_language', severity: 'medium', confidence: 0.82,
    explanation: 'The wording carries a judgement the surrounding reporting has not established. A neutral phrasing would describe the same fact without the charge.' },
  { words: [4, 14], technique: 'exaggeration_minimization', severity: 'high', confidence: 0.91,
    explanation: 'The scale here is overstated relative to what the article reports elsewhere. Readers take the intensity as fact.' },
  { words: [12, 22], technique: 'doubt', severity: 'low', confidence: 0.58,
    explanation: 'This raises suspicion about a source without offering a reason to doubt them. The question stands in for a finding.' },
  { words: [0, 9], technique: 'thought_terminating_cliche', severity: 'medium', confidence: 0.74,
    explanation: 'This is a stock phrase that closes the question rather than answering it.' },
  { words: [6, 18], technique: 'flag_waving', severity: 'high', confidence: 0.88,
    explanation: 'National or group identity is invoked to carry the argument, in place of the argument itself.' },
  { words: [3, 12], technique: 'appeal_to_authority', severity: 'low', confidence: 0.63,
    explanation: 'A position is supported by who holds it rather than by the evidence behind it.' },
];

function quote(paragraph: Paragraph, from: number, to: number): string {
  return paragraph.text.split(' ').slice(from, to).join(' ');
}

function fixtureResponse(paragraphs: Paragraph[]): AnalyzeResponse {
  const flags: Flag[] = [];

  FIXTURE.forEach((entry, index) => {
    const paragraph = paragraphs[index];
    if (!paragraph) return;
    const text = quote(paragraph, entry.words[0], entry.words[1]);
    if (!text) return;

    flags.push({
      paragraph_id: paragraph.id,
      quote: text,
      technique: entry.technique,
      severity: entry.severity,
      confidence: entry.confidence,
      explanation: entry.explanation,
    });
  });

  return {
    doc_type: 'news',
    doc_type_source: 'model',
    flags,
    claims: paragraphs.slice(2, 4).map((paragraph, index) => ({
      id: `c${index}`,
      paragraph_id: paragraph.id,
      quote: quote(paragraph, 0, 11),
      claim_type: index === 0 ? 'statistic' : 'attributed_quote',
      entities: ['Senate', 'March'],
    })),
    meta: { cached: false, doc_hash: '', model_route: 'preview', latency_ms: 740, flags_dropped: 1 },
  };
}

const host = createHost();
const tooltip = createTooltip();
let card: ReturnType<typeof createCard>;
let flagsById = new Map<string, Flag>();
let result: AnalyzeResponse | null = null;
let visible = true;

const badge = createBadge(() => {
  if (result) show(!open);
  else void run();
});

let open = false;
function show(next: boolean) {
  open = next;
  if (next && card) host.dock.prepend(card.element);
  else card?.element.remove();
}

card = createCard({
  onClose: () => show(false),
  onFlagClick: (id) => focusFlag(id),
  onToggleHighlights: (next) => {
    visible = next;
    setHighlightsVisible(next);
  },
  onClear: () => {
    location.reload();
  },
});

function render(state: PageState, detail = {}) {
  badge.render(state, detail);
}

async function run() {
  render('loading');
  const parsed = parseParagraphs(document);
  await new Promise((resolve) => setTimeout(resolve, 700));
  const response = fixtureResponse(parsed.paragraphs);

  result = response;
  flagsById = new Map(response.flags.map((flag, index) => [flagId(flag, index), flag]));
  applyFlags(response.flags, parsed.nodeMap);
  setHighlightsVisible(visible);
  card.render(response);
  render('done', { result: response });
  show(true);
}

document.addEventListener('pointerover', (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const element = target.closest('span[data-badfaith="flag"]');
  const flag = element && flagsById.get(element.getAttribute('data-flag-id') ?? '');
  if (element && flag) tooltip.open(element, flag);
});

document.addEventListener('pointerout', (event) => {
  const target = event.target;
  if (target instanceof Element && target.closest('span[data-badfaith="flag"]')) tooltip.close();
});

host.dock.append(badge.element, tooltip.element);
host.ensureMounted();
ensureHighlightStyles();
// The badge only exists after an analysis, so the harness starts one straight away.
// States it can jump to instead, for reviewing without a round trip.
const jump = new URLSearchParams(location.search).get('state');
if (jump === 'loading') render('loading');
else if (jump === 'stale') render('stale');
else if (jump === 'error')
  render('error', { message: 'Too many requests. Try again later.', retryable: false });
else void run();
