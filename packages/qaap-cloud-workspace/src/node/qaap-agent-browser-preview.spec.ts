// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QaapAgentTaskRunner } from './qaap-agent-task-runner';
import type { QaapAgentTask, QaapAgentTaskEvent } from '../common/qaap-agent-task';

describe('Qaap agent browser preview events', () => {
    it('publishes the active task URL ephemerally and only for the owning user', () => {
        const events: QaapAgentTaskEvent[] = [];
        const task = { id: 'task-1', cwd: '/repo/alice', ownerLogin: 'alice', state: 'running' } as QaapAgentTask;
        const runner = Object.create(QaapAgentTaskRunner.prototype) as QaapAgentTaskRunner;
        Object.assign(runner, {
            tasks: new Map([[task.id, task]]),
            agentBrowserUrls: new Map<string, string>(),
            onDidChangeTaskEmitter: { fire: (event: QaapAgentTaskEvent) => events.push(event) },
        });

        expect(runner.publishAgentBrowserUrl(task.id, 'bob', 'https://example.com/')).to.equal(false);
        expect(runner.publishAgentBrowserUrl(task.id, 'alice', 'file:///etc/passwd')).to.equal(false);
        expect(runner.publishAgentBrowserUrl(task.id, 'alice', 'https://example.com/docs')).to.equal(true);
        expect(events).to.deep.equal([{ type: 'browser-url', task, url: 'https://example.com/docs' }]);
        expect(runner.listAgentBrowserUrls()).to.deep.equal([{ task, url: 'https://example.com/docs' }]);
    });
});
