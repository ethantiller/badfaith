// Neutral rewrites of the flagged passages. User-triggered; the result is cached by the
// parent (keyed by doc_hash) so switching tabs never refires it.
import type { Rewrite } from '../../types';
import { plural } from '../../ui/labels';
import { Dots } from '../Brand';

/** The request in flight or failed. A finished rewrite lives in the page, not here. */
export type RewriteRun =
  | { status: 'loading' }
  | { status: 'error'; message: string; retryable: boolean };

export default function RewriteTab({
  rewrites,
  run,
  onRewrite,
  onFocus,
}: {
  rewrites: Rewrite[] | null;
  run: RewriteRun | null;
  onRewrite(): void;
  onFocus(paragraphId: number, original: string): void;
}) {
  if (run?.status === 'loading') {
    return (
      <div className="bf-coverage-center">
        <p className="bf-lede">Rewriting flagged passages…</p>
        <Dots />
      </div>
    );
  }

  if (!rewrites) {
    return (
      <div className="bf-coverage-center">
        <p className="bf-lede">
          Rewrite the flagged, opinionated passages in plain, neutral language.
        </p>
        {run?.status === 'error' && (
          <p className="bf-error" role="alert">
            {run.message}
          </p>
        )}
        {(!run || run.retryable) && (
          <button type="button" className="bf-submit" data-bf-glow onClick={onRewrite}>
            {run ? 'Try again' : 'Neutral rewrite'}
          </button>
        )}
      </div>
    );
  }

  if (rewrites.length === 0) {
    return <p className="bf-empty">Nothing to rewrite.</p>;
  }

  return (
    <section className="bf-section">
      <h3 className="bf-section-title">
        Neutral rewrite · {plural(rewrites.length, 'passage', 'passages')}
      </h3>
      {rewrites.map((item, i) => (
        <button
          key={`${item.paragraph_id}-${i}`}
          type="button"
          className="bf-rewrite"
          onClick={() => onFocus(item.paragraph_id, item.original)}
        >
          <span className="bf-rewrite-original">{item.original}</span>
          <span className="bf-rewrite-neutral">{item.rewrite}</span>
        </button>
      ))}
    </section>
  );
}
