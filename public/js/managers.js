// ============================================================================
// managers.js — the Folder, Tag, and RSS Feed manager modals (list rows with
// inline rename / delete / color / remove). These are render-heavy and lean on
// many app.js helpers + the folder/picker/toast modules (call-time circular
// imports, fine in ESM). rssFeeds is mutated in place (splice) so the live
// binding app.js holds stays valid.
// ============================================================================

import { esc, getDomain, pathKey, linkPath } from './utils.js';
import {
  links, allFolders, getOrderedFolders, childFolders, pathStartsWith,
  getFolderColor, getFolderIcon, allTags, getTagColor, tagColors,
  rssFeeds, currentMode, renderHome, render, save, saveConfig,
} from './app.js';
import { renameFolder, deleteFolder } from './folders.js';
import { openTagColorPicker } from './pickers.js';
import { showToast } from './toast.js';
import { confirmDialog } from './dialog.js';

// --- Folder manager ---------------------------------------------------------
export function openFolderManager() {
  renderFolderManager();
  document.getElementById('folderMgrBg').style.display = 'flex';
}
export function closeFolderManager() { document.getElementById('folderMgrBg').style.display = 'none'; }
function renderFolderManager() {
  const content = document.getElementById('folderMgrContent');
  if (!allFolders().length) {
    content.innerHTML = '<p style="text-align:center;color:var(--text2);padding:24px 16px">No folders yet.</p>';
    return;
  }
  // Walk the folder tree depth-first; each row carries its pathKey (data-key).
  let html = '';
  const walk = (parentPath, depth) => {
    getOrderedFolders(parentPath, childFolders(parentPath)).forEach(name => {
      const path = [...parentPath, name];
      const key = pathKey(path);
      const color = getFolderColor(path);
      const icon = depth ? 'ti-corner-down-right' : getFolderIcon(path);
      const iconColor = depth ? 'var(--text2)' : color;
      const count = links.filter(l => !l.archived && !l.deleted && pathStartsWith(linkPath(l), path)).length;
      html += `<div class="fmgr-row${depth ? ' fmgr-subfolder' : ''}"${depth ? ` style="padding-left:${8 + depth * 16}px"` : ''}>
        <i class="ti ${esc(icon)}" style="color:${esc(iconColor)};font-size:${depth ? '13' : '15'}px;flex-shrink:0"></i>
        <span class="fmgr-name">${esc(name)}</span>
        <span class="fmgr-count">${count}</span>
        <div class="fmgr-actions">
          <button class="icon-btn" title="Rename" data-key='${esc(key)}'><i class="ti ti-pencil"></i></button>
          <button class="icon-btn" style="color:#E24B4A" title="Delete" data-key='${esc(key)}'><i class="ti ti-trash"></i></button>
        </div>
      </div>`;
      walk(path, depth + 1);
    });
  };
  walk([], 0);
  content.innerHTML = html;
  content.querySelectorAll('[title="Rename"]').forEach(btn => btn.addEventListener('click', () => fmgrStartRename(btn)));
  content.querySelectorAll('[title="Delete"]').forEach(btn => btn.addEventListener('click', () => fmgrDeleteRow(btn)));
}
function fmgrStartRename(btn) {
  const key = btn.dataset.key;
  let path; try { path = JSON.parse(key); } catch { return; }
  const oldName = path[path.length - 1];
  const row = btn.closest('.fmgr-row');
  const nameSpan = row.querySelector('.fmgr-name');
  const input = document.createElement('input');
  input.className = 'fmgr-input';
  input.value = oldName;
  nameSpan.replaceWith(input);
  input.focus(); input.select();
  let committed = false;
  function commit() {
    if (committed) return; committed = true;
    const newName = input.value.trim();
    if (newName && newName !== oldName) { renameFolder(key, newName); render(); }
    renderFolderManager();
  }
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { committed = true; renderFolderManager(); }
  });
}
async function fmgrDeleteRow(btn) {
  await deleteFolder(btn.dataset.key); // async: waits out the confirm dialog
  renderFolderManager();
}

