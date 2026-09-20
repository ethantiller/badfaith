// The Claims tab has two views over the same article: checkable claims (with their quote,
// type, paragraph and entities) and quoted sources (who said each quote, and what kind of
// source they are). Clicking either scrolls the article to it; verification lives in the
// Coverage tab.
import { useState } from 'react';
import { CLAIM_TYPE_LABELS, SPEAKER_ROLE_LABELS, SPEAKER_ROLE_NOTES, plural } from '../../ui/labels';
import type { AnalyzeResponse } from '../../types';

type View = 'claims' | 'citations';

export default function ClaimsTab({
  result,
  onClaimClick,
  onCitationClick,
}: {
  result: AnalyzeResponse;
  onClaimClick(id: string): void;
  onCitationClick(id: string): void;
}) {
  const { claims } = result;
  const citations = result.citations ?? [];
  const [view, setView] = useState<View>('claims');

  return (
    <>
      <div className="bf-subtabs" role="group" aria-label="Claims view">
        <button
          type="button"
          className="bf-subtab"
          aria-pressed={view === 'claims'}
          onClick={() => setView('claims')}
        >
          {plural(claims.length, 'checkable claim', 'checkable claims')}
        </button>
        <button
          type="button"
          className="bf-subtab"
          aria-pressed={view === 'citations'}
          onClick={() => setView('citations')}
        >
          {plural(citations.length, 'citation', 'citations')}
        </button>
      </div>

      {view === 'claims' && (
        <>
          {claims.length === 0 && (
            <p className="bf-empty">No checkable claims were extracted.</p>
          )}
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
      )}

      {view === 'citations' && (
        <>
          {citations.length === 0 && (
            <p className="bf-empty">No quoted sources were found in this article.</p>
          )}
          {citations.map((citation) => (
            <button
              key={citation.id}
              type="button"
              className="bf-claim bf-citation"
              data-citation-id={citation.id}
              onClick={() => onCitationClick(citation.id)}
            >
              <span className="bf-citation-head">
                <span className="bf-citation-speaker">{citation.speaker}</span>
                <span className="bf-role" data-role={citation.speaker_role}>
                  {SPEAKER_ROLE_LABELS[citation.speaker_role]}
                </span>
              </span>
              <span className="bf-claim-quote">“{citation.quote}”</span>
              <span className="bf-claim-type">Paragraph {citation.paragraph_id + 1}</span>
              <span className="bf-citation-note">{SPEAKER_ROLE_NOTES[citation.speaker_role]}</span>
            </button>
          ))}
        </>
      )}
    </>
  );
}
