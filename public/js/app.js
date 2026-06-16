
let links = [];
let linkStatus = {};
let editId = null;
let parsedBookmarks = [];
let saveTimer = null;
let collapsedFolders = new Set(JSON.parse(localStorage.getItem('msp-collapsed') || '[]'));
let collapsedSubfolders = JSON.parse(localStorage.getItem('msp-subfolder-collapsed') || '{}');
let folderOrder = JSON.parse(localStorage.getItem('msp-folder-order') || 'null');
let folderColors = JSON.parse(localStorage.getItem('msp-folder-colors') || '{}');
let subfolderColors = JSON.parse(localStorage.getItem('msp-subfolder-colors') || '{}');
let tagColors = JSON.parse(localStorage.getItem('msp-tag-colors') || '{}');
let folderIcons = JSON.parse(localStorage.getItem('msp-folder-icons') || '{}');
let rssFeeds = JSON.parse(localStorage.getItem('msp-rss-feeds') || '[]'); // [{url, name}]

// Homepage background. type: none|preset|url|upload; value = preset id / image URL
// / cache-bust token; dim 0-80 (% black scrim); blur 0-20 px.
const BG_PRESETS = {
  aurora: 'linear-gradient(135deg,#1e3c72,#2a5298)',
  dusk:   'linear-gradient(135deg,#355c7d,#6c5b7b,#c06c84)',
  ember:  'linear-gradient(135deg,#642b73,#c6426e)',
  forest: 'linear-gradient(135deg,#134e5e,#71b280)',
  slate:  'linear-gradient(135deg,#232526,#414345)',
  ocean:  'linear-gradient(135deg,#0f2027,#203a43,#2c5364)',
};
const clampNum = (n, lo, hi) => Math.max(lo, Math.min(hi, Number(n) || 0));
function normalizeHomeBg(v) {
  v = v && typeof v === 'object' ? v : {};
  const type = ['none', 'preset', 'url', 'upload'].includes(v.type) ? v.type : 'none';
  return { type, value: typeof v.value === 'string' ? v.value : '', dim: clampNum(v.dim, 0, 80), blur: clampNum(v.blur, 0, 20) };
}
let homeBg = normalizeHomeBg((() => { try { return JSON.parse(localStorage.getItem('msp-home-bg')); } catch { return null; } })());

