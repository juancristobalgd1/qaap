// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { QaapAgentMessage } from './qaap-agent-conversation';
import {
    QAAP_AGENT_GOAL_LOOP_BUDGET_CEILING,
    QAAP_AGENT_GOAL_LOOP_DEFAULT_BUDGET,
    buildGoalLoopEvaluatorPrompt,
    buildGoalLoopGapsPrompt,
    buildGoalLoopTranscriptExcerpt,
    buildGoalLoopTurnFailedPrompt,
    buildGoalLoopVerifyFailedPrompt,
    createGoalLoopState,
    finishGoalLoop,
    isGoalLoopActive,
    mergeGoalLoopBudget,
    normalizeGoalLoopGoal,
    parseGoalLoopEvaluatorResponse,
    resolveGoalLoopBudgetStopBeforeEvaluator,
    resolveGoalLoopBudgetStopBeforeTurn,
    resolveGoalLoopFallbackEvaluation,
    resolveGoalLoopStartRejection,
    type QaapAgentGoalLoopState,
} from './qaap-agent-goal-loop';

const NOW = 1_000_000;

function state(overrides: Partial<QaapAgentGoalLoopState> = {}): QaapAgentGoalLoopState {
    return {
        ...createGoalLoopState({ goal: 'Ship the login page', budget: QAAP_AGENT_GOAL_LOOP_DEFAULT_BUDGET, anchorUserMessageId: 'u1', now: NOW }),
        ...overrides,
    };
}

