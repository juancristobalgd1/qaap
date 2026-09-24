// @ts-check
'use strict';
/**
 * Replaces modules that consist solely of `export * from '<spec>'` with direct imports of `<spec>` and deletes them.
 * Usage: node scripts/qaap-refactor/inline-reexport-shims.js packages/<pkg>
 */
const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const { walk, repoRoot } = require('./split-graph');
const { rewriteImports, resolveFrom } = require('./rewrite-imports');

const pkg = process.argv[2];
const mapping = new Map();
for (const f of walk(path.join(repoRoot, pkg, 'src'))) {
    if (!/\.tsx?$/.test(f) || /spec\.tsx?$/.test(f)) { continue; }
    const sf = ts.createSourceFile(f, fs.readFileSync(f, 'utf8'), ts.ScriptTarget.Latest, true);
    const only = sf.statements.length === 1 ? sf.statements[0] : undefined;
    if (only && ts.isExportDeclaration(only) && !only.exportClause && only.moduleSpecifier && ts.isStringLiteral(only.moduleSpecifier)) {
        const target = resolveFrom(f, only.moduleSpecifier.text);
        if (target) { mapping.set(path.resolve(f), target); }
    }
}
const { changed, unresolved } = rewriteImports(mapping);
for (const k of mapping.keys()) { fs.unlinkSync(k); }
console.log('shims', mapping.size, 'importers rewritten', changed.length, 'unresolved', unresolved.length);
unresolved.slice(0, 10).forEach(u => console.log('  ', u));
