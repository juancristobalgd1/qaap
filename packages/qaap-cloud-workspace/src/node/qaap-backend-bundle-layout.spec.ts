// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { QaapBackendBundleLayoutCheck, QaapBackendBundleLayoutReport } from './qaap-backend-bundle-layout';

/** Shape of the generated `gen-esbuild.node.mjs` (bundler-generator.ts `compileESBuildNodeConfig`). */
const GENERATED_NODE_CONFIG = `export const nodeOptions = {
    entryPoints: {
        'main': './src-gen/backend/main',
        'ipc-bootstrap': '@theia/core/lib/node/messaging/ipc-bootstrap',
        // VS Code extension support:
        'plugin-host': '@theia/plugin-ext/lib/hosted/node/plugin-host',
        // Make sure the node-pty thread workers can be executed:
        'worker/conoutSocketWorker': 'node-pty/lib/worker/conoutSocketWorker',
        'conpty_console_list_agent': 'node-pty/lib/conpty_console_list_agent',
        'backend-init-theia': '@theia/plugin-ext/lib/hosted/node/scanners/backend-init-theia',
        'parcel-watcher': '@theia/filesystem/lib/node/parcel-watcher',
        'plugin-vscode-init': '@theia/plugin-ext-vscode/lib/node/plugin-vscode-init',
    },
    assetNames: 'native/[name]',
    outdir: 'lib/backend',
};
`;

/** Minified-style excerpts of what bundled modules compute from `__dirname`. */
const MAIN_BUNDLE = [
    'process.env.THEIA_APP_PROJECT_PATH=(0,o.resolve)(__dirname,"..","..");',
    'const t={path:(0,r.join)(__dirname,"plugin-host")};',
    'e.backendInitPath=s.join(__dirname,"plugin-vscode-init");',
    'n.CLAUDE_CODE_SHELL=a.resolve(__dirname,"../../../../scripts/qaap-guarded-bash.mjs");',
    'const rg=require("path").join(__dirname, `./native/rg${process.platform === "win32" ? ".exe" : ""}`);',
    'var d="./native/drivelist.node";',
    'i=__dirname+"/scanners/backend-init-theia.js";',
    "c=[l.resolve(__dirname,'../../../qaap-product/resources/qaap-system-skills')];",
].join('\n');

