// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { normalizeResearchGoal } from '../common/qaap-research-goal';
import type { ResearchExperimentRecord } from '../common/qaap-research-ledger';
import { MobileProjectsHubResearchUi, type MobileProjectsHubResearchHost } from './mobile-projects-hub-research-ui';

describe('MobileProjectsHubResearchUi — row subtitle', () => {

    const baseMetric = { name: 'loss', direction: 'min' as const, metricCommand: 'echo 0.5', target: 0.4, primary: true };

    function createUi(details?: Map<string, { records: readonly ResearchExperimentRecord[]; bestPrimary?: number }>): MobileProjectsHubResearchUi {
        const host = {
            query: '',
            scroll: {} as HTMLElement,
            hubView: 'research',
            visible: true,
            messageService: undefined,
            researchGoals: [],
            researchGoalDetails: details ?? new Map(),
            researchGoalsLoaded: true,
            researchGoalsLoading: false,
            researchRefreshTimer: undefined,
            researchInteractionLock: false,
            researchSheet: undefined,
            refreshResearchGoals: async () => undefined,
            renderSubtitle: () => undefined,
            renderList: () => undefined,
        } satisfies MobileProjectsHubResearchHost;
        return new MobileProjectsHubResearchUi(host);
    }

    it('includes active duration after status when startedAt is present', () => {
        const ui = createUi();
        const goal = normalizeResearchGoal({
            id: 'g1',
            cwd: '/tmp/my-repo',
            description: 'Tune learning rate',
            metrics: [baseMetric],
            createdAt: 1000,
            startedAt: 1000,
        });
        const subtitle = ui.researchRowHeaderSubtitle(goal, 175_000);
        expect(subtitle).to.include('Running');
        expect(subtitle).to.include('2m 54s');
        expect(subtitle).to.include('my-repo');
    });

    it('includes total active duration for completed goals with finishedAt', () => {
        const ui = createUi();
        const goal = normalizeResearchGoal({
            id: 'g1',
            cwd: '/tmp/my-repo',
            description: 'Tune learning rate',
            metrics: [baseMetric],
            createdAt: 1000,
            startedAt: 1000,
            finishedAt: 61_000,
            status: 'completed',
        });
        const subtitle = ui.researchRowHeaderSubtitle(goal);
        expect(subtitle).to.include('Completed');
        expect(subtitle).to.include('1m 0s');
        expect(subtitle).to.not.include('target');
    });

    it('moves best, target and termination into the finished results block', () => {
        const goal = normalizeResearchGoal({
            id: 'g1',
            cwd: '/tmp/my-repo',
            description: 'Tune learning rate',
            metrics: [baseMetric],
            createdAt: 1000,
            startedAt: 1000,
            finishedAt: 61_000,
            status: 'completed',
            terminationReason: 'reached-target',
        });
        const details = new Map<string, { records: readonly ResearchExperimentRecord[]; bestPrimary?: number }>([
            ['g1', {
                bestPrimary: 0.35,
                records: [{
                    id: 'r1',
                    goalId: 'g1',
                    round: 1,
                    startedAt: 0,
                    hypothesis: 'Lower learning rate stabilizes loss',
                    declaredConfig: {},
                    declaredConfigFingerprint: 'fp',
                    realChangeFingerprint: 'rfp',
                    phase: 'done',
                    metrics: [{ name: 'loss', value: 0.35, direction: 'min' }],
                    verdict: 'improved',
                }],
            }],
        ]);
        const ui = createUi(details);
        const subtitle = ui.researchRowHeaderSubtitle(goal);
        const results = ui.researchResultLines(goal);
        expect(subtitle).to.not.include('Reached target');
        expect(subtitle).to.not.include('best');
        expect(results.some(line => line.includes('0.35') && line.includes('0.4'))).to.be.true;
        expect(results.some(line => line.includes('Reached target'))).to.be.true;
        expect(results.some(line => line.includes('1 rounds'))).to.be.true;
        expect(results.some(line => line.includes('Lower learning rate'))).to.be.true;
    });
});
