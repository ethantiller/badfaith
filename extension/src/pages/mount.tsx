// Shared bootstrap for the popup and the reset tab. Their HTML files are copied
// verbatim rather than processed by Vite, so the stylesheet is injected here instead
// of linked.
import React, { type ReactNode } from 'react';
import ReactDOM from 'react-dom/client';
import { attachPointerGlow } from '../ui/glow';
import tokensCss from '../ui/tokens.css?inline';
import pageCss from '../ui/page.css?inline';

export function mountPage(view: ReactNode): void {
  const style = document.createElement('style');
  style.textContent = `${tokensCss}\n${pageCss}`;
  document.head.appendChild(style);

  // The same light that follows the pointer across the in-page controls. One
  // listener for the document covers every button React renders, now and later.
  attachPointerGlow(document);

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>{view}</React.StrictMode>,
  );
}
