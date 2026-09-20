import { parseParagraphs } from './lib/paragraph_parser';
import { detectOpinionPiece } from './lib/detect_opinion_piece';
import type { GetParagraphsResponse, OpinionStatusResponse } from './types';

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'GET_OPINION_STATUS') {
    let response: OpinionStatusResponse;
    try {
      response = {
        ok: true,
        status: detectOpinionPiece(document, window.location.href),
      };
    } catch (err) {
      response = { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
    sendResponse(response);
    return;
  }

  if (message?.type !== 'GET_PARAGRAPHS') return;

  let response: GetParagraphsResponse;
  try {
    response = { ok: true, paragraphs: parseParagraphs(document) };
  } catch (err) {
    response = { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  sendResponse(response);
});
