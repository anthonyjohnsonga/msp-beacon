import { getFavicon, getDomain, esc, isHexColor, isWebUrl, hexToRgb, hexToHsl, hslToHex, deriveAccent, timeAgo, linkPath, pathKey, MAX_FOLDER_DEPTH } from './utils.js';
import { ui } from './state.js';
import { applyDensity, cycleDensity, idOrder, sortLinks } from './view.js';
import { applyMode, applyTheme, previewCustomAccent, setCustomAccent, THEMES } from './theme.js';
import { showToast, showUndoToast } from './toast.js';
import { openImport, closeImport, handleDrop, handleFile, toggleAll, doImport } from './import.js';
import { toggleFolder, collapseAll, expandAll, renameFolder, deleteFolder, startFolderRename, closeFolderMove } from './folders.js';
import { openFolderColorPicker, openTagColorPicker, selectPickerColor, resetPickerColor, closeFolderColorPicker, openFolderIconPicker, selectFolderIcon, closeFolderIconPicker } from './pickers.js';
import { openFolderManager, closeFolderManager, openTagManager, closeTagManager, openFeedManager, closeFeedManager, addFeed } from './managers.js';
import { onContextMenu, hideContextMenu } from './contextmenu.js';
import { selectMode, selectedIds, toggleSelectMode, exitSelectMode, toggleSelect, selectAllVisible, clearSelection, onBulkFolderChange, confirmBulkMove, bulkDelete, bulkAddTag, bulkArchive } from './selection.js';
import { archiveLink, openArchive, closeArchive, updateArchiveBadge } from './archive.js';
import { checkLinks, checkUncheckedLinks } from './health.js';
import { openStats, closeStats, openStatLink, scanLinksForStats, renderStats, resetStats, toggleStatsNever } from './stats.js';
import { setupDragListeners } from './drag.js';
import { parseSearch, linkMatchesFlag, contentMatchIds, contentMatchQuery, onSearchInput, clearSearch, saveSearchTerm, showSearchHistory, hideSearchHistory } from './search.js';
import { openModal, closeModal, autoTitle, fetchPageTitle, saveLink, addLinkAnyway } from './modals.js';
import { backupData, openRestore, handleRestoreFile } from './backup.js';
import { openTrash, closeTrash, emptyTrash, updateTrashBadge } from './trash.js';
import { ensureAuth, handleUnauthorized, logout } from './auth.js';
// Homepage dashboard/widget system (extracted to dashboard.js). We import the
// inline-handler functions so they stay on the window bridge below, the live
// `dashboard` binding for saveConfig, and the helpers app.js still drives
// (render dispatch, leave-home reset, server-config load).
import {
  addLinkGroup, addNote, addSectionWidget, homeSearchInput, homeShowAll, lgAddSubmit,
  lgStartRename, linkgroupRemoveItem, noteSave, openFeedItem, toggleDashboardEdit,
  widgetRemove, widgetToggle,
  renderHome, takeHomeFolderFilter, exitHomeMode, dashboardEditMode, dashboard,
  setDashboard, sanitizeDashboard, migrateDashboard, persistDashboard,
} from './dashboard.js';
// Re-export the moved names that other modules still import from './app.js', so
// those modules don't change (app.js stays the facade).
export { renderHome, dashboardEditMode, persistDashboard };
export { setLastHomeStatusAt, openFolderFromHome, reorderFavorite, ensureDashboard } from './dashboard.js';
// Manager grid/list/folder renderer (extracted to render.js). render + toggleFavorites
// are inline-handler/bridge names and render is used throughout app.js; re-export
// render + visibleIds so other modules' './app.js' imports are unchanged.
import { render, toggleFavorites } from './render.js';
export { render };
export { visibleIds } from './render.js';

// ============================================================================
// STATE & GLOBALS
// ============================================================================

export let links = [];
export let linkStatus = {};
let saveTimer = null;
// Server-issued links version (X-Links-Version); echoed back on save so the
// server can reject a stale write (another device saved first) with a 409.
let linksVersion = null;
// Nested-folder metadata, all keyed by pathKey(path) (every level, any depth):
//   collapsedFolders — Set of collapsed folder pathKeys (localStorage only)
//   folderColors     — { pathKey: hex }
//   folderIcons      — { pathKey: icon }
//   childOrder       — { parentPathKey: [orderedChildSegmentNames] }
// The legacy stores (collapsedSubfolders / subfolderColors / folderOrder-array)
// are folded into these by the one-time migrateFolders() normalization.
export let collapsedFolders = new Set(JSON.parse(localStorage.getItem('msp-collapsed') || '[]'));
export let childOrder = JSON.parse(localStorage.getItem('msp-folder-order') || '{}');
export let folderColors = JSON.parse(localStorage.getItem('msp-folder-colors') || '{}');
export let tagColors = JSON.parse(localStorage.getItem('msp-tag-colors') || '{}');
export { rssFeeds, currentMode };
export let folderIcons = JSON.parse(localStorage.getItem('msp-folder-icons') || '{}');
let rssFeeds = JSON.parse(localStorage.getItem('msp-rss-feeds') || '[]'); // [{url, name}]

// Homepage background. type: none|preset|url|upload; value = preset id / image URL
// / cache-bust token; dim 0-80 (% black scrim); blur 0-20 px.
const BG_PRESETS = {
  aurora: 'linear-gradient(135deg,#1e3c72,#2a5298)',
  dusk:   'linear-gradient(135deg,#355c7d,#6c5b7b,#c06c84)',
  ember:  'linear-gradient(135deg,#642b73,#c6426e)',
  forest: 'linear-gradient(135deg,#134e5e,#71b280)',
  slate:  'linear-gradient(135deg,#232526,#414345)',
  ocean:  'linear-gradient(135deg,#0f2027,#203a43,#2c5364)',
};
const clampNum = (n, lo, hi) => Math.max(lo, Math.min(hi, Number(n) || 0));

