// The shadow host every Bad Faith control lives in. Closed, so a page script cannot
// reach into it at all; the isTrusted check on clicks is the second layer.
import tokensCss from './tokens.css?inline';
import injectedCss from './injected.css?inline';
import { el } from './dom';

const HOST_ATTRIBUTE = 'data-badfaith';

// Inline and !important so a site's own stylesheet cannot move or hide the host.
const HOST_STYLE = [
  'position:fixed!important',
  'inset:auto 0 0 auto!important',
  'width:0!important',
  'height:0!important',
  'margin:0!important',
  'padding:0!important',
  'border:0!important',
  'z-index:2147483647!important',
  'color-scheme:light dark!important',
].join(';');

export interface ShadowHost {
  /** The dock element inside the shadow root; mount UI here. */
  readonly dock: HTMLElement;
  /** Re-attaches the host if the site's re-render dropped it. */
  ensureMounted(): void;
  destroy(): void;
}

export function createHost(): ShadowHost {
  const host = el('div', { attrs: { [HOST_ATTRIBUTE]: 'host' } });
  host.style.cssText = HOST_STYLE;

  const root = host.attachShadow({ mode: 'closed' });
  const dock = el('div', { className: 'bf-dock' });
  root.append(el('style', { text: `${tokensCss}\n${injectedCss}` }), dock);

  return {
    dock,
    ensureMounted() {
      if (!host.isConnected) document.documentElement.appendChild(host);
      // A site that reorders documentElement's children can bury us; restyling is cheap.
      if (host.getAttribute('style') !== HOST_STYLE) host.style.cssText = HOST_STYLE;
    },
    destroy() {
      host.remove();
    },
  };
}
