// ============================================================================
// managers.js — the Folder, Tag, and RSS Feed manager modals (list rows with
// inline rename / delete / color / remove). These are render-heavy and lean on
// many app.js helpers + the folder/picker/toast modules (call-time circular
// imports, fine in ESM). rssFeeds is mutated in place (splice) so the live
// binding app.js holds stays valid.
// ============================================================================

import { esc, getDomain } from './utils.js';
import {
  links, allFolders, getOrderedFolders, subfoldersByFolder,
  getFolderColor, getFolderIcon, allTags, getTagColor, tagColors,
  rssFeeds, currentMode, renderHome, render, save, saveConfig,
} from './app.js';
import { renameFolder, renameSubfolder, deleteFolder, deleteSubfolder } from './folders.js';
import { openTagColorPicker } from './pickers.js';
import { showToast } from './toast.js';

// --- Folder manager ---------------------------------------------------------
export function openFolderManager() {
  renderFolderManager();
  document.getElementById('folderMgrBg').style.display = 'flex';
}
export function closeFolderManager() { document.getElementById('folderMgrBg').style.display = 'none'; }
function renderFolderManager() {
  const folders = getOrderedFolders(allFolders());
  const content = document.getElementById('folderMgrContent');
  if (!folders.length) {
    content.innerHTML = '<p style="text-align:center;color:var(--text2);padding:24px 16px">No folders yet.</p>';
    return;
  }
  let html = '';
  folders.forEach(f => {
    const color = getFolderColor(f);
    const icon = getFolderIcon(f);
    const count = links.filter(l => !l.archived && l.folder === f).length;
    const subs = subfoldersByFolder(f);
    html += `<div class="fmgr-row">
      <i class="ti ${esc(icon)}" style="color:${esc(color)};font-size:15px;flex-shrink:0"></i>
      <span class="fmgr-name">${esc(f)}</span>
      <span class="fmgr-count">${count}</span>
      <div class="fmgr-actions">
        <button class="icon-btn" title="Rename" data-type="folder" data-folder="${esc(f)}" data-subfolder=""><i class="ti ti-pencil"></i></button>
        <button class="icon-btn" style="color:#E24B4A" title="Delete" data-type="folder" data-folder="${esc(f)}" data-subfolder=""><i class="ti ti-trash"></i></button>
      </div>
    </div>`;
    subs.forEach(sf => {
      const sfCount = links.filter(l => !l.archived && l.folder === f && l.subfolder === sf).length;
      html += `<div class="fmgr-row fmgr-subfolder">
        <i class="ti ti-corner-down-right" style="color:var(--text2);font-size:13px;flex-shrink:0"></i>
        <span class="fmgr-name">${esc(sf)}</span>
        <span class="fmgr-count">${sfCount}</span>
        <div class="fmgr-actions">
          <button class="icon-btn" title="Rename" data-type="subfolder" data-folder="${esc(f)}" data-subfolder="${esc(sf)}"><i class="ti ti-pencil"></i></button>
          <button class="icon-btn" style="color:#E24B4A" title="Delete" data-type="subfolder" data-folder="${esc(f)}" data-subfolder="${esc(sf)}"><i class="ti ti-trash"></i></button>
        </div>
      </div>`;
    });
  });
  content.innerHTML = html;
  content.querySelectorAll('[title="Rename"]').forEach(btn => btn.addEventListener('click', () => fmgrStartRename(btn)));
  content.querySelectorAll('[title="Delete"]').forEach(btn => btn.addEventListener('click', () => fmgrDeleteRow(btn)));
}
function fmgrStartRename(btn) {
  const type = btn.dataset.type;
  const folder = btn.dataset.folder;
  const subfolder = btn.dataset.subfolder;
  const oldName = type === 'folder' ? folder : subfolder;
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
    if (newName && newName !== oldName) {
      if (type === 'folder') renameFolder(folder, newName);
      else renameSubfolder(folder, subfolder, newName);
      render();
    }
    renderFolderManager();
  }
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { committed = true; renderFolderManager(); }
  });
}
function fmgrDeleteRow(btn) {
  const type = btn.dataset.type;
  const folder = btn.dataset.folder;
  const subfolder = btn.dataset.subfolder;
  if (type === 'folder') deleteFolder(folder);
  else deleteSubfolder(folder, subfolder);
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
function deleteTag(name) {
  const count = links.filter(l => !l.archived && (l.tags || []).includes(name)).length;
  if (!confirm(`Delete tag "${name}"? It will be removed from ${count} link${count !== 1 ? 's' : ''}.`)) return;
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
    const count = links.filter(l => !l.archived && (l.tags || []).includes(t)).length;
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
  content.querySelectorAll('[title="Delete"]').forEach(btn => btn.addEventListener('click', () => {
    deleteTag(btn.dataset.tag);
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
