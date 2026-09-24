'use strict';
// Removes the given top-level declarations and the spec cases that exercise them.
// Input: JSON array [{ file, name, specUsers }] (repo-relative paths).
const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const { repoRoot } = require('./split-graph');

function parse(file, text) {
    return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}
/** Start of a statement including its attached comments, but not comments separated by a blank line (license headers). */
function attachedStart(sf, node) {
    const text = sf.text;
    const full = node.getFullStart();
    const start = node.getStart(sf);
    const trivia = text.slice(full, start);
    const gap = trivia.lastIndexOf('\n\n');
    const gapCr = trivia.lastIndexOf('\n\r\n');
    const g = Math.max(gap, gapCr);
    return g >= 0 ? full + g + 1 : full;
}
function applyEdits(text, edits) {
    edits.sort((a, b) => b.start - a.start);
    let prev = Infinity;
    for (const e of edits) {
        if (e.end > prev) { continue; } // overlapping, outer already removed
        text = text.slice(0, e.start) + (e.text || '') + text.slice(e.end);
        prev = e.start;
    }
    return text.replace(/\n{3,}/g, '\n\n');
}
const hasToken = (s, name) => new RegExp('(^|[^\w$])' + name.replace(/\$/g, '\$') + '(?![\w$])').test(s);

function removeDeclarations(file, names) {
    const abs = path.join(repoRoot, file);
    const text = fs.readFileSync(abs, 'utf8');
    const sf = parse(abs, text);
    const edits = [];
    for (const st of sf.statements) {
        if (ts.isVariableStatement(st)) {
            const decls = st.declarationList.declarations;
            const dead = decls.filter(d => ts.isIdentifier(d.name) && names.has(d.name.text));
            if (!dead.length) { continue; }
            if (dead.length === decls.length) { edits.push({ start: attachedStart(sf, st), end: st.getEnd() }); } else { throw new Error('partial multi-declaration in ' + file); }
        } else if (st.name && ts.isIdentifier(st.name) && names.has(st.name.text)) {
            edits.push({ start: attachedStart(sf, st), end: st.getEnd() });
        }
    }
    let out = applyEdits(text, edits);
    fs.writeFileSync(abs, out);
    return edits.length;
}

function isCall(node, fnNames) {
    if (!ts.isExpressionStatement(node) || !ts.isCallExpression(node.expression)) { return undefined; }
    let e = node.expression.expression;
    if (ts.isPropertyAccessExpression(e)) { e = e.expression; }
    return ts.isIdentifier(e) && fnNames.includes(e.text) ? e.text : undefined;
}
const TEST_FNS = ['it', 'test'];
const SUITE_FNS = ['describe', 'suite', 'context'];

/** Remove tests referencing any of `names` from a spec; returns true when the spec has no tests left. */
function pruneSpec(file, names) {
    const abs = path.join(repoRoot, file);
    let text = fs.readFileSync(abs, 'utf8');
    for (let pass = 0; pass < 4; pass++) {
        const sf = parse(abs, text);
        const edits = [];
        const refs = node => [...names].some(n => hasToken(node.getText(sf), n));
        const countTests = node => {
            let c = 0;
            const v = n => { if (isCall(n, TEST_FNS)) { c++; } ts.forEachChild(n, v); };
            v(node); return c;
        };
        const visitBody = stmts => {
            for (const st of stmts) {
                if (ts.isImportDeclaration(st)) { continue; }
                if (isCall(st, TEST_FNS)) { if (refs(st)) { edits.push({ start: attachedStart(sf, st), end: st.getEnd() }); } continue; }
                if (isCall(st, SUITE_FNS)) {
                    if (countTests(st) === 0) { edits.push({ start: attachedStart(sf, st), end: st.getEnd() }); continue; }
                    const fn = st.expression.arguments.find(a => ts.isArrowFunction(a) || ts.isFunctionExpression(a));
                    if (fn && fn.body && ts.isBlock(fn.body)) { visitBody(fn.body.statements); }
                    continue;
                }
                // helpers/fixtures and hooks referencing removed names
                if (refs(st) && !ts.isFunctionDeclaration(st)) { edits.push({ start: attachedStart(sf, st), end: st.getEnd() }); }
                else if (refs(st) && ts.isFunctionDeclaration(st)) { edits.push({ start: attachedStart(sf, st), end: st.getEnd() }); }
            }
        };
        visitBody(sf.statements);
        // import specifiers
        for (const st of sf.statements) {
            if (!ts.isImportDeclaration(st) || !st.importClause || !st.importClause.namedBindings || !ts.isNamedImports(st.importClause.namedBindings)) { continue; }
            const els = st.importClause.namedBindings.elements;
            const keep = els.filter(e => !names.has(e.name.text));
            if (keep.length === els.length) { continue; }
            if (!keep.length && !st.importClause.name) { edits.push({ start: attachedStart(sf, st), end: st.getEnd() }); } else {
                const nb = st.importClause.namedBindings;
                edits.push({ start: nb.getStart(sf), end: nb.getEnd(), text: '{ ' + keep.map(e => e.getText(sf)).join(', ') + ' }' });
            }
        }
        if (!edits.length) { break; }
        text = applyEdits(text, edits);
    }
    fs.writeFileSync(abs, text);
    const sf = parse(abs, text);
    let tests = 0;
    const v = n => { if (isCall(n, TEST_FNS)) { tests++; } ts.forEachChild(n, v); };
    v(sf);
    return tests === 0;
}

if (require.main === module) {
    const list = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
    const byFile = new Map();
    const bySpec = new Map();
    for (const d of list) {
        if (!byFile.has(d.file)) { byFile.set(d.file, new Set()); }
        byFile.get(d.file).add(d.name);
        for (const s of d.specUsers || []) { if (!bySpec.has(s)) { bySpec.set(s, new Set()); } bySpec.get(s).add(d.name); }
    }
    for (const [f, names] of byFile) { removeDeclarations(f, names); }
    for (const [s, names] of bySpec) {
        if (!fs.existsSync(path.join(repoRoot, s))) { continue; }
        if (pruneSpec(s, names)) { fs.unlinkSync(path.join(repoRoot, s)); console.log('deleted empty spec', s); }
    }
    // delete source files that have no statements left besides imports/comments
    for (const f of byFile.keys()) {
        const abs = path.join(repoRoot, f);
        const sf = parse(abs, fs.readFileSync(abs, 'utf8'));
        if (sf.statements.every(st => ts.isImportDeclaration(st))) { fs.unlinkSync(abs); console.log('deleted empty module', f); }
    }
}
module.exports = { removeDeclarations, pruneSpec };
