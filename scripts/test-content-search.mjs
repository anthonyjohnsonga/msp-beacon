// End-to-end browser test of full-text CONTENT search + match snippets
// (v1.0.29 highlight/snippet feature, commit 6fb8042). Complements
// scripts/test-search.mjs, which covers the client-side ranking/highlight/fuzzy.
//
// Self-contained: seeds ONE snapshot into /data/snapshots, spawns its own server
// (env-managed password, separate PORT), drives headless Chrome over CDP, then
// tears everything back down (kills the server, deletes the seeded snapshot).
//
// It verifies the whole content path: the server /api/search-content returns
// {ids, snippets} from the original-case snapshot on disk; the client marks the
// link as a content-only match ("in page" badge) and renders the highlighted
// snippet excerpt under the card — for a query whose term appears ONLY in the
// page text, not in the link's title/url/desc/tags.
//
// Run: node scripts/test-content-search.mjs   (needs Chrome; env: CHROME)

import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = process.env.PORT || 3011;
const BASE = `http://127.0.0.1:${PORT}`;
const PW = 'verify-content-123';
const SNAP_DIR = path.join('/data', 'snapshots');
const SNAP_ID = 'zzsnap0001';                 // must be alnum (server safeId strips the rest)
const TERM = 'flibbertigibbet';               // appears ONLY in the page text below
const SNAP_TEXT = `Executive summary and overview. The quarterly ${TERM} initiative reduced end-to-end latency across every region while holding spend flat. Detailed metrics, per-service breakdowns, and a cost analysis appendix follow in the sections below for the finance and platform teams.`;

