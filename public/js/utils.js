// ============================================================================
// utils.js — pure, dependency-free helpers (no app state, no DOM).
// Safe to import from any module.
// ============================================================================

export function getFavicon(u) { try { new URL(u); return '/api/favicon?url=' + encodeURIComponent(u); } catch { return null; } }
export function getDomain(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } }
export function esc(s) { if (!s) return ''; return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
export function isHexColor(c) { return typeof c === 'string' && /^#[0-9A-Fa-f]{6}$/.test(c); }
// A link whose URL is http(s) — i.e. reachable/checkable on the web.
export function isWebUrl(u) { return /^https?:\/\//i.test(u); }
export function subKey(folder, sf) { return JSON.stringify([folder, sf]); }

export function hexToRgb(hex) {
  if (!isHexColor(hex)) return '29,158,117';
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
  return `${r},${g},${b}`;
}
export function hexToHsl(hex) {
  let r = parseInt(hex.slice(1,3),16)/255, g = parseInt(hex.slice(3,5),16)/255, b = parseInt(hex.slice(5,7),16)/255;
  const max = Math.max(r,g,b), min = Math.min(r,g,b); let h, s, l = (max+min)/2;
  if (max === min) { h = s = 0; }
  else {
    const d = max - min;
    s = l > 0.5 ? d/(2-max-min) : d/(max+min);
    switch (max) { case r: h = (g-b)/d + (g<b?6:0); break; case g: h = (b-r)/d + 2; break; default: h = (r-g)/d + 4; }
    h /= 6;
  }
  return [h*360, s*100, l*100];
}
export function hslToHex(h, s, l) {
  h /= 360; s /= 100; l /= 100;
  const hue2rgb = (p, q, t) => { if (t<0) t+=1; if (t>1) t-=1; if (t<1/6) return p+(q-p)*6*t; if (t<1/2) return q; if (t<2/3) return p+(q-p)*(2/3-t)*6; return p; };
  let r, g, b;
  if (s === 0) { r = g = b = l; }
  else { const q = l < 0.5 ? l*(1+s) : l+s-l*s; const p = 2*l-q; r = hue2rgb(p,q,h+1/3); g = hue2rgb(p,q,h); b = hue2rgb(p,q,h-1/3); }
  const toHex = x => Math.round(x*255).toString(16).padStart(2,'0');
  return '#' + toHex(r) + toHex(g) + toHex(b);
}
// Build a g1..g6 lightness ramp + glow from a single base accent color.
export function deriveAccent(baseHex) {
  const [h, s0] = hexToHsl(baseHex);
  const s = Math.min(85, Math.max(35, s0));
  const ramp = [93, 75, 60, 42, 30, 20].map(l => hslToHex(h, s, l));
  return { g1: ramp[0], g2: ramp[1], g3: ramp[2], g4: ramp[3], g5: ramp[4], g6: ramp[5], glow: `rgba(${hexToRgb(ramp[3])},.15)` };
}
export function timeAgo(ts) {
  if (!ts) return '';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  if (s < 2592000) return Math.floor(s / 86400) + 'd ago';
  return Math.floor(s / 2592000) + 'mo ago';
}
