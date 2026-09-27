'use strict';
// Removes unused imports and unused non-exported top-level declarations reported by tsc
// (TS6133/6192/6196/6198) for one tsconfig project. Loops until clean. Prints anything it cannot fix.
const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const { repoRoot } = require('./split-graph');
const CODES = new Set([6133, 6192, 6196, 6198]);

function diagnostics(projectDir) {
    const cfgPath = path.join(repoRoot, projectDir, 'tsconfig.json');
    const cfg = ts.getParsedCommandLineOfConfigFile(cfgPath, {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: d => { throw new Error(String(d.messageText)); } });
    const program = ts.createProgram({ rootNames: cfg.fileNames, options: { ...cfg.options, noEmit: true, composite: false, declaration: false, declarationMap: false, incremental: false, tsBuildInfoFile: undefined } });
    return program.getSemanticDiagnostics().concat(program.getSyntacticDiagnostics()).filter(d => d.file && !d.file.fileName.includes('node_modules'));
}

function run(projectDir) {
    for (let round = 0; round < 8; round++) {
        const diags = diagnostics(projectDir);
        const unused = diags.filter(d => CODES.has(d.code));
        const other = diags.filter(d => !CODES.has(d.code) && d.category === ts.DiagnosticCategory.Error);
        if (!unused.length) { return other; }
        const byFile = new Map();
        for (const d of unused) { const f = d.file.fileName; if (!byFile.has(f)) { byFile.set(f, []); } byFile.get(f).push(d); }
        let changed = 0;
        for (const [file, ds] of byFile) {
            let text = fs.readFileSync(file, 'utf8');
            const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
            const edits = [];
            const nodeAt = pos => { let found; const v = n => { if (pos >= n.getStart(sf) && pos < n.getEnd()) { found = n; ts.forEachChild(n, v); } }; v(sf); return found; };
            for (const d of ds) {
                let n = nodeAt(d.start);
                while (n && !(ts.isImportSpecifier(n) || ts.isImportClause(n) || ts.isImportDeclaration(n) || ts.isNamespaceImport(n)
                    || (n.parent === sf))) { n = n.parent; }
                if (!n) { continue; }
                if (ts.isImportSpecifier(n)) {
                    const named = n.parent;
                    const clause = named.parent;
                    const decl = clause.parent;
                    const deadNames = new Set(ds.map(x => { const t = nodeAt(x.start); return t && ts.isIdentifier(t) ? t.text : undefined; }));
                    const keep = named.elements.filter(e => !deadNames.has(e.name.text));
                    if (!keep.length && !clause.name) { edits.push({ start: decl.getFullStart(), end: decl.getEnd(), key: decl.pos }); }
                    else { edits.push({ start: named.getStart(sf), end: named.getEnd(), text: '{ ' + keep.map(e => e.getText(sf)).join(', ') + ' }', key: named.pos }); }
                } else if (ts.isImportDeclaration(n) || ts.isImportClause(n) || ts.isNamespaceImport(n)) {
                    let decl = n; while (!ts.isImportDeclaration(decl)) { decl = decl.parent; }
                    edits.push({ start: decl.getFullStart(), end: decl.getEnd(), key: decl.pos });
                } else if (n.parent === sf && (ts.isFunctionDeclaration(n) || ts.isVariableStatement(n) || ts.isInterfaceDeclaration(n) || ts.isTypeAliasDeclaration(n) || ts.isClassDeclaration(n) || ts.isEnumDeclaration(n))) {
                    if (ts.isVariableStatement(n) && n.declarationList.declarations.length > 1) { console.log('SKIP multi', file, d.start); continue; }
                    const full = n.getFullStart(); const start = n.getStart(sf);
                    const trivia = text.slice(full, start); const g = trivia.lastIndexOf('\n\n');
                    edits.push({ start: g >= 0 ? full + g + 1 : full, end: n.getEnd(), key: n.pos });
                } else {
                    console.log('UNFIXED', path.relative(repoRoot, file), ts.flattenDiagnosticMessageText(d.messageText, ' '));
                }
            }
            const seen = new Set();
            const uniq = edits.filter(e => (seen.has(e.key) ? false : (seen.add(e.key), true))).sort((a, b) => b.start - a.start);
            for (const e of uniq) { text = text.slice(0, e.start) + (e.text || '') + text.slice(e.end); changed++; }
            fs.writeFileSync(file, text.replace(/\n{3,}/g, '\n\n'));
        }
        if (!changed) { return other.concat(unused); }
    }
    return [];
}
if (require.main === module) {
    const rest = run(process.argv[2]);
    for (const d of rest) { console.log('ERR', path.relative(repoRoot, d.file.fileName), ts.flattenDiagnosticMessageText(d.messageText, ' ')); }
}
module.exports = { run, diagnostics };
