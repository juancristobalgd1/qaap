// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { chromium } from 'playwright-core';
import {
    applyQaapHeadlessRuntimeDiagnostics,
    inspectQaapHeadlessPage,
    qaapHeadlessPublicPreviewLeaseMs,
    resolveHeadlessCaptureAppTarget,
    resolveHeadlessChromiumExecutable,
    resolveQaapStaticPreviewFile,
} from './qaap-headless-visual-capture';

describe('resolveQaapStaticPreviewFile', () => {
    let root: string;
    let sibling: string;

    beforeEach(() => {
        const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-static-preview-'));
        root = path.join(parent, 'app');
        sibling = path.join(parent, 'app-private');
        fs.mkdirSync(root);
        fs.mkdirSync(sibling);
        fs.writeFileSync(path.join(root, 'index.html'), '<h1>App</h1>');
        fs.writeFileSync(path.join(root, 'asset.js'), 'console.log("safe")');
        fs.writeFileSync(path.join(sibling, 'secret.txt'), 'secret');
    });

    afterEach(() => {
        fs.rmSync(path.dirname(root), { recursive: true, force: true });
    });

    it('serves contained files and preserves the SPA fallback', async () => {
        expect(await resolveQaapStaticPreviewFile(root, '/asset.js')).to.equal(fs.realpathSync(path.join(root, 'asset.js')));
        expect(await resolveQaapStaticPreviewFile(root, '/dashboard?tab=active')).to.equal(fs.realpathSync(path.join(root, 'index.html')));
    });

    it('rejects plain, encoded, prefix-sibling, and malformed traversal paths', async () => {
        expect(await resolveQaapStaticPreviewFile(root, '/../app-private/secret.txt')).to.equal(undefined);
        expect(await resolveQaapStaticPreviewFile(root, '/%2e%2e/app-private/secret.txt')).to.equal(undefined);
        expect(await resolveQaapStaticPreviewFile(root, '/../app-private')).to.equal(undefined);
        expect(await resolveQaapStaticPreviewFile(root, '/%E0%A4%A')).to.equal(undefined);
    });

    it('rejects a symlink that resolves outside the preview root', async function (): Promise<void> {
        try {
            fs.symlinkSync(path.join(sibling, 'secret.txt'), path.join(root, 'linked-secret.txt'));
        } catch {
            this.skip();
            return;
        }
        expect(await resolveQaapStaticPreviewFile(root, '/linked-secret.txt')).to.equal(undefined);
    });
});

describe('qaapHeadlessPublicPreviewLeaseMs', () => {
    it('defaults and clamps preview leases to a bounded duration', () => {
        expect(qaapHeadlessPublicPreviewLeaseMs(undefined)).to.equal(15 * 60_000);
        expect(qaapHeadlessPublicPreviewLeaseMs('1')).to.equal(60_000);
        expect(qaapHeadlessPublicPreviewLeaseMs(String(48 * 60 * 60_000))).to.equal(24 * 60 * 60_000);
    });
});

describe('resolveHeadlessCaptureAppTarget', () => {
    let root: string;

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-headless-target-'));
    });

    afterEach(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    const writeJson = (file: string, value: unknown): void => {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify(value));
    };

    it('picks the root project and infers the Vite port', () => {
        writeJson(path.join(root, 'package.json'), {
            scripts: { dev: 'vite' },
            devDependencies: { vite: '^5.0.0' },
        });
        const target = resolveHeadlessCaptureAppTarget(root);
        expect(target).to.deep.equal({ root, kind: 'script', expectedPort: 5173 });
    });

    it('uses the same explicit argv preview plan for a non-JavaScript app', () => {
        const app = path.join(root, 'services', 'docs');
        fs.mkdirSync(app, { recursive: true });
        writeJson(path.join(root, '.qaap', 'preview.json'), {
            version: 1,
            runtime: 'python',
            cwd: 'services/docs',
            command: 'python3',
            args: ['-m', 'http.server', '{{PORT}}'],
            port: 8000,
        });
        const target = resolveHeadlessCaptureAppTarget(root);
        expect(target?.root).to.equal(app);
        expect(target?.expectedPort).to.equal(8000);
        expect(target?.launch?.command).to.equal('python3');
        expect(target?.launch?.args).to.deep.equal(['-m', 'http.server', '{{PORT}}']);
    });

    it('auto-detects Django without package.json', () => {
        fs.writeFileSync(path.join(root, 'manage.py'), '#!/usr/bin/env python3');
        const target = resolveHeadlessCaptureAppTarget(root);
        expect(target?.root).to.equal(root);
        expect(target?.expectedPort).to.equal(8000);
        expect(target?.launch?.args).to.deep.equal(['manage.py', 'runserver', '0.0.0.0:{{PORT}}']);
    });

    it('rejects an explicit preview cwd that escapes the workspace', () => {
        writeJson(path.join(root, '.qaap', 'preview.json'), {
            version: 1,
            runtime: 'custom',
            cwd: '..',
            command: 'python3',
            args: ['-m', 'http.server', '{{PORT}}'],
            port: 8000,
        });
        expect(resolveHeadlessCaptureAppTarget(root)).to.equal(undefined);
    });

    it('parses a port pinned in the dev script itself (static wrapper scripts)', () => {
        writeJson(path.join(root, 'package.json'), {
            scripts: { dev: 'http-server -p 8080 .' },
        });
        expect(resolveHeadlessCaptureAppTarget(root)?.expectedPort).to.equal(8080);
        writeJson(path.join(root, 'package.json'), {
            scripts: { dev: 'python3 -m http.server 5173' },
        });
        expect(resolveHeadlessCaptureAppTarget(root)?.expectedPort).to.equal(5173);
    });

    it('honors an explicit vite.config server.port', () => {
        writeJson(path.join(root, 'package.json'), {
            scripts: { dev: 'vite' },
            devDependencies: { vite: '^5.0.0' },
        });
        fs.writeFileSync(path.join(root, 'vite.config.ts'), 'export default { server: { port: 4444 } };');
        expect(resolveHeadlessCaptureAppTarget(root)?.expectedPort).to.equal(4444);
    });

    it('finds a runnable child project two levels down (artifacts/<app> layout)', () => {
        const app = path.join(root, 'artifacts', 'studio');
        writeJson(path.join(app, 'package.json'), {
            scripts: { dev: 'vite --config vite.config.ts' },
            dependencies: { vite: '^5.0.0' },
        });
        const target = resolveHeadlessCaptureAppTarget(root);
        expect(target?.root).to.equal(app);
        expect(target?.kind).to.equal('script');
    });

    it('falls back to a static index.html workspace', () => {
        fs.writeFileSync(path.join(root, 'index.html'), '<!DOCTYPE html><h1>Hi</h1>');
        expect(resolveHeadlessCaptureAppTarget(root)).to.deep.equal({ root, kind: 'static', expectedPort: 0 });
    });

    it('returns undefined for a workspace with nothing runnable', () => {
        fs.writeFileSync(path.join(root, 'README.md'), 'just docs');
        expect(resolveHeadlessCaptureAppTarget(root)).to.equal(undefined);
    });

    it('ignores package.json files without dev/start scripts', () => {
        writeJson(path.join(root, 'package.json'), { scripts: { test: 'mocha' } });
        fs.writeFileSync(path.join(root, 'index.html'), '<!DOCTYPE html><h1>Hi</h1>');
        expect(resolveHeadlessCaptureAppTarget(root)?.kind).to.equal('static');
    });
});

