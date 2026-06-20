// ============================================================================
// archive.js — archiving links + the Archive modal (restore / permanent delete
// / badge count). archiveLink cancels any pending undo timer; permanentDelete
// reassigns the links array — both via the app.js state-mutation layer
// (call-time circular imports, fine in ESM).
// ============================================================================

import { esc, getDomain } from './utils.js';
import { showToast } from './toast.js';
import { links, setLinks, pendingDelete, setPendingDelete, commitPendingMove, save, render } from './app.js';

export function archiveLink(id) {
  const l = links.find(x => x.id === id);
  if (!l) return;
  commitPendingMove();
  if (pendingDelete) { clearTimeout(pendingDelete.timer); save(); setPendingDelete(null); }
  l.archived = true;
  save(); render();
  showToast('Link archived');
}

function unarchiveLink(id) {
  const l = links.find(x => x.id === id);
  if (!l) return;
  delete l.archived;
  save(); render(); renderArchive();
  updateArchiveBadge();
  showToast('Link restored');
}

function permanentDeleteLink(id) {
  if (!confirm('Permanently delete this link? This cannot be undone.')) return;
  setLinks(links.filter(l => l.id !== id));
  save(); renderArchive();
  updateArchiveBadge();
  showToast('Link permanently deleted');
}

export function updateArchiveBadge() {
  const count = links.filter(l => l.archived).length;
  const badge = document.getElementById('archiveBadge');
  if (!badge) return;
  badge.textContent = count;
  badge.style.display = count ? '' : 'none';
}

export function openArchive() { renderArchive(); document.getElementById('archiveBg').style.display = 'flex'; }
export function closeArchive() { document.getElementById('archiveBg').style.display = 'none'; }
function renderArchive() {
  const archived = links.filter(l => l.archived);
  const content = document.getElementById('archiveContent');
  if (!archived.length) {
    content.innerHTML = '<p style="text-align:center;color:var(--text2);padding:24px 16px">No archived links.</p>';
    return;
  }
  content.innerHTML = archived.map(l => `
    <div class="fmgr-row" style="gap:10px">
      <i class="ti ti-archive" style="color:var(--text2);font-size:14px;flex-shrink:0"></i>
      <div style="flex:1;min-width:0">
        <div class="fmgr-name">${esc(l.title)}</div>
        <div style="font-size:11px;color:var(--text2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(getDomain(l.url))}</div>
      </div>
      <div class="fmgr-actions" style="opacity:1">
        <button class="icon-btn" title="Restore" data-archive-id="${esc(l.id)}" data-archive-action="restore"><i class="ti ti-archive-off"></i></button>
        <button class="icon-btn" style="color:#E24B4A" title="Delete permanently" data-archive-id="${esc(l.id)}" data-archive-action="delete"><i class="ti ti-trash"></i></button>
      </div>
    </div>`).join('');
  content.querySelectorAll('[data-archive-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.archiveAction === 'restore') unarchiveLink(btn.dataset.archiveId);
      else permanentDeleteLink(btn.dataset.archiveId);
    });
  });
}
