// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    assertGoalLoopCanStart,
    buildGoalLoopInitialPrompt,
    buildGoalLoopVerifyFailurePrompt,
    evaluateGoalLoopDeterministic,
    isGoalLoopActive,
    isGoalLoopBudgetExceeded,
    mergeGoalLoopBudget,
    parseGoalLoopEvaluatorResponse,
    type QaapAgentGoalLoopState,
} from './qaap-agent-goal-loop';
import type { QaapAgentConversation } from './qaap-agent-conversation';
import { resolveAgentVerifyChecksForCwd, tailVerifyLog } from './qaap-agent-goal-loop-verify';

function conversation(partial: Partial<QaapAgentConversation>): QaapAgentConversation {
    return {
        id: 'conv-1',
        cwd: '/workspace',
        agentId: 'qaiq',
        title: 'Test',
        status: 'idle',
        createdAt: 1,
        updatedAt: 2,
        messages: [],
        ...partial,
    };
}

describe('qaap-agent-goal-loop', () => {
    it('mergeGoalLoopBudget applies defaults', () => {
        expect(mergeGoalLoopBudget({ maxIterations: 3 }).maxIterations).to.equal(3);
        expect(mergeGoalLoopBudget({}).maxDurationMs).to.equal(2 * 60 * 60 * 1000);
    });

    it('isGoalLoopActive excludes terminal phases', () => {
        const running: QaapAgentGoalLoopState = {
            phase: 'executing',
            goal: 'fix tests',
            startedAt: 1,
            updatedAt: 1,
            iteration: 0,
            budget: mergeGoalLoopBudget(),
            verify: { enabled: true },
            anchorUserMessageId: 'u1',
        };
        expect(isGoalLoopActive(running)).to.equal(true);
        expect(isGoalLoopActive({ ...running, phase: 'completed' })).to.equal(false);
    });

    it('assertGoalLoopCanStart rejects manual approval and active loops', () => {
        expect(() => assertGoalLoopCanStart(conversation({ autoApprove: false }))).to.throw(/auto-approve/);
        expect(() => assertGoalLoopCanStart(conversation({
            goalLoop: {
                phase: 'executing',
                goal: 'x',
                startedAt: 1,
                updatedAt: 1,
                iteration: 0,
                budget: mergeGoalLoopBudget(),
                verify: { enabled: true },
                anchorUserMessageId: 'u1',
            },
        }))).to.throw(/already active/);
    });

    it('buildGoalLoopInitialPrompt embeds the goal', () => {
        const prompt = buildGoalLoopInitialPrompt('all tests green');
        expect(prompt).to.include('all tests green');
        expect(prompt).to.include('[Goal · loop]');
    });

    it('buildGoalLoopVerifyFailurePrompt includes failing command output', () => {
        const prompt = buildGoalLoopVerifyFailurePrompt('fix auth', {
            at: 1,
            allGreen: false,
            results: [{
                label: 'Test',
                command: 'npm test',
                exitCode: 1,
                logTail: 'FAIL auth.spec.ts',
                durationMs: 100,
            }],
        });
        expect(prompt).to.include('[Goal · verify failed]');
        expect(prompt).to.include('npm test');
        expect(prompt).to.include('FAIL auth.spec.ts');
    });

    it('evaluateGoalLoopDeterministic passes when verify is green', () => {
        const evaluation = evaluateGoalLoopDeterministic({
            goal: 'tests pass',
            verify: { at: 1, allGreen: true, results: [] },
            transcriptExcerpt: '',
        });
        expect(evaluation.done).to.equal(true);
    });

    it('isGoalLoopBudgetExceeded respects iteration and duration', () => {
        const state: QaapAgentGoalLoopState = {
            phase: 'executing',
            goal: 'x',
            startedAt: 1000,
            updatedAt: 1000,
            iteration: 8,
            budget: mergeGoalLoopBudget({ maxIterations: 8, maxDurationMs: 1000 }),
            verify: { enabled: true },
            anchorUserMessageId: 'u1',
        };
        expect(isGoalLoopBudgetExceeded(state, 1500)).to.equal(true);
    });

    it('parseGoalLoopEvaluatorResponse extracts JSON from fenced replies', () => {
        const parsed = parseGoalLoopEvaluatorResponse([
            'Here is my judgment:',
            '```json',
            '{"done":true,"confidence":"high","reasoning":"tests pass"}',
            '```',
        ].join('\n'));
        expect(parsed?.done).to.equal(true);
        expect(parsed?.confidence).to.equal('high');
    });
});

describe('qaap-agent-goal-loop-verify', () => {
    it('resolveAgentVerifyChecksForCwd picks compile/build/test scripts', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-verify-'));
        try {
            fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
                scripts: { test: 'vitest run', dev: 'vite' },
            }));
            fs.writeFileSync(path.join(dir, 'pnpm-lock.yaml'), '');
            const checks = resolveAgentVerifyChecksForCwd(dir);
            expect(checks).to.deep.equal([{ label: 'Test', command: 'pnpm run test' }]);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it('tailVerifyLog keeps the last lines', () => {
        expect(tailVerifyLog('a\nb\nc\nd', 2)).to.equal('c\nd');
    });
});
