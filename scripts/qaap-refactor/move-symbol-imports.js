// @ts-check
'use strict';
/**
 * Repoints named imports of `symbol` from module A to module B across the corpus (the declaration itself is moved
 * by hand). Usage: node move-symbol-imports.js <fromFile> <toFile> <symbol> [<symbol>...]
 */
const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const { repoRoot } = require('./split-graph');
const { corpus, resolveFrom, specifierFor } = require('./rewrite-imports');

function moveSymbolImports(fromFile, toFile, symbols) {
    const from = path.resolve(repoRoot, fromFile);
    const to = path.resolve(repoRoot, toFile);
    const changed = [];
    for (const f of corpus()) {
        if (path.resolve(f) === to) { continue; }
        const text = fs.readFileSync(f, 'utf8');
        if (!symbols.some(s => text.includes(s))) { continue; }
        const sf = ts.createSourceFile(f, text, ts.ScriptTarget.Latest, true, f.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
        const edits = [];
        const moved = [];
        for (const st of sf.statements) {
            if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier) || !st.importClause) { continue; }
            const target = resolveFrom(f, st.moduleSpecifier.text);
            if (!target || path.resolve(target) !== from) { continue; }
            const nb = st.importClause.namedBindings;
            if (!nb || !ts.isNamedImports(nb)) { continue; }
            const take = nb.elements.filter(e => symbols.includes((e.propertyName || e.name).text));
            if (!take.length) { continue; }
            const keep = nb.elements.filter(e => !take.includes(e));
            for (const e of take) { moved.push((st.importClause.isTypeOnly || e.isTypeOnly ? 'type ' : '') + e.getText(sf).replace(/^type\s+/, '')); }
            if (!keep.length && !st.importClause.name) {
                edits.push({ start: st.getStart(sf), end: st.getEnd(), text: '' });
            } else {
                edits.push({ start: nb.getStart(sf), end: nb.getEnd(), text: '{ ' + keep.map(e => e.getText(sf)).join(', ') + ' }' });
            }
        }
        // `import('./a').Symbol` type references
        const visit = node => {
            if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)
                && node.qualifier && ts.isIdentifier(node.qualifier) && symbols.includes(node.qualifier.text)) {
                const target = resolveFrom(f, node.argument.literal.text);
                if (target && path.resolve(target) === from) {
                    const lit = node.argument.literal;
                    edits.push({ start: lit.getStart(sf) + 1, end: lit.getEnd() - 1, text: specifierFor(f, to, lit.text) });
                }
            }
            ts.forEachChild(node, visit);
        };
        visit(sf);
        if (!edits.length) { continue; }
        let t = text;
        for (const e of edits.sort((a, b) => b.start - a.start)) { t = t.slice(0, e.start) + e.text + t.slice(e.end); }
        if (moved.length) {
            const allType = moved.every(m => m.startsWith('type '));
            const names = allType ? moved.map(m => m.slice(5)) : moved;
            const decl = `import ${allType ? 'type ' : ''}{ ${names.join(', ')} } from '${specifierFor(f, to, './x')}';`;
            // insert after the last import
            const sf2 = ts.createSourceFile(f, t, ts.ScriptTarget.Latest, true);
            const imports = sf2.statements.filter(s => ts.isImportDeclaration(s));
            const at = imports.length ? imports[imports.length - 1].getEnd() : 0;
            const nl = t.includes('\r\n') ? '\r\n' : '\n';
            t = t.slice(0, at) + (at ? nl : '') + decl + (at ? '' : nl) + t.slice(at);
        }
        t = t.replace(/^(\r?\n)+/, m => (m.includes('\r') ? '\r\n' : '\n')).replace(/(\r?\n)([ \t]*\r?\n){2,}/g, (m, a) => a + a);
        fs.writeFileSync(f, t);
        changed.push(path.relative(repoRoot, f));
    }
    return changed;
}

if (require.main === module) {
    const [fromFile, toFile, ...symbols] = process.argv.slice(2);
    console.log(moveSymbolImports(fromFile, toFile, symbols).join('\n'));
}
module.exports = { moveSymbolImports };
