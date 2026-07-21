// ============================================================================
// render.js — the manager grid/list/folder renderer (extracted from app.js).
//
// Owns the manager view: the filter/search pipeline, the folder tree, and the
// card (grid) + row (list) markup. app.js stays the state/bootstrap/window-bridge
// hub and re-exports `render` + `visibleIds` so the modules that import them from
// './app.js' (and the inline on*= handlers via the window bridge) are unchanged.
// Inline handlers in the template strings below are bridged in app.js, guarded by
// `npm run check`.
// ============================================================================
import { esc, linkPath, pathKey, isWebUrl, hexToRgb, getFavicon, getDomain, timeAgo } from './utils.js';
import { ui } from './state.js';
import { sortLinks } from './view.js';
import { parseSearch, linkMatchesFlag, contentMatchIds, contentMatchQuery, scoreTextMatch } from './search.js';
import { selectMode, selectedIds } from './selection.js';
import { updateArchiveBadge } from './archive.js';
import { updateTrashBadge } from './trash.js';
import { renderHome, takeHomeFolderFilter } from './dashboard.js';
import {
  links, linkStatus, currentMode, collapsedFolders, allFolders, allTags,
  getOrderedFolders, getFolderColor, getFolderIcon, tagHtml, applyHomeBg, updateFilterBadge,
  bootLoaded,
} from './app.js';

// State owned here. visibleIds is read cross-module (health.js, selection.js) via
// app.js's re-export; contentOnlyIds + favoritesCollapsed are render-private.
export let visibleIds = [];
let favoritesCollapsed = JSON.parse(localStorage.getItem('msp-fav-collapsed') || 'false');
let contentOnlyIds = new Set();    // matched via page text only (no title/url/tag hit) — for the badge

