// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { Emitter } from '@theia/core/lib/common/event';
import {
    appendLastDevOutput,
    describeDevProcessExit,
    QAAP_PREVIEW_BUILD_REQUIRED_MESSAGE,
    diagnoseBootstrapFailure,
    diagnoseBuildFirstPreviewFailure,
    formatQaapPreviewBuildRequiredMessage,
    extractDevOutputProbePorts,
    extractTerminalFailureLine,
    restoreEscapedLineBreaks,
    terminalOutputMissingBinary,
    terminalOutputNeedsBuild,
    terminalOutputNeedsInstall,
    terminalOutputNextDevLock,
    terminalOutputOutOfMemory,
    terminalOutputPortInUse,
} from './qaap-project-bootstrap-dev-errors';
import type { TerminalWidget } from '@theia/terminal/lib/browser/base/terminal-widget';
import { extractPortFromInUseMessage, readTerminalTail, waitForDevExitOutput } from './qaap-project-bootstrap-helpers';

describe('qaap-project-bootstrap-dev-errors', () => {

    it('terminalOutputOutOfMemory detects V8 heap exhaustion and kernel OOM kills', () => {
        expect(terminalOutputOutOfMemory('FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory')).to.equal(true);
        expect(terminalOutputOutOfMemory('  \u001b[2m▲ Next.js 16.1.3\u001b[0m\nKilled\n')).to.equal(true);
        expect(terminalOutputOutOfMemory('Dev server exited with code 137.')).to.equal(true);
        expect(terminalOutputOutOfMemory('Dev server exited with code 1.')).to.equal(false);
        expect(terminalOutputOutOfMemory('Listening on port 1370 · compiled 137 modules')).to.equal(false);
    });

    it('describes a clean exit before listening with the port and the last output lines', () => {
        const output = Array.from({ length: 20 }, (_, index) => `\u001b[2mline ${index + 1}\u001b[0m`).join('\r\n') + '\r\n\r\n';
        const report = describeDevProcessExit(0, output, 3001);
        expect(report.exitedWithoutListening).to.equal(true);
        expect(report.message).to.match(/^The dev command exited with code 0 without listening on port 3001\.\nLast output:\nline 9\n/);
        expect(report.message).to.match(/\nline 20$/);
        expect(report.message).not.to.contain('line 8\n');
    });

    it('says so when a clean exit printed nothing', () => {
        const report = describeDevProcessExit(0, '\n\n', 3001);
        expect(report.message).to.equal('The dev command exited with code 0 without listening on port 3001. '
            + 'It printed no output. Check that the script starts a server and honors PORT or --port.');
    });

    it('keeps the output or exit code for a failing exit (still retryable)', () => {
        expect(describeDevProcessExit(1, 'Error: boom', 3001))
            .to.deep.equal({ message: 'Dev server exited with code 1.\nLast output:\nError: boom', exitedWithoutListening: false });
        expect(describeDevProcessExit(undefined, '', 3001)).to.deep.equal({ message: 'Dev server exited with code ?.', exitedWithoutListening: false });
    });

    it('quotes the pnpm workspace failure next to the exit code, so install recovery still recognises it', () => {
        // Real output of `pnpm --filter '@workspace/mockup-studio' dev` in a checkout without node_modules.
        const output = '\r\n> @workspace/mockup-studio@0.0.0 dev /ws/artifacts/mockup-studio\r\n'
            + '> vite --config vite.config.ts --port 5173 --strictPort\r\n\r\nsh: vite: command not found\r\n'
            + '/ws/artifacts/mockup-studio:\r\n \u001b[41m ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL \u001b[49m @workspace/mockup-studio@0.0.0 dev: '
            + '`vite --config vite.config.ts --port 5173 --strictPort`\r\nspawn ENOENT\r\n';
        const report = describeDevProcessExit(1, output, 5173);
        expect(report.message).to.match(/^Dev server exited with code 1\.\nLast output:\n/);
        expect(report.message).to.contain('sh: vite: command not found');
        expect(report.message).not.to.contain('\u001b[');
        expect(terminalOutputNeedsInstall(report.message)).to.equal(true);
        expect(diagnoseBootstrapFailure(report.message, 'fallback').kind).to.equal('dependencies');
    });

    it('keeps a Vite strict-port failure recognisable as a port conflict', () => {
        const output = 'error when starting dev server:\nError: Port 5173 is already in use\n    at Server.onError$1 (config.js:14933:28)\n'
            + ' ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL  @workspace/mockup-studio@0.0.0 dev: `vite --port 5173 --strictPort`\nExit status 1';
        const report = describeDevProcessExit(1, output, 5173);
        expect(terminalOutputPortInUse(report.message)).to.equal(true);
        expect(diagnoseBootstrapFailure(report.message, 'fallback').kind).to.equal('port-conflict');
    });

    describe('appendLastDevOutput', () => {
        it('appends the last non-empty output lines without ANSI escapes', () => {
            expect(appendLastDevOutput('Error: boom', '\u001b[31mline 1\u001b[0m\n\nline 2\n')).to.equal('Error: boom\nLast output:\nline 1\nline 2');
        });

        it('keeps only the last lines', () => {
            const output = Array.from({ length: 30 }, (_, index) => `line ${index + 1}`).join('\n');
            const message = appendLastDevOutput('Failed.', output, 3);
            expect(message).to.equal('Failed.\nLast output:\nline 28\nline 29\nline 30');
        });

        it('leaves the message alone when there is no output, it already quotes output, or it is the output', () => {
            expect(appendLastDevOutput('Failed.', '  \n ')).to.equal('Failed.');
            expect(appendLastDevOutput('Failed.\nLast output:\nx', 'x')).to.equal('Failed.\nLast output:\nx');
            expect(appendLastDevOutput('Error: boom', 'Error: boom')).to.equal('Error: boom');
        });
    });

    it('reports a process killed by a signal as stopped, not as a clean exit', () => {
        const output = 'Listening soon...\r\n';
        expect(describeDevProcessExit(0, output, 3001, 15)).to.deep.equal({
            message: 'The dev server was stopped (SIGTERM) before it listened on port 3001.',
            exitedWithoutListening: false,
        });
        expect(describeDevProcessExit(0, output, 3001, 'SIGTERM').message)
            .to.equal('The dev server was stopped (SIGTERM) before it listened on port 3001.');
        expect(describeDevProcessExit(0, output, 3001, '15').message)
            .to.equal('The dev server was stopped (SIGTERM) before it listened on port 3001.');
        expect(describeDevProcessExit(0, output, 3001, 9).message)
            .to.equal('The dev server was stopped (SIGKILL) before it listened on port 3001.');
        expect(describeDevProcessExit(0, output, 3001, 2).message)
            .to.equal('The dev server was stopped (SIGINT) before it listened on port 3001.');
        expect(describeDevProcessExit(0, output, 3001, 20).message)
            .to.equal('The dev server was stopped (signal 20) before it listened on port 3001.');
        expect(describeDevProcessExit(0, output, undefined, 15).message)
            .to.equal('The dev server was stopped (SIGTERM) before the preview server started listening.');
    });

    it('keeps the clean-exit message when no signal is reported', () => {
        expect(describeDevProcessExit(0, '', 3001, undefined).message)
            .to.contain('The dev command exited with code 0 without listening on port 3001.');
        expect(describeDevProcessExit(0, '', 3001, 0).message)
            .to.contain('The dev command exited with code 0 without listening on port 3001.');
    });

    it('diagnoses out-of-memory before any other failure kind', () => {
        const diagnosis = diagnoseBootstrapFailure('Error: something\n[qaap] The dev server was killed because the workspace ran out of memory.', 'fallback');
        expect(diagnosis.kind).to.equal('out-of-memory');
    });

    it('terminalOutputNeedsInstall detects missing modules', () => {
        expect(terminalOutputNeedsInstall('Cannot find package \'@foo/bar\'')).to.equal(true);
    });

    // Production report: Theia monorepo previewed from examples/browser before any root install.
    const THEIA_NOT_FOUND = [
        '> @theia/example-browser@1.73.0 start',
        '> theia start --log-level=warn --plugins=local-dir:../../plugins',
        'sh: 1: theia: not found',
        'npm error Lifecycle script `start` failed with error:',
        'npm error code 127',
        'npm error path /workspace/repos/users/jcristgd/juancristobalgd1/qaap/examples/browser',
    ].join('\n');

    it('names the missing script bin instead of dumping npm output', () => {
        expect(terminalOutputMissingBinary(THEIA_NOT_FOUND)).to.equal('theia');
        expect(terminalOutputMissingBinary('bash: line 1: vite: command not found')).to.equal('vite');
        expect(terminalOutputMissingBinary('sh: 1: npm: not found')).to.equal(undefined);
        expect(terminalOutputNeedsInstall(THEIA_NOT_FOUND)).to.equal(true);
        const diagnosis = diagnoseBootstrapFailure(THEIA_NOT_FOUND, 'fallback');
        expect(diagnosis.kind).to.equal('dependencies');
        expect(diagnosis.message).to.include('`theia`').and.include('workspace root');
        expect(diagnosis.message).not.to.include('npm error');
    });

    it('reads output whose line breaks arrived as literal \\n escapes', () => {
        const escaped = THEIA_NOT_FOUND.replace(/\n/g, '\\n');
        expect(restoreEscapedLineBreaks(escaped)).to.equal(THEIA_NOT_FOUND);
        expect(restoreEscapedLineBreaks('C:\\new\\app\nnext line')).to.equal('C:\\new\\app\nnext line');
        expect(diagnoseBootstrapFailure('npm error code 1\\nError: boom', 'fallback').message).to.equal('Error: boom');
    });

    it('never reads a source import or a path alias as a missing build', () => {
        expect(terminalOutputNeedsBuild("Error: Cannot find module '/app/src/lib/utils'")).to.equal(false);
        expect(terminalOutputNeedsBuild("error TS2307: Cannot find module '@/lib/utils' or its corresponding type declarations.")).to.equal(false);
        expect(terminalOutputNeedsBuild("Cannot find module 'lib/helpers'")).to.equal(false);
        expect(terminalOutputNeedsBuild("Error: Cannot find module '/repo/scripts/generated.js'")).to.equal(true);
        expect(terminalOutputNeedsBuild("Error: Cannot find module '../dist/server'")).to.equal(true);
        expect(diagnoseBootstrapFailure("Error: Cannot find module '/app/src/lib/utils'", 'fallback').kind).not.to.equal('build-required');
    });

    it('never sends a missing system tool to Install', () => {
        const output = 'sh: 1: python3: not found\nnpm error code 127';
        expect(terminalOutputNeedsInstall(output)).to.equal(false);
        const diagnosis = diagnoseBootstrapFailure(output, 'fallback');
        expect(diagnosis.kind).to.equal('runtime-version');
        expect(diagnosis.message).to.include('`python3`').and.not.include('Install there');
        expect(terminalOutputNeedsInstall('bash: line 1: docker: command not found')).to.equal(false);
        expect(terminalOutputNeedsInstall('sh: 1: python3.12: not found')).to.equal(false);
    });

    it('names Build and start and the opt-in only when the action exists; both copies are build-required', () => {
        expect(QAAP_PREVIEW_BUILD_REQUIRED_MESSAGE).not.to.include('Build and start');
        expect(QAAP_PREVIEW_BUILD_REQUIRED_MESSAGE).not.to.include('preview.json');
        const withAction = formatQaapPreviewBuildRequiredMessage(true);
        expect(withAction).to.include('Choose Build and start').and.include('"build": "auto"');
        expect(diagnoseBootstrapFailure(QAAP_PREVIEW_BUILD_REQUIRED_MESSAGE, 'fallback').kind).to.equal('build-required');
        expect(diagnoseBootstrapFailure(withAction, 'fallback').kind).to.equal('build-required');
    });

    it('never reads a stale Next.js cache as a project that was never built', () => {
        expect(terminalOutputNeedsBuild("Error: Cannot find module './vendor-chunks/next.js'")).to.equal(false);
        expect(terminalOutputNeedsBuild("Error: Cannot find module '/app/.next/server/webpack-runtime.js'")).to.equal(false);
    });

    it('words a failed Build and start as the user\'s action, not as the preview.json opt-in', () => {
        const failed = { kind: 'process-exit' as const, message: 'npm error code 2' };
        const userStarted = diagnoseBuildFirstPreviewFailure(failed, 'build', 'build-and-start');
        expect(userStarted.message).to.include('started by Build and start failed').and.not.include('preview.json');
        expect(diagnoseBuildFirstPreviewFailure(failed, 'build').message).to.include('opted in via .qaap/preview.json');
        const oom = diagnoseBuildFirstPreviewFailure({ kind: 'out-of-memory', message: 'oom' }, 'build', 'build-and-start');
        expect(oom.message).to.include('started by Build and start ran out of memory').and.not.include('preview.json');
    });

    it('asks for a build when the project\'s own compiled output is missing', () => {
        const output = "Error: Cannot find module '/workspace/repo/dev-packages/cli/lib/theia'\nRequire stack:";
        expect(terminalOutputNeedsBuild(output)).to.equal(true);
        expect(terminalOutputNeedsInstall(output)).to.equal(false);
        expect(diagnoseBootstrapFailure(output, 'fallback').kind).to.equal('build-required');
        expect(terminalOutputNeedsBuild("Cannot find module '/repo/node_modules/vite/dist/node/cli.js'")).to.equal(false);
    });

    it('terminalOutputPortInUse detects EADDRINUSE', () => {
        expect(terminalOutputPortInUse('Error: listen EADDRINUSE: address already in use :::3000')).to.equal(true);
    });

    it('terminalOutputPortInUse detects the Vite strict-port failure', () => {
        const viteTail = '\u001b[31merror when starting dev server:\nError: Port 5173 is already in use\n    at Server.onError (vite/dist/node/chunks/dep.js:25119:18)';
        expect(terminalOutputPortInUse(viteTail)).to.equal(true);
        expect(diagnoseBootstrapFailure(viteTail, 'Dev server exited with code 1.').kind).to.equal('port-conflict');
        expect(extractPortFromInUseMessage(viteTail)).to.equal(5173);
    });

    it('extractPortFromInUseMessage keeps preferring the bound address', () => {
        expect(extractPortFromInUseMessage('Error: listen EADDRINUSE: address already in use 127.0.0.1:3001')).to.equal(3001);
        expect(extractPortFromInUseMessage('Local: http://localhost:5173/')).to.equal(5173);
        expect(terminalOutputPortInUse('Port 5173 is free')).to.equal(false);
    });

    it('extractTerminalFailureLine surfaces generic Error lines', () => {
        const tail = 'some log\nError: listen ECONNREFUSED 127.0.0.1:5432\n';
        expect(extractTerminalFailureLine(tail, 'fallback')).to.match(/ECONNREFUSED/);
    });

    it('terminalOutputNextDevLock detects Next dev lock errors', () => {
        expect(terminalOutputNextDevLock('Unable to acquire lock at .next/dev/lock')).to.equal(true);
    });

    it('extractDevOutputProbePorts reads alternate port and Local URL', () => {
        const tail = 'using available port 3001 instead.\n- Local: http://localhost:3001\n';
        expect(extractDevOutputProbePorts(tail)).to.deep.equal([3001]);
    });

    it('extractDevOutputProbePorts reads host and port when the startup line omits the scheme', () => {
        expect(extractDevOutputProbePorts('Local: localhost:5173')).to.deep.equal([5173]);
    });

    it('extractTerminalFailureLine explains Next lock with preview hint', () => {
        const tail = 'using available port 3001 instead.\nUnable to acquire lock\n';
        expect(extractTerminalFailureLine(tail, 'fallback')).to.contain('Next.js is already running');
        expect(extractTerminalFailureLine(tail, 'fallback')).to.contain('3001');
    });

    it('diagnoses missing environment configuration with an actionable Env hint', () => {
        const diagnosis = diagnoseBootstrapFailure('Error: Environment variable DATABASE_URL is not set', 'fallback');
        expect(diagnosis.kind).to.equal('environment');
        expect(diagnosis.message).to.contain('Env');
    });

    it('diagnoses incompatible Node versions', () => {
        const diagnosis = diagnoseBootstrapFailure('npm error code EBADENGINE\nrequires Node >=20', 'fallback');
        expect(diagnosis.kind).to.equal('runtime-version');
        expect(diagnosis.message).to.contain('Node.js version');
    });

    it('diagnoses workspace permission failures', () => {
        const diagnosis = diagnoseBootstrapFailure('Error: EACCES: permission denied, open .next/cache', 'fallback');
        expect(diagnosis.kind).to.equal('permission');
        expect(diagnosis.message).to.contain('permissions');
    });

    describe('readTerminalTail', () => {
        const terminalWithRows = (rows: string[]): TerminalWidget => ({
            buffer: {
                length: rows.length,
                getLines: (start: number, length: number): string[] => rows.slice(start, start + length),
            },
        } as unknown as TerminalWidget);

        it('skips the blank viewport rows under the last output line', () => {
            const rows = ['$ npm run dev', 'Error: Port 5174 is already in use', ...new Array<string>(40).fill('')];
            expect(readTerminalTail(terminalWithRows(rows))).to.equal('$ npm run dev\nError: Port 5174 is already in use');
        });

        it('returns an empty tail for an all-blank buffer so callers use their fallback', () => {
            expect(readTerminalTail(terminalWithRows(new Array<string>(24).fill('   ')))).to.equal('');
        });

        it('keeps only the last maxLines output lines', () => {
            expect(readTerminalTail(terminalWithRows(['a', 'b', 'c', '', '']), 2)).to.equal('b\nc');
        });

        it('reads the raw output of a hidden terminal whose xterm buffer was never filled', () => {
            const hidden = Object.assign(terminalWithRows(new Array<string>(24).fill('')), {
                qaapUnrenderedOutput: '> vite\r\n\u001b[31msh: vite: command not found\u001b[39m\r\n\r\n',
            });
            expect(readTerminalTail(hidden)).to.equal('> vite\nsh: vite: command not found');
            expect(readTerminalTail(hidden, 1)).to.equal('sh: vite: command not found');
        });

        it('prefers the rendered buffer once the terminal shows output', () => {
            const opened = Object.assign(terminalWithRows(['rendered']), { qaapUnrenderedOutput: '' });
            expect(readTerminalTail(opened)).to.equal('rendered');
        });
    });

    describe('waitForDevExitOutput', () => {
        it('resolves immediately for a terminal that is already disposed', async () => {
            const closed = new Emitter<unknown>();
            await waitForDevExitOutput({ isDisposed: true, onTerminalDidClose: closed.event }, 60_000);
        });

        it('resolves when the terminal closes after its output drained', async () => {
            const closed = new Emitter<unknown>();
            let resolved = false;
            const waiting = waitForDevExitOutput({ isDisposed: false, onTerminalDidClose: closed.event }, 60_000)
                .then(() => { resolved = true; });
            await Promise.resolve();
            expect(resolved).to.equal(false);
            closed.fire(undefined);
            await waiting;
            expect(resolved).to.equal(true);
        });

        it('gives up after the timeout when the terminal stays open', async () => {
            const closed = new Emitter<unknown>();
            const started = Date.now();
            await waitForDevExitOutput({ isDisposed: false, onTerminalDidClose: closed.event }, 20);
            expect(Date.now() - started).to.be.lessThan(1000);
        });
    });
});
