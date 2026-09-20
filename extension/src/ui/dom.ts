// The injected UI is plain DOM, which keeps the content bundle small but means a lot of
// createElement/className/textContent triples. This is that triple, once.

interface Options {
  className?: string;
  text?: string;
  attrs?: Record<string, string>;
  children?: Array<Node | string>;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: Options = {},
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);

  if (options.className) node.className = options.className;
  if (options.text !== undefined) node.textContent = options.text;

  for (const [name, value] of Object.entries(options.attrs ?? {})) {
    node.setAttribute(name, value);
  }
  if (options.children) node.append(...options.children);

  return node;
}

export function button(options: Options & { onClick?: () => void } = {}): HTMLButtonElement {
  const node = el('button', options);
  node.type = 'button';
  if (options.onClick) node.addEventListener('click', options.onClick);
  return node;
}

/**
 * Marks a control as one the pointer's light follows, and gives it the layer that
 * light is painted on. src/ui/glow.ts moves the centre; injected.css does the rest,
 * and a sensible centre is baked in for the case where neither runs.
 */
export function glowable<T extends HTMLElement>(node: T): T {
  node.setAttribute('data-bf-glow', '');
  node.prepend(el('span', { className: 'bf-glow', attrs: { 'aria-hidden': 'true' } }));
  return node;
}
