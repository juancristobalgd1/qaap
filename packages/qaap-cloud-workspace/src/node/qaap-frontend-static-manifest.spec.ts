// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { QaapFrontendStaticManifest } from './qaap-frontend-static-manifest';

class DirectoryStaticManifest extends QaapFrontendStaticManifest {
    constructor(protected readonly root: string) {
        super();
    }

    protected override frontendDir(): string {
        return this.root;
    }
}

describe('QaapFrontendStaticManifest', () => {
    let root: string;
    let manifest: QaapFrontendStaticManifest;

    before(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-static-manifest-'));
        for (const file of [
            'index.html', 'secondary-window.html', 'bundle.js', 'bundle.js.gz', 'chunk-ABC123.js', 'legal/terms.html', 'media/logo.svg',
            'hostedPlugin/p/x.js', 'webview/index.html', 'files/a.png', 'plugins/x.js', 'vscode-icons.css', 'qaap/api/x', 'services',
            'qaap-dev/3000/main.js', 'qaap-preview/id/app.js', 'mini-browser/x.js', 'socket.io/x.js', 'a/b.js', 'x',
        ]) {
            const target = path.join(root, ...file.split('/'));
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.writeFileSync(target, '');
        }
        manifest = new DirectoryStaticManifest(root);
    });

    after(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    it('treats real frontend files and the root document as static, flagging navigations', () => {
        expect(manifest.classify('GET', '/')).to.deep.equal({ static: true, isNavigation: true });
        expect(manifest.classify('GET', '/?qaap_oauth=github')).to.deep.equal({ static: true, isNavigation: true });
        expect(manifest.classify('GET', '/index.html')).to.deep.equal({ static: true, isNavigation: true });
        expect(manifest.classify('HEAD', '/secondary-window.html')).to.deep.equal({ static: true, isNavigation: true });
        for (const url of ['/bundle.js?qaap-build=x', '/chunk-ABC123.js', '/legal/terms.html', '/media/logo.svg', '/media/%6Cogo.svg']) {
            expect(manifest.classify('GET', url), url).to.deep.equal({ static: true, isNavigation: false });
        }
    });

    it('keeps unknown paths, other methods and tenant-owned prefixes with the tenant', () => {
        for (const url of [
            '/missing.js', '/legal/', '/media', '/hostedPlugin/p/x.js', '/webview/index.html', '/files/a.png', '/plugins/x.js',
            '/vscode-icons.css', '/qaap/api/x', '/services', '/qaap-dev/3000/main.js', '/qaap-preview/id/app.js', '/mini-browser/x.js',
            '/socket.io/x.js',
        ]) {
            expect(manifest.classify('GET', url).static, url).to.equal(false);
        }
        expect(manifest.classify('POST', '/index.html').static).to.equal(false);
        expect(manifest.classify(undefined, '/index.html').static).to.equal(false);
    });

    it('rejects traversal, encoded separators, backslashes and malformed escapes', () => {
        for (const url of ['/%2e%2e/x', '/../x', '/a%2Fb.js', '/a%2fb.js', '/a%5cb.js', '/a\\b.js', '/%E0%A4%A.js', 'x']) {
            expect(manifest.classify('GET', url).static, url).to.equal(false);
        }
        expect(manifest.classify('GET', '/a/b.js').static).to.equal(true);
    });

    it('claims nothing when the control plane has no frontend build', () => {
        const empty = new DirectoryStaticManifest(path.join(root, 'does-not-exist'));
        expect(empty.classify('GET', '/').static).to.equal(false);
        expect(empty.classify('GET', '/bundle.js').static).to.equal(false);
    });
});
