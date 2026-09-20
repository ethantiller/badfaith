// Search other outlets for the same story. The request is user-triggered; the result is
// cached by the parent (keyed by doc_hash) so switching tabs never refires it.
import { useEffect, useState } from "react";
import type { CoverageResponse } from "../../types";
import { plural } from "../../ui/labels";
import { Dots } from "../Brand";

export type CoverageEntry =
  | { status: "loading" }
  | { status: "done"; data: CoverageResponse }
  | { status: "error"; message: string; retryable: boolean };

// Results already streamed in this session; a tab switch remounts the tab and must not replay.
const streamed = new Set<string>();

/** Reveals `text` word by word, like a streamed reply. Returns the visible text and whether it is done. */
function useStreamedText(
  text: string,
  key: string,
): { shown: string; done: boolean } {
  const reduced =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const skip = reduced || streamed.has(key);
  const words = text.split(/(\s+)/); // keeps whitespace, so paragraph breaks survive
  const [count, setCount] = useState(skip ? words.length : 0);

  useEffect(() => {
    if (skip) return;
    // One tick every 20ms; long summaries reveal more words a tick so it never exceeds 3s.
    const perTick = Math.max(1, Math.ceil((words.length * 20) / 3000));
    const timer = window.setInterval(() => {
      setCount((n) => {
        const next = Math.min(words.length, n + perTick);
        if (next >= words.length) {
          window.clearInterval(timer);
          streamed.add(key);
        }
        return next;
      });
    }, 20);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, text]);

  return { shown: words.slice(0, count).join(""), done: count >= words.length };
}

/** Only ever link out to a web page; a backend-supplied URL is still an input. */
function safeHref(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:"
      ? parsed.href
      : null;
  } catch {
    return null;
  }
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** Outlet favicon, falling back to the outlet's initial when it can't be fetched. */
function Favicon({
  url,
  outlet,
  size = 20,
}: {
  url: string;
  outlet: string;
  size?: number;
}) {
  const [failed, setFailed] = useState(false);
  const host = hostOf(url);
  const initial = (outlet.trim()[0] ?? "?").toUpperCase();
  const style = { width: size, height: size };
  if (!host || failed) {
    return (
      <span
        className="bf-favicon bf-favicon-fallback"
        style={style}
        aria-hidden="true"
      >
        {initial}
      </span>
    );
  }
  return (
    <img
      className="bf-favicon"
      style={style}
      src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  );
}

/** GDELT dates arrive as `20260114T093000Z`; anything else is shown as given. */
function formatSeen(raw: string): string {
  const match = /^(\d{4})(\d{2})(\d{2})/.exec(raw);
  if (!match) return raw;
  const date = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
  );
  return Number.isNaN(date.getTime())
    ? raw
    : date.toLocaleDateString(undefined, {
        dateStyle: "medium",
        timeZone: "UTC",
      });
}

export default function CoverageTab({
  entry,
  onSearch,
}: {
  entry: CoverageEntry | undefined;
  onSearch(): void;
}) {
  if (!entry || entry.status === "error") {
    return (
      <div className="bf-coverage-center">
        <p className="bf-lede">
          See how other outlets are covering this story and where their accounts
          differ.
        </p>
        {entry?.status === "error" && (
          <p className="bf-error" role="alert">
            {entry.message}
          </p>
        )}
        {(!entry || entry.retryable) && (
          <button
            type="button"
            className="bf-submit"
            data-bf-glow
            onClick={onSearch}
          >
            {entry ? "Try again" : "Search other outlets"}
          </button>
        )}
      </div>
    );
  }

  if (entry.status === "loading") {
    return (
      <div className="bf-coverage-center">
        <p className="bf-lede">Searching other outlets…</p>
        <Dots />
      </div>
    );
  }

  return <CoverageResult data={entry.data} />;
}

function CoverageResult({ data }: { data: CoverageResponse }) {
  const { summary, related, meta } = data;
  const { shown, done } = useStreamedText(summary, data.doc_hash);
  const paragraphs = shown
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  const stack = related.slice(0, 5);

  return (
    <>
      <section className="bf-section bf-coverage-card">
        <h3 className="bf-section-title">What other outlets are saying</h3>
        {summary.trim() === "" ? (
          <p className="bf-coverage-summary">No summary was returned.</p>
        ) : (
          paragraphs.map((text, i) => (
            <p key={i} className="bf-coverage-summary">
              {text}
            </p>
          ))
        )}
        {done && related.length > 0 && (
          <div className="bf-coverage-basis bf-reveal">
            <span className="bf-favicon-stack" aria-hidden="true">
              {stack.map((source) => (
                <Favicon
                  key={source.url}
                  url={source.url}
                  outlet={source.outlet}
                  size={18}
                />
              ))}
            </span>
            <span>
              Based on {plural(related.length, "article", "articles")}
            </span>
          </div>
        )}
      </section>

      {done && (
        <section className="bf-section bf-reveal">
          <h3 className="bf-section-title">
            Sources used
            {meta.sources_queried > related.length &&
              ` · ${meta.sources_queried} searched`}
          </h3>
          {related.length === 0 && (
            <p className="bf-empty">No other outlets turned up.</p>
          )}
          {related.map((source) => {
            const href = safeHref(source.url);
            const body = (
              <>
                <Favicon url={source.url} outlet={source.outlet} />
                <span className="bf-source-text">
                  <span className="bf-source-outlet">
                    {source.outlet}
                    {source.seendate && ` · ${formatSeen(source.seendate)}`}
                  </span>
                  <span className="bf-source-headline">{source.headline}</span>
                  {source.snippet && (
                    <span className="bf-source-snippet">{source.snippet}</span>
                  )}
                </span>
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
      )}
    </>
  );
}
