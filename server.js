const express = require('express');
const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const os = require('os');

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
  const tmp = path.join(os.tmpdir(), `links-${Date.now()}.json`);
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

  writeQueue = writeQueue.then(() => writeLinks(links)).catch(e => {
    console.error('Write failed:', e);
  });

  writeQueue.then(() => res.json({ ok: true })).catch(() => {
    res.status(500).json({ error: 'Failed to save links' });
  });
});

app.listen(PORT, () => {
  console.log(`MSP Beacon running on http://0.0.0.0:${PORT}`);
  console.log(`Data file: ${DATA_FILE}`);
});
