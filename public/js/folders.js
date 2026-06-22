// ============================================================================
// folders.js — folder & sub-folder operations: collapse/expand, rename, delete.
// State (collapsedFolders/collapsedSubfolders/folderColors/subfolderColors/
// folderIcons/folderOrder) and the hub primitives live in app.js and are
// imported here (call-time circular import, fine in ESM). These mutate the
// shared state in place — folderOrder is spliced (not reassigned) so the live
// binding app.js holds stays valid.
// ============================================================================

import {
  links, save, render, saveConfig, allFolders,
  collapsedFolders, collapsedSubfolders,
  folderColors, subfolderColors, folderIcons, folderOrder,
} from './app.js';
import { showToast } from './toast.js';

export function toggleFolder(name) {
  const contentEl = Array.from(document.querySelectorAll('.folder-content')).find(el => el.dataset.folder === name);
  const isCollapsed = collapsedFolders.has(name);

  if (!isCollapsed && contentEl) {
    if (contentEl.dataset.animating) return;
    contentEl.dataset.animating = '1';
    const chevron = Array.from(document.querySelectorAll('.folder-header')).find(el => el.dataset.folder === name)?.querySelector('.folder-chevron');
    if (chevron) chevron.classList.remove('open');
    contentEl.style.overflow = 'hidden';
    contentEl.style.maxHeight = contentEl.scrollHeight + 'px';
    contentEl.style.opacity = '1';
    requestAnimationFrame(() => {
      contentEl.style.transition = 'max-height 0.25s ease, opacity 0.2s ease';
      contentEl.style.maxHeight = '0';
      contentEl.style.opacity = '0';
    });
    setTimeout(() => {
      delete contentEl.dataset.animating;
      collapsedFolders.add(name);
      localStorage.setItem('msp-collapsed', JSON.stringify([...collapsedFolders]));
      render();
    }, 260);
    return;
  }

  if (isCollapsed) collapsedFolders.delete(name);
  else collapsedFolders.add(name);
  localStorage.setItem('msp-collapsed', JSON.stringify([...collapsedFolders]));
  render();

  if (isCollapsed) {
    const newEl = Array.from(document.querySelectorAll('.folder-content')).find(el => el.dataset.folder === name);
    if (newEl && !newEl.dataset.animating) {
      newEl.dataset.animating = '1';
      const height = newEl.scrollHeight;
      newEl.style.overflow = 'hidden';
      newEl.style.maxHeight = '0';
      newEl.style.opacity = '0';
      requestAnimationFrame(() => requestAnimationFrame(() => {
        newEl.style.transition = 'max-height 0.25s ease, opacity 0.2s ease';
        newEl.style.maxHeight = height + 'px';
        newEl.style.opacity = '1';
        setTimeout(() => {
          delete newEl.dataset.animating;
          newEl.style.maxHeight = '';
          newEl.style.overflow = '';
          newEl.style.transition = '';
          newEl.style.opacity = '';
        }, 260);
      }));
    }
  }
}

export function collapseAll() {
  allFolders().forEach(f => collapsedFolders.add(f));
  localStorage.setItem('msp-collapsed', JSON.stringify([...collapsedFolders]));
  render();
}
export function expandAll() {
  collapsedFolders.clear();
  localStorage.setItem('msp-collapsed', JSON.stringify([]));
  render();
}
export function renameFolder(oldName, newName) {
  newName = newName.trim();
  if (!newName || newName === oldName) return;
  // Update all links
  links.forEach(l => { if (l.folder === oldName) l.folder = newName; });
  // Update folderColors
  if (folderColors[oldName]) {
    folderColors[newName] = folderColors[oldName];
    delete folderColors[oldName];
    localStorage.setItem('msp-folder-colors', JSON.stringify(folderColors));
  }
  // Update folderOrder
  if (folderOrder) {
    const idx = folderOrder.indexOf(oldName);
    if (idx > -1) folderOrder[idx] = newName;
    localStorage.setItem('msp-folder-order', JSON.stringify(folderOrder));
  }
  // Update collapsedFolders
  if (collapsedFolders.has(oldName)) {
    collapsedFolders.delete(oldName);
    collapsedFolders.add(newName);
    localStorage.setItem('msp-collapsed', JSON.stringify([...collapsedFolders]));
  }
  // Update folderIcons
  if (folderIcons[oldName]) {
    folderIcons[newName] = folderIcons[oldName];
    delete folderIcons[oldName];
    localStorage.setItem('msp-folder-icons', JSON.stringify(folderIcons));
  }
  // Migrate subfolder keys (collapsed state + colors) — they embed the folder name
  [['msp-subfolder-collapsed', collapsedSubfolders], ['msp-subfolder-colors', subfolderColors]].forEach(([lsKey, store]) => {
    Object.keys(store).forEach(key => {
      try {
        const parsed = JSON.parse(key);
        if (parsed[0] === oldName) {
          store[JSON.stringify([newName, parsed[1]])] = store[key];
          delete store[key];
        }
      } catch {}
    });
    localStorage.setItem(lsKey, JSON.stringify(store));
  });
  save();
  saveConfig();
}
export function deleteFolder(name) {
  const count = links.filter(l => !l.archived && l.folder === name).length;
  if (!confirm(`Delete folder "${name}"? ${count} link${count !== 1 ? 's' : ''} will be moved to no folder.`)) return;
  links.forEach(l => { if (l.folder === name) { l.folder = ''; l.subfolder = null; } });
  delete folderColors[name];
  localStorage.setItem('msp-folder-colors', JSON.stringify(folderColors));
  delete folderIcons[name];
  localStorage.setItem('msp-folder-icons', JSON.stringify(folderIcons));
  if (folderOrder) {
    const idx = folderOrder.indexOf(name);
    if (idx > -1) folderOrder.splice(idx, 1);
    localStorage.setItem('msp-folder-order', JSON.stringify(folderOrder));
  }
  collapsedFolders.delete(name);
  localStorage.setItem('msp-collapsed', JSON.stringify([...collapsedFolders]));
  Object.keys(collapsedSubfolders).forEach(key => {
    try { if (JSON.parse(key)[0] === name) delete collapsedSubfolders[key]; } catch {}
  });
  localStorage.setItem('msp-subfolder-collapsed', JSON.stringify(collapsedSubfolders));
  Object.keys(subfolderColors).forEach(key => {
    try { if (JSON.parse(key)[0] === name) delete subfolderColors[key]; } catch {}
  });
  localStorage.setItem('msp-subfolder-colors', JSON.stringify(subfolderColors));
  save(); render(); saveConfig();
  showToast(`Folder "${name}" deleted`);
}
export function deleteSubfolder(folderName, subName) {
  const count = links.filter(l => !l.archived && l.folder === folderName && l.subfolder === subName).length;
  if (!confirm(`Delete sub-folder "${subName}"? ${count} link${count !== 1 ? 's' : ''} will be moved to folder "${folderName}".`)) return;
  links.forEach(l => { if (l.folder === folderName && l.subfolder === subName) l.subfolder = null; });
  const key = JSON.stringify([folderName, subName]);
  delete collapsedSubfolders[key];
  localStorage.setItem('msp-subfolder-collapsed', JSON.stringify(collapsedSubfolders));
  delete subfolderColors[key];
  localStorage.setItem('msp-subfolder-colors', JSON.stringify(subfolderColors));
  save(); render(); saveConfig();
  showToast(`Sub-folder "${subName}" deleted`);
}