// ============================================================================
// MAIN RENDER — GRID / LIST / FOLDERS
// ============================================================================
export function render() {
  // Until the first data load lands, keep the boot skeleton (index.html
  // #content) on screen — the setMode() call at boot would otherwise wipe it
  // with a misleading empty view. loadLinks flips bootLoaded before rendering.
  if (!bootLoaded) return;
  applyHomeBg();
  if (currentMode === 'home') { renderHome(); return; }
  const q = document.getElementById('search').value.toLowerCase();
  const clearBtn = document.getElementById('searchClear');
  if (clearBtn) clearBtn.style.display = q ? '' : 'none';
  let ff = document.getElementById('folderFilter').value;
  const hff = takeHomeFolderFilter(); if (hff !== null) ff = hff;
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
  const scoreById = new Map(); // link id → relevance score, for ranking text-query results
  let fil = links.filter(l => {
    if (l.deleted) return false;   // trashed links never show in any list
    if (wantArchived) { if (!l.archived) return false; }
    else if (l.archived) return false;
    if (ff && linkPath(l)[0] !== ff) return false;
    if (tf && !(l.tags || []).some(t => t.toLowerCase() === tf.toLowerCase())) return false;
    if (stf === 'readlater' && !l.readLater) return false;
    for (const flag of parsed.flags) { if (flag !== 'archived' && !linkMatchesFlag(l, flag)) return false; }
    if (parsed.tags.length) {
      const lt = (l.tags || []).map(t => t.toLowerCase());
      if (!parsed.tags.every(tg => lt.some(t => t.includes(tg)))) return false;
    }
    if (parsed.folders.length) {
      const segs = linkPath(l).map(s => s.toLowerCase());
      if (!parsed.folders.some(fd => segs.some(s => s.includes(fd)))) return false;
    }
    if (parsed.terms.length) {
      const metaScore = scoreTextMatch(l, parsed.terms, parsed.text);
      const contentMatch = contentActive && contentMatchIds.has(l.id);
      if (!metaScore && !contentMatch) return false;
      if (!metaScore && contentMatch) contentOnlyIds.add(l.id);
      scoreById.set(l.id, metaScore || 1); // content-only hits rank below any metadata hit
    }
    return true;
  });
  fil = sortLinks(fil);
  // Rank text-query results by relevance; the chosen sort order breaks ties
  // (Array.sort is stable, so it survives underneath the score sort).
  if (parsed.terms.length) fil.sort((a, b) => (scoreById.get(b.id) || 0) - (scoreById.get(a.id) || 0));
  visibleIds = fil.map(l => l.id);
  const c = document.getElementById('content');
  // When filtering by health status, warn if some links haven't been checked yet — their
  // status is unknown so is:broken/is:online results may be incomplete. Offer a one-click scan.
  let healthHint = '';
  if (!wantArchived && (parsed.flags.includes('broken') || parsed.flags.includes('online'))) {
    const webLinks = links.filter(l => !l.archived && !l.deleted && isWebUrl(l.url));
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
  const tree = buildFolderTree(fil);
  const root = tree.get(pathKey([])) || { direct: [], children: new Set() };
  let html = '';
  const favs = fil.filter(l => l.favorite);
  if (favs.length) {
    html += `<div class="favorites-section"><div class="favorites-header" onclick="toggleFavorites()"><i class="ti ti-chevron-right folder-chevron${favoritesCollapsed ? '' : ' open'}"></i><i class="ti ti-star-filled" style="font-size:15px;color:#F5A623"></i><span class="favorites-title">Favorites</span><span class="count-pill" style="background:rgba(245,166,35,.3);color:#F5A623">${favs.length}</span></div>${favoritesCollapsed ? '' : wrap(favs)}</div>`;
  }
  if (root.direct.length) html += wrap(root.direct); // links with no folder
  getOrderedFolders([], [...root.children]).forEach(name => { html += renderFolderSection(tree, [name], wrap); });
  c.innerHTML = html;
  updateArchiveBadge();
  updateTrashBadge();
}

// Aggregate the folder tree in a single pass over the (filtered) links. Returns a
// Map of pathKey → { direct: links exactly here, count: links at/below here,
// children: Set of immediate child folder names }. The root key (pathKey([]))
// holds the no-folder links in `direct` and the top-level folders in `children`.
// This replaces per-folder re-scans of the link list (was O(folders × links)).
function buildFolderTree(arr) {
  const nodes = new Map();
  const node = key => { let n = nodes.get(key); if (!n) { n = { direct: [], count: 0, children: new Set() }; nodes.set(key, n); } return n; };
  for (const l of arr) {
    const p = linkPath(l);
    node(pathKey(p)).direct.push(l);
    for (let i = 1; i <= p.length; i++) {
      node(pathKey(p.slice(0, i))).count++;
      node(pathKey(p.slice(0, i - 1))).children.add(p[i - 1]);
    }
  }
  return nodes;
}

// Recursively render one folder (at `path`) and, nested inside it, its direct
// links followed by its child folders, using the precomputed `tree`. data-path
// carries pathKey(path); the header handlers parse it back. Indentation is purely
// CSS (.folder-content padding) since child sections are nested in the DOM.
function renderFolderSection(tree, path, wrap) {
  const key = pathKey(path);
  const n = tree.get(key) || { direct: [], count: 0, children: new Set() };
  const collapsed = collapsedFolders.has(key);
  const fc = getFolderColor(path);
  const fcRgb = hexToRgb(fc);
  const keyEsc = esc(key);
  const descendantCount = n.count;
  let content = '';
  if (!collapsed) {
    if (n.direct.length) content += wrap(n.direct);
    getOrderedFolders(path, [...n.children]).forEach(cn => { content += renderFolderSection(tree, [...path, cn], wrap); });
  }
  return `<div class="folder-section"><div class="folder-header" onclick="toggleFolder(this.dataset.path)" data-path="${keyEsc}" style="background:rgba(${fcRgb},.15);border-color:${fc}">`
    + `<div class="folder-drag-handle" draggable="true" title="Drag to reorder folder" onclick="event.stopPropagation()"><i class="ti ti-grip-vertical"></i></div>`
    + `<i class="ti ti-chevron-right folder-chevron${collapsed ? '' : ' open'}" style="color:${fc}"></i>`
    + `<i class="ti ${getFolderIcon(path)} folder-icon-btn" style="font-size:16px;color:${fc};cursor:pointer" onclick="event.stopPropagation();openFolderIconPicker(this.closest('.folder-header').dataset.path,this)" title="Change icon"></i>`
    + `<span class="folder-name">${esc(path[path.length - 1])}</span>`
    + `<button class="folder-rename-btn" onclick="event.stopPropagation();startFolderRename(this)" title="Rename folder"><i class="ti ti-pencil"></i></button>`
    + `<button class="folder-rename-btn" onclick="event.stopPropagation();deleteFolder(this.closest('.folder-header').dataset.path)" title="Delete folder" style="color:#E24B4A"><i class="ti ti-trash"></i></button>`
    + `<span class="count-pill" style="background:${fc}">${descendantCount}</span>`
    + `<div class="folder-color-swatch" onclick="event.stopPropagation();openFolderColorPicker(this.closest('.folder-header').dataset.path,this)" style="width:16px;height:16px;border-radius:50%;background:${fc};cursor:pointer;margin-left:auto;flex-shrink:0;border:1.5px solid var(--ring)"></div>`
    + `</div><div class="folder-content" data-path="${keyEsc}">${content}</div></div>`;
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
      <div style="min-width:0"><div class="card-title" title="${esc(l.title)}">${esc(l.title)}</div><div class="card-url">${esc(getDomain(l.url))}</div>${l.lastVisited ? `<div style="font-size:11px;color:var(--text2);margin-top:1px">${timeAgo(l.lastVisited)}</div>` : ''}</div>
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
      <span class="card-row-title" title="${esc(l.title)}">${esc(l.title)}</span>
      <span class="card-row-domain">${esc(getDomain(l.url))}</span>
      <div class="card-row-tags">${(l.tags || []).map(tagHtml).join('')}</div>
      ${folderBadgeHtml(l, 'margin-left:0')}
    </div>`;
  }
  return `<div class="card-row" data-id="${esc(l.id)}" data-url="${esc(l.url)}"${cardBorderStyle(l)}>
    <div class="favicon">${fi}</div>
    ${statusBadge}
    <span class="card-row-title" title="${esc(l.title)}">${esc(l.title)}</span>
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

function toggleFavorites() {
  favoritesCollapsed = !favoritesCollapsed;
  localStorage.setItem('msp-fav-collapsed', JSON.stringify(favoritesCollapsed));
  render();
}

// toggleFavorites is an inline on*= handler — app.js imports it onto the window bridge.
export { toggleFavorites };
