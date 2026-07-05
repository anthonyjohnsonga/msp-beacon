// ============================================================================
// trash.js — soft-deleted links + the Trash modal (restore / delete forever /
// empty trash / badge count). Deletes set l.deleted = timestamp (in app.js's
// deleteLink/bulkDelete); trashed links are filtered out of every view and are
// auto-purged after the retention window (purgeTrash in app.js, on load).
// Mirrors archive.js. Restore clears the flag; delete-forever removes the
// record via the app.js state-mutation layer (call-time circular imports).
// ============================================================================

import { esc, getDomain, timeAgo } from './utils.js';
import { showToast } from './toast.js';
import { confirmDialog } from './dialog.js';
import { links, setLinks, save, render } from './app.js';

function restoreFromTrash(id) {
  const l = links.find(x => x.id === id);
  if (!l) return;
  delete l.deleted;
  save(); render(); renderTrash();
  updateTrashBadge();
  showToast('Link restored');
}

async function deleteForever(id) {
  if (!(await confirmDialog('This cannot be undone.', { title: 'Permanently delete this link?', okText: 'Delete forever', danger: true }))) return;
  setLinks(links.filter(l => l.id !== id));
  save(); renderTrash();
  updateTrashBadge();
  showToast('Link permanently deleted');
}

export async function emptyTrash() {
  const n = links.filter(l => l.deleted).length;
  if (!n) return;
  if (!(await confirmDialog('This cannot be undone.', { title: `Permanently delete ${n} link${n > 1 ? 's' : ''} in the trash?`, okText: 'Empty trash', danger: true }))) return;
  setLinks(links.filter(l => !l.deleted));
  save(); renderTrash();
  updateTrashBadge();
  showToast('Trash emptied');
}

export function updateTrashBadge() {
  const count = links.filter(l => l.deleted).length;
  const badge = document.getElementById('trashBadge');
  if (!badge) return;
  badge.textContent = count;
  badge.style.display = count ? '' : 'none';
}

export function openTrash() { renderTrash(); document.getElementById('trashBg').style.display = 'flex'; }
export function closeTrash() { document.getElementById('trashBg').style.display = 'none'; }

function renderTrash() {
  const trashed = links.filter(l => l.deleted).sort((a, b) => b.deleted - a.deleted);
  const content = document.getElementById('trashContent');
  const emptyBtn = document.getElementById('emptyTrashBtn');
  if (emptyBtn) emptyBtn.style.display = trashed.length ? '' : 'none';
  if (!trashed.length) {
    content.innerHTML = '<p style="text-align:center;color:var(--text2);padding:24px 16px">Trash is empty.</p>';
    return;
  }
  content.innerHTML = trashed.map(l => `
    <div class="fmgr-row" style="gap:10px">
      <i class="ti ti-trash" style="color:var(--text2);font-size:14px;flex-shrink:0"></i>
      <div style="flex:1;min-width:0">
        <div class="fmgr-name">${esc(l.title)}</div>
        <div style="font-size:11px;color:var(--text2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(getDomain(l.url))} · deleted ${esc(timeAgo(l.deleted))}</div>
      </div>
      <div class="fmgr-actions" style="opacity:1">
        <button class="icon-btn" title="Restore" data-trash-id="${esc(l.id)}" data-trash-action="restore"><i class="ti ti-arrow-back-up"></i></button>
        <button class="icon-btn" style="color:#E24B4A" title="Delete permanently" data-trash-id="${esc(l.id)}" data-trash-action="delete"><i class="ti ti-trash"></i></button>
      </div>
    </div>`).join('');
  content.querySelectorAll('[data-trash-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.trashAction === 'restore') restoreFromTrash(btn.dataset.trashId);
      else deleteForever(btn.dataset.trashId);
    });
  });
}
