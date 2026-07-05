const express = require('express');
const fsp = require('fs').promises;
const path = require('path');
const http = require('http');
const https = require('https');
const dns = require('dns').promises;
const net = require('net');
const crypto = require('crypto');

function isPrivateIP(ip) {
  if (net.isIPv4(ip)) {
    const p = ip.split('.').map(Number);
    return p[0] === 127 ||
      p[0] === 10 ||
      (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
      (p[0] === 192 && p[1] === 168) ||
      (p[0] === 169 && p[1] === 254) ||
      p[0] === 0;
  }
  if (net.isIPv6(ip)) {
    const l = ip.toLowerCase();
    return l === '::1' || l.startsWith('fc') || l.startsWith('fd') || l.startsWith('fe80');
  }
  return true;
}

// --- Outbound-fetch / SSRF policy (single source of truth) -----------------
// Every server-side fetch validates its target with parseHttpUrl() (http/https
// only). Two trust tiers govern private/internal IPs:
//   • Untrusted input — a URL the user just typed but hasn't saved — is checked
//     against isPrivateIP() and refused if it resolves to a private/internal
//     address. Currently only /api/fetch-title.
//   • Trusted, user-saved targets (/api/favicon, /api/check-links,
//     /api/snapshot) and allowlisted feeds (/api/rss) DELIBERATELY fetch
//     private/homelab IPs — that's the point of a self-hosted dashboard.
// Change the policy here, not at each call site.
function parseHttpUrl(str) {
  let u;
  try { u = new URL(str); } catch { return null; }
  return (u.protocol === 'http:' || u.protocol === 'https:') ? u : null;
}

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join('/data', 'links.json');
const CONFIG_FILE = path.join('/data/config', 'config.json');
const FAVICON_DIR = path.join('/data', 'favicons');
const FAVICON_TTL = 30 * 24 * 60 * 60 * 1000; // re-fetch cached icons after 30 days
const WALLPAPER_FILE = path.join('/data', 'wallpaper'); // single uploaded homepage background
const FAVICON_MAX = 250 * 1024; // 250KB cap per icon
const SNAPSHOT_DIR = path.join('/data', 'snapshots'); // per-link extracted page text for full-text search
const SNAPSHOT_FETCH_MAX = 1024 * 1024; // 1MB cap on fetched HTML
const SNAPSHOT_TEXT_MAX = 40000; // store up to 40k chars of extracted text per link
const SNAPSHOT_PRUNE_GRACE_MS = 5 * 60 * 1000; // never GC a snapshot newer than this
const RSS_FETCH_MAX = 2 * 1024 * 1024; // 2MB cap on a fetched feed
const RSS_TTL = 15 * 60 * 1000; // serve cached feed for 15 min before refetching
const RSS_ITEMS_MAX = 30; // keep up to 30 items per feed

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

let writeQueue = Promise.resolve();
let configWriteQueue = Promise.resolve();

// Links write-conflict guard: bumped on every links write; GET hands it to the
// client, which echoes it back on POST. A mismatch means another device/tab
// saved in between → 409 instead of silently overwriting their change.
// In-memory only: a server restart mints a fresh value, which at worst costs
// each open client one spurious 409 + reload.
let linksVersion = Date.now();

async function readLinks() {
  try {
    const raw = await fsp.readFile(DATA_FILE, 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch (e) {
    if (e.code !== 'ENOENT') console.error('Failed to read links file:', e);
    return [];
  }
}

function isValidLink(l) {
  return l && typeof l === 'object'
    && typeof l.id === 'string' && l.id.length > 0
    && typeof l.url === 'string' && l.url.length > 0
    && typeof l.title === 'string';
}

async function writeLinks(links) {
  await fsp.mkdir(path.dirname(DATA_FILE), { recursive: true });
  const tmp = path.join(path.dirname(DATA_FILE), `.links-${Date.now()}.json`);
  await fsp.writeFile(tmp, JSON.stringify(links, null, 2), 'utf8');
  await fsp.rename(tmp, DATA_FILE);
}

async function readConfig() {
  try {
    const raw = await fsp.readFile(CONFIG_FILE, 'utf8');
    const data = JSON.parse(raw);
    return data && typeof data === 'object' ? data : {};
  } catch (e) {
    if (e.code !== 'ENOENT') console.error('Failed to read config file:', e);
    return {};
  }
}

async function writeConfig(cfg) {
  await fsp.mkdir(path.dirname(CONFIG_FILE), { recursive: true });
  const tmp = path.join(path.dirname(CONFIG_FILE), `.config-${Date.now()}.json`);
  await fsp.writeFile(tmp, JSON.stringify(cfg, null, 2), 'utf8');
  await fsp.rename(tmp, CONFIG_FILE);
}

// ============================================================================
// AUTH — single shared password gate. The HMAC secret + password hash live in
// /data/auth.json (separate from links/config, so they're NOT in backups). No
// new deps — built-in crypto only. The static shell (index.html/app.js/css) is
// public; every /api/* route registered BELOW the gate requires a valid signed
// session cookie once a password has been configured. Public share routes (a
// future phase) would be registered above the gate to stay exempt.
// ============================================================================
// NOTE: we deliberately do NOT `app.set('trust proxy', true)`. Trusting all
// proxies makes req.ip come from the client-controlled X-Forwarded-For header,
// which lets an attacker rotate it to bypass the login rate-limiter. Using the
// raw socket address keeps the limiter honest. The Secure-cookie check below
// reads the x-forwarded-proto header directly, so HTTPS detection still works
// behind a TLS-terminating proxy. (Behind a reverse proxy all clients share one
// rate-limit bucket — acceptable: it fails closed, not open.)

const AUTH_FILE = path.join('/data', 'auth.json');
const COOKIE_NAME = 'beacon_session';
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
let authState = { secret: null, passHash: null }; // cached in memory; loaded by initAuth()
let authError = false; // true if auth.json exists but couldn't be read/parsed → fail CLOSED

// Returns {} ONLY for a genuinely-absent file (first run). A file that exists but
// can't be read or parsed THROWS — so initAuth can fail closed instead of treating
// corruption as "no password set" (which would open the app and wipe the hash).
async function readAuth() {
  let raw;
  try {
    raw = await fsp.readFile(AUTH_FILE, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return {};
    throw e;
  }
  const data = JSON.parse(raw); // corrupt JSON throws → caller fails closed
  if (!data || typeof data !== 'object') throw new Error('auth.json is not an object');
  return data;
}
async function writeAuth(data) {
  await fsp.mkdir(path.dirname(AUTH_FILE), { recursive: true });
  const tmp = path.join(path.dirname(AUTH_FILE), `.auth-${Date.now()}.json`);
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  await fsp.rename(tmp, AUTH_FILE);
}
// Load (or first-time create) the HMAC secret, and cache the stored hash. If the
// existing file can't be read/parsed, set authError and DO NOT overwrite it — the
// gate then fails closed so a transient/corrupt read can't open the app or wipe
// the password.
async function initAuth() {
  let data;
  try {
    data = await readAuth();
  } catch (e) {
    authError = true;
    console.error('Auth file unreadable/corrupt — locking the app until it is fixed:', e);
    return;
  }
  if (!data.secret) {
    data.secret = crypto.randomBytes(32).toString('hex');
    data.createdAt = data.createdAt || new Date().toISOString();
    await writeAuth(data);
  }
  authState = { secret: data.secret, passHash: data.passHash || null };
}

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${crypto.scryptSync(pw, salt, 64).toString('hex')}`;
}
function verifyPassword(pw, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const expected = Buffer.from(hash, 'hex');
  let actual;
  try { actual = crypto.scryptSync(pw, salt, 64); } catch { return false; }
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}
function authConfigured() {
  return !!process.env.BEACON_PASSWORD || !!authState.passHash;
}
function checkPassword(pw) {
  if (typeof pw !== 'string' || !pw) return false;
  if (process.env.BEACON_PASSWORD) {
    const a = Buffer.from(pw), b = Buffer.from(process.env.BEACON_PASSWORD);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }
  return verifyPassword(pw, authState.passHash);
}

// Stateless signed session cookie: value = <expBase64url>.<HMAC(exp, secret)>.
function signToken(expMs) {
  const payload = Buffer.from(String(expMs)).toString('base64url');
  const sig = crypto.createHmac('sha256', authState.secret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}
function verifyToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.') || !authState.secret) return false;
  const [payload, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', authState.secret).update(payload).digest('base64url');
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  const expMs = parseInt(Buffer.from(payload, 'base64url').toString(), 10);
  return Number.isFinite(expMs) && expMs > Date.now();
}
function parseCookies(req) {
  const out = {};
  const header = req.headers.cookie;
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}
function isAuthed(req) { return verifyToken(parseCookies(req)[COOKIE_NAME]); }
function setSessionCookie(req, res) {
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  const attrs = [
    `${COOKIE_NAME}=${signToken(Date.now() + SESSION_MAX_AGE_MS)}`,
    'HttpOnly', 'SameSite=Strict', 'Path=/', `Max-Age=${Math.floor(SESSION_MAX_AGE_MS / 1000)}`,
  ];
  if (secure) attrs.push('Secure');
  res.setHeader('Set-Cookie', attrs.join('; '));
}
function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
}

// In-memory login rate limit (per IP): 10 attempts / 15 min.
const loginAttempts = new Map();
const LOGIN_MAX = 10, LOGIN_WINDOW_MS = 15 * 60 * 1000;
function rateLimited(req) {
  const ip = req.ip || 'unknown';
  const now = Date.now();
  // Bound memory: sweep expired buckets when the map grows. Login attempts are
  // rare, so the occasional O(n) pass is cheap.
  if (loginAttempts.size > 256) {
    for (const [k, v] of loginAttempts) if (v.resetAt < now) loginAttempts.delete(k);
  }
  let rec = loginAttempts.get(ip);
  if (!rec || rec.resetAt < now) { rec = { count: 0, resetAt: now + LOGIN_WINDOW_MS }; loginAttempts.set(ip, rec); }
  rec.count++;
  return rec.count > LOGIN_MAX;
}

// --- Auth endpoints (registered ABOVE the gate, so they stay reachable) -----
app.get('/api/me', (req, res) => {
  res.json({ authed: isAuthed(req), configured: authConfigured() });
});
app.post('/api/setup', async (req, res) => {
  if (authConfigured()) return res.status(409).json({ error: 'Password already set' });
  if (rateLimited(req)) return res.status(429).json({ error: 'Too many attempts — try again later' });
  const pw = req.body && req.body.password;
  if (typeof pw !== 'string' || pw.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  try {
    const data = await readAuth();
    if (!data.secret) data.secret = crypto.randomBytes(32).toString('hex');
    data.passHash = hashPassword(pw);
    data.createdAt = data.createdAt || new Date().toISOString();
    await writeAuth(data);
    authState = { secret: data.secret, passHash: data.passHash };
    setSessionCookie(req, res);
    res.json({ ok: true });
  } catch (e) {
    console.error('POST /api/setup error:', e);
    res.status(500).json({ error: 'Failed to set password' });
  }
});
app.post('/api/login', (req, res) => {
  if (!authConfigured()) return res.status(400).json({ error: 'No password set' });
  if (rateLimited(req)) return res.status(429).json({ error: 'Too many attempts — try again later' });
  if (!checkPassword(req.body && req.body.password)) return res.status(401).json({ error: 'Incorrect password' });
  setSessionCookie(req, res);
  res.json({ ok: true });
});
app.post('/api/logout', (req, res) => { clearSessionCookie(res); res.json({ ok: true }); });

// --- The gate: every /api/* route below requires auth once configured -------
app.use((req, res, next) => {
  if (!req.path.startsWith('/api/')) return next();
  if (authError) return res.status(503).json({ error: 'Auth unavailable — check the server auth file' });
  if (!authConfigured()) return next();   // open until a password is set
  if (isAuthed(req)) return next();
  res.status(401).json({ error: 'Authentication required' });
});

app.get('/api/links', async (req, res) => {
  try {
    const links = await readLinks();
    res.set('X-Links-Version', String(linksVersion));
    res.json(links);
  } catch (e) {
    console.error('GET /api/links error:', e);
    res.status(500).json({ error: 'Failed to read links' });
  }
});

app.post('/api/links', (req, res) => {
  const links = req.body;
  if (!Array.isArray(links)) return res.status(400).json({ error: 'Expected an array' });
  const invalid = links.find(l => !isValidLink(l));
  if (invalid) return res.status(400).json({ error: 'Invalid link object in array' });
  const clientVersion = req.get('X-Links-Version'); // absent from pre-1.0.27 clients → accept (legacy)

  // The version check and the write run INSIDE the queue so check-and-write is
  // atomic — two concurrent saves can't both pass the check and both write.
  writeQueue = writeQueue.then(async () => {
    if (clientVersion !== undefined && clientVersion !== String(linksVersion)) {
      res.status(409).json({ error: 'Links changed on another device', version: linksVersion });
      return;
    }
    await writeLinks(links);
    linksVersion = Math.max(linksVersion + 1, Date.now());
    res.set('X-Links-Version', String(linksVersion));
    res.json({ ok: true });
    // Best-effort GC of orphaned snapshots. Most saves (favorite toggle,
    // reorder, edit) delete no links, so only scan the snapshot dir when an
    // indexed snapshot is actually missing from the saved set.
    const validIds = new Set(links.map(l => safeId(l.id)));
    let orphaned = false;
    for (const id of contentIndex.keys()) { if (!validIds.has(id)) { orphaned = true; break; } }
    if (orphaned) pruneSnapshots(validIds);
  }).catch(e => {
    console.error('Write failed:', e);
    if (!res.headersSent) res.status(500).json({ error: 'Failed to save links' });
  });
});

app.get('/api/config', async (req, res) => {
  try {
    res.json(await readConfig());
  } catch (e) {
    console.error('GET /api/config error:', e);
    res.status(500).json({ error: 'Failed to read config' });
  }
});

app.post('/api/config', (req, res) => {
  const cfg = req.body;
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) {
    return res.status(400).json({ error: 'Expected an object' });
  }

  syncAllowedFeeds(cfg);
  const writePromise = writeConfig(cfg);
  configWriteQueue = configWriteQueue.then(() => writePromise).catch(() => {});

  writePromise
    .then(() => res.json({ ok: true }))
    .catch(e => {
      console.error('POST /api/config error:', e);
      res.status(500).json({ error: 'Failed to save config' });
    });
});

app.get('/api/backup', async (req, res) => {
  try {
    const [links, config] = await Promise.all([readLinks(), readConfig()]);
    const backup = {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      links,
      config
    };
    const date = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Disposition', `attachment; filename="msp-beacon-backup-${date}.json"`);
    res.setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify(backup, null, 2));
  } catch (e) {
    console.error('GET /api/backup error:', e);
    res.status(500).json({ error: 'Failed to create backup' });
  }
});

app.post('/api/restore', express.json({ limit: '10mb' }), async (req, res) => {
  const backup = req.body;
  if (!backup || typeof backup !== 'object' || !Array.isArray(backup.links)) {
    return res.status(400).json({ error: 'Invalid backup file' });
  }
  const invalid = backup.links.find(l => !isValidLink(l));
  if (invalid) return res.status(400).json({ error: 'Invalid link object in backup' });

  try {
    await Promise.all([
      writeLinks(backup.links),
      backup.config && typeof backup.config === 'object' ? writeConfig(backup.config) : Promise.resolve()
    ]);
    res.json({ ok: true });
  } catch (e) {
    console.error('POST /api/restore error:', e);
    res.status(500).json({ error: 'Failed to restore backup' });
  }
});

// --- Automatic backups ---------------------------------------------------------
// A rotating server-side snapshot of links.json + config.json (same JSON shape
// as GET /api/backup, so any file in /data/backups can be uploaded through the
// normal Restore flow). Runs every BACKUP_HOURS hours (default 24, 0 disables),
// first pass shortly after boot; skipped when neither data file changed since
// the newest backup, so restarts don't churn copies. Rotation (per Anthony):
// once BACKUP_PRUNE_AT copies exist, prune down to the BACKUP_KEEP newest —
// the folder always holds between 2 and 4 backups. auth.json is deliberately
// NOT included (matches the manual backup).
const BACKUP_DIR = path.join('/data', 'backups');
const BACKUP_HOURS = (() => {
  const v = parseFloat(process.env.BACKUP_HOURS);
  return Number.isFinite(v) && v >= 0 ? v : 24;
})();
const BACKUP_PRUNE_AT = 4, BACKUP_KEEP = 2;

// Filename timestamps are ISO with ':'/'.' swapped for '-', so a plain sort is
// chronological.
async function listAutoBackups() {
  try {
    return (await fsp.readdir(BACKUP_DIR)).filter(n => /^auto-backup-.*\.json$/.test(n)).sort();
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
}

async function runAutoBackup() {
  try {
    const files = await listAutoBackups();
    const newest = files[files.length - 1];
    if (newest) {
      const backupTime = (await fsp.stat(path.join(BACKUP_DIR, newest))).mtimeMs;
      let changed = false;
      for (const f of [DATA_FILE, CONFIG_FILE]) {
        try { if ((await fsp.stat(f)).mtimeMs > backupTime) { changed = true; break; } } catch { /* missing file = nothing to back up */ }
      }
      if (!changed) { console.log(`Auto-backup: no changes since ${newest} — skipped`); return; }
    }
    const [links, config] = await Promise.all([readLinks(), readConfig()]);
    const backup = { version: '1.0', exportedAt: new Date().toISOString(), links, config };
    await fsp.mkdir(BACKUP_DIR, { recursive: true });
    const name = `auto-backup-${backup.exportedAt.replace(/[:.]/g, '-')}.json`;
    const tmp = path.join(BACKUP_DIR, `.backup-${Date.now()}.json`);
    await fsp.writeFile(tmp, JSON.stringify(backup, null, 2), 'utf8');
    await fsp.rename(tmp, path.join(BACKUP_DIR, name));
    console.log(`Auto-backup written: ${name} (${links.length} links)`);
    const after = await listAutoBackups();
    if (after.length >= BACKUP_PRUNE_AT) {
      const prune = after.slice(0, after.length - BACKUP_KEEP);
      for (const old of prune) await fsp.unlink(path.join(BACKUP_DIR, old));
      console.log(`Auto-backup: reached ${after.length} copies — pruned ${prune.length}, kept ${BACKUP_KEEP}`);
    }
  } catch (e) {
    console.error('Auto-backup failed:', e);
  }
}

app.get('/api/fetch-title', async (req, res) => {
  const rawUrl = req.query.url;
  if (!rawUrl) return res.json({ title: '' });

  async function fetchTitle(urlStr, hopsLeft) {
    const parsed = parseHttpUrl(urlStr);
    if (!parsed) return res.json({ title: '' });

    // SSRF protection: resolve hostname and block private/internal IPs
    // (untrusted tier — see outbound-fetch policy up top).
    try {
      const { address } = await dns.lookup(parsed.hostname);
      if (isPrivateIP(address)) return res.json({ title: '' });
    } catch { return res.json({ title: '' }); }

    const mod = parsed.protocol === 'https:' ? https : http;
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'GET',
      timeout: 5000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; MSP-Beacon/1.0)',
        'Accept': 'text/html',
      }
    };

    const request = mod.request(options, (incoming) => {
      const sc = incoming.statusCode;
      if ((sc === 301 || sc === 302 || sc === 303 || sc === 307 || sc === 308) && incoming.headers.location && hopsLeft > 0) {
        incoming.resume();
        let next;
        try { next = new URL(incoming.headers.location, urlStr).toString(); } catch { return res.json({ title: '' }); }
        return fetchTitle(next, hopsLeft - 1);
      }
      if (sc < 200 || sc >= 300) { incoming.resume(); return res.json({ title: '' }); }

      let buf = '';
      let done = false;
      incoming.setEncoding('utf8');

      incoming.on('data', (chunk) => {
        if (done) return;
        buf += chunk;
        if (buf.length > 50000) {
          done = true;
          incoming.destroy();
          sendTitle();
        }
      });

      incoming.on('end', () => { if (!done) sendTitle(); });
      incoming.on('error', () => { if (!res.headersSent) sendTitle(); });

      function sendTitle() {
        if (res.headersSent) return;
        // Try <title> first
        const titleMatch = buf.match(/<title[^>]*>([^<]*)<\/title>/i);
        const titleText = titleMatch ? decodeHtmlEntities(titleMatch[1]).trim() : '';
        if (titleText) return res.json({ title: titleText });
        // Fall back to og:title
        const ogMatch = buf.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
          || buf.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i);
        if (ogMatch) return res.json({ title: decodeHtmlEntities(ogMatch[1]).trim() });
        // Fall back to meta name="title"
        const metaMatch = buf.match(/<meta[^>]+name=["']title["'][^>]+content=["']([^"']+)["']/i)
          || buf.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']title["']/i);
        if (metaMatch) return res.json({ title: decodeHtmlEntities(metaMatch[1]).trim() });
        res.json({ title: '' });
      }
    });

    request.on('timeout', () => { request.destroy(); });
    request.on('error', () => { if (!res.headersSent) res.json({ title: '' }); });
    request.end();
  }

  try {
    await fetchTitle(rawUrl, 3);
  } catch { if (!res.headersSent) res.json({ title: '' }); }
});

// --- Favicon proxy + cache ---------------------------------------------------
// Fetches each site's real favicon server-side and caches it under /data/favicons
// so icons stay local (no third-party calls) and work for internal/homelab hosts.
// Trusted, user-saved targets — see the outbound-fetch policy up top.

function sniffImageType(buf) {
  if (!buf || buf.length < 4) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return 'image/gif';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf[0] === 0x00 && buf[1] === 0x00 && buf[2] === 0x01 && buf[3] === 0x00) return 'image/x-icon';
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  const head = buf.toString('utf8', 0, Math.min(buf.length, 200)).trim().toLowerCase();
  if (head.startsWith('<?xml') || head.startsWith('<svg')) return 'image/svg+xml';
  return null;
}

// GET a URL into a Buffer, following redirects, with a byte cap. Resolves null on any failure.
function httpGetBuffer(urlStr, hopsLeft, maxBytes, accept) {
  return new Promise((resolve) => {
    const parsed = parseHttpUrl(urlStr);
    if (!parsed) return resolve(null);
    const mod = parsed.protocol === 'https:' ? https : http;
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'GET',
      timeout: 5000,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MSP-Beacon/1.0)', 'Accept': accept || '*/*' }
    };
    const request = mod.request(options, (incoming) => {
      const sc = incoming.statusCode;
      if ((sc === 301 || sc === 302 || sc === 303 || sc === 307 || sc === 308) && incoming.headers.location && hopsLeft > 0) {
        incoming.resume();
        let next;
        try { next = new URL(incoming.headers.location, urlStr).toString(); } catch { return resolve(null); }
        return resolve(httpGetBuffer(next, hopsLeft - 1, maxBytes, accept));
      }
      if (sc < 200 || sc >= 300) { incoming.resume(); return resolve(null); }
      const chunks = [];
      let len = 0, done = false;
      incoming.on('data', (c) => {
        if (done) return;
        chunks.push(c);
        len += c.length;
        if (len > maxBytes) { done = true; incoming.destroy(); resolve(null); }
      });
      incoming.on('end', () => { if (!done) resolve({ buf: Buffer.concat(chunks), contentType: incoming.headers['content-type'] || '' }); });
      incoming.on('error', () => { if (!done) resolve(null); });
    });
    request.on('timeout', () => { request.destroy(); });
    request.on('error', () => resolve(null));
    request.end();
  });
}

// Parse the page HTML for the best <link rel="icon"> href; fall back to /favicon.ico
async function resolveFaviconUrl(pageUrl) {
  const origin = new URL(pageUrl).origin;
  const page = await httpGetBuffer(pageUrl, 3, 200 * 1024, 'text/html');
  if (page && /text\/html/i.test(page.contentType)) {
    const html = page.buf.toString('utf8');
    const candidates = [];
    const linkRe = /<link\b[^>]*>/gi;
    let m;
    while ((m = linkRe.exec(html))) {
      const tag = m[0];
      if (!/rel=["'][^"']*icon[^"']*["']/i.test(tag)) continue;
      const href = tag.match(/href=["']([^"']+)["']/i);
      if (!href) continue;
      let score = 1;
      const sizes = tag.match(/sizes=["']([^"']+)["']/i);
      if (sizes) { const n = parseInt(sizes[1], 10); if (!isNaN(n)) score = n; }
      if (/apple-touch-icon/i.test(tag)) score = Math.max(score, 120);
      candidates.push({ href: href[1], score });
    }
    candidates.sort((a, b) => b.score - a.score);
    if (candidates.length) {
      try { return new URL(candidates[0].href, pageUrl).toString(); } catch { /* fall through */ }
    }
  }
  return origin + '/favicon.ico';
}

// Dedupe concurrent fetches for the same host (many cards load at once on first render)
const faviconInflight = new Map();
function fetchFaviconBuffer(rawUrl, hostname) {
  if (faviconInflight.has(hostname)) return faviconInflight.get(hostname);
  const p = (async () => {
    const iconUrl = await resolveFaviconUrl(rawUrl);
    let icon = await httpGetBuffer(iconUrl, 3, FAVICON_MAX, 'image/*');
    let type = icon && sniffImageType(icon.buf);
    if (!type) {
      const origin = new URL(rawUrl).origin;
      icon = await httpGetBuffer(origin + '/favicon.ico', 3, FAVICON_MAX, 'image/*');
      type = icon && sniffImageType(icon.buf);
    }
    return type ? { buf: icon.buf, type } : null;
  })().catch(() => null).finally(() => faviconInflight.delete(hostname));
  faviconInflight.set(hostname, p);
  return p;
}

app.get('/api/favicon', async (req, res) => {
  const rawUrl = req.query.url;
  let hostname;
  try { hostname = new URL(rawUrl).hostname; } catch { return res.status(400).end(); }
  if (!hostname) return res.status(400).end();

  const hash = crypto.createHash('sha1').update(hostname).digest('hex');
  const cachePath = path.join(FAVICON_DIR, hash);
  const nonePath = path.join(FAVICON_DIR, hash + '.none');
  const fresh = (st) => (Date.now() - st.mtimeMs) < FAVICON_TTL;

  try {
    await fsp.mkdir(FAVICON_DIR, { recursive: true });

    // Serve cached icon if fresh
    try {
      const st = await fsp.stat(cachePath);
      if (fresh(st)) {
        const buf = await fsp.readFile(cachePath);
        res.setHeader('Content-Type', sniffImageType(buf) || 'application/octet-stream');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        return res.end(buf);
      }
    } catch { /* not cached */ }

    // Negative cache: site had no usable favicon recently — don't hammer it
    try {
      const st = await fsp.stat(nonePath);
      if (fresh(st)) { res.setHeader('Cache-Control', 'public, max-age=3600'); return res.status(404).end(); }
    } catch { /* no negative marker */ }

    // Fetch, cache, serve
    const result = await fetchFaviconBuffer(rawUrl, hostname);
    if (result) {
      const tmp = path.join(FAVICON_DIR, `.${hash}-${Date.now()}`);
      await fsp.writeFile(tmp, result.buf);
      await fsp.rename(tmp, cachePath);
      try { await fsp.unlink(nonePath); } catch { /* none */ }
      res.setHeader('Content-Type', result.type);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return res.end(result.buf);
    }

    try { await fsp.writeFile(nonePath, ''); } catch { /* ignore */ }
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.status(404).end();
  } catch (e) {
    console.error('GET /api/favicon error:', e);
    return res.status(404).end();
  }
});

// Homepage background image — a single file under /data, kept local (no
// third-party), like favicons. Upload is validated by magic bytes and served
// with the sniffed content-type.
app.post('/api/wallpaper', express.raw({ type: '*/*', limit: '8mb' }), async (req, res) => {
  if (!sniffImageType(req.body)) return res.status(400).json({ error: 'not an image' });
  try {
    await fsp.mkdir(path.dirname(WALLPAPER_FILE), { recursive: true });
    const tmp = `${WALLPAPER_FILE}.tmp-${Date.now()}`;
    await fsp.writeFile(tmp, req.body);
    await fsp.rename(tmp, WALLPAPER_FILE);
    res.json({ ok: true });
  } catch (e) {
    console.error('POST /api/wallpaper error:', e);
    res.status(500).json({ error: 'save failed' });
  }
});

app.get('/api/wallpaper', async (req, res) => {
  try {
    const buf = await fsp.readFile(WALLPAPER_FILE);
    res.setHeader('Content-Type', sniffImageType(buf) || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.end(buf);
  } catch { res.status(404).end(); }
});

app.delete('/api/wallpaper', async (req, res) => {
  try { await fsp.unlink(WALLPAPER_FILE); } catch { /* already gone */ }
  res.json({ ok: true });
});

// Reachability-check the given links (HEAD, GET fallback on 405), 10 at a time.
// Returns { id: 'ok' | 'broken' | 'timeout' }. Used by the on-demand
// /api/check-links endpoint and the automatic background sweep.
async function checkLinkTargets(targets) {
  async function checkOne(link) {
    const parsed = parseHttpUrl(link.url);
    if (!parsed) return [link.id, 'broken'];
    const mod = parsed.protocol === 'https:' ? https : http;
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'HEAD',
      timeout: 5000,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MSP-Beacon/1.0)' }
    };

    async function attempt(method) {
      return new Promise((resolve) => {
        const opts = { ...options, method };
        const req = mod.request(opts, (incoming) => {
          incoming.resume();
          const sc = incoming.statusCode;
          if (method === 'HEAD' && sc === 405) {
            resolve('retry-get');
          } else if (sc >= 200 && sc < 400) {
            resolve('ok');
          } else {
            resolve('broken');
          }
        });
        req.on('timeout', () => { req.destroy(); resolve('timeout'); });
        req.on('error', () => resolve('broken'));
        req.end();
      });
    }

    const result = await attempt('HEAD');
    if (result === 'retry-get') return [link.id, await attempt('GET')];
    return [link.id, result];
  }

  const results = {};
  const CONCURRENCY = 10;
  for (let i = 0; i < targets.length; i += CONCURRENCY) {
    const batch = targets.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(batch.map(checkOne));
    batchResults.forEach(([id, status]) => { results[id] = status; });
  }
  return results;
}

// --- Automatic link health checks --------------------------------------------
// A background sweep re-checks every active link every HEALTH_CHECK_HOURS hours
// (default 6, 0 disables) so status dots / is:broken / Stats are fresh without
// anyone pressing "Check links". Results live in an in-memory cache served by
// GET /api/link-health and persist to /data/health.json across restarts.
// Manual /api/check-links results merge into the same cache.
const HEALTH_FILE = path.join('/data', 'health.json');
const HEALTH_CHECK_HOURS = (() => {
  const v = parseFloat(process.env.HEALTH_CHECK_HOURS);
  return Number.isFinite(v) && v >= 0 ? v : 6;
})();
let healthCache = { statuses: {}, checkedAt: 0 };
let healthWriteQueue = Promise.resolve();
let healthSweepRunning = false;

async function loadHealthCache() {
  try {
    const data = JSON.parse(await fsp.readFile(HEALTH_FILE, 'utf8'));
    if (data && data.statuses && typeof data.statuses === 'object') {
      healthCache = { statuses: data.statuses, checkedAt: data.checkedAt || 0 };
      console.log(`Health cache loaded: ${Object.keys(healthCache.statuses).length} status(es)`);
    }
  } catch (e) {
    if (e.code !== 'ENOENT') console.error('Failed to read health cache:', e);
  }
}
function persistHealthCache() {
  healthWriteQueue = healthWriteQueue.then(async () => {
    await fsp.mkdir(path.dirname(HEALTH_FILE), { recursive: true });
    const tmp = path.join(path.dirname(HEALTH_FILE), `.health-${Date.now()}.json`);
    await fsp.writeFile(tmp, JSON.stringify(healthCache), 'utf8');
    await fsp.rename(tmp, HEALTH_FILE);
  }).catch(e => console.error('Failed to write health cache:', e));
}
function mergeHealthResults(results) {
  Object.assign(healthCache.statuses, results);
  healthCache.checkedAt = Date.now();
  persistHealthCache();
}
async function sweepLinkHealth() {
  if (healthSweepRunning) return;
  healthSweepRunning = true;
  try {
    const all = await readLinks();
    const targets = all.filter(l => !l.archived && !l.deleted && /^https?:\/\//i.test(l.url));
    // Drop statuses for links that no longer exist (or got archived/trashed).
    const valid = new Set(targets.map(l => l.id));
    for (const id of Object.keys(healthCache.statuses)) if (!valid.has(id)) delete healthCache.statuses[id];
    const results = await checkLinkTargets(targets);
    mergeHealthResults(results);
    const issues = Object.values(results).filter(s => s !== 'ok').length;
    console.log(`Health sweep: ${targets.length} link(s) checked, ${issues} with issues`);
  } catch (e) {
    console.error('Health sweep failed:', e);
  } finally {
    healthSweepRunning = false;
  }
}

app.get('/api/link-health', (req, res) => {
  res.json(healthCache);
});

app.get('/api/check-links', async (req, res) => {
  try {
    const all = await readLinks();
    let targets = all;
    if (req.query.ids) {
      const ids = new Set(req.query.ids.split(',').map(s => s.trim()).filter(Boolean));
      targets = all.filter(l => ids.has(l.id));
    }
    const results = await checkLinkTargets(targets);
    mergeHealthResults(results);
    res.json(results);
  } catch (e) {
    console.error('GET /api/check-links error:', e);
    res.status(500).json({ error: 'Failed to check links' });
  }
});

// --- RSS / Atom feed widget --------------------------------------------------
// Fetch user-chosen feeds, parse RSS 2.0 / Atom with Node built-ins (no deps),
// and cache parsed items in memory with a TTL. The feed list itself lives in
// config.json (rssFeeds), so it persists through the existing /api/config route.
// Feeds are allowlisted + trusted — see the outbound-fetch policy up top.

const feedCache = new Map(); // url -> { title, items, fetchedAt, error }
const feedInFlight = new Map(); // url -> Promise (dedupe concurrent fetches)
const allowedFeedUrls = new Set(); // only fetch feeds the user has actually saved

// Rebuild the fetch allowlist from a config blob and evict any cached feed that
// is no longer configured — this keeps /api/rss from being an open fetch proxy
// and bounds feedCache to the user's configured feeds.
function syncAllowedFeeds(cfg) {
  allowedFeedUrls.clear();
  const feeds = cfg && Array.isArray(cfg.rssFeeds) ? cfg.rssFeeds : [];
  for (const f of feeds) {
    if (f && typeof f.url === 'string') allowedFeedUrls.add(f.url.trim());
  }
  for (const url of feedCache.keys()) {
    if (!allowedFeedUrls.has(url)) feedCache.delete(url);
  }
}
async function loadAllowedFeeds() {
  syncAllowedFeeds(await readConfig());
}

// Pull the first capture of any of the given tag names out of an XML fragment.
function xmlTag(fragment, ...names) {
  for (const name of names) {
    const m = fragment.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i'));
    if (m) return m[1];
  }
  return '';
}

function stripCdata(s) {
  const m = String(s).match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
  return m ? m[1] : String(s);
}

function cleanText(s) {
  return decodeHtmlEntities(stripCdata(s).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

// Atom links carry the URL in an href attribute; prefer rel="alternate"/no rel.
function atomLink(fragment) {
  const links = fragment.match(/<link\b[^>]*>/gi) || [];
  let fallback = '';
  for (const tag of links) {
    const rel = (tag.match(/rel=["']([^"']+)["']/i) || [])[1] || 'alternate';
    const href = (tag.match(/href=["']([^"']+)["']/i) || [])[1];
    if (!href) continue;
    if (rel === 'alternate') return href;
    if (!fallback) fallback = href;
  }
  return fallback;
}

function parseFeed(xml) {
  const s = String(xml);
  const items = [];
  // RSS <item> ... </item> or Atom <entry> ... </entry>
  const blockRe = /<(item|entry)\b[\s\S]*?<\/\1>/gi;
  let m;
  while ((m = blockRe.exec(s)) && items.length < RSS_ITEMS_MAX) {
    const block = m[0];
    const isAtom = m[1].toLowerCase() === 'entry';
    const title = cleanText(xmlTag(block, 'title')) || '(untitled)';
    let link = isAtom ? atomLink(block) : cleanText(xmlTag(block, 'link'));
    if (!link) link = cleanText(xmlTag(block, 'guid')); // some feeds only carry a guid URL
    const dateStr = cleanText(xmlTag(block, 'pubDate', 'published', 'updated', 'dc:date'));
    const ts = dateStr ? Date.parse(dateStr) : NaN;
    if (link && /^https?:\/\//i.test(link)) {
      items.push({ title, link, ts: isNaN(ts) ? null : ts });
    }
  }
  // Feed title sits before the first item/entry.
  const head = s.slice(0, m ? s.indexOf(m[0]) : s.length);
  const feedTitle = cleanText(xmlTag(head, 'title')) || '';
  return { title: feedTitle, items };
}

async function fetchFeed(url) {
  const page = await httpGetBuffer(url, 3, RSS_FETCH_MAX, 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*');
  if (!page) throw new Error('fetch failed');
  return parseFeed(page.buf.toString('utf8'));
}

async function getFeed(url) {
  const cached = feedCache.get(url);
  if (cached && Date.now() - cached.fetchedAt < RSS_TTL) return cached;
  if (feedInFlight.has(url)) return feedInFlight.get(url);
  const p = (async () => {
    try {
      const { title, items } = await fetchFeed(url);
      const entry = { title, items, fetchedAt: Date.now(), error: null };
      feedCache.set(url, entry);
      return entry;
    } catch (e) {
      // On failure, keep serving the last good copy if we have one — but bump
      // its timestamp so a flapping feed honors the same RSS_TTL backoff as a
      // fresh failure, instead of being refetched on every single request.
      if (cached) { cached.fetchedAt = Date.now(); return cached; }
      const entry = { title: '', items: [], fetchedAt: Date.now(), error: 'unreachable' };
      feedCache.set(url, entry);
      return entry;
    } finally {
      feedInFlight.delete(url);
    }
  })();
  feedInFlight.set(url, p);
  return p;
}

app.get('/api/rss', async (req, res) => {
  const url = String(req.query.url || '').trim();
  if (!parseHttpUrl(url)) return res.status(400).json({ error: 'invalid url' });
  if (!allowedFeedUrls.has(url)) return res.status(403).json({ error: 'feed not configured' });
  const feed = await getFeed(url);
  res.json({ url, title: feed.title, items: feed.items, error: feed.error });
});

// --- Full-text content search ------------------------------------------------
// On demand, fetch a saved link's page, extract readable text, and cache it under
// /data/snapshots/<id>.txt. An in-memory index (id -> lowercased text) backs the
// search endpoint. Trusted, user-saved targets — see the outbound-fetch policy
// up top.

const contentIndex = new Map(); // id -> lowercased extracted text

function safeId(id) { return String(id || '').replace(/[^a-z0-9]/gi, '').slice(0, 64); }

// Shared HTML-entity decoder: used by extractText (snapshots) and the
// /api/fetch-title route (hoisted, so the earlier route can call it).
function decodeHtmlEntities(str) {
  return str
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCharCode(Number(n)); } catch { return ' '; } })
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => { try { return String.fromCharCode(parseInt(h, 16)); } catch { return ' '; } });
}

function extractText(html) {
  let s = String(html);
  s = s.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ');
  s = s.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ');
  s = s.replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ');
  s = s.replace(/<!--[\s\S]*?-->/g, ' ');
  s = s.replace(/<[^>]+>/g, ' ');
  s = decodeHtmlEntities(s);
  s = s.replace(/\s+/g, ' ').trim();
  return s.slice(0, SNAPSHOT_TEXT_MAX);
}

async function loadContentIndex() {
  try {
    await fsp.mkdir(SNAPSHOT_DIR, { recursive: true });
    const files = await fsp.readdir(SNAPSHOT_DIR);
    for (const f of files) {
      if (!f.endsWith('.txt')) continue;
      try {
        const text = await fsp.readFile(path.join(SNAPSHOT_DIR, f), 'utf8');
        contentIndex.set(f.slice(0, -4), text.toLowerCase());
      } catch { /* skip unreadable */ }
    }
    console.log(`Content index loaded: ${contentIndex.size} snapshot(s)`);
  } catch (e) {
    console.error('Failed to load content index:', e);
  }
}

// Remove snapshots (and index entries) for links that no longer exist.
// validIds comes from whatever links array the client just saved, which may be
// stale (a second device with out-of-date state). To avoid that stale save
// deleting a snapshot another device just captured, skip any snapshot file
// younger than SNAPSHOT_PRUNE_GRACE_MS — a genuine orphan (deleted link) is
// reclaimed on a later save once it ages past the grace window.
async function pruneSnapshots(validIds) {
  try {
    const files = await fsp.readdir(SNAPSHOT_DIR);
    for (const f of files) {
      if (!f.endsWith('.txt')) continue;
      const id = f.slice(0, -4);
      if (validIds.has(id)) continue;
      const full = path.join(SNAPSHOT_DIR, f);
      try {
        const st = await fsp.stat(full);
        if (Date.now() - st.mtimeMs < SNAPSHOT_PRUNE_GRACE_MS) continue;
      } catch { continue; }
      await fsp.unlink(full).catch(() => {});
      contentIndex.delete(id);
    }
  } catch { /* dir may not exist yet */ }
}

app.post('/api/snapshot', async (req, res) => {
  const id = safeId(req.body && req.body.id);
  const url = req.body && req.body.url;
  if (!id || !url) return res.status(400).json({ error: 'id and url required' });
  if (!parseHttpUrl(url)) return res.json({ ok: false, length: 0 });
  try {
    const page = await httpGetBuffer(url, 3, SNAPSHOT_FETCH_MAX, 'text/html');
    if (!page || !/text\/html/i.test(page.contentType)) return res.json({ ok: false, length: 0 });
    const text = extractText(page.buf.toString('utf8'));
    await fsp.mkdir(SNAPSHOT_DIR, { recursive: true });
    // Temp suffix must NOT be .txt — loadContentIndex/pruneSnapshots scan *.txt,
    // so a .txt temp would be indexed as a bogus entry or unlinked mid-write.
    const tmp = path.join(SNAPSHOT_DIR, `.${id}-${Date.now()}.tmp`);
    await fsp.writeFile(tmp, text, 'utf8');
    await fsp.rename(tmp, path.join(SNAPSHOT_DIR, id + '.txt'));
    contentIndex.set(id, text.toLowerCase());
    res.json({ ok: true, length: text.length });
  } catch (e) {
    console.error('POST /api/snapshot error:', e);
    res.status(500).json({ error: 'snapshot failed' });
  }
});

app.get('/api/search-content', (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  if (q.length < 2) return res.json({ ids: [] });
  const ids = [];
  for (const [id, text] of contentIndex) {
    if (text.includes(q)) ids.push(id);
  }
  res.json({ ids });
});

app.get('/api/content-status', (req, res) => {
  res.json({ indexed: [...contentIndex.keys()] });
});

// Load the content index and RSS allowlist before accepting requests, so the
// first request after a restart doesn't hit an empty allowlist (403s on valid
// feeds) or an empty search index. Both helpers swallow their own errors, so
// the server still starts if a load fails.
Promise.all([loadContentIndex(), loadAllowedFeeds(), initAuth(), loadHealthCache()]).finally(() => {
  app.listen(PORT, () => {
    console.log(`MSP Beacon running on http://0.0.0.0:${PORT}`);
    console.log(`Data file: ${DATA_FILE}`);
    console.log(`Config file: ${CONFIG_FILE}`);
    console.log(`Auth: ${authError ? 'LOCKED — auth file unreadable, fix /data/auth.json' : authConfigured() ? 'password set' : 'OPEN — no password set yet'}`);
    if (HEALTH_CHECK_HOURS > 0) {
      // First sweep shortly after boot (let the container settle), then steady.
      setTimeout(sweepLinkHealth, 2 * 60 * 1000);
      setInterval(sweepLinkHealth, HEALTH_CHECK_HOURS * 60 * 60 * 1000);
      console.log(`Link health: automatic sweep every ${HEALTH_CHECK_HOURS}h`);
    } else {
      console.log('Link health: automatic sweep disabled (HEALTH_CHECK_HOURS=0)');
    }
    if (BACKUP_HOURS > 0) {
      setTimeout(runAutoBackup, 3 * 60 * 1000);
      setInterval(runAutoBackup, BACKUP_HOURS * 60 * 60 * 1000);
      console.log(`Auto-backup: every ${BACKUP_HOURS}h to ${BACKUP_DIR} (prune to ${BACKUP_KEEP} at ${BACKUP_PRUNE_AT})`);
    } else {
      console.log('Auto-backup: disabled (BACKUP_HOURS=0)');
    }
  });
});
