// ============================================================================
// dashboard.js — the homepage dashboard / widget system (extracted from app.js).
//
// Owns the homepage widget layout (dashboard state + one-time migrations) and all
// home rendering: tiles, sections, widgets, the clock, RSS "Latest" feeds, and the
// live status dots. app.js stays the state/bootstrap/window-bridge hub and imports
// the pieces it still drives (render dispatch, the leave-home reset, server-config
// load). Inline on*="fn()" handlers in the template strings below are exposed as
// globals by the Object.assign(window, {...}) bridge in app.js, so every handler
// function here must also be imported + listed there (guarded by `npm run check`).
// ============================================================================
import { getFavicon, getDomain, esc, hexToRgb, timeAgo } from './utils.js';
import { ui } from './state.js';
import { idOrder } from './view.js';
import { showToast } from './toast.js';
import { updateArchiveBadge } from './archive.js';
import { updateTrashBadge } from './trash.js';
import {
  links, rssFeeds, linkStatus, currentMode, dashboardMigrations,
  save, render, saveConfig, setMode, goManager, closeSettings,
  allFolders, getOrderedFolders, getFolderColor, getFolderIcon, applyHomeBg,
} from './app.js';

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
  'recently-added': 'Recently added', folders: 'Folders', latest: 'Latest (RSS)',
  linkgroup: 'Link group', notes: 'Note'
};
const WIDGET_ICONS = {
  clock: 'ti-clock', search: 'ti-search', favorites: 'ti-star-filled',
  readlater: 'ti-bookmark', recent: 'ti-history', 'most-visited': 'ti-flame',
  'recently-added': 'ti-clock-plus', folders: 'ti-folders', latest: 'ti-rss',
  linkgroup: 'ti-apps', notes: 'ti-note'
};
const DEFAULT_DASHBOARD = SECTION_WIDGETS.map(type => ({ id: type, type, enabled: true }));
const LINKGROUP_MAX_ITEMS = 50;
const NOTE_MAX_LEN = 10000;
export let dashboard = JSON.parse(localStorage.getItem('msp-dashboard') || 'null');
export let dashboardEditMode = false;

// --- State setters — app.js can't reassign our module-scoped bindings -------
export function setDashboard(v) { dashboard = v; }
export function setDashboardEditMode(v) { dashboardEditMode = v; }
// render() (app.js) consumes the one-shot home→manager folder filter.
export function takeHomeFolderFilter() { const v = homeFolderFilter; homeFolderFilter = null; return v; }
// setMode() (app.js) calls this when navigating away from the homepage.
export function exitHomeMode() { clearInterval(homeClockTimer); homeClockTimer = null; setDashboardEditMode(false); }

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
    } else if (type === 'notes') {
      // Same id discipline as linkgroup — the id is inlined into onclick handlers.
      let id = (typeof w.id === 'string' && /^note-[a-z0-9]+$/i.test(w.id)) ? w.id : '';
      if (!id || seenId.has(id)) id = 'note-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      seenId.add(id);
      const title = (typeof w.title === 'string' ? w.title : 'Note').slice(0, 60);
      const text = (typeof w.text === 'string' ? w.text : '').slice(0, NOTE_MAX_LEN);
      out.push({ id, type: 'notes', enabled, title, text });
    }
  }
  return out.length ? out : null;
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
  return `<div class="home-section"><div class="home-section-head"><i class="ti ${icon}" style="font-size:14px;color:var(--accent-icon)"></i><span class="home-section-title">${title}</span><button class="home-section-all" onclick="homeShowAll('${key}')">show all <i class="ti ti-arrow-right"></i></button></div><div class="home-tiles"${secAttr}>${tilesHtml}</div></div>`;
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
      return `<div class="home-section"><div class="home-section-head"><i class="ti ti-rss" style="font-size:14px;color:var(--accent-icon)"></i><span class="home-section-title">Latest</span><button class="home-section-all" onclick="closeSettings();openFeedManager()">manage <i class="ti ti-settings"></i></button></div><div class="home-feed" id="homeFeed"><div class="home-feed-msg"><i class="ti ti-loader" style="animation:spin 1s linear infinite"></i> Loading feeds…</div></div></div>`;
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
      return `<div class="home-section"><div class="home-section-head"><i class="ti ti-apps" style="font-size:14px;color:var(--accent-icon)"></i><span class="home-section-title">${esc(w.title || 'Links')}</span></div>${tiles}${emptyMsg}${addForm}</div>`;
    }
    case 'notes': {
      // Always editable (even outside dashboard edit mode) — that's the point of
      // a sticky note. Text saves on blur; no re-render so focus/caret survive.
      return `<div class="home-section"><div class="home-section-head"><i class="ti ti-note" style="font-size:14px;color:var(--accent-icon)"></i><span class="home-section-title">${esc(w.title || 'Note')}</span></div><textarea class="home-note" placeholder="Write a note…" maxlength="${NOTE_MAX_LEN}" onblur="noteSave('${w.id}',this)">${esc(w.text || '')}</textarea></div>`;
    }
    default: return '';
  }
}
// A section header + body with no tiles (used for empty widgets in edit mode).
function sectionShell(title, icon, body) {
  return `<div class="home-section"><div class="home-section-head"><i class="ti ${icon}" style="font-size:14px;color:var(--accent-icon)"></i><span class="home-section-title">${title}</span></div>${body}</div>`;
}

