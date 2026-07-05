// ============================================================================
// dialog.js — in-app replacement for window.confirm/alert: a small promise-
// based modal so confirmations match the app's UI instead of the browser's
// native dialogs. confirmDialog(message, opts) resolves true/false;
// alertDialog(message, opts) resolves when dismissed. opts: { title, okText,
// cancelText, danger } — danger styles the OK button red AND focuses Cancel so
// a stray Enter can't destroy anything. The overlay is created lazily and
// reused; it stacks above the other modals (several callers confirm from
// inside an open modal — trash, managers, stats). Pure leaf module, no state
// imports; callers await it, so their functions become async.
// ============================================================================

let bg = null, resolver = null, keyHandler = null;

function ensureDom() {
  if (bg) return;
  bg = document.createElement('div');
  bg.className = 'modal-bg dialog-bg';
  bg.style.display = 'none';
  bg.innerHTML = `
    <div class="modal dialog-box" role="alertdialog" aria-modal="true">
      <div class="dialog-title"></div>
      <div class="dialog-msg"></div>
      <div class="modal-footer">
        <button type="button" class="btn dialog-cancel">Cancel</button>
        <button type="button" class="btn btn-primary dialog-ok">OK</button>
      </div>
    </div>`;
  document.body.appendChild(bg);
  bg.addEventListener('click', e => { if (e.target === bg) settle(false); });
  bg.querySelector('.dialog-cancel').addEventListener('click', () => settle(false));
  bg.querySelector('.dialog-ok').addEventListener('click', () => settle(true));
}

function settle(v) {
  if (!resolver) return;
  bg.style.display = 'none';
  document.removeEventListener('keydown', keyHandler, true);
  const r = resolver;
  resolver = null;
  r(v);
}

function open({ title, message, okText, cancelText, danger, alertOnly }) {
  ensureDom();
  if (resolver) settle(false); // dialogs don't stack — settle any open one first
  const ok = bg.querySelector('.dialog-ok');
  const cancel = bg.querySelector('.dialog-cancel');
  bg.querySelector('.dialog-title').textContent = title || (alertOnly ? 'Notice' : 'Are you sure?');
  bg.querySelector('.dialog-msg').textContent = message || '';
  ok.textContent = okText || 'OK';
  ok.className = `btn dialog-ok ${danger ? 'btn-danger' : 'btn-primary'}`;
  cancel.textContent = cancelText || 'Cancel';
  cancel.style.display = alertOnly ? 'none' : '';
  bg.style.display = 'flex';
  (danger ? cancel : ok).focus();
  keyHandler = e => {
    // Capture-phase so the app's global Escape handler can't also fire and
    // close the modal underneath this dialog.
    if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); settle(false); }
    // Enter on the Cancel button falls through to its native click (= false).
    else if (e.key === 'Enter' && document.activeElement !== cancel) { e.stopPropagation(); e.preventDefault(); settle(true); }
  };
  document.addEventListener('keydown', keyHandler, true);
  return new Promise(res => { resolver = res; });
}

export function confirmDialog(message, opts = {}) { return open({ ...opts, message }); }
export function alertDialog(message, opts = {}) { return open({ ...opts, message, alertOnly: true }); }
