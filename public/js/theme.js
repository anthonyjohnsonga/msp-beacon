// ============================================================================
// theme.js — color mode (dark/light/auto), accent theme, and custom accent.
// Writes CSS custom properties on :root and persists via saveConfig().
// The theme modal renderer (openTheme) stays in app.js (it also draws the
// background/wallpaper controls).
// ============================================================================

import { ui } from './state.js';
import { saveConfig } from './app.js';
import { deriveAccent, hexToRgb } from './utils.js';

export const THEMES = {
  Green:  { g1:'#E1F5EE', g2:'#9FE1CB', g3:'#5DCAA5', g4:'#1D9E75', g5:'#0F6E56', g6:'#085041', glow:'rgba(var(--g4-rgb),.15)' },
  Blue:   { g1:'#DBEAFE', g2:'#93C5FD', g3:'#60A5FA', g4:'#2563EB', g5:'#1E40AF', g6:'#1E3A8A', glow:'rgba(37,99,235,.15)' },
  Purple: { g1:'#EDE9FE', g2:'#C4B5FD', g3:'#A78BFA', g4:'#7C3AED', g5:'#6D28D9', g6:'#4C1D95', glow:'rgba(124,58,237,.15)' },
  Teal:   { g1:'#CCFBF1', g2:'#5EEAD4', g3:'#2DD4BF', g4:'#0D9488', g5:'#0F766E', g6:'#115E59', glow:'rgba(13,148,136,.15)' },
  Orange: { g1:'#FEF3C7', g2:'#FCD34D', g3:'#F59E0B', g4:'#D97706', g5:'#B45309', g6:'#92400E', glow:'rgba(217,119,6,.15)' },
  Red:    { g1:'#FEE2E2', g2:'#FCA5A5', g3:'#F87171', g4:'#DC2626', g5:'#B91C1C', g6:'#7F1D1D', glow:'rgba(220,38,38,.15)' },
  Rose:   { g1:'#FFE4E6', g2:'#FDA4AF', g3:'#FB7185', g4:'#E11D48', g5:'#9F1239', g6:'#881337', glow:'rgba(225,29,72,.15)' },
  Amber:  { g1:'#FEF9C3', g2:'#FDE047', g3:'#FACC15', g4:'#CA8A04', g5:'#854D0E', g6:'#713F12', glow:'rgba(202,138,4,.15)' },
  Cyan:   { g1:'#CFFAFE', g2:'#67E8F9', g3:'#22D3EE', g4:'#0891B2', g5:'#155E75', g6:'#164E63', glow:'rgba(8,145,178,.15)' },
  Indigo: { g1:'#E0E7FF', g2:'#A5B4FC', g3:'#818CF8', g4:'#4F46E5', g5:'#3730A3', g6:'#312E81', glow:'rgba(79,70,229,.15)' },
  Fuchsia:{ g1:'#FAE8FF', g2:'#F0ABFC', g3:'#E879F9', g4:'#C026D3', g5:'#86198F', g6:'#701A75', glow:'rgba(192,38,211,.15)' },
  Slate:  { g1:'#E2E8F0', g2:'#CBD5E1', g3:'#94A3B8', g4:'#64748B', g5:'#334155', g6:'#1E293B', glow:'rgba(100,116,139,.15)' },
};

// The accent-* roles pick which end of the accent ramp (--g1..--g6) is used for
// text/icons on neutral backgrounds: the pale end reads well on dark, the dark
// end on light. var() references keep them live across applyTheme() changes.
const MODES = {
  dark:  { bg0:'#0d1117', bg1:'#161b22', bg2:'#1c2128', bg3:'#21262d', text0:'#e6edf3', text1:'#8b949e', text2:'#7d8590', border0:'#30363d', overlay:'rgba(255,255,255,.07)', stripe:'rgba(255,255,255,.02)', ring:'rgba(255,255,255,.2)', 'accent-text':'var(--g2)', 'accent-label':'var(--g3)', 'accent-icon':'var(--g3)' },
  light: { bg0:'#f6f8fa', bg1:'#ffffff', bg2:'#eef1f4', bg3:'#e3e7ec', text0:'#1f2328', text1:'#57606a', text2:'#7a828c', border0:'#d0d7de', overlay:'rgba(0,0,0,.06)', stripe:'rgba(0,0,0,.025)', ring:'rgba(0,0,0,.15)', 'accent-text':'var(--g5)', 'accent-label':'var(--g5)', 'accent-icon':'var(--g4)' },
};

function resolveMode(m) {
  return m === 'auto'
    ? (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
    : m;
}

export function applyMode(mode, save = true) {
  ui.mode = mode;
  localStorage.setItem('msp-mode', mode);
  const resolved = resolveMode(mode);
  const m = MODES[resolved] || MODES.dark;
  const r = document.documentElement.style;
  Object.entries(m).forEach(([k, v]) => r.setProperty('--' + k, v));
  // Native scrollbars, <select> popups, etc. follow the app's mode.
  r.setProperty('color-scheme', resolved === 'light' ? 'light' : 'dark');
  document.querySelectorAll('.mode-btn[data-mode]').forEach(el => el.classList.toggle('active', el.dataset.mode === mode));
  if (save) saveConfig();
}

export function applyTheme(name, save = true) {
  const t = name === 'Custom' ? deriveAccent(ui.accent) : (THEMES[name] || THEMES.Green);
  const r = document.documentElement.style;
  r.setProperty('--g1', t.g1); r.setProperty('--g2', t.g2); r.setProperty('--g3', t.g3);
  r.setProperty('--g4', t.g4); r.setProperty('--g5', t.g5); r.setProperty('--g6', t.g6);
  r.setProperty('--g4-glow', t.glow);
  r.setProperty('--g4-rgb', hexToRgb(t.g4));
  r.setProperty('--g5-rgb', hexToRgb(t.g5));
  ui.theme = name;
  localStorage.setItem('msp-theme', name);
  document.querySelectorAll('.theme-swatch').forEach(el => {
    el.classList.toggle('active', el.dataset.theme === name);
  });
  if (save) saveConfig();
}

export function previewCustomAccent(hex) {
  ui.accent = hex;
  localStorage.setItem('msp-accent', hex);
  applyTheme('Custom', false);
}
export function setCustomAccent(hex) {
  ui.accent = hex;
  localStorage.setItem('msp-accent', hex);
  applyTheme('Custom', true);
}
