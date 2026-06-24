import { getFavicon, getDomain, esc, isHexColor, isWebUrl, hexToRgb, hexToHsl, hslToHex, deriveAccent, subKey, timeAgo, linkPath, pathKey, MAX_FOLDER_DEPTH } from './utils.js';
import { ui } from './state.js';
import { applyDensity, cycleDensity, idOrder, sortLinks } from './view.js';
import { applyMode, applyTheme, previewCustomAccent, setCustomAccent, THEMES } from './theme.js';
import { showToast, showUndoToast } from './toast.js';
import { openImport, closeImport, handleDrop, handleFile, toggleAll, doImport } from './import.js';
import { toggleFolder, collapseAll, expandAll, renameFolder, deleteFolder, startFolderRename } from './folders.js';
import { openFolderColorPicker, openTagColorPicker, selectPickerColor, resetPickerColor, closeFolderColorPicker, openFolderIconPicker, selectFolderIcon, closeFolderIconPicker } from './pickers.js';
import { openFolderManager, closeFolderManager, openTagManager, closeTagManager, openFeedManager, closeFeedManager, addFeed } from './managers.js';
import { onContextMenu, hideContextMenu } from './contextmenu.js';
import { selectMode, selectedIds, toggleSelectMode, exitSelectMode, toggleSelect, selectAllVisible, clearSelection, onBulkFolderChange, confirmBulkMove, bulkDelete, bulkAddTag, bulkArchive } from './selection.js';
import { archiveLink, openArchive, closeArchive, updateArchiveBadge } from './archive.js';
import { checkLinks, checkUncheckedLinks } from './health.js';
import { openStats, closeStats, openStatLink, scanLinksForStats, renderStats, resetStats, toggleStatsNever } from './stats.js';
import { setupDragListeners } from './drag.js';
import { parseSearch, linkMatchesFlag, contentMatchIds, contentMatchQuery, onSearchInput, clearSearch, saveSearchTerm, showSearchHistory, hideSearchHistory } from './search.js';

// ============================================================================
// STATE & GLOBALS
// ============================================================================

export let links = [];
export let linkStatus = {};
let editId = null;
let saveTimer = null;
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