// --- Tag manager ------------------------------------------------------------
function renameTag(oldName, newName) {
  newName = newName.trim();
  if (!newName || newName === oldName) return;
  links.forEach(l => {
    if ((l.tags || []).includes(oldName)) {
      l.tags = l.tags.map(t => t === oldName ? newName : t);
    }
  });
  if (tagColors[oldName] !== undefined) {
    tagColors[newName] = tagColors[oldName];
    delete tagColors[oldName];
    localStorage.setItem('msp-tag-colors', JSON.stringify(tagColors));
    saveConfig();
  }
  save(); render();
}
async function deleteTag(name) {
  const count = links.filter(l => !l.archived && !l.deleted && (l.tags || []).includes(name)).length;
  if (!(await confirmDialog(`It will be removed from ${count} link${count !== 1 ? 's' : ''}.`, { title: `Delete tag "${name}"?`, okText: 'Delete', danger: true }))) return;
  links.forEach(l => { if (l.tags) l.tags = l.tags.filter(t => t !== name); });
  if (tagColors[name] !== undefined) {
    delete tagColors[name];
    localStorage.setItem('msp-tag-colors', JSON.stringify(tagColors));
    saveConfig();
  }
  save(); render();
  showToast(`Tag "${name}" deleted`);
}
export function openTagManager() {
  renderTagManager();
  document.getElementById('tagMgrBg').style.display = 'flex';
}
export function closeTagManager() { document.getElementById('tagMgrBg').style.display = 'none'; }
function renderTagManager() {
  const tags = allTags();
  const content = document.getElementById('tagMgrContent');
  if (!tags.length) {
    content.innerHTML = '<p style="text-align:center;color:var(--text2);padding:24px 16px">No tags yet.</p>';
    return;
  }
  content.innerHTML = tags.map(t => {
    const count = links.filter(l => !l.archived && !l.deleted && (l.tags || []).includes(t)).length;
    return `<div class="fmgr-row">
      <i class="ti ti-tag" style="color:${getTagColor(t) || 'var(--g3)'};font-size:14px;flex-shrink:0"></i>
      <span class="fmgr-name">${esc(t)}</span>
      <span class="fmgr-count">${count}</span>
      <div class="fmgr-actions">
        <button class="icon-btn" title="Color" data-tagcolor="${esc(t)}"><i class="ti ti-palette"></i></button>
        <button class="icon-btn" title="Rename" data-tag="${esc(t)}"><i class="ti ti-pencil"></i></button>
        <button class="icon-btn" style="color:#E24B4A" title="Delete" data-tag="${esc(t)}"><i class="ti ti-trash"></i></button>
      </div>
    </div>`;
  }).join('');
  content.querySelectorAll('[data-tagcolor]').forEach(btn => btn.addEventListener('click', e => { e.stopPropagation(); openTagColorPicker(btn.dataset.tagcolor, btn); }));
  content.querySelectorAll('[title="Rename"]').forEach(btn => btn.addEventListener('click', () => tmgrStartRename(btn)));
  content.querySelectorAll('[title="Delete"]').forEach(btn => btn.addEventListener('click', async () => {
    await deleteTag(btn.dataset.tag); // async: waits out the confirm dialog
    renderTagManager();
  }));
}
function tmgrStartRename(btn) {
  const oldName = btn.dataset.tag;
  const row = btn.closest('.fmgr-row');
  const nameSpan = row.querySelector('.fmgr-name');
  const input = document.createElement('input');
  input.className = 'fmgr-input';
  input.value = oldName;
  nameSpan.replaceWith(input);
  input.focus(); input.select();
  let committed = false;
  function commit() {
    if (committed) return; committed = true;
    const newName = input.value.trim();
    if (newName && newName !== oldName) renameTag(oldName, newName);
    renderTagManager();
  }
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { committed = true; renderTagManager(); }
  });
}

// --- Feed (RSS) manager -----------------------------------------------------
export function openFeedManager() {
  renderFeedManager();
  document.getElementById('feedsBg').style.display = 'flex';
  setTimeout(() => document.getElementById('feedUrlInput').focus(), 50);
}
export function closeFeedManager() {
  document.getElementById('feedsBg').style.display = 'none';
  if (currentMode === 'home') renderHome(); // reflect feed changes on the homepage
}
export function addFeed() {
  const urlEl = document.getElementById('feedUrlInput');
  const nameEl = document.getElementById('feedNameInput');
  let url = urlEl.value.trim();
  if (!url) return;
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  try { new URL(url); } catch { showToast('Invalid feed URL', true); return; }
  if (rssFeeds.some(f => f.url === url)) { showToast('Feed already added'); return; }
  rssFeeds.push({ url, name: nameEl.value.trim() });
  localStorage.setItem('msp-rss-feeds', JSON.stringify(rssFeeds));
  saveConfig();
  urlEl.value = ''; nameEl.value = '';
  renderFeedManager();
  urlEl.focus();
}
function removeFeed(url) {
  const i = rssFeeds.findIndex(f => f.url === url);
  if (i > -1) rssFeeds.splice(i, 1);
  localStorage.setItem('msp-rss-feeds', JSON.stringify(rssFeeds));
  saveConfig();
  renderFeedManager();
}
function renderFeedManager() {
  const content = document.getElementById('feedMgrContent');
  if (!rssFeeds.length) {
    content.innerHTML = '<p style="text-align:center;color:var(--text2);padding:24px 16px">No feeds yet. Add an RSS or Atom feed URL above.</p>';
    return;
  }
  content.innerHTML = rssFeeds.map(f => `<div class="fmgr-row">
      <i class="ti ti-rss" style="color:var(--g3);font-size:14px;flex-shrink:0"></i>
      <span class="fmgr-name" title="${esc(f.url)}">${esc(f.name || getDomain(f.url))}</span>
      <div class="fmgr-actions">
        <button class="icon-btn" style="color:#E24B4A" title="Remove" data-feed="${esc(f.url)}"><i class="ti ti-trash"></i></button>
      </div>
    </div>`).join('');
  content.querySelectorAll('[data-feed]').forEach(btn => btn.addEventListener('click', () => removeFeed(btn.dataset.feed)));
}

// Re-render whichever managers are currently open (called after a color change).
export function refreshOpenManagers() {
  if (document.getElementById('tagMgrBg').style.display === 'flex') renderTagManager();
  if (document.getElementById('folderMgrBg').style.display === 'flex') renderFolderManager();
}
