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
    injectQaapPreviewDiagnostics,
    injectQaapPreviewHistoryBase,
    injectQaapPreviewDocumentScripts,
    isQaapDevPreviewServedResponse,
    QAAP_DEV_PREVIEW_WAITING_HEADER,
    parseQaapDevPreviewRequestPath,
    parseQaapDevPreviewPort,
    QAAP_DEV_PREVIEW_WAITING_MAX_MS,
} from './qaap-dev-preview';

describe('qaap-dev-preview', () => {
    it('injectQaapPreviewDiagnostics before app scripts and remains idempotent', () => {
        const html = '<html><head><script src="/app.js"></script></head><body></body></html>';
        const once = injectQaapPreviewDiagnostics(html);
        expect(once).to.contain('data-qaap-preview-diagnostics');
        expect(once.indexOf('data-qaap-preview-diagnostics')).to.be.lessThan(once.indexOf('src="/app.js"'));
        expect(once).to.contain("addEventListener('unhandledrejection'");
        expect(once).to.contain('console.error=function()');
        expect(injectQaapPreviewDiagnostics(once)).to.equal(once);
    });

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
        expect(html).to.contain("method: 'HEAD'");
        expect(html).to.contain('Starting dev server');
    });

    it('injectQaapPreviewViteEnvBootstrap injects a prefix-aware /@vite/env import at head start', () => {
        const html = '<html><head><title>x</title><script type="module" async="">import("/qaap-preview/abc/entry")</script></head><body></body></html>';
        const injected = injectQaapPreviewViteEnvBootstrap(html, '/qaap-preview/abc');
        expect(injected).to.match(/<head><script>try\{var p=globalThis\.process/);
        expect(injected).to.contain('<script type="module" data-qaap-preview-vite-env>');
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

    it('injectQaapPreviewHistoryBase strips the proxy prefix from location.pathname', () => {
        const html = '<html><head><script type="module" src="/qaap-preview/abc/@vite/client"></script></head></html>';
        const injected = injectQaapPreviewHistoryBase(html, '/qaap-preview/abc/');
        expect(injected).to.contain('data-qaap-preview-history-base');
        expect(injected).to.contain('var x="/qaap-preview/abc"');
        expect(injected).to.contain('Location.prototype,"pathname"');
        expect(injected).to.contain('History.prototype.pushState');
        expect(injected).to.contain('globalThis.fetch=function(input,init)');
        expect(injected).to.contain('XMLHttpRequest.prototype.open=function(method,url)');
        expect(injected).to.contain('swProto.register=function(scriptURL,options)');
        expect(injected).to.contain('scoped.scope=scoped.scope?add(String(scoped.scope)):x+"/"');
        expect(injected).to.contain('new Request(new URL(rebased,location.href).href,input)');
        expect(injected.indexOf('data-qaap-preview-history-base'))
            .to.be.lessThan(injected.indexOf('@vite/client'));
        expect(injectQaapPreviewHistoryBase(injected, '/qaap-preview/abc/')).to.equal(injected);
        expect(injectQaapPreviewHistoryBase(html, '')).to.equal(html);
    });

    it('can inject the route bridge after the rendered document body for React hydration', () => {
        const html = '<html><head><title>app</title></head><body><main>SSR</main></body></html>';
        const withHistory = injectQaapPreviewHistoryBase(html, '/qaap-preview/abc', 'body-end');
        const withDiagnostics = injectQaapPreviewDiagnostics(withHistory, 'body-end');
        const headEnd = withDiagnostics.indexOf('</head>');
        const bodyStart = withDiagnostics.indexOf('<body>');
        const history = withDiagnostics.indexOf('data-qaap-preview-history-base');
        const diagnostics = withDiagnostics.indexOf('data-qaap-preview-diagnostics');
        expect(headEnd).to.be.lessThan(bodyStart);
        expect(bodyStart).to.be.lessThan(history);
        expect(history).to.be.lessThan(diagnostics);
        expect(diagnostics).to.be.lessThan(withDiagnostics.indexOf('</body>'));
    });

    it('injectQaapPreviewViteEnvBootstrap rebases TSS_ROUTER_BASEPATH onto the proxy prefix', () => {
        const injected = injectQaapPreviewViteEnvBootstrap('<html><head></head></html>', '/qaap-preview/abc/');
        expect(injected).to.contain('var x="/qaap-preview/abc"');
        expect(injected).to.contain('Object.defineProperty(e,"TSS_ROUTER_BASEPATH"');
        // The pin is a classic script so it executes during parsing, before any (async) module.
        expect(injected.indexOf('Object.defineProperty(e,"TSS_ROUTER_BASEPATH"'))
            .to.be.lessThan(injected.indexOf('data-qaap-preview-vite-env'));
        // Isolated-host mode keeps the app at the origin root — no rebase script at all.
        expect(injectQaapPreviewViteEnvBootstrap('<html><head></head></html>', ''))
            .to.not.contain('TSS_ROUTER_BASEPATH');
    });

    it('injectQaapPreviewHistoryBase rebases same-host HMR WebSockets under the proxy prefix', () => {
        const injected = injectQaapPreviewHistoryBase('<html><head></head></html>', '/qaap-preview/abc');
        const source = /<script data-qaap-preview-history-base>([\s\S]*?)<\/script>/.exec(injected)![1];
        const opened: Array<{ url: string; protocols?: string }> = [];
        class FakeWebSocket {
            static readonly OPEN = 1;
            constructor(url: string, protocols?: string) {
                opened.push(protocols === undefined ? { url } : { url, protocols });
            }
        }
        const sandbox: Record<string, unknown> = { WebSocket: FakeWebSocket };
        const location = { href: 'https://ide.test/qaap-preview/abc/page', host: 'ide.test', origin: 'https://ide.test' };
        // eslint-disable-next-line no-new-func
        new Function('globalThis', 'location', 'Location', 'History', 'navigator', source)(
            sandbox, location, class { }, class { pushState(): void { } replaceState(): void { } }, {});
        const Patched = sandbox.WebSocket as new (url: string, protocols?: string) => unknown;
        const socket = new Patched('wss://ide.test/_next/webpack-hmr');
        new Patched('ws://ide.test/ws', 'vite-hmr');
        new Patched('wss://ide.test/qaap-preview/abc/sockjs-node');
        new Patched('wss://other.test/socket');
        expect(opened).to.deep.equal([
            { url: 'wss://ide.test/qaap-preview/abc/_next/webpack-hmr' },
            { url: 'ws://ide.test/qaap-preview/abc/ws', protocols: 'vite-hmr' },
            { url: 'wss://ide.test/qaap-preview/abc/sockjs-node' },
            { url: 'wss://other.test/socket' },
        ]);
        expect(socket).to.be.instanceOf(FakeWebSocket);
        expect((Patched as unknown as { OPEN: number }).OPEN).to.equal(1);
    });

    it('buildDevPreviewWaitingHtml stops polling after the cap and offers a manual retry', () => {
        const html = buildDevPreviewWaitingHtml(3001);
        expect(html).to.contain(`var maxMs = ${QAAP_DEV_PREVIEW_WAITING_MAX_MS};`);
        expect(html).to.contain('Dev server still not reachable');
        expect(html).to.contain('id="qaap-wait-retry" hidden>Retry</button>');
        expect(html).to.contain("button.addEventListener('click', start)");
    });

    it('injectQaapPreviewDocumentScripts equals the individual injections in proxy order', () => {
        const documents = [
            '<html><head><title>x</title></head><body><main>app</main></body></html>',
            '<html lang="en"><body>no head</body></html>',
            '<main>fragment</main>',
            '<html><head></head><body><script type="module" src="/qaap-dev/5173/@vite/client"></script></body></html>',
        ];
        for (const prefix of ['/qaap-preview/abc', '/qaap-dev/5173', '']) {
            for (const html of documents) {
                expect(injectQaapPreviewDocumentScripts(html, prefix, 'head', true)).to.equal(injectQaapPreviewDiagnostics(
                    injectQaapPreviewHistoryBase(injectQaapPreviewViteEnvBootstrap(html, prefix), prefix, 'head'), 'head'));
                expect(injectQaapPreviewDocumentScripts(html, prefix, 'body-end', false)).to.equal(injectQaapPreviewDiagnostics(
                    injectQaapPreviewHistoryBase(html, prefix, 'body-end'), 'body-end'));
            }
        }
    });

    it('buildDevPreviewWaitingHtml only keeps polling on the proxy-marked 503', () => {
        const html = buildDevPreviewWaitingHtml(3001);
        expect(html).to.contain(`var marker = '${QAAP_DEV_PREVIEW_WAITING_HEADER}';`);
        expect(html).to.contain('if (served(r.status, r.headers.get(marker)))');
        const source = /var served = ([\s\S]*?\});\n/.exec(html)![1];
        // eslint-disable-next-line no-new-func
        const served = new Function(`return (${source});`)() as (status: number, marker: string | null) => boolean;
        for (const [status, marker] of [[200, null], [503, null], [404, null], [503, '1'], [0, null]] as const) {
            expect(served(status, marker), `${status}/${marker}`).to.equal(isQaapDevPreviewServedResponse(status, marker));
        }
        expect(isQaapDevPreviewServedResponse(503, null)).to.equal(true);
        expect(isQaapDevPreviewServedResponse(503, '1')).to.equal(false);
    });
});
