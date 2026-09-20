// @types/chrome@0.0.234 predates the sidePanel API (Chrome 114+). Minimal ambient
// declaration for the one call this extension makes; drop this once the types package
// catches up.
declare namespace chrome.sidePanel {
  interface PanelBehavior {
    openPanelOnActionClick?: boolean;
  }

  function setPanelBehavior(behavior: PanelBehavior): Promise<void>;
}