let pass = 0, fail = 0;
function check(name, cond, extra) {
  console.log(`${cond ? 'PASS' : 'FAIL'} - ${name}${cond ? '' : ' :: ' + JSON.stringify(extra)}`);
  if (cond) pass++; else fail++;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

class Device {
  constructor(name, port) {
    this.name = name; this.port = port;
    this.profile = path.join(os.tmpdir(), `beacon-content-${name}`);
    this.errors = []; this.msgId = 0; this.pending = new Map(); this.loadedResolvers = [];
  }
  async launch() {
    fs.rmSync(this.profile, { recursive: true, force: true });
    this.proc = spawn(CHROME, [
      '--headless=new', `--remote-debugging-port=${this.port}`,
      `--user-data-dir=${this.profile}`, '--no-first-run', '--disable-extensions',
      '--window-size=1280,900', 'about:blank',
    ], { stdio: 'ignore' });
    let targets;
    for (let i = 0; i < 50; i++) {
      try { targets = await (await fetch(`http://127.0.0.1:${this.port}/json`)).json(); if (targets.some(t => t.type === 'page')) break; } catch {}
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
      const { resolve, reject } = this.pending.get(msg.id); this.pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result); return;
    }
    if (msg.method === 'Runtime.exceptionThrown') this.errors.push('exception: ' + (msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text));
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') this.errors.push('console.error: ' + msg.params.args.map(a => a.value ?? a.description ?? '').join(' '));
    if (msg.method === 'Page.loadEventFired') this.loadedResolvers.splice(0).forEach(r => r());
  }
  send(method, params = {}) {
    const id = ++this.msgId;
    return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.ws.send(JSON.stringify({ id, method, params })); });
  }
  nextLoad(timeoutMs = 10000) {
    return new Promise((resolve, reject) => { const t = setTimeout(() => reject(new Error(`${this.name}: load timeout`)), timeoutMs); this.loadedResolvers.push(() => { clearTimeout(t); resolve(); }); });
  }
  async goto(url) { const loaded = this.nextLoad(); await this.send('Page.navigate', { url }); await loaded; await sleep(800); }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(`${this.name} eval failed: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
    return r.result.value;
  }
  async close() { try { this.proc.kill(); } catch {} }
}

// Fixture: the snapshot link's title/url/desc/tags deliberately EXCLUDE the term,
// so a match can only come from the page text → content-only match path.
const FIXTURE = [
  { id: SNAP_ID, title: 'Quarterly Report', url: 'https://example.com/q3-report', desc: 'financials overview', tags: ['reports'], path: [] },
  { id: 'zznormal01', title: 'Team Handbook', url: 'https://example.com/handbook', desc: 'onboarding', tags: [], path: [] },
];

// Confirm /api/search-content returns the new shape straight from the server.
async function checkEndpoint() {
  const res = await fetch(`${BASE}/api/search-content?q=${TERM}`, { headers: { Cookie: global.__cookie || '' } });
  return res.ok ? res.json() : { error: res.status };
}

async function main() {
  // --- seed the snapshot on disk BEFORE the server boots (loadContentIndex) ---
  fs.mkdirSync(SNAP_DIR, { recursive: true });
  const snapFile = path.join(SNAP_DIR, SNAP_ID + '.txt');
  fs.writeFileSync(snapFile, SNAP_TEXT, 'utf8');

  const server = spawn('node', ['server.js'], { env: { ...process.env, BEACON_PASSWORD: PW, PORT: String(PORT) }, stdio: 'ignore' });
  const D = new Device('d', 9339);
  try {
    // wait for server
    for (let i = 0; i < 40; i++) { try { if ((await (await fetch(BASE + '/api/me')).json()).configured) break; } catch {} await sleep(250); }

    await D.launch();
    await D.goto(BASE + '/');
    let me = await D.eval(`fetch('/api/me').then(r => r.json())`);
    if (me.authed !== true) {
      const reload = D.nextLoad();
      await D.eval(`document.getElementById('authPw').value = ${JSON.stringify(PW)}; document.getElementById('authSubmit').click();`);
      await reload; await sleep(900);
      me = await D.eval(`fetch('/api/me').then(r => r.json())`);
    }
    check('app authed after login', me.authed === true, me);

    // server-side endpoint returns the seeded snapshot + a snippet
    const api = await D.eval(`fetch('/api/search-content?q=${TERM}').then(r => r.json())`);
    check('server: /api/search-content returns {ids, snippets}', Array.isArray(api.ids) && !!api.snippets, api);
    check('server: seeded snapshot id is a match', api.ids.includes(SNAP_ID), api.ids);
    check('server: snippet contains the term (original case)', typeof api.snippets[SNAP_ID] === 'string' && api.snippets[SNAP_ID].toLowerCase().includes(TERM), api.snippets && api.snippets[SNAP_ID]);
    check('server: snippet is a trimmed excerpt (not the whole page)', api.snippets[SNAP_ID].length < SNAP_TEXT.length, api.snippets[SNAP_ID]?.length);

    // multi-term AND (v1.0.29): "summary" and "latency" both appear in the page
    // text but are NOT adjacent — the old phrase-only match would miss this.
    const multi = await D.eval(`fetch('/api/search-content?q=summary%20latency').then(r => r.json())`);
    check('server: multi-term (non-adjacent) AND matches', multi.ids.includes(SNAP_ID), multi.ids);
    check('server: multi-term snippet centers on earliest term', typeof multi.snippets[SNAP_ID] === 'string' && multi.snippets[SNAP_ID].toLowerCase().includes('summary'), multi.snippets && multi.snippets[SNAP_ID]);
    const missing = await D.eval(`fetch('/api/search-content?q=latency%20unicorn').then(r => r.json())`);
    check('server: multi-term AND rejects when a term is absent', !missing.ids.includes(SNAP_ID), missing.ids);

    // inject the client fixture + force grid view (snippet renders on grid cards)
    await D.eval(`(async () => {
      const m = await import('/js/app.js');
      const s = await import('/js/state.js');
      s.ui.view = 'grid';
      m.setLinks(${JSON.stringify(FIXTURE)});
      m.setMode('manager');
    })()`);
    await sleep(300);

    // drive the REAL search path: set the box + fire the debounced content search
    await D.eval(`
      document.getElementById('search').value = ${JSON.stringify(TERM)};
      window.onSearchInput(${JSON.stringify(TERM)});`);
    await sleep(1000); // debounce (300) + fetch + render

    const dom = await D.eval(`(() => {
      const card = document.querySelector('#content .card[data-id="${SNAP_ID}"]');
      const snip = card ? card.querySelector('.content-snippet') : null;
      const badge = card ? card.querySelector('.content-badge') : null;
      const mark = snip ? snip.querySelector('mark') : null;
      return {
        cardShown: !!card,
        hasBadge: !!badge,
        hasSnippet: !!snip,
        snippetText: snip ? snip.textContent : '',
        markText: mark ? mark.textContent : '',
        badgeTip: badge ? badge.getAttribute('title') : '',
      };
    })()`);
    check('client: content-only link appears in results', dom.cardShown === true, dom);
    check('client: "in page" badge shown', dom.hasBadge === true, dom);
    check('client: snippet block rendered under the card', dom.hasSnippet === true, dom);
    check('client: snippet text contains the term', new RegExp(TERM, 'i').test(dom.snippetText), dom.snippetText);
    check('client: term is highlighted (<mark>) in the snippet', new RegExp(TERM, 'i').test(dom.markText), dom.markText);
    check('client: badge tooltip carries the excerpt', new RegExp(TERM, 'i').test(dom.badgeTip), dom.badgeTip);

    // a title-term query must NOT be a content-only match (badge absent)
    await D.eval(`
      document.getElementById('search').value = 'quarterly';
      window.onSearchInput('quarterly');`);
    await sleep(1000);
    const titleQuery = await D.eval(`(() => {
      const card = document.querySelector('#content .card[data-id="${SNAP_ID}"]');
      return { cardShown: !!card, hasBadge: card ? !!card.querySelector('.content-badge') : false };
    })()`);
    check('client: title match is NOT flagged "in page"', titleQuery.cardShown && titleQuery.hasBadge === false, titleQuery);

    // client: a multi-term content-only query (both page-text terms) still flags it
    await D.eval(`
      document.getElementById('search').value = 'summary latency';
      window.onSearchInput('summary latency');`);
    await sleep(1000);
    const multiClient = await D.eval(`(() => {
      const card = document.querySelector('#content .card[data-id="${SNAP_ID}"]');
      return { cardShown: !!card, hasBadge: card ? !!card.querySelector('.content-badge') : false };
    })()`);
    check('client: multi-term content match flagged "in page"', multiClient.cardShown && multiClient.hasBadge === true, multiClient);

    check('zero console errors/exceptions', D.errors.length === 0, D.errors);
  } finally {
    await D.close();
    try { server.kill(); } catch {}
    try { fs.unlinkSync(snapFile); } catch {}   // remove the seeded snapshot
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error('TEST DRIVER ERROR:', e); process.exit(1); });
