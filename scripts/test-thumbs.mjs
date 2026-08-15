// End-to-end browser test of opt-in card preview images (og:image thumbnails).
//
// Fully hermetic: besides its own Beacon server it spins up a tiny FIXTURE
// ORIGIN on localhost serving pages with/without og:image, so nothing here
// depends on the public internet. That fixture also exercises the trusted-tier
// fetch policy -- 127.0.0.1 is a private address, which /api/thumb is meant to
// allow (same tier as /api/favicon).
//
// Covers: og:image + twitter:image extraction, relative/absolute URL
// resolution, non-image rejection, the disk + negative cache, the separate
// short-lived backoff for a page that could not be READ (vs. one that genuinely
// has no preview) plus stale-on-error and recovery, input validation, and the
// client side -- previews off by default, the Settings toggle, lazy loading,
// and the drop-the-strip-on-404 fallback.
//
// Run: node scripts/test-thumbs.mjs   (needs Chrome; env: CHROME, PORT)

import { spawn } from 'child_process';
import crypto from 'crypto';
import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';

const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = process.env.PORT || 3015;
const FIXTURE_PORT = 3116;
const BASE = `http://127.0.0.1:${PORT}`;
const FIX = `http://127.0.0.1:${FIXTURE_PORT}`;
const PW = 'verify-thumbs-123';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  console.log(`${cond ? 'PASS' : 'FAIL'} - ${name}${cond ? '' : ' :: ' + JSON.stringify(extra)}`);
  if (cond) pass++; else fail++;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

// --- fixture origin ---------------------------------------------------------
const page = (head) => `<!doctype html><html><head><title>Fixture</title>${head}</head><body>hello</body></html>`;
const ROUTES = {
  '/og-relative': ['text/html', page('<meta property="og:image" content="/img.png">')],
  '/og-absolute': ['text/html', page(`<meta property="og:image" content="${FIX}/img.png">`)],
  '/og-entity':   ['text/html', page('<meta property="og:image" content="/img.png?a=1&amp;b=2">')],
  '/og-reversed': ['text/html', page('<meta content="/img.png" property="og:image">')],
  '/twitter':     ['text/html', page('<meta name="twitter:image" content="/img.png">')],
  '/og-priority': ['text/html', page('<meta name="twitter:image" content="/not-an-image"><meta property="og:image" content="/img.png">')],
  '/no-og':       ['text/html', page('<meta name="description" content="nothing here">')],
  '/og-notimage': ['text/html', page('<meta property="og:image" content="/not-an-image">')],
  '/not-an-image': ['text/plain', 'this is not an image'],
};
let fixtureHits = 0;
let fixtureDown = false; // flipped to simulate an origin we cannot read right now
const fixture = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  fixtureHits++;
  if (fixtureDown) { res.writeHead(503); return res.end(); }
  if (url === '/img.png') { res.writeHead(200, { 'Content-Type': 'image/png' }); return res.end(PNG); }
  const r = ROUTES[url];
  if (!r) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': r[0] });
  res.end(r[1]);
});

