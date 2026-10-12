// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const guard = path.join(__dirname, 'qaap-mobile-bundle-guard.js');

function input(bytes, ...imports) {
    return { bytes, imports: imports.map(p => ({ path: p, kind: 'require-call', original: p })) };
}

function run(inputs, monacoBudget, ...args) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-mobile-guard-'));
    try {
        const metafile = path.join(dir, 'meta.json');
        const budget = path.join(dir, 'budget.json');
        fs.writeFileSync(metafile, JSON.stringify({
            inputs,
            outputs: { 'lib/frontend/bundle-mobile.js': { bytes: 10, entryPoint: 'src-gen/frontend/index-mobile.js', imports: [], inputs: {} } }
        }));
        fs.writeFileSync(budget, JSON.stringify({ monacoBytes: monacoBudget }));
        return spawnSync(process.execPath, [guard, '--metafile', metafile, '--budget', budget, ...args], { encoding: 'utf8' });
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

const ENTRY = 'src-gen/frontend/index-mobile.js';
const CLEAN = {
    [ENTRY]: input(1, '../../packages/qaap-work-hub/lib/a.js'),
    '../../packages/qaap-work-hub/lib/a.js': input(5, '../../packages/core/lib/b.js'),
    '../../packages/core/lib/b.js': input(7)
};

test('a clean mobile graph passes', () => {
    const result = run(CLEAN, 0);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /Forbidden IDE packages reachable: none/);
});

test('a forbidden package fails and the shortest chain is printed; --report does not fail', () => {
    const inputs = {
        ...CLEAN,
        '../../packages/core/lib/b.js': input(7, '../../packages/terminal/lib/t.js', '../../packages/qaap-work-hub/lib/long1.js'),
        '../../packages/qaap-work-hub/lib/long1.js': input(1, '../../packages/qaap-work-hub/lib/long2.js'),
        '../../packages/qaap-work-hub/lib/long2.js': input(1, '../../packages/terminal/lib/t.js'),
        '../../packages/terminal/lib/t.js': input(3, '../../node_modules/@xterm/xterm/lib/x.js'),
        '../../node_modules/@xterm/xterm/lib/x.js': input(9)
    };
    const result = run(inputs, 0);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /FORBIDDEN packages\/terminal/);
    assert.match(result.stdout, /FORBIDDEN node_modules\/@xterm/);
    assert.match(result.stdout, /packages: \(generated src-gen\) > @theia\/qaap-work-hub > @theia\/core > @theia\/terminal\n/);
    assert.doesNotMatch(result.stdout, /long2/);
    assert.equal(run(inputs, 0, '--report').status, 0);
});

test('plugin-ext-vscode is forbidden but plugin-ext-like names outside the list are not', () => {
    const inputs = { ...CLEAN, '../../packages/core/lib/b.js': input(7, '../../packages/plugin-ext-vscode/lib/p.js', '../../packages/terminal-manager/lib/m.js'), '../../packages/plugin-ext-vscode/lib/p.js': input(1), '../../packages/terminal-manager/lib/m.js': input(1) };
    const result = run(inputs, 0);
    assert.match(result.stdout, /FORBIDDEN packages\/plugin-ext-vscode/);
    assert.doesNotMatch(result.stdout, /FORBIDDEN packages\/terminal/);
});

test('the monaco ratchet fails only above the budget', () => {
    const inputs = { ...CLEAN, '../../packages/core/lib/b.js': input(7, '../../packages/monaco/lib/m.js', '../../node_modules/@theia/monaco-editor-core/esm/e.js'), '../../packages/monaco/lib/m.js': input(100), '../../node_modules/@theia/monaco-editor-core/esm/e.js': input(50) };
    assert.equal(run(inputs, 150).status, 0);
    const over = run(inputs, 149);
    assert.equal(over.status, 1);
    assert.match(over.stdout, /OVER BUDGET/);
    assert.equal(run(inputs, 149, '--report').status, 0);
});

test('a whole date-fns or highlight.js barrel fails; narrowed subpaths pass', () => {
    const inputs = {
        ...CLEAN,
        '../../packages/core/lib/b.js': input(7, '../../node_modules/date-fns/index.cjs', '../../node_modules/highlight.js/lib/core.js'),
        '../../node_modules/date-fns/index.cjs': input(1),
        '../../node_modules/highlight.js/lib/core.js': input(1)
    };
    const result = run(inputs, 0);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /WHOLE BARREL node_modules\/date-fns\/index\.cjs <- packages\/core\/lib\/b\.js/);
    assert.doesNotMatch(result.stdout, /WHOLE BARREL node_modules\/highlight/);
    inputs['../../packages/core/lib/b.js'] = input(7, '../../node_modules/date-fns/formatDistance.cjs');
    inputs['../../node_modules/date-fns/formatDistance.cjs'] = input(1);
    assert.equal(run(inputs, 0).status, 0);
});

test('a stylesheet inlining legacy font formats next to woff2 fails; a ttf-only face does not', () => {
    const fonts = (...paths) => ({ bytes: 1, imports: paths.map(p => ({ path: p, kind: 'url-token', original: p })) });
    const inputs = {
        ...CLEAN,
        '../../packages/core/lib/b.js': input(7, '../../node_modules/fa/css/fa.css', '../../node_modules/codicons/codicon.css'),
        '../../node_modules/fa/css/fa.css': fonts('../../node_modules/fa/fonts/fa.woff2?v=4', '../../node_modules/fa/fonts/fa.eot?v=4'),
        '../../node_modules/codicons/codicon.css': fonts('../../node_modules/codicons/codicon.ttf?abc')
    };
    const result = run(inputs, 0);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /REDUNDANT FONTS node_modules\/fa\/css\/fa\.css/);
    assert.doesNotMatch(result.stdout, /REDUNDANT FONTS node_modules\/codicons/);
    inputs['../../node_modules/fa/css/fa.css'] = fonts('../../node_modules/fa/fonts/fa.woff2?v=4');
    assert.equal(run(inputs, 0).status, 0);
});

test('a metafile without the mobile entry is an error, also in report mode', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-mobile-guard-'));
    try {
        const metafile = path.join(dir, 'meta.json');
        fs.writeFileSync(metafile, JSON.stringify({ inputs: {}, outputs: {} }));
        assert.equal(spawnSync(process.execPath, [guard, '--report', '--metafile', metafile]).status, 2);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