function applyHomeBg() {
  const img = document.getElementById('homeBgImg'), scrim = document.getElementById('homeBgScrim');
  if (!img || !scrim) return;
  let bg = '';
  if (currentMode === 'home' && homeBg.type !== 'none') {
    if (homeBg.type === 'preset') bg = BG_PRESETS[homeBg.value] || '';
    else if (homeBg.type === 'url') bg = (homeBg.value && !/["\n\r]/.test(homeBg.value)) ? `url("${homeBg.value}")` : '';
    else if (homeBg.type === 'upload') bg = `url("/api/wallpaper?t=${encodeURIComponent(homeBg.value || '0')}")`;
  }
  if (!bg) { img.style.display = 'none'; scrim.style.display = 'none'; return; }
  img.style.backgroundImage = bg;
  img.style.filter = homeBg.blur ? `blur(${homeBg.blur}px)` : 'none';
  img.style.display = 'block';
  scrim.style.background = `rgba(0,0,0,${homeBg.dim / 100})`;
  scrim.style.display = 'block';
}
function persistHomeBg() {
  localStorage.setItem('msp-home-bg', JSON.stringify(homeBg));
  saveConfig();
  applyHomeBg();
}
function setBgType(t) {
  homeBg.type = t;
  if (t === 'preset' && !BG_PRESETS[homeBg.value]) homeBg.value = 'aurora';
  persistHomeBg();
  renderBgControls();
}
function setBgPreset(id) { homeBg.type = 'preset'; homeBg.value = id; persistHomeBg(); renderBgControls(); }
function setBgUrl(v) {
  v = (v || '').trim();
  if (v) {
    let ok = false;
    try { ok = /^https?:$/.test(new URL(v).protocol); } catch {}
    if (!ok && /^data:image\//i.test(v)) ok = true;
    if (!ok) { showToast('Enter an http(s) or image URL', true); return; }
  }
  homeBg.type = 'url'; homeBg.value = v; persistHomeBg(); renderBgControls();
}
function setBgDim(v) { homeBg.dim = clampNum(v, 0, 80); document.getElementById('bgDimVal').textContent = homeBg.dim + '%'; persistHomeBg(); }
function setBgBlur(v) { homeBg.blur = clampNum(v, 0, 20); document.getElementById('bgBlurVal').textContent = homeBg.blur + 'px'; persistHomeBg(); }
async function uploadWallpaper(file) {
  if (!file) return;
  if (file.size > 8 * 1024 * 1024) { showToast('Image too large (max 8MB)', true); return; }
  try {
    const res = await fetch('/api/wallpaper', { method: 'POST', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file });
    if (!res.ok) { showToast('Upload failed', true); return; }
    homeBg.type = 'upload'; homeBg.value = String(Date.now()); // cache-bust the served image
    persistHomeBg(); renderBgControls(); showToast('Background updated');
  } catch { showToast('Upload failed', true); }
}
function renderBgControls() {
  document.querySelectorAll('.mode-btn[data-bgsrc]').forEach(el => el.classList.toggle('active', el.dataset.bgsrc === homeBg.type));
  const presetWrap = document.getElementById('bgPresetWrap'), urlInput = document.getElementById('bgUrlInput'), adjust = document.getElementById('bgAdjust');
  presetWrap.style.display = homeBg.type === 'preset' ? '' : 'none';
  urlInput.style.display = homeBg.type === 'url' ? '' : 'none';
  adjust.style.display = homeBg.type !== 'none' ? '' : 'none';
  if (homeBg.type === 'preset') {
    presetWrap.querySelector('#bgPresetGrid').innerHTML = Object.entries(BG_PRESETS).map(([id, g]) =>
      `<div class="bg-preset${homeBg.value === id ? ' active' : ''}" style="background:${g}" title="${id}" onclick="setBgPreset('${id}')"></div>`).join('');
  }
  if (homeBg.type === 'url') urlInput.value = homeBg.value || '';
  document.getElementById('bgDim').value = homeBg.dim;
  document.getElementById('bgDimVal').textContent = homeBg.dim + '%';
  document.getElementById('bgBlur').value = homeBg.blur;
  document.getElementById('bgBlurVal').textContent = homeBg.blur + 'px';
}
let currentTheme = localStorage.getItem('msp-theme') || 'Green';
let customAccent = localStorage.getItem('msp-accent') || '#1D9E75';
let themeMode = localStorage.getItem('msp-mode') || 'dark';
let dragId = null;
let dragFolder = null;
let dragOverEl = null;
let homeDrag = null;
let selectMode = false;
let activeCardId = null;
let searchHistory = JSON.parse(localStorage.getItem('msp-search-history') || '[]');
let selectedIds = new Set();
let visibleIds = [];
let favoritesCollapsed = JSON.parse(localStorage.getItem('msp-fav-collapsed') || 'false');
let searchDebounceTimer = null;
function debouncedRender() { clearTimeout(searchDebounceTimer); searchDebounceTimer = setTimeout(render, 150); }
// Full-text content search: server holds per-link page-text snapshots; we merge
// content matches into the normal search results.
let contentMatchIds = new Set();   // link ids whose page text matches the current query
let contentMatchQuery = '';        // query that contentMatchIds corresponds to
let contentOnlyIds = new Set();    // matched via page text only (no title/url/tag hit) — for the badge
let contentSearchTimer = null;
let contentSearchToken = 0;        // guards against out-of-order /api/search-content responses
function onSearchInput(v) {
  debouncedRender();
  hideSearchHistory();
  clearTimeout(contentSearchTimer);
  contentSearchTimer = setTimeout(() => updateContentMatches(v), 300);
}
async function updateContentMatches(q) {
  const token = ++contentSearchToken; // any newer call (incl. a clear) supersedes us
  q = (q || '').trim().toLowerCase();
  if (q.length < 2) { contentMatchIds = new Set(); contentMatchQuery = ''; render(); return; }
  try {
    const res = await fetch('/api/search-content?q=' + encodeURIComponent(q));
    if (!res.ok) return;
    const data = await res.json();
    if (token !== contentSearchToken) return; // a newer query/clear superseded us
    contentMatchIds = new Set(data.ids || []);
    contentMatchQuery = q;
    render();
  } catch { /* offline / no index — silently fall back to title/url search */ }
}
function captureSnapshot(id, url) {
  if (!/^https?:\/\//i.test(url || '')) return;
  fetch('/api/snapshot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, url }) }).catch(() => {});
}
async function indexAllContent() {
  closeSettings();
  const btn = document.getElementById('indexContentBtn');
  if (btn && btn.disabled) return;
  let indexed = new Set();
  try {
    const res = await fetch('/api/content-status');
    if (res.ok) indexed = new Set((await res.json()).indexed || []);
  } catch {}
  const targets = links.filter(l => !l.archived && /^https?:\/\//i.test(l.url) && !indexed.has(l.id));
  if (!targets.length) { showToast('All links already indexed'); return; }
  if (btn) btn.disabled = true;
  let done = 0;
  showToast(`Indexing 0/${targets.length}…`);
  const CONC = 4;
  for (let i = 0; i < targets.length; i += CONC) {
    const batch = targets.slice(i, i + CONC);
    await Promise.all(batch.map(l => fetch('/api/snapshot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: l.id, url: l.url }) }).catch(() => {})));
    done += batch.length;
    showToast(`Indexing ${Math.min(done, targets.length)}/${targets.length}…`);
  }
  if (btn) btn.disabled = false;
  showToast(`Indexed ${targets.length} link${targets.length > 1 ? 's' : ''} for content search`);
}
let currentSort = localStorage.getItem('msp-sort') || 'manual';
let currentView = localStorage.getItem('msp-view') || 'grid';
let defaultView = localStorage.getItem('msp-default-view') || 'home';
let currentMode = defaultView;
let userNavigated = false;
let homeFolderFilter = null;
let homeClockTimer = null;
let feedLoadToken = 0;
let lastHomeStatusAt = 0;

// --- Dashboard (homepage widget layout) ------------------------------------
// The homepage renders an ordered, toggleable list of widgets. Section widgets
// wrap the existing homepage sections; 'linkgroup' is a user-defined set of link
// tiles. The layout persists in config.json (key: dashboard) + localStorage, so
// it backs up and syncs like every other setting. Existing users with no saved
// layout fall back to DEFAULT_DASHBOARD — i.e. today's exact section order.
const SECTION_WIDGETS = ['clock', 'search', 'favorites', 'readlater', 'recent', 'most-visited', 'folders', 'latest'];
const WIDGET_LABELS = {
  clock: 'Clock & greeting', search: 'Search box', favorites: 'Favorites',
  readlater: 'Read later', recent: 'Recent', 'most-visited': 'Most visited',
  folders: 'Folders', latest: 'Latest (RSS)', linkgroup: 'Link group'
};
const WIDGET_ICONS = {
  clock: 'ti-clock', search: 'ti-search', favorites: 'ti-star-filled',
  readlater: 'ti-bookmark', recent: 'ti-history', 'most-visited': 'ti-flame',
  folders: 'ti-folders', latest: 'ti-rss', linkgroup: 'ti-apps'
};
const DEFAULT_DASHBOARD = SECTION_WIDGETS.map(type => ({ id: type, type, enabled: true }));
const LINKGROUP_MAX_ITEMS = 50;
let dashboard = JSON.parse(localStorage.getItem('msp-dashboard') || 'null');
let dashboardEditMode = false;

function getDashboard() {
  return Array.isArray(dashboard) && dashboard.length ? dashboard : DEFAULT_DASHBOARD.map(w => ({ ...w }));
}
function persistDashboard() {
  localStorage.setItem('msp-dashboard', JSON.stringify(dashboard));
  saveConfig();
}
// Accept only known widget shapes — a restored/hand-edited config must not be
// able to inject unknown types or non-http link URLs into the homepage.
function sanitizeDashboard(arr) {
  if (!Array.isArray(arr)) return null;
  const out = [];
  const seenSection = new Set();
  const seenId = new Set();
  for (const w of arr) {
    if (!w || typeof w !== 'object') continue;
    const type = w.type;
    const enabled = w.enabled !== false;
    if (SECTION_WIDGETS.includes(type)) {
      if (seenSection.has(type)) continue; // one of each section
      seenSection.add(type);
      out.push({ id: type, type, enabled });
    } else if (type === 'linkgroup') {
      // ids are inlined into onclick handlers, so only accept a safe pattern —
      // regenerate anything else (hostile/hand-edited config can't inject script).
      let id = (typeof w.id === 'string' && /^lg-[a-z0-9]+$/i.test(w.id)) ? w.id : '';
      if (!id || seenId.has(id)) id = 'lg-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      seenId.add(id);
      const title = (typeof w.title === 'string' ? w.title : 'Links').slice(0, 60);
      const items = Array.isArray(w.items) ? w.items
        .filter(it => it && typeof it.title === 'string' && typeof it.url === 'string' && /^https?:\/\//i.test(it.url))
        .slice(0, LINKGROUP_MAX_ITEMS)
        .map(it => ({ title: it.title.slice(0, 80), url: it.url })) : [];
      out.push({ id, type: 'linkgroup', enabled, title, items });
    }
  }
  return out.length ? out : null;
}
let currentDensity = localStorage.getItem('msp-density') || 'comfortable';
const DENSITY_CYCLE = ['compact', 'comfortable', 'spacious'];
const DENSITY_SETTINGS = {
  compact:     { minWidth: '160px', padding: '8px',  gap: '8px',  icon: 'ti ti-layout-grid',        label: 'Compact'     },
  comfortable: { minWidth: '220px', padding: '14px', gap: '12px', icon: 'ti ti-layout-grid-2',       label: 'Comfortable' },
  spacious:    { minWidth: '300px', padding: '20px', gap: '16px', icon: 'ti ti-layout-grid-3',       label: 'Spacious'    },
};
function applyDensity(d) {
  const s = DENSITY_SETTINGS[d] || DENSITY_SETTINGS.comfortable;
  const r = document.documentElement.style;
  r.setProperty('--card-min-width', s.minWidth);
  r.setProperty('--card-padding', s.padding);
  r.setProperty('--card-gap', s.gap);
  currentDensity = d;
  localStorage.setItem('msp-density', d);
  const btn = document.getElementById('densityBtn');
  if (btn) btn.innerHTML = `<i class="${s.icon}"></i>`;
}
function cycleDensity() {
  const next = DENSITY_CYCLE[(DENSITY_CYCLE.indexOf(currentDensity) + 1) % DENSITY_CYCLE.length];
  applyDensity(next);
}
function toggleView() {
  currentView = currentView === 'grid' ? 'list' : 'grid';
  localStorage.setItem('msp-view', currentView);
  document.getElementById('viewToggleIcon').className = currentView === 'grid' ? 'ti ti-layout-list' : 'ti ti-layout-grid';
  render();
}
function onSortChange() {
  currentSort = document.getElementById('sortSelect').value;
  localStorage.setItem('msp-sort', currentSort);
  updateFilterBadge();
  render();
}
function sortLinks(arr) {
  if (currentSort === 'manual') return arr;
  const copy = arr.slice();
  if (currentSort === 'az') copy.sort((a, b) => (a.title || '').toLowerCase().localeCompare((b.title || '').toLowerCase()));
  else if (currentSort === 'za') copy.sort((a, b) => (b.title || '').toLowerCase().localeCompare((a.title || '').toLowerCase()));
  else if (currentSort === 'newest') copy.sort((a, b) => parseInt(b.id, 36) - parseInt(a.id, 36));
  else if (currentSort === 'oldest') copy.sort((a, b) => parseInt(a.id, 36) - parseInt(b.id, 36));
  else if (currentSort === 'most-visited') copy.sort((a, b) => (b.visits || 0) - (a.visits || 0));
  else if (currentSort === 'recent') copy.sort((a, b) => (b.lastVisited || 0) - (a.lastVisited || 0));
  return copy;
}

function saveConfig() {
  const cfg = { folderColors, subfolderColors, tagColors, folderIcons, folderOrder, rssFeeds, theme: currentTheme, accent: customAccent, mode: themeMode, defaultView, homeBg, dashboard };
  fetch('/api/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cfg)
  }).catch(e => console.error('Config save failed:', e));
}

function applyServerConfig(cfg) {
  if (!cfg || typeof cfg !== 'object') return;
  // Only keep valid hex values — a restored/edited config must not be able to
  // smuggle a non-color string into a folder/subfolder style attribute (XSS),
  // the same guard applied to tagColors below.
  if (cfg.folderColors && typeof cfg.folderColors === 'object') {
    folderColors = Object.fromEntries(Object.entries(cfg.folderColors).filter(([, v]) => isHexColor(v)));
    localStorage.setItem('msp-folder-colors', JSON.stringify(folderColors));
  }
  if (cfg.subfolderColors && typeof cfg.subfolderColors === 'object') {
    subfolderColors = Object.fromEntries(Object.entries(cfg.subfolderColors).filter(([, v]) => isHexColor(v)));
    localStorage.setItem('msp-subfolder-colors', JSON.stringify(subfolderColors));
  }
  if (cfg.tagColors && typeof cfg.tagColors === 'object') {
    // Only keep valid hex values — a restored/edited config must not be able to
    // smuggle a non-color string into the tag-chip style attribute (XSS).
    tagColors = Object.fromEntries(Object.entries(cfg.tagColors).filter(([, v]) => isHexColor(v)));
    localStorage.setItem('msp-tag-colors', JSON.stringify(tagColors));
  }
  if (cfg.homeBg && typeof cfg.homeBg === 'object') {
    homeBg = normalizeHomeBg(cfg.homeBg);
    localStorage.setItem('msp-home-bg', JSON.stringify(homeBg));
  }
  if ('dashboard' in cfg) {
    dashboard = sanitizeDashboard(cfg.dashboard);
    localStorage.setItem('msp-dashboard', JSON.stringify(dashboard));
  }
  if (cfg.folderIcons && typeof cfg.folderIcons === 'object') {
    folderIcons = cfg.folderIcons;
    localStorage.setItem('msp-folder-icons', JSON.stringify(folderIcons));
  }
  if (Array.isArray(cfg.folderOrder)) {
    folderOrder = cfg.folderOrder;
    localStorage.setItem('msp-folder-order', JSON.stringify(folderOrder));
  }
  if (Array.isArray(cfg.rssFeeds)) {
    rssFeeds = cfg.rssFeeds.filter(f => f && typeof f.url === 'string');
    localStorage.setItem('msp-rss-feeds', JSON.stringify(rssFeeds));
  }
  if (cfg.mode === 'dark' || cfg.mode === 'light' || cfg.mode === 'auto') {
    applyMode(cfg.mode, false);
  }
  if (typeof cfg.accent === 'string' && /^#[0-9A-Fa-f]{6}$/.test(cfg.accent)) {
    customAccent = cfg.accent;
    localStorage.setItem('msp-accent', customAccent);
  }
  if (cfg.theme === 'Custom') {
    applyTheme('Custom', false);
  } else if (cfg.theme && THEMES[cfg.theme]) {
    applyTheme(cfg.theme, false);
  }
  if (cfg.defaultView === 'home' || cfg.defaultView === 'manager') {
    defaultView = cfg.defaultView;
    localStorage.setItem('msp-default-view', defaultView);
    updateDefaultViewLabel();
    if (!userNavigated && currentMode !== defaultView) setMode(defaultView, false);
  }
}

async function loadLinks() {
  try {
    const [linksRes, cfgRes] = await Promise.all([
      fetch('/api/links'),
      fetch('/api/config').catch(() => null)
    ]);
    const data = await linksRes.json();
    links = Array.isArray(data) ? data : [];
    if (cfgRes && cfgRes.ok) applyServerConfig(await cfgRes.json());
    render();
  } catch(e) {
    console.error('Failed to load links', e);
    showToast('Failed to load links from server', true);
  }
}

async function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const status = document.getElementById('saveStatus');
    status.innerHTML = '<i class="ti ti-loader" style="animation:spin 1s linear infinite"></i> Saving…';
    try {
      const res = await fetch('/api/links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(links)
      });
      if (!res.ok) throw new Error('Server error ' + res.status);
      status.innerHTML = '<i class="ti ti-circle-check" style="color:var(--g3)"></i> Saved';
      setTimeout(() => status.innerHTML = '', 2000);
    } catch(e) {
      status.innerHTML = '<i class="ti ti-alert-circle" style="color:#E24B4A"></i> Save failed';
    }
  }, 400);
}

let toastTimer = null;
let pendingDelete = null;
let pendingMove = null;

function showToast(msg, isError) {
  const t = document.getElementById('toast');
  document.getElementById('toastMsg').textContent = msg;
  document.getElementById('toastUndo').style.display = 'none';
  document.getElementById('toastIcon').className = isError ? 'ti ti-alert-circle' : 'ti ti-check';
  t.style.borderColor = isError ? '#E24B4A' : '';
  t.style.color = isError ? '#E24B4A' : '';
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2500);
}

function showUndoToast(msg, icon = 'ti-trash') {
  const t = document.getElementById('toast');
  document.getElementById('toastMsg').textContent = msg;
  document.getElementById('toastUndo').style.display = '';
  document.getElementById('toastIcon').className = `ti ${icon}`;
  t.style.borderColor = '';
  t.style.color = '';
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 5500);
}

function undoAction() {
  if (pendingDelete) undoDelete();
  else if (pendingMove) undoMove();
}

function undoDelete() {
  if (!pendingDelete) return;
  clearTimeout(pendingDelete.timer);
  links = pendingDelete.saved;
  pendingDelete = null;
  render();
  showToast('Restored');
}

function undoMove() {
  if (!pendingMove) return;
  clearTimeout(pendingMove.timer);
  links = pendingMove.saved;
  pendingMove = null;
  save(); render();
  showToast('Move undone');
}

function commitPendingMove() {
  if (!pendingMove) return;
  clearTimeout(pendingMove.timer);
  pendingMove = null;
  save();
}

function getFavicon(u) { try { new URL(u); return '/api/favicon?url=' + encodeURIComponent(u); } catch { return null; } }
function getDomain(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } }
function esc(s) { if (!s) return ''; return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function isHexColor(c) { return typeof c === 'string' && /^#[0-9A-Fa-f]{6}$/.test(c); }
function hexToRgb(hex) {
  if (!hex || !/^#[0-9A-Fa-f]{6}$/.test(hex)) return '29,158,117';
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
  return `${r},${g},${b}`;
}
function hexToHsl(hex) {
  let r = parseInt(hex.slice(1,3),16)/255, g = parseInt(hex.slice(3,5),16)/255, b = parseInt(hex.slice(5,7),16)/255;
  const max = Math.max(r,g,b), min = Math.min(r,g,b); let h, s, l = (max+min)/2;
  if (max === min) { h = s = 0; }
  else {
    const d = max - min;
    s = l > 0.5 ? d/(2-max-min) : d/(max+min);
    switch (max) { case r: h = (g-b)/d + (g<b?6:0); break; case g: h = (b-r)/d + 2; break; default: h = (r-g)/d + 4; }
    h /= 6;
  }
  return [h*360, s*100, l*100];
}
function hslToHex(h, s, l) {
  h /= 360; s /= 100; l /= 100;
  const hue2rgb = (p, q, t) => { if (t<0) t+=1; if (t>1) t-=1; if (t<1/6) return p+(q-p)*6*t; if (t<1/2) return q; if (t<2/3) return p+(q-p)*(2/3-t)*6; return p; };
  let r, g, b;
  if (s === 0) { r = g = b = l; }
  else { const q = l < 0.5 ? l*(1+s) : l+s-l*s; const p = 2*l-q; r = hue2rgb(p,q,h+1/3); g = hue2rgb(p,q,h); b = hue2rgb(p,q,h-1/3); }
  const toHex = x => Math.round(x*255).toString(16).padStart(2,'0');
  return '#' + toHex(r) + toHex(g) + toHex(b);
}
// Build a g1..g6 lightness ramp + glow from a single base accent color.
function deriveAccent(baseHex) {
  const [h, s0] = hexToHsl(baseHex);
  const s = Math.min(85, Math.max(35, s0));
  const ramp = [93, 75, 60, 42, 30, 20].map(l => hslToHex(h, s, l));
  return { g1: ramp[0], g2: ramp[1], g3: ramp[2], g4: ramp[3], g5: ramp[4], g6: ramp[5], glow: `rgba(${hexToRgb(ramp[3])},.15)` };
}
function getFolderColor(f) { return isHexColor(folderColors[f]) ? folderColors[f] : '#1D9E75'; }
function subKey(folder, sf) { return JSON.stringify([folder, sf]); }
function getSubfolderColor(folder, sf) { const c = subfolderColors[subKey(folder, sf)]; return isHexColor(c) ? c : getFolderColor(folder); }
function getTagColor(t) { return isHexColor(tagColors[t]) ? tagColors[t] : null; }
function accentColor() {
  const c = getComputedStyle(document.documentElement).getPropertyValue('--g4').trim();
  return /^#[0-9A-Fa-f]{6}$/.test(c) ? c : '#1D9E75';
}
function tagHtml(t) {
  const tc = getTagColor(t);
  const style = tc ? ` style="background:rgba(${hexToRgb(tc)},.2);color:${tc};border-color:${tc}"` : '';
  return `<span class="tag" data-tag="${esc(t)}" title="Filter by &quot;${esc(t)}&quot;"${style}>${esc(t)}</span>`;
}
function getFolderIcon(f) { return folderIcons[f] || 'ti-folder'; }
function allFolders() { return [...new Set(links.filter(l => !l.archived).map(l => l.folder).filter(Boolean))].sort(); }
function getOrderedFolders(names) {
  if (!folderOrder) return names.slice().sort();
  const known = new Set(folderOrder);
  const fresh = names.filter(f => !known.has(f)).sort();
  return [...folderOrder.filter(f => names.includes(f)), ...fresh];
}
function allTags() { return [...new Set(links.filter(l => !l.archived).flatMap(l => l.tags || []))].sort(); }

function subfoldersByFolder(folderName) {
  return [...new Set(links.filter(l => !l.archived && l.folder === folderName && l.subfolder).map(l => l.subfolder))].sort();
}

function setMode(mode, navigated = true) {
  currentMode = mode;
  if (navigated) userNavigated = true;
  const toolbar = document.querySelector('.toolbar');
  if (toolbar) toolbar.style.display = mode === 'home' ? 'none' : '';
  const hb = document.getElementById('homeBtn'), mb = document.getElementById('managerBtn');
  if (hb) hb.classList.toggle('active', mode === 'home');
  if (mb) mb.classList.toggle('active', mode === 'manager');
  const ab = document.getElementById('headerAddBtn');
  if (ab) ab.style.display = mode === 'home' ? '' : 'none';
  const edb = document.getElementById('editDashBtn');
  if (edb) { edb.style.display = mode === 'home' ? '' : 'none'; edb.classList.toggle('active', mode === 'home' && dashboardEditMode); }
  if (mode !== 'home') { clearInterval(homeClockTimer); homeClockTimer = null; dashboardEditMode = false; }
  render();
}
function goHome() { setMode('home'); }
function goManager() { setMode('manager'); }

function toggleDefaultView() {
  defaultView = defaultView === 'home' ? 'manager' : 'home';
  localStorage.setItem('msp-default-view', defaultView);
  updateDefaultViewLabel();
  saveConfig();
}
function updateDefaultViewLabel() {
  const el = document.getElementById('defaultViewLabel');
  if (el) el.textContent = defaultView === 'home' ? 'Home' : 'Manager';
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}
function updateClock() {
  const t = document.getElementById('homeTime');
  if (!t) { clearInterval(homeClockTimer); homeClockTimer = null; return; }
  const now = new Date();
  let h = now.getHours(); const m = now.getMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12; if (h === 0) h = 12;
  t.textContent = `${h}:${String(m).padStart(2, '0')} ${ampm}`;
  const g = document.getElementById('homeGreeting');
  if (g) g.textContent = greeting();
}

function homeTileHtml(l, draggable) {
  const fav = getFavicon(l.url);
  const fi = fav
    ? `<img src="${fav}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><span style="display:none;width:100%;height:100%;align-items:center;justify-content:center"><i class="ti ti-world"></i></span>`
    : `<i class="ti ti-world"></i>`;
  return `<div class="home-tile"${draggable ? ' draggable="true"' : ''} data-id="${esc(l.id)}" data-url="${esc(l.url)}" title="${esc(l.title)}"><div class="home-tile-icon">${fi}<span class="home-tile-dot ${statusDotClass(l.id)}"></span></div><div class="home-tile-label">${esc(l.title)}</div></div>`;
}
function homeFolderTileHtml(f, draggable = true) {
  const fc = getFolderColor(f);
  return `<div class="home-tile home-folder-tile"${draggable ? ' draggable="true"' : ''} data-folder="${esc(f)}" title="${esc(f)}"><div class="home-tile-icon" style="background:rgba(${hexToRgb(fc)},.15)"><i class="ti ${getFolderIcon(f)}" style="color:${fc}"></i></div><div class="home-tile-label">${esc(f)}</div></div>`;
}
function homeSection(title, icon, tilesHtml, count, key) {
  if (!count) return '';
  const secAttr = key === 'favorites' ? ' data-home-section="favorites"' : '';
  return `<div class="home-section"><div class="home-section-head"><i class="ti ${icon}" style="font-size:14px;color:var(--g3)"></i><span class="home-section-title">${title}</span><button class="home-section-all" onclick="homeShowAll('${key}')">show all <i class="ti ti-arrow-right"></i></button></div><div class="home-tiles"${secAttr}>${tilesHtml}</div></div>`;
}
function homeShowAll(key) {
  if (key === 'most-visited') { currentSort = 'most-visited'; localStorage.setItem('msp-sort', currentSort); }
  else if (key === 'recent') { currentSort = 'recent'; localStorage.setItem('msp-sort', currentSort); }
  else if (key === 'readlater') { const el = document.getElementById('statusFilter'); if (el) el.value = 'readlater'; }
  goManager();
}
function homeSearchInput(v) {
  document.getElementById('search').value = v;
  document.getElementById('searchClear').style.display = v ? '' : 'none';
  if (v.trim()) {
    document.getElementById('folderFilter').value = '';
    document.getElementById('tagFilter').value = '';
    const stEl = document.getElementById('statusFilter'); if (stEl) stEl.value = '';
    setMode('manager');
    const s = document.getElementById('search');
    s.focus();
    const len = s.value.length;
    s.setSelectionRange(len, len);
  }
}
function openFolderFromHome(folder) {
  homeFolderFilter = folder;
  setMode('manager');
}

// Reorder a favorite by moving its record just before the target's in `links`
// (same model as manager card reorder — favorites render in links-array order).
function reorderFavorite(srcId, tgtId) {
  const si = links.findIndex(l => l.id === srcId);
  if (si < 0) return;
  const [moved] = links.splice(si, 1);
  const ti = links.findIndex(l => l.id === tgtId);
  if (ti < 0) { links.splice(si, 0, moved); return; }
  links.splice(ti, 0, moved);
  save(); render();
}

// A linkgroup tile opens a user-entered URL (not a saved link), so it carries
// data-href instead of data-id — no visit bump, no status dot.
function linkgroupTileHtml(it, gid, idx) {
  const fav = getFavicon(it.url);
  const fi = fav
    ? `<img src="${fav}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><span style="display:none;width:100%;height:100%;align-items:center;justify-content:center"><i class="ti ti-world"></i></span>`
    : `<i class="ti ti-world"></i>`;
  const rm = dashboardEditMode
    ? `<button class="lg-tile-remove" title="Remove link" onclick="linkgroupRemoveItem('${gid}',${idx})"><i class="ti ti-x"></i></button>` : '';
  return `<div class="home-tile" data-href="${esc(it.url)}" title="${esc(it.title)}"><div class="home-tile-icon">${fi}${rm}</div><div class="home-tile-label">${esc(it.title)}</div></div>`;
}

// Build the inner content for a single widget. Returns '' for a data-driven
// widget that is empty when NOT editing (preserves today's auto-hide behavior).
function widgetInner(w, data) {
  const edit = dashboardEditMode;
  const placeholder = '<div class="home-widget-empty">Nothing to show yet</div>';
  switch (w.type) {
    case 'clock':
      return `<div class="home-clock"><div class="home-time" id="homeTime"></div><div class="home-greeting" id="homeGreeting"></div></div>`;
    case 'search':
      return `<div class="home-search-wrap"><i class="ti ti-search search-icon"></i><input type="text" class="home-search" id="homeSearch" placeholder="Search your links…" autocomplete="off" oninput="homeSearchInput(this.value)"></div>`;
    case 'favorites':
      if (!data.favorites.length) return edit ? sectionShell('Favorites', 'ti-star-filled', placeholder) : '';
      return homeSection('Favorites', 'ti-star-filled', data.favorites.map(l => homeTileHtml(l, !edit)).join(''), 1, 'favorites');
    case 'readlater':
      if (!data.readlater.length) return edit ? sectionShell('Read later', 'ti-bookmark', placeholder) : '';
      return homeSection('Read later', 'ti-bookmark', data.readlater.map(l => homeTileHtml(l, false)).join(''), 1, 'readlater');
    case 'recent':
      if (!data.recent.length) return edit ? sectionShell('Recent', 'ti-history', placeholder) : '';
      return homeSection('Recent', 'ti-history', data.recent.map(l => homeTileHtml(l, false)).join(''), 1, 'recent');
    case 'most-visited':
      if (!data['most-visited'].length) return edit ? sectionShell('Most visited', 'ti-flame', placeholder) : '';
      return homeSection('Most visited', 'ti-flame', data['most-visited'].map(l => homeTileHtml(l, false)).join(''), 1, 'most-visited');
    case 'folders':
      if (!data.folders.length) return edit ? sectionShell('Folders', 'ti-folders', placeholder) : '';
      return homeSection('Folders', 'ti-folders', data.folders.map(f => homeFolderTileHtml(f, !edit)).join(''), 1, 'folders');
    case 'latest':
      if (!rssFeeds.length) return edit ? sectionShell('Latest', 'ti-rss', '<div class="home-widget-empty">No feeds configured</div>') : '';
      // A disabled latest widget (only reachable in edit mode) shows a static
      // preview — never the live #homeFeed container, which would spin forever
      // since loadHomeFeeds() only runs for an enabled latest widget.
      if (!w.enabled) return sectionShell('Latest', 'ti-rss', '<div class="home-widget-empty">Latest headlines</div>');
      return `<div class="home-section"><div class="home-section-head"><i class="ti ti-rss" style="font-size:14px;color:var(--g3)"></i><span class="home-section-title">Latest</span><button class="home-section-all" onclick="closeSettings();openFeedManager()">manage <i class="ti ti-settings"></i></button></div><div class="home-feed" id="homeFeed"><div class="home-feed-msg"><i class="ti ti-loader" style="animation:spin 1s linear infinite"></i> Loading feeds…</div></div></div>`;
    case 'linkgroup': {
      const items = w.items || [];
      if (!items.length && !edit) return '';
      const tiles = items.length ? `<div class="home-tiles">${items.map((it, i) => linkgroupTileHtml(it, w.id, i)).join('')}</div>` : '';
      const emptyMsg = (!items.length && edit) ? '<div class="home-widget-empty">No links yet — add one below.</div>' : '';
      const addForm = edit
        ? `<div class="lg-add-form">`
          + `<input class="lg-add-url" type="text" placeholder="https://… URL" autocomplete="off" onkeydown="if(event.key==='Enter'){event.preventDefault();lgAddSubmit('${w.id}',this)}">`
          + `<input class="lg-add-title" type="text" placeholder="Label (optional)" autocomplete="off" onkeydown="if(event.key==='Enter'){event.preventDefault();lgAddSubmit('${w.id}',this)}">`
          + `<button class="btn" onclick="lgAddSubmit('${w.id}',this)"><i class="ti ti-plus"></i> Add</button>`
          + `</div>`
        : '';
      return `<div class="home-section"><div class="home-section-head"><i class="ti ti-apps" style="font-size:14px;color:var(--g3)"></i><span class="home-section-title">${esc(w.title || 'Links')}</span></div>${tiles}${emptyMsg}${addForm}</div>`;
    }
    default: return '';
  }
}
// A section header + body with no tiles (used for empty widgets in edit mode).
function sectionShell(title, icon, body) {
  return `<div class="home-section"><div class="home-section-head"><i class="ti ${icon}" style="font-size:14px;color:var(--g3)"></i><span class="home-section-title">${title}</span></div>${body}</div>`;
}

// Edit-mode toolbar shown above each widget (drag handle, label, show/hide, and
// link-group controls). Widget ids are validated to /^lg-[a-z0-9]+$/i or are a
// fixed section name, so inlining them in onclick is safe.
function widgetToolbar(w) {
  const label = w.type === 'linkgroup' ? (w.title || 'Link group') : (WIDGET_LABELS[w.type] || w.type);
  let extra = '';
  if (w.type === 'linkgroup') {
    extra = `<button class="icon-btn lg-rename-btn" title="Rename group" onclick="lgStartRename('${w.id}',this)"><i class="ti ti-pencil"></i></button>`
          + `<button class="icon-btn" style="color:#E24B4A" title="Remove widget" onclick="widgetRemove('${w.id}')"><i class="ti ti-trash"></i></button>`;
  }
  return `<div class="widget-toolbar"><span class="widget-drag-handle" draggable="true" title="Drag to reorder"><i class="ti ti-grip-vertical"></i></span><i class="ti ${WIDGET_ICONS[w.type] || 'ti-square'} widget-tb-icon"></i><span class="widget-tb-label">${esc(label)}</span><button class="icon-btn" title="${w.enabled ? 'Hide' : 'Show'}" onclick="widgetToggle('${w.id}')"><i class="ti ${w.enabled ? 'ti-eye' : 'ti-eye-off'}"></i></button>${extra}</div>`;
}

function renderWidget(w, data) {
  if (!w.enabled && !dashboardEditMode) return '';
  const inner = widgetInner(w, data);
  if (!dashboardEditMode) return inner; // normal mode: identical DOM to before, no wrapper
  return `<div class="home-widget${w.enabled ? '' : ' disabled'}" data-widget-id="${esc(w.id)}">${widgetToolbar(w)}${inner}</div>`;
}

function renderHome() {
  const c = document.getElementById('content');
  const active = links.filter(l => !l.archived);
  const data = {
    favorites: active.filter(l => l.favorite).slice(0, 8),
    readlater: active.filter(l => l.readLater).slice(0, 8),
    recent: active.filter(l => l.lastVisited).sort((a, b) => (b.lastVisited || 0) - (a.lastVisited || 0)).slice(0, 8),
    'most-visited': active.filter(l => (l.visits || 0) > 0).sort((a, b) => (b.visits || 0) - (a.visits || 0)).slice(0, 8),
    folders: getOrderedFolders(allFolders()).slice(0, 8),
  };
  const list = getDashboard();

  let html = `<div class="home${dashboardEditMode ? ' editing' : ''}">`;
  if (dashboardEditMode) {
    html += `<div class="dashboard-edit-banner"><i class="ti ti-layout-dashboard"></i><span>Editing dashboard — drag to reorder, toggle the eye to show/hide.</span><button class="btn btn-primary" onclick="toggleDashboardEdit()"><i class="ti ti-check"></i> Done</button></div>`;
  }
  html += list.map(w => renderWidget(w, data)).join('');
  if (dashboardEditMode) {
    const present = new Set(list.map(w => w.type));
    const chips = SECTION_WIDGETS.filter(t => !present.has(t))
      .map(t => `<button class="btn" onclick="addSectionWidget('${t}')"><i class="ti ${WIDGET_ICONS[t]}"></i> ${esc(WIDGET_LABELS[t])}</button>`).join('');
    html += `<div class="add-widget-bar"><span class="add-widget-label">Add widget</span>${chips}<button class="btn" onclick="addLinkGroup()"><i class="ti ti-apps"></i> Link group</button></div>`;
  }
  html += '</div>';
  c.innerHTML = html;

  updateClock();
  clearInterval(homeClockTimer);
  homeClockTimer = setInterval(updateClock, 1000);
  if (rssFeeds.length && list.some(w => w.type === 'latest' && w.enabled)) loadHomeFeeds();
  loadHomeStatus();
  updateArchiveBadge();
  applyHomeBg();
}

// --- Dashboard edit actions -------------------------------------------------
// Materialize the default layout into a concrete array before mutating, so the
// first edit of an unconfigured dashboard starts from today's section order.
function ensureDashboard() {
  if (!Array.isArray(dashboard) || !dashboard.length) dashboard = DEFAULT_DASHBOARD.map(w => ({ ...w }));
  return dashboard;
}
function toggleDashboardEdit() {
  dashboardEditMode = !dashboardEditMode;
  if (dashboardEditMode) ensureDashboard();
  closeSettings();
  if (currentMode !== 'home') setMode('home'); else render();
  const btn = document.getElementById('editDashBtn');
  if (btn) btn.classList.toggle('active', dashboardEditMode);
}
function widgetToggle(id) {
  const w = ensureDashboard().find(x => x.id === id);
  if (!w) return;
  w.enabled = !w.enabled;
  persistDashboard(); render();
}
function widgetRemove(id) {
  dashboard = ensureDashboard().filter(x => x.id !== id);
  persistDashboard(); render();
}
function addSectionWidget(type) {
  if (!SECTION_WIDGETS.includes(type)) return;
  const d = ensureDashboard();
  if (d.some(w => w.type === type)) return;
  d.push({ id: type, type, enabled: true });
  persistDashboard(); render();
}
function addLinkGroup() {
  const id = 'lg-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  ensureDashboard().push({ id, type: 'linkgroup', enabled: true, title: 'New group', items: [] });
  persistDashboard(); render();
  const btn = document.querySelector(`.home-widget[data-widget-id="${id}"] .lg-rename-btn`);
  if (btn) lgStartRename(id, btn); // start naming the new group immediately
}
// Inline rename of a link group's title — replaces the toolbar label with an
// input; commit on blur/Enter, cancel on Escape (same pattern as the Tag
// Manager's tmgrStartRename).
function lgStartRename(id, btn) {
  const toolbar = btn.closest('.widget-toolbar');
  const w = ensureDashboard().find(x => x.id === id);
  const span = toolbar && toolbar.querySelector('.widget-tb-label');
  if (!w || !span) return;
  const old = w.title || 'Links';
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'fmgr-input lg-rename-input';
  input.value = old;
  span.replaceWith(input);
  input.focus(); input.select();
  let committed = false;
  function commit() {
    if (committed) return; committed = true;
    const v = input.value.trim();
    if (v && v !== old) { w.title = v.slice(0, 60); persistDashboard(); }
    render();
  }
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    else if (e.key === 'Escape') { e.stopPropagation(); committed = true; render(); }
  });
}
// Add a link to a group from the inline add-form (URL + optional label),
// mirroring the feed manager's addFeed(). Refocuses the URL field for rapid entry.
function lgAddSubmit(id, el) {
  const form = el.closest('.lg-add-form');
  if (!form) return;
  const urlEl = form.querySelector('.lg-add-url');
  const titleEl = form.querySelector('.lg-add-title');
  let url = urlEl.value.trim();
  if (!url) { urlEl.focus(); return; }
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  try { new URL(url); } catch { showToast('Invalid URL', true); return; }
  const w = ensureDashboard().find(x => x.id === id);
  if (!w || w.type !== 'linkgroup') return;
  if ((w.items || []).length >= LINKGROUP_MAX_ITEMS) { showToast('Link group is full', true); return; }
  const title = titleEl.value.trim() || getDomain(url);
  w.items = [...(w.items || []), { title: title.slice(0, 80), url }];
  persistDashboard(); render();
  const next = document.querySelector(`.home-widget[data-widget-id="${id}"] .lg-add-url`);
  if (next) next.focus();
}
function linkgroupRemoveItem(id, idx) {
  const w = ensureDashboard().find(x => x.id === id);
  if (!w || !Array.isArray(w.items)) return;
  w.items.splice(idx, 1);
  persistDashboard(); render();
}

// Fetch every configured feed in parallel, merge + sort by date, show the newest.
async function loadHomeFeeds() {
  const token = ++feedLoadToken;
  const results = await Promise.all(rssFeeds.map(async f => {
    try {
      const r = await fetch('/api/rss?url=' + encodeURIComponent(f.url));
      if (!r.ok) return { ok: false, name: f.name || f.url };
      const data = await r.json();
      const src = f.name || data.title || getDomain(f.url);
      return { ok: !data.error, name: src, items: (data.items || []).map(it => ({ ...it, src })) };
    } catch { return { ok: false, name: f.name || f.url }; }
  }));
  if (token !== feedLoadToken) return; // a newer load superseded us
  const el = document.getElementById('homeFeed');
  if (!el) return;
  const merged = [];
  results.forEach(r => { if (r.items) merged.push(...r.items); });
  merged.sort((a, b) => (b.ts || 0) - (a.ts || 0));
  const top = merged.slice(0, 12);
  if (!top.length) {
    const failed = results.filter(r => !r.ok).length;
    el.innerHTML = `<div class="home-feed-msg">${failed ? 'Could not reach ' + failed + ' feed' + (failed !== 1 ? 's' : '') + '.' : 'No items yet.'}</div>`;
    return;
  }
  el.innerHTML = top.map(it => `<div class="feed-item" data-url="${esc(it.link)}" title="${esc(it.title)}" onclick="openFeedItem(this.dataset.url)"><span class="feed-item-title">${esc(it.title)}</span><span class="feed-item-meta"><span class="feed-item-src">${esc(it.src)}</span><span>${esc(timeAgo(it.ts))}</span></span></div>`).join('');
}

function openFeedItem(url) { window.open(url, '_blank', 'noopener'); }

// Live up/down dots on homepage link tiles, reusing /api/check-links.
function statusDotClass(id) {
  const s = linkStatus[id];
  if (s === 'ok') return 'up';
  if (s === 'broken' || s === 'timeout') return 'down';
  return '';
}
function paintHomeDots() {
  document.querySelectorAll('.home-tile[data-id]').forEach(t => {
    const d = t.querySelector('.home-tile-dot');
    if (d) d.className = 'home-tile-dot ' + statusDotClass(t.dataset.id);
  });
}
async function loadHomeStatus() {
  const tiles = [...document.querySelectorAll('.home-tile[data-id]')];
  const ids = [...new Set(tiles.map(t => t.dataset.id))];
  if (!ids.length) return;
  // Skip the network call if we checked recently and already know every tile.
  if (Date.now() - lastHomeStatusAt < 90000 && ids.every(id => linkStatus[id] !== undefined)) {
    paintHomeDots();
    return;
  }
  // Show a pulsing grey dot only on tiles we have no status for yet.
  tiles.forEach(t => {
    const d = t.querySelector('.home-tile-dot');
    if (d && linkStatus[t.dataset.id] === undefined) d.className = 'home-tile-dot checking';
  });
  try {
    const res = await fetch('/api/check-links?ids=' + ids.map(encodeURIComponent).join(','));
    if (!res.ok) throw new Error('status ' + res.status);
    Object.assign(linkStatus, await res.json());
    lastHomeStatusAt = Date.now();
  } catch { /* leave known dots; clear the pulsing ones below */ }
  paintHomeDots();
}

function render() {
  applyHomeBg();
  if (currentMode === 'home') { renderHome(); return; }
  const q = document.getElementById('search').value.toLowerCase();
  const clearBtn = document.getElementById('searchClear');
  if (clearBtn) clearBtn.style.display = q ? '' : 'none';
  let ff = document.getElementById('folderFilter').value;
  if (homeFolderFilter !== null) { ff = homeFolderFilter; homeFolderFilter = null; }
  const tf = document.getElementById('tagFilter').value;
  const stf = document.getElementById('statusFilter')?.value || '';
  const fs = document.getElementById('folderFilter'), ts = document.getElementById('tagFilter');
  fs.innerHTML = '<option value="">All folders</option>' + allFolders().map(f => `<option value="${esc(f)}"${f===ff?' selected':''}>${esc(f)}</option>`).join('');
  ts.innerHTML = '<option value="">All tags</option>' + allTags().map(t => `<option value="${esc(t)}"${t===tf?' selected':''}>${esc(t)}</option>`).join('');
  const sortEl = document.getElementById('sortSelect');
  if (sortEl) sortEl.value = currentSort;
  updateFilterBadge();
  const contentActive = q && contentMatchQuery === q;
  contentOnlyIds = new Set();
  let fil = links.filter(l => {
    if (l.archived) return false;
    if (ff && l.folder !== ff) return false;
    if (tf && !(l.tags || []).some(t => t.toLowerCase() === tf.toLowerCase())) return false;
    if (stf === 'readlater' && !l.readLater) return false;
    if (q) {
      const textMatch = (l.title+l.url+l.desc+(l.folder||'')+(l.subfolder||'')+(l.tags||[]).join(' ')).toLowerCase().includes(q);
      const contentMatch = contentActive && contentMatchIds.has(l.id);
      if (!textMatch && !contentMatch) return false;
      if (!textMatch && contentMatch) contentOnlyIds.add(l.id);
    }
    return true;
  });
  fil = sortLinks(fil);
  visibleIds = fil.map(l => l.id);
  const c = document.getElementById('content');
  if (!fil.length) {
    c.innerHTML = `<div class="empty"><i class="ti ti-bookmarks"></i>${links.length ? 'No results match your filters.' : 'No links yet — click <strong>Add link</strong> or <strong>Import</strong> to get started.'}</div>`;
    return;
  }
  const cardFn = currentView === 'list' ? cardListHtml : cardHtml;
  const wrap = items => currentView === 'list' ? `<div class="link-list">${items.map(cardFn).join('')}</div>` : `<div class="grid">${items.map(cardFn).join('')}</div>`;
  if (ff || q || tf || stf) { c.innerHTML = wrap(fil); return; }
  const byF = {}, noF = [];
  fil.forEach(l => { l.folder ? (byF[l.folder] = byF[l.folder] || [], byF[l.folder].push(l)) : noF.push(l); });
  let html = '';
  const favs = fil.filter(l => l.favorite);
  if (favs.length) {
    html += `<div class="favorites-section"><div class="favorites-header" onclick="toggleFavorites()"><i class="ti ti-chevron-right folder-chevron${favoritesCollapsed ? '' : ' open'}"></i><i class="ti ti-star-filled" style="font-size:15px;color:#F5A623"></i><span class="favorites-title">Favorites</span><span class="count-pill" style="background:rgba(245,166,35,.3);color:#F5A623">${favs.length}</span></div>${favoritesCollapsed ? '' : wrap(favs)}</div>`;
  }
  if (noF.length) html += wrap(noF);
  getOrderedFolders(Object.keys(byF)).forEach(f => {
    const collapsed = collapsedFolders.has(f);
    let folderContent = '';
    if (!collapsed) {
      folderContent = renderFolderContents(f, byF[f]);
    }
    const fc = getFolderColor(f);
    const fcRgb = hexToRgb(fc);
    html += `<div class="folder-section"><div class="folder-header" onclick="toggleFolder(this.dataset.folder)" data-folder="${esc(f)}" style="background:rgba(${fcRgb},.15);border-color:${fc}"><div class="folder-drag-handle" draggable="true" title="Drag to reorder folder" onclick="event.stopPropagation()"><i class="ti ti-grip-vertical"></i></div><i class="ti ti-chevron-right folder-chevron${collapsed ? '' : ' open'}" style="color:${fc}"></i><i class="ti ${getFolderIcon(f)} folder-icon-btn" style="font-size:16px;color:${fc};cursor:pointer" onclick="event.stopPropagation();openFolderIconPicker(this.closest('.folder-header').dataset.folder,this)" title="Change icon"></i><span class="folder-name">${esc(f)}</span><button class="folder-rename-btn" onclick="event.stopPropagation();startFolderRename(this)" title="Rename folder"><i class="ti ti-pencil"></i></button><button class="folder-rename-btn" onclick="event.stopPropagation();deleteFolder(this.closest('.folder-header').dataset.folder)" title="Delete folder" style="color:#E24B4A"><i class="ti ti-trash"></i></button><span class="count-pill" style="background:${fc}">${byF[f].length}</span><div class="folder-color-swatch" onclick="event.stopPropagation();openFolderColorPicker(this.closest('.folder-header').dataset.folder,this)" style="width:16px;height:16px;border-radius:50%;background:${fc};cursor:pointer;margin-left:auto;flex-shrink:0;border:1.5px solid var(--ring)"></div></div><div class="folder-content" data-folder="${esc(f)}">${folderContent}</div></div>`;
  });
  c.innerHTML = html;
  updateArchiveBadge();
}

function renderFolderContents(folderName, folderLinks) {
  const rootLinks = folderLinks.filter(l => !l.subfolder);
  const bySubfolder = {};
  folderLinks.filter(l => l.subfolder).forEach(l => {
    bySubfolder[l.subfolder] = bySubfolder[l.subfolder] || [];
    bySubfolder[l.subfolder].push(l);
  });

  const cardFn = currentView === 'list' ? cardListHtml : cardHtml;
  const wrap = items => currentView === 'list' ? `<div class="link-list">${items.map(cardFn).join('')}</div>` : `<div class="grid">${items.map(cardFn).join('')}</div>`;

  let html = '';
  if (rootLinks.length) {
    html += wrap(rootLinks);
  }

  Object.keys(bySubfolder).sort().forEach(sf => {
    const key = JSON.stringify([folderName, sf]);
    const sfCollapsed = !!collapsedSubfolders[key];
    const sfLinks = bySubfolder[sf];
    const sfc = getSubfolderColor(folderName, sf);
    const sfcRgb = hexToRgb(sfc);
    html += `<div class="subfolder-header" onclick="toggleSubfolder(this.dataset.folder,this.dataset.subfolder)" data-folder="${esc(folderName)}" data-subfolder="${esc(sf)}" style="border-left-color:rgba(${sfcRgb},.5)">`;
    html += `<i class="ti ti-chevron-right folder-chevron${sfCollapsed ? '' : ' open'}" style="font-size:12px;color:${sfc}"></i>`;
    html += `<i class="ti ti-folder" style="font-size:12px;color:${sfc};opacity:.7"></i>`;
    html += `<span class="subfolder-title">${esc(sf)}</span>`;
    html += `<span class="count-pill" style="font-size:10px;padding:1px 5px;background:rgba(${sfcRgb},.5)">${sfLinks.length}</span>`;
    html += `<button class="folder-rename-btn" onclick="event.stopPropagation();startSubfolderRename(this)" title="Rename sub-folder" style="font-size:11px"><i class="ti ti-pencil"></i></button>`;
    html += `<div class="subfolder-color-swatch" onclick="event.stopPropagation();openSubfolderColorPicker(this.closest('.subfolder-header').dataset.folder,this.closest('.subfolder-header').dataset.subfolder,this)" title="Change color" style="width:13px;height:13px;border-radius:50%;background:${sfc};cursor:pointer;flex-shrink:0;border:1.5px solid var(--ring)"></div>`;
    html += `</div>`;
    if (!sfCollapsed) {
      html += `<div class="subfolder-grid">${wrap(sfLinks)}</div>`;
    }
  });

  return html;
}

function contentBadge(id) {
  return contentOnlyIds.has(id) ? `<span class="content-badge" title="Matched in the page text"><i class="ti ti-file-search"></i> in page</span>` : '';
}
function cardHtml(l) {
  const fav = getFavicon(l.url);
  const fi = fav ? `<img src="${fav}" alt="" onerror="this.style.display='none';this.nextSibling.style.display='flex'"><span style="display:none"><i class="ti ti-world"></i></span>` : `<i class="ti ti-world"></i>`;
  const starBtn = selectMode ? '' : `<button class="star-btn${l.favorite ? ' active' : ''}" data-action="favorite" data-id="${esc(l.id)}" title="${l.favorite ? 'Remove from favorites' : 'Add to favorites'}"><i class="ti ti-star${l.favorite ? '-filled' : ''}"></i></button>`;
  const rlBtn = selectMode ? '' : `<button class="rl-btn${l.readLater ? ' active' : ''}" data-action="readlater" data-id="${esc(l.id)}" title="${l.readLater ? 'Remove from read later' : 'Save to read later'}"><i class="ti ti-bookmark${l.readLater ? '-filled' : ''}"></i></button>`;
  const footer = `<div class="card-footer">
      ${starBtn}
      ${rlBtn}
      ${(l.tags || []).map(tagHtml).join('')}
      ${contentBadge(l.id)}
      ${l.folder ? `<span class="folder-badge"><i class="ti ti-folder" style="font-size:11px"></i> ${esc(l.folder)}${l.subfolder ? ' / ' + esc(l.subfolder) : ''}</span>` : ''}
    </div>`;
  const top = `<div class="card-top"><div class="favicon">${fi}</div>
      <div style="min-width:0"><div class="card-title">${esc(l.title)}</div><div class="card-url">${esc(getDomain(l.url))}</div>${l.lastVisited ? `<div style="font-size:11px;color:var(--text2);margin-top:1px">${timeAgo(l.lastVisited)}</div>` : ''}</div>
    </div>`;
  const statusBadge = (linkStatus[l.id] === 'broken' || linkStatus[l.id] === 'timeout')
    ? `<div class="status-badge" title="${linkStatus[l.id] === 'timeout' ? 'Link timed out' : 'Link appears broken'}"><i class="ti ti-alert-triangle"></i></div>`
    : '';
  if (selectMode) {
    const checked = selectedIds.has(l.id);
    return `<div class="card select-mode${checked ? ' selected' : ''}" data-id="${esc(l.id)}">
      <div class="card-check${checked ? ' checked' : ''}"><i class="ti ti-check"></i></div>
      ${statusBadge}
      ${top}
      ${l.desc ? `<div class="card-desc">${esc(l.desc)}</div>` : ''}
      ${footer}
    </div>`;
  }
  return `<div class="card" data-id="${esc(l.id)}" data-url="${esc(l.url)}"${l.folder ? ` style="border-left:3px solid ${getFolderColor(l.folder)}"` : ''}>
    <div class="card-actions">
      <div class="drag-handle" draggable="true" title="Drag to reorder"><i class="ti ti-grip-vertical"></i></div>
      <button class="icon-btn" title="Copy URL" data-action="copy" data-id="${esc(l.id)}" data-url="${esc(l.url)}"><i class="ti ti-copy"></i></button>
      <button class="icon-btn" title="Edit" data-action="edit" data-id="${esc(l.id)}"><i class="ti ti-edit"></i></button>
      <button class="icon-btn" title="Archive" data-action="archive" data-id="${esc(l.id)}"><i class="ti ti-archive"></i></button>
      <button class="icon-btn" title="Delete" data-action="delete" data-id="${esc(l.id)}"><i class="ti ti-trash"></i></button>
    </div>
    ${statusBadge}
    ${top}
    ${l.desc ? `<div class="card-desc">${esc(l.desc)}</div>` : ''}
    ${footer}
  </div>`;
}

function cardListHtml(l) {
  const fav = getFavicon(l.url);
  const fi = fav ? `<img src="${fav}" alt="" onerror="this.style.display='none';this.nextSibling.style.display='flex'"><span style="display:none"><i class="ti ti-world"></i></span>` : `<i class="ti ti-world"></i>`;
  const statusBadge = (linkStatus[l.id] === 'broken' || linkStatus[l.id] === 'timeout')
    ? `<i class="ti ti-alert-triangle" style="font-size:13px;color:#E24B4A;flex-shrink:0" title="${linkStatus[l.id] === 'timeout' ? 'Link timed out' : 'Link appears broken'}"></i>`
    : '';
  if (selectMode) {
    const checked = selectedIds.has(l.id);
    return `<div class="card-row select-mode${checked ? ' selected' : ''}" data-id="${esc(l.id)}">
      <div class="card-check${checked ? ' checked' : ''}" style="position:static;flex-shrink:0"><i class="ti ti-check"></i></div>
      <div class="favicon">${fi}</div>
      ${statusBadge}
      <span class="card-row-title">${esc(l.title)}</span>
      <span class="card-row-domain">${esc(getDomain(l.url))}</span>
      <div class="card-row-tags">${(l.tags || []).map(tagHtml).join('')}</div>
      ${l.folder ? `<span class="folder-badge" style="margin-left:0"><i class="ti ti-folder" style="font-size:11px"></i> ${esc(l.folder)}${l.subfolder ? ' / ' + esc(l.subfolder) : ''}</span>` : ''}
    </div>`;
  }
  return `<div class="card-row" data-id="${esc(l.id)}" data-url="${esc(l.url)}"${l.folder ? ` style="border-left:3px solid ${getFolderColor(l.folder)}"` : ''}>
    <div class="favicon">${fi}</div>
    ${statusBadge}
    <span class="card-row-title">${esc(l.title)}</span>
    <span class="card-row-domain">${esc(getDomain(l.url))}</span>
    ${l.lastVisited ? `<span style="font-size:11px;color:var(--text2);flex-shrink:0">${timeAgo(l.lastVisited)}</span>` : ''}
    <div class="card-row-tags">${(l.tags || []).map(tagHtml).join('')}</div>
    ${contentBadge(l.id)}
    ${l.folder ? `<span class="folder-badge" style="margin-left:0"><i class="ti ti-folder" style="font-size:11px"></i> ${esc(l.folder)}${l.subfolder ? ' / ' + esc(l.subfolder) : ''}</span>` : ''}
    <button class="star-btn${l.favorite ? ' active' : ''}" data-action="favorite" data-id="${esc(l.id)}" title="${l.favorite ? 'Remove from favorites' : 'Add to favorites'}" style="flex-shrink:0"><i class="ti ti-star${l.favorite ? '-filled' : ''}"></i></button>
    <button class="rl-btn${l.readLater ? ' active' : ''}" data-action="readlater" data-id="${esc(l.id)}" title="${l.readLater ? 'Remove from read later' : 'Save to read later'}" style="flex-shrink:0"><i class="ti ti-bookmark${l.readLater ? '-filled' : ''}"></i></button>
    <div class="card-row-actions">
      <button class="icon-btn" title="Copy URL" data-action="copy" data-id="${esc(l.id)}" data-url="${esc(l.url)}"><i class="ti ti-copy"></i></button>
      <button class="icon-btn" title="Edit" data-action="edit" data-id="${esc(l.id)}"><i class="ti ti-edit"></i></button>
      <button class="icon-btn" title="Archive" data-action="archive" data-id="${esc(l.id)}"><i class="ti ti-archive"></i></button>
      <button class="icon-btn" title="Delete" data-action="delete" data-id="${esc(l.id)}"><i class="ti ti-trash"></i></button>
    </div>
  </div>`;
}

function openModal(id) {
  editId = id || null;
  const l = id ? links.find(x => x.id === id) : null;
  document.getElementById('modalTitle').textContent = l ? 'Edit link' : 'Add link';
  document.getElementById('mUrl').value = l ? l.url : '';
  document.getElementById('mTitle').value = l ? l.title : '';
  document.getElementById('mDesc').value = l ? l.desc : '';
  document.getElementById('mTags').value = l ? (l.tags || []).join(', ') : '';
  document.getElementById('mNewFolder').value = '';
  document.getElementById('mSubfolder').value = l ? (l.subfolder || '') : '';
  const mf = document.getElementById('mFolder');
  mf.innerHTML = '<option value="">No folder</option>' + allFolders().map(f => `<option value="${esc(f)}"${l&&l.folder===f?' selected':''}>${esc(f)}</option>`).join('');
  updateSubfolderDatalist();
  document.getElementById('dupWarning').style.display = 'none';
  document.getElementById('modalBg').style.display = 'flex';
  setTimeout(() => document.getElementById('mUrl').focus(), 50);
}
function closeModal() { document.getElementById('modalBg').style.display = 'none'; document.getElementById('dupWarning').style.display = 'none'; editId = null; }
function autoTitle() {
  const u = document.getElementById('mUrl').value.trim();
  const t = document.getElementById('mTitle');
  if (!t.value && u && !/^https?:\/\//i.test(u)) {
    try { t.value = new URL(u).hostname.replace('www.', ''); } catch {}
  }
}

async function fetchPageTitle() {
  if (editId) return;
  const u = document.getElementById('mUrl').value.trim();
  const t = document.getElementById('mTitle');
  if (!u || !/^https?:\/\//i.test(u)) return;
  if (t.value) return;
  const wrap = document.getElementById('titleWrap');
  wrap.classList.add('fetching');
  try {
    const res = await fetch('/api/fetch-title?url=' + encodeURIComponent(u));
    const data = await res.json();
    if (!t.value && data.title) t.value = data.title;
  } catch {}
  wrap.classList.remove('fetching');
}

function updateSubfolderDatalist() {
  const nf = document.getElementById('mNewFolder').value.trim();
  const selectedFolder = nf || document.getElementById('mFolder').value || '';
  const subs = selectedFolder ? subfoldersByFolder(selectedFolder) : [];
  const dl = document.getElementById('subfolderList');
  dl.innerHTML = subs.map(s => `<option value="${esc(s)}">`).join('');
}

// --- Tag autocomplete (add/edit modal) -------------------------------------
// Suggests existing tags for the comma-separated segment currently being typed,
// excluding tags already entered in the field.
let tagSuggestMatches = [];
let tagSuggestIndex = -1;
function onTagInput() {
  const input = document.getElementById('mTags');
  const box = document.getElementById('tagSuggest');
  const parts = input.value.split(',');
  const seg = parts[parts.length - 1].trim().toLowerCase();
  const used = new Set(parts.slice(0, -1).map(t => t.trim().toLowerCase()).filter(Boolean));
  tagSuggestMatches = allTags()
    .filter(t => !used.has(t.toLowerCase()) && (!seg || t.toLowerCase().includes(seg)))
    .slice(0, 8);
  if (!tagSuggestMatches.length) return hideTagSuggest();
  tagSuggestIndex = -1;
  box.innerHTML = tagSuggestMatches.map((t, i) =>
    `<div class="tag-suggest-item" data-i="${i}"><i class="ti ti-tag" style="color:${getTagColor(t) || 'var(--g3)'}"></i>${esc(t)}</div>`
  ).join('');
  box.querySelectorAll('.tag-suggest-item').forEach(el =>
    el.addEventListener('mousedown', e => { e.preventDefault(); pickTagSuggest(+el.dataset.i); })
  );
  box.classList.add('open');
}
function pickTagSuggest(i) {
  const tag = tagSuggestMatches[i];
  if (tag == null) return;
  const input = document.getElementById('mTags');
  const parts = input.value.split(',');
  parts[parts.length - 1] = ' ' + tag;
  input.value = parts.join(',').replace(/^\s+/, '') + ', ';
  input.focus();
  hideTagSuggest();
}
function onTagKeydown(e) {
  const box = document.getElementById('tagSuggest');
  if (!box.classList.contains('open')) return;
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    tagSuggestIndex = Math.min(tagSuggestIndex + 1, tagSuggestMatches.length - 1);
    highlightTagSuggest();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    tagSuggestIndex = Math.max(tagSuggestIndex - 1, 0);
    highlightTagSuggest();
  } else if (e.key === 'Enter' && tagSuggestIndex >= 0) {
    e.preventDefault();
    pickTagSuggest(tagSuggestIndex);
  } else if (e.key === 'Escape') {
    e.stopPropagation(); // close the dropdown without closing the modal
    hideTagSuggest();
  }
}
function highlightTagSuggest() {
  document.querySelectorAll('#tagSuggest .tag-suggest-item')
    .forEach((el, i) => el.classList.toggle('active', i === tagSuggestIndex));
}
function hideTagSuggest() {
  const box = document.getElementById('tagSuggest');
  if (box) box.classList.remove('open');
  tagSuggestIndex = -1;
}

function saveLink() {
  const url = document.getElementById('mUrl').value.trim();
  const title = document.getElementById('mTitle').value.trim();
  if (!url || !title) { alert('URL and title are required.'); return; }
  const nf = document.getElementById('mNewFolder').value.trim();
  const folder = nf || document.getElementById('mFolder').value || '';
  const subfolder = document.getElementById('mSubfolder').value.trim() || null;
  const tags = document.getElementById('mTags').value.split(',').map(t => t.trim()).filter(Boolean);
  const desc = document.getElementById('mDesc').value.trim();
  if (!editId) {
    const dup = links.find(l => !l.archived && l.url.trim().toLowerCase() === url.toLowerCase());
    if (dup) {
      const w = document.getElementById('dupWarning');
      document.getElementById('dupWarningMsg').innerHTML = `A link with this URL already exists — <strong>${esc(dup.title)}</strong>`;
      w.style.display = 'flex';
      return;
    }
  }
  if (editId) {
    const i = links.findIndex(l => l.id === editId);
    if (i > -1) {
      const urlChanged = links[i].url !== url;
      links[i] = { ...links[i], url, title, desc, folder, subfolder, tags };
      if (urlChanged) captureSnapshot(editId, url);
    }
  } else {
    const newId = Date.now().toString(36) + Math.random().toString(36).slice(2);
    links.unshift({ id: newId, url, title, desc, folder, subfolder, tags });
    captureSnapshot(newId, url);
  }
  const wasEditing = !!editId;
  save(); closeModal(); render();
  showToast(wasEditing ? 'Link updated' : 'Link saved');
}
function addLinkAnyway() {
  const url = document.getElementById('mUrl').value.trim();
  const title = document.getElementById('mTitle').value.trim();
  const nf = document.getElementById('mNewFolder').value.trim();
  const folder = nf || document.getElementById('mFolder').value || '';
  const subfolder = document.getElementById('mSubfolder').value.trim() || null;
  const tags = document.getElementById('mTags').value.split(',').map(t => t.trim()).filter(Boolean);
  const desc = document.getElementById('mDesc').value.trim();
  const newId = Date.now().toString(36) + Math.random().toString(36).slice(2);
  links.unshift({ id: newId, url, title, desc, folder, subfolder, tags });
  captureSnapshot(newId, url);
  save(); closeModal(); render();
  showToast('Link saved');
}
function copyUrl(url, btn) {
  navigator.clipboard.writeText(url).then(() => {
    const icon = btn.querySelector('i');
    icon.className = 'ti ti-check';
    btn.style.color = 'var(--g3)';
    setTimeout(() => { icon.className = 'ti ti-copy'; btn.style.color = ''; }, 1500);
  });
}
function editLink(id) { openModal(id); }
function deleteLink(id) {
  commitPendingMove();
  if (pendingDelete) { clearTimeout(pendingDelete.timer); save(); }
  const saved = links.slice();
  links = links.filter(l => l.id !== id);
  render();
  pendingDelete = {
    saved,
    timer: setTimeout(() => { pendingDelete = null; save(); }, 5000)
  };
  showUndoToast('Link deleted — Undo?');
}

function openImport() {
  parsedBookmarks = [];
  document.getElementById('importPreviewWrap').style.display = 'none';
  document.getElementById('importBtn').style.display = 'none';
  document.getElementById('dropZone').style.display = '';
  document.getElementById('fileIn').value = '';
  document.getElementById('impTags').value = '';
  document.getElementById('impNewFolder').value = '';
  const fs = document.getElementById('impFolder');
  fs.innerHTML = '<option value="">No folder</option>' + allFolders().map(f => `<option value="${esc(f)}">${esc(f)}</option>`).join('');
  document.getElementById('importBg').style.display = 'flex';
}
function closeImport() { document.getElementById('importBg').style.display = 'none'; }
function handleDrop(e) { e.preventDefault(); document.getElementById('dropZone').classList.remove('drag'); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }
function handleFile(file) { if (!file) return; const r = new FileReader(); r.onload = e => parseBookmarks(e.target.result); r.readAsText(file); }
function parseBookmarks(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const res = [];
  function walk(dl, path) {
    for (const ch of (dl ? dl.children : [])) {
      if (ch.tagName !== 'DT') continue;
      const a = ch.querySelector(':scope > A'), h3 = ch.querySelector(':scope > H3'), dl2 = ch.querySelector(':scope > DL');
      if (a) { const u = a.getAttribute('HREF') || '', t = a.textContent.trim() || getDomain(u); if (u && !u.startsWith('javascript:') && !u.startsWith('place:') && !u.startsWith('data:')) res.push({ url: u, title: t, folder: path }); }
      else if (h3 && dl2) { const n = h3.textContent.trim(); const skip = ['Bookmarks bar','Bookmarks Bar','Bookmarks toolbar','Bookmarks Toolbar','Other bookmarks','Other Bookmarks','Mobile bookmarks','Mobile Bookmarks']; walk(dl2, skip.includes(n) ? path : (path ? path + ' / ' + n : n)); }
    }
  }
  walk(doc.querySelector('DL'), '');
  if (!res.length) { alert('No bookmarks found. Make sure this is a valid browser bookmark export.'); return; }
  parsedBookmarks = res; showPreview();
}
function showPreview() {
  document.getElementById('dropZone').style.display = 'none';
  document.getElementById('importPreviewWrap').style.display = 'flex';
  document.getElementById('importBtn').style.display = 'flex';
  document.getElementById('importCount').textContent = parsedBookmarks.length + ' bookmarks found';
  document.getElementById('importPreview').innerHTML = parsedBookmarks.map((b, i) => `
    <div class="import-row"><input type="checkbox" id="imp_${i}" checked>
      <div class="import-row-info"><div class="import-row-title">${esc(b.title)}</div><div class="import-row-url">${esc(b.url)}</div></div>
      ${b.folder ? `<span class="import-row-folder">${esc(b.folder)}</span>` : ''}
    </div>`).join('');
}
function toggleAll(v) { parsedBookmarks.forEach((_, i) => { const c = document.getElementById('imp_' + i); if (c) c.checked = v; }); }
function doImport() {
  const of2 = document.getElementById('impNewFolder').value.trim() || document.getElementById('impFolder').value || '';
  const et = document.getElementById('impTags').value.split(',').map(t => t.trim()).filter(Boolean);
  const eu = new Set(links.map(l => l.url.toLowerCase()));
  let added = 0, skipped = 0;
  parsedBookmarks.forEach((b, i) => {
    const cb = document.getElementById('imp_' + i);
    if (!cb || !cb.checked) return;
    if (eu.has(b.url.toLowerCase())) { skipped++; return; }
    links.unshift({ id: Date.now().toString(36) + Math.random().toString(36).slice(2) + i, url: b.url, title: b.title, desc: '', folder: of2 || b.folder || '', tags: [...et] });
    eu.add(b.url.toLowerCase()); added++;
  });
  save(); closeImport(); render();
  showToast(`${added} links imported${skipped ? ', ' + skipped + ' duplicates skipped' : ''}`);
}

const THEMES = {
  Green:  { g1:'#E1F5EE', g2:'#9FE1CB', g3:'#5DCAA5', g4:'#1D9E75', g5:'#0F6E56', g6:'#085041', glow:'rgba(var(--g4-rgb),.15)' },
  Blue:   { g1:'#DBEAFE', g2:'#93C5FD', g3:'#60A5FA', g4:'#2563EB', g5:'#1E40AF', g6:'#1E3A8A', glow:'rgba(37,99,235,.15)' },
  Purple: { g1:'#EDE9FE', g2:'#C4B5FD', g3:'#A78BFA', g4:'#7C3AED', g5:'#6D28D9', g6:'#4C1D95', glow:'rgba(124,58,237,.15)' },
  Teal:   { g1:'#CCFBF1', g2:'#5EEAD4', g3:'#2DD4BF', g4:'#0D9488', g5:'#0F766E', g6:'#115E59', glow:'rgba(13,148,136,.15)' },
  Orange: { g1:'#FEF3C7', g2:'#FCD34D', g3:'#F59E0B', g4:'#D97706', g5:'#B45309', g6:'#92400E', glow:'rgba(217,119,6,.15)' },
  Red:    { g1:'#FEE2E2', g2:'#FCA5A5', g3:'#F87171', g4:'#DC2626', g5:'#B91C1C', g6:'#7F1D1D', glow:'rgba(220,38,38,.15)' },
};

const MODES = {
  dark:  { bg0:'#0d1117', bg1:'#161b22', bg2:'#1c2128', bg3:'#21262d', text0:'#e6edf3', text1:'#8b949e', text2:'#6e7681', border0:'#30363d', overlay:'rgba(255,255,255,.07)', stripe:'rgba(255,255,255,.02)', ring:'rgba(255,255,255,.2)' },
  light: { bg0:'#f6f8fa', bg1:'#ffffff', bg2:'#eef1f4', bg3:'#e3e7ec', text0:'#1f2328', text1:'#57606a', text2:'#7a828c', border0:'#d0d7de', overlay:'rgba(0,0,0,.06)', stripe:'rgba(0,0,0,.025)', ring:'rgba(0,0,0,.15)' },
};
function resolveMode(m) {
  return m === 'auto'
    ? (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
    : m;
}
function applyMode(mode, save = true) {
  themeMode = mode;
  localStorage.setItem('msp-mode', mode);
  const m = MODES[resolveMode(mode)] || MODES.dark;
  const r = document.documentElement.style;
  Object.entries(m).forEach(([k, v]) => r.setProperty('--' + k, v));
  document.querySelectorAll('.mode-btn[data-mode]').forEach(el => el.classList.toggle('active', el.dataset.mode === mode));
  if (save) saveConfig();
}

function applyTheme(name, save = true) {
  const t = name === 'Custom' ? deriveAccent(customAccent) : (THEMES[name] || THEMES.Green);
  const r = document.documentElement.style;
  r.setProperty('--g1', t.g1); r.setProperty('--g2', t.g2); r.setProperty('--g3', t.g3);
  r.setProperty('--g4', t.g4); r.setProperty('--g5', t.g5); r.setProperty('--g6', t.g6);
  r.setProperty('--g4-glow', t.glow);
  r.setProperty('--g4-rgb', hexToRgb(t.g4));
  r.setProperty('--g5-rgb', hexToRgb(t.g5));
  currentTheme = name;
  localStorage.setItem('msp-theme', name);
  document.querySelectorAll('.theme-swatch').forEach(el => {
    el.classList.toggle('active', el.dataset.theme === name);
  });
  if (save) saveConfig();
}

function previewCustomAccent(hex) {
  customAccent = hex;
  localStorage.setItem('msp-accent', hex);
  applyTheme('Custom', false);
}
function setCustomAccent(hex) {
  customAccent = hex;
  localStorage.setItem('msp-accent', hex);
  applyTheme('Custom', true);
}

function openTheme() {
  const grid = document.getElementById('themeGrid');
  const presets = Object.entries(THEMES).map(([name, t]) => `
    <div class="theme-swatch${name===currentTheme?' active':''}" data-theme="${name}" onclick="applyTheme('${name}')">
      <div class="swatch-dot" style="background:linear-gradient(135deg,${t.g3},${t.g5})"></div>
      <span class="swatch-label">${name}</span>
    </div>`).join('');
  const custom = `
    <div class="theme-swatch${currentTheme==='Custom'?' active':''}" data-theme="Custom">
      <label class="swatch-dot" title="Pick any color" style="cursor:pointer;position:relative;overflow:hidden;display:block;background:conic-gradient(from 90deg,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)">
        <input type="color" value="${esc(customAccent)}" oninput="previewCustomAccent(this.value)" onchange="setCustomAccent(this.value)" style="position:absolute;left:-6px;top:-6px;width:48px;height:48px;opacity:0;cursor:pointer;border:none;padding:0;background:none">
      </label>
      <span class="swatch-label">Custom</span>
    </div>`;
  grid.innerHTML = presets + custom;
  document.querySelectorAll('.mode-btn[data-mode]').forEach(el => el.classList.toggle('active', el.dataset.mode === themeMode));
  renderBgControls();
  document.getElementById('themeBg').style.display = 'flex';
}
function closeTheme() { document.getElementById('themeBg').style.display = 'none'; }

function toggleSettings(e) {
  e.stopPropagation();
  document.getElementById('settingsMenu').classList.toggle('open');
}
function closeSettings() {
  document.getElementById('settingsMenu').classList.remove('open');
}
function toggleFilter(e) {
  e.stopPropagation();
  document.getElementById('filterMenu').classList.toggle('open');
}
function closeFilter() {
  document.getElementById('filterMenu').classList.remove('open');
}
function updateFilterBadge() {
  const ff = document.getElementById('folderFilter')?.value || '';
  const tf = document.getElementById('tagFilter')?.value || '';
  const stf = document.getElementById('statusFilter')?.value || '';
  const active = (ff ? 1 : 0) + (tf ? 1 : 0) + (stf ? 1 : 0) + (currentSort !== 'manual' ? 1 : 0);
  const badge = document.getElementById('filterBadge');
  if (!badge) return;
  badge.textContent = active;
  badge.style.display = active ? '' : 'none';
}
document.addEventListener('click', e => {
  hideContextMenu();
  closeSettings();
  if (!e.target.closest('#filterMenu') && !e.target.closest('#filterBtn')) closeFilter();
  if (!e.target.closest('.search-wrap')) hideSearchHistory();
  if (!e.target.closest('#folderColorPicker') && !e.target.closest('.folder-color-swatch') && !e.target.closest('.subfolder-color-swatch')) {
    closeFolderColorPicker();
  }
  if (!e.target.closest('#folderIconPicker') && !e.target.closest('.folder-icon-btn')) {
    closeFolderIconPicker();
  }
});

function clearSearch() {
  const s = document.getElementById('search');
  s.value = '';
  document.getElementById('searchClear').style.display = 'none';
  hideSearchHistory();
  render();
  s.focus();
}

function saveSearchTerm(term) {
  term = (term || '').trim();
  if (term.length < 2) return;
  searchHistory = [term, ...searchHistory.filter(t => t !== term)].slice(0, 8);
  localStorage.setItem('msp-search-history', JSON.stringify(searchHistory));
}

function showSearchHistory() {
  const el = document.getElementById('searchHistory');
  if (!searchHistory.length) return;
  el.innerHTML = searchHistory.map((t, i) => `
    <div class="search-history-item" data-term="${esc(t)}">
      <i class="ti ti-history"></i>
      <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(t)}</span>
      <button class="search-history-del" data-idx="${i}" title="Remove"><i class="ti ti-x"></i></button>
    </div>`).join('') +
    `<div class="search-history-clear">Clear history</div>`;
  el.querySelectorAll('.search-history-item').forEach(item => {
    item.addEventListener('mousedown', e => {
      if (e.target.closest('.search-history-del')) return;
      e.preventDefault();
      const s = document.getElementById('search');
      s.value = item.dataset.term;
      hideSearchHistory();
      render();
      document.getElementById('searchClear').style.display = '';
    });
  });
  el.querySelectorAll('.search-history-del').forEach(btn => {
    btn.addEventListener('mousedown', e => {
      e.preventDefault(); e.stopPropagation();
      searchHistory.splice(parseInt(btn.dataset.idx), 1);
      localStorage.setItem('msp-search-history', JSON.stringify(searchHistory));
      showSearchHistory();
    });
  });
  el.querySelector('.search-history-clear').addEventListener('mousedown', e => {
    e.preventDefault();
    searchHistory = [];
    localStorage.setItem('msp-search-history', JSON.stringify(searchHistory));
    hideSearchHistory();
  });
  el.classList.add('open');
}

function hideSearchHistory() {
  document.getElementById('searchHistory').classList.remove('open');
}

function anyModalOpen() {
  return !!document.querySelector('.modal-bg[style*="flex"]');
}
function openShortcuts() { document.getElementById('shortcutsBg').style.display = 'flex'; }
function closeShortcuts() { document.getElementById('shortcutsBg').style.display = 'none'; }

document.addEventListener('keydown', e => {
  const s = document.getElementById('search');
  const inInput = e.target.matches('input,textarea,select,[contenteditable]');

  if ((e.key === '/' || (e.ctrlKey && e.key === 'k')) && !inInput) {
    e.preventDefault();
    if (currentMode === 'home') {
      const hs = document.getElementById('homeSearch');
      if (hs) { hs.focus(); return; }
      setMode('manager'); // search widget is hidden — flip to manager so the search box is usable
    }
    s.focus();
    s.select();
  }

  if (e.key === 'Enter' && document.activeElement === s) {
    saveSearchTerm(s.value);
    hideSearchHistory();
  }

  if (e.key === 'Escape') {
    if (document.activeElement === s) { clearSearch(); s.blur(); return; }
    hideContextMenu();
    closeFolderColorPicker();
    closeFolderIconPicker();
    closeFilter();
    closeSettings();
    const feedsEl = document.getElementById('feedsBg');
    if (feedsEl && feedsEl.style.display === 'flex') closeFeedManager(); // routes through the homepage refresh
    ['modalBg','importBg','statsBg','folderMgrBg','tagMgrBg','shortcutsBg','themeBg','archiveBg'].forEach(id => {
      const el = document.getElementById(id);
      if (el && el.style.display === 'flex') el.style.display = 'none';
    });
  }

  if (inInput || anyModalOpen()) return;

  if (e.key === 'n') { e.preventDefault(); openModal(null); }
  if (e.key === '?') { e.preventDefault(); openShortcuts(); }

  if (activeCardId) {
    if (e.key === 'e') { e.preventDefault(); editLink(activeCardId); }
    if (e.key === 'f') { e.preventDefault(); toggleFavorite(activeCardId); }
    if (e.key === 'Delete') { e.preventDefault(); deleteLink(activeCardId); }
  }
});

function toggleFolder(name) {
  const contentEl = Array.from(document.querySelectorAll('.folder-content')).find(el => el.dataset.folder === name);
  const isCollapsed = collapsedFolders.has(name);

  if (!isCollapsed && contentEl) {
    if (contentEl.dataset.animating) return;
    contentEl.dataset.animating = '1';
    const chevron = Array.from(document.querySelectorAll('.folder-header')).find(el => el.dataset.folder === name)?.querySelector('.folder-chevron');
    if (chevron) chevron.classList.remove('open');
    contentEl.style.overflow = 'hidden';
    contentEl.style.maxHeight = contentEl.scrollHeight + 'px';
    contentEl.style.opacity = '1';
    requestAnimationFrame(() => {
      contentEl.style.transition = 'max-height 0.25s ease, opacity 0.2s ease';
      contentEl.style.maxHeight = '0';
      contentEl.style.opacity = '0';
    });
    setTimeout(() => {
      delete contentEl.dataset.animating;
      collapsedFolders.add(name);
      localStorage.setItem('msp-collapsed', JSON.stringify([...collapsedFolders]));
      render();
    }, 260);
    return;
  }

  if (isCollapsed) collapsedFolders.delete(name);
  else collapsedFolders.add(name);
  localStorage.setItem('msp-collapsed', JSON.stringify([...collapsedFolders]));
  render();

  if (isCollapsed) {
    const newEl = Array.from(document.querySelectorAll('.folder-content')).find(el => el.dataset.folder === name);
    if (newEl && !newEl.dataset.animating) {
      newEl.dataset.animating = '1';
      const height = newEl.scrollHeight;
      newEl.style.overflow = 'hidden';
      newEl.style.maxHeight = '0';
      newEl.style.opacity = '0';
      requestAnimationFrame(() => requestAnimationFrame(() => {
        newEl.style.transition = 'max-height 0.25s ease, opacity 0.2s ease';
        newEl.style.maxHeight = height + 'px';
        newEl.style.opacity = '1';
        setTimeout(() => {
          delete newEl.dataset.animating;
          newEl.style.maxHeight = '';
          newEl.style.overflow = '';
          newEl.style.transition = '';
          newEl.style.opacity = '';
        }, 260);
      }));
    }
  }
}

function collapseAll() {
  allFolders().forEach(f => collapsedFolders.add(f));
  localStorage.setItem('msp-collapsed', JSON.stringify([...collapsedFolders]));
  render();
}
function expandAll() {
  collapsedFolders.clear();
  localStorage.setItem('msp-collapsed', JSON.stringify([]));
  render();
}
function renameFolder(oldName, newName) {
  newName = newName.trim();
  if (!newName || newName === oldName) return;
  // Update all links
  links.forEach(l => { if (l.folder === oldName) l.folder = newName; });
  // Update folderColors
  if (folderColors[oldName]) {
    folderColors[newName] = folderColors[oldName];
    delete folderColors[oldName];
    localStorage.setItem('msp-folder-colors', JSON.stringify(folderColors));
  }
  // Update folderOrder
  if (folderOrder) {
    const idx = folderOrder.indexOf(oldName);
    if (idx > -1) folderOrder[idx] = newName;
    localStorage.setItem('msp-folder-order', JSON.stringify(folderOrder));
  }
  // Update collapsedFolders
  if (collapsedFolders.has(oldName)) {
    collapsedFolders.delete(oldName);
    collapsedFolders.add(newName);
    localStorage.setItem('msp-collapsed', JSON.stringify([...collapsedFolders]));
  }
  // Update folderIcons
  if (folderIcons[oldName]) {
    folderIcons[newName] = folderIcons[oldName];
    delete folderIcons[oldName];
    localStorage.setItem('msp-folder-icons', JSON.stringify(folderIcons));
  }
  // Migrate subfolder keys (collapsed state + colors) — they embed the folder name
  [['msp-subfolder-collapsed', collapsedSubfolders], ['msp-subfolder-colors', subfolderColors]].forEach(([lsKey, store]) => {
    Object.keys(store).forEach(key => {
      try {
        const parsed = JSON.parse(key);
        if (parsed[0] === oldName) {
          store[JSON.stringify([newName, parsed[1]])] = store[key];
          delete store[key];
        }
      } catch {}
    });
    localStorage.setItem(lsKey, JSON.stringify(store));
  });
  save();
  saveConfig();
}
function deleteFolder(name) {
  const count = links.filter(l => !l.archived && l.folder === name).length;
  if (!confirm(`Delete folder "${name}"? ${count} link${count !== 1 ? 's' : ''} will be moved to no folder.`)) return;
  links.forEach(l => { if (l.folder === name) { l.folder = ''; l.subfolder = null; } });
  delete folderColors[name];
  localStorage.setItem('msp-folder-colors', JSON.stringify(folderColors));
  delete folderIcons[name];
  localStorage.setItem('msp-folder-icons', JSON.stringify(folderIcons));
  if (folderOrder) {
    folderOrder = folderOrder.filter(f => f !== name);
    localStorage.setItem('msp-folder-order', JSON.stringify(folderOrder));
  }
  collapsedFolders.delete(name);
  localStorage.setItem('msp-collapsed', JSON.stringify([...collapsedFolders]));
  Object.keys(collapsedSubfolders).forEach(key => {
    try { if (JSON.parse(key)[0] === name) delete collapsedSubfolders[key]; } catch {}
  });
  localStorage.setItem('msp-subfolder-collapsed', JSON.stringify(collapsedSubfolders));
  Object.keys(subfolderColors).forEach(key => {
    try { if (JSON.parse(key)[0] === name) delete subfolderColors[key]; } catch {}
  });
  localStorage.setItem('msp-subfolder-colors', JSON.stringify(subfolderColors));
  save(); render(); saveConfig();
  showToast(`Folder "${name}" deleted`);
}
function deleteSubfolder(folderName, subName) {
  const count = links.filter(l => !l.archived && l.folder === folderName && l.subfolder === subName).length;
  if (!confirm(`Delete sub-folder "${subName}"? ${count} link${count !== 1 ? 's' : ''} will be moved to folder "${folderName}".`)) return;
  links.forEach(l => { if (l.folder === folderName && l.subfolder === subName) l.subfolder = null; });
  const key = JSON.stringify([folderName, subName]);
  delete collapsedSubfolders[key];
  localStorage.setItem('msp-subfolder-collapsed', JSON.stringify(collapsedSubfolders));
  delete subfolderColors[key];
  localStorage.setItem('msp-subfolder-colors', JSON.stringify(subfolderColors));
  save(); render(); saveConfig();
  showToast(`Sub-folder "${subName}" deleted`);
}

function startFolderRename(btn) {
  const header = btn.closest('.folder-header[data-folder]');
  if (!header) return;
  const oldName = header.dataset.folder;
  const nameSpan = header.querySelector('.folder-name');
  if (!nameSpan || header.querySelector('.folder-rename-input')) return;
  const input = document.createElement('input');
  input.type = 'text';
  input.value = oldName;
  input.className = 'folder-rename-input';
  input.style.cssText = 'height:22px;padding:0 6px;border-radius:5px;border:1px solid var(--g4);background:var(--bg2);color:var(--text0);font-size:13px;font-weight:500;font-family:inherit;width:140px';
  nameSpan.replaceWith(input);
  input.focus();
  input.select();
  let committed = false;
  function commit() {
    if (committed) return;
    committed = true;
    const newName = input.value.trim();
    if (newName && newName !== oldName) {
      renameFolder(oldName, newName);
      render();
    } else {
      input.replaceWith(nameSpan);
    }
  }
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { committed = true; input.replaceWith(nameSpan); }
  });
  input.addEventListener('blur', commit);
}
function renameSubfolder(folderName, oldName, newName) {
  newName = newName.trim();
  if (!newName || newName === oldName) return;
  links.forEach(l => { if (l.folder === folderName && l.subfolder === oldName) l.subfolder = newName; });
  const oldKey = JSON.stringify([folderName, oldName]);
  const newKey = JSON.stringify([folderName, newName]);
  if (collapsedSubfolders[oldKey] !== undefined) {
    collapsedSubfolders[newKey] = collapsedSubfolders[oldKey];
    delete collapsedSubfolders[oldKey];
    localStorage.setItem('msp-subfolder-collapsed', JSON.stringify(collapsedSubfolders));
  }
  if (subfolderColors[oldKey] !== undefined) {
    subfolderColors[newKey] = subfolderColors[oldKey];
    delete subfolderColors[oldKey];
    localStorage.setItem('msp-subfolder-colors', JSON.stringify(subfolderColors));
  }
  save();
  saveConfig();
}
function startSubfolderRename(btn) {
  const header = btn.closest('.subfolder-header');
  if (!header) return;
  const folderName = header.dataset.folder;
  const oldName = header.dataset.subfolder;
  const nameSpan = header.querySelector('.subfolder-title');
  if (!nameSpan || header.querySelector('.folder-rename-input')) return;
  const input = document.createElement('input');
  input.type = 'text';
  input.value = oldName;
  input.className = 'folder-rename-input';
  input.style.cssText = 'height:20px;padding:0 6px;border-radius:5px;border:1px solid var(--g4);background:var(--bg2);color:var(--text0);font-size:12px;font-weight:500;font-family:inherit;width:120px';
  nameSpan.replaceWith(input);
  input.focus();
  input.select();
  let committed = false;
  function commit() {
    if (committed) return;
    committed = true;
    const newName = input.value.trim();
    if (newName && newName !== oldName) { renameSubfolder(folderName, oldName, newName); render(); }
    else input.replaceWith(nameSpan);
  }
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { committed = true; input.replaceWith(nameSpan); }
  });
  input.addEventListener('blur', commit);
}

