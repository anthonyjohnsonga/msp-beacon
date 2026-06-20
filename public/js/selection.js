// ============================================================================
// selection.js — multi-select mode + the bulk action bar (move / tag / archive
// / delete). Owns selectMode + selectedIds (app.js render reads them). Bulk
// delete/move reassign the links array and the pending undo timers, which live
// in app.js, so they go through the setLinks/setPendingDelete/setPendingMove
// mutation layer (call-time circular imports, fine in ESM).
// ============================================================================

import { esc } from './utils.js';
import { showToast, showUndoToast } from './toast.js';
import {
  links, setLinks, pendingDelete, setPendingDelete, setPendingMove,
  commitPendingMove, visibleIds, render, save, allFolders, subfoldersByFolder,
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
    + allFolders().map(f => `<option value="${esc(f)}">${esc(f)}</option>`).join('')
    + '<option value="__none__">— Remove from folder</option>';
  document.getElementById('bulkMoveSubfolder').style.display = 'none';
  document.getElementById('bulkMoveConfirm').style.display = 'none';
  document.getElementById('bulkMoveSubfolder').value = '';
}

export function onBulkFolderChange(sel) {
  if (!sel.value || sel.value === '__none__') {
    if (sel.value === '__none__' && selectedIds.size) {
      const n = selectedIds.size;
      links.forEach(l => { if (selectedIds.has(l.id)) { l.folder = ''; l.subfolder = null; } });
      sel.value = '';
      document.getElementById('bulkMoveSubfolder').style.display = 'none';
      document.getElementById('bulkMoveConfirm').style.display = 'none';
      save(); render(); updateBulkBar();
      showToast(`${n} link${n > 1 ? 's' : ''} moved`);
    } else {
      document.getElementById('bulkMoveSubfolder').style.display = 'none';
      document.getElementById('bulkMoveConfirm').style.display = 'none';
    }
    return;
  }
  const folder = sel.value;
  const subs = subfoldersByFolder(folder);
  const dl = document.getElementById('bulkSubfolderList');
  dl.innerHTML = subs.map(s => `<option value="${esc(s)}">`).join('');
  document.getElementById('bulkMoveSubfolder').style.display = '';
  document.getElementById('bulkMoveSubfolder').value = '';
  document.getElementById('bulkMoveConfirm').style.display = 'flex';
}

export function confirmBulkMove() {
  const sel = document.getElementById('bulkMoveFolder');
  if (!sel.value || !selectedIds.size) { sel.value = ''; return; }
  if (pendingDelete) { clearTimeout(pendingDelete.timer); save(); setPendingDelete(null); }
  commitPendingMove();
  const saved = links.slice();
  const n = selectedIds.size;
  const folder = sel.value;
  const subfolder = document.getElementById('bulkMoveSubfolder').value.trim() || null;
  links.forEach(l => { if (selectedIds.has(l.id)) { l.folder = folder; l.subfolder = subfolder; } });
  sel.value = '';
  document.getElementById('bulkMoveSubfolder').style.display = 'none';
  document.getElementById('bulkMoveConfirm').style.display = 'none';
  render(); updateBulkBar();
  const label = subfolder ? `${folder} / ${subfolder}` : folder;
  setPendingMove({ saved, timer: setTimeout(() => { setPendingMove(null); save(); }, 5000) });
  showUndoToast(`${n} link${n > 1 ? 's' : ''} moved to "${label}" — Undo?`, 'ti-arrows-move');
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
