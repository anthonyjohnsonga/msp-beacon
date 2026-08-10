// ============================================================================
// state.js — shared mutable UI state.
// Held on a single exported object so any module can read AND update it by
// property (ES module `let` bindings can't be reassigned by importers).
// ============================================================================

export const ui = {
  sort:    localStorage.getItem('msp-sort')    || 'manual',
  view:    localStorage.getItem('msp-view')    || 'grid',
  density: localStorage.getItem('msp-density') || 'comfortable',
  mode:    localStorage.getItem('msp-mode')    || 'dark',
  theme:   localStorage.getItem('msp-theme')   || 'Green',
  accent:  localStorage.getItem('msp-accent')  || '#1D9E75',
  // Card preview images are opt-in: turning them on makes every visible card
  // fetch its page for an og:image, so it stays off until the user asks for it.
  thumbs:  localStorage.getItem('msp-thumbs') === '1',
};