function toggleSubfolder(folderName, subfolder) {
  const key = JSON.stringify([folderName, subfolder]);
  collapsedSubfolders[key] = !collapsedSubfolders[key];
  localStorage.setItem('msp-subfolder-collapsed', JSON.stringify(collapsedSubfolders));
  render();
}

function setupCardListeners() {
  const content = document.getElementById('content');
  content.addEventListener('mouseover', e => {
    const card = e.target.closest('.card[data-id], .card-row[data-id]');
    activeCardId = card ? card.dataset.id : null;
  });
  content.addEventListener('mouseleave', () => { activeCardId = null; });
  content.addEventListener('click', e => {
    // In dashboard edit mode, tiles/links don't navigate — only the toolbar's
    // inline-onclick controls act (they fire independently of this delegate).
    if (dashboardEditMode) return;
    const tagChip = e.target.closest('.tag[data-tag]');
    if (tagChip) { filterByTag(tagChip.dataset.tag); return; }
    const btn = e.target.closest('[data-action]');
    if (btn) {
      const action = btn.dataset.action;
      const id = btn.dataset.id;
      if (action === 'copy') copyUrl(btn.dataset.url, btn);
      else if (action === 'edit') editLink(id);
      else if (action === 'archive') archiveLink(id);
      else if (action === 'delete') deleteLink(id);
      else if (action === 'favorite') toggleFavorite(id);
      else if (action === 'readlater') toggleReadLater(id);
      return;
    }
    const folderTile = e.target.closest('.home-folder-tile');
    if (folderTile) { openFolderFromHome(folderTile.dataset.folder); return; }
    const tile = e.target.closest('.home-tile');
    if (tile && tile.dataset.id) { openLink(tile.dataset.id, tile.dataset.url); return; }
    if (tile && tile.dataset.href) { window.open(tile.dataset.href, '_blank', 'noopener'); return; }
    const card = e.target.closest('.card[data-id], .card-row[data-id]');
    if (!card) return;
    if (card.classList.contains('select-mode')) toggleSelect(card.dataset.id);
    else openLink(card.dataset.id, card.dataset.url);
  });
  content.addEventListener('contextmenu', onContextMenu);
}

