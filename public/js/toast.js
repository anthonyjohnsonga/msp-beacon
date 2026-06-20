// ============================================================================
// toast.js — transient toast notifications (plain + undo variant).
// Pure DOM leaf: no app state, no imports. Other modules import showToast
// from here rather than from app.js, keeping the dependency graph shallow.
// The undo-action logic itself (links/save/render) stays in app.js.
// ============================================================================

let toastTimer = null;

export function showToast(msg, isError) {
  const t = document.getElementById('toast');
  document.getElementById('toastMsg').textContent = msg;
  document.getElementById('toastUndo').style.display = 'none';
  document.getElementById('toastIcon').className = isError ? 'ti ti-alert-circle' : 'ti ti-check';
  t.style.borderColor = isError ? '#E24B4A' : '';
  t.style.color = isError ? '#E24B4A' : '';
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2500);
}

export function showUndoToast(msg, icon = 'ti-trash') {
  const t = document.getElementById('toast');
  document.getElementById('toastMsg').textContent = msg;
  document.getElementById('toastUndo').style.display = '';
  document.getElementById('toastIcon').className = `ti ${icon}`;
  t.style.borderColor = '';
  t.style.color = '';
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 5500);
}
