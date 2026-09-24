// @ts-check
'use strict';
/**
 * Moves the files mapped to one target package out of qaap-mobile-shell.
 *
 *   node scripts/qaap-refactor/split-move.js --mapping scripts/qaap-refactor/split-mapping.csv \
 *        --target mechanics --dir packages/qaap-mobile-mechanics --name @theia/qaap-mobile-mechanics \
 *        --description "..." [--from packages/qaap-mobile-shell] [--dry-run]
 *
 * 1. creates the package skeleton (package.json, tsconfig.json, test-support) when missing;
 * 2. rewrites every module specifier in the repo that resolves to a moved file (relative inside a package,
 *    `@theia/<pkg>/lib/...` across packages, `/src/...` for CSS and other assets) — also dynamic `import()`,
 *    `require()` and `import('...').Type`;
 * 3. `git mv`s the files, keeping their path below `src/`;
 * 4. repoints `join(__dirname, ...)` source-text reads in specs that no longer resolve;
 * 5. recomputes package.json dependencies and tsconfig references of every qaap package from its imports
 *    (adds what is missing; `--prune` also drops `@theia/qaap-*` deps no longer imported).
 * Fails on unresolved relative imports.
 */
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const ts = require('typescript');
const { repoRoot, walk } = require('./split-graph');
const { rewriteImports, corpus, specifierNodes } = require('./rewrite-imports');

function arg(name, def) {
    const i = process.argv.indexOf('--' + name);
    return i > 0 ? process.argv[i + 1] : def;
}
const has = name => process.argv.includes('--' + name);

function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }
function writeJson(p, v) { fs.writeFileSync(p, JSON.stringify(v, undefined, 2) + '\n'); }

/** Create `dir` as a Theia extension package modelled on the source package. */
function ensureSkeleton(dir, name, description, fromDir) {
    const abs = path.join(repoRoot, dir);
    if (fs.existsSync(path.join(abs, 'package.json'))) { return false; }
    const from = readJson(path.join(repoRoot, fromDir, 'package.json'));
    fs.mkdirSync(path.join(abs, 'src'), { recursive: true });
    writeJson(path.join(abs, 'package.json'), {
        name,
        version: from.version,
        description,
        dependencies: {},
        publishConfig: from.publishConfig,
        theiaExtensions: [],
        keywords: from.keywords,
        license: from.license,
        repository: from.repository,
        files: ['lib', 'src'],
        scripts: {
            build: 'theiaext build',
            clean: 'theiaext clean',
            compile: 'theiaext compile',
            lint: 'theiaext lint',
            test: 'theiaext test',
            watch: 'theiaext watch'
        },
        devDependencies: from.devDependencies,
        nyc: from.nyc
    });
    writeJson(path.join(abs, 'tsconfig.json'), {
        extends: '../../configs/base.tsconfig',
        compilerOptions: { composite: true, rootDir: 'src', outDir: 'lib' },
        include: ['src'],
        references: []
    });
    return true;
}

/** Package names (`@scope/name` or `name`) imported by a package's sources. */
function importedPackages(pkgDir) {
    const out = new Set();
    const src = path.join(pkgDir, 'src');
    if (!fs.existsSync(src)) { return out; }
    for (const f of walk(src)) {
        if (!/\.tsx?$/.test(f)) { continue; }
        const sf = ts.createSourceFile(f, fs.readFileSync(f, 'utf8'), ts.ScriptTarget.Latest, true);
        for (const lit of specifierNodes(sf)) {
            const s = lit.text;
            if (s.startsWith('.') || s.startsWith('node:') || s.startsWith('/')) { continue; }
            const name = s.startsWith('@') ? s.split('/').slice(0, 2).join('/') : s.split('/')[0];
            if (require('module').builtinModules.includes(name)) { continue; }
            out.add(name);
        }
    }
    return out;
}

const localPackages = (() => {
    const m = new Map();
    for (const root of ['packages', 'dev-packages']) {
        for (const d of fs.readdirSync(path.join(repoRoot, root))) {
            const pj = path.join(repoRoot, root, d, 'package.json');
            if (fs.existsSync(pj)) { m.set(readJson(pj).name, path.join(repoRoot, root, d)); }
        }
    }
    return m;
})();

function versionFor(name, hintDirs) {
    if (localPackages.has(name)) { return readJson(path.join(localPackages.get(name), 'package.json')).version; }
    for (const d of hintDirs) {
        const pj = readJson(path.join(d, 'package.json'));
        const v = (pj.dependencies || {})[name] || (pj.devDependencies || {})[name];
        if (v) { return v; }
    }
    return undefined;
}

