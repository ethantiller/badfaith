// The extension's only screen: sign in, sign out, Analyze, and the report for whichever
// tab is on screen. The panel stays open across tab switches, so it has to track which
// tab it is currently showing itself.
import { useEffect, useRef, useState } from 'react';
import { isOwnMessage, sendToBackground, sendToTab } from '../../messaging';
import { describeError, isRetryable } from '../../messaging/errors';
import { plural } from '../../ui/labels';
import type {
  AuthState,
  Claim,
  CoverageResponse,
  HoverBroadcast,
  PageStatus,
  TabRequest,
} from '../../types';
import { Brand, Dots } from '../Brand';
import AuthForm from './AuthForm';
import type { CoverageEntry } from './CoverageTab';
import Report from './Report';

function hasReport(page: PageStatus | null): page is PageStatus & { result: NonNullable<PageStatus['result']> } {
  return page !== null && page.result !== null && (page.state === 'done' || page.state === 'stale');
}

/**
 * Claim entities, most-mentioned first. The request contract keeps only the first
 * MAX_ENTITIES, so ordering decides which ones drive the coverage search.
 */
function rankEntities(claims: Claim[]): string[] {
  const counts = new Map<string, { name: string; count: number }>();
  for (const claim of claims) {
    for (const raw of claim.entities) {
      const name = raw.trim();
      if (!name) continue;
      const key = name.toLowerCase();
      const seen = counts.get(key);
      if (seen) seen.count += 1;
      else counts.set(key, { name, count: 1 });
    }
  }
  // Array.sort is stable, so ties keep article order.
  return [...counts.values()].sort((a, b) => b.count - a.count).map((e) => e.name);
}