export function moveSubfolder(srcFolder, subName, destFolder) {
  if (!destFolder || destFolder === srcFolder) return;
  // Re-parent every link in this sub-folder; the sub-folder name is preserved,
  // so if destFolder already has a sub-folder of the same name the two merge.
  let moved = 0;
  links.forEach(l => {
    if (l.folder === srcFolder && l.subfolder === subName) { l.folder = destFolder; moved++; }
  });
  if (!moved) return;
  // Migrate per-sub-folder UI state (collapsed + color), which is keyed on the
  // parent folder name — without clobbering state the destination already has.
  const oldKey = JSON.stringify([srcFolder, subName]);
  const newKey = JSON.stringify([destFolder, subName]);
  [['msp-subfolder-collapsed', collapsedSubfolders], ['msp-subfolder-colors', subfolderColors]].forEach(([lsKey, store]) => {
    if (store[oldKey] !== undefined) {
      if (store[newKey] === undefined) store[newKey] = store[oldKey];
      delete store[oldKey];
      localStorage.setItem(lsKey, JSON.stringify(store));
    }
  });
  save(); render(); saveConfig();
  showToast(`Moved "${subName}" to "${destFolder}"`);
}

export function startFolderRename(btn) {
  const header = btn.closest('.folder-header[data-folder]');
  if (!header) return;
  const oldName = header.dataset.folder;
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
    if (newName && newName !== oldName) {
      renameFolder(oldName, newName);
      render();
    } else {
      input.replaceWith(nameSpan);
    }
  }
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { committed = true; input.replaceWith(nameSpan); }
  });
  input.addEventListener('blur', commit);
}
export function renameSubfolder(folderName, oldName, newName) {
  newName = newName.trim();
  if (!newName || newName === oldName) return;
  links.forEach(l => { if (l.folder === folderName && l.subfolder === oldName) l.subfolder = newName; });
  const oldKey = JSON.stringify([folderName, oldName]);
  const newKey = JSON.stringify([folderName, newName]);
  if (collapsedSubfolders[oldKey] !== undefined) {
    collapsedSubfolders[newKey] = collapsedSubfolders[oldKey];
    delete collapsedSubfolders[oldKey];
    localStorage.setItem('msp-subfolder-collapsed', JSON.stringify(collapsedSubfolders));
  }
  if (subfolderColors[oldKey] !== undefined) {
    subfolderColors[newKey] = subfolderColors[oldKey];
    delete subfolderColors[oldKey];
    localStorage.setItem('msp-subfolder-colors', JSON.stringify(subfolderColors));
  }
  save();
  saveConfig();
}
export function startSubfolderRename(btn) {
  const header = btn.closest('.subfolder-header');
  if (!header) return;
  const folderName = header.dataset.folder;
  const oldName = header.dataset.subfolder;
  const nameSpan = header.querySelector('.subfolder-title');
  if (!nameSpan || header.querySelector('.folder-rename-input')) return;
  const input = document.createElement('input');
  input.type = 'text';
  input.value = oldName;
  input.className = 'folder-rename-input';
  input.style.cssText = 'height:20px;padding:0 6px;border-radius:5px;border:1px solid var(--g4);background:var(--bg2);color:var(--text0);font-size:12px;font-weight:500;font-family:inherit;width:120px';
  nameSpan.replaceWith(input);
  input.focus();
  input.select();
  let committed = false;
  function commit() {
    if (committed) return;
    committed = true;
    const newName = input.value.trim();
    if (newName && newName !== oldName) { renameSubfolder(folderName, oldName, newName); render(); }
    else input.replaceWith(nameSpan);
  }
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { committed = true; input.replaceWith(nameSpan); }
  });
  input.addEventListener('blur', commit);
}

export function toggleSubfolder(folderName, subfolder) {
  const key = JSON.stringify([folderName, subfolder]);
  collapsedSubfolders[key] = !collapsedSubfolders[key];
  localStorage.setItem('msp-subfolder-collapsed', JSON.stringify(collapsedSubfolders));
  render();
}
