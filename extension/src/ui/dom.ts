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
