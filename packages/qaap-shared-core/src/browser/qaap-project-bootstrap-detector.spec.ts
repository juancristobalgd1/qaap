// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

// The detector's imports touch the DOM while loading; give them one only for the import.
const disableImportJSDOM = enableJSDOM();
const browserGlobals = globalThis as unknown as { DragEvent?: unknown };
if (!browserGlobals.DragEvent) {
    browserGlobals.DragEvent = class DragEvent { };
}

import { expect } from 'chai';
import URI from '@theia/core/lib/common/uri';
import { OS } from '@theia/core/lib/common/os';
import { FileUri } from '@theia/core/lib/common/file-uri';
import type { FileStat } from '@theia/filesystem/lib/common/files';
import { QaapProjectBootstrapDetector } from './qaap-project-bootstrap-detector';
import { staticEntryPathFromDevCommand } from './qaap-project-bootstrap-static';
disableImportJSDOM();

const VITE_PKG = JSON.stringify({
    name: 'rioja-wines-landing-page',
    scripts: { dev: 'vite', build: 'vite build' },
    devDependencies: { vite: '^6.0.0', react: '^19.0.0' },
});

class MockFileService {
    private readonly files = new Map<string, string>();
    private readonly directories = new Set<string>();

    addDir(fsPath: string): void {
        this.directories.add(this.uriKey(fsPath));
    }

    addFile(fsPath: string, content: string): void {
        this.files.set(this.uriKey(fsPath), content);
        const parent = fsPath.replace(/\/[^/]+$/, '');
        if (parent && parent !== fsPath) {
            this.directories.add(this.uriKey(parent));
        }
    }

    async exists(uri: URI): Promise<boolean> {
        const key = uri.toString();
        return this.files.has(key) || this.directories.has(key);
    }

    async read(uri: URI): Promise<{ value: string }> {
        return { value: this.files.get(uri.toString()) ?? '' };
    }

    async resolve(uri: URI): Promise<FileStat> {
        const parentKey = uri.toString().replace(/\/?$/, '/');
        const children: FileStat[] = [];
        const seen = new Set<string>();
        const pushChild = (rel: string, isDirectory: boolean): void => {
            if (!rel || rel.includes('/') || seen.has(rel)) {
                return;
            }
            seen.add(rel);
            children.push({
                resource: new URI(`${parentKey}${rel}`),
                name: rel,
                isDirectory,
                isFile: !isDirectory,
                isSymbolicLink: false,
                isReadonly: false,
                size: 0,
            });
        };
        for (const dir of this.directories) {
            if (!dir.startsWith(parentKey) || dir.slice(0, -1) === parentKey.slice(0, -1)) {
                continue;
            }
            pushChild(dir.slice(parentKey.length), true);
        }
        for (const file of this.files.keys()) {
            if (!file.startsWith(parentKey)) {
                continue;
            }
            pushChild(file.slice(parentKey.length), false);
        }
        return {
            resource: uri,
            name: uri.path.base,
            isDirectory: true,
            isFile: false,
            isSymbolicLink: false,
            isReadonly: false,
            size: 0,
            children,
        };
    }

    private uriKey(fsPath: string): string {
        return FileUri.create(fsPath).toString();
    }
}

function bindMockFileService(detector: QaapProjectBootstrapDetector, mock: MockFileService): void {
    (detector as unknown as { fileService: MockFileService }).fileService = mock;
}

/**
 * Non-JavaScript launch plans render per backend OS (POSIX argv vs. a PowerShell wrapper), so pin
 * the backend instead of inheriting the host running the tests.
 */
async function detectWithBackend(detector: QaapProjectBootstrapDetector, backend: 'posix' | 'win32'): ReturnType<QaapProjectBootstrapDetector['detect']> {
    const previousBackendWindows = OS.backend.isWindows;
    OS.backend.isWindows = backend === 'win32';
    try {
        return await detector.detect(URI.fromFilePath('/ws'));
    } finally {
        OS.backend.isWindows = previousBackendWindows;
    }
}

