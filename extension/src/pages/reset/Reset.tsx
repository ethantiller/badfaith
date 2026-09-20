// A full tab, not the popup: a popup closes the moment it loses focus, so it can
// never finish an email-link flow. Supabase redirects here with the recovery
// tokens in the URL fragment; the background worker does the actual update.
import { useEffect, useState } from 'react';
import { sendToBackground } from '../../messaging';
import { Brand, Spinner } from '../Brand';

interface RecoveryTokens {
  accessToken: string;
  refreshToken: string;
}

function readTokens(): RecoveryTokens | null {
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const accessToken = hash.get('access_token');
  const refreshToken = hash.get('refresh_token');

  if (!accessToken || !refreshToken) return null;
  return { accessToken, refreshToken };
}

export default function Reset() {
  const [tokens, setTokens] = useState<RecoveryTokens | null>(null);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    setTokens(readTokens());
    // The tokens are in the address bar until this runs; do not leave them there.
    if (window.location.hash) {
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, []);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!tokens) return;

    if (password !== confirmation) {
      setError('The two passwords do not match.');
      return;
    }

    setBusy(true);
    setError('');

    const response = await sendToBackground({
      kind: 'AUTH_RECOVER',
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      newPassword: password,
    });
    setBusy(false);

    if (!response.ok) {
      setError(response.message);
      return;
    }

    setDone(true);
  }

  if (done) {
    return (
      <main className="bf-page bf-tab">
        <Brand />
        <p className="bf-notice">
          Your password is set and you are signed in. Close this tab and open an article.
        </p>
      </main>
    );
  }

  if (!tokens) {
    return (
      <main className="bf-page bf-tab">
        <Brand />
        <p className="bf-lede">
          This page needs a recovery link. Open the extension, choose Forgot password, and
          follow the link we email you.
        </p>
      </main>
    );
  }

  return (
    <main className="bf-page bf-tab">
      <Brand />
      <p className="bf-lede">Choose a new password for your account.</p>

      <form className="bf-form" onSubmit={onSubmit}>
        <div className="bf-field">
          <label htmlFor="bf-new-password">New password</label>
          <input
            id="bf-new-password"
            type="password"
            autoComplete="new-password"
            required
            minLength={6}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>

        <div className="bf-field">
          <label htmlFor="bf-confirm-password">New password again</label>
          <input
            id="bf-confirm-password"
            type="password"
            autoComplete="new-password"
            required
            minLength={6}
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
          />
        </div>

        {error && (
          <p className="bf-error" role="alert">
            {error}
          </p>
        )}

        <button type="submit" className="bf-submit" data-bf-glow disabled={busy}>
          {busy && <Spinner />}
          {busy ? 'Saving…' : 'Save password'}
        </button>
      </form>
    </main>
  );
}
