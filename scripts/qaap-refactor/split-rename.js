// @ts-check
'use strict';
/**
 * Final step of the qaap-mobile-shell split (S9): swaps package names.
 *   packages/qaap-mobile-shell     (@theia/qaap-mobile-shell, the Work Hub remainder) -> packages/qaap-work-hub (@theia/qaap-work-hub)
 *   packages/qaap-mobile-mechanics (@theia/qaap-mobile-mechanics)                     -> packages/qaap-mobile-shell (@theia/qaap-mobile-shell)
 * Rewrites module specifiers (AST), package.json dependency keys, tsconfig references and moves the directories.
 * Run once from the repo root with no dev server holding files open.
 */
const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const { repoRoot } = require('./split-graph');
const { corpus, specifierNodes } = require('./rewrite-imports');

const RENAMES = [
    { fromName: '@theia/qaap-mobile-shell', toName: '@theia/qaap-work-hub', fromDir: 'qaap-mobile-shell', toDir: 'qaap-work-hub' },
    { fromName: '@theia/qaap-mobile-mechanics', toName: '@theia/qaap-mobile-shell', fromDir: 'qaap-mobile-mechanics', toDir: 'qaap-mobile-shell' },
];

/** Applies all renames simultaneously to a string that starts with a package name or a `../<dir>` path. */
function renameName(s) {
    for (const r of RENAMES) {
        if (s === r.fromName || s.startsWith(r.fromName + '/')) { return r.toName + s.slice(r.fromName.length); }
    }
    return s;
}
function renameDirRef(s) {
    for (const r of RENAMES) {
        const m = new RegExp('(^|/)' + r.fromDir + '(?=$|/)');
        if (m.test(s)) { return s.replace(m, '$1' + r.toDir); }
    }
    return s;
}

function rewriteSpecifiers() {
    let n = 0;
    for (const f of corpus()) {
        const text = fs.readFileSync(f, 'utf8');
        if (!RENAMES.some(r => text.includes(r.fromName))) { continue; }
        const sf = ts.createSourceFile(f, text, ts.ScriptTarget.Latest, true, f.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
        const edits = [];
        for (const lit of specifierNodes(sf)) {
            const next = renameName(lit.text);
            if (next !== lit.text) { edits.push({ start: lit.getStart(sf) + 1, end: lit.getEnd() - 1, text: next }); }
        }
        if (!edits.length) { continue; }
        let t = text;
        for (const e of edits.sort((a, b) => b.start - a.start)) { t = t.slice(0, e.start) + e.text + t.slice(e.end); }
        fs.writeFileSync(f, t);
        n++;
    }
    return n;
}

function manifests() {
    const out = [];
    for (const root of ['packages', 'examples', 'dev-packages']) {
        for (const d of fs.readdirSync(path.join(repoRoot, root))) {
            const dir = path.join(repoRoot, root, d);
            if (fs.existsSync(path.join(dir, 'package.json'))) { out.push(dir); }
        }
    }
    return out;
}

function rewriteManifests() {
    let n = 0;
    for (const dir of manifests()) {
        const pjPath = path.join(dir, 'package.json');
        const raw = fs.readFileSync(pjPath, 'utf8');
        const pj = JSON.parse(raw);
        let changed = false;
        const own = RENAMES.find(r => r.fromName === pj.name);
        if (own) { pj.name = own.toName; changed = true; }
        for (const key of ['dependencies', 'devDependencies', 'peerDependencies']) {
            if (!pj[key]) { continue; }
            const entries = Object.entries(pj[key]).map(([k, v]) => [renameName(k), v]);
            if (entries.some(([k], i) => k !== Object.keys(pj[key])[i])) {
                pj[key] = Object.fromEntries(entries.sort(([a], [b]) => a.localeCompare(b)));
                changed = true;
            }
        }
        if (changed) { fs.writeFileSync(pjPath, JSON.stringify(pj, undefined, 2) + '\n'); n++; }
        const tsPath = path.join(dir, 'tsconfig.json');
        if (fs.existsSync(tsPath)) {
            const tsc = JSON.parse(fs.readFileSync(tsPath, 'utf8'));
            if (Array.isArray(tsc.references)) {
                const next = tsc.references.map(r => ({ ...r, path: renameDirRef(r.path) }));
                if (JSON.stringify(next) !== JSON.stringify(tsc.references)) {
                    tsc.references = next.sort((a, b) => a.path.localeCompare(b.path));
                    fs.writeFileSync(tsPath, JSON.stringify(tsc, undefined, 2) + '\n');
                    n++;
                }
            }
        }
    }
    return n;
}

function moveDirectories() {
    const tmp = path.join(repoRoot, 'packages', '.qaap-rename-tmp');
    // two-phase so the second rename can reuse the first one's old directory name
    fs.renameSync(path.join(repoRoot, 'packages', RENAMES[0].fromDir), tmp);
    fs.renameSync(path.join(repoRoot, 'packages', RENAMES[1].fromDir), path.join(repoRoot, 'packages', RENAMES[1].toDir));
    fs.renameSync(tmp, path.join(repoRoot, 'packages', RENAMES[0].toDir));
}

if (require.main === module) {
    console.log('specifiers rewritten in', rewriteSpecifiers(), 'files');
    console.log('manifests/tsconfigs rewritten:', rewriteManifests());
    moveDirectories();
    console.log('directories moved');
}
module.exports = { renameName, renameDirRef };
