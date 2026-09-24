// @ts-check
'use strict';
/**
 * Import-rewrite engine for moving files between qaap packages.
 *
 * `rewriteImports(mapping)` takes a Map<oldAbsPath, newAbsPath> of *source* files. Every module specifier in the
 * corpus (packages + examples TypeScript sources) that resolves to an old path is rewritten to point at the new
 * path: relative inside a package, `@theia/<pkg>/lib/...` across packages (`/src/...` for non-TS assets such as
 * CSS). Importers that are themselves moved get their specifiers recomputed from their new location. Call it
 * before the files are physically moved: resolution happens against the current tree.
 */
const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const { repoRoot } = require('./split-graph');

const TS_EXT = /\.(d\.ts|tsx?)$/;
const pkgCache = new Map();

/** `{ dir, name }` of the package containing an absolute path (or the package that will contain it). */
function pkgOf(abs) {
    let d = path.dirname(abs);
    while (d.startsWith(repoRoot) && d !== repoRoot) {
        if (pkgCache.has(d)) { return pkgCache.get(d); }
        const pj = path.join(d, 'package.json');
        if (fs.existsSync(pj)) {
            const v = { dir: d, name: JSON.parse(fs.readFileSync(pj, 'utf8')).name };
            pkgCache.set(d, v);
            return v;
        }
        d = path.dirname(d);
    }
    return undefined;
}

function toPosix(p) { return p.split(path.sep).join('/'); }

/** Directory of the compiled counterpart (`src/x` -> `lib/x`). */
function libDirOf(abs) {
    const p = pkgOf(abs);
    const relToPkg = path.relative(p.dir, path.dirname(abs));
    return path.join(p.dir, relToPkg.replace(/^src(?=$|[\\/])/, 'lib'));
}

function specifierFor(importerAbs, targetAbs, originalSpec) {
    const pi = pkgOf(importerAbs);
    const pt = pkgOf(targetAbs);
    if (!pt) { throw new Error('no package for ' + targetAbs); }
    const isTs = TS_EXT.test(targetAbs);
    if (pi && pi.dir === pt.dir) {
        if (isTs) {
            let r = toPosix(path.relative(path.dirname(importerAbs), targetAbs)).replace(TS_EXT, '');
            if (!r.startsWith('.')) { r = './' + r; }
            return r;
        }
        // assets are referenced the way the compiled lib code resolves them (`../../src/browser/style/x.css`)
        const fromLib = /(^|\/)src\//.test(originalSpec);
        const fromDir = fromLib ? libDirOf(importerAbs) : path.dirname(importerAbs);
        let r = toPosix(path.relative(fromDir, targetAbs));
        if (!r.startsWith('.')) { r = './' + r; }
        return r;
    }
    const relInPkg = toPosix(path.relative(pt.dir, targetAbs));
    if (isTs) { return pt.name + '/' + relInPkg.replace(/^src\//, 'lib/').replace(TS_EXT, ''); }
    return pt.name + '/' + relInPkg;
}

function tryFile(base) {
    for (const c of [base, base + '.ts', base + '.tsx', base + '.d.ts', path.join(base, 'index.ts')]) {
        if (fs.existsSync(c) && fs.statSync(c).isFile()) { return c; }
    }
    return undefined;
}

function resolveFrom(importerAbs, spec) {
    if (spec.startsWith('.')) {
        const abs = path.resolve(path.dirname(importerAbs), spec);
        let r = tryFile(abs);
        if (!r) {
            const alt = abs.replace(/([\\/])lib([\\/])/, '$1src$2').replace(/\.js$/, '');
            r = tryFile(alt);
        }
        return r;
    }
    const m = /^(@theia\/qaap-[^/]+)\/(lib|src)\/(.*)$/.exec(spec);
    if (m) {
        const dir = path.join(repoRoot, 'packages', m[1].slice('@theia/'.length));
        return tryFile(path.join(dir, 'src', m[3].replace(/\.js$/, '')));
    }
    return undefined;
}

/** String literal nodes holding module specifiers (static/dynamic imports, exports, require, import types). */
function specifierNodes(sf) {
    const out = [];
    const visit = node => {
        if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
            out.push(node.moduleSpecifier);
        } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
            out.push(node.argument.literal);
        } else if (ts.isCallExpression(node) && node.arguments.length && ts.isStringLiteralLike(node.arguments[0])
            && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
            out.push(node.arguments[0]);
        } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) && ts.isStringLiteral(node.moduleReference.expression)) {
            out.push(node.moduleReference.expression);
        }
        ts.forEachChild(node, visit);
    };
    visit(sf);
    return out;
}

const SKIP_DIRS = new Set(['node_modules', 'lib', 'coverage', '.nyc_output', 'src-gen', 'gen-webpack', 'dist', 'plugins', 'resources']);

function corpus() {
    const out = [];
    const stack = [path.join(repoRoot, 'packages'), path.join(repoRoot, 'examples')];
    while (stack.length) {
        const d = stack.pop();
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
            if (e.isDirectory()) {
                if (!SKIP_DIRS.has(e.name)) { stack.push(path.join(d, e.name)); }
            } else if (/\.tsx?$/.test(e.name)) {
                out.push(path.join(d, e.name));
            }
        }
    }
    return out;
}

/**
 * @param {Map<string,string>} mapping old abs path -> new abs path (keys normalised with path.resolve)
 * @param {{ files?: string[] }} [opts]
 */
function rewriteImports(mapping, opts = {}) {
    const files = opts.files || corpus();
    const changed = [];
    const unresolved = [];
    for (const f of files) {
        const text = fs.readFileSync(f, 'utf8');
        const sf = ts.createSourceFile(f, text, ts.ScriptTarget.Latest, true, f.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
        const newImporter = mapping.get(path.resolve(f)) || f;
        const edits = [];
        for (const lit of specifierNodes(sf)) {
            const spec = lit.text;
            if (!spec.startsWith('.') && !/^@theia\/qaap-/.test(spec)) { continue; }
            const target = resolveFrom(f, spec);
            if (!target) {
                if (spec.startsWith('.')) { unresolved.push(toPosix(path.relative(repoRoot, f)) + ' -> ' + spec); }
                continue;
            }
            const newTarget = mapping.get(path.resolve(target)) || target;
            if (newImporter === f && newTarget === target) { continue; }
            const ns = specifierFor(newImporter, newTarget, spec);
            if (ns !== spec) { edits.push({ start: lit.getStart(sf) + 1, end: lit.getEnd() - 1, text: ns }); }
        }
        if (edits.length) {
            let t = text;
            for (const e of edits.sort((a, b) => b.start - a.start)) { t = t.slice(0, e.start) + e.text + t.slice(e.end); }
            fs.writeFileSync(f, t);
            changed.push(f);
        }
    }
    return { changed, unresolved };
}

module.exports = { rewriteImports, specifierFor, resolveFrom, pkgOf, corpus, specifierNodes, toPosix };