describe('qaap-agent-goal-loop', () => {

    describe('budget', () => {
        it('uses the design defaults', () => {
            expect(mergeGoalLoopBudget()).to.deep.equal({
                maxIterations: 8,
                maxDurationMs: 2 * 60 * 60 * 1000,
                maxEvaluatorCalls: 8,
                maxAgentRuntimeMs: 60 * 60 * 1000,
            });
        });

        it('defaults maxEvaluatorCalls to the merged maxIterations', () => {
            expect(mergeGoalLoopBudget({ maxIterations: 3 }).maxEvaluatorCalls).to.equal(3);
            expect(mergeGoalLoopBudget({ maxIterations: 3, maxEvaluatorCalls: 5 }).maxEvaluatorCalls).to.equal(5);
        });

        it('ignores invalid values and clamps to the ceilings', () => {
            const merged = mergeGoalLoopBudget({
                maxIterations: 1000,
                maxDurationMs: -1,
                maxAgentRuntimeMs: Number.NaN,
                maxEvaluatorCalls: 'x' as unknown as number,
            });
            expect(merged.maxIterations).to.equal(QAAP_AGENT_GOAL_LOOP_BUDGET_CEILING.maxIterations);
            expect(merged.maxDurationMs).to.equal(QAAP_AGENT_GOAL_LOOP_DEFAULT_BUDGET.maxDurationMs);
            expect(merged.maxAgentRuntimeMs).to.equal(QAAP_AGENT_GOAL_LOOP_DEFAULT_BUDGET.maxAgentRuntimeMs);
            expect(merged.maxEvaluatorCalls).to.equal(QAAP_AGENT_GOAL_LOOP_BUDGET_CEILING.maxEvaluatorCalls);
        });

        it('stops before a turn on iterations, agent runtime and wall clock', () => {
            expect(resolveGoalLoopBudgetStopBeforeTurn(state(), NOW)).to.equal(undefined);
            expect(resolveGoalLoopBudgetStopBeforeTurn(state({ iteration: 8 }), NOW)).to.match(/Iteration budget/);
            expect(resolveGoalLoopBudgetStopBeforeTurn(
                state({ usage: { evaluatorCalls: 0, agentRuntimeMs: 60 * 60 * 1000 } }), NOW,
            )).to.match(/Agent runtime budget/);
            expect(resolveGoalLoopBudgetStopBeforeTurn(state(), NOW + 2 * 60 * 60 * 1000)).to.match(/Time budget/);
        });

        it('enforces the evaluator budget', () => {
            expect(resolveGoalLoopBudgetStopBeforeEvaluator(state(), NOW)).to.equal(undefined);
            expect(resolveGoalLoopBudgetStopBeforeEvaluator(
                state({ usage: { evaluatorCalls: 8, agentRuntimeMs: 0 } }), NOW,
            )).to.match(/Evaluator budget/);
        });
    });

    describe('active state', () => {
        it('is active only in non-terminal phases', () => {
            expect(isGoalLoopActive(undefined)).to.equal(false);
            expect(isGoalLoopActive({})).to.equal(false);
            expect(isGoalLoopActive({ goalLoop: state() })).to.equal(true);
            expect(isGoalLoopActive({ goalLoop: state({ phase: 'evaluating' }) })).to.equal(true);
            expect(isGoalLoopActive({ goalLoop: finishGoalLoop(state(), 'completed', undefined, NOW) })).to.equal(false);
            expect(isGoalLoopActive({ goalLoop: finishGoalLoop(state(), 'blocked', 'x', NOW) })).to.equal(false);
            expect(isGoalLoopActive({ goalLoop: finishGoalLoop(state(), 'cancelled', 'x', NOW) })).to.equal(false);
        });

        it('records the stop reason and finish time', () => {
            const finished = finishGoalLoop(state(), 'blocked', 'Out of time.', NOW + 5);
            expect(finished.phase).to.equal('blocked');
            expect(finished.stopReason).to.equal('Out of time.');
            expect(finished.finishedAt).to.equal(NOW + 5);
        });
    });

    describe('start guard', () => {
        const idle = { status: 'idle' as const };

        it('accepts an idle auto-approve agent conversation', () => {
            expect(resolveGoalLoopStartRejection(idle, 'goal')).to.equal(undefined);
        });

        it('rejects a missing goal, manual approval, plan mode, streaming and an active loop', () => {
            expect(resolveGoalLoopStartRejection(idle, normalizeGoalLoopGoal('   '))).to.match(/goal is required/);
            expect(resolveGoalLoopStartRejection({ ...idle, autoApprove: false }, 'g')).to.match(/auto-approve/);
            expect(resolveGoalLoopStartRejection({ ...idle, approvalPolicyId: 'request-approval' }, 'g')).to.match(/auto-approve/);
            expect(resolveGoalLoopStartRejection({ ...idle, interactionModeId: 'plan' }, 'g')).to.match(/plan mode/);
            expect(resolveGoalLoopStartRejection({ status: 'streaming' }, 'g')).to.match(/current turn/);
            expect(resolveGoalLoopStartRejection({ ...idle, goalLoop: state() }, 'g')).to.match(/already running/);
        });

        it('allows a new loop after a finished one', () => {
            expect(resolveGoalLoopStartRejection({ ...idle, goalLoop: finishGoalLoop(state(), 'blocked', 'x', NOW) }, 'g'))
                .to.equal(undefined);
        });
    });

    describe('prompts', () => {
        it('tags the three feedback prompts with the next iteration', () => {
            const current = state({ iteration: 2 });
            const failed = buildGoalLoopTurnFailedPrompt(current, 'Rate limit reached');
            expect(failed).to.contain('[Goal · turn failed] Iteration 3/8');
            expect(failed).to.contain('Ship the login page');
            expect(failed).to.contain('Rate limit reached');

            const verify = buildGoalLoopVerifyFailedPrompt(current, {
                status: 'failed', command: 'npm run test', summary: 'x'.repeat(10_000) + 'TAIL', checkedAt: NOW,
            });
            expect(verify).to.contain('[Goal · verify failed]');
            expect(verify).to.contain('npm run test');
            expect(verify).to.contain('TAIL');
            expect(verify.length).to.be.lessThan(5_000);

            const gaps = buildGoalLoopGapsPrompt(current, {
                done: false, confidence: 'medium', reasoning: 'Form has no validation.', gaps: ['Add email validation'],
                source: 'evaluator', evaluatedAt: NOW,
            });
            expect(gaps).to.contain('[Goal · gaps remain]');
            expect(gaps).to.contain('Form has no validation.');
            expect(gaps).to.contain('- Add email validation');
        });

        it('builds the evaluator prompt with the JSON output contract', () => {
            const prompt = buildGoalLoopEvaluatorPrompt({
                goal: 'Ship it',
                verify: { status: 'passed', command: 'npm run build', checkedAt: NOW },
                diffAdded: 10,
                diffRemoved: 2,
                transcriptExcerpt: '### USER\nhi',
            });
            expect(prompt).to.contain('Ship it');
            expect(prompt).to.contain('passed (npm run build)');
            expect(prompt).to.contain('+10 / -2 lines');
            expect(prompt).to.contain('"done": boolean');
            expect(prompt).to.contain('do not modify');
        });

        it('keeps the last 8 messages within the char cap, newest first to survive', () => {
            const messages: QaapAgentMessage[] = Array.from({ length: 12 }, (_, index) => ({
                id: `m${index}`,
                role: index % 2 === 0 ? 'user' : 'agent',
                content: `message-${index} ${'y'.repeat(3_000)}`,
                createdAt: index,
            }));
            const excerpt = buildGoalLoopTranscriptExcerpt(messages);
            expect(excerpt.length).to.be.at.most(12_000);
            expect(excerpt).not.to.contain('message-3 ');
            expect(excerpt).to.contain('message-11');
            const small = buildGoalLoopTranscriptExcerpt(messages.slice(0, 2).map(message => ({ ...message, content: message.id })));
            expect(small).to.equal('### USER\nm0\n\n### AGENT\nm1');
        });
    });

    describe('parseGoalLoopEvaluatorResponse', () => {
        it('parses bare JSON', () => {
            const parsed = parseGoalLoopEvaluatorResponse('{"done": true, "confidence": "high", "reasoning": "All good", "gaps": []}', NOW);
            expect(parsed).to.deep.equal({ done: true, confidence: 'high', reasoning: 'All good', gaps: [], source: 'evaluator', evaluatedAt: NOW });
        });

        it('parses a fenced block', () => {
            const parsed = parseGoalLoopEvaluatorResponse('Here is my verdict:\n```json\n{"done": false, "confidence": "medium", "reasoning": "r", "gaps": ["a", "b"]}\n```', NOW);
            expect(parsed?.done).to.equal(false);
            expect(parsed?.gaps).to.deep.equal(['a', 'b']);
        });

        it('parses JSON embedded in prose, with braces inside strings', () => {
            const parsed = parseGoalLoopEvaluatorResponse(
                'I checked the repo. {"done": false, "confidence": "low", "reasoning": "missing } brace {", "gaps": ["x"]} Thanks!',
                NOW,
            );
            expect(parsed?.reasoning).to.equal('missing } brace {');
        });

        it('normalizes an unknown confidence and drops non-string gaps', () => {
            const parsed = parseGoalLoopEvaluatorResponse('{"done": false, "confidence": "certain", "gaps": ["ok", 3, ""]}', NOW);
            expect(parsed?.confidence).to.equal('low');
            expect(parsed?.reasoning).to.equal('');
            expect(parsed?.gaps).to.deep.equal(['ok']);
        });

        it('returns undefined without a valid verdict', () => {
            expect(parseGoalLoopEvaluatorResponse(undefined)).to.equal(undefined);
            expect(parseGoalLoopEvaluatorResponse('looks done to me')).to.equal(undefined);
            expect(parseGoalLoopEvaluatorResponse('{"done": "yes"}')).to.equal(undefined);
            expect(parseGoalLoopEvaluatorResponse('{"done": true,')).to.equal(undefined);
        });
    });

    describe('fallback verdict', () => {
        it('treats green checks as done with low confidence', () => {
            const verdict = resolveGoalLoopFallbackEvaluation({ status: 'passed', checkedAt: NOW }, 'timeout', NOW);
            expect(verdict).to.include({ done: true, confidence: 'low', source: 'fallback' });
            expect(verdict.reasoning).to.contain('timeout');
        });

        it('cannot confirm the goal without checks', () => {
            const verdict = resolveGoalLoopFallbackEvaluation({ status: 'skipped', checkedAt: NOW }, undefined, NOW);
            expect(verdict).to.include({ done: false, source: 'fallback' });
        });
    });
});
