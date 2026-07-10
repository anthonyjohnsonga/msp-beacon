// End-to-end browser test of the change-password flow (v1.0.28 feature 7da01b4).
// Two headless Chrome instances = two "devices" with separate profiles/cookies.
// Driven over raw CDP using Node 24's built-in WebSocket. No dependencies.
//
// Flow:
//   1. Device A: first-run setup overlay -> create password -> app loads authed
//   2. Device B: login overlay -> sign in with the password -> app loads authed
//   3. Device A: Settings -> Change password. Error paths (wrong current pw,
//      short new pw, mismatch), then a successful change.
//   4. Device A stays signed in (fresh cookie under the rotated secret).
//   5. Device B reloads -> kicked to the login screen; old password rejected,
//      new password works.
//   6. Zero console errors / uncaught exceptions on either device throughout.
//
// Prereqs: server running (node server.js) against a data dir with NO password
// set. ⚠ The test WRITES a passHash into /data/auth.json — back it up first and
// restore it after (the run leaves the password set to the test value).
// Env overrides: CHROME (chrome.exe path), BASE_URL (default http://127.0.0.1:3000).
//   node scripts/test-changepw.mjs

import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = process.env.BASE_URL || 'http://127.0.0.1:3000';
const PW1 = 'first-password-123';
const PW2 = 'second-password-456';

