// @ts-check
'use strict';
/**
 * For type-only imports that point up the layer order, reports which members of the imported type the importing
 * file actually touches. Used to write minimal structural contracts in the lower package.
 * Usage: node type-usage.js packages/<pkg> <mapping.csv>
 */
const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const { repoRoot, rel } = require('./split-graph');
const { ORDER } = require('./split-settle');
const { resolveFrom } = require('./rewrite-imports');

const pkgDir = process.argv[2];
const map = Object.fromEntries(fs.readFileSync(process.argv[3], 'utf8').trim().split(/\r?\n/).map(l => l.split(',')));
const cfg = ts.getParsedCommandLineOfConfigFile(path.join(repoRoot, pkgDir, 'tsconfig.json'), {}, /** @type {any} */ ({ ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => undefined }));
const program = ts.createProgram({ rootNames: cfg.fileNames, options: { ...cfg.options, noEmit: true } });
const checker = program.getTypeChecker();
const report = {};
const layerOf = f => ORDER.indexOf(map[rel(f)]);
// pass 1: symbols imported upward
const upSymbols = new Map(); // symbol -> { key, layer }
for (const sf of program.getSourceFiles()) {
    const r = rel(sf.fileName);
    if (!map[r]) { continue; }
    for (const st of sf.statements) {
        if (!ts.isImportDeclaration(st) || !st.importClause || !ts.isStringLiteral(st.moduleSpecifier)) { continue; }
        const target = resolveFrom(sf.fileName, st.moduleSpecifier.text);
        if (!target) { continue; }
        const tr = rel(target);
        if (!map[tr] || ORDER.indexOf(map[tr]) <= ORDER.indexOf(map[r])) { continue; }
        const nb = st.importClause.namedBindings;
        if (nb && ts.isNamedImports(nb)) {
            for (const e of nb.elements) {
                const sym = checker.getSymbolAtLocation(e.name);
                const aliased = sym && (sym.flags & ts.SymbolFlags.Alias) ? checker.getAliasedSymbol(sym) : sym;
                if (!aliased) { continue; }
                const key = tr.split('/').pop() + ' :: ' + (e.propertyName || e.name).text + '  [' + map[tr] + ']';
                upSymbols.set(aliased, { key, layer: ORDER.indexOf(map[tr]) });
                report[key] = report[key] || { members: new Set(), users: new Set(), importers: new Set() };
                report[key].importers.add(r.split('/').pop() + '[' + map[r] + ']');
            }
        }
    }
}
// pass 1b: `import('./x').Type` references
for (const sf of program.getSourceFiles()) {
    const r = rel(sf.fileName);
    if (!map[r]) { continue; }
    const visit = node => {
        if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal) && node.qualifier) {
            const target = resolveFrom(sf.fileName, node.argument.literal.text);
            const tr = target && rel(target);
            if (tr && map[tr] && ORDER.indexOf(map[tr]) > ORDER.indexOf(map[r])) {
                const t = checker.getTypeAtLocation(node);
                const sym = t.getSymbol() || t.aliasSymbol;
                const name = ts.isIdentifier(node.qualifier) ? node.qualifier.text : node.qualifier.getText(sf);
                const key = tr.split('/').pop() + ' :: ' + name + '  [' + map[tr] + ']';
                if (sym) { upSymbols.set(sym, { key, layer: ORDER.indexOf(map[tr]) }); }
                report[key] = report[key] || { members: new Set(), users: new Set(), importers: new Set() };
                report[key].importers.add(r.split('/').pop() + '[' + map[r] + ']');
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(sf);
}
// pass 2: member accesses on those types from any lower-layer file
for (const sf of program.getSourceFiles()) {
    const r = rel(sf.fileName);
    if (!map[r]) { continue; }
    const my = layerOf(sf.fileName);
    const visit = node => {
        if (ts.isPropertyAccessExpression(node)) {
            const t = checker.getNonNullableType(checker.getTypeAtLocation(node.expression));
            const s = t.getSymbol() || t.aliasSymbol;
            const hit = s && upSymbols.get(s);
            if (hit && hit.layer > my) {
                report[hit.key].members.add(node.name.text);
                report[hit.key].users.add(r.split('/').pop() + '[' + map[r] + ']');
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(sf);
}
for (const [k, v] of Object.entries(report)) {
    console.log(k);
    console.log('   importers: ' + [...v.importers].join(' '));
    console.log('   accessed in: ' + [...v.users].join(' '));
    console.log('   members: ' + [...v.members].sort().join(' '));
}
