// End-to-end browser test of the search upgrades (v1.0.29 track):
//   1. Tokenized AND + relevance ranking  (commit d2850d1)
//   2. Match highlighting in card markup   (commit 6fb8042)
//   3. Typo-tolerant fuzzy fallback         (commit 50119ef)
//
// Driven over raw CDP using Node 24's built-in WebSocket. No dependencies.
//
// It does NOT touch the data dir: after the app boots, it imports /js/app.js in
// the page and swaps the in-memory `links` array for a known fixture via the
// exported setLinks(), then drives render() directly and inspects the ranked
// `visibleIds` + the rendered DOM. Nothing is saved, so the real links.json is
// untouched. (Content-snippet search is NOT covered here — that needs server
// snapshots; the endpoint shape is checked separately.)
//
// Prereqs: server running with a KNOWN password so the app boots into content.
// Easiest is an env-managed password (writes nothing to /data/auth.json):
//   BEACON_PASSWORD=verify-search-123 node server.js
// then, in another shell:
//   node scripts/test-search.mjs
// Env: CHROME, BASE_URL, BEACON_PASSWORD (default verify-search-123).

import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = process.env.BASE_URL || 'http://127.0.0.1:3000';
const PW = process.env.BEACON_PASSWORD || 'verify-search-123';

