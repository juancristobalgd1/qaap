// @ts-check
'use strict';
/**
 * Lists class members (methods, properties, accessors) of a package whose name occurs exactly once in the whole
 * source corpus (packages/examples/scripts, specs excluded as usage) — i.e. only at their own declaration.
 * With --remove, deletes them. Usage: node dead-members.js packages/<pkg> [--remove]
 */
const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const { walk, repoRoot, rel } = require('./split-graph');
const { corpusFiles, isSpec } = require('./dead-exports');

const pkg = process.argv[2];
const remove = process.argv.includes('--remove');
const counts = new Map();
for (const f of corpusFiles()) {
    if (isSpec(f)) { continue; }
    const text = fs.readFileSync(f, 'utf8');
    const re = /[A-Za-z_$][\w$]*/g;
    let m;
    while ((m = re.exec(text))) { counts.set(m[0], (counts.get(m[0]) || 0) + 1); }
}
const result = [];
for (const f of walk(path.join(repoRoot, pkg, 'src'))) {
    if (!/\.tsx?$/.test(f) || isSpec(f) || f.endsWith('.d.ts')) { continue; }
    let text = fs.readFileSync(f, 'utf8');
    const sf = ts.createSourceFile(f, text, ts.ScriptTarget.Latest, true, f.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const edits = [];
    const visit = node => {
        if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
            for (const m of node.members) {
                if (!m.name || !ts.isIdentifier(m.name) || ts.isConstructorDeclaration(m)) { continue; }
                const mods = ts.canHaveModifiers(m) ? ts.getModifiers(m) || [] : [];
                if (mods.some(x => x.kind === ts.SyntaxKind.OverrideKeyword)) { continue; }
                // decorated members (@postConstruct, @inject, ...) are invoked by the DI container, not by name
                if (ts.canHaveDecorators(m) && (ts.getDecorators(m) || []).length) { continue; }
                const name = m.name.text;
                if ((counts.get(name) || 0) === 1) {
                    result.push({ file: rel(f), name, kind: ts.SyntaxKind[m.kind] });
                    const full = m.getFullStart();
                    const start = m.getStart(sf);
                    const trivia = text.slice(full, start);
                    const g = Math.max(trivia.lastIndexOf('\n\n'), trivia.lastIndexOf('\n\r\n'));
                    edits.push({ start: g >= 0 ? full + g + 1 : full, end: m.getEnd() });
                }
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(sf);
    if (remove && edits.length) {
        for (const e of edits.sort((a, b) => b.start - a.start)) { text = text.slice(0, e.start) + text.slice(e.end); }
        fs.writeFileSync(f, text.replace(/(\r?\n){3,}/g, m => (m.includes('\r') ? '\r\n\r\n' : '\n\n')));
    }
}
for (const r of result) { console.log(r.file.replace(pkg + '/src/', ''), r.name, r.kind); }
console.log('total', result.length);
