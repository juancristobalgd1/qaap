// @ts-check
'use strict';
/**
 * Deletes compiled outputs in `packages/<pkg>/lib` whose TypeScript source no longer exists in `src`
 * (tsc --build never removes outputs of deleted or moved files, so mocha globs would still pick up stale specs).
 * Usage: node scripts/qaap-refactor/clean-stale-lib.js packages/<pkg> [...]
 */
const fs = require('fs');
const path = require('path');
const { walk, repoRoot } = require('./split-graph');

let removed = 0;
for (const pkg of process.argv.slice(2)) {
    const lib = path.join(repoRoot, pkg, 'lib');
    if (!fs.existsSync(lib)) { continue; }
    for (const f of walk(lib)) {
        const m = /^(.*)\.(js|js\.map|d\.ts|d\.ts\.map)$/.exec(path.relative(lib, f));
        if (!m) { continue; }
        const base = path.join(repoRoot, pkg, 'src', m[1]);
        if (!fs.existsSync(base + '.ts') && !fs.existsSync(base + '.tsx') && !fs.existsSync(base + '.js')) {
            fs.unlinkSync(f);
            removed++;
        }
    }
}
console.log('removed stale outputs:', removed);
