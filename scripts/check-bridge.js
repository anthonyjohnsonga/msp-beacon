#!/usr/bin/env node
// ============================================================================
// check-bridge.js — guard the window bridge in public/js/app.js.
//
// app.js loads as <script type="module">, so top-level functions are NOT
// global. Inline on*="fn()" handlers (in index.html and the template strings of
// app.js AND every extracted module) call functions by NAME against window, so
// each such function must be re-exposed via the Object.assign(window, {...})
// bridge near the end of app.js. This script fails (exit 1) if:
//   1. an inline-handler function (defined in any module) is missing from the
//      bridge (dead button),
//   2. a bridged name resolves to nothing in app.js scope (throws at load), or
//   3. a handler's function NAME is interpolated rather than written literally
//      (`onclick="${expr}"`) — that hides the button from check 1 entirely.
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
// extracted module, not just app.js, so scan them all for handler calls. Names
// are kept alongside the source so check 3 can say which file to look in.
const moduleFiles = fs.readdirSync(jsDir)
  .filter(f => f.endsWith('.js'))
  .map(f => ({ name: 'js/' + f, src: fs.readFileSync(path.join(jsDir, f), 'utf8') }));
const moduleSrcs = moduleFiles.map(f => f.src);

// Names bound in app.js scope: declared functions + imported bindings. The
// Object.assign(window, {...}) block lives in app.js, so every bridged name
// must resolve to one of these or it's a ReferenceError at module load.
const declared = new Set();
for (const m of app.matchAll(/^(?:export )?(?:async )?function ([A-Za-z0-9_]+)/gm)) declared.add(m[1]);
const imported = new Set();
for (const m of app.matchAll(/^import\s*\{([^}]*)\}/gm))
  m[1].split(',').forEach(n => { n = n.trim().split(/\s+as\s+/).pop().trim(); if (n) imported.add(n); });
const boundInApp = new Set([...declared, ...imported]);

// Every function WE define across all modules. Inline handlers run in global
// scope, so any of our functions used in an on*= handler must be on the window
// bridge — even if it lives in a module and isn't imported into app.js. (Names
// not in this set are DOM/global builtins, which need no bridging.)
const ourFns = new Set();
for (const src of moduleSrcs)
  for (const m of src.matchAll(/^(?:export )?(?:async )?function ([A-Za-z0-9_]+)/gm)) ourFns.add(m[1]);

// The bridge name list.
const blockMatch = app.match(/Object\.assign\(window,\s*\{([\s\S]*?)\}\);/);
if (!blockMatch) { console.error('check-bridge: could not find Object.assign(window, {...}) block in app.js'); process.exit(1); }
const bridged = new Set(blockMatch[1].split(',').map(s => s.trim()).filter(Boolean));

// Function names referenced from inline on*="..." / on*='...' handlers across
// index.html and every JS module. We collect two ways: direct calls (`fn(`) and
// bare references (`setTimeout(fn, 150)` — a function passed without calling it).
// Both forms resolve `fn` in global scope, so either way it must be on the
// bridge. (The bare-reference scan skips property accesses like `this.value`.)
// The leading boundary also allows start-of-string and a quote/backtick, so a
// helper returning a bare `onclick="…"` fragment is scanned too, not just
// attributes sitting mid-tag after a space.
const ATTR_RES = [
  /(?:^|[\s"'`])(on[a-z]+)\s*=\s*"([^"]*)"/gim,
  /(?:^|[\s"'`])(on[a-z]+)\s*=\s*'([^']*)'/gim,
];
const files = [{ name: 'index.html', src: html }, ...moduleFiles];
const calledInHandlers = new Set();      // `fn(` — also drives the summary count
const referencedInHandlers = new Set();  // bare identifiers (not property accesses)
for (const { src } of files) {
  for (const re of ATTR_RES) {
    for (const m of src.matchAll(re)) {
      for (const c of m[2].matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)) calledInHandlers.add(c[1]);
      for (const c of m[2].matchAll(/(?<![.\w])([A-Za-z_][A-Za-z0-9_]*)/g)) referencedInHandlers.add(c[1]);
    }
  }
}

// Handlers whose function name is INTERPOLATED rather than literal. Checks 1-2
// work by reading names out of the source text, so `onclick="${expr}"` — an
// attribute assembled by a helper — is completely invisible to them: the button
// can call an unbridged function and this script still reports OK. Interpolated
// ARGUMENTS are fine (`lgAddSubmit('${w.id}',this)`); what must stay literal is
// the name being called. Detected by dropping every ${...} and checking whether
// a call survives.
const opaqueHandlers = [];
for (const { name, src } of files) {
  for (const re of ATTR_RES) {
    for (const m of src.matchAll(re)) {
      const value = m[2];
      if (!value.includes('${')) continue; // fully literal — checks 1-2 see it
      const literal = value.replace(/\$\{(?:[^{}]|\{[^{}]*\})*\}/g, '');
      if (/[A-Za-z_][A-Za-z0-9_]*\s*\(/.test(literal)) continue; // a literal call remains
      opaqueHandlers.push(`${name}: ${m[1]}="${value.length > 60 ? value.slice(0, 60) + '…' : value}"`);
    }
  }
}

// 1. Every inline-handler reference (a call OR a bare function-pass) that names
//    one of our functions (defined in ANY module, not just app.js) must be bridged.
const missing = [...new Set([...calledInHandlers, ...referencedInHandlers])].filter(n => ourFns.has(n) && !bridged.has(n)).sort();
// 2. Every bridged name must resolve to a binding in app.js scope.
const unbound = [...bridged].filter(n => !boundInApp.has(n)).sort();

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
if (opaqueHandlers.length) {
  ok = false;
  console.error('check-bridge: these handlers interpolate the function name, so this guard cannot see what they call:');
  opaqueHandlers.forEach(h => console.error('  ' + h));
  console.error('  -> write the handler literally, e.g. onclick="doThing(\'${id}\')" — interpolate the ARGUMENTS, not the name');
}
if (!ok) process.exit(1);
console.log(`check-bridge: OK — ${bridged.size} bridged names, all bound; ${calledInHandlers.size} distinct handler calls, none missing; every handler literal.`);
