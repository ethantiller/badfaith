import { useEffect, useState } from 'react';
import { getActiveTabOpinionStatus, getActiveTabParagraphs } from './lib/get_paragraphs';
import type { Paragraph } from './types';

export default function Popup() {
  const [isReady, setIsReady] = useState(false);
  const [paragraphs, setParagraphs] = useState<Array<Paragraph>>([]);
  const [opinionStatus, setOpinionStatus] = useState<'opinion' | null | undefined>(undefined);
  const [debugMessage, setDebugMessage] = useState('Popup mounted');

  useEffect(() => {
    setIsReady(true);
    console.log('[Bad Faith] popup mounted');
    setDebugMessage('Reading the active tab...');
    console.log('[Bad Faith] requesting paragraphs from the active tab');

    getActiveTabParagraphs()
      .then((nextParagraphs) => {
        setParagraphs(nextParagraphs);
        setDebugMessage(`Active tab responded: ${nextParagraphs.length} paragraphs`);
        console.log('[Bad Faith] active tab responded', {
          paragraphCount: nextParagraphs.length,
        });
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        setParagraphs([]);
        setDebugMessage(`Active tab request failed: ${message}`);
        console.error('[Bad Faith] active tab request failed', error);
      });

    getActiveTabOpinionStatus()
      .then((status) => {
        setOpinionStatus(status);
        console.log('[Bad Faith] article classification', { status });
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error('[Bad Faith] article classification failed', error);
        setDebugMessage(`Classification failed: ${message}`);
      });
  }, []);

  return (
    <div className="w-96 min-h-64 bg-white p-6 text-black">
      <div className="text-center">
        <h1 className="text-2xl font-bold mb-2">Bad Faith</h1>
        <p className="text-sm text-gray-600 mb-5">Article Auditor</p>
        {isReady && (
          <div className="flex items-center justify-center gap-2 text-sm">
            <span className="w-2.5 h-2.5 rounded-full bg-green-500 animate-pulse" />
            <span>Popup loaded</span>
          </div>
        )}
      </div>
      <div className="mt-5 rounded border border-gray-200 bg-gray-50 p-3 text-xs">
        <p className="font-semibold text-gray-700">Article type</p>
        <p className="mt-1 text-lg font-bold text-gray-900">
          {opinionStatus === undefined
            ? 'Checking...'
            : opinionStatus === null
              ? 'News (detector returned null)'
              : 'Opinion'}
        </p>
        <p className="font-semibold text-gray-700">Debug status</p>
        <p className="mt-1 break-words text-gray-600">{debugMessage}</p>
        <p className="mt-2 text-gray-500">Paragraphs found: {paragraphs.length}</p>
      </div>
    </div>
  );
}