// Returns a fake anchor element positioned at the cursor, for the color/icon pickers.
function cursorAnchor(x, y) {
  return { getBoundingClientRect: () => ({ top: y, bottom: y, left: x, right: x, width: 0, height: 0 }) };
}
function copyLinkUrl(url) {
  navigator.clipboard.writeText(url).then(() => showToast('URL copied')).catch(() => showToast('Copy failed', true));
}
function filterByTag(tag) {
  if (currentMode !== 'manager') setMode('manager');
  const tf = document.getElementById('tagFilter');
  if (tf) tf.value = tag;
  updateFilterBadge();
  render();
}

function onContextMenu(e) {
  const tagEl = e.target.closest('.tag[data-tag]');
  if (tagEl) {
    const tag = tagEl.dataset.tag;
    e.preventDefault();
    showContextMenu(e.clientX, e.clientY, [
      { icon: 'ti-palette', label: 'Change color', action: () => openTagColorPicker(tag, cursorAnchor(e.clientX, e.clientY)) },
      { icon: 'ti-filter', label: 'Filter by this tag', action: () => filterByTag(tag) },
    ]);
    return;
  }
  const linkEl = e.target.closest('.card[data-id], .card-row[data-id], .home-tile[data-id]');
  const folderTile = e.target.closest('.home-folder-tile[data-folder]');
  const subHeader = e.target.closest('.subfolder-header[data-subfolder]');
  const folderHeader = e.target.closest('.folder-header[data-folder]');
  const anchor = cursorAnchor(e.clientX, e.clientY);
  let items = null;

  if (linkEl && linkEl.dataset.id) {
    const id = linkEl.dataset.id;
    const l = links.find(x => x.id === id);
    if (!l) return;
    items = [
      { icon: 'ti-external-link', label: 'Open', action: () => openLink(id, l.url) },
      { icon: 'ti-copy', label: 'Copy URL', action: () => copyLinkUrl(l.url) },
      { icon: 'ti-edit', label: 'Edit', action: () => editLink(id) },
      { icon: l.favorite ? 'ti-star-off' : 'ti-star', label: l.favorite ? 'Unfavorite' : 'Favorite', action: () => toggleFavorite(id) },
      { icon: l.readLater ? 'ti-bookmark-off' : 'ti-bookmark', label: l.readLater ? 'Remove from read later' : 'Read later', action: () => toggleReadLater(id) },
      { sep: true },
      { icon: 'ti-archive', label: 'Archive', action: () => archiveLink(id) },
      { icon: 'ti-trash', label: 'Delete', danger: true, action: () => deleteLink(id) },
    ];
  } else if (folderTile) {
    const f = folderTile.dataset.folder;
    items = [
      { icon: 'ti-folder-open', label: 'Open folder', action: () => openFolderFromHome(f) },
      { icon: 'ti-palette', label: 'Change color', action: () => openFolderColorPicker(f, anchor) },
      { icon: 'ti-photo', label: 'Change icon', action: () => openFolderIconPicker(f, anchor) },
      { sep: true },
      { icon: 'ti-trash', label: 'Delete folder', danger: true, action: () => deleteFolder(f) },
    ];
  } else if (subHeader) {
    const f = subHeader.dataset.folder, sf = subHeader.dataset.subfolder;
    items = [
      { icon: 'ti-pencil', label: 'Rename', action: () => startSubfolderRename(subHeader.querySelector('.folder-rename-btn')) },
      { icon: 'ti-palette', label: 'Change color', action: () => openSubfolderColorPicker(f, sf, anchor) },
    ];
  } else if (folderHeader) {
    const f = folderHeader.dataset.folder;
    items = [
      { icon: 'ti-pencil', label: 'Rename', action: () => startFolderRename(folderHeader.querySelector('.folder-rename-btn')) },
      { icon: 'ti-palette', label: 'Change color', action: () => openFolderColorPicker(f, anchor) },
      { icon: 'ti-photo', label: 'Change icon', action: () => openFolderIconPicker(f, anchor) },
      { sep: true },
      { icon: 'ti-trash', label: 'Delete folder', danger: true, action: () => deleteFolder(f) },
    ];
  }

  if (!items) return;
  e.preventDefault();
  showContextMenu(e.clientX, e.clientY, items);
}

