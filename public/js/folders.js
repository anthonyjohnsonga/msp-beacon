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
import { esc, pathKey, linkPath, MAX_FOLDER_DEPTH } from './utils.js';
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

// Deepest level reached at/below a folder, relative to itself (a leaf folder = 1).
function subtreeDepth(srcPath) {
  let max = 1;
  links.forEach(l => {
    const p = linkPath(l);
    if (pathStartsWith(p, srcPath)) max = Math.max(max, p.length - srcPath.length + 1);
  });
  return max;
}
// Can the folder at srcPath be nested directly under destParent ([] = top level)?
export function canMoveFolderUnder(srcPath, destParent) {
  if (pathStartsWith(destParent, srcPath)) return false;                    // into itself or a descendant
  if (pathKey(destParent) === pathKey(srcPath.slice(0, -1))) return false;  // already there
  return destParent.length + subtreeDepth(srcPath) <= MAX_FOLDER_DEPTH;     // would exceed depth cap
}

// Move the folder at srcKey so it becomes a child of destParent, carrying its
// whole subtree (depth shifts). Merges if destParent already has a same-named
// child. Re-keys subtree metadata. Enforced ≤ MAX_FOLDER_DEPTH by callers, but
// re-checked here as a guard.
export function moveFolder(srcKey, destParent) {
  const srcPath = parseKey(srcKey);
  if (!srcPath || !srcPath.length || !Array.isArray(destParent)) return;
  if (!canMoveFolderUnder(srcPath, destParent)) { showToast('Can’t move there', true); return; }
  const name = srcPath[srcPath.length - 1];
  const newBase = [...destParent, name];
  const tail = arr => arr.slice(srcPath.length); // segments below the moved folder
  links.forEach(l => {
    const p = linkPath(l);
    if (pathStartsWith(p, srcPath)) setLinkLocation(l, [...newBase, ...tail(p)]);
  });
  remapFolderMeta(arr => {
    if (!pathStartsWith(arr, srcPath)) return arr;
    return [...newBase, ...tail(arr)];
  });
  clearChildOrderUnder(srcPath.slice(0, -1)); // old parent's child list
  clearChildOrderUnder(destParent);           // new parent's child list
  clearChildOrderUnder(srcPath);              // moved subtree's internal order
  persistFolderMeta();
  save(); saveConfig(); render();
  showToast(`Moved to ${destParent.length ? `"${destParent.join(' / ')}"` : 'top level'}`);
}

// --- Move-to-folder dialog --------------------------------------------------
let folderMoveSrc = null;
export function openFolderMove(srcKey) {
  const srcPath = parseKey(srcKey);
  if (!srcPath || !srcPath.length) return;
  folderMoveSrc = srcKey;
  const content = document.getElementById('folderMoveContent');
  document.getElementById('folderMoveTitle').textContent = `Move "${srcPath.join(' / ')}" into…`;
  // Candidate parents: top level + every existing folder that's a legal target.
  const cands = [[], ...allFolderPaths().map(parseKey)]
    .filter(dp => dp && canMoveFolderUnder(srcPath, dp))
    .sort((a, b) => a.join('').localeCompare(b.join('')));
  if (!cands.length) {
    content.innerHTML = '<p style="text-align:center;color:var(--text2);padding:24px 16px">No available destinations (would exceed 5 levels or only its own subtree).</p>';
  } else {
    content.innerHTML = cands.map(dp => {
      const label = dp.length ? esc(dp.join(' / ')) : '<em>(top level)</em>';
      const pad = 8 + dp.length * 16;
      return `<button class="fmgr-row folder-move-row" data-dest='${esc(pathKey(dp))}' style="width:100%;text-align:left;background:none;border:none;cursor:pointer;padding-left:${pad}px">
        <i class="ti ti-folder" style="color:var(--text2);font-size:14px;flex-shrink:0"></i>
        <span class="fmgr-name">${label}</span>
      </button>`;
    }).join('');
    content.querySelectorAll('.folder-move-row').forEach(btn => btn.addEventListener('click', () => {
      const src = folderMoveSrc;                       // capture before closeFolderMove() clears it
      const dest = parseKey(btn.dataset.dest) || [];
      closeFolderMove();
      moveFolder(src, dest);
    }));
  }
  document.getElementById('folderMoveBg').style.display = 'flex';
}
export function closeFolderMove() {
  document.getElementById('folderMoveBg').style.display = 'none';
  folderMoveSrc = null;
  linkMoveIds = null;
}

// Same dialog, but moves one or more LINKS into any folder (or to no folder).
// `ids` is a link id or an array of ids (e.g. the current multi-selection).
// Links have no subtree, so every folder path (plus top level) is a valid target.
let linkMoveIds = null;
export function openLinkMove(ids) {
  const list = (Array.isArray(ids) ? ids : [ids]).filter(Boolean);
  if (!list.length) return;
  linkMoveIds = list;
  const title = list.length === 1
    ? `Move "${(links.find(x => x.id === list[0]) || {}).title || 'link'}" to…`
    : `Move ${list.length} links to…`;
  document.getElementById('folderMoveTitle').textContent = title;
  const content = document.getElementById('folderMoveContent');
  const cands = [[], ...allFolderPaths().map(parseKey).filter(Boolean)]
    .sort((a, b) => a.join(' ').localeCompare(b.join(' ')));
  content.innerHTML = cands.map(dp => {
    const label = dp.length ? esc(dp.join(' / ')) : '<em>(no folder)</em>';
    const pad = 8 + dp.length * 16;
    return `<button class="fmgr-row folder-move-row" data-dest='${esc(pathKey(dp))}' style="width:100%;text-align:left;background:none;border:none;cursor:pointer;padding-left:${pad}px">
      <i class="ti ti-folder" style="color:var(--text2);font-size:14px;flex-shrink:0"></i>
      <span class="fmgr-name">${label}</span>
    </button>`;
  }).join('');
  content.querySelectorAll('.folder-move-row').forEach(btn => btn.addEventListener('click', () => {
    const targets = linkMoveIds;                      // capture before closeFolderMove() clears it
    const dest = parseKey(btn.dataset.dest) || [];
    closeFolderMove();
    let moved = 0;
    targets.forEach(tid => { const lk = links.find(x => x.id === tid); if (lk) { setLinkLocation(lk, dest); moved++; } });
    if (moved) { save(); render(); showToast(`${moved} link${moved > 1 ? 's' : ''} moved to ${dest.length ? `"${dest.join(' / ')}"` : 'no folder'}`); }
  }));
  document.getElementById('folderMoveBg').style.display = 'flex';
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