describe('QaapProjectBootstrapDetector scaffold subfolders', () => {

    it('uses an explicit non-JavaScript preview plan with a workspace-contained cwd', async () => {
        const mock = new MockFileService();
        mock.addDir('/ws');
        mock.addDir('/ws/services');
        mock.addDir('/ws/services/docs');
        mock.addFile('/ws/.qaap/preview.json', JSON.stringify({
            version: 1,
            runtime: 'python',
            name: 'Python docs',
            cwd: 'services/docs',
            command: 'python3',
            args: ['-m', 'http.server', '{{PORT}}'],
            port: 8000,
        }));

        const detector = new QaapProjectBootstrapDetector();
        bindMockFileService(detector, mock);

        const descriptor = await detectWithBackend(detector, 'posix');
        expect(descriptor?.kind).to.equal('python-generic');
        expect(descriptor?.packageManager).to.equal('native');
        expect(descriptor?.previewRootUri?.path.toString()).to.equal('/ws/services/docs');
        expect(descriptor?.devCommand).to.equal("'python3' '-m' 'http.server' '{{PORT}}'");
        expect(descriptor?.expectedPort).to.equal(8000);
        expect(descriptor?.nodeModulesPresent).to.equal(true);
    });

    it('auto-detects Django at the workspace root', async () => {
        const mock = new MockFileService();
        mock.addDir('/ws');
        mock.addFile('/ws/manage.py', '#!/usr/bin/env python3');

        const detector = new QaapProjectBootstrapDetector();
        bindMockFileService(detector, mock);

        const descriptor = await detectWithBackend(detector, 'posix');
        expect(descriptor?.kind).to.equal('python-django');
        expect(descriptor?.devCommand).to.include('manage.py');
        expect(descriptor?.expectedPort).to.equal(8000);
    });

    it('auto-detects a Go app in a direct child without requiring package.json', async () => {
        const mock = new MockFileService();
        mock.addDir('/ws');
        mock.addDir('/ws/server');
        mock.addFile('/ws/server/go.mod', 'module example.test/server');

        const detector = new QaapProjectBootstrapDetector();
        bindMockFileService(detector, mock);

        const descriptor = await detectWithBackend(detector, 'posix');
        expect(descriptor?.kind).to.equal('go');
        expect(descriptor?.previewRootUri?.path.toString()).to.equal('/ws/server');
        expect(descriptor?.devCommand).to.equal("'go' 'run' '.'");
    });

    it('wraps a non-JavaScript launch plan in PowerShell on a Windows backend', async () => {
        const mock = new MockFileService();
        mock.addDir('/ws');
        mock.addDir('/ws/server');
        mock.addFile('/ws/server/go.mod', 'module example.test/server');

        const detector = new QaapProjectBootstrapDetector();
        bindMockFileService(detector, mock);

        const descriptor = await detectWithBackend(detector, 'win32');
        expect(descriptor?.kind).to.equal('go');
        expect(descriptor?.devCommand).to.match(/^powershell\.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand \S+$/);
    });

    it('detects a Vite app scaffolded in a direct child folder', async () => {
        const mock = new MockFileService();
        mock.addDir('/ws');
        mock.addDir('/ws/rioja-wines-landing-page');
        mock.addFile('/ws/rioja-wines-landing-page/package.json', VITE_PKG);

        const detector = new QaapProjectBootstrapDetector();
        bindMockFileService(detector, mock);

        const workspace = URI.fromFilePath('/ws');
        const descriptor = await detector.detect(workspace);
        expect(descriptor).to.not.equal(undefined);
        expect(descriptor!.scaffoldRelativePath).to.equal('rioja-wines-landing-page');
        expect(descriptor!.apps).to.have.length(1);
        expect(descriptor!.apps[0]!.relativePath).to.equal('rioja-wines-landing-page');
        expect(descriptor!.apps[0]!.devCommand).to.include('dev');
        expect(descriptor!.kind).to.equal('node-vite');
        expect(descriptor!.devCommand).to.equal(undefined);
    });

    it('detects a scaffolded Vite app with its own index.html instead of a static site', async () => {
        const mock = new MockFileService();
        mock.addDir('/ws');
        mock.addDir('/ws/rioja-wines-landing-page');
        mock.addFile('/ws/rioja-wines-landing-page/package.json', VITE_PKG);
        mock.addFile('/ws/rioja-wines-landing-page/index.html', '<!doctype html><script type="module" src="/src/main.ts"></script>');

        const detector = new QaapProjectBootstrapDetector();
        bindMockFileService(detector, mock);

        const descriptor = await detector.detect(URI.fromFilePath('/ws'));
        expect(descriptor?.kind).to.equal('node-vite');
        expect(descriptor?.scaffoldRelativePath).to.equal('rioja-wines-landing-page');
        expect(descriptor?.expectedPort).to.equal(5173);
    });

    it('still serves a child folder with index.html and no dev script as a static site', async () => {
        const mock = new MockFileService();
        mock.addDir('/ws');
        mock.addDir('/ws/site');
        mock.addFile('/ws/site/package.json', JSON.stringify({ name: 'site', scripts: { lint: 'eslint .' } }));
        mock.addFile('/ws/site/index.html', '<!doctype html><h1>Hi</h1>');

        const detector = new QaapProjectBootstrapDetector();
        bindMockFileService(detector, mock);

        const descriptor = await detector.detect(URI.fromFilePath('/ws'));
        expect(descriptor?.kind).to.equal('static');
    });

    it('detects multiple Vite apps in bounded nested project folders', async () => {
        const mock = new MockFileService();
        mock.addDir('/ws');
        mock.addDir('/ws/projects');
        mock.addDir('/ws/projects/admin');
        mock.addDir('/ws/projects/store');
        mock.addFile('/ws/projects/admin/package.json', VITE_PKG.replace('rioja-wines-landing-page', 'admin'));
        mock.addFile('/ws/projects/store/package.json', VITE_PKG.replace('rioja-wines-landing-page', 'store'));

        const detector = new QaapProjectBootstrapDetector();
        bindMockFileService(detector, mock);

        const descriptor = await detector.detect(URI.fromFilePath('/ws'));
        expect(descriptor?.apps.map(app => app.relativePath)).to.deep.equal([
            'projects/admin',
            'projects/store',
        ]);
        expect(descriptor?.monorepoFlavor).to.equal('implicit');
    });

    it('detects Vite from the dev script when dependencies do not declare it', async () => {
        const mock = new MockFileService();
        mock.addDir('/ws');
        mock.addFile('/ws/package.json', JSON.stringify({
            name: 'script-only-vite',
            scripts: { dev: 'vite --host 0.0.0.0' },
        }));

        const detector = new QaapProjectBootstrapDetector();
        bindMockFileService(detector, mock);

        const descriptor = await detector.detect(URI.fromFilePath('/ws'));
        expect(descriptor!.kind).to.equal('node-vite');
        expect(descriptor!.expectedPort).to.equal(5173);
    });

    it('bypasses a portless wrapper when a direct Next CLI is available', async () => {
        const mock = new MockFileService();
        mock.addDir('/ws');
        mock.addFile('/ws/package.json', JSON.stringify({
            name: 'portless-next-app',
            packageManager: 'pnpm@10.32.1',
            scripts: {
                dev: 'concurrently "portless proxy start --https" "portless run --force next dev --webpack"',
            },
            dependencies: { next: '^16.1.3', react: '^19.0.0', 'react-dom': '^19.0.0' },
        }));

        const detector = new QaapProjectBootstrapDetector();
        bindMockFileService(detector, mock);

        const descriptor = await detector.detect(URI.fromFilePath('/ws'));
        expect(descriptor!.kind).to.equal('node-next');
        expect(descriptor!.devCommand).to.equal('npm exec -- next dev --webpack');
    });

    it('prefers the explicit dev-script port over the framework default', async () => {
        const mock = new MockFileService();
        mock.addDir('/ws');
        mock.addFile('/ws/package.json', JSON.stringify({
            name: 'custom-port-vite',
            scripts: { dev: 'vite --port 4173' },
            devDependencies: { vite: '^6.0.0' },
        }));

        const detector = new QaapProjectBootstrapDetector();
        bindMockFileService(detector, mock);

        const descriptor = await detector.detect(URI.fromFilePath('/ws'));
        expect(descriptor!.kind).to.equal('node-vite');
        expect(descriptor!.expectedPort).to.equal(4173);
    });

    it('treats json-server as a generic Node preview on the conventional :3000', async () => {
        const mock = new MockFileService();
        mock.addDir('/ws');
        mock.addFile('/ws/package.json', JSON.stringify({
            name: 'json-server',
            bin: { 'json-server': 'lib/bin.js' },
            scripts: { dev: 'node --watch --experimental-strip-types src/bin.ts fixtures/db.json' },
        }));

        const detector = new QaapProjectBootstrapDetector();
        bindMockFileService(detector, mock);

        const descriptor = await detector.detect(URI.fromFilePath('/ws'));
        expect(descriptor!.kind).to.equal('node-generic');
        expect(descriptor!.expectedPort).to.equal(3000);
        expect(descriptor!.devCommand).to.include('dev');
    });

    it('serves docs/demo/index.html when a library has package.json but no dev script', async () => {
        const mock = new MockFileService();
        mock.addDir('/ws');
        mock.addDir('/ws/docs');
        mock.addDir('/ws/docs/demo');
        mock.addFile('/ws/package.json', JSON.stringify({
            name: 'marked',
            scripts: { test: 'node test', build: 'node build' },
        }));
        mock.addFile('/ws/docs/demo/index.html', '<!doctype html><title>Marked Demo</title>');

        const detector = new QaapProjectBootstrapDetector();
        bindMockFileService(detector, mock);

        const descriptor = await detector.detect(URI.fromFilePath('/ws'));
        expect(descriptor!.kind).to.equal('static');
        expect(staticEntryPathFromDevCommand(descriptor!.devCommand)).to.equal('/docs/demo/');
        expect(descriptor!.devCommand).to.include('npm run build');
        expect(descriptor!.installCommand).to.match(/npm install/);
        expect(descriptor!.expectedPort).to.equal(8080);
    });

    it('prefers build:esbuild over build for nested library static demos', async () => {
        const mock = new MockFileService();
        mock.addDir('/ws');
        mock.addDir('/ws/docs');
        mock.addDir('/ws/docs/demo');
        mock.addFile('/ws/package.json', JSON.stringify({
            name: 'marked',
            scripts: { 'build:esbuild': 'node esbuild.config.js', build: 'npm run build:esbuild && npm run build:types' },
        }));
        mock.addFile('/ws/docs/demo/index.html', '<!doctype html><title>Marked Demo</title>');

        const detector = new QaapProjectBootstrapDetector();
        bindMockFileService(detector, mock);

        const descriptor = await detector.detect(URI.fromFilePath('/ws'));
        expect(descriptor!.kind).to.equal('static');
        expect(descriptor!.devCommand).to.include('npm run build:esbuild');
        expect(descriptor!.devCommand).to.not.match(/npm run build /);
    });

    it('prefers docs/demo over a sibling docs/index.html for library static sites', async () => {
        const mock = new MockFileService();
        mock.addDir('/ws');
        mock.addDir('/ws/docs');
        mock.addDir('/ws/docs/demo');
        mock.addFile('/ws/package.json', JSON.stringify({
            name: 'marked',
            scripts: { test: 'node test', build: 'node build' },
        }));
        mock.addFile('/ws/docs/index.html', '<!doctype html><title>Docs</title>');
        mock.addFile('/ws/docs/demo/index.html', '<!doctype html><title>Marked Demo</title>');

        const detector = new QaapProjectBootstrapDetector();
        bindMockFileService(detector, mock);

        const descriptor = await detector.detect(URI.fromFilePath('/ws'));
        expect(descriptor!.kind).to.equal('static');
        expect(staticEntryPathFromDevCommand(descriptor!.devCommand)).to.equal('/docs/demo/');
    });

    it('prefers static index.html at workspace root over child Node projects', async () => {
        const mock = new MockFileService();
        mock.addDir('/ws');
        mock.addDir('/ws/rioja-wines-landing-page');
        mock.addFile('/ws/index.html', '<!doctype html><html></html>');
        mock.addFile('/ws/rioja-wines-landing-page/package.json', VITE_PKG);

        const detector = new QaapProjectBootstrapDetector();
        bindMockFileService(detector, mock);

        const descriptor = await detector.detect(URI.fromFilePath('/ws'));
        expect(descriptor!.kind).to.equal('static');
    });

    it('serves a hand-written HTML site in an arbitrary first-level folder', async () => {
        const mock = new MockFileService();
        mock.addDir('/ws');
        mock.addDir('/ws/campaign');
        mock.addFile('/ws/campaign/index.html', '<!doctype html><title>Campaign</title>');

        const detector = new QaapProjectBootstrapDetector();
        bindMockFileService(detector, mock);

        const descriptor = await detector.detect(URI.fromFilePath('/ws'));
        expect(descriptor!.kind).to.equal('static');
        expect(descriptor!.expectedPort).to.equal(8080);
        expect(staticEntryPathFromDevCommand(descriptor!.devCommand)).to.equal(undefined);
        expect(descriptor!.devCommandLabel).to.include('campaign/index.html');
    });

    it('serves a lone HTML file at the workspace root when index.html is missing', async () => {
        const mock = new MockFileService();
        mock.addDir('/ws');
        mock.addFile('/ws/game.html', '<!doctype html><title>Snake</title>');

        const detector = new QaapProjectBootstrapDetector();
        bindMockFileService(detector, mock);

        const descriptor = await detector.detect(URI.fromFilePath('/ws'));
        expect(descriptor!.kind).to.equal('static');
        expect(staticEntryPathFromDevCommand(descriptor!.devCommand)).to.equal('/game.html');
        expect(descriptor!.devCommandLabel).to.include('game.html');
    });

    it('classifies a seeded static package.json as a static preview on :8080', async () => {
        const mock = new MockFileService();
        mock.addDir('/ws');
        mock.addFile('/ws/package.json', JSON.stringify({
            name: 'landing',
            scripts: {
                dev: 'QAAP_STATIC_ROOT="." QAAP_STATIC_ENTRY="/" node -e "http.createServer()"',
            },
        }));
        mock.addFile('/ws/index.html', '<!doctype html><title>Landing</title>');

        const detector = new QaapProjectBootstrapDetector();
        bindMockFileService(detector, mock);

        const descriptor = await detector.detect(URI.fromFilePath('/ws'));
        expect(descriptor!.kind).to.equal('static');
        expect(descriptor!.expectedPort).to.equal(8080);
        expect(descriptor!.devCommand).to.match(/npm run dev/);
    });

    it('lists scaffold candidates for diagnostics when nothing is selected yet', async () => {
        const mock = new MockFileService();
        mock.addDir('/ws');
        mock.addDir('/ws/rioja-wines-landing-page');
        mock.addFile('/ws/rioja-wines-landing-page/package.json', VITE_PKG);

        const detector = new QaapProjectBootstrapDetector();
        bindMockFileService(detector, mock);

        const candidates = await detector.listScaffoldSubfolderCandidates(URI.fromFilePath('/ws'));
        expect(candidates.map(c => c.relativePath)).to.deep.equal(['rioja-wines-landing-page']);
    });
});