describe('inspectQaapHeadlessPage', () => {
    it('fails HTTP-200 fixtures that throw during render or remain blank', async function (): Promise<void> {
        const executablePath = resolveHeadlessChromiumExecutable();
        if (!executablePath) {
            this.skip();
            return;
        }
        const server = http.createServer((request, response) => {
            if (request.url === '/broken.js') {
                response.writeHead(503, { 'Content-Type': 'text/javascript' });
                response.end('/* fixture outage */');
                return;
            }
            response.writeHead(200, { 'Content-Type': 'text/html' });
            if (request.url === '/exception') {
                response.end('<!doctype html><h1>Fixture application</h1><p>This response is HTTP 200.</p>'
                    + '<script>Promise.reject(new Error("fixture rejected"));throw new Error("fixture boom")</script>');
                return;
            }
            if (request.url === '/network') {
                response.end('<!doctype html><h1>Fixture application</h1><p>This response is HTTP 200.</p>'
                    + '<script src="/broken.js"></script>'
                    + '<script>fetch("http://127.0.0.1:1/unreachable").catch(function(){})</script>');
                return;
            }
            response.end('<!doctype html><html><body><div id="root"></div></body></html>');
        });
        await new Promise<void>((resolve, reject) => {
            server.once('error', reject);
            server.listen(0, '127.0.0.1', resolve);
        });
        const address = server.address();
        expect(address && typeof address === 'object').to.equal(true);
        const port = address && typeof address === 'object' ? address.port : 0;
        const browser = await chromium.launch({
            executablePath,
            headless: true,
            args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
        });
        try {
            const page = await browser.newPage();
            const exception = await inspectQaapHeadlessPage(page, `http://127.0.0.1:${port}/exception`, 50);
            expect(exception.status).to.equal('failed');
            expect(exception.readiness).to.equal('failed');
            expect(exception.issues.some(issue => issue.includes('fixture boom'))).to.equal(true);
            expect(exception.issues.some(issue => issue.includes('fixture rejected'))).to.equal(true);

            const network = await inspectQaapHeadlessPage(page, `http://127.0.0.1:${port}/network`, 50);
            expect(network.status).to.equal('failed');
            expect(network.issues.some(issue => issue.includes('http: 503'))).to.equal(true);
            expect(network.issues.some(issue => issue.includes('requestfailed'))).to.equal(true);

            const blank = await inspectQaapHeadlessPage(page, `http://127.0.0.1:${port}/blank`, 50);
            expect(blank.status).to.equal('failed');
            expect(blank.readiness).to.equal('failed');
            expect(blank.issues.some(issue => issue.includes('appears empty'))).to.equal(true);
        } finally {
            await browser.close();
            await new Promise<void>(resolve => server.close(() => resolve()));
        }
    // Three sequential Chromium navigations can each use the production page-load
    // budget. Keep the test deadline above that aggregate budget on busy CI runners.
    }).timeout(120_000);

    it('turns request/runtime diagnostics into a failed non-ready result', () => {
        const result = applyQaapHeadlessRuntimeDiagnostics({
            status: 'passed',
            readiness: 'render_ready',
            summary: 'DOM passed.',
            issues: [],
        }, ['http: 503 http://localhost/api', 'requestfailed: net::ERR_FAILED']);
        expect(result.status).to.equal('failed');
        expect(result.readiness).to.equal('failed');
        expect(result.issues).to.have.length(2);
    });
});
