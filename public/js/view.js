// ============================================================================
// view.js — card density, view mode helpers, and link sorting.
// Reads/writes shared UI state via ./state.js. View-toggle and sort-change
// handlers that trigger a re-render stay in app.js (they call render()).
// ============================================================================

import { ui } from './state.js';

const DENSITY_CYCLE = ['compact', 'comfortable', 'spacious'];
const DENSITY_SETTINGS = {
  compact:     { minWidth: '160px', padding: '8px',  gap: '8px',  rowPadding: '4px 10px',  rowGap: '1px', icon: 'ti ti-baseline-density-small',  label: 'Compact'     },
  comfortable: { minWidth: '220px', padding: '14px', gap: '12px', rowPadding: '8px 12px',  rowGap: '2px', icon: 'ti ti-baseline-density-medium', label: 'Comfortable' },
  spacious:    { minWidth: '300px', padding: '20px', gap: '16px', rowPadding: '12px 14px', rowGap: '6px', icon: 'ti ti-baseline-density-large',  label: 'Spacious'    },
};

export function applyDensity(d) {
  const s = DENSITY_SETTINGS[d] || DENSITY_SETTINGS.comfortable;
  const r = document.documentElement.style;
  r.setProperty('--card-min-width', s.minWidth);
  r.setProperty('--card-padding', s.padding);
  r.setProperty('--card-gap', s.gap);
  r.setProperty('--row-padding', s.rowPadding);
  r.setProperty('--row-gap', s.rowGap);
  ui.density = d;
  localStorage.setItem('msp-density', d);
  const btn = document.getElementById('densityBtn');
  if (btn) btn.innerHTML = `<i class="${s.icon}"></i>`;
}

export function cycleDensity() {
  const next = DENSITY_CYCLE[(DENSITY_CYCLE.indexOf(ui.density) + 1) % DENSITY_CYCLE.length];
  applyDensity(next);
}

// Numeric creation-order key from a link id. Ids are `Date.now().toString(36)`
// plus a random base36 suffix. We parse ONLY the leading timestamp portion: the
// random suffix has a variable length (trailing base36 zeros get dropped), so
// parsing the whole id would let a newer link with a shorter suffix sort as
// older. Date.now() is a stable 8 base36 chars from 2004 to ~2058, and 36^8 fits
// safely under Number.MAX_SAFE_INTEGER so the parse is exact (no float rounding).
// Falls back to 0 for any non-conforming (e.g. hand-edited) id so the sort stays
// stable instead of going NaN.
const TS_LEN = 8;
export function idOrder(id) { const n = parseInt(String(id).slice(0, TS_LEN), 36); return Number.isNaN(n) ? 0 : n; }

export function sortLinks(arr) {
  if (ui.sort === 'manual') return arr;
  const copy = arr.slice();
  if (ui.sort === 'az') copy.sort((a, b) => (a.title || '').toLowerCase().localeCompare((b.title || '').toLowerCase()));
  else if (ui.sort === 'za') copy.sort((a, b) => (b.title || '').toLowerCase().localeCompare((a.title || '').toLowerCase()));
  else if (ui.sort === 'newest') copy.sort((a, b) => idOrder(b.id) - idOrder(a.id));
  else if (ui.sort === 'oldest') copy.sort((a, b) => idOrder(a.id) - idOrder(b.id));
  else if (ui.sort === 'most-visited') copy.sort((a, b) => (b.visits || 0) - (a.visits || 0));
  else if (ui.sort === 'recent') copy.sort((a, b) => (b.lastVisited || 0) - (a.lastVisited || 0));
  return copy;
}
