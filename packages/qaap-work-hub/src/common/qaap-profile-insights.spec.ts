// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { computeQaapProfileInsights, QAAP_PROFILE_MAX_MODELS, type QaapProfileInsightsConversation } from './qaap-profile-insights';

const NOW = new Date(2026, 10, 20, 15, 0, 0);
const at = (daysAgo: number, hour = 10): number => new Date(2026, 10, 20 - daysAgo, hour, 0, 0).getTime();
const task = (createdAt: number, extra: Partial<QaapProfileInsightsConversation> = {}): QaapProfileInsightsConversation => ({
    createdAt,
    updatedAt: createdAt,
    agentId: 'codex',
    cwd: '/repos/acme/web',
    messageCount: 2,
    ...extra,
});

describe('computeQaapProfileInsights', () => {
    it('is empty without tasks', () => {
        const insights = computeQaapProfileInsights([], NOW);
        expect(insights).to.include({ tasks: 0, messages: 0, projects: 0, currentStreakDays: 0, longestStreakDays: 0 });
        expect(insights.peakDay).to.equal(undefined);
        expect(insights.mostActiveHour).to.equal(undefined);
        expect(insights.harnesses).to.deep.equal([]);
        expect(insights.models).to.deep.equal([]);
    });

    it('counts tasks, messages and distinct projects (trailing slash and casing are one project)', () => {
        const insights = computeQaapProfileInsights([
            task(at(0), { messageCount: 4 }),
            task(at(1), { cwd: '/repos/acme/web/' }),
            task(at(2), { cwd: '/Repos/Acme/Web', messageCount: 3 }),
            task(at(2), { cwd: '/repos/acme/api' }),
        ], NOW);
        expect(insights).to.include({ tasks: 4, messages: 11, projects: 2 });
    });

    it('counts a project once across its clones and its task worktrees, like the sessions sidebar', () => {
        const insights = computeQaapProfileInsights([
            task(at(0), { cwd: '/opt/qaap-runtime/workspace/repos/users/me/acme/web' }),
            task(at(0), { cwd: '/Users/me/.qaap/workspaces/users/me/acme/web' }),
            task(at(1), { cwd: '/Users/me/.qaap/worktrees/web_2', parallelBaseCwd: '/Users/me/.qaap/workspaces/users/me/acme/web' }),
            task(at(1), { cwd: '/opt/qaap-runtime/workspace/repos/users/me/acme/api' }),
        ], NOW);
        expect(insights.projects).to.equal(2);
    });

    it('measures the current streak up to today, and keeps it alive until today has activity', () => {
        expect(computeQaapProfileInsights([task(at(0)), task(at(1)), task(at(2)), task(at(4))], NOW).currentStreakDays).to.equal(3);
        expect(computeQaapProfileInsights([task(at(1)), task(at(2))], NOW).currentStreakDays, 'nothing yet today').to.equal(2);
        expect(computeQaapProfileInsights([task(at(2)), task(at(3))], NOW).currentStreakDays, 'a missed day ends it').to.equal(0);
    });

    it('finds the longest streak anywhere in the history, counting the day a task was last updated', () => {
        const insights = computeQaapProfileInsights([
            task(at(30)), task(at(29)), task(at(28)), task(at(27)),
            task(at(10), { updatedAt: at(9) }),
            task(at(0)),
        ], NOW);
        expect(insights.longestStreakDays).to.equal(4);
    });

    it('names the peak day and the most active hour', () => {
        const insights = computeQaapProfileInsights([
            task(at(5, 23)), task(at(5, 23)), task(at(5, 9)),
            task(at(1, 23)),
        ], NOW);
        expect(insights.peakDay).to.deep.equal({ day: new Date(2026, 10, 15).getTime(), tasks: 3 });
        expect(insights.mostActiveHour).to.equal(23);
    });

    it('ranks harnesses by the harness of the last turn, with their share of tasks', () => {
        const insights = computeQaapProfileInsights([
            task(at(0), { agentId: 'codex' }),
            task(at(0), { agentId: 'codex', lastTurnAgentId: 'claude' }),
            task(at(0), { agentId: 'Claude' }),
            task(at(0), { agentId: 'pi' }),
        ], NOW);
        expect(insights.harnesses.map(harness => [harness.agentId, harness.tasks, harness.share])).to.deep.equal([
            ['claude', 2, 0.5],
            ['codex', 1, 0.25],
            ['pi', 1, 0.25],
        ]);
    });

    it('ranks models per harness from the last turn model, the task model or the QAIQ model', () => {
        const insights = computeQaapProfileInsights([
            task(at(0), { agentId: 'claude', agentModel: { modelId: 'sonnet' } }),
            task(at(0), { agentId: 'claude', agentModel: { modelId: 'opus' }, lastTurnAgentModel: { modelId: 'sonnet' } }),
            task(at(0), { agentId: 'qaiq', qaiqModel: { modelId: 'gpt-6' } }),
            task(at(0), { agentId: 'codex' }),
        ], NOW);
        expect(insights.models.map(model => [model.agentId, model.modelId, model.tasks])).to.deep.equal([
            ['claude', 'sonnet', 2],
            ['qaiq', 'gpt-6', 1],
        ]);
        expect(insights.models[0].share).to.be.closeTo(2 / 3, 1e-9);
    });

    it(`lists at most ${QAAP_PROFILE_MAX_MODELS} models`, () => {
        const many = Array.from({ length: QAAP_PROFILE_MAX_MODELS + 3 }, (_, index) => task(at(0), { agentModel: { modelId: `m${index}` } }));
        expect(computeQaapProfileInsights(many, NOW).models).to.have.length(QAAP_PROFILE_MAX_MODELS);
    });

    it('ignores activity dated after today', () => {
        const insights = computeQaapProfileInsights([task(at(-2)), task(at(0))], NOW);
        expect(insights.currentStreakDays).to.equal(1);
        expect(insights.peakDay?.day).to.equal(new Date(2026, 10, 20).getTime());
    });
});
