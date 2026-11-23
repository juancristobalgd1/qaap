// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import { execFileKillingGroup, withSelfEnforcedDeadline } from './qaap-exec-file-group';

function isAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

(process.platform === 'win32' ? describe.skip : describe)('execFileKillingGroup', () => {

    it('kills the CLI behind a wrapper at the deadline, not only the wrapper', async () => {
        // `sh` is the wrapper (like an npm shim); `sleep` is the CLI it started and waits on.
        const output = await new Promise<{ stdout: string; killed: boolean }>(resolve => {
            execFileKillingGroup('/bin/sh', ['-c', 'sleep 30 & echo $!; wait'], { timeoutMs: 300 }, (error, stdout) => {
                resolve({ stdout, killed: !!error?.signal });
            });
        });
        const grandchild = Number(output.stdout.trim());
        expect(output.killed).to.equal(true);
        expect(grandchild).to.be.greaterThan(0);
        // The group kill is asynchronous for the kernel; give it a moment.
        await new Promise(resolve => setTimeout(resolve, 100));
        expect(isAlive(grandchild)).to.equal(false);
    });

    it('returns the output of a command that finishes in time', async () => {
        const result = await new Promise<{ stdout: string; error: unknown }>(resolve => {
            execFileKillingGroup('/bin/sh', ['-c', 'echo ready'], { timeoutMs: 5_000 }, (error, stdout) => resolve({ stdout, error }));
        });
        expect(result.error).to.equal(null);
        expect(result.stdout.trim()).to.equal('ready');
    });
});

describe('withSelfEnforcedDeadline', () => {
    const hasTimeout = process.platform !== 'win32' && ['/usr/bin/timeout', '/bin/timeout'].some(path => fs.existsSync(path));

    it('prefixes `timeout -k 2 <seconds>` when the host has coreutils timeout, else leaves the command alone', () => {
        const wrapped = withSelfEnforcedDeadline('opencode', ['auth', 'list'], 10_000);
        if (hasTimeout) {
            expect(wrapped.args).to.deep.equal(['-k', '2', '10', 'opencode', 'auth', 'list']);
            expect(wrapped.file).to.match(/\/timeout$/);
        } else {
            expect(wrapped).to.deep.equal({ file: 'opencode', args: ['auth', 'list'] });
        }
        expect(withSelfEnforcedDeadline('x', [], 200).args.slice(0, 3)).to.deep.equal(hasTimeout ? ['-k', '2', '1'] : []);
    });
});
