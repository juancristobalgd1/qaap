// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    buildDevPreviewWaitingHtml,
    buildQaapDevPreviewOpenUrl,
    buildQaapDevPreviewUrl,
    injectQaapPreviewViteEnvBootstrap,
    parseQaapDevPreviewRequestPath,
    parseQaapDevPreviewPort,
} from './qaap-dev-preview';

describe('qaap-dev-preview', () => {

    it('buildQaapDevPreviewUrl works for VPS IP origins', () => {
        expect(buildQaapDevPreviewUrl('http://178.105.136.93:3000', 3001))
            .to.equal('http://178.105.136.93:3000/qaap-dev/3001/');
    });

    it('buildQaapDevPreviewOpenUrl uses the same-origin proxy on localhost too', () => {
        expect(buildQaapDevPreviewOpenUrl('http://localhost:3000', 5173))
            .to.equal('http://localhost:3000/qaap-dev/5173/');
        expect(buildQaapDevPreviewOpenUrl('http://127.0.0.1:3000', 5173))
            .to.equal('http://127.0.0.1:3000/qaap-dev/5173/');
    });

    it('buildQaapDevPreviewOpenUrl keeps the proxy for remote origins', () => {
        expect(buildQaapDevPreviewOpenUrl('http://178.105.136.93:3000', 5173))
            .to.equal('http://178.105.136.93:3000/qaap-dev/5173/');
    });

    it('parseQaapDevPreviewRequestPath extracts port and path', () => {
        expect(parseQaapDevPreviewRequestPath('/qaap-dev/5173/@vite/client')).to.deep.equal({
            port: 5173,
            targetPath: '/@vite/client',
        });
    });

    it('parseQaapDevPreviewPort rejects privileged ports', () => {
        expect(parseQaapDevPreviewPort('80')).to.equal(undefined);
        expect(parseQaapDevPreviewPort('3001')).to.equal(3001);
    });

    it('buildDevPreviewWaitingHtml embeds the port and auto-reload script', () => {
        const html = buildDevPreviewWaitingHtml(3001);
        expect(html).to.contain('3001');
        expect(html).to.contain('location.reload');
        expect(html).to.contain('Starting dev server');
    });

    it('injectQaapPreviewViteEnvBootstrap injects a prefix-aware /@vite/env import at head start', () => {
        const html = '<html><head><title>x</title><script type="module" async="">import("/qaap-preview/abc/entry")</script></head><body></body></html>';
        const injected = injectQaapPreviewViteEnvBootstrap(html, '/qaap-preview/abc');
        expect(injected).to.contain('<head><script type="module" data-qaap-preview-vite-env>');
        expect(injected).to.contain('await import("/qaap-preview/abc/@vite/env")');
        expect(injected.indexOf('data-qaap-preview-vite-env')).to.be.lessThan(injected.indexOf('entry'));
    });

    it('injectQaapPreviewViteEnvBootstrap is idempotent and skips pages that already load @vite/client', () => {
        const once = injectQaapPreviewViteEnvBootstrap('<html><head></head></html>', '/qaap-dev/5173');
        expect(injectQaapPreviewViteEnvBootstrap(once, '/qaap-dev/5173')).to.equal(once);
        const healthy = '<html><head><script type="module" src="/qaap-dev/5173/@vite/client"></script></head></html>';
        expect(injectQaapPreviewViteEnvBootstrap(healthy, '/qaap-dev/5173')).to.equal(healthy);
    });

    it('injectQaapPreviewViteEnvBootstrap handles isolated-host mode (empty prefix) and headless HTML', () => {
        expect(injectQaapPreviewViteEnvBootstrap('<html><body>x</body></html>', ''))
            .to.contain('await import("/@vite/env")');
        expect(injectQaapPreviewViteEnvBootstrap('<div>fragment</div>', ''))
            .to.match(/^<script type="module" data-qaap-preview-vite-env>/);
    });

    it('injectQaapPreviewViteEnvBootstrap rebases TSS_ROUTER_BASEPATH onto the proxy prefix', () => {
        const injected = injectQaapPreviewViteEnvBootstrap('<html><head></head></html>', '/qaap-preview/abc/');
        expect(injected).to.contain('const x="/qaap-preview/abc"');
        expect(injected).to.contain('Object.defineProperty(e,"TSS_ROUTER_BASEPATH"');
        // Isolated-host mode keeps the app at the origin root — no rebase script at all.
        expect(injectQaapPreviewViteEnvBootstrap('<html><head></head></html>', ''))
            .to.not.contain('TSS_ROUTER_BASEPATH');
    });
});
