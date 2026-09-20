// Everything Bad Faith puts on screen, created on demand. Nothing here exists until an
// analysis starts, so an ordinary page carries no extension DOM at all.
import { ensureHighlightStyles } from '../article/highlight';
import { createBadge, type BadgeDetail, type BadgeView } from '../ui/badge';
import { createCard, type CardHandlers, type CardView } from '../ui/card';
import { createHost, type ShadowHost } from '../ui/host';
import { createTooltip, type TooltipView } from '../ui/tooltip';
import type { PageState } from '../types';

export interface SurfaceHandlers extends CardHandlers {
  onBadgeClick(event: MouseEvent): void;
}

export interface Surface {
  readonly badge: BadgeView;
  readonly card: CardView;
  readonly tooltip: TooltipView;
  render(state: PageState, detail?: BadgeDetail): void;
  showCard(open: boolean): void;
  readonly cardOpen: boolean;
  ensureMounted(): void;
  destroy(): void;
}

export function createSurface(handlers: SurfaceHandlers): Surface {
  const host: ShadowHost = createHost();
  const tooltip = createTooltip();
  const badge = createBadge(handlers.onBadgeClick);
  const card = createCard(handlers);

  let cardOpen = false;

  host.dock.append(badge.element, tooltip.element);
  host.ensureMounted();
  ensureHighlightStyles();

  return {
    badge,
    card,
    tooltip,
    get cardOpen() {
      return cardOpen;
    },
    render(state, detail) {
      badge.render(state, detail);
    },
    showCard(open) {
      cardOpen = open;
      if (open) host.dock.prepend(card.element);
      else card.element.remove();
    },
    ensureMounted: host.ensureMounted,
    destroy() {
      tooltip.closeNow();
      host.destroy();
    },
  };
}
