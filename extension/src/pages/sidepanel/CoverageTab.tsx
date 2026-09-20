// Search other outlets for the same story. The request is user-triggered; the result is
// cached by the parent (keyed by doc_hash) so switching tabs never refires it.
import type { CoverageResponse } from '../../types';
import { plural } from '../../ui/labels';
import { Dots } from '../Brand';

export type CoverageEntry =
  | { status: 'loading' }
  | { status: 'done'; data: CoverageResponse }
  | { status: 'error'; message: string; retryable: boolean };

/** Only ever link out to a web page; a backend-supplied URL is still an input. */
function safeHref(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : null;
  } catch {
    return null;
  }
}

/** GDELT dates arrive as `20260114T093000Z`; anything else is shown as given. */
function formatSeen(raw: string): string {
  const match = /^(\d{4})(\d{2})(\d{2})/.exec(raw);
  if (!match) return raw;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return Number.isNaN(date.getTime())
    ? raw
    : date.toLocaleDateString(undefined, { dateStyle: 'medium', timeZone: 'UTC' });
}

export default function CoverageTab({
  entry,
  onSearch,
}: {
  entry: CoverageEntry | undefined;
  onSearch(): void;
}) {
  if (!entry || entry.status === 'error') {
    return (
      <div className="bf-coverage-center">
        <p className="bf-lede">
          See how other outlets are covering this story and where their accounts differ.
        </p>
        {entry?.status === 'error' && (
          <p className="bf-error" role="alert">
            {entry.message}
          </p>
        )}
        {(!entry || entry.retryable) && (
          <button type="button" className="bf-submit" data-bf-glow onClick={onSearch}>
            {entry ? 'Try again' : 'Search other outlets'}
          </button>
        )}
      </div>
    );
  }

  if (entry.status === 'loading') {
    return (
      <div className="bf-coverage-center">
        <p className="bf-lede">Searching other outlets…</p>
        <Dots />
      </div>
    );
  }

  const { summary, related, meta } = entry.data;

  return (
    <>
      <section className="bf-section">
        <h3 className="bf-section-title">Coverage</h3>
        <p className="bf-coverage-summary">{summary || 'No summary was returned.'}</p>
      </section>

      <section className="bf-section">
        <h3 className="bf-section-title">
          {plural(related.length, 'related source', 'related sources')}
          {meta.sources_queried > 0 && ` · ${meta.sources_queried} searched`}
        </h3>
        {related.length === 0 && <p className="bf-empty">No other outlets turned up.</p>}
        {related.map((source) => {
          const href = safeHref(source.url);
          const body = (
            <>
              <span className="bf-source-outlet">
                {source.outlet}
                {source.seendate && ` · ${formatSeen(source.seendate)}`}
              </span>
              <span className="bf-source-headline">{source.headline}</span>
              {source.snippet && <span className="bf-source-snippet">{source.snippet}</span>}
            </>
          );
          return href ? (
            <a
              key={source.url}
              className="bf-source"
              href={href}
              target="_blank"
              rel="noopener noreferrer"
            >
              {body}
            </a>
          ) : (
            <div key={source.url} className="bf-source">
              {body}
            </div>
          );
        })}
      </section>
    </>
  );
}
