#!/usr/bin/env node
// @ts-check
'use strict';

/**
 * Static require-graph analysis for the generated browser frontend entry.
 * Usage: node scripts/qaap-mobile-entry/qaap-mobile-graph-report.js [--json] [--fail-on-forbidden]
 *
 * Resolution uses require.resolve with `paths` (honours package "exports"/"main", not the legacy
 * "browser" field mapping, which is NOT applied). Parses require('x') / import('x') literals with a regex.
 */

const fs = require('fs');
const path = require('path');
const Module = require('module');
const { QAAP_MOBILE_EXCLUDED_FRONTEND_PACKAGES, QAAP_MOBILE_FORBIDDEN_PACKAGES } = require('./qaap-mobile-entry-modules');

const ROOT = path.resolve(__dirname, '../..');
const ENTRY = path.join(ROOT, 'examples/browser/src-gen/frontend/index.js');
const args = new Set(process.argv.slice(2));
const BUILTINS = new Set(Module.builtinModules);
const CODE_EXT = new Set(['.js', '.cjs', '.mjs']);
const REQUIRE_RE = /(?:\brequire|\bimport)\s*\(\s*(['"])([^'"\n]+)\1\s*\)/g;

const rel = f => path.relative(ROOT, f);
const pkgNameCache = new Map();
/** Nearest package.json name for a file. */
function packageOf(file) {
    let dir = path.dirname(file);
    const visited = [];
    while (true) {
        if (pkgNameCache.has(dir)) {
            const v = pkgNameCache.get(dir);
            visited.forEach(d => pkgNameCache.set(d, v));
            return v;
        }
        visited.push(dir);
        const pj = path.join(dir, 'package.json');
        if (fs.existsSync(pj)) {
            let name = '(unnamed)';
            try { name = JSON.parse(fs.readFileSync(pj, 'utf8')).name || name; } catch { /* ignore */ }
            visited.forEach(d => pkgNameCache.set(d, name));
            return name;
        }
        const up = path.dirname(dir);
        if (up === dir) { return '(none)'; }
        dir = up;
    }
}
function specPackage(spec) {
    if (spec.startsWith('.') || spec.startsWith('/')) { return undefined; }
    const p = spec.split('/');
    return spec.startsWith('@') ? p.slice(0, 2).join('/') : p[0];
}

// ---- entry modules
const entrySrc = fs.readFileSync(ENTRY, 'utf8');
const entrySpecs = [];
for (const m of entrySrc.matchAll(REQUIRE_RE)) {
    if (!entrySpecs.includes(m[2])) { entrySpecs.push(m[2]); }
}
const entryDir = path.dirname(ENTRY);
const resolveCache = new Map();
function resolveFrom(spec, fromFile) {
    const dir = path.dirname(fromFile);
    const key = dir + '\0' + spec;
    if (resolveCache.has(key)) { return resolveCache.get(key); }
    let res;
    try { res = require.resolve(spec, { paths: [dir] }); } catch { res = undefined; }
    resolveCache.set(key, res);
    return res;
}
const entries = entrySpecs
    .filter(s => !s.startsWith('node:') && !BUILTINS.has(s))
    .map(s => ({ spec: s, pkg: specPackage(s) || '(relative)', file: resolveFrom(s, ENTRY) }))
    .filter(e => e.file);

// ---- graph
const ids = new Map(); // file -> id
const files = [];
const sizes = [];
const edges = [];
let unresolved = 0;
function idOf(f) {
    let id = ids.get(f);
    if (id === undefined) {
        id = files.length; ids.set(f, id); files.push(f);
        let size = 0; try { size = fs.statSync(f).size; } catch { /* ignore */ }
        sizes.push(size); edges.push(undefined);
    }
    return id;
}
function children(id) {
    if (edges[id]) { return edges[id]; }
    const f = files[id];
    const out = new Set();
    edges[id] = [];
    if (CODE_EXT.has(path.extname(f))) {
        const src = fs.readFileSync(f, 'utf8');
        for (const m of src.matchAll(REQUIRE_RE)) {
            const spec = m[2];
            if (spec.startsWith('node:') || BUILTINS.has(spec) || spec.startsWith('data:')) { continue; }
            const r = resolveFrom(spec, f);
            if (!r || !path.isAbsolute(r) || BUILTINS.has(r)) { unresolved++; continue; }
            out.add(idOf(r));
        }
    }
    edges[id] = [...out];
    return edges[id];
}

const excluded = new Set(QAAP_MOBILE_EXCLUDED_FRONTEND_PACKAGES);
const forbidden = new Set(QAAP_MOBILE_FORBIDDEN_PACKAGES);
const fullEntries = entries.map(e => ({ ...e, id: idOf(e.file) }));
const mobileEntries = fullEntries.filter(e => !excluded.has(e.pkg));
const excludedEntries = fullEntries.filter(e => excluded.has(e.pkg));

/** Multi-source BFS with parents. */
function bfs(starts) {
    const parent = new Map();
    const queue = [];
    for (const s of starts) { if (!parent.has(s)) { parent.set(s, -1); queue.push(s); } }
    for (let i = 0; i < queue.length; i++) {
        for (const c of children(queue[i])) {
            if (!parent.has(c)) { parent.set(c, queue[i]); queue.push(c); }
        }
    }
    return { parent, order: queue };
}
const full = bfs(fullEntries.map(e => e.id));
const mobile = bfs(mobileEntries.map(e => e.id));

function stats(set) {
    const byPkg = new Map();
    let bytes = 0;
    for (const id of (set instanceof Map ? set.keys() : set)) {
        bytes += sizes[id];
        const p = packageOf(files[id]);
        const e = byPkg.get(p) || { bytes: 0, files: 0 };
        e.bytes += sizes[id]; e.files++; byPkg.set(p, e);
    }
    return { bytes, files: set.size, byPkg };
}
const fullStats = stats(full.parent);
const mobileStats = stats(mobile.parent);
const top = s => [...s.byPkg].sort((a, b) => b[1].bytes - a[1].bytes).slice(0, 30)
    .map(([name, v]) => ({ name, bytes: v.bytes, files: v.files }));

// only in full
const onlyFull = new Set([...full.parent.keys()].filter(id => !mobile.parent.has(id)));
const onlyFullStats = stats(onlyFull);

// forbidden chains
function chain(id) {
    const c = [];
    for (let x = id; x !== -1; x = mobile.parent.get(x)) { c.push(rel(files[x])); }
    return c.reverse();
}
const chains = {};
for (const id of mobile.order) {
    const p = packageOf(files[id]);
    if (forbidden.has(p) && !chains[p]) { chains[p] = chain(id); }
}
// per-entry reach
const reachCount = {};
const reachByEntry = {};
for (const e of mobileEntries) {
    const { order } = bfs([e.id]);
    const hit = new Set(order.map(id => packageOf(files[id])).filter(p => forbidden.has(p)));
    for (const p of hit) { (reachByEntry[p] = reachByEntry[p] || []).push(e.spec); }
}
for (const p of Object.keys(reachByEntry)) { reachCount[p] = reachByEntry[p].length; }

const kb = n => (n / 1024).toFixed(0) + ' KB';
const result = {
    entries: { total: fullEntries.length, mobile: mobileEntries.length, excluded: excludedEntries.length },
    unresolvedSpecs: unresolved,
    full: { bytes: fullStats.bytes, files: fullStats.files, top: top(fullStats) },
    mobile: { bytes: mobileStats.bytes, files: mobileStats.files, top: top(mobileStats) },
    onlyInFull: { bytes: onlyFullStats.bytes, files: onlyFullStats.files, top: top(onlyFullStats).slice(0, 15) },
    forbiddenChains: chains,
    forbiddenReachedByMobileEntries: reachCount,
    forbiddenReachedByEntryList: reachByEntry,
    mobileEntryModules: mobileEntries.map(e => e.spec)
};

if (args.has('--json')) {
    console.log(JSON.stringify(result, undefined, 2));
} else {
    const table = rows => rows.map(r => `| ${r.name} | ${kb(r.bytes)} | ${r.files} |`).join('\n');
    const out = [];
    out.push('# Mobile entry graph report', '',
        `Entry modules: ${result.entries.total} (mobile ${result.entries.mobile}, excluded ${result.entries.excluded}); unresolved specs: ${unresolved}`, '',
        `## Totals`, '', '| mode | reachable bytes | files |', '|---|---|---|',
        `| full | ${kb(fullStats.bytes)} | ${fullStats.files} |`,
        `| mobile | ${kb(mobileStats.bytes)} | ${mobileStats.files} |`,
        `| only in full (split saves) | ${kb(onlyFullStats.bytes)} | ${onlyFullStats.files} |`, '',
        '## Top 30 packages (full)', '', '| package | bytes | files |', '|---|---|---|', table(result.full.top), '',
        '## Top 30 packages (mobile)', '', '| package | bytes | files |', '|---|---|---|', table(result.mobile.top), '',
        '## Top packages only in full', '', '| package | bytes | files |', '|---|---|---|', table(result.onlyInFull.top), '',
        '## Forbidden packages reached by mobile graph (shortest chain)', '');
    if (!Object.keys(chains).length) { out.push('None.'); }
    for (const [p, c] of Object.entries(chains)) {
        out.push(`### ${p} (reached by ${reachCount[p]} mobile entry modules)`, '', c.map((f, i) => `${'  '.repeat(i)}-> ${f}`).join('\n'), '');
    }
    out.push('## Mobile entry modules', '', result.mobileEntryModules.map(s => `- ${s}`).join('\n'));
    console.log(out.join('\n'));
}
if (args.has('--fail-on-forbidden') && Object.keys(chains).length) {
    console.error(`FAIL: mobile graph reaches forbidden packages: ${Object.keys(chains).join(', ')}`);
    process.exit(1);
}