let pass = 0, fail = 0;
function check(name, cond, extra) {
  console.log(`${cond ? 'PASS' : 'FAIL'} - ${name}${cond ? '' : ' :: ' + JSON.stringify(extra)}`);
  if (cond) pass++; else fail++;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

class Device {
  constructor(name, port) {
    this.name = name; this.port = port;
    this.profile = path.join(os.tmpdir(), `beacon-search-${name}`);
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

// The fixture: crafted so each search below has a single unambiguous expectation.
const FIXTURE = [
  { id: 'zz01aaaa', title: 'Azure Billing Portal', url: 'https://portal.azure.com', desc: 'Cloud cost management', tags: ['cloud'], path: [] },
  { id: 'zz02aaaa', title: 'Cost Explorer', url: 'https://azure.microsoft.com/pricing', desc: 'pricing calculator', tags: [], path: [] },
  { id: 'zz03aaaa', title: 'Finance Wiki', url: 'https://wiki.local/finance', desc: 'internal notes about azure spend', tags: [], path: [] },
  { id: 'zz04aaaa', title: 'Kubernetes cluster docs', url: 'https://kubernetes.io/docs', desc: 'k8s reference', tags: ['ops'], path: [] },
  { id: 'zz05aaaa', title: 'Random Notes', url: 'https://example.com', desc: 'nothing relevant here', tags: [], path: [] },
  { id: 'zz06aaaa', title: 'GitHub Repo', url: 'https://github.com/acme/app', desc: 'source code', tags: ['dev'], path: [] },
];

// Injected once into the page. Swaps the in-memory links, switches to the
// manager, and exposes doSearch(q) → { ids, hint, hasMark, markText }.
const SETUP = `(async () => {
  const m = await import('/js/app.js');
  m.setLinks(${JSON.stringify(FIXTURE)});
  m.setMode('manager');
  window.__doSearch = (q) => {
    const box = document.getElementById('search');
    box.value = q;
    m.render();
    const mark = document.querySelector('#content mark');
    return {
      ids: m.visibleIds.slice(),
      hint: !!document.querySelector('.search-hint'),
      hasMark: !!mark,
      markText: mark ? mark.textContent : '',
    };
  };
  return typeof m.setLinks === 'function' && typeof m.render === 'function' && Array.isArray(m.visibleIds);
})()`;

async function main() {
  const D = new Device('d', 9337);
  try {
    await D.launch();
    await D.goto(BASE + '/');
    // Log in through the overlay (server started with BEACON_PASSWORD).
    let me = await D.eval(`fetch('/api/me').then(r => r.json())`);
    if (me.authed !== true) {
      const reload = D.nextLoad();
      await D.eval(`
        document.getElementById('authPw').value = ${JSON.stringify(PW)};
        document.getElementById('authSubmit').click();`);
      await reload; await sleep(800);
      me = await D.eval(`fetch('/api/me').then(r => r.json())`);
    }
    check('app is authed after login', me.authed === true, me);

    const wired = await D.eval(SETUP);
    check('injected fixture + exports present', wired === true, wired);
    await sleep(200);

    // 1. Relevance ranking: "azure" is in a title, a url, and a desc. Title wins.
    let r = await D.eval(`window.__doSearch('azure')`);
    check('ranking: title match ranks first', r.ids[0] === 'zz01aaaa', r.ids);
    check('ranking: all three azure links returned', ['zz01aaaa','zz02aaaa','zz03aaaa'].every(id => r.ids.includes(id)), r.ids);
    check('ranking: url match outranks desc match', r.ids.indexOf('zz02aaaa') < r.ids.indexOf('zz03aaaa'), r.ids);
    check('exact query shows NO fuzzy hint', r.hint === false, r);

    // 2. Highlighting.
    check('highlight: <mark> present in results', r.hasMark === true, r);
    check('highlight: marked text is the query term', /azure/i.test(r.markText), r.markText);

    // 3. Word order no longer matters (the old concat-substring test failed this).
    r = await D.eval(`window.__doSearch('billing azure')`);
    check('word order: "billing azure" finds "Azure Billing Portal"', r.ids.includes('zz01aaaa'), r.ids);
    check('word order: unrelated links excluded', !r.ids.includes('zz05aaaa'), r.ids);

    // 4. AND semantics: both terms must match somewhere.
    r = await D.eval(`window.__doSearch('azure kubernetes')`);
    check('AND: no link has both azure AND kubernetes → 0 results', r.ids.length === 0, r.ids);

    // 5. Fuzzy fallback on a typo (strict AND fails → fuzzy kicks in).
    r = await D.eval(`window.__doSearch('kubernets')`);
    check('fuzzy: typo "kubernets" finds Kubernetes', r.ids.includes('zz04aaaa'), r.ids);
    check('fuzzy: approximate-results hint shown', r.hint === true, r);

    // 6. Garbage query matches nothing, fuzzy or otherwise.
    r = await D.eval(`window.__doSearch('zzqqxx')`);
    check('garbage query → 0 results, no crash', r.ids.length === 0, r.ids);

    // 7. Exclusion operator: "azure -billing" drops the link with "billing".
    r = await D.eval(`window.__doSearch('azure -billing')`);
    check('exclude: -billing drops the Billing Portal link', !r.ids.includes('zz01aaaa'), r.ids);
    check('exclude: other azure links remain', r.ids.includes('zz02aaaa') && r.ids.includes('zz03aaaa'), r.ids);

    // 8. OR operator: matches either alternative.
    r = await D.eval(`window.__doSearch('kubernetes OR github')`);
    check('OR: matches either alternative', r.ids.includes('zz04aaaa') && r.ids.includes('zz06aaaa'), r.ids);
    check('OR: unrelated links excluded', !r.ids.includes('zz05aaaa'), r.ids);

    // 9. Pure-exclusion query: everything EXCEPT links matching the term.
    r = await D.eval(`window.__doSearch('-azure')`);
    check('pure-exclude: azure links removed', !['zz01aaaa','zz02aaaa','zz03aaaa'].some(id => r.ids.includes(id)), r.ids);
    check('pure-exclude: non-azure links kept', ['zz04aaaa','zz05aaaa','zz06aaaa'].every(id => r.ids.includes(id)), r.ids);

    // 10. Clearing the query restores the full fixture.
    r = await D.eval(`window.__doSearch('')`);
    check('empty query shows all fixture links', FIXTURE.every(l => r.ids.includes(l.id)), r.ids);

    check('zero console errors/exceptions', D.errors.length === 0, D.errors);
  } finally {
    await D.close();
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error('TEST DRIVER ERROR:', e); process.exit(1); });
