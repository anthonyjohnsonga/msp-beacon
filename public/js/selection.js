// ============================================================================
// selection.js — multi-select mode + the bulk action bar (move / tag / archive
// / delete). Owns selectMode + selectedIds (app.js render reads them). Bulk
// delete/move reassign the links array and the pending undo timers, which live
// in app.js, so they go through the setLinks/setPendingDelete/setPendingMove
// mutation layer (call-time circular imports, fine in ESM).
// ============================================================================

import { esc, pathKey } from './utils.js';
import { showToast, showUndoToast } from './toast.js';
import {
  links, setLinks, setLinkLocation, pendingDelete, setPendingDelete, setPendingMove,
  commitPendingMove, visibleIds, render, save, allFolderPaths, childFolders,
} from './app.js';

export let selectMode = false;
export const selectedIds = new Set();

export function toggleSelectMode() {
  selectMode = !selectMode;
  selectedIds.clear();
  document.getElementById('selectBtn').classList.toggle('active', selectMode);
  document.getElementById('bulkBar').classList.toggle('hidden', !selectMode);
  render();
  if (selectMode) updateBulkBar();
}

export function exitSelectMode() {
  selectMode = false;
  selectedIds.clear();
  document.getElementById('selectBtn').classList.remove('active');
  document.getElementById('bulkBar').classList.add('hidden');
  render();
}

export function toggleSelect(id) {
  if (selectedIds.has(id)) selectedIds.delete(id);
  else selectedIds.add(id);
  const card = document.querySelector(`.card[data-id="${id}"], .card-row[data-id="${id}"]`);
  if (card) {
    const sel = selectedIds.has(id);
    card.classList.toggle('selected', sel);
    const chk = card.querySelector('.card-check');
    if (chk) chk.classList.toggle('checked', sel);
  }
  updateBulkBar();
}

export function selectAllVisible() {
  visibleIds.forEach(id => selectedIds.add(id));
  render(); updateBulkBar();
}

export function clearSelection() {
  selectedIds.clear();
  render(); updateBulkBar();
}

function updateBulkBar() {
  const n = selectedIds.size;
  document.getElementById('bulkCount').textContent = n + ' selected';
  const mf = document.getElementById('bulkMoveFolder');
  mf.innerHTML = '<option value="">Move to folder…</option>'
    + allFolderPaths().map(k => JSON.parse(k)).sort((a, b) => a.join(' ').localeCompare(b.join(' ')))
        .map(p => `<option value="${esc(pathKey(p))}">${esc(p.join(' / '))}</option>`).join('')
    + '<option value="__none__">— Remove from folder</option>';
  document.getElementById('bulkMoveSubfolder').value = '';
  document.getElementById('bulkSubfolderList').innerHTML = '';
}

export function onBulkFolderChange(sel) {
  // "Remove from folder" acts immediately; picking a real path just refreshes the
  // optional new-sub-folder suggestions (the Move button applies it).
  if (sel.value === '__none__') {
    if (selectedIds.size) {
      const n = selectedIds.size;
      const saved = links.slice();
      if (pendingDelete) { clearTimeout(pendingDelete.timer); save(); setPendingDelete(null); }
      commitPendingMove();
      links.forEach(l => { if (selectedIds.has(l.id)) setLinkLocation(l, []); });
      render(); updateBulkBar();
      setPendingMove({ saved, timer: setTimeout(() => { setPendingMove(null); save(); }, 5000) });
      showUndoToast(`${n} link${n > 1 ? 's' : ''} removed from folder — Undo?`, 'ti-arrows-move');
    }
    sel.value = '';
    return;
  }
  const dl = document.getElementById('bulkSubfolderList');
  if (!sel.value) { dl.innerHTML = ''; return; }
  let destPath; try { destPath = JSON.parse(sel.value); } catch { destPath = []; }
  dl.innerHTML = childFolders(destPath).sort().map(s => `<option value="${esc(s)}">`).join('');
}

export function confirmBulkMove() {
  const sel = document.getElementById('bulkMoveFolder');
  if (!sel.value || !selectedIds.size) { sel.value = ''; return; }
  if (pendingDelete) { clearTimeout(pendingDelete.timer); save(); setPendingDelete(null); }
  commitPendingMove();
  const saved = links.slice();
  const n = selectedIds.size;
  let destPath; try { destPath = JSON.parse(sel.value); } catch { destPath = []; }
  const sub = document.getElementById('bulkMoveSubfolder').value.trim();
  const finalPath = sub ? [...destPath, sub] : destPath;
  links.forEach(l => { if (selectedIds.has(l.id)) setLinkLocation(l, finalPath); });
  sel.value = '';
  render(); updateBulkBar();
  setPendingMove({ saved, timer: setTimeout(() => { setPendingMove(null); save(); }, 5000) });
  showUndoToast(`${n} link${n > 1 ? 's' : ''} moved to "${finalPath.join(' / ')}" — Undo?`, 'ti-arrows-move');
}

export function bulkDelete() {
  if (!selectedIds.size) return;
  commitPendingMove();
  const n = selectedIds.size;
  if (pendingDelete) { clearTimeout(pendingDelete.timer); save(); }
  const saved = links.slice();
  setLinks(links.filter(l => !selectedIds.has(l.id)));
  selectedIds.clear();
  render(); updateBulkBar();
  setPendingDelete({
    saved,
    timer: setTimeout(() => { setPendingDelete(null); save(); }, 5000)
  });
  showUndoToast(`${n} link${n > 1 ? 's' : ''} deleted — Undo?`);
}

export function bulkAddTag() {
  const input = document.getElementById('bulkTagInput');
  const tag = input.value.trim();
  if (!tag || !selectedIds.size) return;
  const n = selectedIds.size;
  links.forEach(l => {
    if (selectedIds.has(l.id) && !(l.tags || []).includes(tag))
      l.tags = [...(l.tags || []), tag];
  });
  input.value = '';
  save(); render(); updateBulkBar();
  showToast(`Tag "${tag}" added to ${n} link${n > 1 ? 's' : ''}`);
}

export function bulkArchive() {
  if (!selectedIds.size) return;
  commitPendingMove();
  if (pendingDelete) { clearTimeout(pendingDelete.timer); save(); setPendingDelete(null); }
  const n = selectedIds.size;
  links.forEach(l => { if (selectedIds.has(l.id)) l.archived = true; });
  selectedIds.clear();
  save(); render(); updateBulkBar();
  showToast(`${n} link${n > 1 ? 's' : ''} archived`);
}
