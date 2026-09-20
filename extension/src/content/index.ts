// Runs inside the news page. It puts nothing on screen until the user clicks Analyze
// in the popup: on an ordinary page this script only answers a status question. It
// holds no token and never calls the backend directly.
import { detectOpinionPiece } from '../article/detect_opinion_piece';
import { paragraphHash } from '../article/doc_hash';
import {
  applyFlags,
  clearHighlights,
  flagId,
  focusFlag,
  highlightCount,
  setFlagHot,
  setHighlightsVisible,
} from '../article/highlight';
import { parseParagraphs } from '../article/paragraph_parser';
import { isOwnMessage, sendToBackground } from '../messaging';
import { displayDocType } from '../ui/labels';
import type { BadgeDetail } from '../ui/badge';
import type { AnalyzeResponse, Flag, PageState, PageStatus, TabRequest } from '../types';
import { wireHighlightHover } from './hover';
import { createSurface, type Surface } from './surface';
import { createWatcher } from './watcher';

const ERROR_MESSAGES: Record<string, string> = {
  unauthenticated: 'Sign in from the extension icon.',
  rate_limited: 'Too many requests. Try again later.',
  network: 'Could not reach Bad Faith. Try again.',
  server: 'Bad Faith had a problem. Try again.',
};

/** Retrying these changes nothing, so the badge offers no retry. */
const FINAL_ERRORS = new Set(['rate_limited', 'unauthenticated', 'invalid_request']);

const state = {
  phase: 'idle' as PageState,
  detail: {} as BadgeDetail,
  surface: null as Surface | null,
  nodeMap: new Map<number, HTMLElement>(),
  flagsById: new Map<string, Flag>(),
  result: null as AnalyzeResponse | null,
  hash: null as string | null,
  highlightsVisible: true,
};

const watcher = createWatcher(checkForChanges);

// --- Rendering ---

function setPhase(phase: PageState, detail: BadgeDetail = {}): void {
  state.phase = phase;
  state.detail = detail;
  state.surface?.render(phase, detail);
}

function surface(): Surface {
  if (state.surface) return state.surface;

  state.surface = createSurface({
    onBadgeClick,
    onClose: () => state.surface?.showCard(false),
    onFlagClick: (id) => {
      focusFlag(id);
      if (!state.highlightsVisible) toggleHighlights(true);
    },
    // Pointing at a row in the report is the same act as pointing at the phrase.
    onFlagHover: (id) => watcher.silently(() => setFlagHot(id)),
    onToggleHighlights: toggleHighlights,
    onClear: teardown,
    onShowCoverageSearch: () => {
      const view = surface();
      view.card.showCoverageSearch(executeCoverageSearch);
    },
  });

  return state.surface;
}

async function executeCoverageSearch(): Promise<void> {
  const view = surface();
  if (!state.result) return;

  view.card.showCoverageLoading();

  const response = await sendToBackground<any>({
    kind: 'COVERAGE_REQUEST',
    payload: {
      doc_hash: state.result.meta.doc_hash,
      url: location.href,
      title: document.title,
    },
  });

  if (!response.ok) {
    console.error('Coverage search failed:', response.message);
    view.card.showResults();
    return;
  }

  // TODO: Display coverage results
  view.card.showResults();
}

function toggleHighlights(visible: boolean): void {
  state.highlightsVisible = visible;
  setHighlightsVisible(visible);
  state.surface?.card.setHighlightsVisible(visible);
}

/** Puts the page back exactly as it was found. */
function teardown(): void {
  watcher.silently(clearHighlights);
  watcher.stop();

  state.surface?.destroy();
  state.surface = null;
  state.flagsById = new Map();
  state.result = null;
  state.hash = null;
  state.highlightsVisible = true;
  state.phase = 'idle';
}

function renderResult(result: AnalyzeResponse, openCard: boolean): void {
  const view = surface();
  state.flagsById = new Map(result.flags.map((flag, index) => [flagId(flag, index), flag]));

  watcher.silently(() => {
    clearHighlights();
    applyFlags(result.flags, state.nodeMap);
    setHighlightsVisible(state.highlightsVisible);
  });

  view.card.render(result);
  view.card.setHighlightsVisible(state.highlightsVisible);
  setPhase('done', { result });
  if (openCard) view.showCard(true);
}