// Edit-mode toolbar shown above each widget (drag handle, label, show/hide, and
// link-group controls). Widget ids are validated to /^lg-[a-z0-9]+$/i or are a
// fixed section name, so inlining them in onclick is safe.
function widgetToolbar(w) {
  const userTitled = w.type === 'linkgroup' || w.type === 'notes';
  const label = userTitled ? (w.title || WIDGET_LABELS[w.type]) : (WIDGET_LABELS[w.type] || w.type);
  let extra = '';
  if (userTitled) {
    extra = `<button class="icon-btn lg-rename-btn" title="Rename" onclick="lgStartRename('${w.id}',this)"><i class="ti ti-pencil"></i></button>`
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
  const active = links.filter(l => !l.archived && !l.deleted);
  const data = {
    favorites: active.filter(l => l.favorite).slice(0, 8),
    readlater: active.filter(l => l.readLater).slice(0, 8),
    recent: active.filter(l => l.lastVisited).sort((a, b) => (b.lastVisited || 0) - (a.lastVisited || 0)).slice(0, 8),
    'most-visited': active.filter(l => (l.visits || 0) > 0).sort((a, b) => (b.visits || 0) - (a.visits || 0)).slice(0, 8),
    'recently-added': active.slice().sort((a, b) => idOrder(b.id) - idOrder(a.id)).slice(0, 8),
    folders: getOrderedFolders([], allFolders()).slice(0, 8),
  };
  const list = getDashboard();

  let html = `<div class="home${dashboardEditMode ? ' editing' : ''}">`;
  if (dashboardEditMode) {
    html += `<div class="dashboard-edit-banner"><i class="ti ti-pencil"></i><span>Editing dashboard — drag to reorder, toggle the eye to show/hide.</span><button class="btn btn-primary" onclick="toggleDashboardEdit()"><i class="ti ti-check"></i> Done</button></div>`;
  }
  html += list.map(w => renderWidget(w, data)).join('');
  if (dashboardEditMode) {
    const present = new Set(list.map(w => w.type));
    const chips = SECTION_WIDGETS.filter(t => !present.has(t))
      .map(t => `<button class="btn" onclick="addSectionWidget('${t}')"><i class="ti ${WIDGET_ICONS[t]}"></i> ${esc(WIDGET_LABELS[t])}</button>`).join('');
    html += `<div class="add-widget-bar"><span class="add-widget-label">Add widget</span>${chips}<button class="btn" onclick="addLinkGroup()"><i class="ti ti-apps"></i> Link group</button><button class="btn" onclick="addNote()"><i class="ti ti-note"></i> Note</button></div>`;
  }
  html += '</div>';
  c.innerHTML = html;

  updateClock();
  clearInterval(homeClockTimer);
  homeClockTimer = setInterval(updateClock, 1000);
  if (rssFeeds.length && list.some(w => w.type === 'latest' && w.enabled)) loadHomeFeeds();
  loadHomeStatus();
  updateArchiveBadge();
  updateTrashBadge();
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
  const old = w.title || (w.type === 'notes' ? 'Note' : 'Links');
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

// Add a blank Note widget and immediately start naming it (mirrors addLinkGroup).
function addNote() {
  const id = 'note-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  ensureDashboard().push({ id, type: 'notes', enabled: true, title: 'Note', text: '' });
  persistDashboard(); render();
  const btn = document.querySelector(`.home-widget[data-widget-id="${id}"] .lg-rename-btn`);
  if (btn) lgStartRename(id, btn);
}
// Persist a note's text on blur. No render() — keep the textarea's caret/scroll.
function noteSave(id, el) {
  const w = ensureDashboard().find(x => x.id === id);
  if (!w || w.type !== 'notes') return;
  const text = el.value.slice(0, NOTE_MAX_LEN);
  if (text === (w.text || '')) return;
  w.text = text;
  persistDashboard();
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
// MODULE SURFACE — app.js imports these to expose inline on*= handlers on the
// window bridge and to drive server-config load. (renderHome / persistDashboard /
// ensureDashboard / openFolderFromHome / reorderFavorite / dashboardEditMode /
// setLastHomeStatusAt are already `export`-prefixed above.)
// ============================================================================
export {
  addLinkGroup, addNote, addSectionWidget, homeSearchInput, homeShowAll, lgAddSubmit,
  lgStartRename, linkgroupRemoveItem, noteSave, openFeedItem, toggleDashboardEdit,
  widgetRemove, widgetToggle, sanitizeDashboard, migrateDashboard,
};
