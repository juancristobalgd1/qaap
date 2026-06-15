// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import {
    isQaapAgentTaskFinished,
    type QaapCreateAgentTaskRequest,
} from '../common/qaap-agent-task';
import {
    buildGoalLoopEvaluatorPrompt,
    evaluateGoalLoopDeterministic,
    parseGoalLoopEvaluatorResponse,
    type QaapAgentGoalLoopEvaluation,
    type QaapGoalLoopEvaluatorInput,
} from '../common/qaap-agent-goal-loop';
import { filterAgentProcessLogChunk } from '../common/qaap-agent-log-filter';
import { resolveAgentLogDisplayText } from '@theia/qaap-mobile-shell/lib/common/qaap-cli-transcript-stream';
import { QaapAgentTaskRunner } from './qaap-agent-task-runner';

const EVAL_POLL_MS = 700;
const EVAL_TIMEOUT_MS = 120_000;

function shellQuote(value: string): string {
    if (/^[A-Za-z0-9_./:-]+$/.test(value)) {
        return value;
    }
    return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Separate read-only evaluator — does not share the worker agent's turn context. */
@injectable()
export class QaapGoalLoopLlmEvaluator {

    @inject(QaapAgentTaskRunner)
    protected readonly taskRunner: QaapAgentTaskRunner;

    async evaluate(input: QaapGoalLoopEvaluatorInput, cwd: string): Promise<QaapAgentGoalLoopEvaluation> {
        if (!input.verify.allGreen) {
            return evaluateGoalLoopDeterministic(input);
        }
        try {
            const llm = await this.runLlmEvaluation(input, cwd);
            if (llm) {
                return llm;
            }
        } catch {
            /* fall through to deterministic */
        }
        return evaluateGoalLoopDeterministic(input);
    }

    protected async runLlmEvaluation(input: QaapGoalLoopEvaluatorInput, cwd: string): Promise<QaapAgentGoalLoopEvaluation | undefined> {
        const qaiqBin = process.env.QAAP_GOAL_LOOP_EVAL_BIN?.trim() || 'qaiq';
        const modelFlag = process.env.QAAP_GOAL_LOOP_EVAL_MODEL?.trim()
            ? `--model ${shellQuote(process.env.QAAP_GOAL_LOOP_EVAL_MODEL.trim())}`
            : '';
        const prompt = buildGoalLoopEvaluatorPrompt(input);
        const command = `${qaiqBin} --print --permission-mode plan ${modelFlag} -p ${shellQuote(prompt)}`.trim();
        const task = this.taskRunner.create({
            command,
            cwd,
            title: 'Goal loop evaluator',
            autoApprove: true,
        } satisfies QaapCreateAgentTaskRequest);
        const detail = await this.pollTask(task.id);
        const log = filterAgentProcessLogChunk((detail?.log ?? '').trim());
        const display = log ? resolveAgentLogDisplayText('qaiq', log) : '';
        const parsed = parseGoalLoopEvaluatorResponse(display || log);
        if (!parsed) {
            return undefined;
        }
        return {
            at: Date.now(),
            done: parsed.done,
            confidence: parsed.confidence,
            reasoning: parsed.reasoning,
            gaps: parsed.gaps,
        };
    }

    protected async pollTask(taskId: string): Promise<Awaited<ReturnType<QaapAgentTaskRunner['detail']>>> {
        const deadline = Date.now() + EVAL_TIMEOUT_MS;
        while (Date.now() < deadline) {
            const detail = await this.taskRunner.detail(taskId);
            if (detail && isQaapAgentTaskFinished(detail.state)) {
                return detail;
            }
            await new Promise(resolve => setTimeout(resolve, EVAL_POLL_MS));
        }
        throw new Error('Goal loop evaluator timed out.');
    }
}