export default function SidePanel() {
  const [ready, setReady] = useState(false);
  const [account, setAccount] = useState<AuthState>({ signedIn: false, email: null });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [page, setPage] = useState<PageStatus | null>(null);
  const [tabId, setTabId] = useState<number | null>(null);
  const [busyTabs, setBusyTabs] = useState<ReadonlySet<number>>(new Set());
  const [leaving, setLeaving] = useState(false);
  const [hotFlag, setHotFlag] = useState<string | null>(null);
  const [coverage, setCoverage] = useState<Record<string, CoverageEntry>>({});

  // The tab the panel is currently reporting on. A ref as well as state, because the
  // tab-tracking listeners close over it once and must always see the latest value.
  const currentTabId = useRef<number | null>(null);

  function focusTab(id: number | null): void {
    currentTabId.current = id;
    setTabId(id);
    setHotFlag(null);
    setLeaving(false);
  }

  function toTab(message: TabRequest): void {
    const id = currentTabId.current;
    if (id !== null) void sendToTab(id, message);
  }

  useEffect(() => {
    void sendToBackground<AuthState>({ kind: 'AUTH_STATUS' }).then((response) => {
      if (response.ok) setAccount(response.data);
      setReady(true);
    });
  }, []);

  // Rehydrates from whichever tab is on screen rather than caching results locally:
  // the content script is the source of truth for its own tab's analysis state.
  useEffect(() => {
    async function refresh(id: number) {
      const status = await sendToTab(id, { kind: 'PAGE_STATUS' });
      if (currentTabId.current === id) setPage(status);
    }

    let ownWindowId: number | undefined;

    void (async () => {
      const win = await chrome.windows.getCurrent();
      ownWindowId = win.id;
      const [tab] = await chrome.tabs.query({ active: true, windowId: ownWindowId });
      if (tab?.id === undefined) return;
      focusTab(tab.id);
      void refresh(tab.id);
    })();

    function onActivated(info: chrome.tabs.TabActiveInfo): void {
      if (ownWindowId !== undefined && info.windowId !== ownWindowId) return;
      focusTab(info.tabId);
      void refresh(info.tabId);
    }

    function onUpdated(id: number, changeInfo: chrome.tabs.TabChangeInfo): void {
      if (id !== currentTabId.current || changeInfo.status !== 'complete') return;
      void refresh(id);
    }

    function onRemoved(id: number): void {
      if (id !== currentTabId.current) return;
      focusTab(null);
      setPage(null);
    }

    chrome.tabs.onActivated.addListener(onActivated);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);
    return () => {
      chrome.tabs.onActivated.removeListener(onActivated);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
    };
  }, []);

  // Hovering a phrase in the article lights the matching row in here; the reverse
  // (hovering a row) goes out through `onFlagHover` below.
  useEffect(() => {
    function onMessage(message: HoverBroadcast, sender: chrome.runtime.MessageSender): void {
      if (!isOwnMessage(sender)) return;
      if (message?.kind !== 'HOVER_FLAG' || sender.tab?.id !== currentTabId.current) return;
      setHotFlag(message.id);
    }

    chrome.runtime.onMessage.addListener(onMessage);
    return () => chrome.runtime.onMessage.removeListener(onMessage);
  }, []);

  async function onSignOut() {
    setBusy(true);
    setError('');
    const response = await sendToBackground({ kind: 'AUTH_SIGN_OUT' });
    setBusy(false);

    if (!response.ok) {
      setError(response.message);
      return;
    }

    setAccount({ signedIn: false, email: null });
  }

  async function runAnalyze() {
    const id = currentTabId.current;
    if (id === null) return;

    setBusyTabs((prev) => new Set(prev).add(id));
    const status = await sendToTab(id, { kind: 'RUN_ANALYZE' });
    setBusyTabs((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    // The panel may be looking at a different tab by the time this resolves.
    if (currentTabId.current === id) setPage(status);
  }

  // The idle button fades away first; only once it has actually gone does the busy
  // state take its place (see onTransitionEnd below).
  function onButtonLeft(event: React.TransitionEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget || event.propertyName !== 'opacity') return;
    if (!leaving) return;
    setLeaving(false);
    void runAnalyze();
  }

  function onClear() {
    toTab({ kind: 'CLEAR' });
    setHotFlag(null);
    setPage((prev) =>
      prev
        ? {
            ...prev,
            result: null,
            state: 'idle',
            flags: 0,
            docType: null,
            message: null,
            highlightsVisible: true,
          }
        : prev,
    );
  }

  function onToggleHighlights(visible: boolean) {
    toTab({ kind: 'TOGGLE_HIGHLIGHTS', visible });
    setPage((prev) => (prev ? { ...prev, highlightsVisible: visible } : prev));
  }

  async function searchCoverage() {
    if (!hasReport(page)) return;
    const { result, title } = page;
    const hash = result.meta.doc_hash;

    setCoverage((prev) => ({ ...prev, [hash]: { status: 'loading' } }));
    const response = await sendToBackground<CoverageResponse>({
      kind: 'COVERAGE_REQUEST',
      payload: {
        doc_hash: hash,
        entities: rankEntities(result.claims),
        title,
      },
    });

    const entry: CoverageEntry = response.ok
      ? { status: 'done', data: response.data }
      : { status: 'error', message: describeError(response), retryable: isRetryable(response.code) };
    setCoverage((prev) => ({ ...prev, [hash]: entry }));
  }

  if (!ready) {
    return (
      <main className="bf-page bf-sidepanel">
        <Brand />
        <div className="bf-stage">
          <p className="bf-lede">Checking your account…</p>
        </div>
        <div />
      </main>
    );
  }

  if (!account.signedIn) {
    return (
      <main className="bf-page bf-sidepanel">
        <Brand />
        <div className="bf-stage">
          <AuthForm onSignedIn={setAccount} />
        </div>
        <div />
      </main>
    );
  }

  const analyzing = (tabId !== null && busyTabs.has(tabId)) || page?.state === 'loading';

  return (
    <main className="bf-page bf-sidepanel">
      <Brand />

      <div className="bf-stage" data-fill={hasReport(page) && !analyzing ? '' : undefined}>
        <Stage
          page={page}
          analyzing={analyzing}
          leaving={leaving}
          hotFlag={hotFlag}
          coverage={hasReport(page) ? coverage[page.result.meta.doc_hash] : undefined}
          onAnalyzeClick={() => setLeaving(true)}
          onButtonLeft={onButtonLeft}
          onAnalyze={() => void runAnalyze()}
          onFlagClick={(id) => toTab({ kind: 'FOCUS_FLAG', id })}
          onFlagHover={(id) => {
            setHotFlag(id);
            toTab({ kind: 'SET_HOT_FLAG', id });
          }}
          onClaimClick={(id) => toTab({ kind: 'FOCUS_CLAIM', id })}
          onToggleHighlights={onToggleHighlights}
          onClear={onClear}
          onSearchCoverage={() => void searchCoverage()}
        />
      </div>

      <div className="bf-footer">
        <div className="bf-account">
          <strong>{account.email ?? 'Signed in'}</strong>
        </div>
        {error && (
          <p className="bf-error" role="alert">
            {error}
          </p>
        )}
        <button type="button" className="bf-secondary" data-bf-glow onClick={onSignOut} disabled={busy}>
          {busy ? 'Signing out…' : 'Sign out'}
        </button>
      </div>
    </main>
  );
}

