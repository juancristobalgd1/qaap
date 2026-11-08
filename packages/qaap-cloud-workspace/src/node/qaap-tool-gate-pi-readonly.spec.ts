// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { QaapToolGateRequest } from '@theia/qaap-shared-core/lib/common/qaap-tool-gate-protocol';
import { QaapToolGateService, type QaapToolGateEvaluationEnv } from './qaap-tool-gate-service';

/** Pi's own tool names, as its `tool_call` event reports them, mapped the way the endpoint maps them. */
const PI_CALLS: ReadonlyArray<{ readonly rawToolName: string; readonly toolKind: QaapToolGateRequest['toolKind']; readonly input: Record<string, unknown>; readonly allowed: boolean }> = [
    { rawToolName: 'read', toolKind: 'read', input: { path: 'src/a.ts' }, allowed: true },
    { rawToolName: 'grep', toolKind: 'read', input: { pattern: 'x' }, allowed: true },
    { rawToolName: 'write', toolKind: 'write', input: { path: 'src/a.ts', content: 'x' }, allowed: false },
    { rawToolName: 'edit', toolKind: 'edit', input: { path: 'src/a.ts' }, allowed: false },
    { rawToolName: 'bash', toolKind: 'shell', input: { command: 'rm -rf build' }, allowed: false },
];

describe('qaap-tool-gate Pi read-only enforcement', () => {
    const service = new QaapToolGateService();
    const env = (readOnlyWorkspace: boolean): QaapToolGateEvaluationEnv => ({
        taskId: 'task-pi',
        owner: 'octocat',
        workspace: '/tmp/qaap-pi-readonly',
        autoApprove: true,
        readOnlyWorkspace,
        strictReadOnly: false,
        askTtlSec: 0,
        ask: () => Promise.resolve('cancelled'),
        checkGitExecConfig: () => undefined,
        checkPathsInsideCwd: () => undefined,
    });

    it('denies write, edit and mutating shell calls for a read-only Pi task, and allows reads', async () => {
        for (const call of PI_CALLS) {
            const decision = await service.evaluate({
                taskId: 'task-pi',
                agentId: 'pi',
                toolKind: call.toolKind,
                rawToolName: call.rawToolName,
                input: call.input,
                cwd: '/tmp/qaap-pi-readonly',
            }, env(true));
            expect(decision.kind === 'allow', `${call.rawToolName} allowed=${decision.kind}`).to.equal(call.allowed);
            if (!call.allowed) {
                expect(decision.source).to.equal('read-only');
            }
        }
    });

    it('does not restrict a Build (not read-only) Pi task', async () => {
        const decision = await service.evaluate({
            taskId: 'task-pi',
            agentId: 'pi',
            toolKind: 'write',
            rawToolName: 'write',
            input: { path: 'src/a.ts', content: 'x' },
            cwd: '/tmp/qaap-pi-readonly',
        }, env(false));
        expect(decision.kind).to.equal('allow');
    });
});
