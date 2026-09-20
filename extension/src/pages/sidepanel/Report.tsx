// The analyzed report: a head with the doc type, four tabs, and a foot with the
// before/after wording switch. Tabs unmount when hidden; anything that must survive a
// tab switch (coverage) is cached by the parent.
import { useRef, useState } from 'react';
import { DOC_TYPE_LABELS, docTypeSourceLabel } from '../../ui/labels';
import type { PageStatus, RewriteView } from '../../types';
import ClaimsTab from './ClaimsTab';
import CoverageTab, { type CoverageEntry } from './CoverageTab';
import RewriteTab, { type RewriteRun } from './RewriteTab';
import SummaryTab from './SummaryTab';

const TABS = ['summary', 'claims', 'coverage', 'rewrite'] as const;
type TabId = (typeof TABS)[number];
const TAB_LABELS: Record<TabId, string> = {
  summary: 'Summary',
  claims: 'Claims',
  coverage: 'Coverage',
  rewrite: 'Rewrite',
};

interface Props {
  /** A page with a result; the parent guarantees it. */
  page: PageStatus;
  hotFlag: string | null;
  coverage: CoverageEntry | undefined;
  rewriteRun: RewriteRun | null;
  onFlagClick(id: string): void;
  onFlagHover(id: string | null): void;
  onClaimClick(id: string): void;
  onCitationClick(id: string): void;
  onToggleHighlights(visible: boolean): void;
  onRewriteView(view: RewriteView): void;
  onSearchCoverage(): void;
  onRewrite(): void;
  onRewriteClick(paragraphId: number, original: string): void;
}

export default function Report(props: Props) {
  const { page } = props;
  const result = page.result!;
  const [tab, setTab] = useState<TabId>('summary');
  const tabRefs = useRef<Record<TabId, HTMLButtonElement | null>>({
    summary: null,
    claims: null,
    coverage: null,
    rewrite: null,
  });

  const docType = page.docType ?? 'unknown';

  function onKeyDown(event: React.KeyboardEvent) {
    const index = TABS.indexOf(tab);
    const next =
      event.key === 'ArrowRight'
        ? (index + 1) % TABS.length
        : event.key === 'ArrowLeft'
          ? (index - 1 + TABS.length) % TABS.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? TABS.length - 1
              : -1;
    if (next < 0) return;

    event.preventDefault();
    setTab(TABS[next]);
    tabRefs.current[TABS[next]]?.focus();
  }

  return (
    <div className="bf-report">
      <header className="bf-report-head">
        <div className="bf-report-titles">
          <div>
            <h2 className="bf-report-title">{DOC_TYPE_LABELS[docType]}</h2>
            <p className="bf-report-sub">{docTypeSourceLabel(docType, result.doc_type_source)}</p>
          </div>
        </div>

        {page.state === 'stale' && <p className="bf-notice">The article changed since the last run.</p>}
        {page.state === 'error' && page.message && (
          <p className="bf-error" role="alert">
            {page.message}
          </p>
        )}
      </header>

      <div
        className="bf-tabs"
        role="tablist"
        aria-label="Report sections"
        style={{ ['--bf-tab-index' as string]: TABS.indexOf(tab), ['--bf-tab-count' as string]: TABS.length }}
        onKeyDown={onKeyDown}
      >
        {TABS.map((id) => (
          <button
            key={id}
            ref={(node) => {
              tabRefs.current[id] = node;
            }}
            type="button"
            role="tab"
            id={`bf-tab-${id}`}
            className="bf-tab-button"
            aria-selected={tab === id}
            aria-controls="bf-tabpanel"
            tabIndex={tab === id ? 0 : -1}
            onClick={() => setTab(id)}
          >
            {TAB_LABELS[id]}
          </button>
        ))}
      </div>

      <div
        className="bf-tabpanel"
        id="bf-tabpanel"
        role="tabpanel"
        aria-labelledby={`bf-tab-${tab}`}
        key={tab}
      >
        {tab === 'summary' && (
          <SummaryTab
            result={result}
            hotFlag={props.hotFlag}
            onFlagClick={props.onFlagClick}
            onFlagHover={props.onFlagHover}
          />
        )}
        {tab === 'claims' && (
          <ClaimsTab
            result={result}
            onClaimClick={props.onClaimClick}
            onCitationClick={props.onCitationClick}
          />
        )}
        {tab === 'coverage' && (
          <CoverageTab entry={props.coverage} onSearch={props.onSearchCoverage} />
        )}
        {tab === 'rewrite' && (
          <RewriteTab
            rewrites={page.rewrites}
            run={props.rewriteRun}
            onRewrite={props.onRewrite}
            onFocus={props.onRewriteClick}
          />
        )}
      </div>

      <footer className="bf-report-foot">
        <label className="bf-toggle">
          <input
            type="checkbox"
            checked={page.highlightsVisible}
            onChange={(event) => props.onToggleHighlights(event.target.checked)}
          />
          Show highlights
        </label>
        {page.rewriteReady && (
          <div
            className="bf-segmented"
            role="group"
            aria-label="Article wording"
          >
            {(['before', 'after'] as const).map((view) => (
              <button
                key={view}
                type="button"
                className="bf-segment"
                aria-pressed={page.rewriteView === view}
                onClick={() => props.onRewriteView(view)}
              >
                {view === 'before' ? 'Before' : 'After'}
              </button>
            ))}
          </div>
        )}
      </footer>
    </div>
  );
}