// ============================================================================
// HOME BACKGROUND & WALLPAPER
// ============================================================================
function normalizeHomeBg(v) {
  v = v && typeof v === 'object' ? v : {};
  const type = ['none', 'preset', 'url', 'upload'].includes(v.type) ? v.type : 'none';
  return { type, value: typeof v.value === 'string' ? v.value : '', dim: clampNum(v.dim, 0, 80), blur: clampNum(v.blur, 0, 20) };
}
let homeBg = normalizeHomeBg((() => { try { return JSON.parse(localStorage.getItem('msp-home-bg')); } catch { return null; } })());

export function applyHomeBg() {
  const img = document.getElementById('homeBgImg'), scrim = document.getElementById('homeBgScrim');
  if (!img || !scrim) return;
  let bg = '';
  if (currentMode === 'home' && homeBg.type !== 'none') {
    if (homeBg.type === 'preset') bg = BG_PRESETS[homeBg.value] || '';
    else if (homeBg.type === 'url') bg = (homeBg.value && !/["\n\r]/.test(homeBg.value)) ? `url("${homeBg.value}")` : '';
    else if (homeBg.type === 'upload') bg = `url("/api/wallpaper?t=${encodeURIComponent(homeBg.value || '0')}")`;
  }
  if (!bg) { img.style.display = 'none'; scrim.style.display = 'none'; return; }
  img.style.backgroundImage = bg;
  img.style.filter = homeBg.blur ? `blur(${homeBg.blur}px)` : 'none';
  img.style.display = 'block';
  scrim.style.background = `rgba(0,0,0,${homeBg.dim / 100})`;
  scrim.style.display = 'block';
}
function persistHomeBg() {
  localStorage.setItem('msp-home-bg', JSON.stringify(homeBg));
  saveConfig();
  applyHomeBg();
}
function setBgType(t) {
  homeBg.type = t;
  if (t === 'preset' && !BG_PRESETS[homeBg.value]) homeBg.value = 'aurora';
  persistHomeBg();
  renderBgControls();
}
function setBgPreset(id) { homeBg.type = 'preset'; homeBg.value = id; persistHomeBg(); renderBgControls(); }
function setBgUrl(v) {
  v = (v || '').trim();
  if (v) {
    let ok = false;
    try { ok = /^https?:$/.test(new URL(v).protocol); } catch {}
    if (!ok && /^data:image\//i.test(v)) ok = true;
    if (!ok) { showToast('Enter an http(s) or image URL', true); return; }
  }
  homeBg.type = 'url'; homeBg.value = v; persistHomeBg(); renderBgControls();
}
function setBgDim(v) { homeBg.dim = clampNum(v, 0, 80); document.getElementById('bgDimVal').textContent = homeBg.dim + '%'; persistHomeBg(); }
function setBgBlur(v) { homeBg.blur = clampNum(v, 0, 20); document.getElementById('bgBlurVal').textContent = homeBg.blur + 'px'; persistHomeBg(); }
async function uploadWallpaper(file) {
  if (!file) return;
  if (file.size > 8 * 1024 * 1024) { showToast('Image too large (max 8MB)', true); return; }
  try {
    const res = await fetch('/api/wallpaper', { method: 'POST', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file });
    if (!res.ok) { showToast('Upload failed', true); return; }
    homeBg.type = 'upload'; homeBg.value = String(Date.now()); // cache-bust the served image
    persistHomeBg(); renderBgControls(); showToast('Background updated');
  } catch { showToast('Upload failed', true); }
}
function renderBgControls() {
  document.querySelectorAll('.mode-btn[data-bgsrc]').forEach(el => el.classList.toggle('active', el.dataset.bgsrc === homeBg.type));
  const presetWrap = document.getElementById('bgPresetWrap'), urlInput = document.getElementById('bgUrlInput'), adjust = document.getElementById('bgAdjust');
  presetWrap.style.display = homeBg.type === 'preset' ? '' : 'none';
  urlInput.style.display = homeBg.type === 'url' ? '' : 'none';
  adjust.style.display = homeBg.type !== 'none' ? '' : 'none';
  if (homeBg.type === 'preset') {
    presetWrap.querySelector('#bgPresetGrid').innerHTML = Object.entries(BG_PRESETS).map(([id, g]) =>
      `<div class="bg-preset${homeBg.value === id ? ' active' : ''}" style="background:${g}" title="${id}" onclick="setBgPreset('${id}')"></div>`).join('');
  }
  if (homeBg.type === 'url') urlInput.value = homeBg.value || '';
  document.getElementById('bgDim').value = homeBg.dim;
  document.getElementById('bgDimVal').textContent = homeBg.dim + '%';
  document.getElementById('bgBlur').value = homeBg.blur;
  document.getElementById('bgBlurVal').textContent = homeBg.blur + 'px';
}
let activeCardId = null;

// ============================================================================
// CONTENT INDEXING
// ============================================================================
// Search querying/filtering + history live in search.js (parseSearch,
// linkMatchesFlag, onSearchInput/updateContentMatches, clearSearch, history).
export function captureSnapshot(id, url) {
  if (!/^https?:\/\//i.test(url || '')) return;
  fetch('/api/snapshot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, url }) }).catch(() => {});
}
async function indexAllContent() {
  closeSettings();
  const btn = document.getElementById('indexContentBtn');
  if (btn && btn.disabled) return;
  let indexed = new Set();
  try {
    const res = await fetch('/api/content-status');
    if (res.ok) indexed = new Set((await res.json()).indexed || []);
  } catch {}
  const targets = links.filter(l => !l.archived && !l.deleted && isWebUrl(l.url) && !indexed.has(l.id));
  if (!targets.length) { showToast('All links already indexed'); return; }
  if (btn) btn.disabled = true;
  let done = 0;
  showToast(`Indexing 0/${targets.length}…`);
  const CONC = 4;
  for (let i = 0; i < targets.length; i += CONC) {
    const batch = targets.slice(i, i + CONC);
    await Promise.all(batch.map(l => fetch('/api/snapshot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: l.id, url: l.url }) }).catch(() => {})));
    done += batch.length;
    showToast(`Indexing ${Math.min(done, targets.length)}/${targets.length}…`);
  }
  if (btn) btn.disabled = false;
  showToast(`Indexed ${targets.length} link${targets.length > 1 ? 's' : ''} for content search`);
}
let defaultView = localStorage.getItem('msp-default-view') || 'home';
let currentMode = defaultView;
let userNavigated = false;
// One-time dashboard migrations already applied for this user (synced via
// config.json so each migration runs once per user, not once per device, and
// so a widget a user later removes is never silently re-added).
export let dashboardMigrations = JSON.parse(localStorage.getItem('msp-dashboard-migrations') || '[]');

// One-time: give every link a nested-folder `path` array. Legacy links only
// carry the flat folder/subfolder pair, so derive path from them; folder/
// subfolder stay as mirrors of the first two segments during the transition to
// the path model so not-yet-converted folder code keeps working. Tracked in
// dashboardMigrations (runs once per user, synced via config) like the dashboard
// migration above.
function migrateFolders() {
  if (dashboardMigrations.includes('folders-nested-v1')) return;
  dashboardMigrations.push('folders-nested-v1');
  localStorage.setItem('msp-dashboard-migrations', JSON.stringify(dashboardMigrations));
  // 1. Per-link path (idempotent — only sets links that lack one).
  let changed = false;
  links.forEach(l => {
    if (!Array.isArray(l.path)) { l.path = [l.folder, l.subfolder].filter(Boolean); changed = true; }
  });
  if (changed) save();
  // 2. Re-key folder metadata onto pathKey(path). Legacy keys are bare folder
  // names (folderColors/folderIcons/collapsedFolders) or JSON([folder,sub])
  // pairs (subfolderColors/collapsedSubfolders — already pathKey-shaped). New
  // keys are JSON arrays, so a key starting with '[' is already migrated.
  const toPathKey = k => (typeof k === 'string' && k.startsWith('[')) ? k : pathKey([k]);
  folderColors = Object.fromEntries(Object.entries(folderColors).map(([k, v]) => [toPathKey(k), v]));
  const oldSubColors = JSON.parse(localStorage.getItem('msp-subfolder-colors') || '{}');
  for (const [k, v] of Object.entries(oldSubColors)) folderColors[k] = v; // k is JSON([f,s]) === pathKey
  folderIcons = Object.fromEntries(Object.entries(folderIcons).map(([k, v]) => [toPathKey(k), v]));
  const nextCollapsed = new Set([...collapsedFolders].map(toPathKey));
  const oldSubCollapsed = JSON.parse(localStorage.getItem('msp-subfolder-collapsed') || '{}');
  for (const [k, v] of Object.entries(oldSubCollapsed)) if (v) nextCollapsed.add(k);
  collapsedFolders = nextCollapsed;
  // folderOrder was a flat top-level array (or null); childOrder is per-parent.
  if (Array.isArray(childOrder)) childOrder = childOrder.length ? { [pathKey([])]: childOrder } : {};
  else if (!childOrder || typeof childOrder !== 'object') childOrder = {};
  localStorage.setItem('msp-folder-colors', JSON.stringify(folderColors));
  localStorage.setItem('msp-folder-icons', JSON.stringify(folderIcons));
  localStorage.setItem('msp-collapsed', JSON.stringify([...collapsedFolders]));
  localStorage.setItem('msp-folder-order', JSON.stringify(childOrder));
  localStorage.removeItem('msp-subfolder-colors');
  localStorage.removeItem('msp-subfolder-collapsed');
  saveConfig();        // persist the new-shape metadata to the server
  persistDashboard();  // persists the migration flag (+ dashboard) to config
}
// Set a link's nested-folder location, keeping the legacy flat fields mirrored
// (first two path segments) so any not-yet-converted code keeps working.
export function setLinkLocation(l, path) {
  l.path = (path || []).slice(0, MAX_FOLDER_DEPTH);
  l.folder = l.path[0] || '';
  l.subfolder = l.path[1] || null;
}

// ============================================================================
// DENSITY, VIEW MODE & SORTING
// ============================================================================
function toggleView() {
  ui.view = ui.view === 'grid' ? 'list' : 'grid';
  localStorage.setItem('msp-view', ui.view);
  document.getElementById('viewToggleIcon').className = ui.view === 'grid' ? 'ti ti-layout-list' : 'ti ti-layout-grid';
  render();
}
function onSortChange() {
  ui.sort = document.getElementById('sortSelect').value;
  localStorage.setItem('msp-sort', ui.sort);
  updateFilterBadge();
  render();
}


// ============================================================================
// CONFIG, PERSISTENCE & DATA LOADING
// ============================================================================
export function saveConfig() {
  const cfg = { folderColors, tagColors, folderIcons, childOrder, rssFeeds, theme: ui.theme, accent: ui.accent, mode: ui.mode, defaultView, homeBg, dashboard, dashboardMigrations };
  fetch('/api/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cfg)
  }).catch(e => console.error('Config save failed:', e));
}

function applyServerConfig(cfg) {
  if (!cfg || typeof cfg !== 'object') return;
  // Only keep valid hex values — a restored/edited config must not be able to
  // smuggle a non-color string into a folder/subfolder style attribute (XSS),
  // the same guard applied to tagColors below.
  if (cfg.folderColors && typeof cfg.folderColors === 'object') {
    folderColors = Object.fromEntries(Object.entries(cfg.folderColors).filter(([, v]) => isHexColor(v)));
    localStorage.setItem('msp-folder-colors', JSON.stringify(folderColors));
  }
  if (cfg.subfolderColors && typeof cfg.subfolderColors === 'object') {
    // Legacy (pre-nested-folders) config; stash for migrateFolders to fold into
    // the path-keyed folderColors. (Its keys are already JSON([folder,sub]) pairs.)
    localStorage.setItem('msp-subfolder-colors', JSON.stringify(Object.fromEntries(Object.entries(cfg.subfolderColors).filter(([, v]) => isHexColor(v)))));
  }
  if (cfg.tagColors && typeof cfg.tagColors === 'object') {
    // Only keep valid hex values — a restored/edited config must not be able to
    // smuggle a non-color string into the tag-chip style attribute (XSS).
    tagColors = Object.fromEntries(Object.entries(cfg.tagColors).filter(([, v]) => isHexColor(v)));
    localStorage.setItem('msp-tag-colors', JSON.stringify(tagColors));
  }
  if (cfg.homeBg && typeof cfg.homeBg === 'object') {
    homeBg = normalizeHomeBg(cfg.homeBg);
    localStorage.setItem('msp-home-bg', JSON.stringify(homeBg));
  }
  if ('dashboard' in cfg) {
    const d = sanitizeDashboard(cfg.dashboard);
    setDashboard(d);
    localStorage.setItem('msp-dashboard', JSON.stringify(d));
  }
  if (Array.isArray(cfg.dashboardMigrations)) {
    dashboardMigrations = cfg.dashboardMigrations.filter(x => typeof x === 'string');
    localStorage.setItem('msp-dashboard-migrations', JSON.stringify(dashboardMigrations));
  }
  if (cfg.folderIcons && typeof cfg.folderIcons === 'object') {
    folderIcons = cfg.folderIcons;
    localStorage.setItem('msp-folder-icons', JSON.stringify(folderIcons));
  }
  if (cfg.childOrder && typeof cfg.childOrder === 'object' && !Array.isArray(cfg.childOrder)) {
    childOrder = cfg.childOrder;
    localStorage.setItem('msp-folder-order', JSON.stringify(childOrder));
  } else if (Array.isArray(cfg.folderOrder)) {
    // Legacy flat top-level order; migrateFolders converts it to the per-parent map.
    childOrder = cfg.folderOrder;
    localStorage.setItem('msp-folder-order', JSON.stringify(childOrder));
  }
  if (Array.isArray(cfg.rssFeeds)) {
    rssFeeds = cfg.rssFeeds.filter(f => f && typeof f.url === 'string');
    localStorage.setItem('msp-rss-feeds', JSON.stringify(rssFeeds));
  }
  if (cfg.mode === 'dark' || cfg.mode === 'light' || cfg.mode === 'auto') {
    applyMode(cfg.mode, false);
  }
  if (isHexColor(cfg.accent)) {
    ui.accent = cfg.accent;
    localStorage.setItem('msp-accent', ui.accent);
  }
  if (cfg.theme === 'Custom') {
    applyTheme('Custom', false);
  } else if (cfg.theme && THEMES[cfg.theme]) {
    applyTheme(cfg.theme, false);
  }
  if (cfg.defaultView === 'home' || cfg.defaultView === 'manager') {
    defaultView = cfg.defaultView;
    localStorage.setItem('msp-default-view', defaultView);
    updateDefaultViewLabel();
    if (!userNavigated && currentMode !== defaultView) setMode(defaultView, false);
  }
}

// Trashed links (l.deleted = delete timestamp) are kept for this long, then
// purged for good on the next load. Soft-delete safety net beyond the 5s undo.
const TRASH_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
function purgeTrash() {
  const cutoff = Date.now() - TRASH_RETENTION_MS;
  const kept = links.filter(l => !(l.deleted && l.deleted < cutoff));
  if (kept.length !== links.length) { links = kept; save(); }
}

async function loadLinks() {
  try {
    const [linksRes, cfgRes] = await Promise.all([
      fetch('/api/links'),
      fetch('/api/config').catch(() => null)
    ]);
    if (linksRes.status === 401) { handleUnauthorized(); return; }
    linksVersion = linksRes.headers.get('X-Links-Version');
    const data = await linksRes.json();
    links = Array.isArray(data) ? data : [];
    if (cfgRes && cfgRes.ok) applyServerConfig(await cfgRes.json());
    migrateDashboard();
    migrateFolders();
    purgeTrash();
    render();
    updateTrashBadge();
  } catch(e) {
    console.error('Failed to load links', e);
    showToast('Failed to load links from server', true);
  }
}

export async function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const status = document.getElementById('saveStatus');
    status.innerHTML = '<i class="ti ti-loader" style="animation:spin 1s linear infinite"></i> Saving…';
    try {
      const headers = { 'Content-Type': 'application/json' };
      // Echo the version we loaded so the server can spot a save from another
      // device/tab in between (409 = don't clobber it).
      if (linksVersion) headers['X-Links-Version'] = linksVersion;
      const res = await fetch('/api/links', {
        method: 'POST',
        headers,
        body: JSON.stringify(links)
      });
      if (res.status === 401) { status.innerHTML = ''; handleUnauthorized(); return; }
      if (res.status === 409) {
        status.innerHTML = '';
        showToast('Changed on another device — loaded the latest copy. Your last change was not saved.', true);
        await loadLinks();
        return;
      }
      if (!res.ok) throw new Error('Server error ' + res.status);
      linksVersion = res.headers.get('X-Links-Version') || linksVersion;
      status.innerHTML = '<i class="ti ti-circle-check" style="color:var(--g3)"></i> Saved';
      setTimeout(() => status.innerHTML = '', 2000);
    } catch(e) {
      status.innerHTML = '<i class="ti ti-alert-circle" style="color:#E24B4A"></i> Save failed';
    }
  }, 400);
}

export let pendingDelete = null;
export let pendingMove = null;

// State-mutation layer: app.js owns the `links` array and the pending undo
// timers, but other modules can't reassign an imported `let` binding — so they
// go through these setters. (In-place mutation, e.g. links.push, needs no
// setter; only whole-value reassignment does.)
export function setLinks(arr) { links = arr; }
export function setPendingDelete(v) { pendingDelete = v; }
export function setPendingMove(v) { pendingMove = v; }
export function setChildOrder(parentPath, names) { childOrder[pathKey(parentPath)] = names; localStorage.setItem('msp-folder-order', JSON.stringify(childOrder)); }


// ============================================================================
// TOASTS & UNDO
// ============================================================================

function undoAction() {
  if (pendingDelete) undoDelete();
  else if (pendingMove) undoMove();
}

function undoDelete() {
  if (!pendingDelete) return;
  clearTimeout(pendingDelete.timer);
  // Soft-delete sets l.deleted in place; undo just clears the flag on those ids.
  (pendingDelete.ids || []).forEach(id => { const l = links.find(x => x.id === id); if (l) delete l.deleted; });
  pendingDelete = null;
  render(); updateTrashBadge();
  showToast('Restored');
}

function undoMove() {
  if (!pendingMove) return;
  clearTimeout(pendingMove.timer);
  links = pendingMove.saved;
  pendingMove = null;
  save(); render();
  showToast('Move undone');
}

export function commitPendingMove() {
  if (!pendingMove) return;
  clearTimeout(pendingMove.timer);
  pendingMove = null;
  save();
}


// ============================================================================
// UTILITIES & HELPERS
// ============================================================================
// All folder metadata getters take a path array (a bare string is accepted as a
// single top-level segment for legacy callers). Colors fall back up the path.
function asPath(path) { return Array.isArray(path) ? path : (path ? [path] : []); }
export function pathStartsWith(path, prefix) { return prefix.length <= path.length && prefix.every((s, i) => path[i] === s); }
export function getFolderColor(path) {
  const p = asPath(path);
  const c = folderColors[pathKey(p)];
  if (isHexColor(c)) return c;
  return p.length > 1 ? getFolderColor(p.slice(0, -1)) : '#1D9E75';
}
export function getTagColor(t) { return isHexColor(tagColors[t]) ? tagColors[t] : null; }
export function tagHtml(t) {
  const tc = getTagColor(t);
  const style = tc ? ` style="background:rgba(${hexToRgb(tc)},.2);color:${tc};border-color:${tc}"` : '';
  return `<span class="tag" data-tag="${esc(t)}" title="Filter by &quot;${esc(t)}&quot;"${style}>${esc(t)}</span>`;
}
export function getFolderIcon(path) { return folderIcons[pathKey(asPath(path))] || 'ti-folder'; }
// Segment names directly under parentPath ([] = top level), derived from links.
export function childFolders(parentPath) {
  const d = parentPath.length, names = new Set();
  links.filter(l => !l.archived && !l.deleted).forEach(l => {
    const p = linkPath(l);
    if (p.length > d && pathStartsWith(p, parentPath)) names.add(p[d]);
  });
  return [...names];
}
export function allFolders() { return childFolders([]).sort(); }
// pathKey of every folder node at any depth (each prefix of every link path).
export function allFolderPaths() {
  const set = new Set();
  links.filter(l => !l.archived && !l.deleted).forEach(l => {
    const p = linkPath(l);
    for (let i = 1; i <= p.length; i++) set.add(pathKey(p.slice(0, i)));
  });
  return [...set];
}
// Order the given child segment names under parentPath using the saved per-parent
// childOrder, with any not-yet-ordered names appended alphabetically.
export function getOrderedFolders(parentPath, names) {
  const order = childOrder[pathKey(parentPath)];
  if (!Array.isArray(order)) return names.slice().sort();
  const known = new Set(order);
  const fresh = names.filter(f => !known.has(f)).sort();
  return [...order.filter(f => names.includes(f)), ...fresh];
}
export function allTags() { return [...new Set(links.filter(l => !l.archived && !l.deleted).flatMap(l => l.tags || []))].sort(); }


// ============================================================================
// NAVIGATION & VIEW SWITCHING
// ============================================================================
export function setMode(mode, navigated = true) {
  currentMode = mode;
  if (navigated) userNavigated = true;
  const toolbar = document.querySelector('.toolbar');
  if (toolbar) toolbar.style.display = mode === 'home' ? 'none' : '';
  const hb = document.getElementById('homeBtn'), mb = document.getElementById('managerBtn');
  if (hb) hb.classList.toggle('active', mode === 'home');
  if (mb) mb.classList.toggle('active', mode === 'manager');
  const ab = document.getElementById('headerAddBtn');
  if (ab) ab.style.display = mode === 'home' ? '' : 'none';
  const edb = document.getElementById('editDashBtn');
  if (edb) { edb.style.display = mode === 'home' ? '' : 'none'; edb.classList.toggle('active', mode === 'home' && dashboardEditMode); }
  if (mode !== 'home') exitHomeMode();
  render();
}
function goHome() { setMode('home'); }
export function goManager() { setMode('manager'); }

function toggleDefaultView() {
  defaultView = defaultView === 'home' ? 'manager' : 'home';
  localStorage.setItem('msp-default-view', defaultView);
  updateDefaultViewLabel();
  saveConfig();
}
function updateDefaultViewLabel() {
  const el = document.getElementById('defaultViewLabel');
  if (el) el.textContent = defaultView === 'home' ? 'Home' : 'Manager';
}






// ============================================================================
// ADD / EDIT LINK MODAL
// ============================================================================
// --- Tag autocomplete (add/edit modal) -------------------------------------
// Suggests existing tags for the comma-separated segment currently being typed,
// excluding tags already entered in the field.
let tagSuggestMatches = [];
let tagSuggestIndex = -1;
function onTagInput() {
  const input = document.getElementById('mTags');
  const box = document.getElementById('tagSuggest');
  const parts = input.value.split(',');
  const seg = parts[parts.length - 1].trim().toLowerCase();
  const used = new Set(parts.slice(0, -1).map(t => t.trim().toLowerCase()).filter(Boolean));
  tagSuggestMatches = allTags()
    .filter(t => !used.has(t.toLowerCase()) && (!seg || t.toLowerCase().includes(seg)))
    .slice(0, 8);
  if (!tagSuggestMatches.length) return hideTagSuggest();
  tagSuggestIndex = -1;
  box.innerHTML = tagSuggestMatches.map((t, i) =>
    `<div class="tag-suggest-item" data-i="${i}"><i class="ti ti-tag" style="color:${getTagColor(t) || 'var(--g3)'}"></i>${esc(t)}</div>`
  ).join('');
  box.querySelectorAll('.tag-suggest-item').forEach(el =>
    el.addEventListener('mousedown', e => { e.preventDefault(); pickTagSuggest(+el.dataset.i); })
  );
  box.classList.add('open');
}
function pickTagSuggest(i) {
  const tag = tagSuggestMatches[i];
  if (tag == null) return;
  const input = document.getElementById('mTags');
  const parts = input.value.split(',');
  parts[parts.length - 1] = ' ' + tag;
  input.value = parts.join(',').replace(/^\s+/, '') + ', ';
  input.focus();
  hideTagSuggest();
}
function onTagKeydown(e) {
  const box = document.getElementById('tagSuggest');
  if (!box.classList.contains('open')) return;
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    tagSuggestIndex = Math.min(tagSuggestIndex + 1, tagSuggestMatches.length - 1);
    highlightTagSuggest();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    tagSuggestIndex = Math.max(tagSuggestIndex - 1, 0);
    highlightTagSuggest();
  } else if (e.key === 'Enter' && tagSuggestIndex >= 0) {
    e.preventDefault();
    pickTagSuggest(tagSuggestIndex);
  } else if (e.key === 'Escape') {
    e.stopPropagation(); // close the dropdown without closing the modal
    hideTagSuggest();
  }
}
function highlightTagSuggest() {
  document.querySelectorAll('#tagSuggest .tag-suggest-item')
    .forEach((el, i) => el.classList.toggle('active', i === tagSuggestIndex));
}
function hideTagSuggest() {
  const box = document.getElementById('tagSuggest');
  if (box) box.classList.remove('open');
  tagSuggestIndex = -1;
}


// ============================================================================
// SAVE / EDIT / DELETE LINK
// ============================================================================
function copyUrl(url, btn) {
  navigator.clipboard.writeText(url).then(() => {
    const icon = btn.querySelector('i');
    icon.className = 'ti ti-check';
    btn.style.color = 'var(--g3)';
    setTimeout(() => { icon.className = 'ti ti-copy'; btn.style.color = ''; }, 1500);
  });
}
export function editLink(id) { openModal(id); }
export function deleteLink(id) {
  commitPendingMove();
  if (pendingDelete) { clearTimeout(pendingDelete.timer); save(); }
  const l = links.find(x => x.id === id);
  if (!l) return;
  l.deleted = Date.now();   // soft-delete: move to Trash, recoverable until purged
  render(); updateTrashBadge();
  pendingDelete = {
    ids: [id],
    timer: setTimeout(() => { pendingDelete = null; save(); }, 5000)
  };
  showUndoToast('Link moved to trash — Undo?');
}


// IMPORT lives in import.js (openImport/closeImport/handleDrop/handleFile/
// parseBookmarks/showPreview/toggleAll/doImport).


// ============================================================================
// UI MODALS — THEME / SETTINGS / FILTER
// ============================================================================
function openTheme() {
  const grid = document.getElementById('themeGrid');
  const presets = Object.entries(THEMES).map(([name, t]) => `
    <div class="theme-swatch${name===ui.theme?' active':''}" data-theme="${name}" onclick="applyTheme('${name}')">
      <div class="swatch-dot" style="background:linear-gradient(135deg,${t.g2},${t.g3} 40%,${t.g4} 70%,${t.g6})"></div>
      <span class="swatch-label">${name}</span>
    </div>`).join('');
  const custom = `
    <div class="theme-swatch${ui.theme==='Custom'?' active':''}" data-theme="Custom">
      <label class="swatch-dot" title="Pick any color" style="cursor:pointer;position:relative;overflow:hidden;display:block;background:conic-gradient(from 90deg,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)">
        <input type="color" value="${esc(ui.accent)}" oninput="previewCustomAccent(this.value)" onchange="setCustomAccent(this.value)" style="position:absolute;left:-6px;top:-6px;width:48px;height:48px;opacity:0;cursor:pointer;border:none;padding:0;background:none">
      </label>
      <span class="swatch-label">Custom</span>
    </div>`;
  grid.innerHTML = presets + custom;
  document.querySelectorAll('.mode-btn[data-mode]').forEach(el => el.classList.toggle('active', el.dataset.mode === ui.mode));
  renderBgControls();
  document.getElementById('themeBg').style.display = 'flex';
}
function closeTheme() { document.getElementById('themeBg').style.display = 'none'; }

function toggleSettings(e) {
  e.stopPropagation();
  document.getElementById('settingsMenu').classList.toggle('open');
}
export function closeSettings() {
  document.getElementById('settingsMenu').classList.remove('open');
}
function toggleFilter(e) {
  e.stopPropagation();
  document.getElementById('filterMenu').classList.toggle('open');
}
function closeFilter() {
  document.getElementById('filterMenu').classList.remove('open');
}
export function updateFilterBadge() {
  const ff = document.getElementById('folderFilter')?.value || '';
  const tf = document.getElementById('tagFilter')?.value || '';
  const stf = document.getElementById('statusFilter')?.value || '';
  const active = (ff ? 1 : 0) + (tf ? 1 : 0) + (stf ? 1 : 0) + (ui.sort !== 'manual' ? 1 : 0);
  const badge = document.getElementById('filterBadge');
  if (!badge) return;
  badge.textContent = active;
  badge.style.display = active ? '' : 'none';
}
document.addEventListener('click', e => {
  hideContextMenu();
  closeSettings();
  if (!e.target.closest('#filterMenu') && !e.target.closest('#filterBtn')) closeFilter();
  if (!e.target.closest('.search-wrap')) hideSearchHistory();
  if (!e.target.closest('#folderColorPicker') && !e.target.closest('.folder-color-swatch')) {
    closeFolderColorPicker();
  }
  if (!e.target.closest('#folderIconPicker') && !e.target.closest('.folder-icon-btn')) {
    closeFolderIconPicker();
  }
});


// ============================================================================
// KEYBOARD SHORTCUTS
// ============================================================================
// Search querying + history live in search.js (the / and Ctrl+K shortcut, Enter,
// and Escape handlers below call into clearSearch/saveSearchTerm/hideSearchHistory).
function anyModalOpen() {
  return !!document.querySelector('.modal-bg[style*="flex"]');
}
function openShortcuts() { document.getElementById('shortcutsBg').style.display = 'flex'; }
function closeShortcuts() { document.getElementById('shortcutsBg').style.display = 'none'; }

document.addEventListener('keydown', e => {
  const s = document.getElementById('search');
  const inInput = e.target.matches('input,textarea,select,[contenteditable]');

  if ((e.key === '/' || (e.ctrlKey && e.key === 'k')) && !inInput) {
    e.preventDefault();
    if (currentMode === 'home') {
      const hs = document.getElementById('homeSearch');
      if (hs) { hs.focus(); return; }
      setMode('manager'); // search widget is hidden — flip to manager so the search box is usable
    }
    s.focus();
    s.select();
  }

  if (e.key === 'Enter' && document.activeElement === s) {
    saveSearchTerm(s.value);
    hideSearchHistory();
  }

  if (e.key === 'Escape') {
    if (document.activeElement === s) { clearSearch(); s.blur(); return; }
    hideContextMenu();
    closeFolderColorPicker();
    closeFolderIconPicker();
    closeFilter();
    closeSettings();
    const feedsEl = document.getElementById('feedsBg');
    if (feedsEl && feedsEl.style.display === 'flex') closeFeedManager(); // routes through the homepage refresh
    ['modalBg','importBg','statsBg','folderMgrBg','folderMoveBg','tagMgrBg','shortcutsBg','themeBg','archiveBg','trashBg'].forEach(id => {
      const el = document.getElementById(id);
      if (el && el.style.display === 'flex') el.style.display = 'none';
    });
  }

  if (inInput || anyModalOpen()) return;

  if (e.key === 'n') { e.preventDefault(); openModal(null); }
  if (e.key === '?') { e.preventDefault(); openShortcuts(); }

  if (activeCardId) {
    if (e.key === 'e') { e.preventDefault(); editLink(activeCardId); }
    if (e.key === 'f') { e.preventDefault(); toggleFavorite(activeCardId); }
    if (e.key === 'Delete') { e.preventDefault(); deleteLink(activeCardId); }
  }
});


// ============================================================================
// FOLDERS & SUBFOLDERS
// ============================================================================
// Folder/sub-folder ops live in folders.js (toggleFolder/collapseAll/expandAll/
// renameFolder/deleteFolder/deleteSubfolder/startFolderRename/renameSubfolder/
// startSubfolderRename/toggleSubfolder). They mutate the folder state exported
// below; folderOrder is spliced in place there (never reassigned).


// ============================================================================
// CARD INTERACTIONS — LISTENERS / CONTEXT MENU / DRAG
// ============================================================================
function setupCardListeners() {
  const content = document.getElementById('content');
  content.addEventListener('mouseover', e => {
    const card = e.target.closest('.card[data-id], .card-row[data-id]');
    activeCardId = card ? card.dataset.id : null;
  });
  content.addEventListener('mouseleave', () => { activeCardId = null; });
  content.addEventListener('click', e => {
    // In dashboard edit mode, tiles/links don't navigate — only the toolbar's
    // inline-onclick controls act (they fire independently of this delegate).
    if (dashboardEditMode) return;
    const tagChip = e.target.closest('.tag[data-tag]');
    if (tagChip) { filterByTag(tagChip.dataset.tag); return; }
    const btn = e.target.closest('[data-action]');
    if (btn) {
      const action = btn.dataset.action;
      const id = btn.dataset.id;
      if (action === 'copy') copyUrl(btn.dataset.url, btn);
      else if (action === 'edit') editLink(id);
      else if (action === 'archive') archiveLink(id);
      else if (action === 'delete') deleteLink(id);
      else if (action === 'favorite') toggleFavorite(id);
      else if (action === 'readlater') toggleReadLater(id);
      return;
    }
    const folderTile = e.target.closest('.home-folder-tile');
    if (folderTile) { openFolderFromHome(folderTile.dataset.folder); return; }
    const tile = e.target.closest('.home-tile');
    if (tile && tile.dataset.id) { openLink(tile.dataset.id, tile.dataset.url); return; }
    if (tile && tile.dataset.href) { window.open(tile.dataset.href, '_blank', 'noopener'); return; }
    const card = e.target.closest('.card[data-id], .card-row[data-id]');
    if (!card) return;
    if (card.classList.contains('select-mode')) toggleSelect(card.dataset.id);
    else openLink(card.dataset.id, card.dataset.url);
  });
  content.addEventListener('contextmenu', onContextMenu);
}

export function filterByTag(tag) {
  if (currentMode !== 'manager') setMode('manager');
  const tf = document.getElementById('tagFilter');
  if (tf) tf.value = tag;
  updateFilterBadge();
  render();
}

// The right-click context menu lives in contextmenu.js (onContextMenu +
// hideContextMenu + internal showContextMenu/cursorAnchor/copyLinkUrl).
// Drag-and-drop reorder/move lives in drag.js (setupDragListeners).


// ============================================================================
// EXPORT
// ============================================================================
function exportLinks() {
  const xmlEsc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const childrenOf = parentPath => {
    const d = parentPath.length, names = new Set();
    links.filter(l => !l.deleted).forEach(l => { const p = linkPath(l); if (p.length > d && pathStartsWith(p, parentPath)) names.add(p[d]); });
    return [...names].sort();
  };
  // Emit a nested <DL> tree: a folder's own links, then its sub-folders.
  const emit = (parentPath, indent) => {
    let out = '';
    links.filter(l => { if (l.deleted) return false; const p = linkPath(l); return p.length === parentPath.length && pathStartsWith(p, parentPath); })
      .forEach(l => { out += `${indent}<DT><A HREF="${xmlEsc(l.url)}">${xmlEsc(l.title)}</A>\n`; });
    childrenOf(parentPath).forEach(name => {
      out += `${indent}<DT><H3>${xmlEsc(name)}</H3>\n${indent}<DL><p>\n${emit([...parentPath, name], indent + '    ')}${indent}</DL><p>\n`;
    });
    return out;
  };
  const html = `<!DOCTYPE NETSCAPE-Bookmark-file-1>\n<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">\n<TITLE>Bookmarks</TITLE>\n<H1>Bookmarks</H1>\n<DL><p>\n${emit([], '    ')}</DL>`;
  const blob = new Blob([html], { type: 'text/html' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'msp-beacon-bookmarks.html';
  a.click();
  URL.revokeObjectURL(a.href);
  showToast('Bookmarks exported');
}

const style = document.createElement('style');
style.textContent = '@keyframes spin { to { transform: rotate(360deg); } }';
document.head.appendChild(style);


// ============================================================================
// SELECTION & BULK ACTIONS
// ============================================================================
export function toggleFavorite(id) {
  const l = links.find(x => x.id === id);
  if (!l) return;
  l.favorite = !l.favorite;
  save(); render();
}
export function toggleReadLater(id) {
  const l = links.find(x => x.id === id);
  if (!l) return;
  l.readLater = !l.readLater;
  save(); render();
}


// Multi-select + bulk action bar live in selection.js (toggleSelectMode/
// exitSelectMode/toggleSelect/selectAllVisible/clearSelection/onBulkFolderChange/
// confirmBulkMove/bulkDelete/bulkAddTag/bulkArchive). selectMode + selectedIds
// are owned there; bulk delete/move use the setLinks/setPending* mutation layer.


// Archiving + the Archive modal live in archive.js (archiveLink/unarchiveLink/
// permanentDeleteLink/updateArchiveBadge/openArchive/closeArchive/renderArchive).


// Link health checking (checkLinks / checkUncheckedLinks) lives in health.js.
// The Stats "Link Health" scan (scanLinksForStats) lives in stats.js.

export function openLink(id, url) {
  const l = links.find(x => x.id === id);
  if (l) { l.visits = (l.visits || 0) + 1; l.lastVisited = Date.now(); save(); }
  window.open(url, '_blank');
}

// Open every (non-archived, non-trashed) link in a folder and its sub-folders in
// new tabs, bumping visits like openLink. Confirms first when there are a lot, so
// a stray click can't fling open dozens of tabs.
export function openAllInFolder(path) {
  const matches = links.filter(l => !l.archived && !l.deleted && pathStartsWith(linkPath(l), path));
  if (!matches.length) { showToast('No links in this folder'); return; }
  if (matches.length > 12 && !confirm(`Open all ${matches.length} links in new tabs?`)) return;
  const now = Date.now();
  matches.forEach(l => { l.visits = (l.visits || 0) + 1; l.lastVisited = now; });
  save();
  matches.forEach(l => window.open(l.url, '_blank'));
  render();
}

// The Stats panel lives in stats.js (openStats/closeStats/openStatLink/
// scanLinksForStats/renderHealthSection/updateHealthSection/renderStats/
// resetStats/toggleStatsNever + its panel state).


// Backup / restore (backupData / openRestore / handleRestoreFile) lives in backup.js.
// Stats panel (resetStats / renderStats) lives in stats.js.

// Color & icon pickers live in pickers.js (renderColorPicker/
// openFolderColorPicker/openSubfolderColorPicker/openTagColorPicker/
// selectPickerColor/resetPickerColor/closeFolderColorPicker/
// openFolderIconPicker/selectFolderIcon/closeFolderIconPicker).
// refreshOpenManagers lives in managers.js.


// ============================================================================
// WINDOW BRIDGE — inline on*="..." handlers need these as globals.
// This file loads as type="module", so declarations are not global by
// default. Add any NEW inline-handler function name here.
// ============================================================================
Object.assign(window, {
  addFeed, addLinkAnyway, addLinkGroup, addNote, addSectionWidget, applyMode, applyTheme,
  autoTitle, backupData, bulkAddTag, bulkArchive, bulkDelete, checkLinks,
  checkUncheckedLinks, clearSearch, clearSelection, closeArchive, closeFeedManager, closeFolderManager,
  closeFolderMove, closeImport, closeModal, closeSettings, closeShortcuts, closeStats, closeTagManager, closeTrash,
  closeTheme, collapseAll, confirmBulkMove, cycleDensity, deleteFolder, doImport,
  emptyTrash, esc, exitSelectMode, expandAll, exportLinks, fetchPageTitle, goHome,
  goManager, handleDrop, handleFile, handleRestoreFile, hideSearchHistory, hideTagSuggest, homeSearchInput, homeShowAll, logout,
  indexAllContent, lgAddSubmit, lgStartRename, linkgroupRemoveItem, noteSave, onBulkFolderChange, onSearchInput,
  onSortChange, onTagInput, onTagKeydown, openArchive, openFeedItem, openFeedManager,
  openFolderColorPicker, openFolderIconPicker, openFolderManager, openImport, openModal, openRestore,
  openShortcuts, openStatLink, openStats, openTagManager, openTheme, openTrash,
  previewCustomAccent, render, renderStats, resetPickerColor, resetStats, saveLink,
  saveSearchTerm, scanLinksForStats, selectAllVisible, selectFolderIcon, selectPickerColor, setBgBlur,
  setBgDim, setBgPreset, setBgType, setBgUrl, setCustomAccent, showSearchHistory,
  startFolderRename, toggleAll, toggleDashboardEdit, toggleDefaultView, toggleFavorites,
  toggleStatsNever,
  toggleFilter, toggleFolder, toggleSelectMode, toggleSettings, toggleView,
  undoAction, updateFilterBadge, uploadWallpaper, widgetRemove, widgetToggle,
});

// ============================================================================
// BOOTSTRAP / INIT
// ============================================================================
applyMode(ui.mode, false);
applyTheme(ui.theme, false);
if (window.matchMedia) {
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => { if (ui.mode === 'auto') applyMode('auto', false); });
}
applyDensity(ui.density);
document.getElementById('viewToggleIcon').className = ui.view === 'grid' ? 'ti ti-layout-list' : 'ti ti-layout-grid';
updateDefaultViewLabel();
setupCardListeners();
setupDragListeners();
window.addEventListener('scroll', hideContextMenu, true);
window.addEventListener('resize', hideContextMenu);
setMode(defaultView, false);
// Gate the data load on auth: 'login' keeps the app blocked behind the overlay;
// 'ok' and 'setup' (open until a password is set) proceed to load.
ensureAuth().then(state => { if (state !== 'login') loadLinks(); });

// Guard: the window bridge above must run at module load (not be trapped inside
// a function), or every inline on*= handler is a dead button. Sentinel-check a
// core handler so a future regression surfaces loudly instead of silently.
if (typeof window.render !== 'function') {
  console.error('MSP Beacon: window bridge did not initialize — inline handlers will not work.');
}
