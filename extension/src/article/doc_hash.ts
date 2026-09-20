// Client-side staleness only. This is not the backend's doc_hash cache key.
import type { Paragraph } from '../types';

/** FNV-1a, 32-bit. Cheap enough to run on every debounced mutation tick. */
export function paragraphHash(paragraphs: Paragraph[]): string {
  const joined = paragraphs.map((p) => p.text).join('\n');
  let hash = 0x811c9dc5;

  for (let i = 0; i < joined.length; i += 1) {
    hash ^= joined.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(16);
}
