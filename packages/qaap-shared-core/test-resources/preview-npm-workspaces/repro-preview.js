// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

// Reproduces Qaap's preview bootstrap end to end on the ./fixture npm-workspaces monorepo: runs the
// compiled detector against the real disk, then the install and dev commands the bootstrap service
// would run (same cwd, same shell wrapping) and probes the preview port.
//
// usage (after `npx tsc -b packages/qaap-shared-core`, from the repo root):
//   [NODE_PATH=node_modules] node packages/qaap-shared-core/test-resources/preview-npm-workspaces/repro-preview.js <scenario> [libDir] [port]
// scenario: `interrupted` (root node_modules/.bin without the app's bin — the production state)
//           or `fresh` (no node_modules). libDir defaults to packages/qaap-shared-core/lib.
// QAAP_REPRO_BUILD_AUTO=1 adds `.qaap/preview.json` with `"build": "auto"` (the explicit opt-in);
// without it the app's missing `lib/` is reported as build-required and nothing is started.
// QAAP_REPRO_BUILD_AND_START=1 runs the app's buildAndStartCommand, as the "Build and start" action does.
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const http = require('http');

const scenario = process.argv[2] || 'interrupted';
const libDir = path.resolve(process.argv[3] || path.join(__dirname, '../../lib'));
const port = Number(process.argv[4] || 4777);
const repoDir = path.join(__dirname, '../../../..');
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), `qaap-preview-${scenario}-`));
fs.cpSync(path.join(__dirname, 'fixture'), workspace, { recursive: true });
fs.mkdirSync(path.join(workspace, '.git'));
if (process.env.QAAP_REPRO_BUILD_AUTO === '1') {
    fs.mkdirSync(path.join(workspace, '.qaap'), { recursive: true });
    fs.writeFileSync(path.join(workspace, '.qaap/preview.json'), JSON.stringify({ build: 'auto' }));
}
if (scenario === 'interrupted') {
    fs.mkdirSync(path.join(workspace, 'node_modules/.bin'), { recursive: true });
}
const req = m => require(require.resolve(m, { paths: [repoDir] }));
// The detector's DI graph (WorkspaceService) imports stylesheets, as in the mocha setup.
req('ignore-styles');
req('reflect-metadata');
const { enableJSDOM } = req('@theia/core/lib/browser/test/jsdom');
const disable = enableJSDOM();
if (!globalThis.DragEvent) { globalThis.DragEvent = class DragEvent { }; }
const URI = req('@theia/core/lib/common/uri').default;
module.paths.unshift(path.join(repoDir, 'node_modules'));
const { QaapProjectBootstrapDetector } = require(path.join(libDir, 'browser/qaap-project-bootstrap-detector'));
const plan = require(path.join(libDir, 'common/qaap-project-bootstrap-scaffold-plan'));
const { buildQaapManagedShellInvocation } = require(path.join(libDir, 'browser/qaap-project-bootstrap-shell'));
const { wrapCommandForDevNodeEnv } = require(path.join(libDir, 'browser/qaap-project-bootstrap-port'));
disable();

/** FileService subset the detector uses, backed by the real disk. */
const diskFileService = {
    exists: async uri => fs.existsSync(uri.path.fsPath()),
    read: async uri => ({ value: fs.readFileSync(uri.path.fsPath(), 'utf8') }),
    resolve: async uri => {
        const dir = uri.path.fsPath();
        const children = fs.readdirSync(dir, { withFileTypes: true }).map(entry => ({
            resource: uri.resolve(entry.name), name: entry.name, isDirectory: entry.isDirectory(), isFile: entry.isFile(),
            isSymbolicLink: entry.isSymbolicLink(), isReadonly: false, size: 0,
        }));
        return { resource: uri, name: path.basename(dir), isDirectory: true, isFile: false, isSymbolicLink: false, isReadonly: false, size: 0, children };
    },
};

