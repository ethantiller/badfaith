// The extension's only own screen: getting signed in, and getting back out.
// No analysis results live here — those are injected into the article page.
import { useEffect, useRef, useState } from 'react';
import { sendToActiveTab, sendToBackground } from '../../messaging';
import { DOC_TYPE_LABELS, plural } from '../../ui/labels';
import type { AuthState, BgRequest, PageStatus } from '../../types';
import { Brand, Spinner } from '../Brand';

type View = 'signIn' | 'signUp' | 'forgot';

export default function Popup() {
  const [ready, setReady] = useState(false);
  const [account, setAccount] = useState<AuthState>({ signedIn: false, email: null });
  const [view, setView] = useState<View>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [ageVerified, setAgeVerified] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [page, setPage] = useState<PageStatus | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void sendToBackground<AuthState>({ kind: 'AUTH_STATUS' }).then((response) => {
      if (response.ok) setAccount(response.data);
      setReady(true);
    });
    void sendToActiveTab({ kind: 'PAGE_STATUS' }).then(setPage);
  }, []);

  useEffect(() => {
    if (ready && !account.signedIn) emailRef.current?.focus();
  }, [ready, account.signedIn]);

  function switchTo(next: View) {
    setView(next);
    setError('');
    setNotice('');
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');

    const message: BgRequest =
      view === 'signIn'
        ? { kind: 'AUTH_SIGN_IN', email, password }
        : view === 'signUp'
          ? { kind: 'AUTH_SIGN_UP', email, password, isAgeVerified: ageVerified }
          : { kind: 'AUTH_RESET', email };

    const response = await sendToBackground<AuthState & { needsConfirmation?: boolean }>(message);
    setBusy(false);

    if (!response.ok) {
      setError(response.message);
      return;
    }

    if (view === 'forgot') {
      setNotice(`Check ${email} for a link to set a new password.`);
      return;
    }

    if (response.data?.needsConfirmation) {
      setNotice(`Check ${email} to confirm your account, then sign in.`);
      setView('signIn');
      setPassword('');
      return;
    }

    setAccount({ signedIn: true, email: response.data?.email ?? email });
    setPassword('');
  }

  async function onSignOut() {
    setBusy(true);
    const response = await sendToBackground({ kind: 'AUTH_SIGN_OUT' });
    setBusy(false);

    if (!response.ok) {
      setError(response.message);
      return;
    }

    setAccount({ signedIn: false, email: null });
    setView('signIn');
    setPassword('');
  }

  if (!ready) {
    return (
      <main className="bf-page bf-popup">
        <Brand />
        <p className="bf-lede">Checking your account…</p>
      </main>
    );
  }

  if (account.signedIn) {
    return (
      <main className="bf-page bf-popup">
        <Brand />
        <ThisPage
          page={page}
          analyzing={analyzing}
          onAnalyze={async () => {
            setAnalyzing(true);
            setPage(await sendToActiveTab({ kind: 'RUN_ANALYZE' }));
            setAnalyzing(false);
          }}
        />
        <div className="bf-account">
          <strong>{account.email ?? 'Signed in'}</strong>
        </div>
        {error && (
          <p className="bf-error" role="alert">
            {error}
          </p>
        )}
        <button type="button" className="bf-secondary" onClick={onSignOut} disabled={busy}>
          {busy ? 'Signing out…' : 'Sign out'}
        </button>
      </main>
    );
  }

  const submitLabel =
    view === 'signIn' ? 'Sign in' : view === 'signUp' ? 'Create account' : 'Send reset link';
  const busyLabel =
    view === 'signIn' ? 'Signing in…' : view === 'signUp' ? 'Creating…' : 'Sending…';

  return (
    <main className="bf-page bf-popup">
      <Brand />
      <p className="bf-lede">
        {view === 'forgot'
          ? 'We will email you a link to set a new password.'
          : 'Sign in to audit the article you are reading.'}
      </p>

      <form className="bf-form" onSubmit={onSubmit}>
        <div className="bf-field">
          <label htmlFor="bf-email">Email</label>
          <input
            id="bf-email"
            ref={emailRef}
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>

        {view !== 'forgot' && (
          <div className="bf-field">
            <label htmlFor="bf-password">Password</label>
            <input
              id="bf-password"
              type="password"
              autoComplete={view === 'signUp' ? 'new-password' : 'current-password'}
              required
              minLength={6}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
        )}

        {view === 'signUp' && (
          <label className="bf-check">
            <input
              type="checkbox"
              required
              checked={ageVerified}
              onChange={(event) => setAgeVerified(event.target.checked)}
            />
            <span>I am 13 years old or older.</span>
          </label>
        )}

        {notice && <p className="bf-notice">{notice}</p>}
        {error && (
          <p className="bf-error" role="alert">
            {error}
          </p>
        )}

        <button
          type="submit"
          className="bf-submit"
          disabled={busy || (view === 'signUp' && !ageVerified)}
        >
          {busy && <Spinner />}
          {busy ? busyLabel : submitLabel}
        </button>
      </form>

      <div className="bf-links">
        {view === 'signIn' ? (
          <>
            <button type="button" className="bf-link" onClick={() => switchTo('signUp')}>
              Create an account
            </button>
            <button type="button" className="bf-link" onClick={() => switchTo('forgot')}>
              Forgot password
            </button>
          </>
        ) : (
          <button type="button" className="bf-link" onClick={() => switchTo('signIn')}>
            Back to sign in
          </button>
        )}
      </div>
    </main>
  );
}

/**
 * The Analyze control. It lives here rather than on the page so that an ordinary tab
 * carries no Bad Faith UI at all; the highlights and the report appear only on the
 * article you ran it on, and only once you have asked.
 */
function ThisPage({
  page,
  analyzing,
  onAnalyze,
}: {
  page: PageStatus | null;
  analyzing: boolean;
  onAnalyze: () => void;
}) {
  if (page === null) {
    return (
      <section className="bf-page-state">
        <p className="bf-lede">Bad Faith cannot read this page.</p>
      </section>
    );
  }

  if (!page.isArticle) {
    return (
      <section className="bf-page-state">
        <p className="bf-lede">
          No article text here. Open a news story and the button will light up.
        </p>
      </section>
    );
  }

  const analyzed = page.state === 'done' || page.state === 'stale';
  const label = analyzing
    ? 'Analyzing…'
    : page.state === 'stale'
      ? 'Analyze again'
      : analyzed
        ? 'Analyze again'
        : 'Analyze this article';

  return (
    <section className="bf-page-state">
      <p className="bf-lede">
        {analyzed && page.docType
          ? `${DOC_TYPE_LABELS[page.docType]} — ${plural(
              page.flags,
              'flagged phrase',
              'flagged phrases',
            )}.`
          : `${plural(page.paragraphs, 'paragraph', 'paragraphs')} ready to read.`}
      </p>

      {page.state === 'error' && page.message && (
        <p className="bf-error" role="alert">
          {page.message}
        </p>
      )}

      <button type="button" className="bf-submit" onClick={onAnalyze} disabled={analyzing}>
        {analyzing && <Spinner />}
        {label}
      </button>

      {analyzed && !analyzing && (
        <p className="bf-lede">
          {page.state === 'stale'
            ? 'The article changed since the last run.'
            : 'The highlights are on the article. Hover one for the reason.'}
        </p>
      )}
    </section>
  );
}
