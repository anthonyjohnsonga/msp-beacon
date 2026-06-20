// ============================================================================
// stats.js — the Stats panel: summary, by-folder, by-tag, top-visited, never-
// visited, and the Link Health section (chunked reachability scan with live
// progress). Owns its own panel state. Reads links/linkStatus and a few helpers
// from app.js (call-time circular imports, fine in ESM); writes lastHomeStatusAt
// through the app.js setter after a scan so the homepage status dots stay fresh.
// ============================================================================

import { esc, isWebUrl } from './utils.js';
import { showToast } from './toast.js';
import { links, linkStatus, openLink, allFolders, getTagColor, save, setLastHomeStatusAt } from './app.js';

let statsNeverExpanded = false;
let statsScanning = false, statsScanDone = 0, statsScanTotal = 0;

export function openStats() {
  statsNeverExpanded = false;
  renderStats();
  document.getElementById('statsBg').style.display = 'flex';
}
export function closeStats() { document.getElementById('statsBg').style.display = 'none'; }
function statsOpen() { return document.getElementById('statsBg').style.display === 'flex'; }
export function openStatLink(id) { const l = links.find(x => x.id === id); if (l) openLink(l.id, l.url); }
export function toggleStatsNever() { statsNeverExpanded = !statsNeverExpanded; renderStats(); }

// Scan every web link's reachability for the Stats "Link Health" section. Chunked
// so the panel can show live progress instead of one long hanging request.
export async function scanLinksForStats() {
  if (statsScanning) return;
  const ids = links.filter(l => !l.archived && isWebUrl(l.url)).map(l => l.id);
  if (!ids.length) { showToast('No web links to check'); return; }
  statsScanning = true; statsScanDone = 0; statsScanTotal = ids.length;
  const CHUNK = 25;
  // try/finally so statsScanning always resets — otherwise an unexpected throw
  // would leave the button stuck disabled until a reload.
  try {
    if (statsOpen()) updateHealthSection();
    for (let i = 0; i < ids.length; i += CHUNK) {
      const chunk = ids.slice(i, i + CHUNK);
      const res = await fetch('/api/check-links?ids=' + chunk.map(encodeURIComponent).join(','));
      if (res.ok) Object.assign(linkStatus, await res.json());
      statsScanDone = Math.min(i + CHUNK, ids.length);
      if (statsOpen()) updateHealthSection();
    }
    setLastHomeStatusAt(Date.now());
  } catch { showToast('Link check failed', true); }
  finally {
    statsScanning = false;
    if (statsOpen()) updateHealthSection();
  }
}
// Builds just the Link Health section body so a scan can refresh it in place
// without re-rendering (and re-sorting/re-filtering) the entire Stats panel.
function renderHealthSection() {
  const webLinks = links.filter(l => !l.archived && isWebUrl(l.url));
  const downLinks = webLinks.filter(l => { const s = linkStatus[l.id]; return s === 'broken' || s === 'timeout'; });
  const checkedCount = webLinks.filter(l => linkStatus[l.id] !== undefined).length;
  const onlineCount = checkedCount - downLinks.length;
  const uncheckedCount = webLinks.length - checkedCount;
  // No web links → nothing to check, so don't offer the button or invite a scan.
  const healthBtn = webLinks.length === 0
    ? ''
    : statsScanning
    ? `<button class="stat-toggle" disabled style="opacity:.7"><i class="ti ti-loader" style="animation:spin 1s linear infinite"></i> Checking… ${statsScanDone}/${statsScanTotal}</button>`
    : `<button class="stat-toggle" onclick="scanLinksForStats()"><i class="ti ti-wifi"></i> ${checkedCount ? 'Re-check' : 'Check all'}</button>`;
  let healthBody;
  if (webLinks.length === 0) {
    healthBody = `<div style="font-size:13px;color:var(--text2)">No web links to check.</div>`;
  } else if (!checkedCount && !statsScanning) {
    healthBody = `<div style="font-size:13px;color:var(--text2)">Run a check to see which links are reachable.</div>`;
  } else {
    const downList = downLinks.length
      ? `<div class="stat-never-list" style="margin-top:6px">${downLinks.map(l => `
          <div class="stat-never-item" style="display:flex;align-items:center;gap:8px;cursor:pointer" onclick="openStatLink('${esc(l.id)}')" title="${esc(l.url)}">
            <i class="ti ti-alert-triangle" style="font-size:13px;color:#E24B4A;flex-shrink:0"></i>
            <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis">${esc(l.title)}</span>
            <span class="stat-row-sub">${linkStatus[l.id] === 'timeout' ? 'Timed out' : 'Broken'}</span>
          </div>`).join('')}</div>`
      : `<div style="font-size:13px;color:var(--g3);margin-top:4px">All checked links are online.</div>`;
    healthBody = `
      <div class="stat-summary" style="grid-template-columns:1fr 1fr 1fr">
        <div class="stat-summary-card"><div class="stat-summary-value" style="color:var(--g2)">${onlineCount}</div><div class="stat-summary-label">Online</div></div>
        <div class="stat-summary-card"><div class="stat-summary-value" style="color:#E24B4A">${downLinks.length}</div><div class="stat-summary-label">Issues</div></div>
        <div class="stat-summary-card"><div class="stat-summary-value" style="color:var(--text2)">${uncheckedCount}</div><div class="stat-summary-label">Unchecked</div></div>
      </div>
      ${downList}`;
  }
  return `
    <div class="stat-section-title" style="display:flex;align-items:center;justify-content:space-between">
      <span>Link Health</span>
      ${healthBtn}
    </div>
    ${healthBody}`;
}
function updateHealthSection() {
  const el = document.getElementById('statHealth');
  if (el) el.innerHTML = renderHealthSection();
}

