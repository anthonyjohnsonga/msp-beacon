// ============================================================================
// modals.js — Add / Edit link modal + save/duplicate flow.
// openModal/closeModal/autoTitle/fetchPageTitle/saveLink/addLinkAnyway are
// bridged (imported back into app.js for editLink, the keyboard shortcut, and
// the window bridge). editId (which link is being edited) is owned here.
// modalFolderPath is an internal helper. The tag-autocomplete helpers stay in
// app.js since they read allTags/getTagColor there.
// ============================================================================

import { esc, pathKey, linkPath, MAX_FOLDER_DEPTH } from './utils.js';
import { showToast } from './toast.js';
import { links, save, render, allFolderPaths, captureSnapshot } from './app.js';

// Which link is currently being edited (null = adding a new link).
let editId = null;

export function openModal(id) {
  editId = id || null;
  const l = id ? links.find(x => x.id === id) : null;
  document.getElementById('modalTitle').textContent = l ? 'Edit link' : 'Add link';
  document.getElementById('mUrl').value = l ? l.url : '';
  document.getElementById('mTitle').value = l ? l.title : '';
  document.getElementById('mDesc').value = l ? l.desc : '';
  document.getElementById('mTags').value = l ? (l.tags || []).join(', ') : '';
  document.getElementById('mNewFolder').value = '';
  // Folder dropdown lists every existing folder path (any depth); a new nested
  // path can be typed in mNewFolder using "/" separators.
  const mf = document.getElementById('mFolder');
  const cur = l ? pathKey(linkPath(l)) : '';
  const opts = ['<option value="">No folder</option>'];
  allFolderPaths().map(k => JSON.parse(k)).sort((a, b) => a.join(' ').localeCompare(b.join(' ')))
    .forEach(p => { const key = pathKey(p); opts.push(`<option value="${esc(key)}"${key === cur ? ' selected' : ''}>${esc(p.join(' / '))}</option>`); });
  mf.innerHTML = opts.join('');
  document.getElementById('dupWarning').style.display = 'none';
  document.getElementById('modalBg').style.display = 'flex';
  setTimeout(() => document.getElementById('mUrl').focus(), 50);
}
export function closeModal() { document.getElementById('modalBg').style.display = 'none'; document.getElementById('dupWarning').style.display = 'none'; editId = null; }
export function autoTitle() {
  const u = document.getElementById('mUrl').value.trim();
  const t = document.getElementById('mTitle');
  if (!t.value && u && !/^https?:\/\//i.test(u)) {
    try { t.value = new URL(u).hostname.replace('www.', ''); } catch {}
  }
}

export async function fetchPageTitle() {
  if (editId) return;
  const u = document.getElementById('mUrl').value.trim();
  const t = document.getElementById('mTitle');
  if (!u || !/^https?:\/\//i.test(u)) return;
  if (t.value) return;
  const wrap = document.getElementById('titleWrap');
  wrap.classList.add('fetching');
  try {
    const res = await fetch('/api/fetch-title?url=' + encodeURIComponent(u));
    const data = await res.json();
    if (!t.value && data.title) t.value = data.title;
  } catch {}
  wrap.classList.remove('fetching');
}

// The link's folder path from the modal: a typed "A / B" new path wins, else the
// selected existing folder (pathKey), else [] (no folder).
function modalFolderPath() {
  const np = document.getElementById('mNewFolder').value.trim();
  if (np) return np.split('/').map(s => s.trim()).filter(Boolean).slice(0, MAX_FOLDER_DEPTH);
  const sel = document.getElementById('mFolder').value;
  if (!sel) return [];
  try { return JSON.parse(sel); } catch { return []; }
}

export function saveLink() {
  const url = document.getElementById('mUrl').value.trim();
  const title = document.getElementById('mTitle').value.trim();
  if (!url || !title) { alert('URL and title are required.'); return; }
  const path = modalFolderPath();
  const folder = path[0] || '';
  const subfolder = path[1] || null;
  const tags = document.getElementById('mTags').value.split(',').map(t => t.trim()).filter(Boolean);
  const desc = document.getElementById('mDesc').value.trim();
  if (!editId) {
    const dup = links.find(l => !l.archived && !l.deleted && l.url.trim().toLowerCase() === url.toLowerCase());
    if (dup) {
      const w = document.getElementById('dupWarning');
      document.getElementById('dupWarningMsg').innerHTML = `A link with this URL already exists — <strong>${esc(dup.title)}</strong>`;
      w.style.display = 'flex';
      return;
    }
  }
  if (editId) {
    const i = links.findIndex(l => l.id === editId);
    if (i > -1) {
      const urlChanged = links[i].url !== url;
      links[i] = { ...links[i], url, title, desc, folder, subfolder, path, tags };
      if (urlChanged) captureSnapshot(editId, url);
    }
  } else {
    const newId = Date.now().toString(36) + Math.random().toString(36).slice(2);
    links.unshift({ id: newId, url, title, desc, folder, subfolder, path, tags });
    captureSnapshot(newId, url);
  }
  const wasEditing = !!editId;
  save(); closeModal(); render();
  showToast(wasEditing ? 'Link updated' : 'Link saved');
}
export function addLinkAnyway() {
  const url = document.getElementById('mUrl').value.trim();
  const title = document.getElementById('mTitle').value.trim();
  const path = modalFolderPath();
  const folder = path[0] || '';
  const subfolder = path[1] || null;
  const tags = document.getElementById('mTags').value.split(',').map(t => t.trim()).filter(Boolean);
  const desc = document.getElementById('mDesc').value.trim();
  const newId = Date.now().toString(36) + Math.random().toString(36).slice(2);
  links.unshift({ id: newId, url, title, desc, folder, subfolder, path, tags });
  captureSnapshot(newId, url);
  save(); closeModal(); render();
  showToast('Link saved');
}
