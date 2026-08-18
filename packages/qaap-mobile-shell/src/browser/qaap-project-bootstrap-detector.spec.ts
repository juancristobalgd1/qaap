// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

enableJSDOM();
const browserGlobals = globalThis as unknown as { DragEvent?: unknown };
if (!browserGlobals.DragEvent) {
    browserGlobals.DragEvent = class DragEvent { };
}

import { expect } from 'chai';
import URI from '@theia/core/lib/common/uri';
import { FileUri } from '@theia/core/lib/common/file-uri';
import type { FileStat } from '@theia/filesystem/lib/common/files';
import { QaapProjectBootstrapDetector } from './qaap-project-bootstrap-detector';

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

        const descriptor = await detector.detect(URI.fromFilePath('/ws'));
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

        const descriptor = await detector.detect(URI.fromFilePath('/ws'));
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

        const descriptor = await detector.detect(URI.fromFilePath('/ws'));
        expect(descriptor?.kind).to.equal('go');
        expect(descriptor?.previewRootUri?.path.toString()).to.equal('/ws/server');
        expect(descriptor?.devCommand).to.equal("'go' 'run' '.'");
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
        expect(descriptor!.devCommand).to.include('docs/demo');
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
        expect(descriptor!.devCommand).to.include('QAAP_STATIC_ENTRY="/docs/demo/"');
        expect(descriptor!.devCommand).to.include('QAAP_STATIC_ROOT="."');
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
        expect(descriptor!.devCommand).to.include('QAAP_STATIC_ROOT="campaign"');
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
        expect(descriptor!.devCommand).to.include('QAAP_STATIC_ROOT="."');
        expect(descriptor!.devCommand).to.include('QAAP_STATIC_ENTRY="/game.html"');
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
