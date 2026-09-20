// Every message in the extension crosses one of two boundaries: a page or the side
// panel talking to the background worker, or the side panel talking to a tab. Both
// directions used to be re-implemented with their own try/catch at each call site.
import type { BgRequest, BgResult, HoverBroadcast, PageStatus, TabRequest } from '../types';

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
 * The side panel addressing a specific tab. No token is involved, so this does not go
 * through the background. Null means there is no content script listening — a
 * chrome:// page, a plain http:// site, or a tab opened before the last reload.
 */
export async function sendToTab(tabId: number, message: TabRequest): Promise<PageStatus | null> {
  try {
    return (await chrome.tabs.sendMessage(tabId, message)) as PageStatus;
  } catch {
    return null;
  }
}

/**
 * A tab request whose reply is not a PageStatus. The content script owns the paragraph
 * text, so a rewrite is built and sent there and its outcome comes back through here.
 */
export async function requestFromTab<T>(tabId: number, message: TabRequest): Promise<BgResult<T>> {
  try {
    return (await chrome.tabs.sendMessage(tabId, message)) as BgResult<T>;
  } catch (error) {
    return { ok: false, code: 'network', message: asMessage(error) };
  }
}

/** The side panel addressing whichever tab is currently active. */
export async function sendToActiveTab(message: TabRequest): Promise<PageStatus | null> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id === undefined) return null;
    return sendToTab(tab.id, message);
  } catch {
    return null;
  }
}

/**
 * Content script to side panel, with no particular tab or window in mind. The side
 * panel filters by `sender.tab.id` itself. Fire-and-forget: nothing is listening on an
 * ordinary page, and that is not an error.
 */
export function broadcast(message: HoverBroadcast): void {
  chrome.runtime.sendMessage(message).catch(() => {});
}
