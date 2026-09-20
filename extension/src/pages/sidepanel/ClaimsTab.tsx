// Checkable claims with their quote, type, paragraph and entities. Clicking one scrolls
// the article to it; verification lives in the Coverage tab.
import { CLAIM_TYPE_LABELS, plural } from '../../ui/labels';
import type { AnalyzeResponse } from '../../types';

export default function ClaimsTab({
  result,
  onClaimClick,
}: {
  result: AnalyzeResponse;
  onClaimClick(id: string): void;
}) {
  const { claims } = result;

  return (
    <>
      <section className="bf-section">
        <h3 className="bf-section-title">
          {plural(claims.length, 'checkable claim', 'checkable claims')}
        </h3>
        {claims.length === 0 && <p className="bf-empty">No checkable claims were extracted.</p>}
      </section>

      {claims.map((claim) => (
        <button
          key={claim.id}
          type="button"
          className="bf-claim"
          data-claim-id={claim.id}
          onClick={() => onClaimClick(claim.id)}
        >
          <span className="bf-claim-quote">“{claim.quote}”</span>
          <span className="bf-claim-type">
            {CLAIM_TYPE_LABELS[claim.claim_type]}, paragraph {claim.paragraph_id + 1}
          </span>
          {claim.entities.length > 0 && (
            <span className="bf-entities">
              {claim.entities.map((entity) => (
                <span key={entity} className="bf-entity">
                  {entity}
                </span>
              ))}
            </span>
          )}
        </button>
      ))}
    </>
  );
}
