// ============================================================================
// contextmenu.js — right-click menu for links, tags, folders, and sub-folders.
// onContextMenu builds a menu of {icon,label,action} items and dispatches to
// action functions that live across app.js / folders.js / pickers.js (call-time
// circular imports, fine in ESM). showContextMenu/cursorAnchor/copyLinkUrl are
// internal; app.js imports onContextMenu (wired in setupCardListeners) and
// hideContextMenu (global scroll/resize/click handlers).
// ============================================================================

import { esc, pathKey } from './utils.js';
import { showToast } from './toast.js';
import {
  links, filterByTag, openLink, editLink, toggleFavorite, toggleReadLater,
  deleteLink, openFolderFromHome,
} from './app.js';
import { archiveLink } from './archive.js';
import { selectMode, selectedIds } from './selection.js';
import { deleteFolder, startFolderRename, moveFolder, openFolderMove, openLinkMove } from './folders.js';
import { openFolderColorPicker, openFolderIconPicker, openTagColorPicker } from './pickers.js';

// Returns a fake anchor element positioned at the cursor, for the color/icon pickers.
function cursorAnchor(x, y) {
  return { getBoundingClientRect: () => ({ top: y, bottom: y, left: x, right: x, width: 0, height: 0 }) };
}
function copyLinkUrl(url) {
  navigator.clipboard.writeText(url).then(() => showToast('URL copied')).catch(() => showToast('Copy failed', true));
}

export function onContextMenu(e) {
  const tagEl = e.target.closest('.tag[data-tag]');
  if (tagEl) {
    const tag = tagEl.dataset.tag;
    e.preventDefault();
    showContextMenu(e.clientX, e.clientY, [
      { icon: 'ti-palette', label: 'Change color', action: () => openTagColorPicker(tag, cursorAnchor(e.clientX, e.clientY)) },
      { icon: 'ti-filter', label: 'Filter by this tag', action: () => filterByTag(tag) },
    ]);
    return;
  }
  const linkEl = e.target.closest('.card[data-id], .card-row[data-id], .home-tile[data-id]');
  const folderTile = e.target.closest('.home-folder-tile[data-folder]');
  const folderHeader = e.target.closest('.folder-header[data-path]');
  const anchor = cursorAnchor(e.clientX, e.clientY);
  let items = null;

  if (linkEl && linkEl.dataset.id) {
    const id = linkEl.dataset.id;
    const l = links.find(x => x.id === id);
    if (!l) return;
    items = [
      { icon: 'ti-external-link', label: 'Open', action: () => openLink(id, l.url) },
      { icon: 'ti-copy', label: 'Copy URL', action: () => copyLinkUrl(l.url) },
      { icon: 'ti-edit', label: 'Edit', action: () => editLink(id) },
      // If this link is part of an active multi-selection, move the whole selection.
      ...(selectMode && selectedIds.has(id) && selectedIds.size > 1
        ? [{ icon: 'ti-folder-symlink', label: `Move ${selectedIds.size} links to folder…`, action: () => openLinkMove([...selectedIds]) }]
        : [{ icon: 'ti-folder-symlink', label: 'Move to folder…', action: () => openLinkMove(id) }]),
      { icon: l.favorite ? 'ti-star-off' : 'ti-star', label: l.favorite ? 'Unfavorite' : 'Favorite', action: () => toggleFavorite(id) },
      { icon: l.readLater ? 'ti-bookmark-off' : 'ti-bookmark', label: l.readLater ? 'Remove from read later' : 'Read later', action: () => toggleReadLater(id) },
      { sep: true },
      { icon: 'ti-archive', label: 'Archive', action: () => archiveLink(id) },
      { icon: 'ti-trash', label: 'Delete', danger: true, action: () => deleteLink(id) },
    ];
  } else if (folderTile) {
    const f = folderTile.dataset.folder, key = pathKey([f]);
    items = [
      { icon: 'ti-folder-open', label: 'Open folder', action: () => openFolderFromHome(f) },
      { icon: 'ti-folder-symlink', label: 'Move to folder…', action: () => openFolderMove(key) },
      { icon: 'ti-palette', label: 'Change color', action: () => openFolderColorPicker(key, anchor) },
      { icon: 'ti-photo', label: 'Change icon', action: () => openFolderIconPicker(key, anchor) },
      { sep: true },
      { icon: 'ti-trash', label: 'Delete folder', danger: true, action: () => deleteFolder(key) },
    ];
  } else if (folderHeader) {
    const key = folderHeader.dataset.path;
    let path; try { path = JSON.parse(key); } catch { path = []; }
    items = [
      { icon: 'ti-pencil', label: 'Rename', action: () => startFolderRename(folderHeader.querySelector('.folder-rename-btn')) },
      { icon: 'ti-folder-symlink', label: 'Move to folder…', action: () => openFolderMove(key) },
    ];
    if (path.length > 1) {
      items.push({ icon: 'ti-arrow-up', label: 'Move up one level', action: () => moveFolder(key, path.slice(0, -2)) });
      items.push({ icon: 'ti-arrow-bar-to-up', label: 'Promote to top level', action: () => moveFolder(key, []) });
    }
    items.push(
      { icon: 'ti-palette', label: 'Change color', action: () => openFolderColorPicker(key, anchor) },
      { icon: 'ti-photo', label: 'Change icon', action: () => openFolderIconPicker(key, anchor) },
      { sep: true },
      { icon: 'ti-trash', label: 'Delete folder', danger: true, action: () => deleteFolder(key) },
    );
  }

  if (!items) return;
  e.preventDefault();
  showContextMenu(e.clientX, e.clientY, items);
}

function showContextMenu(x, y, items) {
  const menu = document.getElementById('ctxMenu');
  menu.innerHTML = items.map((it, i) => it.sep
    ? '<div class="ctx-sep"></div>'
    : `<button class="ctx-item${it.danger ? ' danger' : ''}" data-ctx="${i}"><i class="ti ${it.icon}"></i>${esc(it.label)}</button>`).join('');
  menu.querySelectorAll('[data-ctx]').forEach(btn => {
    btn.addEventListener('click', ev => { ev.stopPropagation(); hideContextMenu(); items[+btn.dataset.ctx].action(); });
  });
  menu.style.display = 'flex';
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';
  const rect = menu.getBoundingClientRect();
  if (rect.right > window.innerWidth - 8) menu.style.left = Math.max(8, x - rect.width) + 'px';
  if (rect.bottom > window.innerHeight - 8) menu.style.top = Math.max(8, y - rect.height) + 'px';
  menu.classList.add('open');
}
export function hideContextMenu() {
  const menu = document.getElementById('ctxMenu');
  if (menu) { menu.classList.remove('open'); menu.style.display = 'none'; }
}
