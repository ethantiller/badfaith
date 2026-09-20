import type { GetParagraphsResponse, OpinionStatusResponse, Paragraph } from '../types';

export async function getActiveTabParagraphs(): Promise<Paragraph[]> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined) return [];

  const response: GetParagraphsResponse = await chrome.tabs.sendMessage(tab.id, {
    type: 'GET_PARAGRAPHS',
  });
  return response.ok ? response.paragraphs : [];
}

export async function getActiveTabOpinionStatus(): Promise<'opinion' | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined) return null;

  const response: OpinionStatusResponse = await chrome.tabs.sendMessage(tab.id, {
    type: 'GET_OPINION_STATUS',
  });
  if (response === undefined) {
    throw new Error('No classification response. Reload the article tab and try again.');
  }
  if (!response.ok) throw new Error(response.error);
  return response.status;
}