describe('QaapProjectBootstrapDetector package-manager workspaces', () => {

    /** The Theia/Qaap layout: npm workspaces + lerna, no root dev script, `theia start` in a member. */
    function theiaMonorepo(mock: MockFileService): void {
        mock.addDir('/ws');
        mock.addDir('/ws/.git');
        mock.addFile('/ws/package.json', JSON.stringify({
            name: '@theia/monorepo',
            private: true,
            scripts: { 'build:browser': 'cd examples/browser && npm run build' },
            workspaces: ['dev-packages/*', 'packages/*', 'examples/*'],
        }));
        mock.addFile('/ws/lerna.json', JSON.stringify({ npmClient: 'npm' }));
        mock.addFile('/ws/package-lock.json', '{}');
        mock.addDir('/ws/examples');
        mock.addFile('/ws/examples/browser/package.json', JSON.stringify({
            name: '@theia/example-browser',
            scripts: {
                build: 'theiaext build && npm run -s bundle',
                start: 'theia start --log-level=warn --plugins=local-dir:../../plugins',
            },
            dependencies: { '@theia/core': '1.73.0' },
            devDependencies: { '@theia/cli': '1.73.0' },
        }));
    }

    it('installs at the workspace root and never builds `theia start` without an opt-in', async () => {
        const mock = new MockFileService();
        theiaMonorepo(mock);
        const detector = new QaapProjectBootstrapDetector();
        bindMockFileService(detector, mock);

        const descriptor = await detector.detect(URI.fromFilePath('/ws'));
        expect(descriptor?.monorepoFlavor).to.equal('npm-workspaces');
        expect(descriptor?.workspaceRootUri?.path.toString()).to.equal('/ws');
        const app = descriptor?.apps.find(candidate => candidate.relativePath === 'examples/browser');
        expect(app?.devScriptBinary).to.equal('theia');
        expect(app?.buildScript).to.equal(undefined);
        expect(app?.devCommand).to.equal('npm run start');
        // `theia start` names no output folder: it is not a certain miss, so it is not blocked either.
        expect(app?.buildRequired).to.equal(undefined);
        expect(descriptor?.nodeModulesPresent).to.equal(false);
    });

    it('builds before `theia start` only when .qaap/preview.json opts in with "build": "auto"', async () => {
        const mock = new MockFileService();
        theiaMonorepo(mock);
        mock.addFile('/ws/.qaap/preview.json', JSON.stringify({ build: 'auto' }));
        const detector = new QaapProjectBootstrapDetector();
        bindMockFileService(detector, mock);

        const descriptor = await detector.detect(URI.fromFilePath('/ws'));
        const app = descriptor?.apps.find(candidate => candidate.relativePath === 'examples/browser');
        expect(app?.buildScript).to.equal('build');
        expect(app?.devCommand).to.equal('npm run build && npm run start');
        expect(app?.previewStartCommand).to.equal('npm run start');

        // The opt-in never rebuilds a member whose output already exists.
        mock.addDir('/ws/examples/browser/lib');
        const built = await detector.detect(URI.fromFilePath('/ws'));
        const builtApp = built?.apps.find(candidate => candidate.relativePath === 'examples/browser');
        expect(builtApp?.buildScript).to.equal(undefined);
        expect(builtApp?.devCommand).to.equal('npm run start');
    });

    it('marks a member whose start script runs a missing output folder as build-required (no opt-in)', async () => {
        const mock = new MockFileService();
        mock.addDir('/ws');
        mock.addDir('/ws/.git');
        mock.addFile('/ws/package.json', JSON.stringify({ name: 'root', private: true, workspaces: ['apps/*'] }));
        mock.addFile('/ws/package-lock.json', '{}');
        mock.addDir('/ws/apps');
        mock.addFile('/ws/apps/api/package.json', JSON.stringify({
            name: 'api', scripts: { build: 'tsc', start: 'node dist/server.js' },
        }));
        const detector = new QaapProjectBootstrapDetector();
        bindMockFileService(detector, mock);

        const descriptor = await detector.detect(URI.fromFilePath('/ws'));
        const app = descriptor?.apps.find(candidate => candidate.relativePath === 'apps/api');
        expect(app?.buildRequired).to.equal(true);
        expect(app?.buildOutputUri?.path.toString()).to.equal('/ws/apps/api/dist');
        expect(app?.buildScript).to.equal(undefined);
        expect(app?.devCommand).to.equal('npm run start');
    });

    it('scans workspace bins only when the app script bin is not a declared dependency', async () => {
        const mock = new MockFileService();
        mock.addDir('/ws');
        mock.addDir('/ws/.git');
        mock.addFile('/ws/package.json', JSON.stringify({ name: 'root', private: true, workspaces: ['apps/*', 'tools/*'] }));
        mock.addFile('/ws/package-lock.json', '{}');
        mock.addDir('/ws/apps');
        mock.addDir('/ws/tools');
        mock.addFile('/ws/apps/web/package.json', JSON.stringify({ name: 'web', scripts: { start: 'fixture-serve src' } }));
        mock.addFile('/ws/apps/site/package.json', JSON.stringify({ name: 'site', scripts: { dev: 'vite' }, devDependencies: { vite: '6' } }));
        mock.addFile('/ws/tools/serve-cli/package.json', JSON.stringify({ name: 'serve-cli', bin: { 'fixture-serve': 'bin.js' } }));
        const detector = new QaapProjectBootstrapDetector();
        bindMockFileService(detector, mock);
        const reads: string[] = [];
        const read = mock.read.bind(mock);
        (mock as unknown as { read: typeof read }).read = (async (uri: URI) => { reads.push(uri.path.toString()); return read(uri); }) as typeof read;

        const descriptor = await detector.detect(URI.fromFilePath('/ws'));
        expect(descriptor?.apps.find(app => app.name === 'web')?.devScriptBinary).to.equal('fixture-serve');
        expect(descriptor?.apps.find(app => app.name === 'site')?.devScriptBinary).to.equal('vite');
        // The bin scan read the tool's manifest once even though two apps were resolved.
        expect(reads.filter(path => path === '/ws/tools/serve-cli/package.json').length).to.be.at.most(2);
    });

    it('does not trust a partial root node_modules that lacks the script bin', async () => {
        const mock = new MockFileService();
        theiaMonorepo(mock);
        // An interrupted install: node_modules and .bin exist, `theia` does not.
        mock.addDir('/ws/node_modules');
        mock.addFile('/ws/node_modules/.bin/lerna', '');
        const detector = new QaapProjectBootstrapDetector();
        bindMockFileService(detector, mock);

        const descriptor = await detector.detect(URI.fromFilePath('/ws'));
        expect(descriptor?.nodeModulesPresent).to.equal(false);
    });

    it('skips install and build once the hoisted bin and the build output exist', async () => {
        const mock = new MockFileService();
        theiaMonorepo(mock);
        mock.addDir('/ws/node_modules');
        mock.addFile('/ws/node_modules/.bin/theia', '');
        mock.addDir('/ws/examples/browser/lib');
        const detector = new QaapProjectBootstrapDetector();
        bindMockFileService(detector, mock);

        const descriptor = await detector.detect(URI.fromFilePath('/ws'));
        const app = descriptor?.apps.find(candidate => candidate.relativePath === 'examples/browser');
        expect(descriptor?.nodeModulesPresent).to.equal(true);
        expect(app?.buildScript).to.equal(undefined);
        expect(app?.devCommand).to.equal('npm run start');
    });

    it('resolves the enclosing workspace when a member folder is opened directly', async () => {
        const mock = new MockFileService();
        mock.addDir('/ws');
        mock.addDir('/ws/.git');
        mock.addFile('/ws/package.json', JSON.stringify({ name: 'root', private: true, workspaces: ['apps/*'] }));
        mock.addFile('/ws/yarn.lock', '');
        mock.addDir('/ws/apps');
        mock.addFile('/ws/apps/web/package.json', JSON.stringify({ name: 'web', scripts: { dev: 'vite' }, devDependencies: { vite: '^6.0.0' } }));
        mock.addDir('/ws/node_modules');
        mock.addFile('/ws/node_modules/.bin/vite', '');
        const detector = new QaapProjectBootstrapDetector();
        bindMockFileService(detector, mock);

        const descriptor = await detector.detect(URI.fromFilePath('/ws/apps/web'));
        expect(descriptor?.workspaceRootUri?.path.toString()).to.equal('/ws');
        expect(descriptor?.packageManager).to.equal('yarn');
        expect(descriptor?.devCommand).to.equal('yarn dev');
        expect(descriptor?.nodeModulesPresent).to.equal(true);
    });

    it('uses the opened folder as the discovery ceiling off the hosted layout', async () => {
        const mock = new MockFileService();
        mock.addDir('/ws');
        mock.addDir('/ws/.git');
        mock.addFile('/ws/package.json', JSON.stringify({ name: 'root', private: true, workspaces: ['apps/*'] }));
        mock.addDir('/ws/apps');
        mock.addFile('/ws/apps/web/package.json', JSON.stringify({ name: 'web', scripts: { dev: 'vite' }, devDependencies: { vite: '^6.0.0' } }));
        const detector = new QaapProjectBootstrapDetector();
        bindMockFileService(detector, mock);
        const withRoots = (roots: string[]): void => {
            (detector as unknown as { workspaceService: object }).workspaceService = {
                tryGetRoots: () => roots.map(root => ({ resource: URI.fromFilePath(root) })),
            };
        };

        withRoots(['/ws/apps/web']);
        expect((await detector.detect(URI.fromFilePath('/ws/apps/web')))?.workspaceRootUri).to.equal(undefined);
        withRoots(['/ws']);
        expect((await detector.detect(URI.fromFilePath('/ws/apps/web')))?.workspaceRootUri?.path.toString()).to.equal('/ws');
    });

    it('offers the declared build as an explicit Build and start command, never as the dev command', async () => {
        const mock = new MockFileService();
        theiaMonorepo(mock);
        const detector = new QaapProjectBootstrapDetector();
        bindMockFileService(detector, mock);

        const app = (await detector.detect(URI.fromFilePath('/ws')))?.apps.find(candidate => candidate.relativePath === 'examples/browser');
        expect(app?.devCommand).to.equal('npm run start');
        expect(app?.buildAndStartCommand).to.equal('npm run build && npm run start');
        expect(app?.previewStartCommand).to.equal('npm run start');

        mock.addFile('/ws/.qaap/preview.json', JSON.stringify({ build: 'auto' }));
        const optedIn = (await detector.detect(URI.fromFilePath('/ws')))?.apps.find(candidate => candidate.relativePath === 'examples/browser');
        expect(optedIn?.buildAndStartCommand).to.equal(undefined);
    });

    it('does not trust a pnpm store when the app script bin is missing', async () => {
        const mock = new MockFileService();
        mock.addDir('/ws');
        mock.addDir('/ws/.git');
        mock.addFile('/ws/package.json', JSON.stringify({ name: 'root', private: true }));
        mock.addFile('/ws/pnpm-workspace.yaml', 'packages:\n  - apps/*\n');
        mock.addFile('/ws/pnpm-lock.yaml', '');
        mock.addDir('/ws/apps');
        mock.addFile('/ws/apps/web/package.json', JSON.stringify({
            name: 'web', scripts: { start: 'serve-site public' }, devDependencies: { 'serve-site': '1.0.0' },
        }));
        // Interrupted install: the store exists, the bin was never linked.
        mock.addDir('/ws/node_modules');
        mock.addDir('/ws/node_modules/.pnpm');
        const detector = new QaapProjectBootstrapDetector();
        bindMockFileService(detector, mock);

        expect((await detector.detect(URI.fromFilePath('/ws')))?.nodeModulesPresent).to.equal(false);
        mock.addFile('/ws/node_modules/.bin/serve-site', '');
        expect((await detector.detect(URI.fromFilePath('/ws')))?.nodeModulesPresent).to.equal(true);
    });

    it('does not trust an interrupted install for a member folder opened directly', async () => {
        const mock = new MockFileService();
        mock.addDir('/ws');
        mock.addDir('/ws/.git');
        mock.addFile('/ws/package.json', JSON.stringify({ name: 'root', private: true, workspaces: ['apps/*'] }));
        mock.addDir('/ws/apps');
        mock.addFile('/ws/apps/api/package.json', JSON.stringify({
            name: 'api', scripts: { start: 'fastify start app.js' }, dependencies: { fastify: '5.0.0' },
        }));
        mock.addDir('/ws/node_modules');
        mock.addFile('/ws/node_modules/.bin/tsc', '');
        const detector = new QaapProjectBootstrapDetector();
        bindMockFileService(detector, mock);

        const descriptor = await detector.detect(URI.fromFilePath('/ws/apps/api'));
        expect(descriptor?.devScriptBinary).to.equal('fastify');
        expect(descriptor?.nodeModulesPresent).to.equal(false);
    });

    it('never requires a system tool the script calls (docker) as an installed bin', async () => {
        const mock = new MockFileService();
        mock.addDir('/ws');
        mock.addDir('/ws/.git');
        mock.addFile('/ws/package.json', JSON.stringify({ name: 'root', private: true, workspaces: ['apps/*'] }));
        mock.addDir('/ws/apps');
        mock.addFile('/ws/apps/db/package.json', JSON.stringify({ name: 'db', scripts: { start: 'docker compose up' } }));
        mock.addDir('/ws/node_modules');
        const detector = new QaapProjectBootstrapDetector();
        bindMockFileService(detector, mock);

        const descriptor = await detector.detect(URI.fromFilePath('/ws'));
        expect(descriptor?.apps[0]?.devScriptBinary).to.equal(undefined);
        expect(descriptor?.nodeModulesPresent).to.equal(true);
    });

    it('keeps standalone projects and implicit app folders on their own install root', async () => {
        const mock = new MockFileService();
        mock.addDir('/ws');
        mock.addDir('/ws/.git');
        mock.addFile('/ws/package.json', VITE_PKG);
        const detector = new QaapProjectBootstrapDetector();
        bindMockFileService(detector, mock);

        const descriptor = await detector.detect(URI.fromFilePath('/ws'));
        expect(descriptor?.workspaceRootUri).to.equal(undefined);
        expect(descriptor?.devCommand).to.equal('npm run dev');
    });
});
