import { useEffect, useState } from 'react';
import { getActiveTabParagraphs } from './lib/get_paragraphs';
import type { Paragraph } from './types';

export default function Popup() {
  const [isReady, setIsReady] = useState(false);
  const [_paragraphs, setParagraphs] = useState<Array<Paragraph>>([]);

  useEffect(() => {
    setIsReady(true);
    getActiveTabParagraphs()
      .then(setParagraphs)
      .catch(() => setParagraphs([]));
  }, []);

  return (
    <div className="w-96 h-64 bg-white flex flex-col items-center justify-center p-8">
      <div className="text-center">
        <h1 className="text-5xl font-bold mb-4 text-black">Hello</h1>
        <p className="text-lg text-black mb-6">Bad Faith Article Auditor</p>
        {isReady && (
          <div className="flex items-center justify-center gap-2 mt-6 text-base text-black">
            <span className="w-3 h-3 rounded-full bg-green-500 animate-pulse"></span>
            <span>Ready to audit</span>
          </div>
        )}
      </div>
    </div>
  );
}