describe('QaapBackendBundleLayoutCheck', () => {
    let root: string;
    let appRoot: string;

    function write(relativeToRoot: string, content = ''): void {
        const file = path.join(root, relativeToRoot);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, content);
    }

    function remove(relativeToRoot: string): void {
        fs.rmSync(path.join(root, relativeToRoot), { recursive: true, force: true });
    }

    function run(loadNative = false): QaapBackendBundleLayoutReport {
        return new QaapBackendBundleLayoutCheck({ appRoot, platform: 'linux', arch: 'x64', loadNative }).run();
    }

    function relative(report: QaapBackendBundleLayoutReport): string[] {
        return report.problems.map(problem => `${problem.reason} ${path.relative(root, problem.path).split(path.sep).join('/')}`).sort();
    }

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-backend-bundle-layout-'));
        appRoot = path.join(root, 'app', 'examples', 'browser');
        write('app/examples/browser/package.json', '{}');
        write('app/examples/browser/gen-esbuild.node.mjs', GENERATED_NODE_CONFIG);
        write('app/examples/browser/lib/frontend/index.html', '<html></html>');
        write('app/examples/browser/lib/backend/main.js', MAIN_BUNDLE);
        for (const entry of ['ipc-bootstrap', 'plugin-host', 'backend-init-theia', 'parcel-watcher', 'plugin-vscode-init']) {
            write(`app/examples/browser/lib/backend/${entry}.js`, '"use strict";');
        }
        write('app/examples/browser/lib/backend/native/rg');
        write('app/examples/browser/lib/backend/native/drivelist.node');
        write('app/examples/browser/lib/backend/shell-integrations/bash/shellIntegration.bash');
        write('app/examples/browser/lib/prebuilds/linux-x64/pty.node');
        write('app/examples/ovsx-router-config.json', '{}');
        write('app/plugins/vscode.git/package.json', '{}');
        write('app/scripts/qaap-guarded-bash.mjs');
        write('app/packages/qaap-cloud-workspace/lib/common/qaap-agent-destructive-command-guard.js');
    });

    afterEach(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    it('accepts the image layout and tolerates only the known fallback candidates', () => {
        const report = run();

        expect(relative(report)).to.deep.equal([]);
        expect(report.toleratedMissing.map(missing => path.relative(root, missing.path).split(path.sep).join('/')).sort()).to.deep.equal([
            'app/examples/browser/lib/backend/scanners/backend-init-theia.js',
            'app/examples/qaap-product/resources/qaap-system-skills',
        ]);
    });

    it('lists every by-path dependency the bundle would fail to load', () => {
        remove('app/examples/browser/lib/prebuilds');
        remove('app/examples/browser/lib/backend/plugin-vscode-init.js');
        remove('app/examples/browser/lib/backend/native/drivelist.node');
        remove('app/examples/browser/lib/backend/native/rg');
        remove('app/scripts/qaap-guarded-bash.mjs');
        remove('app/examples/browser/lib/backend/shell-integrations/bash');

        const report = run();

        expect(relative(report)).to.deep.equal([
            'empty app/examples/browser/lib/backend/shell-integrations',
            'missing app/examples/browser/lib/backend/native/drivelist.node',
            'missing app/examples/browser/lib/backend/native/rg',
            'missing app/examples/browser/lib/backend/plugin-vscode-init.js',
            'missing app/examples/browser/lib/prebuilds/linux-x64/pty.node',
            'missing app/scripts/qaap-guarded-bash.mjs',
        ]);
        const sources = new Map(report.problems.map(problem => [path.basename(problem.path), problem.source]));
        expect(sources.get('plugin-vscode-init.js')).to.equal('gen-esbuild.node.mjs entry \'plugin-vscode-init\'');
        expect(sources.get('qaap-guarded-bash.mjs')).to.equal('lib/backend/main.js');
        expect(sources.get('pty.node')).to.match(/node-pty/);
    });

    it('requires every entry of the generated config except the Windows-only ConPTY helpers', () => {
        remove('app/examples/browser/lib/backend/ipc-bootstrap.js');
        remove('app/examples/browser/lib/backend/parcel-watcher.js');

        expect(relative(run())).to.deep.equal([
            'missing app/examples/browser/lib/backend/ipc-bootstrap.js',
            'missing app/examples/browser/lib/backend/parcel-watcher.js',
        ]);
    });

    it('reports a missing generated config instead of guessing the entries', () => {
        remove('app/examples/browser/gen-esbuild.node.mjs');

        expect(relative(run())).to.deep.equal(['missing app/examples/browser/gen-esbuild.node.mjs']);
    });

    it('catches a module-relative path that only resolves at the unbundled depth', () => {
        // An app project one level deeper keeps src-gen working for packages/*/lib/node modules but moves
        // the bundle's __dirname: '../../../../scripts' from lib/backend no longer reaches the repository root.
        const deeperAppRoot = path.join(root, 'app', 'examples', 'apps', 'browser');
        fs.mkdirSync(path.dirname(deeperAppRoot), { recursive: true });
        fs.renameSync(appRoot, deeperAppRoot);
        appRoot = deeperAppRoot;

        expect(relative(run())).to.include('missing app/examples/scripts/qaap-guarded-bash.mjs');
    });

    it('with loadNative, reports native modules that exist but cannot be loaded', () => {
        write('app/examples/browser/lib/backend/native/drivelist.node', 'not a shared object');

        const report = run(true);

        const failures = report.problems.filter(problem => problem.reason === 'load-failed').map(problem => path.basename(problem.path)).sort();
        expect(failures).to.deep.equal(['drivelist.node', 'pty.node']);
        expect(report.problems.every(problem => problem.reason === 'load-failed' && (problem.detail ?? '').length > 0)).to.equal(true);
    });
});
