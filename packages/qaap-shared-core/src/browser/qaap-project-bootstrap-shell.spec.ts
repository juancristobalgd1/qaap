// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { execFileSync } from 'child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import * as pty from 'node-pty';
import { OS } from '@theia/core/lib/common/os';
import URI from '@theia/core/lib/common/uri';
import { FileUri } from '@theia/core/lib/common/file-uri';
import { buildStaticServeCommand } from '../common/qaap-project-bootstrap-static';
import { buildQaapManagedShellInvocation, resolveWorkspaceHostFsPath } from './qaap-project-bootstrap-shell';

describe('qaap-project-bootstrap-shell', () => {

    it('quotes project cwd correctly for POSIX shells', function (): void {
        if (process.platform === 'win32') {
            this.skip();
        }
        const root = mkdtempSync(join(tmpdir(), 'qaap managed preview '));
        const project = join(root, "child's app");
        mkdirSync(project);
        try {
            const invocation = buildQaapManagedShellInvocation('pwd', project, process.platform);
            const output = execFileSync(invocation.shellPath, invocation.shellArgs, {
                cwd: '/',
                encoding: 'utf8',
            }).trim();

            expect(output).to.equal(project);
            expect(invocation.shellArgs[2]).to.include('cd --');
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('lets node-pty set the Windows cwd instead of embedding it in cmd /c', async function (): Promise<void> {
        if (process.platform !== 'win32') {
            this.skip();
        }
        const root = mkdtempSync(join(tmpdir(), 'qaap managed preview '));
        try {
            const invocation = buildQaapManagedShellInvocation('echo %CD%', root, 'win32');
            expect(invocation.shellPath).to.equal('cmd.exe');
            expect(invocation.shellArgs).to.deep.equal(['/d', '/s', '/c', 'echo %CD%']);

            const result = await new Promise<{ exitCode: number; output: string }>((resolve, reject) => {
                const terminal = pty.spawn(invocation.shellPath, invocation.shellArgs, {
                    name: 'xterm-256color',
                    cols: 80,
                    rows: 24,
                    cwd: root,
                    env: process.env,
                });
                let output = '';
                const timeout = setTimeout(() => {
                    terminal.kill();
                    reject(new Error('node-pty did not finish the Windows cwd probe'));
                }, 5000);
                terminal.onData(data => output += data);
                terminal.onExit(event => {
                    clearTimeout(timeout);
                    resolve({ exitCode: event.exitCode, output });
                });
            });

            expect(result.exitCode).to.equal(0);
            expect(result.output.toLowerCase()).to.include(root.toLowerCase());
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('uses bash on a Linux workspace host instead of the browser navigator platform', () => {
        const previousBackendWindows = OS.backend.isWindows;
        OS.backend.isWindows = false;
        try {
            const invocation = buildQaapManagedShellInvocation('pnpm run dev', '/home/ubuntu/app');
            expect(invocation.shellPath).to.equal('/bin/bash');
            expect(invocation.shellArgs[2]).to.include("cd -- '/home/ubuntu/app'");
        } finally {
            OS.backend.isWindows = previousBackendWindows;
        }
    });

    it('keeps POSIX workspace paths on a Linux/macOS host (FileUri.fsPath follows the browser OS)', () => {
        const previousBackendWindows = OS.backend.isWindows;
        OS.backend.isWindows = false;
        try {
            const uri = new URI('file:///home/ubuntu/.qaap/workspaces/users/_dev/antfu-collective/vitesse-lite');
            expect(resolveWorkspaceHostFsPath(uri)).to.equal(
                '/home/ubuntu/.qaap/workspaces/users/_dev/antfu-collective/vitesse-lite',
            );
            expect(resolveWorkspaceHostFsPath(uri)).to.not.include('\\');
            if (process.platform !== 'win32') {
                expect(FileUri.fsPath(uri)).to.equal(resolveWorkspaceHostFsPath(uri));
            }
        } finally {
            OS.backend.isWindows = previousBackendWindows;
        }
    });

    it('keeps Windows drive paths when the workspace host is Windows', () => {
        const previousBackendWindows = OS.backend.isWindows;
        OS.backend.isWindows = true;
        try {
            const uri = new URI('file:///c%3A/Users/me/.qaap/workspaces/users/alice/acme/site');
            const resolved = resolveWorkspaceHostFsPath(uri);
            expect(resolved.replace(/\//g, '\\').toLowerCase()).to.equal(
                'c:\\users\\me\\.qaap\\workspaces\\users\\alice\\acme\\site',
            );
        } finally {
            OS.backend.isWindows = previousBackendWindows;
        }
    });

    it('tokenizes the static node bootstrap for node-pty on Windows', () => {
        const command = buildStaticServeCommand('.');
        const invocation = buildQaapManagedShellInvocation(command, 'C:\\Users\\me\\static site', 'win32');

        expect(invocation.shellPath).to.equal('cmd.exe');
        expect(invocation.shellArgs.slice(0, 7)).to.deep.equal([
            '/d', '/s', '/c', 'cd', '/d', 'C:\\Users\\me\\static site', '&&',
        ]);
        expect(invocation.shellArgs).to.include('node');
        expect(invocation.shellArgs).to.include('-e');
        expect(invocation.shellArgs.at(-1)).to.not.match(/^"|"$/);
    });
});
