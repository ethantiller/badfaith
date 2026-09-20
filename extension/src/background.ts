// The extension's trusted core. The only context that holds a token or calls the
// backend. Holds no module-level mutable state: Chrome evicts idle workers, and
// anything durable already lives in chrome.storage via the Supabase client.
import { ApiError, getErrorMessage } from './api/client';
import { sendAnalyzeRequest } from './api/analyze';
import { sendCoverageRequest } from './api/coverage';
import { sendRewriteRequest } from './api/rewrite';
import { ContractError } from './api/contract';
import {
  getSession,
  recoverPassword,
  resetPassword,
  signIn,
  signOut,
  signUp,
} from './auth';
import { isOwnMessage } from './messaging';
import type { AuthState, BgErrorCode, BgRequest, BgResult } from './types';

// Makes the toolbar icon open the side panel instead of a popup.
void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

function classify(error: unknown): BgErrorCode {
  // A bad payload is our bug, not the network's, and a retry cannot fix it.
  if (error instanceof ContractError) return 'invalid_request';

  if (error instanceof ApiError) {
    if (error.status === 401 || error.status === 403) return 'unauthenticated';
    if (error.status === 429) return 'rate_limited';
    // Everything else the server answered is a server answer, not a connection problem.
    return 'server';
  }

  // fetch() rejects with a TypeError when the request never reached a server.
  if (error instanceof TypeError) return 'network';
  return 'server';
}

function failure(error: unknown): BgResult<never> {
  // The server's own words are what make a 4xx debuggable while a route is new.
  if (error instanceof ApiError && error.detail) {
    console.warn(`[badfaith] ${error.status} ${error.statusText}: ${error.detail}`);
  }

  return { ok: false, code: classify(error), message: getErrorMessage(error) };
}

/** Every handler is "do the thing, or report why not", so that shape lives in one place. */
async function attempt<T>(run: () => Promise<T>): Promise<BgResult<T>> {
  try {
    return { ok: true, data: await run() };
  } catch (error) {
    return failure(error);
  }
}

async function currentAuthState(): Promise<AuthState> {
  const session = await getSession().catch(() => null);
  return { signedIn: Boolean(session), email: session?.user?.email ?? null };
}

async function requireSession(): Promise<void> {
  const session = await getSession().catch(() => null);
  if (session) return;

  // Fail before the round trip rather than spending one on a guaranteed 401.
  throw new ApiError(401, 'Unauthorized', 'Sign in from the extension icon to use Bad Faith.');
}

function handle(message: BgRequest): Promise<BgResult<unknown>> {
  switch (message.kind) {
    case 'ANALYZE_REQUEST':
      return attempt(async () => {
        await requireSession();
        return sendAnalyzeRequest(message.payload);
      });

    case 'COVERAGE_REQUEST':
      return attempt(async () => {
        await requireSession();
        return sendCoverageRequest(message.payload);
      });

    case 'REWRITE_REQUEST':
      return attempt(async () => {
        await requireSession();
        return sendRewriteRequest(message.payload);
      });

    case 'AUTH_STATUS':
      return attempt(currentAuthState);

    case 'AUTH_SIGN_IN':
      return attempt(async () => {
        await signIn({ email: message.email, password: message.password });
        return currentAuthState();
      });

    case 'AUTH_SIGN_UP':
      return attempt(async () => {
        const result = await signUp({
          email: message.email,
          password: message.password,
          isAgeVerified: message.isAgeVerified,
        });
        // Email confirmation may be required, in which case there is no session yet.
        return { ...(await currentAuthState()), needsConfirmation: result.session === null };
      });

    case 'AUTH_SIGN_OUT':
      return attempt(async () => {
        await signOut();
        return { signedIn: false, email: null };
      });

    case 'AUTH_RESET':
      return attempt(async () => {
        await resetPassword(message.email);
        return null;
      });

    case 'AUTH_RECOVER':
      return attempt(async () => {
        await recoverPassword(message.accessToken, message.refreshToken, message.newPassword);
        return currentAuthState();
      });

    default:
      return Promise.resolve({ ok: false, code: 'server', message: 'Unknown message' });
  }
}

chrome.runtime.onMessage.addListener((message: BgRequest, sender, sendResponse) => {
  if (!isOwnMessage(sender)) return false;
  if (!message || typeof message.kind !== 'string') return false;

  handle(message).then(sendResponse, (error: unknown) => sendResponse(failure(error)));
  return true; // keep the port open for the async reply
});