function showContextMenu(x, y, items) {
  const menu = document.getElementById('ctxMenu');
  menu.innerHTML = items.map((it, i) => it.sep
    ? '<div class="ctx-sep"></div>'
    : `<button class="ctx-item${it.danger ? ' danger' : ''}" data-ctx="${i}"><i class="ti ${it.icon}"></i>${esc(it.label)}</button>`).join('');
  menu.querySelectorAll('[data-ctx]').forEach(btn => {
    btn.addEventListener('click', ev => { ev.stopPropagation(); hideContextMenu(); items[+btn.dataset.ctx].action(); });
  });
  menu.style.display = 'flex';
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';
  const rect = menu.getBoundingClientRect();
  if (rect.right > window.innerWidth - 8) menu.style.left = Math.max(8, x - rect.width) + 'px';
  if (rect.bottom > window.innerHeight - 8) menu.style.top = Math.max(8, y - rect.height) + 'px';
  menu.classList.add('open');
}
function hideContextMenu() {
  const menu = document.getElementById('ctxMenu');
  if (menu) { menu.classList.remove('open'); menu.style.display = 'none'; }
}

function setupDragListeners() {
  const content = document.getElementById('content');

  content.addEventListener('dragstart', e => {
    const wHandle = e.target.closest('.widget-drag-handle');
    if (wHandle) {
      const wrap = wHandle.closest('[data-widget-id]');
      if (!wrap) return;
      homeDrag = { type: 'widget', key: wrap.dataset.widgetId };
      dragId = null; dragFolder = null;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', homeDrag.key);
      setTimeout(() => wrap.classList.add('dragging'), 0);
      return;
    }
    const homeTile = e.target.closest('.home-tile[draggable="true"]');
    if (homeTile) {
      if (dashboardEditMode) return; // tile reorder is disabled while editing widgets
      if (homeTile.classList.contains('home-folder-tile')) {
        homeDrag = { type: 'folder', key: homeTile.dataset.folder };
      } else if (homeTile.dataset.id && homeTile.closest('[data-home-section="favorites"]')) {
        homeDrag = { type: 'fav', key: homeTile.dataset.id };
      } else { return; }
      dragId = null; dragFolder = null;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', homeDrag.key);
      setTimeout(() => homeTile.classList.add('dragging'), 0);
      return;
    }
    const handle = e.target.closest('.drag-handle');
    const folderHandle = e.target.closest('.folder-drag-handle');
    if (handle) {
      const card = handle.closest('.card[data-id]');
      if (!card) return;
      dragId = card.dataset.id;
      dragFolder = null;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', dragId);
      e.dataTransfer.setDragImage(card, 20, 20);
      setTimeout(() => card.classList.add('dragging'), 0);
    } else if (folderHandle) {
      const header = folderHandle.closest('.folder-header[data-folder]');
      if (!header) return;
      dragFolder = header.dataset.folder;
      dragId = null;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', dragFolder);
      e.dataTransfer.setDragImage(header, 20, 10);
      setTimeout(() => header.classList.add('dragging'), 0);
    }
  });

  content.addEventListener('dragover', e => {
    if (homeDrag && homeDrag.type === 'widget') {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const t = e.target.closest('.home-widget[data-widget-id]');
      const target = (t && t.dataset.widgetId !== homeDrag.key) ? t : null;
      if (target !== dragOverEl) {
        if (dragOverEl) dragOverEl.classList.remove('drag-over');
        dragOverEl = target;
        if (dragOverEl) dragOverEl.classList.add('drag-over');
      }
      return;
    }
    if (homeDrag) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      let target = null;
      if (homeDrag.type === 'folder') {
        const t = e.target.closest('.home-folder-tile');
        if (t && t.dataset.folder !== homeDrag.key) target = t;
      } else {
        const t = e.target.closest('.home-tile[data-id]');
        if (t && t.dataset.id !== homeDrag.key && t.closest('[data-home-section="favorites"]')) target = t;
      }
      if (target !== dragOverEl) {
        if (dragOverEl) dragOverEl.classList.remove('drag-over');
        dragOverEl = target;
        if (dragOverEl) dragOverEl.classList.add('drag-over');
      }
      return;
    }
    if (!dragId && !dragFolder) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    let newTarget = null;
    if (dragId) {
      const card = e.target.closest('.card[data-id], .card-row[data-id]');
      if (card && card.dataset.id !== dragId) {
        newTarget = card;
      } else if (!card) {
        const sfHeader = e.target.closest('.subfolder-header[data-subfolder]');
        if (sfHeader) {
          newTarget = sfHeader;
        } else {
          const header = e.target.closest('.folder-header[data-folder]');
          if (header) newTarget = header;
        }
      }
    } else if (dragFolder) {
      const header = e.target.closest('.folder-header[data-folder]');
      if (header && header.dataset.folder !== dragFolder) newTarget = header;
    }
    if (newTarget !== dragOverEl) {
      if (dragOverEl) dragOverEl.classList.remove('drag-over');
      dragOverEl = newTarget;
      if (dragOverEl) dragOverEl.classList.add('drag-over');
    }
  });

  content.addEventListener('dragleave', e => {
    if (!content.contains(e.relatedTarget)) {
      if (dragOverEl) dragOverEl.classList.remove('drag-over');
      dragOverEl = null;
    }
  });

  content.addEventListener('drop', e => {
    e.preventDefault();
    if (dragOverEl) dragOverEl.classList.remove('drag-over');
    document.querySelectorAll('.dragging').forEach(el => el.classList.remove('dragging'));
    if (homeDrag && homeDrag.type === 'widget') {
      const t = e.target.closest('.home-widget[data-widget-id]');
      if (t && t.dataset.widgetId !== homeDrag.key) {
        const d = ensureDashboard();
        const si = d.findIndex(w => w.id === homeDrag.key);
        const ti = d.findIndex(w => w.id === t.dataset.widgetId);
        if (si > -1 && ti > -1) {
          const [m] = d.splice(si, 1);
          d.splice(ti, 0, m);
          persistDashboard(); render();
        }
      }
      homeDrag = null; dragOverEl = null;
      return;
    }
    if (homeDrag) {
      if (homeDrag.type === 'folder') {
        const t = e.target.closest('.home-folder-tile');
        if (t && t.dataset.folder !== homeDrag.key) {
          const names = getOrderedFolders(allFolders());
          const si = names.indexOf(homeDrag.key), ti = names.indexOf(t.dataset.folder);
          if (si > -1 && ti > -1) {
            names.splice(si, 1);
            names.splice(ti, 0, homeDrag.key);
            folderOrder = names;
            localStorage.setItem('msp-folder-order', JSON.stringify(folderOrder));
            render();
            saveConfig();
          }
        }
      } else {
        const t = e.target.closest('.home-tile[data-id]');
        if (t && t.dataset.id !== homeDrag.key && t.closest('[data-home-section="favorites"]')) {
          reorderFavorite(homeDrag.key, t.dataset.id);
        }
      }
      homeDrag = null; dragOverEl = null;
      return;
    }
    if (dragId) {
      const card = e.target.closest('.card[data-id], .card-row[data-id]');
      const sfHeader = e.target.closest('.subfolder-header[data-subfolder]');
      const header = !sfHeader ? e.target.closest('.folder-header[data-folder]') : null;
      if (card && card.dataset.id !== dragId) {
        if (pendingDelete) { clearTimeout(pendingDelete.timer); save(); pendingDelete = null; }
        commitPendingMove();
        const saved = links.slice();
        const srcIdx = links.findIndex(l => l.id === dragId);
        const tgtLink = links.find(l => l.id === card.dataset.id);
        const [moved] = links.splice(srcIdx, 1);
        const destFolder = tgtLink.folder || '';
        moved.folder = destFolder;
        moved.subfolder = tgtLink.subfolder || null;
        const newTgt = links.findIndex(l => l.id === card.dataset.id);
        links.splice(newTgt, 0, moved);
        render();
        pendingMove = { saved, timer: setTimeout(() => { pendingMove = null; save(); }, 5000) };
        showUndoToast(`Moved to "${destFolder || 'no folder'}" — Undo?`, 'ti-arrows-move');
      } else if (sfHeader) {
        const srcIdx = links.findIndex(l => l.id === dragId);
        if (srcIdx > -1) {
          if (pendingDelete) { clearTimeout(pendingDelete.timer); save(); pendingDelete = null; }
          commitPendingMove();
          const saved = links.slice();
          links[srcIdx].folder = sfHeader.dataset.folder;
          links[srcIdx].subfolder = sfHeader.dataset.subfolder;
          render();
          pendingMove = { saved, timer: setTimeout(() => { pendingMove = null; save(); }, 5000) };
          showUndoToast(`Moved to ${sfHeader.dataset.folder} / ${sfHeader.dataset.subfolder} — Undo?`, 'ti-arrows-move');
        }
      } else if (header) {
        const srcIdx = links.findIndex(l => l.id === dragId);
        if (srcIdx > -1) {
          if (pendingDelete) { clearTimeout(pendingDelete.timer); save(); pendingDelete = null; }
          commitPendingMove();
          const saved = links.slice();
          links[srcIdx].folder = header.dataset.folder;
          links[srcIdx].subfolder = null;
          render();
          pendingMove = { saved, timer: setTimeout(() => { pendingMove = null; save(); }, 5000) };
          showUndoToast(`Moved to "${header.dataset.folder}" — Undo?`, 'ti-arrows-move');
        }
      }
    } else if (dragFolder) {
      const header = e.target.closest('.folder-header[data-folder]');
      if (header && header.dataset.folder !== dragFolder) {
        const names = getOrderedFolders(allFolders());
        const si = names.indexOf(dragFolder), ti = names.indexOf(header.dataset.folder);
        if (si > -1 && ti > -1) {
          names.splice(si, 1);
          names.splice(ti, 0, dragFolder);
          folderOrder = names;
          localStorage.setItem('msp-folder-order', JSON.stringify(folderOrder));
          render();
          saveConfig();
        }
      }
    }
    dragId = null; dragFolder = null; dragOverEl = null;
  });

  content.addEventListener('dragend', () => {
    dragId = null; dragFolder = null; homeDrag = null;
    if (dragOverEl) dragOverEl.classList.remove('drag-over');
    dragOverEl = null;
    document.querySelectorAll('.dragging').forEach(el => el.classList.remove('dragging'));
  });
}

