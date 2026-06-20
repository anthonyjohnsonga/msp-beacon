#!/usr/bin/env node
// ============================================================================
// check-bridge.js — guard the window bridge in public/js/app.js.
//
// app.js loads as <script type="module">, so its top-level functions are NOT
// global. Inline on*="fn()" handlers (in app.js template strings and
// index.html) call functions by NAME against window, so each such function
// must be re-exposed via the Object.assign(window, {...}) bridge near the end
// of app.js. This script fails (exit 1) if:
//   1. an inline-handler function is missing from the bridge (dead button), or
//   2. a bridged name resolves to nothing (would throw at module load).
//
// Run: `node scripts/check-bridge.js`  (also wired as `npm run check`).
// ============================================================================
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', 'public');
const jsDir = path.join(root, 'js');
const appPath = path.join(jsDir, 'app.js');
const htmlPath = path.join(root, 'index.html');
const app = fs.readFileSync(appPath, 'utf8');
const html = fs.readFileSync(htmlPath, 'utf8');
// All ES modules — inline on*= handlers live in template strings across every
// extracted module, not just app.js, so scan them all for handler calls.
const moduleSrcs = fs.readdirSync(jsDir)
  .filter(f => f.endsWith('.js'))
  .map(f => fs.readFileSync(path.join(jsDir, f), 'utf8'));

// Names defined in app.js: declared functions + imported bindings.
const declared = new Set();
for (const m of app.matchAll(/^(?:export )?(?:async )?function ([A-Za-z0-9_]+)/gm)) declared.add(m[1]);
const imported = new Set();
for (const m of app.matchAll(/^import\s*\{([^}]*)\}/gm))
  m[1].split(',').forEach(n => { n = n.trim().split(/\s+as\s+/).pop().trim(); if (n) imported.add(n); });
const bound = new Set([...declared, ...imported]);

// The bridge name list.
const blockMatch = app.match(/Object\.assign\(window,\s*\{([\s\S]*?)\}\);/);
if (!blockMatch) { console.error('check-bridge: could not find Object.assign(window, {...}) block in app.js'); process.exit(1); }
const bridged = new Set(blockMatch[1].split(',').map(s => s.trim()).filter(Boolean));

// Function names called from inline on*="..." / on*='...' handlers across
// index.html and every JS module.
const calledInHandlers = new Set();
for (const src of [html, ...moduleSrcs]) {
  for (const re of [/\son[a-z]+\s*=\s*"([^"]*)"/g, /\son[a-z]+\s*=\s*'([^']*)'/g]) {
    for (const m of src.matchAll(re))
      for (const c of m[1].matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)) calledInHandlers.add(c[1]);
  }
}

// 1. Every inline-handler call that names one of our functions must be bridged.
const missing = [...calledInHandlers].filter(n => bound.has(n) && !bridged.has(n)).sort();
// 2. Every bridged name must resolve to a real binding.
const unbound = [...bridged].filter(n => !bound.has(n)).sort();

let ok = true;
if (missing.length) {
  ok = false;
  console.error('check-bridge: inline handlers call these functions, but they are NOT in the window bridge (dead buttons):');
  console.error('  ' + missing.join(', '));
  console.error('  -> add them to the Object.assign(window, {...}) block in app.js');
}
if (unbound.length) {
  ok = false;
  console.error('check-bridge: these names are in the bridge but not declared/imported in app.js (ReferenceError at load):');
  console.error('  ' + unbound.join(', '));
}
if (!ok) process.exit(1);
console.log(`check-bridge: OK — ${bridged.size} bridged names, all bound; ${calledInHandlers.size} distinct handler calls, none missing.`);
