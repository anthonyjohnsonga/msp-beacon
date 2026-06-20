// ============================================================================
// state.js — shared mutable UI state.
// Held on a single exported object so any module can read AND update it by
// property (ES module `let` bindings can't be reassigned by importers).
// ============================================================================

export const ui = {
  sort:    localStorage.getItem('msp-sort')    || 'manual',
  view:    localStorage.getItem('msp-view')    || 'grid',
  density: localStorage.getItem('msp-density') || 'comfortable',
};
