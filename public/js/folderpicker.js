// ============================================================================
// folderpicker.js — searchable folder combobox used by the Add/Edit link modal
// and the import dialog. One field replaces the old <select> + "new folder"
// input: typing filters every existing folder path (shown with its icon and
// color), a "Create…" row appears when the typed path doesn't exist yet, and
// Tab (or the ↳ button on a row) drops that folder's path into the input so a
// new subfolder can be typed without retyping its ancestors. A chosen folder
// collapses to a breadcrumb chip with an ✕ to clear.
// Folders aren't entities — a picked path simply becomes the link's path on
// save — so "creating" here just means returning a path with no links yet.
// ============================================================================

import { esc, MAX_FOLDER_DEPTH } from './utils.js';
import { showToast } from './toast.js';
import { allFolderPaths, getFolderColor, getFolderIcon } from './app.js';

const crumbs = p => p.map((s, i) =>
  i < p.length - 1 ? `<span class="fp-crumb">${esc(s)} › </span>` : `<span>${esc(s)}</span>`).join('');

export function createFolderPicker(root, placeholder = 'No folder — type to search or create…') {
  root.classList.add('folder-picker');
  root.innerHTML = `
    <button type="button" class="fp-chip" style="display:none"></button>
    <input type="text" class="fp-input" placeholder="${esc(placeholder)}" autocomplete="off" spellcheck="false">
    <div class="fp-list"></div>`;
  const chip = root.querySelector('.fp-chip');
  const input = root.querySelector('.fp-input');
  const list = root.querySelector('.fp-list');

  let selected = null;  // chosen path array (chip shown); null = input mode
  let revertTo = null;  // chip path to restore if an edit is escaped
  let items = [];       // rows currently in the dropdown
  let hi = 0;           // highlighted row index

  const parse = v => v.split('/').map(s => s.trim()).filter(Boolean);
  const capped = p => {
    if (p.length > MAX_FOLDER_DEPTH) showToast(`Folders are capped at ${MAX_FOLDER_DEPTH} levels — deeper levels were dropped`, true);
    return p.slice(0, MAX_FOLDER_DEPTH);
  };

  function rowHtml(it, i) {
    const act = i === hi ? ' active' : '';
    if (it.type === 'none')
      return `<div class="fp-item${act}" data-i="${i}"><i class="ti ti-folder-off" style="color:var(--text2)"></i><span class="fp-name">No folder</span></div>`;
    if (it.type === 'folder')
      return `<div class="fp-item${act}" data-i="${i}">
        <i class="ti ${esc(getFolderIcon(it.path))}" style="color:${esc(getFolderColor(it.path))}"></i>
        <span class="fp-name">${crumbs(it.path)}</span>
        ${it.path.length < MAX_FOLDER_DEPTH ? '<span class="fp-nest" title="New subfolder inside (Tab)"><i class="ti ti-corner-down-right"></i></span>' : ''}
      </div>`;
    return `<div class="fp-item fp-create${act}" data-i="${i}"><i class="ti ti-plus"></i><span class="fp-name">Create <strong>${crumbs(it.path.slice(0, MAX_FOLDER_DEPTH))}</strong></span></div>`;
  }
  function paint() {
    list.innerHTML = items.map(rowHtml).join('')
      + '<div class="fp-hint">↵ select · Tab new subfolder inside · “/” adds levels</div>';
    const a = list.querySelector('.fp-item.active');
    if (a) a.scrollIntoView({ block: 'nearest' });
  }
  function rebuild() {
    const q = parse(input.value);
    const qs = q.join(' / ').toLowerCase();
    const all = allFolderPaths().map(k => JSON.parse(k))
      .sort((a, b) => a.join(' / ').localeCompare(b.join(' / ')));
    items = [];
    if (!qs) items.push({ type: 'none' });
    (qs ? all.filter(p => p.join(' / ').toLowerCase().includes(qs)) : all)
      .forEach(p => items.push({ type: 'folder', path: p }));
    if (q.length && !all.some(p => p.join(' / ').toLowerCase() === qs)) items.push({ type: 'create', path: q });
    hi = Math.max(0, Math.min(hi, items.length - 1));
    paint();
  }
  function openList() { rebuild(); list.classList.add('open'); }
  function closeList() { list.classList.remove('open'); }

  // A chosen folder renders as a breadcrumb chip; no choice leaves the input.
  function setSelected(p) {
    selected = p && p.length ? p : null;
    if (selected) {
      chip.innerHTML = `<i class="ti ${esc(getFolderIcon(selected))}" style="color:${esc(getFolderColor(selected))}"></i>
        <span class="fp-chip-name">${crumbs(selected)}</span>
        <span class="fp-x" title="Clear folder"><i class="ti ti-x"></i></span>`;
      chip.style.display = '';
      input.style.display = 'none';
      input.value = '';
    } else {
      chip.style.display = 'none';
      input.style.display = '';
    }
  }
  function pick(i) {
    const it = items[i];
    if (!it) return;
    revertTo = null;
    setSelected(it.type === 'none' ? null : capped(it.path));
    closeList();
  }
  // Drop a folder's path into the input (with a trailing "/") so the user can
  // type a new child name — nesting without retyping the ancestors.
  function descend(i) {
    const it = items[i];
    if (!it || it.type === 'none') return;
    if (it.path.length >= MAX_FOLDER_DEPTH) { showToast(`Folders are capped at ${MAX_FOLDER_DEPTH} levels`, true); return; }
    input.value = it.path.join(' / ') + ' / ';
    input.focus();
    hi = 0;
    openList();
  }

  chip.addEventListener('click', e => {
    const cur = selected;
    setSelected(null);
    if (e.target.closest('.fp-x')) { revertTo = null; input.value = ''; }
    else { revertTo = cur; input.value = cur.join(' / ') + ' / '; }  // edit = nest under it
    input.focus();
    hi = 0;
    openList();
  });
  input.addEventListener('focus', () => openList());
  input.addEventListener('input', () => { hi = 0; openList(); });
  input.addEventListener('blur', () => setTimeout(closeList, 150));
  input.addEventListener('keydown', e => {
    const open = list.classList.contains('open');
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) { openList(); return; }
      hi = (hi + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length;
      paint();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (open) pick(hi);
      else if (input.value.trim()) { revertTo = null; setSelected(capped(parse(input.value))); }
    } else if (e.key === 'Tab' && open && items[hi] && items[hi].type === 'folder') {
      e.preventDefault();
      descend(hi);
    } else if (e.key === 'Escape' && (open || revertTo)) {
      e.stopPropagation();  // don't let the modal's Escape handler close the dialog
      closeList();
      if (revertTo) { setSelected(revertTo); revertTo = null; }
    }
  });
  // mousedown (not click) so the row acts before the input's blur closes the list.
  list.addEventListener('mousedown', e => {
    e.preventDefault();
    const row = e.target.closest('.fp-item');
    if (!row) return;
    const i = +row.dataset.i;
    if (e.target.closest('.fp-nest')) descend(i);
    else pick(i);
  });
  document.addEventListener('mousedown', e => { if (!root.contains(e.target)) closeList(); });

  return {
    setPath(p) { revertTo = null; closeList(); setSelected((p || []).slice(0, MAX_FOLDER_DEPTH)); },
    // Typed-but-not-confirmed text still counts, so Save works without Enter.
    getPath() {
      if (selected) return selected;
      const t = input.value.trim();
      return t ? capped(parse(t)) : [];
    },
  };
}
