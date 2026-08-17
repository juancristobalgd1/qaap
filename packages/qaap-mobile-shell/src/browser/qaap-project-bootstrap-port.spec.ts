// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
    getImplicitDevPort,
    isReservedIdePort,
    pickAlternateDevPort,
    pickNextDevPort,
    resolveBootstrapDevPort,
    wrapDevCommandForPort,
} from './qaap-project-bootstrap-port';

describe('qaap-project-bootstrap-port', () => {

    it('pickAlternateDevPort prefers 3001 when framework defaults to 3000', () => {
        expect(pickAlternateDevPort(3000, 3000)).to.equal(3001);
    });

    it('resolveBootstrapDevPort shifts off the IDE listener', () => {
        expect(resolveBootstrapDevPort(3000, 3000)).to.equal(3001);
        expect(resolveBootstrapDevPort(5173, 3000)).to.equal(5173);
        expect(resolveBootstrapDevPort(3000, 3001)).to.equal(3000);
    });

    it('isReservedIdePort treats matching IDE port as reserved', () => {
        expect(isReservedIdePort(3000, 3000)).to.equal(true);
        expect(isReservedIdePort(3000, undefined)).to.equal(true);
        expect(isReservedIdePort(3000, 3001)).to.equal(false);
        expect(isReservedIdePort(3001, 3000)).to.equal(false);
    });

    it('resolveBootstrapDevPort shifts Next off :3000 even without browser ide port', () => {
        expect(resolveBootstrapDevPort(3000, undefined)).to.equal(3001);
    });

    it('wrapDevCommandForPort uses PORT= for CRA-style stacks', () => {
        const command = wrapDevCommandForPort('npm run dev', 3001, 'node-cra');
        expect(command).to.include('QAAP_PREVIEW_PORT=3001 PORT=3001');
        expect(command).to.include('--import=data:text/javascript;base64,');
        expect(command).to.match(/npm run dev$/);
    });

    it('wrapDevCommandForPort forces NODE_ENV=development so production hosts do not poison vite dev', () => {
        const command = wrapDevCommandForPort('npm run dev', 3001, 'node-cra');
        expect(command).to.include('NODE_ENV=development ');
    });

    it('wrapDevCommandForPort sets PORT and --port for Vite (overrides Docker IDE PORT)', () => {
        const command = wrapDevCommandForPort('npm run dev', 5174, 'node-vite');
        expect(command).to.include('QAAP_PREVIEW_PORT=5174 PORT=5174');
        expect(command).to.match(/npm run dev -- --port 5174 --strictPort$/);
        expect(command).to.include('--strictPort');
    });

    it('wrapDevCommandForPort skips the `--` separator for pnpm (it forwards args literally)', () => {
        const command = wrapDevCommandForPort('pnpm run dev', 5174, 'node-vite');
        expect(command).to.match(/pnpm run dev --port 5174 --strictPort$/);
        expect(command).not.to.include(' -- --port');
    });

    it('wrapDevCommandForPort injects port flags into concurrently vite subcommands', () => {
        const command = wrapDevCommandForPort(
            'npx concurrently "vite" "node bridge.js"',
            5173,
            'node-vite',
        );
        expect(command).to.include('"vite --port 5173 --strictPort"');
        expect(command).to.include('"node bridge.js"');
        expect(command).to.match(/ -- --port 5173 --strictPort$/);
    });

    it('wrapDevCommandForPort injects port flags into quoted vite dev chains (cloud-spark style)', () => {
        const command = wrapDevCommandForPort(
            'npx concurrently "vite dev --host 0.0.0.0" "node scripts/run-pty-bridge.mjs || true"',
            5173,
            'node-vite',
        );
        expect(command).to.include('"vite dev --host 0.0.0.0 --port 5173 --strictPort"');
        expect(command).to.include('"node scripts/run-pty-bridge.mjs || true"');
    });

    it('getImplicitDevPort defaults generic Node apps to 3000', () => {
        expect(getImplicitDevPort('node-generic')).to.equal(3000);
        expect(getImplicitDevPort('node-vite')).to.equal(5173);
    });

    it('materializes native preview ports without injecting Node options', () => {
        const command = wrapDevCommandForPort(
            "'python3' '-m' 'http.server' '{{PORT}}'",
            8001,
            'python-generic',
        );
        expect(command).to.include("'http.server' '8001'");
        expect(command).to.include('PORT=8001');
        expect(command).not.to.include('NODE_OPTIONS');
    });

    it('wrapDevCommandForPort passes -p to Next after PORT=', () => {
        expect(wrapDevCommandForPort('npm run dev', 3001, 'node-next')).to.match(/npm run dev -- -p 3001$/);
    });

    it('wrapDevCommandForPort skips `--` for pnpm+Next too', () => {
        const command = wrapDevCommandForPort('pnpm run dev', 3001, 'node-next');
        expect(command).to.match(/pnpm run dev -p 3001$/);
        expect(command).not.to.include(' -- -p');
    });

    it('forces the allocated port when an npm script overwrites PORT inline', function (): void {
        if (process.platform === 'win32') {
            this.skip();
        }
        const command = wrapDevCommandForPort(
            `PORT=8080 node -e 'process.stdout.write(process.env.PORT)'`,
            8081,
            'node-generic',
        );
        expect(execFileSync('/bin/sh', ['-c', command], { encoding: 'utf8' })).to.equal('8081');
    });

    it('forces a nested Vite child without overwriting a sibling service port', function (): void {
        if (process.platform === 'win32') {
            this.skip();
        }
        const directory = mkdtempSync(join(tmpdir(), 'qaap-preview-port-'));
        const vite = join(directory, 'vite');
        const sibling = join(directory, 'server.js');
        const runner = join(directory, 'runner.cjs');
        try {
            writeFileSync(vite, "process.stdout.write(JSON.stringify({ port: process.env.PORT, argv: process.argv.slice(2) }));");
            writeFileSync(sibling, "process.stdout.write(process.env.PORT || '');");
            writeFileSync(runner, [
                "const { execFileSync } = require('child_process');",
                `const app = execFileSync(process.execPath, [${JSON.stringify(vite)}], { encoding: 'utf8' });`,
                `const sibling = execFileSync(process.execPath, [${JSON.stringify(sibling)}], {`,
                "    encoding: 'utf8', env: { ...process.env, PORT: '8787' },",
                '});',
                "process.stdout.write(JSON.stringify({ app: JSON.parse(app), sibling }));",
            ].join('\n'));
            // The trailing CLI flag is deliberately swallowed by the runner, just like
            // `concurrently`; the inherited targeted preload must still patch the Vite child.
            const command = wrapDevCommandForPort(`node ${JSON.stringify(runner)}`, 5182, 'node-vite');
            const result = JSON.parse(execFileSync('/bin/sh', ['-c', command], { encoding: 'utf8' })) as {
                app: { port: string; argv: string[] };
                sibling: string;
            };
            expect(result.app.port).to.equal('5182');
            expect(result.app.argv).to.deep.equal(['--port', '5182', '--strictPort', '--host', '127.0.0.1']);
            expect(result.sibling).to.equal('8787');
        } finally {
            rmSync(directory, { recursive: true, force: true });
        }
    });

    it('still adds --strictPort when the Vite child already receives --port in argv', function (): void {
        if (process.platform === 'win32') {
            this.skip();
        }
        const directory = mkdtempSync(join(tmpdir(), 'qaap-preview-port-'));
        const vite = join(directory, 'vite');
        const runner = join(directory, 'runner-with-port.cjs');
        try {
            writeFileSync(vite, "process.stdout.write(JSON.stringify({ argv: process.argv.slice(2) }));");
            writeFileSync(runner, [
                "const { execFileSync } = require('child_process');",
                `const app = execFileSync(process.execPath, [${JSON.stringify(vite)}, '--port', '5182'], { encoding: 'utf8' });`,
                "process.stdout.write(app);",
            ].join('\n'));
            const command = wrapDevCommandForPort(`node ${JSON.stringify(runner)}`, 5182, 'node-vite');
            const result = JSON.parse(execFileSync('/bin/sh', ['-c', command], { encoding: 'utf8' })) as {
                argv: string[];
            };
            expect(result.argv).to.deep.equal(['--port', '5182', '--strictPort', '--host', '127.0.0.1']);
        } finally {
            rmSync(directory, { recursive: true, force: true });
        }
    });

    it('strips vite --open so in-IDE preview does not launch a browser or exit 1', function (): void {
        if (process.platform === 'win32') {
            this.skip();
        }
        const directory = mkdtempSync(join(tmpdir(), 'qaap-preview-port-'));
        const vite = join(directory, 'vite');
        const runner = join(directory, 'runner-open.cjs');
        try {
            writeFileSync(vite, "process.stdout.write(JSON.stringify({ argv: process.argv.slice(2) }));");
            writeFileSync(runner, [
                "const { execFileSync } = require('child_process');",
                `const app = execFileSync(process.execPath, [${JSON.stringify(vite)}, '--port', '3333', '--open'], { encoding: 'utf8' });`,
                "process.stdout.write(app);",
            ].join('\n'));
            const command = wrapDevCommandForPort(`node ${JSON.stringify(runner)}`, 3333, 'node-vite');
            const result = JSON.parse(execFileSync('/bin/sh', ['-c', command], { encoding: 'utf8' })) as {
                argv: string[];
            };
            expect(result.argv).to.deep.equal(['--port', '3333', '--strictPort', '--host', '127.0.0.1']);
            expect(result.argv).to.not.include('--open');
        } finally {
            rmSync(directory, { recursive: true, force: true });
        }
    });

    it('pickNextDevPort advances past conflicts, prior attempts, and the IDE listener', () => {
        expect(pickNextDevPort(5173, [], 3000)).to.equal(5174);
        expect(pickNextDevPort(5173, [5174, 5175], 3000)).to.equal(5176);
        expect(pickNextDevPort(2999, [], 3000)).to.equal(3001);
    });
});
