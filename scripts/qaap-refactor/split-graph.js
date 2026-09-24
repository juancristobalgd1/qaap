// @ts-check
/**
 * Builds the file-level import graph of packages/qaap-mobile-shell/src.
 * Usage: node scripts/qaap-refactor/split-graph.js [--pkg-root packages/qaap-mobile-shell] > graph.json
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const repoRoot = path.resolve(__dirname, '..', '..');

function walk(dir, out = []) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { walk(p, out); } else { out.push(p); }
    }
    return out;
}

function rel(p) { return path.relative(repoRoot, p).split(path.sep).join('/'); }

function resolveRelative(fromFile, spec) {
    const base = path.resolve(path.dirname(fromFile), spec);
    const candidates = [base, base + '.ts', base + '.tsx', base + '.d.ts', path.join(base, 'index.ts')];
    for (const c of candidates) {
        if (fs.existsSync(c) && fs.statSync(c).isFile()) { return c; }
    }
    return undefined;
}

/** Map a `@theia/<pkg>/lib/...` or `../../src/...` style specifier to a src file of a qaap package. */
function resolveSpecifier(fromFile, spec) {
    if (spec.startsWith('.')) {
        let r = resolveRelative(fromFile, spec);
        if (!r) {
            // '../../src/browser/style/x.css' or '../../lib/...'
            const abs = path.resolve(path.dirname(fromFile), spec);
            const libToSrc = abs.replace(/([\/])lib([\/])/, '$1src$2').replace(/\.js$/, '');
            r = resolveRelative(fromFile, path.relative(path.dirname(fromFile), libToSrc)) || (fs.existsSync(abs) ? abs : undefined);
        }
        return r;
    }
    const m = /^@theia\/(qaap-[^/]+)\/(lib|src)\/(.*)$/.exec(spec);
    if (m) {
        const target = path.join(repoRoot, 'packages', m[1], 'src', m[3].replace(/\.js$/, ''));
        return resolveRelative(fromFile, path.relative(path.dirname(fromFile), target)) || (fs.existsSync(target) ? target : undefined);
    }
    return undefined;
}

/** Specifiers imported only for types (every import/export of it is `import type` or all-`type` named bindings). */
function typeOnlySpecs(file, text) {
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const value = new Set();
    const typed = new Set();
    const visit = node => {
        if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
            const spec = node.moduleSpecifier.text;
            let isType = false;
            if (ts.isImportDeclaration(node)) {
                const c = node.importClause;
                if (c) {
                    isType = c.isTypeOnly || (!c.name && !!c.namedBindings && ts.isNamedImports(c.namedBindings)
                        && c.namedBindings.elements.length > 0 && c.namedBindings.elements.every(e => e.isTypeOnly));
                }
            } else {
                isType = node.isTypeOnly || (!!node.exportClause && ts.isNamedExports(node.exportClause)
                    && node.exportClause.elements.length > 0 && node.exportClause.elements.every(e => e.isTypeOnly));
            }
            (isType ? typed : value).add(spec);
        } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
            typed.add(node.argument.literal.text);
        } else if (ts.isCallExpression(node) && node.arguments.length && ts.isStringLiteral(node.arguments[0])
            && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
            value.add(node.arguments[0].text);
        }
        ts.forEachChild(node, visit);
    };
    visit(sf);
    return new Set([...typed].filter(s => !value.has(s)));
}

function importsOf(file) {
    const text = fs.readFileSync(file, 'utf8');
    const info = ts.preProcessFile(text, true, true);
    const typeOnly = typeOnlySpecs(file, text);
    const specs = info.importedFiles.map(f => f.fileName);
    // source-text reads in specs: join(__dirname, '..', '..', 'src', 'browser', 'style', 'x.css')
    const re = /(?:join|resolve)\(\s*__dirname\s*,([^)]*)\)/g;
    let m;
    const textRefs = [];
    while ((m = re.exec(text))) {
        const parts = m[1].split(',').map(s => s.trim()).filter(s => /^['"]/.test(s)).map(s => s.slice(1, -1));
        if (parts.length) { textRefs.push(path.join(...parts)); }
    }
    return { specs, textRefs, typeOnly };
}

function build(pkgRoots) {
    const nodes = {};
    const files = [];
    for (const root of pkgRoots) {
        for (const f of walk(path.join(repoRoot, root, 'src'))) { files.push(f); }
    }
    for (const f of files) {
        const { specs, textRefs, typeOnly } = importsOf(f);
        const deps = new Set();
        const typeDeps = new Set();
        const external = new Set();
        for (const s of specs) {
            const r = resolveSpecifier(f, s);
            if (r) { deps.add(rel(r)); if (typeOnly.has(s)) { typeDeps.add(rel(r)); } } else if (!s.startsWith('.')) { external.add(s.split('/').slice(0, s.startsWith('@') ? 2 : 1).join('/')); } else { external.add('UNRESOLVED:' + s); }
        }
        const textDeps = new Set();
        for (const t of textRefs) {
            const abs = path.resolve(path.dirname(f), t);
            if (fs.existsSync(abs)) { textDeps.add(rel(abs)); }
        }
        for (const d of deps) { if (!typeDeps.has(d)) { continue; } }
        nodes[rel(f)] = { deps: [...deps], typeDeps: [...typeDeps], external: [...external], textDeps: [...textDeps], loc: fs.readFileSync(f, 'utf8').split('\n').length };
    }
    return nodes;
}

if (require.main === module) {
    const roots = process.argv.slice(2).length ? process.argv.slice(2) : ['packages/qaap-mobile-shell'];
    process.stdout.write(JSON.stringify(build(roots), undefined, 1));
}
module.exports = { build, importsOf, resolveSpecifier, walk, rel, repoRoot };