let pass = 0, fail = 0;
function check(name, cond, extra) {
  console.log(`${cond ? 'PASS' : 'FAIL'} - ${name}${cond ? '' : ' :: ' + JSON.stringify(extra)}`);
  if (cond) pass++; else fail++;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

class Device {
  constructor(name, port) {
    this.name = name;
    this.port = port;
    this.profile = path.join(os.tmpdir(), `beacon-e2e-${name}`);
    this.errors = [];   // console.error + uncaught exceptions
    this.msgId = 0;
    this.pending = new Map();
    this.loadedResolvers = [];
  }
  async launch() {
    fs.rmSync(this.profile, { recursive: true, force: true });
    this.proc = spawn(CHROME, [
      '--headless=new', `--remote-debugging-port=${this.port}`,
      `--user-data-dir=${this.profile}`, '--no-first-run', '--disable-extensions',
      '--window-size=1280,900', 'about:blank',
    ], { stdio: 'ignore' });
    // wait for the debug endpoint, then attach to the page target
    let targets;
    for (let i = 0; i < 50; i++) {
      try {
        targets = await (await fetch(`http://127.0.0.1:${this.port}/json`)).json();
        if (targets.some(t => t.type === 'page')) break;
      } catch {}
      await sleep(200);
    }
    const page = targets.find(t => t.type === 'page');
    this.ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((res, rej) => { this.ws.onopen = res; this.ws.onerror = rej; });
    this.ws.onmessage = ev => this.onMessage(JSON.parse(ev.data));
    await this.send('Runtime.enable');
    await this.send('Page.enable');
  }
  onMessage(msg) {
    if (msg.id && this.pending.has(msg.id)) {
      const { resolve, reject } = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      return;
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      this.errors.push('exception: ' + (msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text));
    }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      this.errors.push('console.error: ' + msg.params.args.map(a => a.value ?? a.description ?? '').join(' '));
    }
    if (msg.method === 'Page.loadEventFired') {
      this.loadedResolvers.splice(0).forEach(r => r());
    }
  }
  send(method, params = {}) {
    const id = ++this.msgId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  nextLoad(timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`${this.name}: load timeout`)), timeoutMs);
      this.loadedResolvers.push(() => { clearTimeout(t); resolve(); });
    });
  }
  async goto(url) {
    const loaded = this.nextLoad();
    await this.send('Page.navigate', { url });
    await loaded;
    await sleep(700); // let module graph + ensureAuth() settle
  }
  // evaluate an expression (may be a promise) and return its JSON value
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(`${this.name} eval failed: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
    return r.result.value;
  }
  async close() { try { this.proc.kill(); } catch {} }
}

// --- helpers evaluated inside the page --------------------------------------
const OVERLAY_STATE = `(() => {
  const bg = document.getElementById('authBg');
  const visible = bg && bg.style.display !== 'none' && bg.innerHTML.trim() !== '';
  return {
    visible,
    title: visible ? (bg.querySelector('.auth-title')?.textContent || '') : '',
    err: visible ? (document.getElementById('authErr')?.textContent || '') : '',
  };
})()`;
const ME = `fetch('/api/me').then(r => r.json())`;

async function main() {
  const A = new Device('deviceA', 9333);
  const B = new Device('deviceB', 9334);
  try {
    await A.launch();
    await B.launch();

    // --- 1. Device A: first-run setup via the overlay UI --------------------
    await A.goto(BASE + '/');
    let st = await A.eval(OVERLAY_STATE);
    check('A: first-run setup overlay shown', st.visible && st.title === 'Create a password', st);

    let reload = A.nextLoad();
    await A.eval(`
      document.getElementById('authPw').value = ${JSON.stringify(PW1)};
      document.getElementById('authPw2').value = ${JSON.stringify(PW1)};
      document.getElementById('authSubmit').click();`);
    await reload; await sleep(700);
    let me = await A.eval(ME);
    check('A: authed after setup', me.authed === true && me.configured === true, me);
    st = await A.eval(OVERLAY_STATE);
    check('A: overlay gone, app loaded', !st.visible && await A.eval(`!!document.getElementById('homeTime') || !!document.querySelector('.home-section, .card')`), st);

    // --- 2. Device B: login with the password --------------------------------
    await B.goto(BASE + '/');
    st = await B.eval(OVERLAY_STATE);
    check('B: login overlay shown', st.visible && st.title === 'Enter your password', st);
    reload = B.nextLoad();
    await B.eval(`
      document.getElementById('authPw').value = ${JSON.stringify(PW1)};
      document.getElementById('authSubmit').click();`);
    await reload; await sleep(700);
    me = await B.eval(ME);
    check('B: authed after login', me.authed === true, me);

    // --- 3. Device A: Settings -> Change password ----------------------------
    // open the settings menu, then the change-password item
    await A.eval(`document.getElementById('settingsBtn').click()`);
    const itemVisible = await A.eval(`(() => {
      const el = document.getElementById('changePwItem');
      return el && el.style.display !== 'none' && document.getElementById('settingsMenu').classList.contains('open');
    })()`);
    check('A: "Change password" item visible in open Settings menu', itemVisible === true, itemVisible);
    await A.eval(`document.getElementById('changePwItem').click()`);
    st = await A.eval(OVERLAY_STATE);
    check('A: change-password dialog shown', st.visible && st.title === 'Change password', st);

    // error path: wrong current password (server round-trip)
    await A.eval(`
      document.getElementById('authPwCur').value = 'totally-wrong-pw';
      document.getElementById('authPw').value = ${JSON.stringify(PW2)};
      document.getElementById('authPw2').value = ${JSON.stringify(PW2)};
      document.getElementById('authSubmit').click();`);
    await sleep(800);
    st = await A.eval(OVERLAY_STATE);
    check('A: wrong current pw rejected with message', st.visible && /current password is incorrect/i.test(st.err), st);

    // error path: short new password (client-side)
    await A.eval(`
      document.getElementById('authPwCur').value = ${JSON.stringify(PW1)};
      document.getElementById('authPw').value = 'short';
      document.getElementById('authPw2').value = 'short';
      document.getElementById('authSubmit').click();`);
    await sleep(300);
    st = await A.eval(OVERLAY_STATE);
    check('A: short new pw rejected', st.visible && /at least 8 characters/i.test(st.err), st);

    // error path: mismatch (client-side)
    await A.eval(`
      document.getElementById('authPw').value = ${JSON.stringify(PW2)};
      document.getElementById('authPw2').value = ${JSON.stringify(PW2 + 'x')};
      document.getElementById('authSubmit').click();`);
    await sleep(300);
    st = await A.eval(OVERLAY_STATE);
    check('A: mismatched confirm rejected', st.visible && /do not match/i.test(st.err), st);

    // success path
    await A.eval(`
      document.getElementById('authPwCur').value = ${JSON.stringify(PW1)};
      document.getElementById('authPw').value = ${JSON.stringify(PW2)};
      document.getElementById('authPw2').value = ${JSON.stringify(PW2)};
      document.getElementById('authSubmit').click();`);
    await sleep(1000);
    st = await A.eval(OVERLAY_STATE);
    const toast = await A.eval(`(() => {
      const t = document.querySelector('.toast, #toast');
      return t ? t.textContent : '';
    })()`);
    check('A: change succeeded, dialog closed', !st.visible, st);
    check('A: success toast shown', /password changed/i.test(toast), toast);

    // --- 4. Device A keeps its session (fresh cookie) ------------------------
    me = await A.eval(ME);
    check('A: still authed after change (fresh cookie)', me.authed === true, me);

    // --- 5. Device B is kicked -----------------------------------------------
    me = await B.eval(ME);
    check('B: session dead after rotation (/api/me authed=false)', me.authed === false && me.configured === true, me);
    reload = B.nextLoad();
    await B.eval(`location.reload()`);
    await reload; await sleep(700);
    st = await B.eval(OVERLAY_STATE);
    check('B: kicked to login screen on reload', st.visible && st.title === 'Enter your password', st);

    // old password no longer works
    await B.eval(`
      document.getElementById('authPw').value = ${JSON.stringify(PW1)};
      document.getElementById('authSubmit').click();`);
    await sleep(800);
    st = await B.eval(OVERLAY_STATE);
    check('B: old password rejected', st.visible && /incorrect password/i.test(st.err), st);

    // new password works
    reload = B.nextLoad();
    await B.eval(`
      document.getElementById('authPw').value = ${JSON.stringify(PW2)};
      document.getElementById('authSubmit').click();`);
    await reload; await sleep(700);
    me = await B.eval(ME);
    check('B: new password logs in', me.authed === true, me);

    // --- 6. Console hygiene ---------------------------------------------------
    check('A: zero console errors/exceptions', A.errors.length === 0, A.errors);
    check('B: zero console errors/exceptions', B.errors.length === 0, B.errors);
  } finally {
    await A.close();
    await B.close();
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error('TEST DRIVER ERROR:', e); process.exit(1); });
