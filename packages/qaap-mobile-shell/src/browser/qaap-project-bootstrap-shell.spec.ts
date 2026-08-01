// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { execFileSync } from 'child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { buildQaapManagedShellInvocation } from './qaap-project-bootstrap-shell';

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
});
