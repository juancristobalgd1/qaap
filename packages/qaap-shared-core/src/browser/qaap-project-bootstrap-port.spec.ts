// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { execFileSync } from 'child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import URI from '@theia/core/lib/common/uri';
import {
    classifyDevPreviewHealthProbe,
    getImplicitDevPort,
    DEV_PREVIEW_HEALTH_BASE_INTERVAL_MS,
    devPreviewHealthDelayMs,
    isolateTheiaPreviewCommand,
    isReservedIdePort,
    pickAlternateDevPort,
    pickNextDevPort,
    previewHomeDirFor,
    prefixTheiaPreviewHomeEnv,
    qaapPreviewHostEnvScrubPrefix,
    resolveBootstrapDevPort,
    wrapCommandForDevNodeEnv,
    wrapDevCommandForPort,
} from './qaap-project-bootstrap-port';

const UNSET_QAAP = "unset $(env | sed -n 's/^\\(QAAP_[A-Za-z0-9_]*\\)=.*/\\1/p') &&";

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
        const command = wrapDevCommandForPort('npm run dev', 3001, 'node-cra', false);
        expect(command).to.include('QAAP_PREVIEW_PORT=3001 PORT=3001');
        expect(command).to.include('--import=data:text/javascript;base64,');
        expect(command).to.match(/npm run dev$/);
    });

    it('wrapDevCommandForPort forces NODE_ENV=development so production hosts do not poison vite dev', () => {
        const command = wrapDevCommandForPort('npm run dev', 3001, 'node-cra', false);
        expect(command).to.include('NODE_ENV=development ');
    });

    it('wrapDevCommandForPort sets PORT and --port for Vite (overrides Docker IDE PORT)', () => {
        const command = wrapDevCommandForPort('npm run dev', 5174, 'node-vite', false);
        expect(command).to.include('QAAP_PREVIEW_PORT=5174 PORT=5174');
        expect(command).to.match(/npm run dev -- --port 5174 --strictPort$/);
        expect(command).to.include('--strictPort');
    });

    it('wrapDevCommandForPort uses cmd.exe SET prefixes on a Windows workspace host', () => {
        const command = wrapDevCommandForPort('npm run dev', 3001, 'node-cra', true);
        expect(command).to.include('set QAAP_PREVIEW_PORT=3001');
        expect(command).to.include('set PORT=3001');
        expect(command).not.to.include('set "PORT=3001"');
        expect(command).to.include('set "NODE_ENV=development"');
        expect(command).to.not.include('QAAP_PREVIEW_PORT=3001 PORT=3001');
        expect(command).to.match(/npm run dev$/);
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

    it('wrapDevCommandForPort skips the second `--` for npm exec+Next', () => {
        const command = wrapDevCommandForPort('npm exec -- next dev --webpack', 3001, 'node-next');
        expect(command).to.match(/npm exec -- next dev --webpack -p 3001$/);
        expect(command).not.to.include(' -- -p');
    });

    it('forces the allocated port when an npm script overwrites PORT inline', function (): void {
        if (process.platform === 'win32') {
            this.skip();
        }
        const command = wrapDevCommandForPort(
            'PORT=8080 node -e \'process.stdout.write(process.env.PORT)\'',
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
            writeFileSync(vite, 'process.stdout.write(JSON.stringify({ port: process.env.PORT, argv: process.argv.slice(2) }));');
            writeFileSync(sibling, "process.stdout.write(process.env.PORT || '');");
            writeFileSync(runner, [
                "const { execFileSync } = require('child_process');",
                `const app = execFileSync(process.execPath, [${JSON.stringify(vite)}], { encoding: 'utf8' });`,
                `const sibling = execFileSync(process.execPath, [${JSON.stringify(sibling)}], {`,
                "    encoding: 'utf8', env: { ...process.env, PORT: '8787' },",
                '});',
                'process.stdout.write(JSON.stringify({ app: JSON.parse(app), sibling }));',
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
            writeFileSync(vite, 'process.stdout.write(JSON.stringify({ argv: process.argv.slice(2) }));');
            writeFileSync(runner, [
                "const { execFileSync } = require('child_process');",
                `const app = execFileSync(process.execPath, [${JSON.stringify(vite)}, '--port', '5182'], { encoding: 'utf8' });`,
                'process.stdout.write(app);',
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

    it('replaces a port the app hardcodes with the allocated one (vite, next, vinxi)', function (): void {
        if (process.platform === 'win32') {
            this.skip();
        }
        // Twelve sequential `sh` + node spawns: about 2 s on a loaded macOS runner, above mocha's 2 s default.
        this.timeout(15000);
        const directory = mkdtempSync(join(tmpdir(), 'qaap-preview-port-'));
        // Each fake CLI prints the argv it received after the preload ran; `kind` only picks how
        // wrapDevCommandForPort prefixes the command, the preload itself keys on the binary name.
        let runs = 0;
        const argvOf = (binary: string, args: string[], kind: 'node-vite' | 'node-next'): string[] => {
            const cli = join(directory, binary);
            // Neutral runner names: the bootstrap rewriter injects flags after a `vite` token in the command.
            const runner = join(directory, `runner-${++runs}.cjs`);
            writeFileSync(cli, 'process.stdout.write(JSON.stringify(process.argv.slice(2)));');
            writeFileSync(runner, [
                "const { execFileSync } = require('child_process');",
                `process.stdout.write(execFileSync(process.execPath, [${JSON.stringify(cli)}, ...${JSON.stringify(args)}], { encoding: 'utf8' }));`,
            ].join('\n'));
            const command = wrapDevCommandForPort(`node ${JSON.stringify(runner)}`, 5182, kind);
            return JSON.parse(execFileSync('/bin/sh', ['-c', command], { encoding: 'utf8' })) as string[];
        };
        try {
            expect(argvOf('vite', ['--port', '5173', '--strictPort'], 'node-vite'))
                .to.deep.equal(['--port', '5182', '--strictPort', '--host', '127.0.0.1']);
            expect(argvOf('vite', ['dev', '--port=8080'], 'node-vite'))
                .to.deep.equal(['dev', '--port=5182', '--strictPort', '--host', '127.0.0.1']);
            expect(argvOf('next', ['dev', '-p', '3000'], 'node-next')).to.deep.equal(['dev', '-p', '5182']);
            expect(argvOf('next', ['dev', '--port=3000'], 'node-next')).to.deep.equal(['dev', '--port=5182']);
            expect(argvOf('next', ['dev'], 'node-next')).to.deep.equal(['dev', '-p', '5182']);
            expect(argvOf('vinxi', ['dev'], 'node-vite')).to.deep.equal(['dev', '--port', '5182']);
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
            writeFileSync(vite, 'process.stdout.write(JSON.stringify({ argv: process.argv.slice(2) }));');
            writeFileSync(runner, [
                "const { execFileSync } = require('child_process');",
                `const app = execFileSync(process.execPath, [${JSON.stringify(vite)}, '--port', '3333', '--open'], { encoding: 'utf8' });`,
                'process.stdout.write(app);',
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

    it('passes the allocated port to a nested `theia start` that hardcodes or omits --port', function (): void {
        if (process.platform === 'win32') {
            this.skip();
        }
        const directory = mkdtempSync(join(tmpdir(), 'qaap-preview-port-'));
        const theia = join(directory, 'theia');
        const runner = join(directory, 'start-browser.cjs');
        try {
            writeFileSync(theia, 'process.stdout.write(JSON.stringify({ port: process.env.PORT, argv: process.argv.slice(2) }));');
            // Mirrors qaap's own start:browser: a wrapper script spawns `theia start --port 3000`.
            writeFileSync(runner, [
                "const { execFileSync } = require('child_process');",
                `const run = args => JSON.parse(execFileSync(process.execPath, [${JSON.stringify(theia)}, ...args], { encoding: 'utf8' }));`,
                'process.stdout.write(JSON.stringify([',
                "    run(['start', '--hostname=::', '--port', '3000']),",
                "    run(['start', '--port=3000', '--log-level=warn']),",
                "    run(['start', '--log-level=warn']),",
                "    run(['rebuild:browser']),",
                ']));',
            ].join('\n'));
            const command = wrapDevCommandForPort(`node ${JSON.stringify(runner)}`, 3001, 'node-generic', false);
            const [hardcoded, inline, omitted, otherCommand] = JSON.parse(
                execFileSync('/bin/sh', ['-c', command], { encoding: 'utf8' }),
            ) as { port: string; argv: string[] }[];
            expect(hardcoded.argv).to.deep.equal(['start', '--hostname=::', '--port', '3001']);
            expect(inline.argv).to.deep.equal(['start', '--port=3001', '--log-level=warn']);
            expect(omitted.argv).to.deep.equal(['start', '--log-level=warn', '--port', '3001']);
            expect(otherCommand.argv).to.deep.equal(['rebuild:browser']);
            expect(hardcoded.port).to.equal('3001');
        } finally {
            rmSync(directory, { recursive: true, force: true });
        }
    });

    it('pickNextDevPort advances past conflicts, prior attempts, and the IDE listener', () => {
        expect(pickNextDevPort(5173, [], 3000)).to.equal(5174);
        expect(pickNextDevPort(5173, [5174, 5175], 3000)).to.equal(5176);
        expect(pickNextDevPort(2999, [], 3000)).to.equal(3001);
    });

    it('wrapDevCommandForPort uses POSIX env prefixes on a Linux host instead of cmd.exe SET', () => {
        const command = wrapDevCommandForPort('pnpm run dev', 3333, 'node-vite', false);
        expect(command).to.match(/QAAP_PREVIEW_PORT=3333 PORT=3333 NODE_ENV=development /);
        expect(command.startsWith(qaapPreviewHostEnvScrubPrefix())).to.equal(true);
        expect(command).to.not.include('set "PORT=');
        expect(wrapCommandForDevNodeEnv('pnpm install', false)).to.equal('NODE_ENV=development pnpm install');
        expect(wrapCommandForDevNodeEnv('pnpm install', true)).to.equal('set "NODE_ENV=development"&& pnpm install');
    });

    it('gives a Theia preview its own HOME and THEIA_CONFIG_DIR under the project', () => {
        const command = prefixTheiaPreviewHomeEnv('npm run dev', previewHomeDirFor('/work/vyyq'), false);
        expect(command).to.equal(
            `${UNSET_QAAP} export HOME='/work/vyyq/node_modules/.cache/qaap-preview-home' THEIA_CONFIG_DIR='/work/vyyq/node_modules/.cache/qaap-preview-home/.theia' QAAP_NESTED_PREVIEW=1 && npm run dev`
        );
    });

    it('quotes a single quote in the preview home path for POSIX shells', () => {
        expect(prefixTheiaPreviewHomeEnv('npm run dev', "/a/it's/preview-home", false))
            .to.equal(`${UNSET_QAAP} export HOME='/a/it'\\''s/preview-home' THEIA_CONFIG_DIR='/a/it'\\''s/preview-home/.theia' QAAP_NESTED_PREVIEW=1 && npm run dev`);
    });

    it('sets USERPROFILE and HOME on Windows hosts', () => {
        const command = prefixTheiaPreviewHomeEnv('npm run dev', previewHomeDirFor('C:/work/vyyq'), true);
        expect(command).to.equal(
            'set USERPROFILE=C:/work/vyyq/node_modules/.cache/qaap-preview-home&& set HOME=C:/work/vyyq/node_modules/.cache/qaap-preview-home&& set THEIA_CONFIG_DIR=C:/work/vyyq/node_modules/.cache/qaap-preview-home/.theia&& set QAAP_NESTED_PREVIEW=1&& npm run dev'
        );
    });

    it('gives two projects distinct preview homes and ignores a trailing slash', () => {
        expect(previewHomeDirFor('/work/vyyq')).to.not.equal(previewHomeDirFor('/work/qaap'));
        expect(previewHomeDirFor('/work/vyyq/')).to.equal(previewHomeDirFor('/work/vyyq'));
    });

    (process.platform === 'win32' ? it.skip : it)('applies the isolated HOME to every command of a chain', () => {
        const cwd = new URI('file:///tmp/qaap-chain-home-spec');
        const command = isolateTheiaPreviewCommand('true && printf %s "$HOME"', { isTheiaApp: true, cwd });
        expect(execFileSync('/bin/sh', ['-c', command], { encoding: 'utf8' })).to.equal(previewHomeDirFor('/tmp/qaap-chain-home-spec'));
    });

    (process.platform === 'win32' ? it.skip : it)('drops inherited QAAP_* variables but keeps the ones the command sets', () => {
        const cwd = new URI('file:///tmp/qaap-nested-env-spec');
        const command = isolateTheiaPreviewCommand(
            'QAAP_PREVIEW_PORT=3001 sh -c \'printf "%s|%s|%s|%s" "${QAAP_SQLITE_STORE_PATH-unset}" "${QAAP_CLOUD_MODE-unset}" "$QAAP_NESTED_PREVIEW" "$QAAP_PREVIEW_PORT"\'',
            { isTheiaApp: true, cwd },
        );
        const output = execFileSync('/bin/sh', ['-c', command], {
            encoding: 'utf8',
            env: { ...process.env, QAAP_SQLITE_STORE_PATH: '/host/.qaap/store.sqlite', QAAP_CLOUD_MODE: '1', KEEP_ME: 'yes' },
        });
        expect(output).to.equal('unset|unset|1|3001');
    });

    it('fails a health probe only when the server is gone, not while it is busy', () => {
        expect(classifyDevPreviewHealthProbe({ ready: true }, true)).to.equal('healthy');
        expect(classifyDevPreviewHealthProbe({ ready: true }, false)).to.equal('down');
        expect(classifyDevPreviewHealthProbe({ ready: false, listening: true }, true)).to.equal('slow');
        expect(classifyDevPreviewHealthProbe({ ready: false, probeFailed: true }, true)).to.equal('slow');
        expect(classifyDevPreviewHealthProbe({ ready: false }, true)).to.equal('down');
    });

    it('spaces health probes 2.5 s, 5 s, 10 s, then 15 s while the server stays healthy', () => {
        expect([0, 1, 2, 3, 4, 9].map(devPreviewHealthDelayMs)).to.deep.equal([2500, 5000, 10000, 15000, 15000, 15000]);
    });

    it('returns the probe spacing to 2.5 s when the healthy streak resets', () => {
        expect(devPreviewHealthDelayMs(0)).to.equal(DEV_PREVIEW_HEALTH_BASE_INTERVAL_MS);
    });

    it('isolates only Theia previews: other apps keep the host HOME', () => {
        const cwd = new URI('file:///work/vyyq');
        const theia = isolateTheiaPreviewCommand('npm run dev', { isTheiaApp: true, cwd });
        if (process.platform === 'win32') {
            // cmd.exe: `set` lines persist across `&&`; the Windows fsPath of file:///work/vyyq is `\work\vyyq`.
            const winHome = '\\work\\vyyq/node_modules/.cache/qaap-preview-home';
            expect(theia).to.equal(`set USERPROFILE=${winHome}&& set HOME=${winHome}&& set THEIA_CONFIG_DIR=${winHome}/.theia&& set QAAP_NESTED_PREVIEW=1&& npm run dev`);
        } else {
            expect(theia).to.equal(`${UNSET_QAAP} export HOME='/work/vyyq/node_modules/.cache/qaap-preview-home' THEIA_CONFIG_DIR='/work/vyyq/node_modules/.cache/qaap-preview-home/.theia' QAAP_NESTED_PREVIEW=1 && npm run dev`);
        }
        expect(isolateTheiaPreviewCommand('npm run dev', { isTheiaApp: false, cwd })).to.equal('npm run dev');
        expect(isolateTheiaPreviewCommand('npm run dev', { cwd })).to.equal('npm run dev');
    });
});

(process.platform === 'win32' ? describe.skip : describe)('qaapPreviewHostEnvScrubPrefix in a real POSIX shell', () => {
    const shells = ['/bin/sh', '/bin/bash', '/bin/zsh', '/bin/dash'].filter(shell => existsSync(shell));
    const hostEnv: NodeJS.ProcessEnv = {
        ...process.env,
        QAAP_FOO: '1',
        QAAP_PREVIEW_BASE_DOMAIN: 'qaap.example.com',
        QAAP_SQLITE_STORE_PATH: '/host/.qaap/store.sqlite',
        QAAP_TASK_TOKEN: 'secret',
        KEEP_ME: 'yes',
    };

    for (const shell of shells) {
        it(`leaves only QAAP_PREVIEW_PORT for the dev command under ${shell}`, () => {
            const command = wrapDevCommandForPort('env', 3001, 'node-cra', false);
            const output = execFileSync(shell, ['-c', command], { encoding: 'utf8', env: hostEnv });
            const qaapLines = output.split('\n').filter(line => /^QAAP_/i.test(line));
            expect(qaapLines).to.deep.equal(['QAAP_PREVIEW_PORT=3001']);
            expect(output).to.contain('KEEP_ME=yes');
            expect(output).to.contain('PORT=3001');
        });
    }

    it('scrubs inherited variables before a non-Node command too', () => {
        const shell = shells[0];
        // A prefix assignment is not visible to expansions in the same simple command, so read the port through `sh -c`.
        const command = wrapDevCommandForPort('sh -c \'printf "%s|%s" "${QAAP_FOO-unset}" "$QAAP_PREVIEW_PORT"\'', 5174, 'python-generic', false);
        expect(execFileSync(shell, ['-c', command], { encoding: 'utf8', env: hostEnv })).to.equal('unset|5174');
    });
});
