// End-to-end browser test of the Microsoft 365 updates widget.
//
// Self-contained: spawns its own server (env-managed password, separate PORT),
// drives headless Chrome over CDP, then kills the server. It deliberately never
// calls persistDashboard()/saveConfig() — the widget is injected with the
// exported setDashboard() setter — so the test writes NOTHING to /data.
//
// Covers: the server /api/m365 proxy shape + trimming + cache; the widget being
// opt-in (absent from the default dashboard but offered as an Add-widget chip);
// live rows rendering with title/summary/service/kind/major badges + the
// attribution footer; canonical links; and the disabled-in-edit-mode preview.
//
// Needs network access to mc.merill.net (the widget is a live proxy by design).
//
// Run: node scripts/test-m365.mjs   (needs Chrome; env: CHROME, PORT)

import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = process.env.PORT || 3012;
const BASE = `http://127.0.0.1:${PORT}`;
const PW = 'verify-m365-123';

let pass = 0, fail = 0;
function check(name, cond, extra) {
  console.log(`${cond ? 'PASS' : 'FAIL'} - ${name}${cond ? '' : ' :: ' + JSON.stringify(extra)}`);
  if (cond) pass++; else fail++;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

class Device {
  constructor(name, port) {
    this.name = name; this.port = port;
    this.profile = path.join(os.tmpdir(), `beacon-m365-${name}`);
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

// NOTE: layouts below are injected with the exported setDashboard() setter and
// persistDashboard()/saveConfig() are never called, so /data stays untouched.
// statConfig() snapshots the real config so the test can prove that at the end.
const CONFIG_FILE = path.join('/data', 'config', 'config.json');
function statConfig() {
  try {
    const s = fs.statSync(CONFIG_FILE);
    return { mtime: s.mtimeMs, size: s.size, body: fs.readFileSync(CONFIG_FILE, 'utf8') };
  } catch { return { mtime: 0, size: 0, body: '' }; }
}

async function main() {
  const cfgBefore = statConfig();
  const server = spawn('node', ['server.js'], { env: { ...process.env, BEACON_PASSWORD: PW, PORT: String(PORT) }, stdio: 'ignore' });
  const D = new Device('d', 9341);
  try {
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

    // --- server: /api/m365 proxy ---------------------------------------------
    const t0 = Date.now();
    const api = await D.eval(`fetch('/api/m365').then(r => r.json())`);
    const coldMs = Date.now() - t0;
    check('server: /api/m365 returns an items array', Array.isArray(api.items), { error: api.error, n: api.items?.length });
    check('server: no error flag on a healthy fetch', !api.error, api.error);
    check('server: trimmed to at most 50 items', api.items.length > 0 && api.items.length <= 50, api.items.length);
    const it0 = api.items[0] || {};
    check('server: items carry the trimmed widget shape', ['id', 'title', 'url', 'source', 'services', 'tags', 'major', 'summary', 'ts'].every(k => k in it0), Object.keys(it0));
    check('server: every url is http(s)', api.items.every(i => /^https?:\/\//.test(i.url)), api.items.filter(i => !/^https?:\/\//.test(i.url)).slice(0, 2));
    check('server: source normalized to mc|roadmap', api.items.every(i => i.source === 'mc' || i.source === 'roadmap'), [...new Set(api.items.map(i => i.source))]);
    check('server: sorted newest-first by ts', api.items.every((i, n) => n === 0 || (api.items[n - 1].ts || 0) >= (i.ts || 0)), api.items.slice(0, 3).map(i => i.ts));
    check('server: summaries are capped at 400 chars', api.items.every(i => (i.summary || '').length <= 400), Math.max(...api.items.map(i => (i.summary || '').length)));
    const t1 = Date.now();
    await D.eval(`fetch('/api/m365').then(r => r.json())`);
    const warmMs = Date.now() - t1;
    check('server: second call is served from cache (faster)', warmMs < coldMs, { coldMs, warmMs });

    // --- widget is OPT-IN ------------------------------------------------------
    // Fresh profile => no saved layout => DEFAULT_DASHBOARD, which must not carry it.
    const def = await D.eval(`(() => ({
      feed: !!document.getElementById('m365Feed'),
      saved: localStorage.getItem('msp-dashboard'),
    }))()`);
    check('widget absent from the default dashboard (opt-in)', def.feed === false, def);

    // ...but it IS offered as an Add-widget chip in edit mode.
    await D.eval(`(async () => {
      const d = await import('/js/dashboard.js');
      const m = await import('/js/app.js');
      d.setDashboard([{ id: 'clock', type: 'clock', enabled: true }]);
      d.setDashboardEditMode(true);
      m.setMode('home');
    })()`);
    await sleep(400);
    const chip = await D.eval(`(() => {
      const b = [...document.querySelectorAll('.add-widget-bar .btn')].find(x => /Microsoft 365/i.test(x.textContent));
      return { found: !!b, label: b ? b.textContent.trim() : '', icon: b ? !!b.querySelector('.ti-brand-windows') : false };
    })()`);
    check('offered as an "Add widget" chip', chip.found === true, chip);
    check('chip uses the brand-windows icon', chip.icon === true, chip);

    // --- disabled-in-edit-mode shows a static preview, not a spinner ----------
    await D.eval(`(async () => {
      const d = await import('/js/dashboard.js');
      const m = await import('/js/app.js');
      d.setDashboard([{ id: 'm365', type: 'm365', enabled: false }]);
      d.setDashboardEditMode(true);
      m.setMode('home');
    })()`);
    await sleep(400);
    const disabled = await D.eval(`(() => ({
      liveContainer: !!document.getElementById('m365Feed'),
      preview: /Message Center/i.test(document.querySelector('.home-widget-empty')?.textContent || ''),
    }))()`);
    check('disabled widget shows a static preview (no live container)', disabled.liveContainer === false, disabled);
    check('disabled preview names Message Center & Roadmap', disabled.preview === true, disabled);

    // --- enabled widget renders live rows -------------------------------------
    await D.eval(`(async () => {
      const d = await import('/js/dashboard.js');
      const m = await import('/js/app.js');
      d.setDashboardEditMode(false);
      d.setDashboard([{ id: 'm365', type: 'm365', enabled: true }]);
      m.setMode('home');
    })()`);
    await sleep(2500); // fetch + render

    const dom = await D.eval(`(() => {
      const rows = [...document.querySelectorAll('#m365Feed .m365-item')];
      const first = rows[0];
      const foot = document.querySelector('.m365-foot');
      return {
        rowCount: rows.length,
        stillLoading: /Loading updates/i.test(document.getElementById('m365Feed')?.textContent || ''),
        title: first ? first.querySelector('.feed-item-title')?.textContent.trim() : '',
        url: first ? first.dataset.url : '',
        hasSummary: rows.some(r => (r.querySelector('.m365-summary')?.textContent || '').length > 20),
        svcCount: rows.reduce((n, r) => n + r.querySelectorAll('.m365-svc').length, 0),
        kinds: [...new Set(rows.map(r => r.querySelector('.m365-kind')?.textContent.trim()))],
        majors: rows.filter(r => r.querySelector('.m365-major')).length,
        hasAgo: rows.every(r => /(ago|now|^\\s*$)/i.test(r.querySelector('.feed-item-meta')?.lastElementChild?.textContent || '')),
        footText: foot ? foot.textContent.trim() : '',
        footHref: foot ? foot.querySelector('a')?.getAttribute('href') : '',
        footRel: foot ? foot.querySelector('a')?.getAttribute('rel') : '',
      };
    })()`);
    check('rows rendered (loading state replaced)', dom.rowCount > 0 && dom.stillLoading === false, dom);
    check('renders at most M365_SHOWN (10) rows', dom.rowCount <= 10, dom.rowCount);
    check('first row has a non-empty title', dom.title.length > 3, dom.title);
    check('first row links to the canonical mc.merill.net post', /^https:\/\/mc\.merill\.net\/message\//.test(dom.url), dom.url);
    check('summaries rendered', dom.hasSummary === true, dom);
    check('service badges rendered', dom.svcCount > 0, dom.svcCount);
    check('kind badge reads Roadmap / Message center', dom.kinds.every(k => k === 'Roadmap' || k === 'Message center'), dom.kinds);
    check('relative timestamp rendered per row', dom.hasAgo === true, dom);
    check('attribution footer credits mc.merill.net', /via\s+mc\.merill\.net/i.test(dom.footText) && dom.footHref === 'https://mc.merill.net', dom);
    check('footer carries the tenant-verification reminder', /verify applicability in your own tenant/i.test(dom.footText), dom.footText);
    check('footer link is rel="noopener noreferrer"', /noopener/.test(dom.footRel || '') && /noreferrer/.test(dom.footRel || ''), dom.footRel);

    // rows are click-to-open — verify the bridged handler is wired + reachable
    const wired = await D.eval(`(() => ({
      handler: typeof window.openFeedItem === 'function',
      onclick: !!document.querySelector('#m365Feed .m365-item')?.getAttribute('onclick'),
    }))()`);
    check('row click handler is bridged (openFeedItem)', wired.handler === true, wired);
    check('rows carry the onclick open handler', wired.onclick === true, wired);

    // --- major-change badge + escaping (deterministic, stubbed response) ------
    // Runs LAST: it replaces window.fetch, so nothing after it may need the network.
    // Only ~3 of the newest 50 upstream items are major, so live data does not
    // reliably exercise the badge. Stub /api/m365 to pin the render path down.
    const STUB = {
      items: [
        { id: 'MC000001', title: 'Major thing <script>x</script>', url: 'https://mc.merill.net/message/MC000001',
          source: 'mc', services: ['Microsoft Teams'], tags: ['Retirement'], major: true,
          summary: 'A breaking change that needs attention.', ts: Date.now() - 3600e3 },
        { id: 'RM000002', title: 'Routine roadmap item', url: 'https://mc.merill.net/message/RM000002',
          source: 'roadmap', services: [], tags: [], major: false, summary: '', ts: Date.now() - 7200e3 },
      ],
      error: null,
    };
    await D.eval(`(async () => {
      const realFetch = window.fetch;
      window.fetch = (u, o) => String(u).startsWith('/api/m365')
        ? Promise.resolve(new Response(${JSON.stringify(JSON.stringify(STUB))}, { headers: { 'Content-Type': 'application/json' } }))
        : realFetch(u, o);
      const d = await import('/js/dashboard.js');
      const m = await import('/js/app.js');
      d.setDashboard([{ id: 'm365', type: 'm365', enabled: true }]);
      m.setMode('home');
    })()`);
    await sleep(900);
    const stub = await D.eval(`(() => {
      const rows = [...document.querySelectorAll('#m365Feed .m365-item')];
      const majorEl = rows[0]?.querySelector('.m365-major');
      return {
        rowCount: rows.length,
        majorOnFirst: !!majorEl,
        majorText: majorEl ? majorEl.textContent.trim() : '',
        majorOnSecond: !!rows[1]?.querySelector('.m365-major'),
        titleText: rows[0]?.querySelector('.feed-item-title')?.textContent || '',
        injectedScript: !!rows[0]?.querySelector('script'),
        kinds: rows.map(r => r.querySelector('.m365-kind')?.textContent.trim()),
        noSummaryBlock: !rows[1]?.querySelector('.m365-summary'),
        noSvcBadges: rows[1]?.querySelectorAll('.m365-svc').length === 0,
      };
    })()`);
    check('stub: both rows rendered', stub.rowCount === 2, stub);
    check('stub: major item shows the Major badge', stub.majorOnFirst === true && /Major/.test(stub.majorText), stub);
    check('stub: non-major item has no Major badge', stub.majorOnSecond === false, stub);
    check('stub: roadmap vs mc kind labels', stub.kinds[0] === 'Message center' && stub.kinds[1] === 'Roadmap', stub.kinds);
    check('stub: title is escaped (no injected <script>)', stub.injectedScript === false && stub.titleText.includes('<script>'), stub);
    check('stub: empty summary renders no summary block', stub.noSummaryBlock === true, stub);
    check('stub: empty services render no badges', stub.noSvcBadges === true, stub);

    // --- nothing was persisted to /data ---------------------------------------
    // The injected layouts must never reach the server. localStorage is NOT the
    // check here: applyServerConfig() mirrors the server layout into it on every
    // boot, so it is populated by normal startup in this throwaway profile. The
    // real invariant is that config.json on disk is byte-for-byte untouched.
    const cfgAfter = statConfig();
    check('server config.json untouched (no stray save)',
      cfgBefore.mtime === cfgAfter.mtime && cfgBefore.size === cfgAfter.size, { cfgBefore, cfgAfter });
    check('injected m365 layout never reached the saved config',
      !(cfgAfter.body || '').includes('"m365"'), cfgAfter.size);

    check('zero console errors/exceptions', D.errors.length === 0, D.errors);
  } finally {
    await D.close();
    try { server.kill(); } catch {}
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