export function resetStats() {
  if (!confirm('Reset all visit counts to zero?')) return;
  links.forEach(l => { l.visits = 0; });
  save();
  renderStats();
  showToast('Stats reset');
}
export function renderStats() {
  const active = links.filter(l => !l.archived);
  const totalLinks = active.length;
  const totalVisits = active.reduce((s, l) => s + (l.visits || 0), 0);
  const sorted = active.slice().sort((a, b) => (b.visits || 0) - (a.visits || 0));
  const topMax = sorted[0] ? (sorted[0].visits || 0) : 1;
  const top10 = sorted.filter(l => (l.visits || 0) > 0).slice(0, 10);
  const never = active.filter(l => !(l.visits || 0));
  const avgVisits = totalLinks ? (totalVisits / totalLinks) : 0;
  const pctNever = totalLinks ? Math.round((never.length / totalLinks) * 100) : 0;
  const readLaterCount = active.filter(l => l.readLater).length;
  const archivedCount = links.filter(l => l.archived).length;

  const folders = allFolders();
  const noFolderCount = active.filter(l => !l.folder).length;
  const folderRows = folders.map(f => {
    const count = active.filter(l => l.folder === f).length;
    return `<div class="stat-row">
      <i class="ti ti-folder" style="font-size:13px;color:var(--g4);flex-shrink:0"></i>
      <span class="stat-row-label">${esc(f)}</span>
      <span class="stat-row-sub">${count} link${count !== 1 ? 's' : ''}</span>
    </div>`;
  }).join('');
  const noFolderRow = noFolderCount > 0 ? `<div class="stat-row">
    <i class="ti ti-minus" style="font-size:13px;color:var(--text2);flex-shrink:0"></i>
    <span class="stat-row-label" style="color:var(--text2)">No folder</span>
    <span class="stat-row-sub">${noFolderCount} link${noFolderCount !== 1 ? 's' : ''}</span>
  </div>` : '';

  // By Tag — single pass tallying each tag (a link can have several) plus untagged.
  // Object.create(null) so tag names like "constructor" or "__proto__" can't collide with Object.prototype.
  const tagCounts = Object.create(null);
  let untaggedCount = 0;
  active.forEach(l => {
    const ts = l.tags || [];
    if (!ts.length) { untaggedCount++; return; }
    ts.forEach(t => { tagCounts[t] = (tagCounts[t] || 0) + 1; });
  });
  const tagRows = Object.entries(tagCounts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([t, count]) => `<div class="stat-row">
      <i class="ti ti-tag" style="font-size:13px;color:${getTagColor(t) || 'var(--g4)'};flex-shrink:0"></i>
      <span class="stat-row-label">${esc(t)}</span>
      <span class="stat-row-sub">${count} link${count !== 1 ? 's' : ''}</span>
    </div>`).join('');
  const untaggedRow = untaggedCount > 0 ? `<div class="stat-row">
    <i class="ti ti-minus" style="font-size:13px;color:var(--text2);flex-shrink:0"></i>
    <span class="stat-row-label" style="color:var(--text2)">Untagged</span>
    <span class="stat-row-sub">${untaggedCount} link${untaggedCount !== 1 ? 's' : ''}</span>
  </div>` : '';
  const tagSection = (tagRows || untaggedRow)
    ? `${tagRows}${untaggedRow}`
    : `<div style="font-size:13px;color:var(--text2)">No tags yet.</div>`;

  const topRows = top10.length ? top10.map(l => `
    <div class="stat-row">
      <span class="stat-row-label">${esc(l.title)}</span>
      <div class="stat-bar-track"><div class="stat-bar-fill" style="width:${Math.round(((l.visits||0)/topMax)*100)}%"></div></div>
      <span class="stat-row-sub" style="min-width:44px;text-align:right">${l.visits} visit${l.visits !== 1 ? 's' : ''}</span>
    </div>`).join('') : `<div style="font-size:13px;color:var(--text2)">No links visited yet.</div>`;

  const neverList = statsNeverExpanded ? `<div class="stat-never-list">${never.map(l => `<div class="stat-never-item">${esc(l.title)}</div>`).join('')}</div>` : '';

  document.getElementById('statsContent').innerHTML = `
    <div class="stat-section">
      <div class="stat-section-title">Summary</div>
      <div class="stat-summary" style="grid-template-columns:1fr 1fr 1fr">
        <div class="stat-summary-card"><div class="stat-summary-value">${totalLinks}</div><div class="stat-summary-label">Total links</div></div>
        <div class="stat-summary-card"><div class="stat-summary-value">${totalVisits}</div><div class="stat-summary-label">Total visits</div></div>
        <div class="stat-summary-card"><div class="stat-summary-value">${avgVisits.toFixed(1)}</div><div class="stat-summary-label">Avg visits/link</div></div>
        <div class="stat-summary-card"><div class="stat-summary-value">${pctNever}%</div><div class="stat-summary-label">Never visited</div></div>
        <div class="stat-summary-card"><div class="stat-summary-value">${readLaterCount}</div><div class="stat-summary-label">Read later</div></div>
        <div class="stat-summary-card"><div class="stat-summary-value">${archivedCount}</div><div class="stat-summary-label">Archived</div></div>
      </div>
    </div>
    <div class="stat-section" id="statHealth">${renderHealthSection()}</div>
    <div class="stat-section">
      <div class="stat-section-title">By Folder</div>
      ${folderRows}${noFolderRow}
    </div>
    <div class="stat-section">
      <div class="stat-section-title">By Tag</div>
      ${tagSection}
    </div>
    <div class="stat-section">
      <div class="stat-section-title">Top 10 Most Visited</div>
      ${topRows}
    </div>
    <div class="stat-section">
      <div class="stat-section-title" style="display:flex;align-items:center;justify-content:space-between">
        <span>Never Visited</span>
        ${never.length ? `<button class="stat-toggle" onclick="toggleStatsNever()">${statsNeverExpanded ? 'Hide' : `Show ${never.length}`}</button>` : ''}
      </div>
      ${never.length === 0 ? `<div style="font-size:13px;color:var(--text2)">All links have been visited!</div>` : `<div style="font-size:13px;color:var(--text2)">${never.length} link${never.length !== 1 ? 's' : ''} never opened</div>`}
      ${neverList}
    </div>`;
}
