// Doc type, technique tally, and the flagged phrases in reading order.
import { flagId } from '../../article/highlight';
import { TECHNIQUE_LABELS, SEVERITY_LABELS, plural } from '../../ui/labels';
import type { AnalyzeResponse, Flag, Technique } from '../../types';

interface Props {
  result: AnalyzeResponse;
  hotFlag: string | null;
  onFlagClick(id: string): void;
  /** The pointer entered a row, or left every row (null). */
  onFlagHover(id: string | null): void;
}

function Tally({ flags }: { flags: Flag[] }) {
  const counts = new Map<Technique, number>();
  for (const flag of flags) counts.set(flag.technique, (counts.get(flag.technique) ?? 0) + 1);

  return (
    <dl className="bf-tally">
      {[...counts]
        .sort((a, b) => b[1] - a[1])
        .map(([technique, count]) => (
          <div key={technique} style={{ display: 'contents' }}>
            <dt>{TECHNIQUE_LABELS[technique]}</dt>
            <dd>{count}</dd>
          </div>
        ))}
    </dl>
  );
}

export default function SummaryTab({ result, hotFlag, onFlagClick, onFlagHover }: Props) {
  const { flags, meta } = result;

  if (flags.length === 0) {
    return (
      <section className="bf-section">
        <h3 className="bf-section-title">Flagged phrases</h3>
        <p className="bf-empty">No flagged phrases in this article.</p>
      </section>
    );
  }

  return (
    <>
      <section className="bf-section">
        <h3 className="bf-section-title">
          {plural(flags.length, 'flagged phrase', 'flagged phrases')}
        </h3>
        <Tally flags={flags} />
      </section>

      <section className="bf-section">
        <h3 className="bf-section-title">In reading order</h3>
        <ul className="bf-list">
          {flags.map((flag, index) => {
            const id = flagId(flag, index);
            return (
              <li key={id}>
                <button
                  type="button"
                  className="bf-row"
                  data-flag-id={id}
                  data-hot={hotFlag === id ? '' : undefined}
                  onClick={() => onFlagClick(id)}
                  onPointerEnter={() => onFlagHover(id)}
                  onPointerLeave={() => onFlagHover(null)}
                  onFocus={() => onFlagHover(id)}
                  onBlur={() => onFlagHover(null)}
                >
                  <span className="bf-row-index">{flag.paragraph_id + 1}</span>
                  <span className="bf-row-main">
                    <span className="bf-row-technique">
                      <span className="bf-row-name">{TECHNIQUE_LABELS[flag.technique]}</span>
                      <span className="bf-chip" data-severity={flag.severity}>
                        {SEVERITY_LABELS[flag.severity]}
                      </span>
                    </span>
                    <span className="bf-row-quote">“{flag.quote}”</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      {meta.flags_dropped > 0 && (
        <section className="bf-section">
          <h3 className="bf-section-title">Grounding</h3>
          <p className="bf-empty">
            {plural(meta.flags_dropped, 'flag was', 'flags were')} dropped for not matching the
            article text.
          </p>
        </section>
      )}
    </>
  );
}
