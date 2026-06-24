// ============================================================================
// folders.js — nested-folder operations: collapse/expand, rename, delete.
// With the path model every folder is identified by a pathKey (JSON of its path
// array, e.g. ["Work","Clients"]) at any depth, so there's a single set of ops
// for all levels. Folder metadata (collapsedFolders/folderColors/folderIcons/
// childOrder) and the hub primitives live in app.js and are imported here
// (call-time circular import, fine in ESM); these mutate shared state in place.
// ============================================================================

import {
  links, save, render, saveConfig, setLinkLocation,
  collapsedFolders, folderColors, folderIcons, childOrder,
  allFolderPaths, pathStartsWith,
} from './app.js';
import { pathKey, linkPath } from './utils.js';
import { showToast } from './toast.js';

const parseKey = k => { try { return JSON.parse(k); } catch { return null; } };

export function toggleFolder(key) {
  if (collapsedFolders.has(key)) collapsedFolders.delete(key);
  else collapsedFolders.add(key);
  localStorage.setItem('msp-collapsed', JSON.stringify([...collapsedFolders]));
  render();
}

export function collapseAll() {
  allFolderPaths().forEach(k => collapsedFolders.add(k));
  localStorage.setItem('msp-collapsed', JSON.stringify([...collapsedFolders]));
  render();
}
export function expandAll() {
  collapsedFolders.clear();
  localStorage.setItem('msp-collapsed', JSON.stringify([]));
  render();
}

// Re-key the path-keyed metadata stores (colors/icons/collapsed) by running each
// stored path through transform(); returning null drops the entry. childOrder is
// handled separately by the callers (they clear affected branches).
function remapFolderMeta(transform) {
  for (const store of [folderColors, folderIcons]) {
    for (const k of Object.keys(store)) {
      const arr = parseKey(k); if (!arr) continue;
      const np = transform(arr);
      if (pathKey(np || []) === k) continue;
      const v = store[k]; delete store[k];
      if (np) store[pathKey(np)] = v;
    }
  }
  for (const k of [...collapsedFolders]) {
    const arr = parseKey(k); if (!arr) continue;
    const np = transform(arr);
    if (pathKey(np || []) === k) continue;
    collapsedFolders.delete(k);
    if (np) collapsedFolders.add(pathKey(np));
  }
}
// Drop any childOrder entry whose parent path is at/under `prefix` (so the
// affected branch reverts to alphabetical order — custom order is a nice-to-have).
function clearChildOrderUnder(prefix) {
  for (const k of Object.keys(childOrder)) {
    const arr = parseKey(k);
    if (arr && pathStartsWith(arr, prefix)) delete childOrder[k];
  }
}
function persistFolderMeta() {
  localStorage.setItem('msp-folder-colors', JSON.stringify(folderColors));
  localStorage.setItem('msp-folder-icons', JSON.stringify(folderIcons));
  localStorage.setItem('msp-collapsed', JSON.stringify([...collapsedFolders]));
  localStorage.setItem('msp-folder-order', JSON.stringify(childOrder));
}

export function renameFolder(key, newName) {
  newName = (newName || '').trim();
  const path = parseKey(key);
  if (!path || !path.length || !newName || newName === path[path.length - 1]) return;
  const idx = path.length - 1;
  // Re-segment every link in this folder's subtree.
  links.forEach(l => {
    const p = linkPath(l);
    if (pathStartsWith(p, path)) { const np = p.slice(); np[idx] = newName; setLinkLocation(l, np); }
  });
  remapFolderMeta(arr => {
    if (!pathStartsWith(arr, path)) return arr;
    const np = arr.slice(); np[idx] = newName; return np;
  });
  clearChildOrderUnder(path.slice(0, idx)); // parent's child-name order references the old name
  persistFolderMeta();
  save(); saveConfig(); render();
}

export function deleteFolder(key) {
  const path = parseKey(key);
  if (!path || !path.length) return;
  const idx = path.length - 1;
  const parent = path.slice(0, idx);
  const count = links.filter(l => !l.archived && pathStartsWith(linkPath(l), path)).length;
  const dest = parent.length ? `"${parent.join(' / ')}"` : 'no folder';
  if (!confirm(`Delete folder "${path[idx]}"? ${count} link${count !== 1 ? 's' : ''} (and any sub-folders) will move to ${dest}.`)) return;
  // Splice this level out of every descendant link's path (promote up one level).
  links.forEach(l => {
    const p = linkPath(l);
    if (pathStartsWith(p, path)) { const np = p.slice(); np.splice(idx, 1); setLinkLocation(l, np); }
  });
  remapFolderMeta(arr => {
    if (!pathStartsWith(arr, path)) return arr;
    if (arr.length === path.length) return null; // the deleted folder's own metadata
    const np = arr.slice(); np.splice(idx, 1); return np;
  });
  clearChildOrderUnder(parent);
  persistFolderMeta();
  save(); render(); saveConfig();
  showToast(`Folder "${path[idx]}" deleted`);
}

export function startFolderRename(btn) {
  const header = btn.closest('.folder-header[data-path]');
  if (!header) return;
  const key = header.dataset.path;
  const path = parseKey(key);
  if (!path) return;
  const oldName = path[path.length - 1];
  const nameSpan = header.querySelector('.folder-name');
  if (!nameSpan || header.querySelector('.folder-rename-input')) return;
  const input = document.createElement('input');
  input.type = 'text';
  input.value = oldName;
  input.className = 'folder-rename-input';
  input.style.cssText = 'height:22px;padding:0 6px;border-radius:5px;border:1px solid var(--g4);background:var(--bg2);color:var(--text0);font-size:13px;font-weight:500;font-family:inherit;width:140px';
  nameSpan.replaceWith(input);
  input.focus();
  input.select();
  let committed = false;
  function commit() {
    if (committed) return;
    committed = true;
    const newName = input.value.trim();
    if (newName && newName !== oldName) { renameFolder(key, newName); render(); }
    else input.replaceWith(nameSpan);
  }
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { committed = true; input.replaceWith(nameSpan); }
  });
  input.addEventListener('blur', commit);
}
