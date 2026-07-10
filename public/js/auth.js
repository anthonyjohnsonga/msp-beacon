// ============================================================================
// auth.js — single-password login / first-run setup overlay. Gates the boot:
// app.js calls ensureAuth() before loading data. The static shell is public; the
// server gates every /api/* route, returning 401 when a session is missing or
// expired (surfaced via handleUnauthorized()). Only logout() is bridged (it's a
// Settings menu item); the overlay buttons wire themselves with addEventListener.
// ============================================================================

import { showToast } from './toast.js';

function bg() { return document.getElementById('authBg'); }
function showErr(msg) { const e = document.getElementById('authErr'); if (e) e.textContent = msg; }

// Boot gate. Returns 'ok' (authed → load app), 'login' (configured, locked → stay
// blocked), or 'setup' (no password yet → app loads, dismissible prompt shown).
export async function ensureAuth() {
  let me;
  try {
    me = await (await fetch('/api/me')).json();
  } catch {
    return 'ok'; // server unreachable — let the normal data-load path report the error
  }
  if (me.authed) { showAccount('logout'); return 'ok'; }
  if (me.configured) { showLogin(); return 'login'; }
  showAccount('setup'); showSetup(); return 'setup';
}

// Called by app.js when an /api/* request returns 401 (expired/cleared session).
export function handleUnauthorized() { showLogin(); }

// Reveal the Settings → Account section with the relevant item: "Log out" when
// signed in, or "Set a password" when none is configured yet (open state).
function showAccount(which) {
  const group = document.getElementById('accountGroup');
  if (group) group.style.display = '';
  if (which === 'logout') {
    const item = document.getElementById('logoutItem');
    if (item) item.style.display = '';
    const cp = document.getElementById('changePwItem');
    if (cp) {
      cp.style.display = '';
      cp.onclick = () => { document.getElementById('settingsMenu').classList.remove('open'); showChangePw(); };
    }
  } else {
    const item = document.getElementById('setPwItem');
    if (item) {
      item.style.display = '';
      item.onclick = () => { document.getElementById('settingsMenu').classList.remove('open'); showSetup(); };
    }
  }
}

function showLogin() {
  bg().innerHTML = `
    <div class="auth-card">
      <div class="auth-brand"><i class="ti ti-bookmarks"></i> MSP Beacon</div>
      <div class="auth-title">Enter your password</div>
      <input type="password" id="authPw" class="auth-input" placeholder="Password" autocomplete="current-password">
      <div class="auth-error" id="authErr"></div>
      <button class="btn btn-primary auth-btn" id="authSubmit"><i class="ti ti-lock-open"></i> Unlock</button>
    </div>`;
  bg().style.display = 'flex';
  wire(submitLogin);
}

function showSetup() {
  bg().innerHTML = `
    <div class="auth-card">
      <div class="auth-brand"><i class="ti ti-bookmarks"></i> MSP Beacon</div>
      <div class="auth-title">Create a password</div>
      <div class="auth-sub">Protect your links with a password. You can also do this later.</div>
      <input type="password" id="authPw" class="auth-input" placeholder="New password (min 8 characters)" autocomplete="new-password">
      <input type="password" id="authPw2" class="auth-input" placeholder="Confirm password" autocomplete="new-password">
      <div class="auth-error" id="authErr"></div>
      <div class="auth-actions">
        <button class="btn" id="authLater">Maybe later</button>
        <button class="btn btn-primary auth-btn" id="authSubmit"><i class="ti ti-check"></i> Create</button>
      </div>
    </div>`;
  bg().style.display = 'flex';
  wire(submitSetup);
  const later = document.getElementById('authLater');
  if (later) later.addEventListener('click', () => { bg().style.display = 'none'; });
}

function showChangePw() {
  bg().innerHTML = `
    <div class="auth-card">
      <div class="auth-brand"><i class="ti ti-bookmarks"></i> MSP Beacon</div>
      <div class="auth-title">Change password</div>
      <div class="auth-sub">Every other device will be signed out.</div>
      <input type="password" id="authPwCur" class="auth-input" placeholder="Current password" autocomplete="current-password">
      <input type="password" id="authPw" class="auth-input" placeholder="New password (min 8 characters)" autocomplete="new-password">
      <input type="password" id="authPw2" class="auth-input" placeholder="Confirm new password" autocomplete="new-password">
      <div class="auth-error" id="authErr"></div>
      <div class="auth-actions">
        <button class="btn" id="authCancel">Cancel</button>
        <button class="btn btn-primary auth-btn" id="authSubmit"><i class="ti ti-check"></i> Change</button>
      </div>
    </div>`;
  bg().style.display = 'flex';
  wire(submitChangePw);
  const cancel = document.getElementById('authCancel');
  if (cancel) cancel.addEventListener('click', () => { bg().style.display = 'none'; });
}

function wire(fn) {
  const btn = document.getElementById('authSubmit');
  if (btn) btn.addEventListener('click', fn);
  const inputs = bg().querySelectorAll('.auth-input');
  inputs.forEach(el => el.addEventListener('keydown', e => { if (e.key === 'Enter') fn(); }));
  setTimeout(() => { if (inputs[0]) inputs[0].focus(); }, 50);
}

async function submitLogin() {
  const pw = document.getElementById('authPw').value;
  if (!pw) return;
  try {
    const res = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw }) });
    if (res.ok) { location.reload(); return; }
    showErr((await res.json().catch(() => ({}))).error || 'Login failed');
  } catch { showErr('Login failed'); }
}

async function submitSetup() {
  const pw = document.getElementById('authPw').value;
  const pw2 = document.getElementById('authPw2').value;
  if (pw.length < 8) return showErr('Password must be at least 8 characters');
  if (pw !== pw2) return showErr('Passwords do not match');
  try {
    const res = await fetch('/api/setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw }) });
    if (res.ok) { location.reload(); return; }
    showErr((await res.json().catch(() => ({}))).error || 'Setup failed');
  } catch { showErr('Setup failed'); }
}

async function submitChangePw() {
  const cur = document.getElementById('authPwCur').value;
  const pw = document.getElementById('authPw').value;
  const pw2 = document.getElementById('authPw2').value;
  if (!cur) return showErr('Enter your current password');
  if (pw.length < 8) return showErr('New password must be at least 8 characters');
  if (pw !== pw2) return showErr('Passwords do not match');
  try {
    const res = await fetch('/api/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: cur, newPassword: pw })
    });
    if (res.ok) { bg().style.display = 'none'; showToast('Password changed — other devices were signed out'); return; }
    showErr((await res.json().catch(() => ({}))).error || 'Change failed');
  } catch { showErr('Change failed'); }
}

export async function logout() {
  try { await fetch('/api/logout', { method: 'POST' }); } catch {}
  showToast('Logged out');
  location.reload();
}