function exportLinks() {
  const rows = links.map(l => {
    const folder = l.folder || '';
    return { url: l.url, title: l.title, folder };
  });
  const folders = [...new Set(rows.map(r => r.folder))];
  let inner = '';
  folders.forEach(f => {
    const items = rows.filter(r => r.folder === f);
    const xmlEsc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    const itemsHtml = items.map(r => `        <DT><A HREF="${xmlEsc(r.url)}">${xmlEsc(r.title)}</A>`).join('\n');
    if (f) {
      inner += `    <DT><H3>${xmlEsc(f)}</H3>\n    <DL><p>\n${itemsHtml}\n    </DL><p>\n`;
    } else {
      inner += itemsHtml + '\n';
    }
  });
  const html = `<!DOCTYPE NETSCAPE-Bookmark-file-1>\n<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">\n<TITLE>Bookmarks</TITLE>\n<H1>Bookmarks</H1>\n<DL><p>\n${inner}</DL>`;
  const blob = new Blob([html], { type: 'text/html' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'msp-beacon-bookmarks.html';
  a.click();
  URL.revokeObjectURL(a.href);
  showToast('Bookmarks exported');
}

const style = document.createElement('style');
style.textContent = '@keyframes spin { to { transform: rotate(360deg); } }';
document.head.appendChild(style);

function toggleFavorite(id) {
  const l = links.find(x => x.id === id);
  if (!l) return;
  l.favorite = !l.favorite;
  save(); render();
}
function toggleReadLater(id) {
  const l = links.find(x => x.id === id);
  if (!l) return;
  l.readLater = !l.readLater;
  save(); render();
}

function toggleFavorites() {
  favoritesCollapsed = !favoritesCollapsed;
  localStorage.setItem('msp-fav-collapsed', JSON.stringify(favoritesCollapsed));
  render();
}

function toggleSelectMode() {
  selectMode = !selectMode;
  selectedIds.clear();
  document.getElementById('selectBtn').classList.toggle('active', selectMode);
  document.getElementById('bulkBar').classList.toggle('hidden', !selectMode);
  render();
  if (selectMode) updateBulkBar();
}

function exitSelectMode() {
  selectMode = false;
  selectedIds.clear();
  document.getElementById('selectBtn').classList.remove('active');
  document.getElementById('bulkBar').classList.add('hidden');
  render();
}

function toggleSelect(id) {
  if (selectedIds.has(id)) selectedIds.delete(id);
  else selectedIds.add(id);
  const card = document.querySelector(`.card[data-id="${id}"], .card-row[data-id="${id}"]`);
  if (card) {
    const sel = selectedIds.has(id);
    card.classList.toggle('selected', sel);
    const chk = card.querySelector('.card-check');
    if (chk) chk.classList.toggle('checked', sel);
  }
  updateBulkBar();
}

function selectAllVisible() {
  visibleIds.forEach(id => selectedIds.add(id));
  render(); updateBulkBar();
}

function clearSelection() {
  selectedIds.clear();
  render(); updateBulkBar();
}

function updateBulkBar() {
  const n = selectedIds.size;
  document.getElementById('bulkCount').textContent = n + ' selected';
  const mf = document.getElementById('bulkMoveFolder');
  mf.innerHTML = '<option value="">Move to folder…</option>'
    + allFolders().map(f => `<option value="${esc(f)}">${esc(f)}</option>`).join('')
    + '<option value="__none__">— Remove from folder</option>';
  document.getElementById('bulkMoveSubfolder').style.display = 'none';
  document.getElementById('bulkMoveConfirm').style.display = 'none';
  document.getElementById('bulkMoveSubfolder').value = '';
}

function onBulkFolderChange(sel) {
  if (!sel.value || sel.value === '__none__') {
    if (sel.value === '__none__' && selectedIds.size) {
      const n = selectedIds.size;
      links.forEach(l => { if (selectedIds.has(l.id)) { l.folder = ''; l.subfolder = null; } });
      sel.value = '';
      document.getElementById('bulkMoveSubfolder').style.display = 'none';
      document.getElementById('bulkMoveConfirm').style.display = 'none';
      save(); render(); updateBulkBar();
      showToast(`${n} link${n > 1 ? 's' : ''} moved`);
    } else {
      document.getElementById('bulkMoveSubfolder').style.display = 'none';
      document.getElementById('bulkMoveConfirm').style.display = 'none';
    }
    return;
  }
  const folder = sel.value;
  const subs = subfoldersByFolder(folder);
  const dl = document.getElementById('bulkSubfolderList');
  dl.innerHTML = subs.map(s => `<option value="${esc(s)}">`).join('');
  document.getElementById('bulkMoveSubfolder').style.display = '';
  document.getElementById('bulkMoveSubfolder').value = '';
  document.getElementById('bulkMoveConfirm').style.display = 'flex';
}

function confirmBulkMove() {
  const sel = document.getElementById('bulkMoveFolder');
  if (!sel.value || !selectedIds.size) { sel.value = ''; return; }
  if (pendingDelete) { clearTimeout(pendingDelete.timer); save(); pendingDelete = null; }
  commitPendingMove();
  const saved = links.slice();
  const n = selectedIds.size;
  const folder = sel.value;
  const subfolder = document.getElementById('bulkMoveSubfolder').value.trim() || null;
  links.forEach(l => { if (selectedIds.has(l.id)) { l.folder = folder; l.subfolder = subfolder; } });
  sel.value = '';
  document.getElementById('bulkMoveSubfolder').style.display = 'none';
  document.getElementById('bulkMoveConfirm').style.display = 'none';
  render(); updateBulkBar();
  const label = subfolder ? `${folder} / ${subfolder}` : folder;
  pendingMove = { saved, timer: setTimeout(() => { pendingMove = null; save(); }, 5000) };
  showUndoToast(`${n} link${n > 1 ? 's' : ''} moved to "${label}" — Undo?`, 'ti-arrows-move');
}

function bulkDelete() {
  if (!selectedIds.size) return;
  commitPendingMove();
  const n = selectedIds.size;
  if (pendingDelete) { clearTimeout(pendingDelete.timer); save(); }
  const saved = links.slice();
  links = links.filter(l => !selectedIds.has(l.id));
  selectedIds.clear();
  render(); updateBulkBar();
  pendingDelete = {
    saved,
    timer: setTimeout(() => { pendingDelete = null; save(); }, 5000)
  };
  showUndoToast(`${n} link${n > 1 ? 's' : ''} deleted — Undo?`);
}


function bulkAddTag() {
  const input = document.getElementById('bulkTagInput');
  const tag = input.value.trim();
  if (!tag || !selectedIds.size) return;
  const n = selectedIds.size;
  links.forEach(l => {
    if (selectedIds.has(l.id) && !(l.tags || []).includes(tag))
      l.tags = [...(l.tags || []), tag];
  });
  input.value = '';
  save(); render(); updateBulkBar();
  showToast(`Tag "${tag}" added to ${n} link${n > 1 ? 's' : ''}`);
}

function archiveLink(id) {
  const l = links.find(x => x.id === id);
  if (!l) return;
  commitPendingMove();
  if (pendingDelete) { clearTimeout(pendingDelete.timer); save(); pendingDelete = null; }
  l.archived = true;
  save(); render();
  showToast('Link archived');
}

function unarchiveLink(id) {
  const l = links.find(x => x.id === id);
  if (!l) return;
  delete l.archived;
  save(); render(); renderArchive();
  updateArchiveBadge();
  showToast('Link restored');
}

function permanentDeleteLink(id) {
  if (!confirm('Permanently delete this link? This cannot be undone.')) return;
  links = links.filter(l => l.id !== id);
  save(); renderArchive();
  updateArchiveBadge();
  showToast('Link permanently deleted');
}

function bulkArchive() {
  if (!selectedIds.size) return;
  commitPendingMove();
  if (pendingDelete) { clearTimeout(pendingDelete.timer); save(); pendingDelete = null; }
  const n = selectedIds.size;
  links.forEach(l => { if (selectedIds.has(l.id)) l.archived = true; });
  selectedIds.clear();
  save(); render(); updateBulkBar();
  showToast(`${n} link${n > 1 ? 's' : ''} archived`);
}

function updateArchiveBadge() {
  const count = links.filter(l => l.archived).length;
  const badge = document.getElementById('archiveBadge');
  if (!badge) return;
  badge.textContent = count;
  badge.style.display = count ? '' : 'none';
}

function openArchive() { renderArchive(); document.getElementById('archiveBg').style.display = 'flex'; }
function closeArchive() { document.getElementById('archiveBg').style.display = 'none'; }
function renderArchive() {
  const archived = links.filter(l => l.archived);
  const content = document.getElementById('archiveContent');
  if (!archived.length) {
    content.innerHTML = '<p style="text-align:center;color:var(--text2);padding:24px 16px">No archived links.</p>';
    return;
  }
  content.innerHTML = archived.map(l => `
    <div class="fmgr-row" style="gap:10px">
      <i class="ti ti-archive" style="color:var(--text2);font-size:14px;flex-shrink:0"></i>
      <div style="flex:1;min-width:0">
        <div class="fmgr-name">${esc(l.title)}</div>
        <div style="font-size:11px;color:var(--text2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(getDomain(l.url))}</div>
      </div>
      <div class="fmgr-actions" style="opacity:1">
        <button class="icon-btn" title="Restore" data-archive-id="${esc(l.id)}" data-archive-action="restore"><i class="ti ti-archive-off"></i></button>
        <button class="icon-btn" style="color:#E24B4A" title="Delete permanently" data-archive-id="${esc(l.id)}" data-archive-action="delete"><i class="ti ti-trash"></i></button>
      </div>
    </div>`).join('');
  content.querySelectorAll('[data-archive-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.archiveAction === 'restore') unarchiveLink(btn.dataset.archiveId);
      else permanentDeleteLink(btn.dataset.archiveId);
    });
  });
}

