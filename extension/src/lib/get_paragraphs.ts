import type { GetParagraphsResponse, Paragraph } from '../types';

export async function getActiveTabParagraphs(): Promise<Paragraph[]> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined) return [];

  const response: GetParagraphsResponse = await chrome.tabs.sendMessage(tab.id, {
    type: 'GET_PARAGRAPHS',
  });
  return response.ok ? response.paragraphs : [];
}
