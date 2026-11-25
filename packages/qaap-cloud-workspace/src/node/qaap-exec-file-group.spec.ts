// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import { execFileKillingGroup, QAAP_BACKGROUND_CHILD_NICENESS, withLowCpuPriority, withSelfEnforcedDeadline } from './qaap-exec-file-group';

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

describe('withLowCpuPriority', () => {
    const hasNice = process.platform !== 'win32' && ['/usr/bin/nice', '/bin/nice'].some(path => fs.existsSync(path));

    it('prefixes `nice -n 10` when the host has coreutils nice, else leaves the command alone', () => {
        const wrapped = withLowCpuPriority('codex', ['login', 'status']);
        if (hasNice) {
            expect(wrapped.file).to.match(/\/nice$/);
            expect(wrapped.args).to.deep.equal(['-n', String(QAAP_BACKGROUND_CHILD_NICENESS), 'codex', 'login', 'status']);
        } else {
            expect(wrapped).to.deep.equal({ file: 'codex', args: ['login', 'status'] });
        }
    });
});

(process.platform === 'win32' ? describe.skip : describe)('execFileKillingGroup with lowPriority', () => {
    const hasNice = ['/usr/bin/nice', '/bin/nice'].some(path => fs.existsSync(path));

    it('runs the command, and every process it starts, at a raised niceness', async function (): Promise<void> {
        if (!hasNice) {
            this.skip();
        }
        // `ps -o nice=` prints a shell's niceness; the inner `sh` shows that the processes it starts inherit it.
        const showNiceness = 'ps -o nice= -p $$; /bin/sh -c \'ps -o nice= -p $$\'';
        const result = await new Promise<{ stdout: string; error: unknown }>(resolve => {
            execFileKillingGroup('/bin/sh', ['-c', showNiceness], { timeoutMs: 5_000, lowPriority: true }, (error, stdout) => resolve({ stdout, error }));
        });
        expect(result.error).to.equal(null);
        const levels = result.stdout.trim().split(/\s+/).map(Number);
        const base = await new Promise<number>(resolve => {
            execFileKillingGroup('/bin/sh', ['-c', 'ps -o nice= -p $$'], { timeoutMs: 5_000 }, (_error, stdout) => resolve(Number(stdout.trim())));
        });
        expect(levels).to.deep.equal([
            Math.min(19, base + QAAP_BACKGROUND_CHILD_NICENESS),
            Math.min(19, base + QAAP_BACKGROUND_CHILD_NICENESS),
        ]);
    });

    it('reports a command nice cannot find as a spawn error, not as an exit status the command answered', async function (): Promise<void> {
        if (!hasNice) {
            this.skip();
        }
        const error = await new Promise<{ code?: number | string; killed?: boolean } | null>(resolve => {
            execFileKillingGroup('/nonexistent/qaap-missing-cli', ['status'], { timeoutMs: 5_000, lowPriority: true }, failure => resolve(failure));
        });
        expect(error?.code).to.equal('ENOENT');
        expect(error?.killed).to.equal(false);
    });

    it('still kills the whole tree at the deadline', async function (): Promise<void> {
        if (!hasNice) {
            this.skip();
        }
        const output = await new Promise<{ stdout: string; killed: boolean }>(resolve => {
            execFileKillingGroup('/bin/sh', ['-c', 'sleep 30 & echo $!; wait'], { timeoutMs: 300, lowPriority: true }, (error, stdout) => {
                resolve({ stdout, killed: !!error?.killed });
            });
        });
        const grandchild = Number(output.stdout.trim());
        expect(output.killed).to.equal(true);
        await new Promise(resolve => setTimeout(resolve, 100));
        expect(isAlive(grandchild)).to.equal(false);
    });
});
