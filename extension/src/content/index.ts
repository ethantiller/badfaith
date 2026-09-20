// Runs inside the news page. It puts nothing on screen until the user clicks Analyze
// in the side panel: on an ordinary page this script only answers a status question.
// It holds no token and never calls the backend directly.
import { detectOpinionPiece } from '../article/detect_opinion_piece';
import { paragraphHash } from '../article/doc_hash';
import {
  applyCitations,
  applyClaims,
  applyFlags,
  applyRewrites,
  restoreRewrites,
  citationHighlightCount,
  claimHighlightCount,
  clearHighlights,
  flagId,
  focusCitation,
  focusClaim,
  focusFlag,
  highlightCount,
  setFlagHot,
  setHighlightsVisible,
} from '../article/highlight';
import { parseParagraphs } from '../article/paragraph_parser';
import { broadcast, isOwnMessage, sendToBackground } from '../messaging';
import { describeError, isRetryable } from '../messaging/errors';
import { displayDocType } from '../ui/labels';
import type {
  AnalyzeResponse,
  BgResult,
  Citation,
  Flag,
  PageState,
  PageStatus,
  Rewrite,
  RewriteItem,
  RewriteResponse,
  RewriteView,
  TabRequest,
} from '../types';
import { wireHighlightHover } from './hover';
import { createSurface, type Surface } from './surface';
import { createWatcher } from './watcher';

interface PhaseDetail {
  message?: string;
  retryable?: boolean;
}

const state = {
  phase: 'idle' as PageState,
  detail: {} as PhaseDetail,
  surface: null as Surface | null,
  nodeMap: new Map<number, HTMLElement>(),
  flagsById: new Map<string, Flag>(),
  citationsById: new Map<string, Citation>(),
  result: null as AnalyzeResponse | null,
  hash: null as string | null,
  highlightsVisible: true,
  rewrites: null as Rewrite[] | null,
  rewriteView: 'before' as RewriteView,
};

const watcher = createWatcher(checkForChanges);

// --- Rendering ---

function setPhase(phase: PageState, detail: PhaseDetail = {}): void {
  state.phase = phase;
  state.detail = detail;
}

function surface(): Surface {
  if (state.surface) return state.surface;
  state.surface = createSurface();
  return state.surface;
}

function toggleHighlights(visible: boolean): void {
  state.highlightsVisible = visible;
  setHighlightsVisible(visible);
}

function showingRewrite(): boolean {
  return state.rewriteView === 'after' && state.rewrites !== null && state.result !== null;
}

function setRewriteView(view: RewriteView): void {
  state.rewriteView = view;
  watcher.silently(() => {
    restoreRewrites();
    if (showingRewrite()) applyRewrites(state.rewrites!, state.result!.flags);
  });
}

/**
 * Runs `read` against the article's own wording. Hashing and quote matching are keyed to
 * the original text, so a rewrite showing on the page must not leak into them.
 */
function withOriginalText<T>(read: () => T): T {
  if (!showingRewrite()) return read();
  watcher.silently(restoreRewrites);
  try {
    return read();
  } finally {
    watcher.silently(() => applyRewrites(state.rewrites!, state.result!.flags));
  }
}

/** Puts the page back exactly as it was found. */
function teardown(): void {
  watcher.silently(clearHighlights);
  watcher.stop();

  state.surface?.destroy();
  state.surface = null;
  state.flagsById = new Map();
  state.citationsById = new Map();
  state.result = null;
  state.hash = null;
  state.highlightsVisible = true;
  state.rewrites = null;
  state.rewriteView = 'before';
  state.phase = 'idle';
}

function renderResult(result: AnalyzeResponse): void {
  surface();
  state.flagsById = new Map(result.flags.map((flag, index) => [flagId(flag, index), flag]));
  state.citationsById = new Map((result.citations ?? []).map((citation) => [citation.id, citation]));

  watcher.silently(() => {
    clearHighlights();
    applyFlags(result.flags, state.nodeMap);
    applyClaims(result.claims, state.nodeMap);
    applyCitations(result.citations ?? [], state.nodeMap);
    setHighlightsVisible(state.highlightsVisible);
    if (showingRewrite()) applyRewrites(state.rewrites!, result.flags);
  });

  setPhase('done');
}

// --- Analysis ---

async function runAnalysis(): Promise<PageStatus> {
  const parsed = withOriginalText(() => parseParagraphs(document));
  if (!parsed.foundArticleContainer || parsed.paragraphs.length === 0) return status();

  state.nodeMap = parsed.nodeMap;
  const hash = paragraphHash(parsed.paragraphs);

  // Same content as last time: re-render what we already have, send nothing.
  if (state.result && state.hash === hash) {
    renderResult(state.result);
    return status();
  }

  surface();
  setPhase('loading');
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
      message: describeError(response),
      retryable: isRetryable(response.code),
    });
    return status();
  }

  state.result = response.data;
  state.hash = hash;
  // A new analysis has new flags; the old rewrites no longer line up with them.
  state.rewrites = null;
  state.rewriteView = 'before';
  renderResult(response.data);
  return status();
}

