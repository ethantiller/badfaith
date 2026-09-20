// Every message in the extension crosses one of two boundaries: a page or the popup
// talking to the background worker, or the popup talking to the active tab. Both
// directions used to be re-implemented with their own try/catch at each call site.
import type { BgRequest, BgResult, PageStatus, TabRequest } from '../types';

/** Nothing outside this extension gets to be heard. */
export function isOwnMessage(sender: chrome.runtime.MessageSender): boolean {
  return sender.id === chrome.runtime.id;
}

function asMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Extension unavailable';
}

/**
 * The background worker is the only context with a token or a network call, so
 * everything that needs one comes through here. A worker that is gone or reloading
 * rejects, and that is a network failure like any other.
 */
export async function sendToBackground<T>(message: BgRequest): Promise<BgResult<T>> {
  try {
    return (await chrome.runtime.sendMessage(message)) as BgResult<T>;
  } catch (error) {
    return { ok: false, code: 'network', message: asMessage(error) };
  }
}

/**
 * The popup addressing the page the user is looking at. No token is involved, so this
 * does not go through the background. Null means there is no content script listening
 * — a chrome:// page, a plain http:// site, or a tab opened before the last reload.
 */
export async function sendToActiveTab(message: TabRequest): Promise<PageStatus | null> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id === undefined) return null;
    return (await chrome.tabs.sendMessage(tab.id, message)) as PageStatus;
  } catch {
    return null;
  }
}
