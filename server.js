const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join('/data', 'links.json');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function readLinks() {
  if (!fs.existsSync(DATA_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch { return []; }
}

function writeLinks(links) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(links, null, 2), 'utf8');
}

app.get('/api/links', (req, res) => {
  res.json(readLinks());
});

app.post('/api/links', (req, res) => {
  const links = req.body;
  if (!Array.isArray(links)) return res.status(400).json({ error: 'Expected an array' });
  writeLinks(links);
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`MSP Beacon running on http://0.0.0.0:${PORT}`);
  console.log(`Data file: ${DATA_FILE}`);
});
