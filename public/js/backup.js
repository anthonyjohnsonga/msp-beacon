// ============================================================================
// backup.js — full backup (download) + restore (upload) of the data file.
// All three functions are bridged (inline on*= handlers); they only touch the
// DOM + the /api/backup & /api/restore endpoints, so the module is a leaf that
// imports closeSettings (app.js) and showToast (toast.js).
// ============================================================================

import { closeSettings } from './app.js';
import { showToast } from './toast.js';

export function backupData() {
  closeSettings();
  const a = document.createElement('a');
  a.href = '/api/backup';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
export function openRestore() {
  closeSettings();
  document.getElementById('restoreInput').click();
}
export async function handleRestoreFile(input) {
  const file = input.files[0];
  if (!file) return;
  input.value = '';
  let text, backup;
  try { text = await file.text(); backup = JSON.parse(text); } catch { showToast('Invalid backup file'); return; }
  if (!backup.links || !Array.isArray(backup.links)) { showToast('Invalid backup file'); return; }
  const date = backup.exportedAt ? new Date(backup.exportedAt).toLocaleString() : 'unknown date';
  if (!confirm(`Restore ${backup.links.length} links from backup dated ${date}?\n\nThis will replace all current links and settings.`)) return;
  try {
    const res = await fetch('/api/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: text
    });
    if (res.ok) { showToast('Restore successful — reloading…'); setTimeout(() => location.reload(), 1500); }
    else showToast('Restore failed');
  } catch { showToast('Restore failed'); }
}