/** Rewrites the flagged passages of the analyzed article; the paragraph text lives here. */
async function runRewrite(): Promise<BgResult<RewriteResponse>> {
  const result = state.result;
  if (!result || state.hash === null) {
    return { ok: false, code: 'invalid_request', message: 'Analyze the article first.' };
  }

  const parsed = withOriginalText(() => parseParagraphs(document));
  const text = new Map(parsed.paragraphs.map((p) => [p.id, p.text]));
  const items: RewriteItem[] = [];
  for (const flag of result.flags) {
    const paragraph = text.get(flag.paragraph_id);
    if (paragraph === undefined || !paragraph.includes(flag.quote)) continue;
    items.push({
      paragraph_id: flag.paragraph_id,
      text: paragraph,
      quote: flag.quote,
      technique: flag.technique,
      explanation: flag.explanation,
    });
  }

  const response = await sendToBackground<RewriteResponse>({
    kind: 'REWRITE_REQUEST',
    payload: { doc_hash: result.meta.doc_hash, title: document.title, items },
  });

  // Show the neutral wording straight away; the panel's toggle flips it back.
  if (response.ok && state.result === result) {
    state.rewrites = response.data.rewrites;
    setRewriteView('after');
  }
  return response;
}

function status(): PageStatus {
  const parsed = parseParagraphs(document);

  return {
    isArticle: parsed.foundArticleContainer && parsed.paragraphs.length > 0,
    paragraphs: parsed.paragraphs.length,
    title: document.title,
    state: state.phase,
    flags: state.result?.flags.length ?? 0,
    docType: state.result ? displayDocType(state.result) : null,
    message: state.phase === 'error' ? (state.detail.message ?? null) : null,
    result: state.result,
    highlightsVisible: state.highlightsVisible,
    rewriteReady: state.rewrites !== null && state.rewrites.length > 0,
    rewrites: state.rewrites,
    rewriteView: state.rewriteView,
  };
}

// --- Staleness ---

function checkForChanges(): void {
  if (!state.surface) return;
  state.surface.ensureMounted();

  const parsed = withOriginalText(() => parseParagraphs(document));
  if (!parsed.foundArticleContainer || parsed.paragraphs.length === 0) return;
  if (state.phase !== 'done' || !state.result) return;

  state.nodeMap = parsed.nodeMap;

  if (state.hash !== null && paragraphHash(parsed.paragraphs) !== state.hash) {
    setPhase('stale');
    return;
  }

  // The site re-rendered and took our wrappers with it; put them back.
  if (highlightCount() === 0) {
    const flags = state.result.flags;
    watcher.silently(() => {
      applyFlags(flags, state.nodeMap, false);
      setHighlightsVisible(state.highlightsVisible);
      if (showingRewrite()) applyRewrites(state.rewrites!, flags);
    });
  }

  // Independent from flags: the site may re-render one region and not the other.
  if (claimHighlightCount() === 0) {
    const claims = state.result.claims;
    watcher.silently(() => {
      applyClaims(claims, state.nodeMap, false);
      setHighlightsVisible(state.highlightsVisible);
    });
  }

  if (citationHighlightCount() === 0) {
    const citations = state.result.citations ?? [];
    watcher.silently(() => {
      applyCitations(citations, state.nodeMap, false);
      setHighlightsVisible(state.highlightsVisible);
    });
  }
}

// --- Entry point ---

wireHighlightHover({
  lookup: (kind, id) => {
    if (kind === 'citation') {
      const citation = state.citationsById.get(id);
      return citation ? { kind, citation } : undefined;
    }
    const flag = state.flagsById.get(id);
    return flag ? { kind, flag } : undefined;
  },
  show: (anchor, target) => {
    if (target.kind === 'citation') {
      state.surface?.tooltip.openCitation(anchor, target.citation);
      return;
    }
    state.surface?.tooltip.open(anchor, target.flag);
    broadcast({ kind: 'HOVER_FLAG', id: anchor.getAttribute('data-flag-id') });
  },
  hide: () => {
    state.surface?.tooltip.close();
    broadcast({ kind: 'HOVER_FLAG', id: null });
  },
  dismiss: () => {
    state.surface?.tooltip.closeNow();
    broadcast({ kind: 'HOVER_FLAG', id: null });
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

  if (message?.kind === 'SET_REWRITE_VIEW') {
    setRewriteView(message.view);
    sendResponse(status());
    return false;
  }

  if (message?.kind === 'RUN_REWRITE') {
    runRewrite().then(sendResponse, (error) =>
      sendResponse({ ok: false, code: 'network', message: String(error) }),
    );
    return true;
  }

  if (message?.kind === 'FOCUS_FLAG') {
    focusFlag(message.id);
    if (!state.highlightsVisible) toggleHighlights(true);
    return false;
  }

  if (message?.kind === 'FOCUS_REWRITE') {
    const flags = state.result?.flags ?? [];
    const index = flags.findIndex(
      (flag) => flag.paragraph_id === message.paragraph_id && flag.quote === message.original,
    );
    if (index >= 0) {
      focusFlag(flagId(flags[index], index));
      if (!state.highlightsVisible) toggleHighlights(true);
    }
    return false;
  }

  if (message?.kind === 'FOCUS_CLAIM') {
    focusClaim(message.id);
    if (!state.highlightsVisible) toggleHighlights(true);
    return false;
  }

  if (message?.kind === 'FOCUS_CITATION') {
    focusCitation(message.id);
    if (!state.highlightsVisible) toggleHighlights(true);
    return false;
  }

  if (message?.kind === 'SET_HOT_FLAG') {
    watcher.silently(() => setFlagHot(message.id));
    return false;
  }

  if (message?.kind === 'TOGGLE_HIGHLIGHTS') {
    toggleHighlights(message.visible);
    return false;
  }

  if (message?.kind === 'CLEAR') {
    teardown();
    return false;
  }

  return false;
});

