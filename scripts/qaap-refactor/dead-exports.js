'use strict';
// Lists top-level exported declarations of a package that nothing outside their own file uses
// (spec files do not count as usage). Usage: node dead-exports.js packages/qaap-mobile-shell > out.json
const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const { walk, rel, repoRoot } = require('./split-graph');

const isSpec = f => /\.(ui-|slow-)?spec\.tsx?$/.test(f) || /\.dispose\.ui-spec\.tsx?$/.test(f);
const corpusRoots = ['packages', 'examples', 'scripts', 'dev-packages'];
function corpusFiles() {
    const out = [];
    for (const r of corpusRoots) {
        const base = path.join(repoRoot, r);
        const stack = [base];
        while (stack.length) {
            const d = stack.pop();
            for (const e of fs.readdirSync(d, { withFileTypes: true })) {
                if (e.isDirectory()) {
                    if (['node_modules', 'lib', 'coverage', '.nyc_output', 'src-gen', 'gen-webpack', '.git', 'dist', 'plugins'].includes(e.name)) { continue; }
                    stack.push(path.join(d, e.name));
                } else if (/\.(tsx?|js|mjs|cjs)$/.test(e.name) && !e.name.endsWith('.d.ts') || e.name.endsWith('.d.ts')) {
                    out.push(path.join(d, e.name));
                }
            }
        }
    }
    return out;
}
function exportsOf(file) {
    const text = fs.readFileSync(file, 'utf8');
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const out = [];
    for (const st of sf.statements) {
        const mods = ts.canHaveModifiers(st) ? ts.getModifiers(st) || [] : [];
        if (!mods.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) { continue; }
        if (mods.some(m => m.kind === ts.SyntaxKind.DefaultKeyword)) { continue; }
        if (ts.isVariableStatement(st)) {
            for (const d of st.declarationList.declarations) { if (ts.isIdentifier(d.name)) { out.push({ name: d.name.text, kind: 'var', multi: st.declarationList.declarations.length > 1 }); } }
        } else if ((ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st) || ts.isInterfaceDeclaration(st) || ts.isTypeAliasDeclaration(st) || ts.isEnumDeclaration(st) || ts.isModuleDeclaration(st)) && st.name && ts.isIdentifier(st.name)) {
            out.push({ name: st.name.text, kind: ts.SyntaxKind[st.kind] });
        }
    }
    return out;
}
if (require.main === module) {
    const pkg = process.argv[2] || 'packages/qaap-mobile-shell';
    const files = corpusFiles();
    const tokenFiles = new Map(); // token -> Map(file -> count)
    for (const f of files) {
        const text = fs.readFileSync(f, 'utf8');
        const re = /[A-Za-z_$][\w$]*/g; let m;
        const local = new Map();
        while ((m = re.exec(text))) { local.set(m[0], (local.get(m[0]) || 0) + 1); }
        for (const [t, c] of local) { if (!tokenFiles.has(t)) { tokenFiles.set(t, new Map()); } tokenFiles.get(t).set(rel(f), c); }
    }
    const result = [];
    for (const f of walk(path.join(repoRoot, pkg, 'src'))) {
        if (!/\.tsx?$/.test(f) || isSpec(f) || f.endsWith('.d.ts')) { continue; }
        const r = rel(f);
        for (const e of exportsOf(f)) {
            const uses = tokenFiles.get(e.name) || new Map();
            const own = uses.get(r) || 0;
            const ext = [...uses.entries()].filter(([k]) => k !== r);
            const extApp = ext.filter(([k]) => !isSpec(k));
            if (extApp.length === 0) {
                result.push({ file: r, name: e.name, kind: e.kind, ownCount: own, specUsers: ext.map(([k]) => k) });
            }
        }
    }
    process.stdout.write(JSON.stringify(result, undefined, 1));
}
module.exports = { exportsOf, isSpec, corpusFiles };
