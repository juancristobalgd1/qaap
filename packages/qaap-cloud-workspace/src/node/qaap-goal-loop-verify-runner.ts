// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import {
    isQaapAgentTaskFinished,
    type QaapCreateAgentTaskRequest,
} from '../common/qaap-agent-task';
import type {
    QaapAgentGoalLoopVerifyCheckResult,
    QaapAgentGoalLoopVerifyConfig,
    QaapAgentGoalLoopVerifySnapshot,
} from '../common/qaap-agent-goal-loop';
import { resolveAgentVerifyChecksForCwd, tailVerifyLog } from '../common/qaap-agent-goal-loop-verify';
import { QaapAgentTaskRunner } from './qaap-agent-task-runner';

const VERIFY_POLL_MS = 700;
const VERIFY_TIMEOUT_MS = 180_000;

/** Runs npm/package.json verify checks as background shell tasks on the VPS. */
@injectable()
export class QaapGoalLoopVerifyRunner {

    @inject(QaapAgentTaskRunner)
    protected readonly taskRunner: QaapAgentTaskRunner;

    async runVerifyChecks(cwd: string, config: QaapAgentGoalLoopVerifyConfig): Promise<QaapAgentGoalLoopVerifySnapshot> {
        if (!config.enabled) {
            return {
                at: Date.now(),
                allGreen: true,
                results: [],
            };
        }

        const checks = [
            ...resolveAgentVerifyChecksForCwd(cwd),
            ...(config.extraCommands ?? []).map((command, index) => ({
                label: `Extra ${index + 1}`,
                command,
            })),
        ];

        const results: QaapAgentGoalLoopVerifyCheckResult[] = [];
        for (const check of checks) {
            const started = Date.now();
            const task = this.taskRunner.create({
                command: check.command,
                cwd,
                title: `Verify: ${check.label}`,
                autoApprove: true,
            } satisfies QaapCreateAgentTaskRequest);
            const detail = await this.pollTask(task.id);
            const finishedAt = detail?.finishedAt ?? Date.now();
            const exitCode = detail?.exitCode ?? 1;
            results.push({
                label: check.label,
                command: check.command,
                exitCode,
                logTail: tailVerifyLog(detail?.log),
                durationMs: Math.max(0, finishedAt - started),
            });
        }

        return {
            at: Date.now(),
            allGreen: results.every(result => result.exitCode === 0),
            results,
        };
    }

    protected async pollTask(taskId: string): Promise<Awaited<ReturnType<QaapAgentTaskRunner['detail']>>> {
        const deadline = Date.now() + VERIFY_TIMEOUT_MS;
        while (Date.now() < deadline) {
            const detail = await this.taskRunner.detail(taskId);
            if (detail && isQaapAgentTaskFinished(detail.state)) {
                return detail;
            }
            await new Promise(resolve => setTimeout(resolve, VERIFY_POLL_MS));
        }
        throw new Error('Goal loop verify timed out.');
    }
}
