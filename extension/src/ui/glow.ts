// The light that follows the pointer. One delegated listener per surface, so the
// cost does not grow with the number of controls, and one rAF between the pointer
// and the paint, so a fast drag across a long list is still one write per frame.
//
// CSS does the rest: an element marked `data-bf-glow` gets a radial highlight
// centred on `--bf-mx`/`--bf-my`. An element the pointer has never been over keeps
// the fallback centre in the stylesheet, so nothing depends on this running.

const GLOW_SELECTOR = '[data-bf-glow]';

export function attachPointerGlow(root: ParentNode & EventTarget): () => void {
  let pending: { element: HTMLElement; x: number; y: number } | null = null;
  let frame = 0;

  function flush(): void {
    frame = 0;
    if (!pending) return;
    const { element, x, y } = pending;
    pending = null;
    element.style.setProperty('--bf-mx', `${x}%`);
    element.style.setProperty('--bf-my', `${y}%`);
  }

  function onMove(event: Event): void {
    const pointer = event as PointerEvent;
    const target = pointer.target;
    if (!(target instanceof Element)) return;

    const element = target.closest(GLOW_SELECTOR);
    if (!(element instanceof HTMLElement)) return;

    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    pending = {
      element,
      x: ((pointer.clientX - rect.left) / rect.width) * 100,
      y: ((pointer.clientY - rect.top) / rect.height) * 100,
    };
    if (!frame) frame = requestAnimationFrame(flush);
  }

  root.addEventListener('pointermove', onMove, { passive: true });

  return () => {
    root.removeEventListener('pointermove', onMove);
    if (frame) cancelAnimationFrame(frame);
  };
}
