// ============================================================================
// pickers.js — popover color picker (folder / tag) + folder icon picker.
// Folders are identified by a pathKey (JSON of the path array) at any depth, so a
// single folder target covers every level; a non-top-level folder can reset to
// inherit its parent's color. The color/icon stores + helpers live in app.js and
// are imported here (call-time circular import, fine in ESM). refreshOpenManagers
// stays in app.js and is imported back.
// ============================================================================

import { esc, isHexColor } from './utils.js';
import {
  folderColors, folderIcons, tagColors,
  getFolderColor, getFolderIcon,
  render, saveConfig,
} from './app.js';
import { refreshOpenManagers } from './managers.js';

const COLOR_PRESETS = ['#1D9E75','#2563EB','#7C3AED','#0D9488','#D97706','#DC2626','#DB2777','#0891B2','#65A30D','#6B7280'];
let colorPickerTarget = null; // { type: 'folder'|'tag', key?, path?, tag? }

function accentColor() {
  const c = getComputedStyle(document.documentElement).getPropertyValue('--g4').trim();
  return isHexColor(c) ? c : '#1D9E75';
}

function renderColorPicker(anchorEl) {
  const picker = document.getElementById('folderColorPicker');
  const t = colorPickerTarget;
  const isTag = t.type === 'tag';
  const isFolder = t.type === 'folder';
  // A folder with no explicit color (inherits parent/default) or a tag with no
  // color is "default" — the reset chip is the active one.
  const isDefault = (isFolder && folderColors[t.key] == null) || (isTag && tagColors[t.tag] == null);
  const current = isTag ? (tagColors[t.tag] || accentColor()) : getFolderColor(t.path);
  const cur = String(current).toLowerCase();
  const presetMatch = COLOR_PRESETS.some(c => c.toLowerCase() === cur);
  let chips = COLOR_PRESETS.map(c =>
    `<div onclick="selectPickerColor('${c}')" style="width:24px;height:24px;border-radius:50%;background:${c};cursor:pointer;outline:${(!isDefault && c.toLowerCase() === cur) ? '2px solid #fff' : 'none'};outline-offset:2px"></div>`
  ).join('');
  // Custom color — opens the native color wheel; click anywhere on the rainbow chip
  chips += `<label title="Custom color…" style="width:24px;height:24px;border-radius:50%;cursor:pointer;position:relative;overflow:hidden;display:inline-block;background:conic-gradient(from 90deg,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00);outline:${(!isDefault && !presetMatch) ? '2px solid #fff' : 'none'};outline-offset:2px"><input type="color" value="${esc(current)}" onchange="selectPickerColor(this.value)" style="position:absolute;left:-5px;top:-5px;width:34px;height:34px;opacity:0;cursor:pointer;border:none;padding:0;background:none"></label>`;
  // Folders (any depth) and tags can reset to default / inherited color.
  const resetTitle = isTag ? 'Default color' : (t.path && t.path.length > 1 ? 'Inherit parent color' : 'Default color');
  chips += `<div onclick="resetPickerColor()" title="${resetTitle}" style="width:24px;height:24px;border-radius:50%;background:var(--bg3);display:flex;align-items:center;justify-content:center;cursor:pointer;border:1px solid var(--border0);outline:${isDefault ? '2px solid #fff' : 'none'};outline-offset:2px"><i class="ti ti-rotate-2" style="font-size:13px;color:var(--text1)"></i></div>`;
  picker.innerHTML = chips;
  picker.style.display = 'flex';
  const rect = anchorEl.getBoundingClientRect();
  picker.style.top = (rect.bottom + 6) + 'px';
  picker.style.left = Math.min(rect.right - 168, window.innerWidth - 180) + 'px';
}

// key is a pathKey string (JSON of the folder's path array).
export function openFolderColorPicker(key, anchorEl) {
  let path; try { path = JSON.parse(key); } catch { path = []; }
  colorPickerTarget = { type: 'folder', key, path };
  renderColorPicker(anchorEl);
}

export function openTagColorPicker(tag, anchorEl) {
  colorPickerTarget = { type: 'tag', tag };
  renderColorPicker(anchorEl);
}

export function selectPickerColor(color) {
  if (!colorPickerTarget) return;
  const t = colorPickerTarget;
  if (t.type === 'tag') {
    tagColors[t.tag] = color;
    localStorage.setItem('msp-tag-colors', JSON.stringify(tagColors));
  } else {
    folderColors[t.key] = color;
    localStorage.setItem('msp-folder-colors', JSON.stringify(folderColors));
  }
  closeFolderColorPicker();
  render();
  refreshOpenManagers();
  saveConfig();
}

export function resetPickerColor() {
  if (!colorPickerTarget) return;
  const t = colorPickerTarget;
  if (t.type === 'tag') {
    delete tagColors[t.tag];
    localStorage.setItem('msp-tag-colors', JSON.stringify(tagColors));
  } else {
    delete folderColors[t.key];
    localStorage.setItem('msp-folder-colors', JSON.stringify(folderColors));
  }
  closeFolderColorPicker();
  render();
  refreshOpenManagers();
  saveConfig();
}

export function closeFolderColorPicker() {
  const picker = document.getElementById('folderColorPicker');
  if (picker) picker.style.display = 'none';
  colorPickerTarget = null;
}

const ICON_PRESETS = [
  'ti-folder','ti-server','ti-cloud','ti-code','ti-database','ti-shield',
  'ti-home','ti-tool','ti-star','ti-bookmark','ti-heart','ti-bolt',
  'ti-world','ti-mail','ti-chart-bar','ti-settings','ti-users','ti-file',
  'ti-camera','ti-music','ti-gamepad','ti-school','ti-briefcase','ti-rocket'
];
let iconPickerKey = null;
// key is a pathKey string (JSON of the folder's path array).
export function openFolderIconPicker(key, anchorEl) {
  iconPickerKey = key;
  closeFolderColorPicker();
  let path; try { path = JSON.parse(key); } catch { path = []; }
  const picker = document.getElementById('folderIconPicker');
  const current = getFolderIcon(path);
  const fc = getFolderColor(path);
  picker.innerHTML = ICON_PRESETS.map(ic =>
    `<div onclick="selectFolderIcon('${ic}')" title="${ic.replace('ti-','')}" style="width:32px;height:32px;border-radius:6px;background:${ic===current?'var(--g5)':'var(--bg3)'};display:flex;align-items:center;justify-content:center;cursor:pointer;border:1px solid ${ic===current?fc:'transparent'}"><i class="ti ${ic}" style="font-size:16px;color:${ic===current?'#fff':'var(--text1)'}"></i></div>`
  ).join('');
  picker.style.display = 'flex';
  const rect = anchorEl.getBoundingClientRect();
  picker.style.top = (rect.bottom + 6) + 'px';
  picker.style.left = Math.min(rect.left, window.innerWidth - 232) + 'px';
}
export function selectFolderIcon(icon) {
  if (!iconPickerKey) return;
  folderIcons[iconPickerKey] = icon;
  localStorage.setItem('msp-folder-icons', JSON.stringify(folderIcons));
  closeFolderIconPicker();
  render();
  saveConfig();
}
export function closeFolderIconPicker() {
  const picker = document.getElementById('folderIconPicker');
  if (picker) picker.style.display = 'none';
  iconPickerKey = null;
}
