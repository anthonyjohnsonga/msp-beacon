// ============================================================================
// drag.js — drag-and-drop reordering & moving.
// One delegated listener set on #content handles three drag kinds:
//   • cards (links)      → move into a folder / sub-folder, or reorder near a card
//   • folder headers     → reorder top-level folders
//   • sub-folder headers → re-parent a sub-folder under another folder
//   • home tiles/widgets → reorder favorites, folder tiles, and dashboard widgets
// Drag state lives module-locally here. Anything it must REASSIGN in app.js
// (links' pending-undo timers, folderOrder) goes through the exported setters,
// since an imported `let` binding can't be reassigned by the importer; links
// itself is only mutated in place (splice / property writes).
// ============================================================================

import {
  links, save, render, saveConfig, allFolders, getOrderedFolders,
  pendingDelete, setPendingDelete, setPendingMove, commitPendingMove,
  setFolderOrder, dashboardEditMode, ensureDashboard, persistDashboard, reorderFavorite,
} from './app.js';
import { showUndoToast } from './toast.js';
import { moveSubfolder } from './folders.js';

let dragId = null;
let dragFolder = null;
let dragSubfolder = null;
let dragOverEl = null;
let homeDrag = null;

export function setupDragListeners() {
  const content = document.getElementById('content');

  content.addEventListener('dragstart', e => {
    const wHandle = e.target.closest('.widget-drag-handle');
    if (wHandle) {
      const wrap = wHandle.closest('[data-widget-id]');
      if (!wrap) return;
      homeDrag = { type: 'widget', key: wrap.dataset.widgetId };
      dragId = null; dragFolder = null; dragSubfolder = null;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', homeDrag.key);
      setTimeout(() => wrap.classList.add('dragging'), 0);
      return;
    }
    const homeTile = e.target.closest('.home-tile[draggable="true"]');
    if (homeTile) {
      if (dashboardEditMode) return; // tile reorder is disabled while editing widgets
      if (homeTile.classList.contains('home-folder-tile')) {
        homeDrag = { type: 'folder', key: homeTile.dataset.folder };
      } else if (homeTile.dataset.id && homeTile.closest('[data-home-section="favorites"]')) {
        homeDrag = { type: 'fav', key: homeTile.dataset.id };
      } else { return; }
      dragId = null; dragFolder = null; dragSubfolder = null;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', homeDrag.key);
      setTimeout(() => homeTile.classList.add('dragging'), 0);
      return;
    }
    const handle = e.target.closest('.drag-handle');
    const folderHandle = e.target.closest('.folder-drag-handle');
    const subfolderHandle = e.target.closest('.subfolder-drag-handle');
    if (handle) {
      const card = handle.closest('.card[data-id]');
      if (!card) return;
      dragId = card.dataset.id;
      dragFolder = null; dragSubfolder = null;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', dragId);
      e.dataTransfer.setDragImage(card, 20, 20);
      setTimeout(() => card.classList.add('dragging'), 0);
    } else if (folderHandle) {
      const header = folderHandle.closest('.folder-header[data-folder]');
      if (!header) return;
      dragFolder = header.dataset.folder;
      dragId = null; dragSubfolder = null;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', dragFolder);
      e.dataTransfer.setDragImage(header, 20, 10);
      setTimeout(() => header.classList.add('dragging'), 0);
    } else if (subfolderHandle) {
      const header = subfolderHandle.closest('.subfolder-header[data-subfolder]');
      if (!header) return;
      dragSubfolder = { folder: header.dataset.folder, subfolder: header.dataset.subfolder };
      dragId = null; dragFolder = null;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', header.dataset.subfolder);
      e.dataTransfer.setDragImage(header, 20, 10);
      setTimeout(() => header.classList.add('dragging'), 0);
    }
  });

  content.addEventListener('dragover', e => {
    if (homeDrag && homeDrag.type === 'widget') {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const t = e.target.closest('.home-widget[data-widget-id]');
      const target = (t && t.dataset.widgetId !== homeDrag.key) ? t : null;
      if (target !== dragOverEl) {
        if (dragOverEl) dragOverEl.classList.remove('drag-over');
        dragOverEl = target;
        if (dragOverEl) dragOverEl.classList.add('drag-over');
      }
      return;
    }
    if (homeDrag) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      let target = null;
      if (homeDrag.type === 'folder') {
        const t = e.target.closest('.home-folder-tile');
        if (t && t.dataset.folder !== homeDrag.key) target = t;
      } else {
        const t = e.target.closest('.home-tile[data-id]');
        if (t && t.dataset.id !== homeDrag.key && t.closest('[data-home-section="favorites"]')) target = t;
      }
      if (target !== dragOverEl) {
        if (dragOverEl) dragOverEl.classList.remove('drag-over');
        dragOverEl = target;
        if (dragOverEl) dragOverEl.classList.add('drag-over');
      }
      return;
    }
    if (!dragId && !dragFolder && !dragSubfolder) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    let newTarget = null;
    if (dragId) {
      const card = e.target.closest('.card[data-id], .card-row[data-id]');
      if (card && card.dataset.id !== dragId) {
        newTarget = card;
      } else if (!card) {
        const sfHeader = e.target.closest('.subfolder-header[data-subfolder]');
        if (sfHeader) {
          newTarget = sfHeader;
        } else {
          const header = e.target.closest('.folder-header[data-folder]');
          if (header) newTarget = header;
        }
      }
    } else if (dragFolder) {
      const header = e.target.closest('.folder-header[data-folder]');
      if (header && header.dataset.folder !== dragFolder) newTarget = header;
    } else if (dragSubfolder) {
      const header = e.target.closest('.folder-header[data-folder]');
      if (header && header.dataset.folder !== dragSubfolder.folder) newTarget = header;
    }
    if (newTarget !== dragOverEl) {
      if (dragOverEl) dragOverEl.classList.remove('drag-over');
      dragOverEl = newTarget;
      if (dragOverEl) dragOverEl.classList.add('drag-over');
    }
  });

  content.addEventListener('dragleave', e => {
    if (!content.contains(e.relatedTarget)) {
      if (dragOverEl) dragOverEl.classList.remove('drag-over');
      dragOverEl = null;
    }
  });

  content.addEventListener('drop', e => {
    e.preventDefault();
    if (dragOverEl) dragOverEl.classList.remove('drag-over');
    document.querySelectorAll('.dragging').forEach(el => el.classList.remove('dragging'));
    if (homeDrag && homeDrag.type === 'widget') {
      const t = e.target.closest('.home-widget[data-widget-id]');
      if (t && t.dataset.widgetId !== homeDrag.key) {
        const d = ensureDashboard();
        const si = d.findIndex(w => w.id === homeDrag.key);
        const ti = d.findIndex(w => w.id === t.dataset.widgetId);
        if (si > -1 && ti > -1) {
          const [m] = d.splice(si, 1);
          d.splice(ti, 0, m);
          persistDashboard(); render();
        }
      }
      homeDrag = null; dragOverEl = null;
      return;
    }
    if (homeDrag) {
      if (homeDrag.type === 'folder') {
        const t = e.target.closest('.home-folder-tile');
        if (t && t.dataset.folder !== homeDrag.key) {
          const names = getOrderedFolders(allFolders());
          const si = names.indexOf(homeDrag.key), ti = names.indexOf(t.dataset.folder);
          if (si > -1 && ti > -1) {
            names.splice(si, 1);
            names.splice(ti, 0, homeDrag.key);
            setFolderOrder(names);
            render();
            saveConfig();
          }
        }
      } else {
        const t = e.target.closest('.home-tile[data-id]');
        if (t && t.dataset.id !== homeDrag.key && t.closest('[data-home-section="favorites"]')) {
          reorderFavorite(homeDrag.key, t.dataset.id);
        }
      }
      homeDrag = null; dragOverEl = null;
      return;
    }
    if (dragId) {
      const card = e.target.closest('.card[data-id], .card-row[data-id]');
      const sfHeader = e.target.closest('.subfolder-header[data-subfolder]');
      const header = !sfHeader ? e.target.closest('.folder-header[data-folder]') : null;
      if (card && card.dataset.id !== dragId) {
        if (pendingDelete) { clearTimeout(pendingDelete.timer); save(); setPendingDelete(null); }
        commitPendingMove();
        const saved = links.slice();
        const srcIdx = links.findIndex(l => l.id === dragId);
        const tgtLink = links.find(l => l.id === card.dataset.id);
        const [moved] = links.splice(srcIdx, 1);
        const destFolder = tgtLink.folder || '';
        moved.folder = destFolder;
        moved.subfolder = tgtLink.subfolder || null;
        const newTgt = links.findIndex(l => l.id === card.dataset.id);
        links.splice(newTgt, 0, moved);
        render();
        setPendingMove({ saved, timer: setTimeout(() => { setPendingMove(null); save(); }, 5000) });
        showUndoToast(`Moved to "${destFolder || 'no folder'}" — Undo?`, 'ti-arrows-move');
      } else if (sfHeader) {
        const srcIdx = links.findIndex(l => l.id === dragId);
        if (srcIdx > -1) {
          if (pendingDelete) { clearTimeout(pendingDelete.timer); save(); setPendingDelete(null); }
          commitPendingMove();
          const saved = links.slice();
          links[srcIdx].folder = sfHeader.dataset.folder;
          links[srcIdx].subfolder = sfHeader.dataset.subfolder;
          render();
          setPendingMove({ saved, timer: setTimeout(() => { setPendingMove(null); save(); }, 5000) });
          showUndoToast(`Moved to ${sfHeader.dataset.folder} / ${sfHeader.dataset.subfolder} — Undo?`, 'ti-arrows-move');
        }
      } else if (header) {
        const srcIdx = links.findIndex(l => l.id === dragId);
        if (srcIdx > -1) {
          if (pendingDelete) { clearTimeout(pendingDelete.timer); save(); setPendingDelete(null); }
          commitPendingMove();
          const saved = links.slice();
          links[srcIdx].folder = header.dataset.folder;
          links[srcIdx].subfolder = null;
          render();
          setPendingMove({ saved, timer: setTimeout(() => { setPendingMove(null); save(); }, 5000) });
          showUndoToast(`Moved to "${header.dataset.folder}" — Undo?`, 'ti-arrows-move');
        }
      }
    } else if (dragFolder) {
      const header = e.target.closest('.folder-header[data-folder]');
      if (header && header.dataset.folder !== dragFolder) {
        const names = getOrderedFolders(allFolders());
        const si = names.indexOf(dragFolder), ti = names.indexOf(header.dataset.folder);
        if (si > -1 && ti > -1) {
          names.splice(si, 1);
          names.splice(ti, 0, dragFolder);
          setFolderOrder(names);
          render();
          saveConfig();
        }
      }
    } else if (dragSubfolder) {
      const header = e.target.closest('.folder-header[data-folder]');
      if (header && header.dataset.folder !== dragSubfolder.folder) {
        moveSubfolder(dragSubfolder.folder, dragSubfolder.subfolder, header.dataset.folder);
      }
    }
    dragId = null; dragFolder = null; dragSubfolder = null; dragOverEl = null;
  });

  content.addEventListener('dragend', () => {
    dragId = null; dragFolder = null; dragSubfolder = null; homeDrag = null;
    if (dragOverEl) dragOverEl.classList.remove('drag-over');
    dragOverEl = null;
    document.querySelectorAll('.dragging').forEach(el => el.classList.remove('dragging'));
  });
}
