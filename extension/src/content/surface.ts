// Everything Bad Faith puts on the page itself, created on demand. Nothing here exists
// until an analysis starts, so an ordinary page carries no extension DOM at all. The
// report card lives in the side panel now; this only isolates the hover tooltip.
import { ensureHighlightStyles } from '../article/highlight';
import { createHost, type ShadowHost } from '../ui/host';
import { createTooltip, type TooltipView } from '../ui/tooltip';

export interface Surface {
  readonly tooltip: TooltipView;
  ensureMounted(): void;
  destroy(): void;
}

export function createSurface(): Surface {
  const host: ShadowHost = createHost();
  const tooltip = createTooltip();

  host.dock.append(tooltip.element);
  host.ensureMounted();
  ensureHighlightStyles();

  return {
    tooltip,
    ensureMounted: host.ensureMounted,
    destroy() {
      tooltip.closeNow();
      host.destroy();
    },
  };
}
