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
// Boolean free-text operators: a leading - (or !) EXCLUDES a term (azure -billing),
// and an uppercase OR between terms makes them alternatives (azure OR aws).
// Anything not matching an operator stays free text (title/url/desc/tag + page-content search).
const SEARCH_FLAG_ALIASES = {
  favorite: 'favorite', fav: 'favorite', star: 'favorite', starred: 'favorite',
  readlater: 'readlater', unread: 'readlater', rl: 'readlater',
  broken: 'broken', down: 'broken', dead: 'broken',
  online: 'online', ok: 'online', up: 'online', healthy: 'online',
  untagged: 'untagged', notags: 'untagged',
  archived: 'archived', archive: 'archived',
};
// Free-text positives are parsed into conjunctive normal form: `clauses` is a list
// of OR-groups, ALL of which must match (AND), each group needing ANY one of its
// terms (OR). Plain space-separated terms become one single-term clause each
// (pure AND, as before); `OR` merges the two terms it sits between into one group.
// `exclude` holds terms that must NOT appear anywhere. `terms` is the flat list of
// positives (for highlighting + page-content search); `text` is those joined.
export function parseSearch(raw) {
  const tags = [], folders = [], flags = [], clauses = [], exclude = [];
  let orPending = false; // when set, the next positive term joins the previous clause
  const tokens = (raw || '').match(/(?:[^\s"]+|"[^"]*")+/g) || [];
  for (const tok of tokens) {
    if (tok === 'OR' || tok === '|') { if (clauses.length) orPending = true; continue; }
    if (tok === '-' || tok === '!') { orPending = false; continue; } // a bare operator char (mid-typing) is not a term

    const m = tok.match(/^([a-z]+):(.*)$/i);
    if (m) {
      const key = m[1].toLowerCase();
      const val = m[2].replace(/"/g, '').trim().toLowerCase();
      if (key === 'tag' && val) { tags.push(val); orPending = false; continue; }
      if (key === 'folder' && val) { folders.push(val); orPending = false; continue; }
      if (key === 'is' && SEARCH_FLAG_ALIASES[val]) { flags.push(SEARCH_FLAG_ALIASES[val]); orPending = false; continue; }
    }
    if ((tok[0] === '-' || tok[0] === '!') && tok.length > 1) { // exclusion
      const ex = tok.slice(1).replace(/"/g, '').toLowerCase();
      if (ex) exclude.push(ex);
      orPending = false;
      continue;
    }
    const t = tok.replace(/"/g, '').toLowerCase();
    if (!t) continue;
    if (orPending && clauses.length) clauses[clauses.length - 1].push(t);
    else clauses.push([t]);
    orPending = false;
  }
  const terms = clauses.flat();
  return { tags, folders, flags, clauses, exclude, terms, text: terms.join(' ').trim() };
}
// True if `term` appears in any of the link's searchable metadata fields. Used for
// exclusion (-term), which removes a link from every match source.
export function linkMatchesTerm(l, term) {
  if (!term) return false;
  return (l.title || '').toLowerCase().includes(term)
    || (l.url || '').toLowerCase().includes(term)
    || (l.desc || '').toLowerCase().includes(term)
    || linkPath(l).join(' ').toLowerCase().includes(term)
    || (l.tags || []).join(' ').toLowerCase().includes(term);
}

// Relevance ranking for the free-text positives. `clauses` is CNF (AND of
// OR-groups): every clause must contribute a match (else the link is rejected),
// and a clause scores by its best-matching alternative. A term scores by the
// highest-weight field it hits, plus a word-start bonus; a whole multi-word
// phrase in a high-value field earns an extra bonus. Exclusions are handled by
// the caller (linkMatchesTerm) so this stays purely about positives.
const FIELD_WEIGHTS = { title: 10, tags: 6, folder: 4, url: 2, desc: 2 };
export function scoreTextMatch(l, clauses, phrase) {
  if (!clauses || !clauses.length) return 0;
  const fields = {
    title: (l.title || '').toLowerCase(),
    tags: (l.tags || []).join(' ').toLowerCase(),
    folder: linkPath(l).join(' ').toLowerCase(),
    url: (l.url || '').toLowerCase(),
    desc: (l.desc || '').toLowerCase(),
  };
  let score = 0;
  for (const clause of clauses) {
    let clauseBest = 0;
    for (const term of clause) { // OR: take the best-scoring alternative
      for (const f in FIELD_WEIGHTS) {
        const idx = fields[f].indexOf(term);
        if (idx === -1) continue;
        let s = FIELD_WEIGHTS[f];
        if (idx === 0 || /\W/.test(fields[f][idx - 1])) s += FIELD_WEIGHTS[f] * 0.5; // word-start bonus
        if (s > clauseBest) clauseBest = s;
      }
    }
    if (clauseBest === 0) return 0; // this clause matched nothing → AND-of-clauses fails
    score += clauseBest;
  }
  if (phrase) { // reward an exact multi-word phrase hit (pure-AND queries only)
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
