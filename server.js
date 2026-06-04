const express = require('express');
const fsp = require('fs').promises;
const path = require('path');
const http = require('http');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join('/data', 'links.json');

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

app.get('/api/fetch-title', (req, res) => {
  const rawUrl = req.query.url;
  if (!rawUrl) return res.json({ title: '' });

  function fetchTitle(urlStr, hopsLeft) {
    let parsed;
    try { parsed = new URL(urlStr); } catch { return res.json({ title: '' }); }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return res.json({ title: '' });

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

      incoming.on('end', () => {
        if (!done) sendTitle();
      });

      incoming.on('error', () => {
        if (!res.headersSent) sendTitle();
      });

      function sendTitle() {
        if (res.headersSent) return;
        const m = buf.match(/<title[^>]*>([^<]+)<\/title>/i);
        if (!m) return res.json({ title: '' });
        let title = m[1]
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .trim();
        res.json({ title });
      }
    });

    request.on('timeout', () => { request.destroy(); });
    request.on('error', () => { if (!res.headersSent) res.json({ title: '' }); });
    request.on('close', () => {});
    request.end();
  }

  fetchTitle(rawUrl, 3);
});

app.listen(PORT, () => {
  console.log(`MSP Beacon running on http://0.0.0.0:${PORT}`);
  console.log(`Data file: ${DATA_FILE}`);
});
