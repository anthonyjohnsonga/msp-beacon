// ============================================================================
// search.js — search box: query parsing, operators, full-text content matching,
// and recent-search history.
// parseSearch/linkMatchesFlag are consumed by render() in app.js; the content
// match state (contentMatchIds/contentMatchQuery) is owned here and read there
// (live bindings). render() itself, the card "in page" badge (contentOnlyIds),
// and content INDEXING (captureSnapshot/indexAllContent) stay in app.js.
// ============================================================================

import { render, linkStatus } from './app.js';
import { esc } from './utils.js';

let searchHistory = JSON.parse(localStorage.getItem('msp-search-history') || '[]');
let searchDebounceTimer = null;
function debouncedRender() { clearTimeout(searchDebounceTimer); searchDebounceTimer = setTimeout(render, 150); }

// Full-text content search: server holds per-link page-text snapshots; we merge
// content matches into the normal search results.
export let contentMatchIds = new Set();   // link ids whose page text matches the current query
export let contentMatchQuery = '';        // query that contentMatchIds corresponds to
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
    terms.push(tok.replace(/"/g, '').toLowerCase());
  }
  return { tags, folders, flags, text: terms.join(' ').trim() };
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
