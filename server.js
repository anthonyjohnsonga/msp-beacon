const express = require('express');
const fsp = require('fs').promises;
const path = require('path');
const http = require('http');
const https = require('https');
const dns = require('dns').promises;
const net = require('net');

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

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join('/data', 'links.json');
const CONFIG_FILE = path.join('/data/config', 'config.json');

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

let writeQueue = Promise.resolve();

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

app.get('/api/links', async (req, res) => {
  try {
    res.json(await readLinks());
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

  const writePromise = writeLinks(links);
  writeQueue = writeQueue.then(() => writePromise).catch(() => {});

  writePromise
    .then(() => res.json({ ok: true }))
    .catch(e => {
      console.error('Write failed:', e);
      res.status(500).json({ error: 'Failed to save links' });
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

app.post('/api/config', async (req, res) => {
  const cfg = req.body;
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) {
    return res.status(400).json({ error: 'Expected an object' });
  }
  try {
    await writeConfig(cfg);
    res.json({ ok: true });
  } catch (e) {
    console.error('POST /api/config error:', e);
    res.status(500).json({ error: 'Failed to save config' });
  }
});

app.get('/api/fetch-title', async (req, res) => {
  const rawUrl = req.query.url;
  if (!rawUrl) return res.json({ title: '' });

  async function fetchTitle(urlStr, hopsLeft) {
    let parsed;
    try { parsed = new URL(urlStr); } catch { return res.json({ title: '' }); }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return res.json({ title: '' });

    // SSRF protection: resolve hostname and block private/internal IPs
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

      function decodeEntities(str) {
        return str
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&apos;/g, "'")
          .replace(/&#39;/g, "'")
          .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
          .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
          .trim();
      }
      function sendTitle() {
        if (res.headersSent) return;
        // Try <title> first
        const titleMatch = buf.match(/<title[^>]*>([^<]*)<\/title>/i);
        const titleText = titleMatch ? decodeEntities(titleMatch[1]) : '';
        if (titleText) return res.json({ title: titleText });
        // Fall back to og:title
        const ogMatch = buf.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
          || buf.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i);
        if (ogMatch) return res.json({ title: decodeEntities(ogMatch[1]) });
        // Fall back to meta name="title"
        const metaMatch = buf.match(/<meta[^>]+name=["']title["'][^>]+content=["']([^"']+)["']/i)
          || buf.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']title["']/i);
        if (metaMatch) return res.json({ title: decodeEntities(metaMatch[1]) });
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

app.get('/api/check-links', async (req, res) => {
  try {
    const all = await readLinks();
    let targets = all;
    if (req.query.ids) {
      const ids = new Set(req.query.ids.split(',').map(s => s.trim()).filter(Boolean));
      targets = all.filter(l => ids.has(l.id));
    }

    async function checkOne(link) {
      let parsed;
      try { parsed = new URL(link.url); } catch { return [link.id, 'broken']; }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return [link.id, 'broken'];
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

    res.json(results);
  } catch (e) {
    console.error('GET /api/check-links error:', e);
    res.status(500).json({ error: 'Failed to check links' });
  }
});

app.listen(PORT, () => {
  console.log(`MSP Beacon running on http://0.0.0.0:${PORT}`);
  console.log(`Data file: ${DATA_FILE}`);
  console.log(`Config file: ${CONFIG_FILE}`);
});
