// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as path from 'path';
import { QAAP_CONTAINER_CWD_ERROR } from '@theia/qaap-adapters/lib/common/qaap-workspace-container-path';
import { QaapAgentTaskRunner } from './qaap-agent-task-runner';

/**
 * The agent must never be spawned on a workspace container: it would ingest every repository the
 * user owns in a single turn (wrong scope, and an enormous LLM context billed to them). Endpoints
 * reject it earlier; these are the last-line guards that also cover the routine runner and retries.
 */
describe('agent spawn refuses a workspace-container cwd', () => {

    function buildRunner(): QaapAgentTaskRunner {
        const runner = Object.create(QaapAgentTaskRunner.prototype) as QaapAgentTaskRunner;
        Object.assign(runner, {
            tasks: new Map(),
            queuedCreateRequests: new Map(),
            processes: new Map(),
            detectedAgents: new Map(),
            onDidChangeTaskEmitter: { fire: () => undefined },
            maxConcurrentAgents: () => 4,
            countRunningTasks: () => 0,
            resolveAgentModelForRequest: () => undefined,
            isDirectory: () => true,
            persist: async () => undefined,
            spawnProcessWhenReady: async () => undefined,
        });
        return runner;
    }

    const containers = [
        '/workspace',
        '/workspace/repos',
        '/workspace/repos/users/alice',
        '/workspace/repos/users/alice/acme',
    ];

    for (const cwd of containers) {
        it(`throws for ${cwd}`, () => {
            expect(() => buildRunner().create({ prompt: 'do work', cwd }))
                .to.throw(QAAP_CONTAINER_CWD_ERROR);
        });
    }

    it('still accepts a concrete repository path', () => {
        const task = buildRunner().create({
            prompt: 'do work',
            agent: 'shell',
            cwd: '/workspace/repos/users/alice/acme/widgets',
        });
        expect(task.cwd).to.equal(path.resolve('/workspace/repos/users/alice/acme/widgets'));
        expect(task.agentId).to.equal('shell');
    });

    it('refuses a natural-language prompt when no coding CLI is installed', () => {
        expect(() => buildRunner().create({
            prompt: 'fix the tests',
            cwd: '/workspace/repos/users/alice/acme/widgets',
        })).to.throw(/No coding agent CLI is installed/);
    });

    it('still accepts a command-only create as Shell', () => {
        const task = buildRunner().create({
            command: 'npm test',
            cwd: '/workspace/repos/users/alice/acme/widgets',
        });
        expect(task.agentId).to.equal('shell');
    });
});