function applyHomeBg() {
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
export let visibleIds = [];
let favoritesCollapsed = JSON.parse(localStorage.getItem('msp-fav-collapsed') || 'false');

// ============================================================================
// CONTENT INDEXING
// ============================================================================
// Search querying/filtering + history live in search.js (parseSearch,
// linkMatchesFlag, onSearchInput/updateContentMatches, clearSearch, history).
// contentOnlyIds is computed by render() and read by the card badge, so it
// stays here; render imports contentMatchIds/contentMatchQuery from search.js.
let contentOnlyIds = new Set();    // matched via page text only (no title/url/tag hit) — for the badge
function captureSnapshot(id, url) {
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
  const targets = links.filter(l => !l.archived && isWebUrl(l.url) && !indexed.has(l.id));
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
let homeFolderFilter = null;
let homeClockTimer = null;
let feedLoadToken = 0;
let lastHomeStatusAt = 0;
// stats.js refreshes this after a Link Health scan (can't reassign an imported binding).
export function setLastHomeStatusAt(v) { lastHomeStatusAt = v; }

// --- Dashboard (homepage widget layout) ------------------------------------
// The homepage renders an ordered, toggleable list of widgets. Section widgets
// wrap the existing homepage sections; 'linkgroup' is a user-defined set of link
// tiles. The layout persists in config.json (key: dashboard) + localStorage, so
// it backs up and syncs like every other setting. Existing users with no saved
// layout fall back to DEFAULT_DASHBOARD — i.e. today's exact section order.
const SECTION_WIDGETS = ['clock', 'search', 'favorites', 'readlater', 'recent', 'most-visited', 'recently-added', 'folders', 'latest'];
const WIDGET_LABELS = {
  clock: 'Clock & greeting', search: 'Search box', favorites: 'Favorites',
  readlater: 'Read later', recent: 'Recent', 'most-visited': 'Most visited',
  'recently-added': 'Recently added', folders: 'Folders', latest: 'Latest (RSS)', linkgroup: 'Link group'
};
const WIDGET_ICONS = {
  clock: 'ti-clock', search: 'ti-search', favorites: 'ti-star-filled',
  readlater: 'ti-bookmark', recent: 'ti-history', 'most-visited': 'ti-flame',
  'recently-added': 'ti-clock-plus', folders: 'ti-folders', latest: 'ti-rss', linkgroup: 'ti-apps'
};
const DEFAULT_DASHBOARD = SECTION_WIDGETS.map(type => ({ id: type, type, enabled: true }));
const LINKGROUP_MAX_ITEMS = 50;
let dashboard = JSON.parse(localStorage.getItem('msp-dashboard') || 'null');
export let dashboardEditMode = false;
// One-time dashboard migrations already applied for this user (synced via
// config.json so each migration runs once per user, not once per device, and
// so a widget a user later removes is never silently re-added).
let dashboardMigrations = JSON.parse(localStorage.getItem('msp-dashboard-migrations') || '[]');

function getDashboard() {
  return Array.isArray(dashboard) && dashboard.length ? dashboard : DEFAULT_DASHBOARD.map(w => ({ ...w }));
}
export function persistDashboard() {
  localStorage.setItem('msp-dashboard', JSON.stringify(dashboard));
  saveConfig();
}
// Run pending one-time dashboard migrations. New installs already get every
// widget from DEFAULT_DASHBOARD; these only patch the saved layouts of existing
// users. Each id runs exactly once (tracked in dashboardMigrations).
function migrateDashboard() {
  if (!dashboardMigrations.includes('recently-added-v1')) {
    dashboardMigrations.push('recently-added-v1');
    localStorage.setItem('msp-dashboard-migrations', JSON.stringify(dashboardMigrations));
    // Only existing, customized layouts need patching; null falls back to the
    // default, which already includes the widget.
    if (Array.isArray(dashboard) && dashboard.length && !dashboard.some(w => w.type === 'recently-added')) {
      const widget = { id: 'recently-added', type: 'recently-added', enabled: true };
      const mv = dashboard.findIndex(w => w.type === 'most-visited');
      const fo = dashboard.findIndex(w => w.type === 'folders');
      if (mv !== -1) dashboard.splice(mv + 1, 0, widget);
      else if (fo !== -1) dashboard.splice(fo, 0, widget);
      else dashboard.push(widget);
    }
    persistDashboard(); // writes the dashboard + the migration flag to config
  }
}
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
// Accept only known widget shapes — a restored/hand-edited config must not be
// able to inject unknown types or non-http link URLs into the homepage.
function sanitizeDashboard(arr) {
  if (!Array.isArray(arr)) return null;
  const out = [];
  const seenSection = new Set();
  const seenId = new Set();
  for (const w of arr) {
    if (!w || typeof w !== 'object') continue;
    const type = w.type;
    const enabled = w.enabled !== false;
    if (SECTION_WIDGETS.includes(type)) {
      if (seenSection.has(type)) continue; // one of each section
      seenSection.add(type);
      out.push({ id: type, type, enabled });
    } else if (type === 'linkgroup') {
      // ids are inlined into onclick handlers, so only accept a safe pattern —
      // regenerate anything else (hostile/hand-edited config can't inject script).
      let id = (typeof w.id === 'string' && /^lg-[a-z0-9]+$/i.test(w.id)) ? w.id : '';
      if (!id || seenId.has(id)) id = 'lg-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      seenId.add(id);
      const title = (typeof w.title === 'string' ? w.title : 'Links').slice(0, 60);
      const items = Array.isArray(w.items) ? w.items
        .filter(it => it && typeof it.title === 'string' && typeof it.url === 'string' && /^https?:\/\//i.test(it.url))
        .slice(0, LINKGROUP_MAX_ITEMS)
        .map(it => ({ title: it.title.slice(0, 80), url: it.url })) : [];
      out.push({ id, type: 'linkgroup', enabled, title, items });
    }
  }
  return out.length ? out : null;
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
    dashboard = sanitizeDashboard(cfg.dashboard);
    localStorage.setItem('msp-dashboard', JSON.stringify(dashboard));
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

async function loadLinks() {
  try {
    const [linksRes, cfgRes] = await Promise.all([
      fetch('/api/links'),
      fetch('/api/config').catch(() => null)
    ]);
    const data = await linksRes.json();
    links = Array.isArray(data) ? data : [];
    if (cfgRes && cfgRes.ok) applyServerConfig(await cfgRes.json());
    migrateDashboard();
    migrateFolders();
    render();
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
      const res = await fetch('/api/links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(links)
      });
      if (!res.ok) throw new Error('Server error ' + res.status);
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
  links = pendingDelete.saved;
  pendingDelete = null;
  render();
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
function tagHtml(t) {
  const tc = getTagColor(t);
  const style = tc ? ` style="background:rgba(${hexToRgb(tc)},.2);color:${tc};border-color:${tc}"` : '';
  return `<span class="tag" data-tag="${esc(t)}" title="Filter by &quot;${esc(t)}&quot;"${style}>${esc(t)}</span>`;
}
export function getFolderIcon(path) { return folderIcons[pathKey(asPath(path))] || 'ti-folder'; }
// Segment names directly under parentPath ([] = top level), derived from links.
export function childFolders(parentPath) {
  const d = parentPath.length, names = new Set();
  links.filter(l => !l.archived).forEach(l => {
    const p = linkPath(l);
    if (p.length > d && pathStartsWith(p, parentPath)) names.add(p[d]);
  });
  return [...names];
}
export function allFolders() { return childFolders([]).sort(); }
// pathKey of every folder node at any depth (each prefix of every link path).
export function allFolderPaths() {
  const set = new Set();
  links.filter(l => !l.archived).forEach(l => {
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
export function allTags() { return [...new Set(links.filter(l => !l.archived).flatMap(l => l.tags || []))].sort(); }

export function subfoldersByFolder(folderName) {
  return childFolders([folderName]).sort();
}


// ============================================================================
// NAVIGATION & VIEW SWITCHING
// ============================================================================
function setMode(mode, navigated = true) {
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
  if (mode !== 'home') { clearInterval(homeClockTimer); homeClockTimer = null; dashboardEditMode = false; }
  render();
}
function goHome() { setMode('home'); }
function goManager() { setMode('manager'); }

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
// HOME / DASHBOARD RENDERING
// ============================================================================
function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}
function updateClock() {
  const t = document.getElementById('homeTime');
  if (!t) { clearInterval(homeClockTimer); homeClockTimer = null; return; }
  const now = new Date();
  let h = now.getHours(); const m = now.getMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12; if (h === 0) h = 12;
  t.textContent = `${h}:${String(m).padStart(2, '0')} ${ampm}`;
  const g = document.getElementById('homeGreeting');
  if (g) g.textContent = greeting();
}

function homeTileHtml(l, draggable) {
  const fav = getFavicon(l.url);
  const fi = fav
    ? `<img src="${fav}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><span style="display:none;width:100%;height:100%;align-items:center;justify-content:center"><i class="ti ti-world"></i></span>`
    : `<i class="ti ti-world"></i>`;
  return `<div class="home-tile"${draggable ? ' draggable="true"' : ''} data-id="${esc(l.id)}" data-url="${esc(l.url)}" title="${esc(l.title)}"><div class="home-tile-icon">${fi}<span class="home-tile-dot ${statusDotClass(l.id)}"></span></div><div class="home-tile-label">${esc(l.title)}</div></div>`;
}
function homeFolderTileHtml(f, draggable = true) {
  const fc = getFolderColor(f);
  return `<div class="home-tile home-folder-tile"${draggable ? ' draggable="true"' : ''} data-folder="${esc(f)}" title="${esc(f)}"><div class="home-tile-icon" style="background:rgba(${hexToRgb(fc)},.15)"><i class="ti ${getFolderIcon(f)}" style="color:${fc}"></i></div><div class="home-tile-label">${esc(f)}</div></div>`;
}
function homeSection(title, icon, tilesHtml, count, key) {
  if (!count) return '';
  const secAttr = key === 'favorites' ? ' data-home-section="favorites"' : '';
  return `<div class="home-section"><div class="home-section-head"><i class="ti ${icon}" style="font-size:14px;color:var(--g3)"></i><span class="home-section-title">${title}</span><button class="home-section-all" onclick="homeShowAll('${key}')">show all <i class="ti ti-arrow-right"></i></button></div><div class="home-tiles"${secAttr}>${tilesHtml}</div></div>`;
}
function homeShowAll(key) {
  if (key === 'most-visited') { ui.sort = 'most-visited'; localStorage.setItem('msp-sort', ui.sort); }
  else if (key === 'recently-added') { ui.sort = 'newest'; localStorage.setItem('msp-sort', ui.sort); }
  else if (key === 'recent') { ui.sort = 'recent'; localStorage.setItem('msp-sort', ui.sort); }
  else if (key === 'readlater') { const el = document.getElementById('statusFilter'); if (el) el.value = 'readlater'; }
  goManager();
}
function homeSearchInput(v) {
  document.getElementById('search').value = v;
  document.getElementById('searchClear').style.display = v ? '' : 'none';
  if (v.trim()) {
    document.getElementById('folderFilter').value = '';
    document.getElementById('tagFilter').value = '';
    const stEl = document.getElementById('statusFilter'); if (stEl) stEl.value = '';
    setMode('manager');
    const s = document.getElementById('search');
    s.focus();
    const len = s.value.length;
    s.setSelectionRange(len, len);
  }
}
export function openFolderFromHome(folder) {
  homeFolderFilter = folder;
  setMode('manager');
}

// Reorder a favorite by moving its record just before the target's in `links`
// (same model as manager card reorder — favorites render in links-array order).
export function reorderFavorite(srcId, tgtId) {
  const si = links.findIndex(l => l.id === srcId);
  if (si < 0) return;
  const [moved] = links.splice(si, 1);
  const ti = links.findIndex(l => l.id === tgtId);
  if (ti < 0) { links.splice(si, 0, moved); return; }
  links.splice(ti, 0, moved);
  save(); render();
}

// A linkgroup tile opens a user-entered URL (not a saved link), so it carries
// data-href instead of data-id — no visit bump, no status dot.
function linkgroupTileHtml(it, gid, idx) {
  const fav = getFavicon(it.url);
  const fi = fav
    ? `<img src="${fav}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><span style="display:none;width:100%;height:100%;align-items:center;justify-content:center"><i class="ti ti-world"></i></span>`
    : `<i class="ti ti-world"></i>`;
  const rm = dashboardEditMode
    ? `<button class="lg-tile-remove" title="Remove link" onclick="linkgroupRemoveItem('${gid}',${idx})"><i class="ti ti-x"></i></button>` : '';
  return `<div class="home-tile" data-href="${esc(it.url)}" title="${esc(it.title)}"><div class="home-tile-icon">${fi}${rm}</div><div class="home-tile-label">${esc(it.title)}</div></div>`;
}

// Build the inner content for a single widget. Returns '' for a data-driven
// widget that is empty when NOT editing (preserves today's auto-hide behavior).
function widgetInner(w, data) {
  const edit = dashboardEditMode;
  const placeholder = '<div class="home-widget-empty">Nothing to show yet</div>';
  switch (w.type) {
    case 'clock':
      return `<div class="home-clock"><div class="home-time" id="homeTime"></div><div class="home-greeting" id="homeGreeting"></div></div>`;
    case 'search':
      return `<div class="home-search-wrap"><i class="ti ti-search search-icon"></i><input type="text" class="home-search" id="homeSearch" placeholder="Search your links…" autocomplete="off" oninput="homeSearchInput(this.value)"></div>`;
    case 'favorites':
      if (!data.favorites.length) return edit ? sectionShell('Favorites', 'ti-star-filled', placeholder) : '';
      return homeSection('Favorites', 'ti-star-filled', data.favorites.map(l => homeTileHtml(l, !edit)).join(''), 1, 'favorites');
    case 'readlater':
      if (!data.readlater.length) return edit ? sectionShell('Read later', 'ti-bookmark', placeholder) : '';
      return homeSection('Read later', 'ti-bookmark', data.readlater.map(l => homeTileHtml(l, false)).join(''), 1, 'readlater');
    case 'recent':
      if (!data.recent.length) return edit ? sectionShell('Recent', 'ti-history', placeholder) : '';
      return homeSection('Recent', 'ti-history', data.recent.map(l => homeTileHtml(l, false)).join(''), 1, 'recent');
    case 'most-visited':
      if (!data['most-visited'].length) return edit ? sectionShell('Most visited', 'ti-flame', placeholder) : '';
      return homeSection('Most visited', 'ti-flame', data['most-visited'].map(l => homeTileHtml(l, false)).join(''), 1, 'most-visited');
    case 'recently-added':
      if (!data['recently-added'].length) return edit ? sectionShell('Recently added', 'ti-clock-plus', placeholder) : '';
      return homeSection('Recently added', 'ti-clock-plus', data['recently-added'].map(l => homeTileHtml(l, false)).join(''), 1, 'recently-added');
    case 'folders':
      if (!data.folders.length) return edit ? sectionShell('Folders', 'ti-folders', placeholder) : '';
      return homeSection('Folders', 'ti-folders', data.folders.map(f => homeFolderTileHtml(f, !edit)).join(''), 1, 'folders');
    case 'latest':
      if (!rssFeeds.length) return edit ? sectionShell('Latest', 'ti-rss', '<div class="home-widget-empty">No feeds configured</div>') : '';
      // A disabled latest widget (only reachable in edit mode) shows a static
      // preview — never the live #homeFeed container, which would spin forever
      // since loadHomeFeeds() only runs for an enabled latest widget.
      if (!w.enabled) return sectionShell('Latest', 'ti-rss', '<div class="home-widget-empty">Latest headlines</div>');
      return `<div class="home-section"><div class="home-section-head"><i class="ti ti-rss" style="font-size:14px;color:var(--g3)"></i><span class="home-section-title">Latest</span><button class="home-section-all" onclick="closeSettings();openFeedManager()">manage <i class="ti ti-settings"></i></button></div><div class="home-feed" id="homeFeed"><div class="home-feed-msg"><i class="ti ti-loader" style="animation:spin 1s linear infinite"></i> Loading feeds…</div></div></div>`;
    case 'linkgroup': {
      const items = w.items || [];
      if (!items.length && !edit) return '';
      const tiles = items.length ? `<div class="home-tiles">${items.map((it, i) => linkgroupTileHtml(it, w.id, i)).join('')}</div>` : '';
      const emptyMsg = (!items.length && edit) ? '<div class="home-widget-empty">No links yet — add one below.</div>' : '';
      const addForm = edit
        ? `<div class="lg-add-form">`
          + `<input class="lg-add-url" type="text" placeholder="https://… URL" autocomplete="off" onkeydown="if(event.key==='Enter'){event.preventDefault();lgAddSubmit('${w.id}',this)}">`
          + `<input class="lg-add-title" type="text" placeholder="Label (optional)" autocomplete="off" onkeydown="if(event.key==='Enter'){event.preventDefault();lgAddSubmit('${w.id}',this)}">`
          + `<button class="btn" onclick="lgAddSubmit('${w.id}',this)"><i class="ti ti-plus"></i> Add</button>`
          + `</div>`
        : '';
      return `<div class="home-section"><div class="home-section-head"><i class="ti ti-apps" style="font-size:14px;color:var(--g3)"></i><span class="home-section-title">${esc(w.title || 'Links')}</span></div>${tiles}${emptyMsg}${addForm}</div>`;
    }
    default: return '';
  }
}
// A section header + body with no tiles (used for empty widgets in edit mode).
function sectionShell(title, icon, body) {
  return `<div class="home-section"><div class="home-section-head"><i class="ti ${icon}" style="font-size:14px;color:var(--g3)"></i><span class="home-section-title">${title}</span></div>${body}</div>`;
}

// Edit-mode toolbar shown above each widget (drag handle, label, show/hide, and
// link-group controls). Widget ids are validated to /^lg-[a-z0-9]+$/i or are a
// fixed section name, so inlining them in onclick is safe.
function widgetToolbar(w) {
  const label = w.type === 'linkgroup' ? (w.title || 'Link group') : (WIDGET_LABELS[w.type] || w.type);
  let extra = '';
  if (w.type === 'linkgroup') {
    extra = `<button class="icon-btn lg-rename-btn" title="Rename group" onclick="lgStartRename('${w.id}',this)"><i class="ti ti-pencil"></i></button>`
          + `<button class="icon-btn" style="color:#E24B4A" title="Remove widget" onclick="widgetRemove('${w.id}')"><i class="ti ti-trash"></i></button>`;
  }
  return `<div class="widget-toolbar"><span class="widget-drag-handle" draggable="true" title="Drag to reorder"><i class="ti ti-grip-vertical"></i></span><i class="ti ${WIDGET_ICONS[w.type] || 'ti-square'} widget-tb-icon"></i><span class="widget-tb-label">${esc(label)}</span><button class="icon-btn" title="${w.enabled ? 'Hide' : 'Show'}" onclick="widgetToggle('${w.id}')"><i class="ti ${w.enabled ? 'ti-eye' : 'ti-eye-off'}"></i></button>${extra}</div>`;
}

function renderWidget(w, data) {
  if (!w.enabled && !dashboardEditMode) return '';
  const inner = widgetInner(w, data);
  if (!dashboardEditMode) return inner; // normal mode: identical DOM to before, no wrapper
  return `<div class="home-widget${w.enabled ? '' : ' disabled'}" data-widget-id="${esc(w.id)}">${widgetToolbar(w)}${inner}</div>`;
}

export function renderHome() {
  const c = document.getElementById('content');
  const active = links.filter(l => !l.archived);
  const data = {
    favorites: active.filter(l => l.favorite).slice(0, 8),
    readlater: active.filter(l => l.readLater).slice(0, 8),
    recent: active.filter(l => l.lastVisited).sort((a, b) => (b.lastVisited || 0) - (a.lastVisited || 0)).slice(0, 8),
    'most-visited': active.filter(l => (l.visits || 0) > 0).sort((a, b) => (b.visits || 0) - (a.visits || 0)).slice(0, 8),
    'recently-added': active.slice().sort((a, b) => idOrder(b.id) - idOrder(a.id)).slice(0, 8),
    folders: getOrderedFolders(allFolders()).slice(0, 8),
  };
  const list = getDashboard();

  let html = `<div class="home${dashboardEditMode ? ' editing' : ''}">`;
  if (dashboardEditMode) {
    html += `<div class="dashboard-edit-banner"><i class="ti ti-layout-dashboard"></i><span>Editing dashboard — drag to reorder, toggle the eye to show/hide.</span><button class="btn btn-primary" onclick="toggleDashboardEdit()"><i class="ti ti-check"></i> Done</button></div>`;
  }
  html += list.map(w => renderWidget(w, data)).join('');
  if (dashboardEditMode) {
    const present = new Set(list.map(w => w.type));
    const chips = SECTION_WIDGETS.filter(t => !present.has(t))
      .map(t => `<button class="btn" onclick="addSectionWidget('${t}')"><i class="ti ${WIDGET_ICONS[t]}"></i> ${esc(WIDGET_LABELS[t])}</button>`).join('');
    html += `<div class="add-widget-bar"><span class="add-widget-label">Add widget</span>${chips}<button class="btn" onclick="addLinkGroup()"><i class="ti ti-apps"></i> Link group</button></div>`;
  }
  html += '</div>';
  c.innerHTML = html;

  updateClock();
  clearInterval(homeClockTimer);
  homeClockTimer = setInterval(updateClock, 1000);
  if (rssFeeds.length && list.some(w => w.type === 'latest' && w.enabled)) loadHomeFeeds();
  loadHomeStatus();
  updateArchiveBadge();
  applyHomeBg();
}

// --- Dashboard edit actions -------------------------------------------------
// Materialize the default layout into a concrete array before mutating, so the
// first edit of an unconfigured dashboard starts from today's section order.
export function ensureDashboard() {
  if (!Array.isArray(dashboard) || !dashboard.length) dashboard = DEFAULT_DASHBOARD.map(w => ({ ...w }));
  return dashboard;
}
function toggleDashboardEdit() {
  dashboardEditMode = !dashboardEditMode;
  if (dashboardEditMode) ensureDashboard();
  closeSettings();
  if (currentMode !== 'home') setMode('home'); else render();
  const btn = document.getElementById('editDashBtn');
  if (btn) btn.classList.toggle('active', dashboardEditMode);
}
function widgetToggle(id) {
  const w = ensureDashboard().find(x => x.id === id);
  if (!w) return;
  w.enabled = !w.enabled;
  persistDashboard(); render();
}
function widgetRemove(id) {
  dashboard = ensureDashboard().filter(x => x.id !== id);
  persistDashboard(); render();
}
function addSectionWidget(type) {
  if (!SECTION_WIDGETS.includes(type)) return;
  const d = ensureDashboard();
  if (d.some(w => w.type === type)) return;
  d.push({ id: type, type, enabled: true });
  persistDashboard(); render();
}
function addLinkGroup() {
  const id = 'lg-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  ensureDashboard().push({ id, type: 'linkgroup', enabled: true, title: 'New group', items: [] });
  persistDashboard(); render();
  const btn = document.querySelector(`.home-widget[data-widget-id="${id}"] .lg-rename-btn`);
  if (btn) lgStartRename(id, btn); // start naming the new group immediately
}
// Inline rename of a link group's title — replaces the toolbar label with an
// input; commit on blur/Enter, cancel on Escape (same pattern as the Tag
// Manager's tmgrStartRename).
function lgStartRename(id, btn) {
  const toolbar = btn.closest('.widget-toolbar');
  const w = ensureDashboard().find(x => x.id === id);
  const span = toolbar && toolbar.querySelector('.widget-tb-label');
  if (!w || !span) return;
  const old = w.title || 'Links';
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'fmgr-input lg-rename-input';
  input.value = old;
  span.replaceWith(input);
  input.focus(); input.select();
  let committed = false;
  function commit() {
    if (committed) return; committed = true;
    const v = input.value.trim();
    if (v && v !== old) { w.title = v.slice(0, 60); persistDashboard(); }
    render();
  }
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    else if (e.key === 'Escape') { e.stopPropagation(); committed = true; render(); }
  });
}
// Add a link to a group from the inline add-form (URL + optional label),
// mirroring the feed manager's addFeed(). Refocuses the URL field for rapid entry.
function lgAddSubmit(id, el) {
  const form = el.closest('.lg-add-form');
  if (!form) return;
  const urlEl = form.querySelector('.lg-add-url');
  const titleEl = form.querySelector('.lg-add-title');
  let url = urlEl.value.trim();
  if (!url) { urlEl.focus(); return; }
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  try { new URL(url); } catch { showToast('Invalid URL', true); return; }
  const w = ensureDashboard().find(x => x.id === id);
  if (!w || w.type !== 'linkgroup') return;
  if ((w.items || []).length >= LINKGROUP_MAX_ITEMS) { showToast('Link group is full', true); return; }
  const title = titleEl.value.trim() || getDomain(url);
  w.items = [...(w.items || []), { title: title.slice(0, 80), url }];
  persistDashboard(); render();
  const next = document.querySelector(`.home-widget[data-widget-id="${id}"] .lg-add-url`);
  if (next) next.focus();
}
function linkgroupRemoveItem(id, idx) {
  const w = ensureDashboard().find(x => x.id === id);
  if (!w || !Array.isArray(w.items)) return;
  w.items.splice(idx, 1);
  persistDashboard(); render();
}

// Fetch every configured feed in parallel, merge + sort by date, show the newest.
async function loadHomeFeeds() {
  const token = ++feedLoadToken;
  const results = await Promise.all(rssFeeds.map(async f => {
    try {
      const r = await fetch('/api/rss?url=' + encodeURIComponent(f.url));
      if (!r.ok) return { ok: false, name: f.name || f.url };
      const data = await r.json();
      const src = f.name || data.title || getDomain(f.url);
      return { ok: !data.error, name: src, items: (data.items || []).map(it => ({ ...it, src })) };
    } catch { return { ok: false, name: f.name || f.url }; }
  }));
  if (token !== feedLoadToken) return; // a newer load superseded us
  const el = document.getElementById('homeFeed');
  if (!el) return;
  const merged = [];
  results.forEach(r => { if (r.items) merged.push(...r.items); });
  merged.sort((a, b) => (b.ts || 0) - (a.ts || 0));
  const top = merged.slice(0, 12);
  if (!top.length) {
    const failed = results.filter(r => !r.ok).length;
    el.innerHTML = `<div class="home-feed-msg">${failed ? 'Could not reach ' + failed + ' feed' + (failed !== 1 ? 's' : '') + '.' : 'No items yet.'}</div>`;
    return;
  }
  el.innerHTML = top.map(it => `<div class="feed-item" data-url="${esc(it.link)}" title="${esc(it.title)}" onclick="openFeedItem(this.dataset.url)"><span class="feed-item-title">${esc(it.title)}</span><span class="feed-item-meta"><span class="feed-item-src">${esc(it.src)}</span><span>${esc(timeAgo(it.ts))}</span></span></div>`).join('');
}

function openFeedItem(url) { window.open(url, '_blank', 'noopener'); }

// Live up/down dots on homepage link tiles, reusing /api/check-links.
function statusDotClass(id) {
  const s = linkStatus[id];
  if (s === 'ok') return 'up';
  if (s === 'broken' || s === 'timeout') return 'down';
  return '';
}
function paintHomeDots() {
  document.querySelectorAll('.home-tile[data-id]').forEach(t => {
    const d = t.querySelector('.home-tile-dot');
    if (d) d.className = 'home-tile-dot ' + statusDotClass(t.dataset.id);
  });
}
async function loadHomeStatus() {
  const tiles = [...document.querySelectorAll('.home-tile[data-id]')];
  const ids = [...new Set(tiles.map(t => t.dataset.id))];
  if (!ids.length) return;
  // Skip the network call if we checked recently and already know every tile.
  if (Date.now() - lastHomeStatusAt < 90000 && ids.every(id => linkStatus[id] !== undefined)) {
    paintHomeDots();
    return;
  }
  // Show a pulsing grey dot only on tiles we have no status for yet.
  tiles.forEach(t => {
    const d = t.querySelector('.home-tile-dot');
    if (d && linkStatus[t.dataset.id] === undefined) d.className = 'home-tile-dot checking';
  });
  try {
    const res = await fetch('/api/check-links?ids=' + ids.map(encodeURIComponent).join(','));
    if (!res.ok) throw new Error('status ' + res.status);
    Object.assign(linkStatus, await res.json());
    lastHomeStatusAt = Date.now();
  } catch { /* leave known dots; clear the pulsing ones below */ }
  paintHomeDots();
}


// ============================================================================
// MAIN RENDER — GRID / LIST / FOLDERS
// ============================================================================
export function render() {
  applyHomeBg();
  if (currentMode === 'home') { renderHome(); return; }
  const q = document.getElementById('search').value.toLowerCase();
  const clearBtn = document.getElementById('searchClear');
  if (clearBtn) clearBtn.style.display = q ? '' : 'none';
  let ff = document.getElementById('folderFilter').value;
  if (homeFolderFilter !== null) { ff = homeFolderFilter; homeFolderFilter = null; }
  const tf = document.getElementById('tagFilter').value;
  const stf = document.getElementById('statusFilter')?.value || '';
  const fs = document.getElementById('folderFilter'), ts = document.getElementById('tagFilter');
  fs.innerHTML = '<option value="">All folders</option>' + allFolders().map(f => `<option value="${esc(f)}"${f===ff?' selected':''}>${esc(f)}</option>`).join('');
  ts.innerHTML = '<option value="">All tags</option>' + allTags().map(t => `<option value="${esc(t)}"${t===tf?' selected':''}>${esc(t)}</option>`).join('');
  const sortEl = document.getElementById('sortSelect');
  if (sortEl) sortEl.value = ui.sort;
  updateFilterBadge();
  const parsed = parseSearch(q);
  const wantArchived = parsed.flags.includes('archived');
  const contentActive = parsed.text && contentMatchQuery === parsed.text;
  contentOnlyIds = new Set();
  let fil = links.filter(l => {
    if (wantArchived) { if (!l.archived) return false; }
    else if (l.archived) return false;
    if (ff && l.folder !== ff) return false;
    if (tf && !(l.tags || []).some(t => t.toLowerCase() === tf.toLowerCase())) return false;
    if (stf === 'readlater' && !l.readLater) return false;
    for (const flag of parsed.flags) { if (flag !== 'archived' && !linkMatchesFlag(l, flag)) return false; }
    if (parsed.tags.length) {
      const lt = (l.tags || []).map(t => t.toLowerCase());
      if (!parsed.tags.every(tg => lt.some(t => t.includes(tg)))) return false;
    }
    if (parsed.folders.length) {
      const lf = (l.folder || '').toLowerCase(), lsf = (l.subfolder || '').toLowerCase();
      if (!parsed.folders.some(fd => lf.includes(fd) || lsf.includes(fd))) return false;
    }
    if (parsed.text) {
      const textMatch = (l.title+l.url+l.desc+(l.folder||'')+(l.subfolder||'')+(l.tags||[]).join(' ')).toLowerCase().includes(parsed.text);
      const contentMatch = contentActive && contentMatchIds.has(l.id);
      if (!textMatch && !contentMatch) return false;
      if (!textMatch && contentMatch) contentOnlyIds.add(l.id);
    }
    return true;
  });
  fil = sortLinks(fil);
  visibleIds = fil.map(l => l.id);
  const c = document.getElementById('content');
  // When filtering by health status, warn if some links haven't been checked yet — their
  // status is unknown so is:broken/is:online results may be incomplete. Offer a one-click scan.
  let healthHint = '';
  if (!wantArchived && (parsed.flags.includes('broken') || parsed.flags.includes('online'))) {
    const webLinks = links.filter(l => !l.archived && isWebUrl(l.url));
    const unchecked = webLinks.filter(l => linkStatus[l.id] === undefined).length;
    if (unchecked > 0) {
      healthHint = `<div class="health-hint">
        <span class="health-hint-msg"><i class="ti ti-alert-circle health-hint-icon"></i>${unchecked} of ${webLinks.length} links not yet checked — results may be incomplete.</span>
        <button class="health-hint-btn" id="healthHintBtn" onclick="checkUncheckedLinks()"><i class="ti ti-wifi"></i> Check links now</button>
      </div>`;
    }
  }
  if (!fil.length) {
    c.innerHTML = healthHint + `<div class="empty"><i class="ti ti-bookmarks"></i>${links.length ? 'No results match your filters.' : 'No links yet — click <strong>Add link</strong> or <strong>Import</strong> to get started.'}</div>`;
    return;
  }
  const cardFn = ui.view === 'list' ? cardListHtml : cardHtml;
  const wrap = items => ui.view === 'list' ? `<div class="link-list">${items.map(cardFn).join('')}</div>` : `<div class="grid">${items.map(cardFn).join('')}</div>`;
  if (ff || q || tf || stf) { c.innerHTML = healthHint + wrap(fil); return; }
  const noF = fil.filter(l => linkPath(l).length === 0);
  let html = '';
  const favs = fil.filter(l => l.favorite);
  if (favs.length) {
    html += `<div class="favorites-section"><div class="favorites-header" onclick="toggleFavorites()"><i class="ti ti-chevron-right folder-chevron${favoritesCollapsed ? '' : ' open'}"></i><i class="ti ti-star-filled" style="font-size:15px;color:#F5A623"></i><span class="favorites-title">Favorites</span><span class="count-pill" style="background:rgba(245,166,35,.3);color:#F5A623">${favs.length}</span></div>${favoritesCollapsed ? '' : wrap(favs)}</div>`;
  }
  if (noF.length) html += wrap(noF);
  getOrderedFolders([], uniqueChildren(fil, [])).forEach(name => { html += renderFolderSection(fil, [name], wrap); });
  c.innerHTML = html;
  updateArchiveBadge();
}

// Direct child folder-segment names under parentPath among the given links.
function uniqueChildren(linksArr, parentPath) {
  const d = parentPath.length, names = new Set();
  linksArr.forEach(l => { const p = linkPath(l); if (p.length > d && pathStartsWith(p, parentPath)) names.add(p[d]); });
  return [...names];
}

// Recursively render one folder (at `path`) and, nested inside it, its direct
// links followed by its child folders. data-path carries pathKey(path); the
// header handlers parse it back. Indentation is purely CSS (.folder-content
// padding) since child sections are nested in the DOM.
function renderFolderSection(fil, path, wrap) {
  const d = path.length;
  const directLinks = fil.filter(l => { const p = linkPath(l); return p.length === d && pathStartsWith(p, path); });
  const descendantCount = fil.filter(l => pathStartsWith(linkPath(l), path)).length;
  const collapsed = collapsedFolders.has(pathKey(path));
  const fc = getFolderColor(path);
  const fcRgb = hexToRgb(fc);
  const key = esc(pathKey(path));
  let content = '';
  if (!collapsed) {
    if (directLinks.length) content += wrap(directLinks);
    getOrderedFolders(path, uniqueChildren(fil, path)).forEach(cn => { content += renderFolderSection(fil, [...path, cn], wrap); });
  }
  return `<div class="folder-section"><div class="folder-header" onclick="toggleFolder(this.dataset.path)" data-path="${key}" style="background:rgba(${fcRgb},.15);border-color:${fc}">`
    + `<div class="folder-drag-handle" draggable="true" title="Drag to reorder folder" onclick="event.stopPropagation()"><i class="ti ti-grip-vertical"></i></div>`
    + `<i class="ti ti-chevron-right folder-chevron${collapsed ? '' : ' open'}" style="color:${fc}"></i>`
    + `<i class="ti ${getFolderIcon(path)} folder-icon-btn" style="font-size:16px;color:${fc};cursor:pointer" onclick="event.stopPropagation();openFolderIconPicker(this.closest('.folder-header').dataset.path,this)" title="Change icon"></i>`
    + `<span class="folder-name">${esc(path[path.length - 1])}</span>`
    + `<button class="folder-rename-btn" onclick="event.stopPropagation();startFolderRename(this)" title="Rename folder"><i class="ti ti-pencil"></i></button>`
    + `<button class="folder-rename-btn" onclick="event.stopPropagation();deleteFolder(this.closest('.folder-header').dataset.path)" title="Delete folder" style="color:#E24B4A"><i class="ti ti-trash"></i></button>`
    + `<span class="count-pill" style="background:${fc}">${descendantCount}</span>`
    + `<div class="folder-color-swatch" onclick="event.stopPropagation();openFolderColorPicker(this.closest('.folder-header').dataset.path,this)" style="width:16px;height:16px;border-radius:50%;background:${fc};cursor:pointer;margin-left:auto;flex-shrink:0;border:1.5px solid var(--ring)"></div>`
    + `</div><div class="folder-content" data-path="${key}">${content}</div></div>`;
}

function contentBadge(id) {
  return contentOnlyIds.has(id) ? `<span class="content-badge" title="Matched in the page text"><i class="ti ti-file-search"></i> in page</span>` : '';
}
// Card folder badge ("A / B / C") + left-border color, from the link's path.
function folderBadgeHtml(l, extraStyle = '') {
  const p = linkPath(l);
  return p.length ? `<span class="folder-badge"${extraStyle ? ` style="${extraStyle}"` : ''}><i class="ti ti-folder" style="font-size:11px"></i> ${esc(p.join(' / '))}</span>` : '';
}
function cardBorderStyle(l) {
  const p = linkPath(l);
  return p.length ? ` style="border-left:3px solid ${getFolderColor(p)}"` : '';
}
function cardHtml(l) {
  const fav = getFavicon(l.url);
  const fi = fav ? `<img src="${fav}" alt="" onerror="this.style.display='none';this.nextSibling.style.display='flex'"><span style="display:none"><i class="ti ti-world"></i></span>` : `<i class="ti ti-world"></i>`;
  const starBtn = selectMode ? '' : `<button class="star-btn${l.favorite ? ' active' : ''}" data-action="favorite" data-id="${esc(l.id)}" title="${l.favorite ? 'Remove from favorites' : 'Add to favorites'}"><i class="ti ti-star${l.favorite ? '-filled' : ''}"></i></button>`;
  const rlBtn = selectMode ? '' : `<button class="rl-btn${l.readLater ? ' active' : ''}" data-action="readlater" data-id="${esc(l.id)}" title="${l.readLater ? 'Remove from read later' : 'Save to read later'}"><i class="ti ti-bookmark${l.readLater ? '-filled' : ''}"></i></button>`;
  const footer = `<div class="card-footer">
      ${starBtn}
      ${rlBtn}
      ${(l.tags || []).map(tagHtml).join('')}
      ${contentBadge(l.id)}
      ${folderBadgeHtml(l)}
    </div>`;
  const top = `<div class="card-top"><div class="favicon">${fi}</div>
      <div style="min-width:0"><div class="card-title">${esc(l.title)}</div><div class="card-url">${esc(getDomain(l.url))}</div>${l.lastVisited ? `<div style="font-size:11px;color:var(--text2);margin-top:1px">${timeAgo(l.lastVisited)}</div>` : ''}</div>
    </div>`;
  const statusBadge = (linkStatus[l.id] === 'broken' || linkStatus[l.id] === 'timeout')
    ? `<div class="status-badge" title="${linkStatus[l.id] === 'timeout' ? 'Link timed out' : 'Link appears broken'}"><i class="ti ti-alert-triangle"></i></div>`
    : '';
  if (selectMode) {
    const checked = selectedIds.has(l.id);
    return `<div class="card select-mode${checked ? ' selected' : ''}" data-id="${esc(l.id)}">
      <div class="card-check${checked ? ' checked' : ''}"><i class="ti ti-check"></i></div>
      ${statusBadge}
      ${top}
      ${l.desc ? `<div class="card-desc">${esc(l.desc)}</div>` : ''}
      ${footer}
    </div>`;
  }
  return `<div class="card" data-id="${esc(l.id)}" data-url="${esc(l.url)}"${cardBorderStyle(l)}>
    <div class="card-actions">
      <div class="drag-handle" draggable="true" title="Drag to reorder"><i class="ti ti-grip-vertical"></i></div>
      <button class="icon-btn" title="Copy URL" data-action="copy" data-id="${esc(l.id)}" data-url="${esc(l.url)}"><i class="ti ti-copy"></i></button>
      <button class="icon-btn" title="Edit" data-action="edit" data-id="${esc(l.id)}"><i class="ti ti-edit"></i></button>
      <button class="icon-btn" title="Archive" data-action="archive" data-id="${esc(l.id)}"><i class="ti ti-archive"></i></button>
      <button class="icon-btn" title="Delete" data-action="delete" data-id="${esc(l.id)}"><i class="ti ti-trash"></i></button>
    </div>
    ${statusBadge}
    ${top}
    ${l.desc ? `<div class="card-desc">${esc(l.desc)}</div>` : ''}
    ${footer}
  </div>`;
}

function cardListHtml(l) {
  const fav = getFavicon(l.url);
  const fi = fav ? `<img src="${fav}" alt="" onerror="this.style.display='none';this.nextSibling.style.display='flex'"><span style="display:none"><i class="ti ti-world"></i></span>` : `<i class="ti ti-world"></i>`;
  const statusBadge = (linkStatus[l.id] === 'broken' || linkStatus[l.id] === 'timeout')
    ? `<i class="ti ti-alert-triangle" style="font-size:13px;color:#E24B4A;flex-shrink:0" title="${linkStatus[l.id] === 'timeout' ? 'Link timed out' : 'Link appears broken'}"></i>`
    : '';
  if (selectMode) {
    const checked = selectedIds.has(l.id);
    return `<div class="card-row select-mode${checked ? ' selected' : ''}" data-id="${esc(l.id)}">
      <div class="card-check${checked ? ' checked' : ''}" style="position:static;flex-shrink:0"><i class="ti ti-check"></i></div>
      <div class="favicon">${fi}</div>
      ${statusBadge}
      <span class="card-row-title">${esc(l.title)}</span>
      <span class="card-row-domain">${esc(getDomain(l.url))}</span>
      <div class="card-row-tags">${(l.tags || []).map(tagHtml).join('')}</div>
      ${folderBadgeHtml(l, 'margin-left:0')}
    </div>`;
  }
  return `<div class="card-row" data-id="${esc(l.id)}" data-url="${esc(l.url)}"${cardBorderStyle(l)}>
    <div class="favicon">${fi}</div>
    ${statusBadge}
    <span class="card-row-title">${esc(l.title)}</span>
    <span class="card-row-domain">${esc(getDomain(l.url))}</span>
    ${l.lastVisited ? `<span style="font-size:11px;color:var(--text2);flex-shrink:0">${timeAgo(l.lastVisited)}</span>` : ''}
    <div class="card-row-tags">${(l.tags || []).map(tagHtml).join('')}</div>
    ${contentBadge(l.id)}
    ${folderBadgeHtml(l, 'margin-left:0')}
    <button class="star-btn${l.favorite ? ' active' : ''}" data-action="favorite" data-id="${esc(l.id)}" title="${l.favorite ? 'Remove from favorites' : 'Add to favorites'}" style="flex-shrink:0"><i class="ti ti-star${l.favorite ? '-filled' : ''}"></i></button>
    <button class="rl-btn${l.readLater ? ' active' : ''}" data-action="readlater" data-id="${esc(l.id)}" title="${l.readLater ? 'Remove from read later' : 'Save to read later'}" style="flex-shrink:0"><i class="ti ti-bookmark${l.readLater ? '-filled' : ''}"></i></button>
    <div class="card-row-actions">
      <button class="icon-btn" title="Copy URL" data-action="copy" data-id="${esc(l.id)}" data-url="${esc(l.url)}"><i class="ti ti-copy"></i></button>
      <button class="icon-btn" title="Edit" data-action="edit" data-id="${esc(l.id)}"><i class="ti ti-edit"></i></button>
      <button class="icon-btn" title="Archive" data-action="archive" data-id="${esc(l.id)}"><i class="ti ti-archive"></i></button>
      <button class="icon-btn" title="Delete" data-action="delete" data-id="${esc(l.id)}"><i class="ti ti-trash"></i></button>
    </div>
  </div>`;
}


// ============================================================================
// ADD / EDIT LINK MODAL
// ============================================================================
function openModal(id) {
  editId = id || null;
  const l = id ? links.find(x => x.id === id) : null;
  document.getElementById('modalTitle').textContent = l ? 'Edit link' : 'Add link';
  document.getElementById('mUrl').value = l ? l.url : '';
  document.getElementById('mTitle').value = l ? l.title : '';
  document.getElementById('mDesc').value = l ? l.desc : '';
  document.getElementById('mTags').value = l ? (l.tags || []).join(', ') : '';
  document.getElementById('mNewFolder').value = '';
  document.getElementById('mSubfolder').value = l ? (l.subfolder || '') : '';
  const mf = document.getElementById('mFolder');
  mf.innerHTML = '<option value="">No folder</option>' + allFolders().map(f => `<option value="${esc(f)}"${l&&l.folder===f?' selected':''}>${esc(f)}</option>`).join('');
  updateSubfolderDatalist();
  document.getElementById('dupWarning').style.display = 'none';
  document.getElementById('modalBg').style.display = 'flex';
  setTimeout(() => document.getElementById('mUrl').focus(), 50);
}
function closeModal() { document.getElementById('modalBg').style.display = 'none'; document.getElementById('dupWarning').style.display = 'none'; editId = null; }
function autoTitle() {
  const u = document.getElementById('mUrl').value.trim();
  const t = document.getElementById('mTitle');
  if (!t.value && u && !/^https?:\/\//i.test(u)) {
    try { t.value = new URL(u).hostname.replace('www.', ''); } catch {}
  }
}

async function fetchPageTitle() {
  if (editId) return;
  const u = document.getElementById('mUrl').value.trim();
  const t = document.getElementById('mTitle');
  if (!u || !/^https?:\/\//i.test(u)) return;
  if (t.value) return;
  const wrap = document.getElementById('titleWrap');
  wrap.classList.add('fetching');
  try {
    const res = await fetch('/api/fetch-title?url=' + encodeURIComponent(u));
    const data = await res.json();
    if (!t.value && data.title) t.value = data.title;
  } catch {}
  wrap.classList.remove('fetching');
}

function updateSubfolderDatalist() {
  const nf = document.getElementById('mNewFolder').value.trim();
  const selectedFolder = nf || document.getElementById('mFolder').value || '';
  const subs = selectedFolder ? subfoldersByFolder(selectedFolder) : [];
  const dl = document.getElementById('subfolderList');
  dl.innerHTML = subs.map(s => `<option value="${esc(s)}">`).join('');
}

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
function saveLink() {
  const url = document.getElementById('mUrl').value.trim();
  const title = document.getElementById('mTitle').value.trim();
  if (!url || !title) { alert('URL and title are required.'); return; }
  const nf = document.getElementById('mNewFolder').value.trim();
  const folder = nf || document.getElementById('mFolder').value || '';
  const subfolder = document.getElementById('mSubfolder').value.trim() || null;
  const tags = document.getElementById('mTags').value.split(',').map(t => t.trim()).filter(Boolean);
  const desc = document.getElementById('mDesc').value.trim();
  if (!editId) {
    const dup = links.find(l => !l.archived && l.url.trim().toLowerCase() === url.toLowerCase());
    if (dup) {
      const w = document.getElementById('dupWarning');
      document.getElementById('dupWarningMsg').innerHTML = `A link with this URL already exists — <strong>${esc(dup.title)}</strong>`;
      w.style.display = 'flex';
      return;
    }
  }
  if (editId) {
    const i = links.findIndex(l => l.id === editId);
    if (i > -1) {
      const urlChanged = links[i].url !== url;
      links[i] = { ...links[i], url, title, desc, folder, subfolder, path: [folder, subfolder].filter(Boolean), tags };
      if (urlChanged) captureSnapshot(editId, url);
    }
  } else {
    const newId = Date.now().toString(36) + Math.random().toString(36).slice(2);
    links.unshift({ id: newId, url, title, desc, folder, subfolder, path: [folder, subfolder].filter(Boolean), tags });
    captureSnapshot(newId, url);
  }
  const wasEditing = !!editId;
  save(); closeModal(); render();
  showToast(wasEditing ? 'Link updated' : 'Link saved');
}
function addLinkAnyway() {
  const url = document.getElementById('mUrl').value.trim();
  const title = document.getElementById('mTitle').value.trim();
  const nf = document.getElementById('mNewFolder').value.trim();
  const folder = nf || document.getElementById('mFolder').value || '';
  const subfolder = document.getElementById('mSubfolder').value.trim() || null;
  const tags = document.getElementById('mTags').value.split(',').map(t => t.trim()).filter(Boolean);
  const desc = document.getElementById('mDesc').value.trim();
  const newId = Date.now().toString(36) + Math.random().toString(36).slice(2);
  links.unshift({ id: newId, url, title, desc, folder, subfolder, path: [folder, subfolder].filter(Boolean), tags });
  captureSnapshot(newId, url);
  save(); closeModal(); render();
  showToast('Link saved');
}
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
  const saved = links.slice();
  links = links.filter(l => l.id !== id);
  render();
  pendingDelete = {
    saved,
    timer: setTimeout(() => { pendingDelete = null; save(); }, 5000)
  };
  showUndoToast('Link deleted — Undo?');
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
function updateFilterBadge() {
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
  if (!e.target.closest('#folderColorPicker') && !e.target.closest('.folder-color-swatch') && !e.target.closest('.subfolder-color-swatch')) {
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
    ['modalBg','importBg','statsBg','folderMgrBg','tagMgrBg','shortcutsBg','themeBg','archiveBg'].forEach(id => {
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
  const rows = links.map(l => {
    const folder = l.folder || '';
    return { url: l.url, title: l.title, folder };
  });
  const folders = [...new Set(rows.map(r => r.folder))];
  let inner = '';
  folders.forEach(f => {
    const items = rows.filter(r => r.folder === f);
    const xmlEsc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    const itemsHtml = items.map(r => `        <DT><A HREF="${xmlEsc(r.url)}">${xmlEsc(r.title)}</A>`).join('\n');
    if (f) {
      inner += `    <DT><H3>${xmlEsc(f)}</H3>\n    <DL><p>\n${itemsHtml}\n    </DL><p>\n`;
    } else {
      inner += itemsHtml + '\n';
    }
  });
  const html = `<!DOCTYPE NETSCAPE-Bookmark-file-1>\n<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">\n<TITLE>Bookmarks</TITLE>\n<H1>Bookmarks</H1>\n<DL><p>\n${inner}</DL>`;
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

function toggleFavorites() {
  favoritesCollapsed = !favoritesCollapsed;
  localStorage.setItem('msp-fav-collapsed', JSON.stringify(favoritesCollapsed));
  render();
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

// The Stats panel lives in stats.js (openStats/closeStats/openStatLink/
// scanLinksForStats/renderHealthSection/updateHealthSection/renderStats/
// resetStats/toggleStatsNever + its panel state).


// ============================================================================
// BACKUP / RESTORE
// ============================================================================
function backupData() {
  closeSettings();
  const a = document.createElement('a');
  a.href = '/api/backup';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
function openRestore() {
  closeSettings();
  document.getElementById('restoreInput').click();
}
async function handleRestoreFile(input) {
  const file = input.files[0];
  if (!file) return;
  input.value = '';
  let text, backup;
  try { text = await file.text(); backup = JSON.parse(text); } catch { showToast('Invalid backup file'); return; }
  if (!backup.links || !Array.isArray(backup.links)) { showToast('Invalid backup file'); return; }
  const date = backup.exportedAt ? new Date(backup.exportedAt).toLocaleString() : 'unknown date';
  if (!confirm(`Restore ${backup.links.length} links from backup dated ${date}?\n\nThis will replace all current links and settings.`)) return;
  try {
    const res = await fetch('/api/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: text
    });
    if (res.ok) { showToast('Restore successful — reloading…'); setTimeout(() => location.reload(), 1500); }
    else showToast('Restore failed');
  } catch { showToast('Restore failed'); }
}
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
  addFeed, addLinkAnyway, addLinkGroup, addSectionWidget, applyMode, applyTheme,
  autoTitle, backupData, bulkAddTag, bulkArchive, bulkDelete, checkLinks,
  checkUncheckedLinks, clearSearch, clearSelection, closeArchive, closeFeedManager, closeFolderManager,
  closeImport, closeModal, closeSettings, closeShortcuts, closeStats, closeTagManager,
  closeTheme, collapseAll, confirmBulkMove, cycleDensity, deleteFolder, doImport,
  esc, exitSelectMode, expandAll, exportLinks, fetchPageTitle, goHome,
  goManager, handleDrop, handleFile, handleRestoreFile, hideSearchHistory, hideTagSuggest, homeSearchInput, homeShowAll,
  indexAllContent, lgAddSubmit, lgStartRename, linkgroupRemoveItem, onBulkFolderChange, onSearchInput,
  onSortChange, onTagInput, onTagKeydown, openArchive, openFeedItem, openFeedManager,
  openFolderColorPicker, openFolderIconPicker, openFolderManager, openImport, openModal, openRestore,
  openShortcuts, openStatLink, openStats, openTagManager, openTheme,
  previewCustomAccent, render, renderStats, resetPickerColor, resetStats, saveLink,
  saveSearchTerm, scanLinksForStats, selectAllVisible, selectFolderIcon, selectPickerColor, setBgBlur,
  setBgDim, setBgPreset, setBgType, setBgUrl, setCustomAccent, showSearchHistory,
  startFolderRename, toggleAll, toggleDashboardEdit, toggleDefaultView, toggleFavorites,
  toggleStatsNever,
  toggleFilter, toggleFolder, toggleSelectMode, toggleSettings, toggleView,
  undoAction, updateFilterBadge, updateSubfolderDatalist, uploadWallpaper, widgetRemove, widgetToggle,
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
loadLinks();

// Guard: the window bridge above must run at module load (not be trapped inside
// a function), or every inline on*= handler is a dead button. Sentinel-check a
// core handler so a future regression surfaces loudly instead of silently.
if (typeof window.render !== 'function') {
  console.error('MSP Beacon: window bridge did not initialize — inline handlers will not work.');
}