class Device {
  constructor(name, port) {
    this.name = name; this.port = port;
    this.profile = path.join(os.tmpdir(), `beacon-thumbs-${name}`);
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
    const p = targets.find(t => t.type === 'page');
    this.ws = new WebSocket(p.webSocketDebuggerUrl);
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

const FIXTURE_LINKS = [
  { id: 'zzthumb001', title: 'Has a preview', url: `${FIX}/og-relative`, desc: '', tags: [], path: [] },
  { id: 'zzthumb002', title: 'No preview', url: `${FIX}/no-og`, desc: '', tags: [], path: [] },
];

// thumb() returns {status, type} for a fixture path, from inside the page so the
// request carries the session cookie.
// cache:'no-store' matters: /api/thumb answers with Cache-Control max-age, so
// without it the browser would satisfy repeat calls from its own cache and the
// server-side cache assertions below would pass without reaching the server.
const thumb = (D, p) => D.eval(`fetch('/api/thumb?url=' + encodeURIComponent('${FIX}${p}'), { cache: 'no-store' })
  .then(r => ({ status: r.status, type: r.headers.get('content-type') }))`);
const thumbBody = (D, p) => D.eval(`fetch('/api/thumb?url=' + encodeURIComponent('${FIX}${p}'), { cache: 'no-store' })
  .then(async r => ({ status: r.status, type: r.headers.get('content-type'), bytes: (await r.arrayBuffer()).byteLength }))`);
const THUMB_TTL_DAYS = 30; // mirrors THUMB_TTL in server.js

async function main() {
  await new Promise(r => fixture.listen(FIXTURE_PORT, '127.0.0.1', r));
  // Clear ONLY this run's fixture entries, so the cache assertions can't pass on
  // a stale file. Never wipe the directory -- it holds the user's real previews.
  const THUMB_DIR = path.join('/data', 'thumbs');
  const fixtureHashes = [...Object.keys(ROUTES), '/img.png', '/gone'].map(p =>
    crypto.createHash('sha1').update(FIX + p).digest('hex'));
  for (const h of fixtureHashes) {
    for (const f of [h, h + '.none', h + '.err']) {
      try { fs.unlinkSync(path.join(THUMB_DIR, f)); } catch { /* not cached */ }
    }
  }

  const server = spawn('node', ['server.js'], { env: { ...process.env, BEACON_PASSWORD: PW, PORT: String(PORT) }, stdio: 'ignore' });
  const D = new Device('d', 9343);
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

    // --- server: og:image extraction ----------------------------------------
    const rel = await thumb(D, '/og-relative');
    check('server: og:image (relative) resolves to an image', rel.status === 200 && /image\/png/.test(rel.type), rel);
    const abs = await thumb(D, '/og-absolute');
    check('server: og:image (absolute) resolves', abs.status === 200, abs);
    const rev = await thumb(D, '/og-reversed');
    check('server: attribute order (content before property) handled', rev.status === 200, rev);
    const ent = await thumb(D, '/og-entity');
    check('server: HTML entities in content are decoded', ent.status === 200, ent);
    const tw = await thumb(D, '/twitter');
    check('server: falls back to twitter:image', tw.status === 200, tw);
    const pri = await thumb(D, '/og-priority');
    check('server: og:image wins over twitter:image', pri.status === 200 && /image\/png/.test(pri.type), pri);

    // --- server: rejections --------------------------------------------------
    const none = await thumb(D, '/no-og');
    check('server: page with no og:image 404s', none.status === 404, none);
    const notimg = await thumb(D, '/og-notimage');
    check('server: og:image pointing at a non-image 404s', notimg.status === 404, notimg);
    const bad = await D.eval(`fetch('/api/thumb?url=javascript:alert(1)').then(r => r.status)`);
    check('server: non-http(s) url rejected with 400', bad === 400, bad);
    const missing = await D.eval(`fetch('/api/thumb').then(r => r.status)`);
    check('server: missing url rejected with 400', missing === 400, missing);

    // --- server: caching -----------------------------------------------------
    const before = fixtureHits;
    await thumb(D, '/og-relative');
    check('server: cached hit does not refetch the origin', fixtureHits === before, { before, after: fixtureHits });
    const negBefore = fixtureHits;
    await thumb(D, '/no-og');
    check('server: negative cache does not refetch the origin', fixtureHits === negBefore, { negBefore, after: fixtureHits });
    // Assert on THIS run's fixture hashes, not just "some file exists" — the
    // directory also holds the user's real previews.
    const hashOf = p => crypto.createHash('sha1').update(FIX + p).digest('hex');
    const cachedImg = path.join(THUMB_DIR, hashOf('/og-relative'));
    const cachedNone = path.join(THUMB_DIR, hashOf('/no-og') + '.none');
    check('server: image cached to /data/thumbs under the url hash',
      fs.existsSync(cachedImg) && fs.readFileSync(cachedImg).equals(PNG), fs.existsSync(cachedImg));
    check('server: negative marker written for a page with no og:image', fs.existsSync(cachedNone), cachedNone);

    // --- server: a failed read is NOT the same as "no preview" ---------------
    // A page we could not READ must not be written off for the full 30-day TTL
    // the way a page with genuinely no og:image is; it gets a short .err backoff
    // so a timeout or a blip heals within the hour.
    const goneHash = hashOf('/gone'); // not in ROUTES -> the fixture 404s it
    const gone = await thumb(D, '/gone');
    check('server: an unreadable page 404s', gone.status === 404, gone);
    check('server: a failed read writes the short .err marker, not .none',
      fs.existsSync(path.join(THUMB_DIR, goneHash + '.err'))
      && !fs.existsSync(path.join(THUMB_DIR, goneHash + '.none')), goneHash);
    const errBefore = fixtureHits;
    await thumb(D, '/gone');
    check('server: the .err backoff still prevents a refetch per render',
      fixtureHits === errBefore, { errBefore, after: fixtureHits });

    // --- server: stale-on-error ----------------------------------------------
    // Age a cached preview past THUMB_TTL and take the origin down: the stale
    // image must still be served rather than collapsing to a 404.
    const relHash = hashOf('/og-relative');
    const aged = new Date(Date.now() - (THUMB_TTL_DAYS + 1) * 86400e3);
    fs.utimesSync(path.join(THUMB_DIR, relHash), aged, aged);
    fixtureDown = true;
    const staleServe = await thumbBody(D, '/og-relative');
    check('server: a stale preview is served when the page cannot be re-read',
      staleServe.status === 200 && staleServe.bytes === PNG.length, staleServe);
    check('server: the stale serve records .err and never .none',
      fs.existsSync(path.join(THUMB_DIR, relHash + '.err'))
      && !fs.existsSync(path.join(THUMB_DIR, relHash + '.none')), relHash);

    // Recovery — clearing the backoff with the origin healthy refreshes the
    // preview and drops the marker. (Also restores this fixture page for the
    // client section below, which renders it.)
    fs.unlinkSync(path.join(THUMB_DIR, relHash + '.err'));
    fixtureDown = false;
    const healed = await thumbBody(D, '/og-relative');
    check('server: the preview refreshes once the origin recovers',
      healed.status === 200 && healed.bytes === PNG.length, healed);
    check('server: a successful refetch clears the error marker',
      !fs.existsSync(path.join(THUMB_DIR, relHash + '.err')), relHash);

    // --- client: off by default ----------------------------------------------
    await D.eval(`(async () => {
      const m = await import('/js/app.js');
      const s = await import('/js/state.js');
      s.ui.view = 'grid';
      m.setLinks(${JSON.stringify(FIXTURE_LINKS)});
      m.setMode('manager');
    })()`);
    await sleep(500);
    const off = await D.eval(`(() => ({
      thumbs: document.querySelectorAll('#content .card-thumb').length,
      cards: document.querySelectorAll('#content .card').length,
      label: document.getElementById('thumbsLabel')?.textContent,
      stored: localStorage.getItem('msp-thumbs'),
    }))()`);
    check('client: cards render', off.cards === 2, off);
    check('client: previews are OFF by default', off.thumbs === 0, off);
    check('client: Settings label reads Off', off.label === 'Off', off);

    // --- client: toggle on ---------------------------------------------------
    await D.eval(`window.toggleThumbs()`);
    await sleep(2000); // image fetches
    const on = await D.eval(`(() => {
      const imgs = [...document.querySelectorAll('#content .card-thumb img')];
      return {
        strips: document.querySelectorAll('#content .card-thumb').length,
        lazy: imgs.every(i => i.getAttribute('loading') === 'lazy'),
        loadedOk: imgs.filter(i => i.complete && i.naturalWidth > 0).length,
        label: document.getElementById('thumbsLabel')?.textContent,
        stored: localStorage.getItem('msp-thumbs'),
        onCardWithPreview: !!document.querySelector('#content .card[data-id="zzthumb001"] .card-thumb'),
      };
    })()`);
    check('client: toggle renders preview strips', on.strips >= 1, on);
    check('client: images are lazy-loaded', on.lazy === true, on);
    check('client: the page WITH og:image keeps its strip', on.onCardWithPreview === true, on);
    check('client: at least one preview actually loaded', on.loadedOk >= 1, on);
    check('client: Settings label reads On', on.label === 'On', on);
    check('client: preference persisted to localStorage', on.stored === '1', on);

    // The 404 card must drop its strip entirely (no broken-image gap).
    const dropped = await D.eval(`(() => ({
      noOgStrip: !!document.querySelector('#content .card[data-id="zzthumb002"] .card-thumb'),
    }))()`);
    check('client: card whose page has no og:image drops the strip', dropped.noOgStrip === false, dropped);

    // --- client: toggle back off + persistence across reload -----------------
    await D.eval(`window.toggleThumbs()`);
    await sleep(400);
    const back = await D.eval(`(() => ({
      strips: document.querySelectorAll('#content .card-thumb').length,
      stored: localStorage.getItem('msp-thumbs'),
    }))()`);
    check('client: toggling back off removes the strips', back.strips === 0 && back.stored === '0', back);

    await D.eval(`window.toggleThumbs()`);
    await sleep(300);
    await D.goto(BASE + '/');
    const afterReload = await D.eval(`(async () => {
      const s = await import('/js/state.js');
      return { thumbs: s.ui.thumbs, label: document.getElementById('thumbsLabel')?.textContent };
    })()`);
    check('client: preference survives a reload', afterReload.thumbs === true && afterReload.label === 'On', afterReload);

    check('zero console errors/exceptions', D.errors.length === 0, D.errors);
  } finally {
    await D.close();
    try { server.kill(); } catch {}
    await new Promise(r => fixture.close(r));
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
