// Sign in, sign up and password reset. Rendered inside the stage, so it is centred
// and capped in width by `.bf-stage-panel`.
import { useEffect, useRef, useState } from 'react';
import { sendToBackground } from '../../messaging';
import type { AuthState, BgRequest } from '../../types';
import { Spinner } from '../Brand';

type View = 'signIn' | 'signUp' | 'forgot';

export default function AuthForm({ onSignedIn }: { onSignedIn: (state: AuthState) => void }) {
  const [view, setView] = useState<View>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [ageVerified, setAgeVerified] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const emailRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    emailRef.current?.focus();
  }, []);

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

    setPassword('');
    onSignedIn({ signedIn: true, email: response.data?.email ?? email });
  }

  const submitLabel =
    view === 'signIn' ? 'Sign in' : view === 'signUp' ? 'Create account' : 'Send reset link';
  const busyLabel =
    view === 'signIn' ? 'Signing in…' : view === 'signUp' ? 'Creating…' : 'Sending…';

  return (
    <div className="bf-stage-panel">
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
          data-bf-glow
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
    </div>
  );
}
