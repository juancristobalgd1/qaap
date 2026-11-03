// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { QaapToolGateRequest } from '@theia/qaap-shared-core/lib/common/qaap-tool-gate-protocol';
import { QaapToolGateService, type QaapToolGateEvaluationEnv, type QaapToolGateHookOutcome } from './qaap-tool-gate-service';

/**
 * HTTP tool gate, read-only shell auto-approval. Under request-approval (autoApprove false) a shell command
 * runs without a card only when the classifier and the git-config and path checks all prove it read-only.
 * Every case below is a fail-closed check: anything not proven read-only must raise an ask.
 */
describe('qaap-tool-gate-service read-only shell auto-approval', () => {

    let workspace: string;
    let asks: number;
    const service = new QaapToolGateService();

    beforeEach(() => {
        workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-gate-ro-')));
        fs.writeFileSync(path.join(workspace, 'README.md'), '# notes\n');
        asks = 0;
    });

    afterEach(() => {
        fs.rmSync(workspace, { recursive: true, force: true });
    });

    const envFor = (overrides: Partial<QaapToolGateEvaluationEnv> = {}): QaapToolGateEvaluationEnv => ({
        taskId: 'task-ro',
        owner: undefined,
        workspace,
        autoApprove: false,
        readOnlyWorkspace: false,
        askTtlSec: 600,
        checkGitExecConfig: () => undefined,
        checkPathsInsideCwd: () => undefined,
        ask: async () => {
            asks++;
            return 'reject';
        },
        ...overrides,
    });

    const shell = (command: string): QaapToolGateRequest => ({
        agentId: 'pi',
        toolKind: 'shell',
        rawToolName: 'bash',
        input: { command },
        cwd: workspace,
        harnessCallId: `call-${asks}-${command.length}`,
    });

    const evaluate = (command: string, env: QaapToolGateEvaluationEnv = envFor()): ReturnType<QaapToolGateService['evaluate']> =>
        service.evaluate(shell(command), env);

    const readOnlyCommands = ['ls -la', 'git status', 'cat README.md'];
    for (const command of readOnlyCommands) {
        it(`allows the read-only command \`${command}\` without asking under request-approval`, async () => {
            const decision = await evaluate(command);
            expect(decision.kind).to.equal('allow');
            expect(decision.source).to.equal('policy');
            expect((decision as { reason?: string }).reason).to.equal('read-only-shell');
            expect(asks).to.equal(0);
        });
    }

    const askingCommands = [
        'ls > f',
        'cat ~/.ssh/id_rsa',
        'find . -exec rm {} \;',
        'git -c core.pager=sh log',
        'sh -c \'ls\'',
        'curl x',
        'ls; rm a',
        'ls && rm a',
        '$(rm a)',
        'echo $(rm a)',
    ];
    for (const command of askingCommands) {
        it(`does not auto-approve \`${command}\` under request-approval`, async () => {
            const decision = await evaluate(command);
            expect(asks, 'expected an ask').to.equal(1);
            expect(decision.kind).to.equal('deny');
        });
    }

    it('still asks for a read-only command when a PreToolUse hook asks', async () => {
        const hooks = async (): Promise<QaapToolGateHookOutcome> => ({ decision: 'ask' });
        await evaluate('ls', envFor({ hooks }));
        expect(asks).to.equal(1);
    });

    it('classifies the command a hook rewrites to, not the original read-only one', async () => {
        const hooks = async (): Promise<QaapToolGateHookOutcome> => ({ updatedInput: { command: 'rm -rf x' } });
        const decision = await evaluate('ls', envFor({ hooks }));
        // Not auto-approved on the rewritten input: it goes to a card (rejected here), so never an allow.
        expect(asks, 'rewritten command must be asked, not allowed').to.equal(1);
        expect(decision.kind).to.equal('deny');
    });

    it('asks when a hook rewrites a read-only command into one that must be approved', async () => {
        const hooks = async (): Promise<QaapToolGateHookOutcome> => ({ updatedInput: { command: 'cat README.md > out.txt' } });
        await evaluate('ls', envFor({ hooks }));
        expect(asks).to.equal(1);
    });

    it('lets a PreToolUse hook deny a read-only command', async () => {
        const hooks = async (): Promise<QaapToolGateHookOutcome> => ({ decision: 'deny', reason: 'nope' });
        const decision = await evaluate('ls', envFor({ hooks }));
        expect(decision.kind).to.equal('deny');
        expect(asks).to.equal(0);
    });

    it('asks for a read-only command when the git-config or path checks cannot verify it', async () => {
        await evaluate('git status', envFor({ checkGitExecConfig: () => 'core.fsmonitor is set' }));
        await evaluate('cat README.md', envFor({ checkPathsInsideCwd: () => 'path escapes cwd' }));
        expect(asks).to.equal(2);
    });

    it('asks for a read-only command when no runtime checks are wired (not verified means not read-only)', async () => {
        await evaluate('cat README.md', envFor({ checkPathsInsideCwd: undefined }));
        await evaluate('git status', envFor({ checkGitExecConfig: undefined }));
        expect(asks).to.equal(2);
    });

    it('keeps the read-only workspace deny ahead of the read-only shell allowance', async () => {
        const decision = await evaluate('ls -la', envFor({ readOnlyWorkspace: true, autoApprove: true }));
        expect(decision.kind).to.equal('allow');
        const writing = await evaluate('ls > f', envFor({ readOnlyWorkspace: true }));
        expect(writing.kind).to.equal('deny');
        expect(asks).to.equal(0);
    });
});
