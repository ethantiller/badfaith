// Watches the article for the site editing it underneath us. Started only once an
// analysis has run, so a page nobody analyzed is never observed.
import { parseParagraphs } from '../article/paragraph_parser';

const DEBOUNCE_MS = 600;
const OPTIONS: MutationObserverInit = {
  childList: true,
  subtree: true,
  characterData: true,
};

export interface Watcher {
  start(): void;
  stop(): void;
  /** Applies our own DOM edits without the observer mistaking them for the site's. */
  silently(mutate: () => void): void;
}

export function createWatcher(onSettled: () => void): Watcher {
  let observer: MutationObserver | null = null;
  let timer = 0;

  function schedule(): void {
    window.clearTimeout(timer);
    timer = window.setTimeout(onSettled, DEBOUNCE_MS);
  }

  // Containers are re-read on every connect: an SPA can swap the article element.
  function connect(): void {
    if (!observer) return;
    for (const root of parseParagraphs(document).roots) observer.observe(root, OPTIONS);
  }

  return {
    start() {
      if (observer) return;
      observer = new MutationObserver(schedule);
      connect();
    },
    stop() {
      window.clearTimeout(timer);
      observer?.disconnect();
      observer = null;
    },
    silently(mutate) {
      observer?.disconnect();
      try {
        mutate();
      } finally {
        connect();
      }
    },
  };
}
