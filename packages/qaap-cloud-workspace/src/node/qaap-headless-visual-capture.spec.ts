// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resolveHeadlessCaptureAppTarget } from './qaap-headless-visual-capture';

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