/** Add missing deps and tsconfig references for one package; with prune, drop unused qaap deps. */
function syncManifest(pkgDir, hintDirs, prune) {
    const pjPath = path.join(pkgDir, 'package.json');
    const pj = readJson(pjPath);
    const used = importedPackages(pkgDir);
    used.delete(pj.name);
    const deps = { ...(pj.dependencies || {}) };
    const missing = [];
    for (const name of used) {
        if (deps[name] || (pj.devDependencies || {})[name] || (pj.peerDependencies || {})[name]) { continue; }
        const v = versionFor(name, hintDirs);
        if (!v) { missing.push(name); continue; }
        deps[name] = v;
    }
    if (prune) {
        for (const name of Object.keys(deps)) {
            if (/^@theia\/qaap-/.test(name) && !used.has(name)) { delete deps[name]; }
        }
    }
    pj.dependencies = Object.fromEntries(Object.entries(deps).sort(([a], [b]) => a.localeCompare(b)));
    writeJson(pjPath, pj);
    const tsPath = path.join(pkgDir, 'tsconfig.json');
    if (fs.existsSync(tsPath)) {
        const tsc = readJson(tsPath);
        const refs = Object.keys(pj.dependencies).filter(n => localPackages.has(n) && fs.existsSync(path.join(localPackages.get(n), 'tsconfig.json')))
            .map(n => path.relative(pkgDir, localPackages.get(n)).split(path.sep).join('/'));
        tsc.references = [...new Set(refs)].sort().map(p => ({ path: p }));
        writeJson(tsPath, tsc);
    }
    return missing;
}

/** Repoint `join(__dirname, 'a', 'b')` / `join(__dirname, '../a')` reads in specs whose target moved. */
function fixSpecTextPaths(pkgDirs) {
    const fixed = [];
    const index = new Map(); // basename -> [abs]
    for (const d of pkgDirs) {
        for (const f of walk(path.join(d, 'src'))) {
            const b = path.basename(f);
            if (!index.has(b)) { index.set(b, []); }
            index.get(b).push(f);
        }
    }
    for (const d of pkgDirs) {
        for (const f of walk(path.join(d, 'src'))) {
            if (!/spec\.tsx?$/.test(f)) { continue; }
            let text = fs.readFileSync(f, 'utf8');
            const libDir = path.dirname(f).replace(/([\\/])src(?=[\\/]|$)/, '$1lib');
            let changed = false;
            text = text.replace(/((?:path\.)?(?:join|resolve)\(\s*__dirname\s*,)([^)]*)\)/g, (all, head, args) => {
                const parts = args.split(',').map(s => s.trim()).filter(Boolean);
                if (!parts.every(p => /^'[^']*'$/.test(p))) { return all; }
                const segs = parts.map(p => p.slice(1, -1));
                const target = path.resolve(libDir, ...segs);
                if (fs.existsSync(target)) { return all; }
                const candidates = (index.get(path.basename(target)) || []).filter(c => /[\\/]src[\\/]/.test(c));
                const srcHint = target.replace(/([\\/])lib([\\/])/, '$1src$2');
                const pick = candidates.length === 1 ? candidates[0]
                    : candidates.find(c => c.endsWith(path.relative(path.join(repoRoot, 'packages'), srcHint).split(path.sep).slice(1).join(path.sep)));
                if (!pick) { return all; }
                const rel = path.relative(libDir, pick).split(path.sep);
                changed = true;
                return head + ' ' + rel.map(s => `'${s}'`).join(', ') + ')';
            });
            if (changed) { fs.writeFileSync(f, text); fixed.push(path.relative(repoRoot, f)); }
        }
    }
    return fixed;
}

function main() {
    const mappingFile = arg('mapping');
    const target = arg('target');
    const dir = arg('dir');
    const name = arg('name');
    const fromDir = arg('from', 'packages/qaap-mobile-shell');
    const dry = has('dry-run');
    const rows = fs.readFileSync(path.join(repoRoot, mappingFile), 'utf8').trim().split(/\r?\n/)
        .filter(l => l && !l.startsWith('#')).map(l => l.split(','));
    const files = rows.filter(([, t]) => t === target).map(([f]) => f).filter(f => f.startsWith(fromDir + '/src/'));
    if (!files.length) { throw new Error('no files mapped to ' + target); }
    const created = dry ? false : ensureSkeleton(dir, name, arg('description', ''), fromDir);
    const mapping = new Map(files.map(f => [path.resolve(repoRoot, f), path.resolve(repoRoot, dir, 'src', path.relative(path.join(fromDir, 'src'), f))]));
    console.log(`${created ? 'created ' + dir + '; ' : ''}moving ${files.length} files to ${dir}`);
    if (dry) { return; }
    const { changed, unresolved } = rewriteImports(mapping);
    const bad = unresolved.filter(u => /packages\/qaap-/.test(u));
    console.log(`rewrote imports in ${changed.length} files`);
    for (const [from, to] of mapping) {
        fs.mkdirSync(path.dirname(to), { recursive: true });
        cp.execFileSync('git', ['mv', from, to], { cwd: repoRoot });
    }
    const qaapDirs = [...localPackages.values()].filter(d => /[\\/]qaap-/.test(d)).concat([path.join(repoRoot, dir)]);
    const specFixes = fixSpecTextPaths([...new Set(qaapDirs)]);
    console.log(`repointed source-text reads in ${specFixes.length} specs`);
    const hints = [path.join(repoRoot, fromDir)];
    for (const d of new Set(qaapDirs)) {
        if (!fs.existsSync(path.join(d, 'package.json'))) { continue; }
        const missing = syncManifest(d, hints, has('prune'));
        if (missing.length) { console.log(`  ${path.relative(repoRoot, d)}: no version found for ${missing.join(', ')}`); }
    }
    if (bad.length) {
        console.error('unresolved relative imports:\n  ' + bad.join('\n  '));
        process.exitCode = 1;
    }
}

if (require.main === module) { main(); }
module.exports = { ensureSkeleton, syncManifest, fixSpecTextPaths, importedPackages };