async function checkLinks() {
  const btn = document.getElementById('checkLinksBtn');
  if (!btn || btn.disabled) return;
  closeSettings();
  const ids = visibleIds.length ? visibleIds : links.map(l => l.id);
  if (!ids.length) { showToast('No links to check'); return; }
  btn.disabled = true;
  btn.innerHTML = '<i class="ti ti-loader" style="animation:spin 1s linear infinite"></i> Checking…';
  try {
    const params = ids.length ? '?ids=' + ids.map(encodeURIComponent).join(',') : '';
    const res = await fetch('/api/check-links' + params);
    if (!res.ok) throw new Error('Server error ' + res.status);
    const data = await res.json();
    Object.assign(linkStatus, data);
    render();
    const broken = Object.values(data).filter(s => s === 'broken' || s === 'timeout').length;
    if (broken === 0) showToast('All links OK');
    else showToast(`${broken} broken link${broken > 1 ? 's' : ''} found`, true);
  } catch (e) {
    showToast('Link check failed', true);
  }
  btn.disabled = false;
  btn.innerHTML = '<i class="ti ti-wifi"></i> Check links';
}

function openLink(id, url) {
  const l = links.find(x => x.id === id);
  if (l) { l.visits = (l.visits || 0) + 1; l.lastVisited = Date.now(); save(); }
  window.open(url, '_blank');
}
function timeAgo(ts) {
  if (!ts) return '';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  if (s < 2592000) return Math.floor(s / 86400) + 'd ago';
  return Math.floor(s / 2592000) + 'mo ago';
}

let statsNeverExpanded = false;
let statsScanning = false, statsScanDone = 0, statsScanTotal = 0;
function openStats() {
  statsNeverExpanded = false;
  renderStats();
  document.getElementById('statsBg').style.display = 'flex';
}
function closeStats() { document.getElementById('statsBg').style.display = 'none'; }
function statsOpen() { return document.getElementById('statsBg').style.display === 'flex'; }
function openStatLink(id) { const l = links.find(x => x.id === id); if (l) openLink(l.id, l.url); }

