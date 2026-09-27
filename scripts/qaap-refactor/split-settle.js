// @ts-check
'use strict';
/**
 * Assigns every qaap-mobile-shell file to a target package so that dependencies only point down the layer order.
 * Starts from the name-based seed (split-seed.js) plus overrides, then resolves each upward edge by either raising
 * the importer (and its importers) or lowering the import (and its deps), whichever moves fewer lines.
 *
 * Usage: node split-settle.js graph.json [--ignore-type-edges] [--overrides overrides.csv] > mapping.csv
 */
const fs = require('fs');
const { seed } = require('./split-seed');

const ORDER = ['mechanics', 'shared-core', 'diff-review', 'agents-ui', 'transcript', 'composer', 'work-hub'];

/**
 * Extracted-class clusters: `<base>.ts` plus `<base>-<suffix>.ts` siblings when `<base>-context.ts` exists. The
 * `*Extracted()` functions take `Pick<Class, ...>` contexts, so a cluster can never be split across packages.
 */
function clusters(files) {
    const unit = new Map(files.map(f => [f, f]));
    const bases = files.filter(f => /\.tsx?$/.test(f) && !/spec\.tsx?$/.test(f)).map(f => f.replace(/\.tsx?$/, ''))
        .filter(b => files.includes(b + '-context.ts'));
    for (const b of bases.sort((x, y) => x.length - y.length)) {
        for (const f of files) {
            if (/spec\.tsx?$/.test(f)) { continue; }
            const stem = f.replace(/\.tsx?$/, '');
            if (stem === b || (stem.startsWith(b + '-') && !bases.some(o => o.length > b.length && (stem === o || stem.startsWith(o + '-'))))) {
                unit.set(f, b + '.ts');
            }
        }
    }
    return unit;
}

function settle(g, opts = {}) {
    const files = Object.keys(g);
    const unitOf = clusters(files);
    const units = [...new Set(unitOf.values())];
    const members = new Map(units.map(u => [u, []]));
    for (const f of files) { members.get(unitOf.get(f)).push(f); }
    const L = new Map();
    const pinned = new Set();
    for (const u of units) { L.set(u, ORDER.indexOf(seed(u))); }
    for (const [key, pkg] of Object.entries(opts.overrides || {})) {
        if (ORDER.indexOf(pkg) < 0) { throw new Error('unknown package ' + pkg); }
        // `re:<regex>` matches the basename, anything else is an exact repo-relative path
        const matches = key.startsWith('re:') ? files.filter(f => new RegExp(key.slice(3)).test(f.split('/').pop())) : [key];
        if (!matches.length || !g[matches[0]]) { console.error('override matches nothing: ' + key); }
        for (const f of matches) { if (g[f]) { L.set(unitOf.get(f), ORDER.indexOf(pkg)); pinned.add(unitOf.get(f)); } }
    }
    const loc = new Map(units.map(u => [u, members.get(u).reduce((a, f) => a + g[f].loc, 0)]));
    const udeps = new Map(units.map(u => [u, [...new Set(members.get(u).flatMap(f => g[f].deps
        .filter(d => g[d] && !(opts.ignoreTypeEdges && g[f].typeDeps.includes(d))).map(d => unitOf.get(d))))].filter(d => d !== u)]));
    const importers = new Map(units.map(u => [u, []]));
    for (const u of units) { for (const d of udeps.get(u)) { importers.get(d).push(u); } }
    const moves = [];
    for (let iter = 0; iter < 10000; iter++) {
        let viol;
        for (const u of units) { for (const d of udeps.get(u)) { if (L.get(u) < L.get(d)) { viol = [u, d]; break; } } if (viol) { break; } }
        if (!viol) { break; }
        const [f, d] = viol;
        const up = new Set(); const target = L.get(d);
        const stackU = [f];
        while (stackU.length) { const x = stackU.pop(); if (up.has(x) || L.get(x) >= target) { continue; } up.add(x); stackU.push(...importers.get(x)); }
        const down = new Set(); const low = L.get(f);
        const stackD = [d];
        while (stackD.length) { const x = stackD.pop(); if (down.has(x) || L.get(x) <= low) { continue; } down.add(x); stackD.push(...udeps.get(x)); }
        const cost = set => [...set].reduce((a, x) => a + loc.get(x) + (pinned.has(x) ? 1e6 : 0), 0);
        const useUp = low === 0 || cost(up) <= cost(down); // never grow mechanics
        for (const x of useUp ? up : down) { moves.push([x, ORDER[L.get(x)], ORDER[useUp ? target : low]]); L.set(x, useUp ? target : low); }
    }
    const fileL = new Map(files.map(f => [f, L.get(unitOf.get(f))]));
    return { L: fileL, moves, unitOf };
}

if (require.main === module) {
    const g = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
    const ignoreTypeEdges = process.argv.includes('--ignore-type-edges');
    const oi = process.argv.indexOf('--overrides');
    const overrides = {};
    if (oi > 0) {
        for (const line of fs.readFileSync(process.argv[oi + 1], 'utf8').split(/\r?\n/)) {
            const i = line.lastIndexOf(',');
            const f = line.slice(0, i); const p = line.slice(i + 1);
            if (f && p && !f.startsWith('#')) { overrides[f.trim()] = p.trim(); }
        }
    }
    const { L, moves } = settle(g, { ignoreTypeEdges, overrides });
    const summary = {};
    for (const [f, l] of L) { const p = ORDER[l]; summary[p] = summary[p] || { files: 0, loc: 0 }; summary[p].files++; summary[p].loc += g[f].loc; }
    console.error(JSON.stringify(summary));
    console.error('moves', moves.length);
    for (const m of moves) { console.error('  ' + m[0].split('/').slice(-2).join('/') + ' ' + m[1] + ' -> ' + m[2]); }
    for (const [f, l] of [...L].sort()) { console.log(f + ',' + ORDER[l]); }
}
module.exports = { settle, ORDER };
