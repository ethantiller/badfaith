// Shared bootstrap for the extension's own pages. Their HTML files are copied
// verbatim rather than processed by Vite, so the stylesheet is injected here instead
// of linked.
import React, { type ReactNode } from 'react';
import ReactDOM from 'react-dom/client';
import { attachPointerGlow } from '../ui/glow';
import tokensCss from '../ui/tokens.css?inline';
import pageCss from '../ui/page.css?inline';

/** `extraCss` layers on top, e.g. the side panel reusing the injected-UI card styles. */
export function mountPage(view: ReactNode, extraCss = ''): void {
  const style = document.createElement('style');
  style.textContent = `${tokensCss}\n${pageCss}\n${extraCss}`;
  document.head.appendChild(style);

  // The same light that follows the pointer across the in-page controls. One
  // listener for the document covers every button React renders, now and later.
  attachPointerGlow(document);

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>{view}</React.StrictMode>,
  );
}
