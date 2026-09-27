// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { ChildProcess, spawn } from 'child_process';
import * as os from 'os';
import { interpretQaapAgentHookResult } from '../common/qaap-agent-hooks';
import { QaapAgentHookProcessRunner } from './qaap-agent-hook-process-runner';

/** Stub spawn: a plain local shell instead of the tenant spawn service. */
class LocalShellHookRunner extends QaapAgentHookProcessRunner {
    lastEnv: NodeJS.ProcessEnv | undefined;
    failSpawn = false;
    protected override async spawnHook(command: string, cwd: string, env: NodeJS.ProcessEnv): Promise<ChildProcess> {
        if (this.failSpawn) {
            throw new Error('tenant container not ready');
        }
        this.lastEnv = env;
        return spawn(command, { cwd, env, shell: true, stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
    }
}

const node = `"${process.execPath}"`;
/** Builds a portable `node -e` hook command (script must not contain double quotes). */
const script = (body: string): string => `${node} -e "${body}"`;

describe('QaapAgentHookProcessRunner', function (): void {
    this.timeout(20_000);

    const runner = new LocalShellHookRunner();
    const cwd = os.tmpdir();

    it('passes the JSON input on stdin and captures stdout', async () => {
        const result = await runner.run(
            script("let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const i=JSON.parse(s);process.stdout.write(i.hook_event_name+':'+i.prompt)})"),
            { cwd, input: { hook_event_name: 'UserPromptSubmit', prompt: 'hello' }, timeoutMs: 10_000 },
        );
        expect(result).to.include({ exitCode: 0, stdout: 'UserPromptSubmit:hello', timedOut: false });
        expect(interpretQaapAgentHookResult('UserPromptSubmit', result)).to.deep.equal({ outcome: 'success', additionalContext: 'UserPromptSubmit:hello' });
    });

    it('exit 2 blocks with stderr as the reason', async () => {
        const result = await runner.run(script("process.stderr.write('denied by policy');process.exit(2)"), { cwd, input: {}, timeoutMs: 10_000 });
        expect(result.exitCode).to.equal(2);
        expect(interpretQaapAgentHookResult('PreToolUse', result)).to.deep.equal({ outcome: 'block', reason: 'denied by policy', permissionDecision: 'deny' });
    });

    it('JSON decision on exit 0', async () => {
        const result = await runner.run(script("console.log(JSON.stringify({decision:'ask',reason:'double-check'}))"), { cwd, input: {}, timeoutMs: 10_000 });
        expect(interpretQaapAgentHookResult('PreToolUse', result)).to.deep.equal({ outcome: 'success', permissionDecision: 'ask', reason: 'double-check' });
    });

    it('other non-zero exits are non-blocking errors', async () => {
        const result = await runner.run(script('process.exit(1)'), { cwd, input: {}, timeoutMs: 10_000 });
        expect(interpretQaapAgentHookResult('UserPromptSubmit', result).outcome).to.equal('error');
    });

    it('enforces the timeout and kills the hook', async () => {
        const started = Date.now();
        const result = await runner.run(script('setTimeout(()=>{},60000)'), { cwd, input: {}, timeoutMs: 500 });
        expect(result.timedOut).to.equal(true);
        expect(Date.now() - started).to.be.lessThan(10_000);
        expect(interpretQaapAgentHookResult('PreToolUse', result).outcome).to.equal('error');
    });

    it('reports spawn failures instead of throwing', async () => {
        runner.failSpawn = true;
        try {
            const result = await runner.run('anything', { cwd, input: {}, timeoutMs: 1_000 });
            expect(result.error).to.contain('tenant container not ready');
            expect(interpretQaapAgentHookResult('Stop', result).outcome).to.equal('error');
        } finally {
            runner.failSpawn = false;
        }
    });

    it('does not forward backend secrets and adds the extra env', async () => {
        const saved = process.env.QAAP_TEST_API_KEY;
        process.env.QAAP_TEST_API_KEY = 'secret';
        try {
            await runner.run(script('0'), { cwd, input: {}, timeoutMs: 10_000, env: { CLAUDE_PROJECT_DIR: '/repo' } });
            expect(runner.lastEnv?.QAAP_TEST_API_KEY).to.equal(undefined);
            expect(runner.lastEnv?.CLAUDE_PROJECT_DIR).to.equal('/repo');
        } finally {
            if (saved === undefined) {
                delete process.env.QAAP_TEST_API_KEY;
            } else {
                process.env.QAAP_TEST_API_KEY = saved;
            }
        }
    });
});