// Scan every web link's reachability for the Stats "Link Health" section. Chunked
// so the panel can show live progress instead of one long hanging request.
async function scanLinksForStats() {
  if (statsScanning) return;
  const ids = links.filter(l => !l.archived && /^https?:\/\//i.test(l.url)).map(l => l.id);
  if (!ids.length) { showToast('No web links to check'); return; }
  statsScanning = true; statsScanDone = 0; statsScanTotal = ids.length;
  const CHUNK = 25;
  // try/finally so statsScanning always resets — otherwise an unexpected throw
  // would leave the button stuck disabled until a reload.
  try {
    if (statsOpen()) updateHealthSection();
    for (let i = 0; i < ids.length; i += CHUNK) {
      const chunk = ids.slice(i, i + CHUNK);
      const res = await fetch('/api/check-links?ids=' + chunk.map(encodeURIComponent).join(','));
      if (res.ok) Object.assign(linkStatus, await res.json());
      statsScanDone = Math.min(i + CHUNK, ids.length);
      if (statsOpen()) updateHealthSection();
    }
    lastHomeStatusAt = Date.now();
  } catch { showToast('Link check failed', true); }
  finally {
    statsScanning = false;
    if (statsOpen()) updateHealthSection();
  }
}
// Builds just the Link Health section body so a scan can refresh it in place
// without re-rendering (and re-sorting/re-filtering) the entire Stats panel.
function renderHealthSection() {
  const webLinks = links.filter(l => !l.archived && /^https?:\/\//i.test(l.url));
  const downLinks = webLinks.filter(l => { const s = linkStatus[l.id]; return s === 'broken' || s === 'timeout'; });
  const checkedCount = webLinks.filter(l => linkStatus[l.id] !== undefined).length;
  const onlineCount = checkedCount - downLinks.length;
  const uncheckedCount = webLinks.length - checkedCount;
  // No web links → nothing to check, so don't offer the button or invite a scan.
  const healthBtn = webLinks.length === 0
    ? ''
    : statsScanning
    ? `<button class="stat-toggle" disabled style="opacity:.7"><i class="ti ti-loader" style="animation:spin 1s linear infinite"></i> Checking… ${statsScanDone}/${statsScanTotal}</button>`
    : `<button class="stat-toggle" onclick="scanLinksForStats()"><i class="ti ti-wifi"></i> ${checkedCount ? 'Re-check' : 'Check all'}</button>`;
  let healthBody;
  if (webLinks.length === 0) {
    healthBody = `<div style="font-size:13px;color:var(--text2)">No web links to check.</div>`;
  } else if (!checkedCount && !statsScanning) {
    healthBody = `<div style="font-size:13px;color:var(--text2)">Run a check to see which links are reachable.</div>`;
  } else {
    const downList = downLinks.length
      ? `<div class="stat-never-list" style="margin-top:6px">${downLinks.map(l => `
          <div class="stat-never-item" style="display:flex;align-items:center;gap:8px;cursor:pointer" onclick="openStatLink('${esc(l.id)}')" title="${esc(l.url)}">
            <i class="ti ti-alert-triangle" style="font-size:13px;color:#E24B4A;flex-shrink:0"></i>
            <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis">${esc(l.title)}</span>
            <span class="stat-row-sub">${linkStatus[l.id] === 'timeout' ? 'Timed out' : 'Broken'}</span>
          </div>`).join('')}</div>`
      : `<div style="font-size:13px;color:var(--g3);margin-top:4px">All checked links are online.</div>`;
    healthBody = `
      <div class="stat-summary" style="grid-template-columns:1fr 1fr 1fr">
        <div class="stat-summary-card"><div class="stat-summary-value" style="color:var(--g2)">${onlineCount}</div><div class="stat-summary-label">Online</div></div>
        <div class="stat-summary-card"><div class="stat-summary-value" style="color:#E24B4A">${downLinks.length}</div><div class="stat-summary-label">Issues</div></div>
        <div class="stat-summary-card"><div class="stat-summary-value" style="color:var(--text2)">${uncheckedCount}</div><div class="stat-summary-label">Unchecked</div></div>
      </div>
      ${downList}`;
  }
  return `
    <div class="stat-section-title" style="display:flex;align-items:center;justify-content:space-between">
      <span>Link Health</span>
      ${healthBtn}
    </div>
    ${healthBody}`;
}
function updateHealthSection() {
  const el = document.getElementById('statHealth');
  if (el) el.innerHTML = renderHealthSection();
}
function openFolderManager() {
  renderFolderManager();
  document.getElementById('folderMgrBg').style.display = 'flex';
}
function closeFolderManager() { document.getElementById('folderMgrBg').style.display = 'none'; }
function backupData() {
  closeSettings();
  const a = document.createElement('a');
  a.href = '/api/backup';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
function openRestore() {
  closeSettings();
  document.getElementById('restoreInput').click();
}
async function handleRestoreFile(input) {
  const file = input.files[0];
  if (!file) return;
  input.value = '';
  let text, backup;
  try { text = await file.text(); backup = JSON.parse(text); } catch { showToast('Invalid backup file'); return; }
  if (!backup.links || !Array.isArray(backup.links)) { showToast('Invalid backup file'); return; }
  const date = backup.exportedAt ? new Date(backup.exportedAt).toLocaleString() : 'unknown date';
  if (!confirm(`Restore ${backup.links.length} links from backup dated ${date}?\n\nThis will replace all current links and settings.`)) return;
  try {
    const res = await fetch('/api/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: text
    });
    if (res.ok) { showToast('Restore successful — reloading…'); setTimeout(() => location.reload(), 1500); }
    else showToast('Restore failed');
  } catch { showToast('Restore failed'); }
}
function renderFolderManager() {
  const folders = getOrderedFolders(allFolders());
  const content = document.getElementById('folderMgrContent');
  if (!folders.length) {
    content.innerHTML = '<p style="text-align:center;color:var(--text2);padding:24px 16px">No folders yet.</p>';
    return;
  }
  let html = '';
  folders.forEach(f => {
    const color = getFolderColor(f);
    const icon = getFolderIcon(f);
    const count = links.filter(l => !l.archived && l.folder === f).length;
    const subs = subfoldersByFolder(f);
    html += `<div class="fmgr-row">
      <i class="ti ${esc(icon)}" style="color:${esc(color)};font-size:15px;flex-shrink:0"></i>
      <span class="fmgr-name">${esc(f)}</span>
      <span class="fmgr-count">${count}</span>
      <div class="fmgr-actions">
        <button class="icon-btn" title="Rename" data-type="folder" data-folder="${esc(f)}" data-subfolder=""><i class="ti ti-pencil"></i></button>
        <button class="icon-btn" style="color:#E24B4A" title="Delete" data-type="folder" data-folder="${esc(f)}" data-subfolder=""><i class="ti ti-trash"></i></button>
      </div>
    </div>`;
    subs.forEach(sf => {
      const sfCount = links.filter(l => !l.archived && l.folder === f && l.subfolder === sf).length;
      html += `<div class="fmgr-row fmgr-subfolder">
        <i class="ti ti-corner-down-right" style="color:var(--text2);font-size:13px;flex-shrink:0"></i>
        <span class="fmgr-name">${esc(sf)}</span>
        <span class="fmgr-count">${sfCount}</span>
        <div class="fmgr-actions">
          <button class="icon-btn" title="Rename" data-type="subfolder" data-folder="${esc(f)}" data-subfolder="${esc(sf)}"><i class="ti ti-pencil"></i></button>
          <button class="icon-btn" style="color:#E24B4A" title="Delete" data-type="subfolder" data-folder="${esc(f)}" data-subfolder="${esc(sf)}"><i class="ti ti-trash"></i></button>
        </div>
      </div>`;
    });
  });
  content.innerHTML = html;
  content.querySelectorAll('[title="Rename"]').forEach(btn => btn.addEventListener('click', () => fmgrStartRename(btn)));
  content.querySelectorAll('[title="Delete"]').forEach(btn => btn.addEventListener('click', () => fmgrDeleteRow(btn)));
}
function fmgrStartRename(btn) {
  const type = btn.dataset.type;
  const folder = btn.dataset.folder;
  const subfolder = btn.dataset.subfolder;
  const oldName = type === 'folder' ? folder : subfolder;
  const row = btn.closest('.fmgr-row');
  const nameSpan = row.querySelector('.fmgr-name');
  const input = document.createElement('input');
  input.className = 'fmgr-input';
  input.value = oldName;
  nameSpan.replaceWith(input);
  input.focus(); input.select();
  let committed = false;
  function commit() {
    if (committed) return; committed = true;
    const newName = input.value.trim();
    if (newName && newName !== oldName) {
      if (type === 'folder') renameFolder(folder, newName);
      else renameSubfolder(folder, subfolder, newName);
      render();
    }
    renderFolderManager();
  }
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { committed = true; renderFolderManager(); }
  });
}
function fmgrDeleteRow(btn) {
  const type = btn.dataset.type;
  const folder = btn.dataset.folder;
  const subfolder = btn.dataset.subfolder;
  if (type === 'folder') deleteFolder(folder);
  else deleteSubfolder(folder, subfolder);
  renderFolderManager();
}
function renameTag(oldName, newName) {
  newName = newName.trim();
  if (!newName || newName === oldName) return;
  links.forEach(l => {
    if ((l.tags || []).includes(oldName)) {
      l.tags = l.tags.map(t => t === oldName ? newName : t);
    }
  });
  if (tagColors[oldName] !== undefined) {
    tagColors[newName] = tagColors[oldName];
    delete tagColors[oldName];
    localStorage.setItem('msp-tag-colors', JSON.stringify(tagColors));
    saveConfig();
  }
  save(); render();
}
function deleteTag(name) {
  const count = links.filter(l => !l.archived && (l.tags || []).includes(name)).length;
  if (!confirm(`Delete tag "${name}"? It will be removed from ${count} link${count !== 1 ? 's' : ''}.`)) return;
  links.forEach(l => { if (l.tags) l.tags = l.tags.filter(t => t !== name); });
  if (tagColors[name] !== undefined) {
    delete tagColors[name];
    localStorage.setItem('msp-tag-colors', JSON.stringify(tagColors));
    saveConfig();
  }
  save(); render();
  showToast(`Tag "${name}" deleted`);
}
function openTagManager() {
  renderTagManager();
  document.getElementById('tagMgrBg').style.display = 'flex';
}
function closeTagManager() { document.getElementById('tagMgrBg').style.display = 'none'; }
function renderTagManager() {
  const tags = allTags();
  const content = document.getElementById('tagMgrContent');
  if (!tags.length) {
    content.innerHTML = '<p style="text-align:center;color:var(--text2);padding:24px 16px">No tags yet.</p>';
    return;
  }
  content.innerHTML = tags.map(t => {
    const count = links.filter(l => !l.archived && (l.tags || []).includes(t)).length;
    return `<div class="fmgr-row">
      <i class="ti ti-tag" style="color:${getTagColor(t) || 'var(--g3)'};font-size:14px;flex-shrink:0"></i>
      <span class="fmgr-name">${esc(t)}</span>
      <span class="fmgr-count">${count}</span>
      <div class="fmgr-actions">
        <button class="icon-btn" title="Color" data-tagcolor="${esc(t)}"><i class="ti ti-palette"></i></button>
        <button class="icon-btn" title="Rename" data-tag="${esc(t)}"><i class="ti ti-pencil"></i></button>
        <button class="icon-btn" style="color:#E24B4A" title="Delete" data-tag="${esc(t)}"><i class="ti ti-trash"></i></button>
      </div>
    </div>`;
  }).join('');
  content.querySelectorAll('[data-tagcolor]').forEach(btn => btn.addEventListener('click', e => { e.stopPropagation(); openTagColorPicker(btn.dataset.tagcolor, btn); }));
  content.querySelectorAll('[title="Rename"]').forEach(btn => btn.addEventListener('click', () => tmgrStartRename(btn)));
  content.querySelectorAll('[title="Delete"]').forEach(btn => btn.addEventListener('click', () => {
    deleteTag(btn.dataset.tag);
    renderTagManager();
  }));
}
function tmgrStartRename(btn) {
  const oldName = btn.dataset.tag;
  const row = btn.closest('.fmgr-row');
  const nameSpan = row.querySelector('.fmgr-name');
  const input = document.createElement('input');
  input.className = 'fmgr-input';
  input.value = oldName;
  nameSpan.replaceWith(input);
  input.focus(); input.select();
  let committed = false;
  function commit() {
    if (committed) return; committed = true;
    const newName = input.value.trim();
    if (newName && newName !== oldName) renameTag(oldName, newName);
    renderTagManager();
  }
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { committed = true; renderTagManager(); }
  });
}
function openFeedManager() {
  renderFeedManager();
  document.getElementById('feedsBg').style.display = 'flex';
  setTimeout(() => document.getElementById('feedUrlInput').focus(), 50);
}
function closeFeedManager() {
  document.getElementById('feedsBg').style.display = 'none';
  if (currentMode === 'home') renderHome(); // reflect feed changes on the homepage
}
function addFeed() {
  const urlEl = document.getElementById('feedUrlInput');
  const nameEl = document.getElementById('feedNameInput');
  let url = urlEl.value.trim();
  if (!url) return;
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  try { new URL(url); } catch { showToast('Invalid feed URL', true); return; }
  if (rssFeeds.some(f => f.url === url)) { showToast('Feed already added'); return; }
  rssFeeds.push({ url, name: nameEl.value.trim() });
  localStorage.setItem('msp-rss-feeds', JSON.stringify(rssFeeds));
  saveConfig();
  urlEl.value = ''; nameEl.value = '';
  renderFeedManager();
  urlEl.focus();
}
function removeFeed(url) {
  rssFeeds = rssFeeds.filter(f => f.url !== url);
  localStorage.setItem('msp-rss-feeds', JSON.stringify(rssFeeds));
  saveConfig();
  renderFeedManager();
}
function renderFeedManager() {
  const content = document.getElementById('feedMgrContent');
  if (!rssFeeds.length) {
    content.innerHTML = '<p style="text-align:center;color:var(--text2);padding:24px 16px">No feeds yet. Add an RSS or Atom feed URL above.</p>';
    return;
  }
  content.innerHTML = rssFeeds.map(f => `<div class="fmgr-row">
      <i class="ti ti-rss" style="color:var(--g3);font-size:14px;flex-shrink:0"></i>
      <span class="fmgr-name" title="${esc(f.url)}">${esc(f.name || getDomain(f.url))}</span>
      <div class="fmgr-actions">
        <button class="icon-btn" style="color:#E24B4A" title="Remove" data-feed="${esc(f.url)}"><i class="ti ti-trash"></i></button>
      </div>
    </div>`).join('');
  content.querySelectorAll('[data-feed]').forEach(btn => btn.addEventListener('click', () => removeFeed(btn.dataset.feed)));
}
function resetStats() {
  if (!confirm('Reset all visit counts to zero?')) return;
  links.forEach(l => { l.visits = 0; });
  save();
  renderStats();
  showToast('Stats reset');
}
function renderStats() {
  const active = links.filter(l => !l.archived);
  const totalLinks = active.length;
  const totalVisits = active.reduce((s, l) => s + (l.visits || 0), 0);
  const sorted = active.slice().sort((a, b) => (b.visits || 0) - (a.visits || 0));
  const topMax = sorted[0] ? (sorted[0].visits || 0) : 1;
  const top10 = sorted.filter(l => (l.visits || 0) > 0).slice(0, 10);
  const never = active.filter(l => !(l.visits || 0));
  const avgVisits = totalLinks ? (totalVisits / totalLinks) : 0;
  const pctNever = totalLinks ? Math.round((never.length / totalLinks) * 100) : 0;
  const readLaterCount = active.filter(l => l.readLater).length;
  const archivedCount = links.filter(l => l.archived).length;

  const folders = allFolders();
  const noFolderCount = active.filter(l => !l.folder).length;
  const folderRows = folders.map(f => {
    const count = active.filter(l => l.folder === f).length;
    return `<div class="stat-row">
      <i class="ti ti-folder" style="font-size:13px;color:var(--g4);flex-shrink:0"></i>
      <span class="stat-row-label">${esc(f)}</span>
      <span class="stat-row-sub">${count} link${count !== 1 ? 's' : ''}</span>
    </div>`;
  }).join('');
  const noFolderRow = noFolderCount > 0 ? `<div class="stat-row">
    <i class="ti ti-minus" style="font-size:13px;color:var(--text2);flex-shrink:0"></i>
    <span class="stat-row-label" style="color:var(--text2)">No folder</span>
    <span class="stat-row-sub">${noFolderCount} link${noFolderCount !== 1 ? 's' : ''}</span>
  </div>` : '';

  const topRows = top10.length ? top10.map(l => `
    <div class="stat-row">
      <span class="stat-row-label">${esc(l.title)}</span>
      <div class="stat-bar-track"><div class="stat-bar-fill" style="width:${Math.round(((l.visits||0)/topMax)*100)}%"></div></div>
      <span class="stat-row-sub" style="min-width:44px;text-align:right">${l.visits} visit${l.visits !== 1 ? 's' : ''}</span>
    </div>`).join('') : `<div style="font-size:13px;color:var(--text2)">No links visited yet.</div>`;

  const neverList = statsNeverExpanded ? `<div class="stat-never-list">${never.map(l => `<div class="stat-never-item">${esc(l.title)}</div>`).join('')}</div>` : '';

  document.getElementById('statsContent').innerHTML = `
    <div class="stat-section">
      <div class="stat-section-title">Summary</div>
      <div class="stat-summary" style="grid-template-columns:1fr 1fr 1fr">
        <div class="stat-summary-card"><div class="stat-summary-value">${totalLinks}</div><div class="stat-summary-label">Total links</div></div>
        <div class="stat-summary-card"><div class="stat-summary-value">${totalVisits}</div><div class="stat-summary-label">Total visits</div></div>
        <div class="stat-summary-card"><div class="stat-summary-value">${avgVisits.toFixed(1)}</div><div class="stat-summary-label">Avg visits/link</div></div>
        <div class="stat-summary-card"><div class="stat-summary-value">${pctNever}%</div><div class="stat-summary-label">Never visited</div></div>
        <div class="stat-summary-card"><div class="stat-summary-value">${readLaterCount}</div><div class="stat-summary-label">Read later</div></div>
        <div class="stat-summary-card"><div class="stat-summary-value">${archivedCount}</div><div class="stat-summary-label">Archived</div></div>
      </div>
    </div>
    <div class="stat-section" id="statHealth">${renderHealthSection()}</div>
    <div class="stat-section">
      <div class="stat-section-title">By Folder</div>
      ${folderRows}${noFolderRow}
    </div>
    <div class="stat-section">
      <div class="stat-section-title">Top 10 Most Visited</div>
      ${topRows}
    </div>
    <div class="stat-section">
      <div class="stat-section-title" style="display:flex;align-items:center;justify-content:space-between">
        <span>Never Visited</span>
        ${never.length ? `<button class="stat-toggle" onclick="statsNeverExpanded=!statsNeverExpanded;renderStats()">${statsNeverExpanded ? 'Hide' : `Show ${never.length}`}</button>` : ''}
      </div>
      ${never.length === 0 ? `<div style="font-size:13px;color:var(--text2)">All links have been visited!</div>` : `<div style="font-size:13px;color:var(--text2)">${never.length} link${never.length !== 1 ? 's' : ''} never opened</div>`}
      ${neverList}
    </div>`;
}

const COLOR_PRESETS = ['#1D9E75','#2563EB','#7C3AED','#0D9488','#D97706','#DC2626','#DB2777','#0891B2','#65A30D','#6B7280'];
let colorPickerTarget = null; // { type: 'folder'|'subfolder', folder, sf? }

function renderColorPicker(anchorEl) {
  const picker = document.getElementById('folderColorPicker');
  const t = colorPickerTarget;
  const isSub = t.type === 'subfolder';
  const isTag = t.type === 'tag';
  const isDefault = (isSub && subfolderColors[subKey(t.folder, t.sf)] == null) || (isTag && tagColors[t.tag] == null);
  const current = isSub ? getSubfolderColor(t.folder, t.sf)
    : isTag ? (tagColors[t.tag] || accentColor())
    : getFolderColor(t.folder);
  const cur = String(current).toLowerCase();
  const presetMatch = COLOR_PRESETS.some(c => c.toLowerCase() === cur);
  let chips = COLOR_PRESETS.map(c =>
    `<div onclick="selectPickerColor('${c}')" style="width:24px;height:24px;border-radius:50%;background:${c};cursor:pointer;outline:${(!isDefault && c.toLowerCase() === cur) ? '2px solid #fff' : 'none'};outline-offset:2px"></div>`
  ).join('');
  // Custom color — opens the native color wheel; click anywhere on the rainbow chip
  chips += `<label title="Custom color…" style="width:24px;height:24px;border-radius:50%;cursor:pointer;position:relative;overflow:hidden;display:inline-block;background:conic-gradient(from 90deg,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00);outline:${(!isDefault && !presetMatch) ? '2px solid #fff' : 'none'};outline-offset:2px"><input type="color" value="${esc(current)}" onchange="selectPickerColor(this.value)" style="position:absolute;left:-5px;top:-5px;width:34px;height:34px;opacity:0;cursor:pointer;border:none;padding:0;background:none"></label>`;
  if (isSub || isTag) {
    chips += `<div onclick="resetPickerColor()" title="${isTag ? 'Default color' : 'Inherit folder color'}" style="width:24px;height:24px;border-radius:50%;background:var(--bg3);display:flex;align-items:center;justify-content:center;cursor:pointer;border:1px solid var(--border0);outline:${isDefault ? '2px solid #fff' : 'none'};outline-offset:2px"><i class="ti ti-rotate-2" style="font-size:13px;color:var(--text1)"></i></div>`;
  }
  picker.innerHTML = chips;
  picker.style.display = 'flex';
  const rect = anchorEl.getBoundingClientRect();
  picker.style.top = (rect.bottom + 6) + 'px';
  picker.style.left = Math.min(rect.right - 168, window.innerWidth - 180) + 'px';
}

function openFolderColorPicker(folderName, anchorEl) {
  colorPickerTarget = { type: 'folder', folder: folderName };
  renderColorPicker(anchorEl);
}

function openSubfolderColorPicker(folder, sf, anchorEl) {
  colorPickerTarget = { type: 'subfolder', folder, sf };
  renderColorPicker(anchorEl);
}

function openTagColorPicker(tag, anchorEl) {
  colorPickerTarget = { type: 'tag', tag };
  renderColorPicker(anchorEl);
}

function refreshOpenManagers() {
  if (document.getElementById('tagMgrBg').style.display === 'flex') renderTagManager();
  if (document.getElementById('folderMgrBg').style.display === 'flex') renderFolderManager();
}

function selectPickerColor(color) {
  if (!colorPickerTarget) return;
  const t = colorPickerTarget;
  if (t.type === 'subfolder') {
    subfolderColors[subKey(t.folder, t.sf)] = color;
    localStorage.setItem('msp-subfolder-colors', JSON.stringify(subfolderColors));
  } else if (t.type === 'tag') {
    tagColors[t.tag] = color;
    localStorage.setItem('msp-tag-colors', JSON.stringify(tagColors));
  } else {
    folderColors[t.folder] = color;
    localStorage.setItem('msp-folder-colors', JSON.stringify(folderColors));
  }
  closeFolderColorPicker();
  render();
  refreshOpenManagers();
  saveConfig();
}

function resetPickerColor() {
  if (!colorPickerTarget) return;
  const t = colorPickerTarget;
  if (t.type === 'subfolder') {
    delete subfolderColors[subKey(t.folder, t.sf)];
    localStorage.setItem('msp-subfolder-colors', JSON.stringify(subfolderColors));
  } else if (t.type === 'tag') {
    delete tagColors[t.tag];
    localStorage.setItem('msp-tag-colors', JSON.stringify(tagColors));
  } else return;
  closeFolderColorPicker();
  render();
  refreshOpenManagers();
  saveConfig();
}

function closeFolderColorPicker() {
  const picker = document.getElementById('folderColorPicker');
  if (picker) picker.style.display = 'none';
  colorPickerTarget = null;
}

const ICON_PRESETS = [
  'ti-folder','ti-server','ti-cloud','ti-code','ti-database','ti-shield',
  'ti-home','ti-tool','ti-star','ti-bookmark','ti-heart','ti-bolt',
  'ti-world','ti-mail','ti-chart-bar','ti-settings','ti-users','ti-file',
  'ti-camera','ti-music','ti-gamepad','ti-school','ti-briefcase','ti-rocket'
];
let iconPickerFolder = null;
function openFolderIconPicker(folderName, anchorEl) {
  iconPickerFolder = folderName;
  closeFolderColorPicker();
  const picker = document.getElementById('folderIconPicker');
  const current = getFolderIcon(folderName);
  const fc = getFolderColor(folderName);
  picker.innerHTML = ICON_PRESETS.map(ic =>
    `<div onclick="selectFolderIcon('${ic}')" title="${ic.replace('ti-','')}" style="width:32px;height:32px;border-radius:6px;background:${ic===current?'var(--g5)':'var(--bg3)'};display:flex;align-items:center;justify-content:center;cursor:pointer;border:1px solid ${ic===current?fc:'transparent'}"><i class="ti ${ic}" style="font-size:16px;color:${ic===current?'#fff':'var(--text1)'}"></i></div>`
  ).join('');
  picker.style.display = 'flex';
  const rect = anchorEl.getBoundingClientRect();
  picker.style.top = (rect.bottom + 6) + 'px';
  picker.style.left = Math.min(rect.left, window.innerWidth - 232) + 'px';
}
function selectFolderIcon(icon) {
  if (!iconPickerFolder) return;
  folderIcons[iconPickerFolder] = icon;
  localStorage.setItem('msp-folder-icons', JSON.stringify(folderIcons));
  closeFolderIconPicker();
  render();
  saveConfig();
}
function closeFolderIconPicker() {
  const picker = document.getElementById('folderIconPicker');
  if (picker) picker.style.display = 'none';
  iconPickerFolder = null;
}

applyMode(themeMode, false);
applyTheme(currentTheme, false);
if (window.matchMedia) {
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => { if (themeMode === 'auto') applyMode('auto', false); });
}
applyDensity(currentDensity);
document.getElementById('viewToggleIcon').className = currentView === 'grid' ? 'ti ti-layout-list' : 'ti ti-layout-grid';
updateDefaultViewLabel();
setupCardListeners();
setupDragListeners();
window.addEventListener('scroll', hideContextMenu, true);
window.addEventListener('resize', hideContextMenu);
setMode(defaultView, false);
loadLinks();
