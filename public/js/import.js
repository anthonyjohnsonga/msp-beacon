// ============================================================================
// import.js — browser-bookmark import (HTML export → preview → add to links).
// parseBookmarks is pure DOM parsing; doImport mutates the shared links array
// and calls save/render from app.js (call-time circular import, fine in ESM).
// Nested bookmark folders become a link path array (capped at MAX_FOLDER_DEPTH).
// ============================================================================

import { esc, getDomain, pathKey, MAX_FOLDER_DEPTH } from './utils.js';
import { showToast } from './toast.js';
import { links, save, render, allFolderPaths } from './app.js';

let parsedBookmarks = [];

export function openImport() {
  parsedBookmarks = [];
  document.getElementById('importPreviewWrap').style.display = 'none';
  document.getElementById('importBtn').style.display = 'none';
  document.getElementById('dropZone').style.display = '';
  document.getElementById('fileIn').value = '';
  document.getElementById('impTags').value = '';
  document.getElementById('impNewFolder').value = '';
  const fs = document.getElementById('impFolder');
  const opts = ['<option value="">No folder</option>'];
  allFolderPaths().map(k => JSON.parse(k)).sort((a, b) => a.join(' ').localeCompare(b.join(' ')))
    .forEach(p => opts.push(`<option value="${esc(pathKey(p))}">${esc(p.join(' / '))}</option>`));
  fs.innerHTML = opts.join('');
  document.getElementById('importBg').style.display = 'flex';
}
export function closeImport() { document.getElementById('importBg').style.display = 'none'; }
export function handleDrop(e) { e.preventDefault(); document.getElementById('dropZone').classList.remove('drag'); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }
export function handleFile(file) { if (!file) return; const r = new FileReader(); r.onload = e => parseBookmarks(e.target.result); r.readAsText(file); }
function parseBookmarks(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const res = [];
  function walk(dl, path) {
    for (const ch of (dl ? dl.children : [])) {
      if (ch.tagName !== 'DT') continue;
      const a = ch.querySelector(':scope > A'), h3 = ch.querySelector(':scope > H3'), dl2 = ch.querySelector(':scope > DL');
      if (a) { const u = a.getAttribute('HREF') || '', t = a.textContent.trim() || getDomain(u); if (u && !u.startsWith('javascript:') && !u.startsWith('place:') && !u.startsWith('data:')) res.push({ url: u, title: t, path: path.slice() }); }
      else if (h3 && dl2) { const n = h3.textContent.trim(); const skip = ['Bookmarks bar','Bookmarks Bar','Bookmarks toolbar','Bookmarks Toolbar','Other bookmarks','Other Bookmarks','Mobile bookmarks','Mobile Bookmarks']; walk(dl2, skip.includes(n) ? path : [...path, n].slice(0, MAX_FOLDER_DEPTH)); }
    }
  }
  walk(doc.querySelector('DL'), []);
  if (!res.length) { alert('No bookmarks found. Make sure this is a valid browser bookmark export.'); return; }
  parsedBookmarks = res; showPreview();
}
function showPreview() {
  document.getElementById('dropZone').style.display = 'none';
  document.getElementById('importPreviewWrap').style.display = 'flex';
  document.getElementById('importBtn').style.display = 'flex';
  document.getElementById('importCount').textContent = parsedBookmarks.length + ' bookmarks found';
  document.getElementById('importPreview').innerHTML = parsedBookmarks.map((b, i) => `
    <div class="import-row"><input type="checkbox" id="imp_${i}" checked>
      <div class="import-row-info"><div class="import-row-title">${esc(b.title)}</div><div class="import-row-url">${esc(b.url)}</div></div>
      ${b.path.length ? `<span class="import-row-folder">${esc(b.path.join(' / '))}</span>` : ''}
    </div>`).join('');
}
export function toggleAll(v) { parsedBookmarks.forEach((_, i) => { const c = document.getElementById('imp_' + i); if (c) c.checked = v; }); }
// Import destination: a typed "A / B" new path wins, else the selected existing
// folder (pathKey), else [] — imported folders nest UNDER this target.
function importTargetPath() {
  const np = document.getElementById('impNewFolder').value.trim();
  if (np) return np.split('/').map(s => s.trim()).filter(Boolean);
  const sel = document.getElementById('impFolder').value;
  if (!sel) return [];
  try { return JSON.parse(sel); } catch { return []; }
}
export function doImport() {
  const target = importTargetPath();
  const et = document.getElementById('impTags').value.split(',').map(t => t.trim()).filter(Boolean);
  const eu = new Set(links.map(l => l.url.toLowerCase()));
  let added = 0, skipped = 0;
  parsedBookmarks.forEach((b, i) => {
    const cb = document.getElementById('imp_' + i);
    if (!cb || !cb.checked) return;
    if (eu.has(b.url.toLowerCase())) { skipped++; return; }
    const path = [...target, ...b.path].slice(0, MAX_FOLDER_DEPTH);
    links.unshift({ id: Date.now().toString(36) + Math.random().toString(36).slice(2) + i, url: b.url, title: b.title, desc: '', folder: path[0] || '', subfolder: path[1] || null, path, tags: [...et] });
    eu.add(b.url.toLowerCase()); added++;
  });
  save(); closeImport(); render();
  showToast(`${added} links imported${skipped ? ', ' + skipped + ' duplicates skipped' : ''}`);
}
