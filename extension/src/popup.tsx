import { useEffect, useState } from 'react';

export default function Popup() {
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    setIsReady(true);
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