interface StageProps {
  page: PageStatus | null;
  analyzing: boolean;
  leaving: boolean;
  hotFlag: string | null;
  coverage: CoverageEntry | undefined;
  onAnalyzeClick(): void;
  onButtonLeft(event: React.TransitionEvent<HTMLDivElement>): void;
  onAnalyze(): void;
  onFlagClick(id: string): void;
  onFlagHover(id: string | null): void;
  onClaimClick(id: string): void;
  onToggleHighlights(visible: boolean): void;
  onClear(): void;
  onSearchCoverage(): void;
}

const PROGRESS_STEPS = [
  'Reading the article…',
  'Looking for loaded language…',
  'Checking for rhetorical techniques…',
  'Extracting checkable claims…',
  'Verifying quotes against the text…',
  'Doing some finishing touches…',
];

// A pacing indicator, not a measurement: the backend reports no progress, so the bar
// eases toward 94% and holds there until the real result replaces it.
function FakeProgress() {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const started = Date.now();
    const timer = window.setInterval(() => setElapsed(Date.now() - started), 250);
    return () => window.clearInterval(timer);
  }, []);

  const percent = 94 * (1 - Math.exp(-elapsed / 12000));
  const step = Math.min(PROGRESS_STEPS.length - 1, Math.floor(percent / 16));

  return (
    <div className="bf-progress">
      <div
        className="bf-progress-track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(percent)}
      >
        <div className="bf-progress-fill" style={{ width: `${percent}%` }} />
      </div>
      <p className="bf-progress-label">{PROGRESS_STEPS[step]}</p>
    </div>
  );
}

// Whatever fills the stage for the current tab: unreadable page, no article, the idle
// button, the busy dots, or the finished report.
function Stage(props: StageProps) {
  const { page, analyzing } = props;

  if (page === null) {
    return <p className="bf-lede">Bad Faith cannot read this page.</p>;
  }

  if (!page.isArticle) {
    return (
      <p className="bf-lede">
        No article text here. Open a news story and the button will light up.
      </p>
    );
  }

  // A re-run keeps the old report on screen (the head shows a spinner) rather than
  // replacing it with dots.
  if (analyzing && !hasReport(page)) {
    return (
      <div className="bf-busy" role="status">
        <p className="bf-lede bf-busy-status">Analyzing this article…</p>
        <div className="bf-busy-dots">
          <Dots />
          <FakeProgress />
        </div>
      </div>
    );
  }

  if (hasReport(page)) {
    return (
      <Report
        page={page}
        analyzing={analyzing}
        hotFlag={props.hotFlag}
        coverage={props.coverage}
        onAnalyze={props.onAnalyze}
        onFlagClick={props.onFlagClick}
        onFlagHover={props.onFlagHover}
        onClaimClick={props.onClaimClick}
        onToggleHighlights={props.onToggleHighlights}
        onClear={props.onClear}
        onSearchCoverage={props.onSearchCoverage}
      />
    );
  }

  return (
    <div className="bf-stage-panel">
      <p className="bf-lede">{plural(page.paragraphs, 'paragraph', 'paragraphs')} ready to read.</p>

      {page.state === 'error' && page.message && (
        <p className="bf-error" role="alert">
          {page.message}
        </p>
      )}

      <div
        className="bf-analyze-cta"
        data-leaving={props.leaving ? '' : undefined}
        onTransitionEnd={props.onButtonLeft}
      >
        <button type="button" className="bf-submit" data-bf-glow onClick={props.onAnalyzeClick}>
          Analyze this article
        </button>
      </div>
    </div>
  );
}