function run(label, command, cwdUri, env = {}) {
    const cwd = cwdUri.path.fsPath();
    const { shellPath, shellArgs } = buildQaapManagedShellInvocation(wrapCommandForDevNodeEnv(command, false), cwd, 'Linux');
    console.log(`\n[${label}] cwd=${path.relative(workspace, cwd) || '.'} $ ${command}`);
    return spawn(shellPath, shellArgs, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
}

let devOutput = '';
function waitExit(child) {
    return new Promise(resolve => {
        child.stdout.on('data', d => { devOutput += d; process.stdout.write(d); });
        child.stderr.on('data', d => { devOutput += d; process.stdout.write(d); });
        child.on('exit', code => resolve(code));
    });
}

async function probe() {
    return new Promise(resolve => http.get(`http://127.0.0.1:${port}/`, res => {
        let body = '';
        res.on('data', d => { body += d; });
        res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', () => resolve(undefined)));
}

(async () => {
    const detector = new QaapProjectBootstrapDetector();
    detector.fileService = diskFileService;
    const root = URI.fromFilePath ? URI.fromFilePath(workspace) : new URI(`file://${workspace}`);
    const descriptor = await detector.detect(root);
    const app = descriptor.apps.length === 1 ? descriptor.apps[0] : descriptor.apps.find(a => a.relativePath === 'apps/web');
    console.log('[detect]', JSON.stringify({
        flavor: descriptor.monorepoFlavor, nodeModulesPresent: descriptor.nodeModulesPresent,
        workspaceRoot: descriptor.workspaceRootUri ? (path.relative(workspace, descriptor.workspaceRootUri.path.fsPath()) || '.') : undefined,
        app: app && { path: app.relativePath, devCommand: app.devCommand, bin: app.devScriptBinary, build: app.buildScript, buildRequired: app.buildRequired, buildAndStart: app.buildAndStartCommand },
    }));
    // Same arguments as resolveInstallPlanExtracted / resolveDevPlanExtracted in the bootstrap service.
    const install = plan.resolveBootstrapInstallTarget(
        { rootKey: descriptor.rootUri.toString(), workspaceRootKey: descriptor.workspaceRootUri && descriptor.workspaceRootUri.toString(), devCommand: descriptor.devCommand, installCommand: descriptor.installCommand },
        { rootKey: app.rootUri.toString(), devCommand: app.devCommand }, undefined);
    const dev = plan.resolveBootstrapDevTarget(
        { rootKey: descriptor.rootUri.toString(), devCommand: descriptor.devCommand, installCommand: descriptor.installCommand, packageManager: descriptor.packageManager, expectedPort: descriptor.expectedPort, kind: descriptor.kind },
        { rootKey: app.rootUri.toString(), devCommand: app.devCommand, expectedPort: app.expectedPort, kind: app.kind }, undefined);
    if (!descriptor.nodeModulesPresent) {
        const code = await waitExit(run('install', install.command, new URI(install.cwdKey)));
        console.log(`[install] exit ${code}`);
    } else {
        console.log('\n[install] skipped: detector reports dependencies present');
    }
    // Same guard as startDevServerExtracted: no implicit build, fail fast with how to build.
    if (app.buildRequired) {
        console.log('\n[dev] not started: build output missing and no "build": "auto" opt-in');
        console.log('RESULT: BUILD REQUIRED');
        process.exit(3);
    }
    const buildAndStart = process.env.QAAP_REPRO_BUILD_AND_START === '1' && app.buildAndStartCommand;
    const child = run(buildAndStart ? 'build-and-start' : 'dev', buildAndStart || dev.command, new URI(dev.cwdKey), { PORT: String(port) });
    const exited = waitExit(child);
    let result;
    for (let i = 0; i < 40 && !result; i++) {
        const raced = await Promise.race([exited.then(code => ({ code })), new Promise(r => setTimeout(() => r(undefined), 250))]);
        if (raced) {
            console.log(`\n[dev] exited with code ${raced.code} before listening`);
            const { diagnoseBootstrapFailure } = require(path.join(libDir, 'browser/qaap-project-bootstrap-dev-errors'));
            console.log('[diagnosis]', diagnoseBootstrapFailure(devOutput, 'exit').kind);
            console.log('RESULT: PREVIEW FAILED');
            process.exit(1);
        }
        result = await probe();
    }
    console.log(`\n[preview] GET :${port}/ -> ${result && result.status} ${result && result.body.trim()}`);
    console.log(result && result.status === 200 ? 'RESULT: PREVIEW STARTED' : 'RESULT: PREVIEW FAILED');
    child.kill();
    process.exit(result && result.status === 200 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(2); });
