// ============================================================================
// search.js — search box: query parsing, operators, full-text content matching,
// and recent-search history.
// parseSearch/linkMatchesFlag are consumed by render() in app.js; the content
// match state (contentMatchIds/contentMatchQuery) is owned here and read there
// (live bindings). render() itself, the card "in page" badge (contentOnlyIds),
// and content INDEXING (captureSnapshot/indexAllContent) stay in app.js.
// ============================================================================

import { render, linkStatus } from './app.js';
import { esc, linkPath } from './utils.js';

let searchHistory = JSON.parse(localStorage.getItem('msp-search-history') || '[]');
let searchDebounceTimer = null;
function debouncedRender() { clearTimeout(searchDebounceTimer); searchDebounceTimer = setTimeout(render, 150); }

// Full-text content search: server holds per-link page-text snapshots; we merge
// content matches into the normal search results.
export let contentMatchIds = new Set();   // link ids whose page text matches the current query
export let contentMatchQuery = '';        // query that contentMatchIds corresponds to
export let contentMatchSnippets = {};     // id -> a short text window around the first page-text hit
let contentSearchTimer = null;
let contentSearchToken = 0;        // guards against out-of-order /api/search-content responses

// Search operators: tag:, folder:, is:<flag>. Quoted values supported (folder:"My Stuff").
// Anything not matching an operator stays free text (title/url/desc/tag + page-content search).
const SEARCH_FLAG_ALIASES = {
  favorite: 'favorite', fav: 'favorite', star: 'favorite', starred: 'favorite',
  readlater: 'readlater', unread: 'readlater', rl: 'readlater',
  broken: 'broken', down: 'broken', dead: 'broken',
  online: 'online', ok: 'online', up: 'online', healthy: 'online',
  untagged: 'untagged', notags: 'untagged',
  archived: 'archived', archive: 'archived',
};
export function parseSearch(raw) {
  const tags = [], folders = [], flags = [], terms = [];
  const tokens = (raw || '').match(/(?:[^\s"]+|"[^"]*")+/g) || [];
  for (const tok of tokens) {
    const m = tok.match(/^([a-z]+):(.*)$/i);
    if (m) {
      const key = m[1].toLowerCase();
      const val = m[2].replace(/"/g, '').trim().toLowerCase();
      if (key === 'tag' && val) { tags.push(val); continue; }
      if (key === 'folder' && val) { folders.push(val); continue; }
      if (key === 'is' && SEARCH_FLAG_ALIASES[val]) { flags.push(SEARCH_FLAG_ALIASES[val]); continue; }
    }
    const t = tok.replace(/"/g, '').toLowerCase();
    if (t) terms.push(t);
  }
  return { tags, folders, flags, text: terms.join(' ').trim(), terms };
}

// Relevance ranking for the free-text portion of a query. Each term must appear
// in at least one field (AND across terms, OR across fields) or the whole link
// is rejected — so word order no longer matters, unlike the old single
// concatenated-substring test. A term scores by the highest-weight field it hits,
// with a bonus when it starts a word (prefix) and when the full multi-word phrase
// appears contiguously in a high-value field. Higher score = more relevant.
const FIELD_WEIGHTS = { title: 10, tags: 6, folder: 4, url: 2, desc: 2 };
export function scoreTextMatch(l, terms, phrase) {
  if (!terms || !terms.length) return 0;
  const fields = {
    title: (l.title || '').toLowerCase(),
    tags: (l.tags || []).join(' ').toLowerCase(),
    folder: linkPath(l).join(' ').toLowerCase(),
    url: (l.url || '').toLowerCase(),
    desc: (l.desc || '').toLowerCase(),
  };
  let score = 0;
  for (const term of terms) {
    let best = 0;
    for (const f in FIELD_WEIGHTS) {
      const idx = fields[f].indexOf(term);
      if (idx === -1) continue;
      let s = FIELD_WEIGHTS[f];
      if (idx === 0 || /\W/.test(fields[f][idx - 1])) s += FIELD_WEIGHTS[f] * 0.5; // word-start bonus
      if (s > best) best = s;
    }
    if (best === 0) return 0; // term matched no field → AND fails, reject the link
    score += best;
  }
  if (phrase && terms.length > 1) { // reward exact multi-word phrase hits
    if (fields.title.includes(phrase)) score += 15;
    else if (fields.tags.includes(phrase) || fields.folder.includes(phrase)) score += 6;
  }
  return score;
}

// Levenshtein edit distance, bailing out early once the running minimum exceeds
// `max` (returns max+1 in that case). Used only by the fuzzy fallback below.
function editDistance(a, b, max) {
  const al = a.length, bl = b.length;
  if (Math.abs(al - bl) > max) return max + 1;
  let prev = new Array(bl + 1);
  for (let j = 0; j <= bl; j++) prev[j] = j;
  for (let i = 1; i <= al; i++) {
    const cur = [i];
    let best = i;
    const ac = a.charCodeAt(i - 1);
    for (let j = 1; j <= bl; j++) {
      const cost = ac === b.charCodeAt(j - 1) ? 0 : 1;
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      cur[j] = v;
      if (v < best) best = v;
    }
    if (best > max) return max + 1; // whole row over budget → give up
    prev = cur;
  }
  return prev[bl];
}

// How many edits a term of a given length may tolerate. Short terms demand an
// exact word (fuzzing 2-3 chars matches almost anything); longer ones allow more.
function fuzzTolerance(len) { return len <= 3 ? 0 : len <= 5 ? 1 : 2; }

// Typo-tolerant fallback scorer. Like scoreTextMatch but each term may match a
// field WORD within an edit-distance budget instead of exactly. AND semantics
// still hold (every term must fuzzy-match somewhere). Callers rank these below
// every strict result — this only runs when strict matching found too little.
const FUZZY_FIELDS = [['title', 10], ['tags', 6], ['folder', 4], ['url', 2], ['desc', 2]];
export function fuzzyScoreTextMatch(l, terms) {
  if (!terms || !terms.length) return 0;
  const raw = {
    title: (l.title || '').toLowerCase(),
    tags: (l.tags || []).join(' ').toLowerCase(),
    folder: linkPath(l).join(' ').toLowerCase(),
    url: (l.url || '').toLowerCase(),
    desc: (l.desc || '').toLowerCase(),
  };
  const words = {};
  for (const [f] of FUZZY_FIELDS) words[f] = raw[f].split(/[^a-z0-9]+/i).filter(Boolean);
  let score = 0;
  for (const term of terms) {
    const tol = fuzzTolerance(term.length);
    let best = 0;
    for (const [f, w] of FUZZY_FIELDS) {
      for (const word of words[f]) {
        if (Math.abs(word.length - term.length) > tol) continue;
        const d = editDistance(term, word, tol);
        if (d <= tol) {
          const s = w * (1 - d / (tol + 1)); // closer match → higher score
          if (s > best) best = s;
          if (d === 0) break;
        }
      }
    }
    if (best === 0) return 0; // this term fuzzy-matched nothing → AND fails
    score += best;
  }
  return score;
}
export function linkMatchesFlag(l, flag) {
  switch (flag) {
    case 'favorite': return !!l.favorite;
    case 'readlater': return !!l.readLater;
    case 'broken': return linkStatus[l.id] === 'broken' || linkStatus[l.id] === 'timeout';
    case 'online': return linkStatus[l.id] === 'ok';
    case 'untagged': return !((l.tags || []).length);
    default: return true; // 'archived' handled separately in render()
  }
}
export function onSearchInput(v) {
  debouncedRender();
  hideSearchHistory();
  clearTimeout(contentSearchTimer);
  contentSearchTimer = setTimeout(() => updateContentMatches(parseSearch(v).text), 300);
}
async function updateContentMatches(q) {
  const token = ++contentSearchToken; // any newer call (incl. a clear) supersedes us
  q = (q || '').trim().toLowerCase();
  if (q.length < 2) { contentMatchIds = new Set(); contentMatchSnippets = {}; contentMatchQuery = ''; render(); return; }
  try {
    const res = await fetch('/api/search-content?q=' + encodeURIComponent(q));
    if (!res.ok) return;
    const data = await res.json();
    if (token !== contentSearchToken) return; // a newer query/clear superseded us
    contentMatchIds = new Set(data.ids || []);
    contentMatchSnippets = data.snippets || {};
    contentMatchQuery = q;
    render();
  } catch { /* offline / no index — silently fall back to title/url search */ }
}

export function clearSearch() {
  const s = document.getElementById('search');
  s.value = '';
  document.getElementById('searchClear').style.display = 'none';
  hideSearchHistory();
  render();
  s.focus();
}

export function saveSearchTerm(term) {
  term = (term || '').trim();
  if (term.length < 2) return;
  searchHistory = [term, ...searchHistory.filter(t => t !== term)].slice(0, 8);
  localStorage.setItem('msp-search-history', JSON.stringify(searchHistory));
}

export function showSearchHistory() {
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

export function hideSearchHistory() {
  document.getElementById('searchHistory').classList.remove('open');
}