// --- Analysis ---

async function runAnalysis(): Promise<PageStatus> {
  const parsed = parseParagraphs(document);
  if (!parsed.foundArticleContainer || parsed.paragraphs.length === 0) return status();

  state.nodeMap = parsed.nodeMap;
  const hash = paragraphHash(parsed.paragraphs);

  // Same content as last time: re-render what we already have, send nothing.
  if (state.result && state.hash === hash) {
    renderResult(state.result, true);
    return status();
  }

  surface();
  setPhase('loading');
  state.surface?.showCard(false);
  watcher.start();

  const response = await sendToBackground<AnalyzeResponse>({
    kind: 'ANALYZE_REQUEST',
    payload: {
      url: location.href,
      title: document.title,
      section_hint: detectOpinionPiece(document, location.href),
      paragraphs: parsed.paragraphs,
    },
  });

  if (!response.ok) {
    setPhase('error', {
      // A contract failure names the offending field; a generic code does not.
      message:
        response.code === 'invalid_request'
          ? response.message
          : (ERROR_MESSAGES[response.code] ?? response.message),
      retryable: !FINAL_ERRORS.has(response.code),
    });
    return status();
  }

  state.result = response.data;
  state.hash = hash;
  renderResult(response.data, true);
  return status();
}

function onBadgeClick(event: MouseEvent): void {
  // A page script must never be able to spend model credits on the user's behalf.
  if (!event.isTrusted) return;

  if (state.phase === 'done') {
    state.surface?.showCard(!state.surface.cardOpen);
    return;
  }

  const retryable = state.phase === 'error' && state.detail.retryable !== false;
  if (state.phase === 'stale' || retryable) void runAnalysis();
}

function status(): PageStatus {
  const parsed = parseParagraphs(document);

  return {
    isArticle: parsed.foundArticleContainer && parsed.paragraphs.length > 0,
    paragraphs: parsed.paragraphs.length,
    state: state.phase,
    flags: state.result?.flags.length ?? 0,
    docType: state.result ? displayDocType(state.result) : null,
    message: state.phase === 'error' ? (state.detail.message ?? null) : null,
  };
}

// --- Staleness ---

function checkForChanges(): void {
  if (!state.surface) return;
  state.surface.ensureMounted();

  const parsed = parseParagraphs(document);
  if (!parsed.foundArticleContainer || parsed.paragraphs.length === 0) return;
  if (state.phase !== 'done' || !state.result) return;

  state.nodeMap = parsed.nodeMap;

  if (state.hash !== null && paragraphHash(parsed.paragraphs) !== state.hash) {
    setPhase('stale');
    state.surface.showCard(false);
    return;
  }

  // The site re-rendered and took our wrappers with it; put them back.
  if (highlightCount() === 0) {
    const flags = state.result.flags;
    watcher.silently(() => {
      applyFlags(flags, state.nodeMap, false);
      setHighlightsVisible(state.highlightsVisible);
    });
  }
}

// --- Entry point ---

wireHighlightHover({
  lookup: (id) => state.flagsById.get(id),
  show: (anchor, flag) => {
    state.surface?.tooltip.open(anchor, flag);
    state.surface?.card.setHotFlag(anchor.getAttribute('data-flag-id'));
  },
  hide: () => {
    state.surface?.tooltip.close();
    state.surface?.card.setHotFlag(null);
  },
  dismiss: () => {
    state.surface?.tooltip.closeNow();
    state.surface?.card.setHotFlag(null);
  },
});

chrome.runtime.onMessage.addListener((message: TabRequest, sender, sendResponse) => {
  if (!isOwnMessage(sender)) return false;

  if (message?.kind === 'PAGE_STATUS') {
    sendResponse(status());
    return false;
  }

  if (message?.kind === 'RUN_ANALYZE') {
    runAnalysis().then(sendResponse, () => sendResponse(status()));
    return true; // keep the port open for the async reply
  }

  return false;
});
