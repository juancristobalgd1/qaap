// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { QaapWorkHubRoutine } from '@theia/qaap-mobile-shell/lib/common/qaap-work-hub-routine';
import { QaapWorkHubRoutineRunner } from './qaap-work-hub-routine-runner';

const ROUTINE: QaapWorkHubRoutine = {
    id: 'routine-1',
    ownerLogin: 'alice',
    title: 'Nightly checks',
    prompt: 'Run the checks',
    cwd: '/repo',
    agent: 'qaiq',
    trigger: 'interval',
    intervalHours: 24,
    enabled: true,
    createdAt: 1,
    updatedAt: 1,
};

describe('QaapWorkHubRoutineRunner ownership', () => {
    it('propagates the routine owner to a fresh background task', () => {
        let ownerLogin: string | undefined;
        const runner = Object.create(QaapWorkHubRoutineRunner.prototype) as QaapWorkHubRoutineRunner;
        Object.assign(runner, {
            taskToRoutine: new Map(),
            store: {
                get: () => ROUTINE,
                markRunStarted: () => ROUTINE,
            },
            taskRunner: {
                defaultAgent: () => 'qaiq',
                create: (_request: unknown, owner: string | undefined) => {
                    ownerLogin = owner;
                    return { id: 'task-1' };
                },
            },
        });

        runner.runNow(ROUTINE.id);
        expect(ownerLogin).to.equal('alice');
    });

    it('propagates the routine owner when a new continuation conversation is needed', () => {
        let ownerLogin: string | undefined;
        const routine = { ...ROUTINE, runMode: 'continue' as const };
        const runner = Object.create(QaapWorkHubRoutineRunner.prototype) as QaapWorkHubRoutineRunner;
        Object.assign(runner, {
            taskToRoutine: new Map(),
            store: {
                get: () => routine,
                markRunStarted: () => routine,
            },
            taskRunner: { defaultAgent: () => 'qaiq' },
            conversationStore: {
                create: (_request: unknown, owner: string | undefined) => {
                    ownerLogin = owner;
                    return {
                        id: 'conversation-1',
                        messages: [{ role: 'user', taskId: 'task-1' }],
                    };
                },
            },
        });

        runner.runNow(routine.id);
        expect(ownerLogin).to.equal('alice');
    });
});
