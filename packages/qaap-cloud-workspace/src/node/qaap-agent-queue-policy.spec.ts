// Copyright (C) 2026 Qaap contributors.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0

import { expect } from 'chai';
import type { QaapAgentTask } from '../common/qaap-agent-task';
import { QaapAgentQueueFullError, QaapAgentQueuePolicy } from './qaap-agent-queue-policy';

describe('QaapAgentQueuePolicy', () => {
    const policy = new QaapAgentQueuePolicy();
    const task = (ownerLogin?: string, state: QaapAgentTask['state'] = 'queued'): QaapAgentTask => ({
        id: 'task', title: 'task', command: 'work', cwd: '/repo', createdAt: 1, ownerLogin, state
    });

    it('enforces a global queue cap across owners', () => {
        expect(() => policy.assertCapacity([task('alice'), task('bob')], 'carol', {
            QAAP_MAX_QUEUED_AGENTS: '2'
        })).to.throw(QaapAgentQueueFullError);
    });

    it('normalizes owners and lets another owner enqueue below the global cap', () => {
        const tasks = [task(' Alice ')];
        const env = { QAAP_MAX_QUEUED_AGENTS_PER_USER: '1' };
        expect(() => policy.assertCapacity(tasks, 'ALICE', env)).to.throw(QaapAgentQueueFullError);
        expect(() => policy.assertCapacity(tasks, 'bob', env)).not.to.throw();
    });

    it('bounds anonymous local requests too', () => {
        expect(() => policy.assertCapacity([task()], undefined, {
            QAAP_MAX_QUEUED_AGENTS_PER_USER: '1'
        })).to.throw(QaapAgentQueueFullError);
    });

    it('releases queue space after cancellation or promotion to running', () => {
        for (const state of ['cancelled', 'running', 'completed', 'failed', 'interrupted'] as const) {
            expect(() => policy.assertCapacity([task('alice', state)], 'alice', {
                QAAP_MAX_QUEUED_AGENTS: '1', QAAP_MAX_QUEUED_AGENTS_PER_USER: '1'
            })).not.to.throw();
        }
    });

    it('falls back to finite defaults for malformed settings', () => {
        const tasks = Array.from({ length: 20 }, () => task('alice'));
        for (const value of ['', '0', '-1', '2oops', '2.5', 'Infinity', '9007199254740992']) {
            expect(() => policy.assertCapacity(tasks, 'alice', {
                QAAP_MAX_QUEUED_AGENTS: value, QAAP_MAX_QUEUED_AGENTS_PER_USER: value
            })).to.throw(QaapAgentQueueFullError);
        }
    });
});
