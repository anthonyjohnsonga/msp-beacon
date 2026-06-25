// ============================================================================
// health.js — link reachability checking via /api/check-links. Merges results
// into the shared linkStatus map (in-place, no reassignment) and re-renders.
// The Stats "Link Health" scan lives in stats.js; this is the toolbar "Check
// links" action + the health-hint "check unchecked only" follow-up.
// ============================================================================

import { links, visibleIds, linkStatus, render, closeSettings } from './app.js';
import { isWebUrl } from './utils.js';
import { showToast } from './toast.js';

export async function checkLinks() {
  const btn = document.getElementById('checkLinksBtn');
  if (!btn || btn.disabled) return;
  closeSettings();
  const ids = visibleIds.length ? visibleIds : links.map(l => l.id);
  if (!ids.length) { showToast('No links to check'); return; }
  btn.disabled = true;
  btn.innerHTML = '<i class="ti ti-loader" style="animation:spin 1s linear infinite"></i> Checking…';
  try {
    const params = ids.length ? '?ids=' + ids.map(encodeURIComponent).join(',') : '';
    const res = await fetch('/api/check-links' + params);
    if (!res.ok) throw new Error('Server error ' + res.status);
    const data = await res.json();
    Object.assign(linkStatus, data);
    render();
    const broken = Object.values(data).filter(s => s === 'broken' || s === 'timeout').length;
    if (broken === 0) showToast('All links OK');
    else showToast(`${broken} broken link${broken > 1 ? 's' : ''} found`, true);
  } catch (e) {
    showToast('Link check failed', true);
  }
  btn.disabled = false;
  btn.innerHTML = '<i class="ti ti-wifi"></i> Check links';
}

// Health-hint action: check only the web links whose status is still unknown, then re-render.
export async function checkUncheckedLinks() {
  const ids = links
    .filter(l => !l.archived && !l.deleted && isWebUrl(l.url) && linkStatus[l.id] === undefined)
    .map(l => l.id);
  if (!ids.length) { render(); return; }
  const btn = document.getElementById('healthHintBtn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="ti ti-loader" style="animation:spin 1s linear infinite"></i> Checking…'; }
  try {
    const res = await fetch('/api/check-links?ids=' + ids.map(encodeURIComponent).join(','));
    if (!res.ok) throw new Error('Server error ' + res.status);
    Object.assign(linkStatus, await res.json());
  } catch (e) {
    showToast('Link check failed', true);
  }
  render();
}
