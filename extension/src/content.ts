import { parseParagraphs } from './lib/paragraph_parser';
import type { GetParagraphsResponse } from './types';

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'GET_PARAGRAPHS') return;

  let response: GetParagraphsResponse;
  try {
    response = { ok: true, paragraphs: parseParagraphs(document) };
  } catch (err) {
    response = { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  sendResponse(response);
});
