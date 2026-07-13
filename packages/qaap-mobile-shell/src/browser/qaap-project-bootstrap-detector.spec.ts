// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

enableJSDOM();

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
        for (const dir of this.directories) {
            if (!dir.startsWith(parentKey) || dir.slice(0, -1) === parentKey.slice(0, -1)) {
                continue;
            }
            const rel = dir.slice(parentKey.length);
            if (!rel || rel.includes('/')) {
                continue;
            }
            if (seen.has(rel)) {
                continue;
            }
            seen.add(rel);
            children.push({
                resource: new URI(`${parentKey}${rel}`),
                name: rel,
                isDirectory: true,
                isFile: false,
                isSymbolicLink: false,
                isReadonly: false,
                size: 0,
            });
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
