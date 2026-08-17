// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { execFileSync } from 'child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { OS } from '@theia/core/lib/common/os';
import URI from '@theia/core/lib/common/uri';
import { FileUri } from '@theia/core/lib/common/file-uri';
import { buildQaapManagedShellInvocation, resolveWorkspaceHostFsPath } from './qaap-project-bootstrap-shell';

describe('qaap-project-bootstrap-shell', () => {

    it('enforces the requested project cwd inside the command, including quoted paths', function (): void {
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

    it('keeps POSIX workspace paths on a Linux host (FileUri.fsPath follows the browser OS)', () => {
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
});
