// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
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
            researchExpandedGoalIds: new Set<string>(),
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
        expect(results.some(line => line.includes('Lower learning rate'))).to.be.false;
    });
});

describe('MobileProjectsHubResearchUi — accordion detail', () => {

    let disableJSDOM: () => void;

    before(() => {
        disableJSDOM = enableJSDOM();
    });

    after(() => {
        disableJSDOM();
    });

    const baseMetric = { name: 'loss', direction: 'min' as const, metricCommand: 'echo 0.5', target: 0.4, primary: true };

    const longHypothesis = 'Lower the learning rate gradually across multiple warmup epochs so the optimizer can settle into a stable basin without overshooting the loss minimum during early training';

    function createUiWithExpanded(
        goalId: string,
        records: readonly ResearchExperimentRecord[],
        bestPrimary?: number,
    ): { ui: MobileProjectsHubResearchUi; host: MobileProjectsHubResearchHost } {
        const host = {
            query: '',
            scroll: {} as HTMLElement,
            hubView: 'research',
            visible: true,
            messageService: undefined,
            researchGoals: [],
            researchGoalDetails: new Map([[goalId, { records, bestPrimary }]]),
            researchGoalsLoaded: true,
            researchGoalsLoading: false,
            researchRefreshTimer: undefined,
            researchInteractionLock: false,
            researchSheet: undefined,
            researchExpandedGoalIds: new Set([goalId]),
            refreshResearchGoals: async () => undefined,
            renderSubtitle: () => undefined,
            renderList: () => undefined,
        } satisfies MobileProjectsHubResearchHost;
        return { ui: new MobileProjectsHubResearchUi(host), host };
    }

    it('renders full hypothesis in expanded round body without snippet truncation', () => {
        const goal = normalizeResearchGoal({
            id: 'g1',
            cwd: '/tmp/my-repo',
            description: 'Tune learning rate for stable convergence on the validation set',
            metrics: [baseMetric],
            createdAt: 1000,
            startedAt: 1000,
            finishedAt: 61_000,
            status: 'completed',
            terminationReason: 'reached-target',
        });
        const record: ResearchExperimentRecord = {
            id: 'r1',
            goalId: 'g1',
            round: 1,
            startedAt: 0,
            hypothesis: longHypothesis,
            symptom: 'Loss spikes during the first epoch when lr is too high',
            lever: 'learning_rate',
            notes: 'Used cosine decay after warmup',
            declaredConfig: { learning_rate: 0.001 },
            declaredConfigFingerprint: 'fp',
            realChangeFingerprint: 'rfp',
            phase: 'done',
            metrics: [{ name: 'loss', value: 0.35, direction: 'min' }],
            verdict: 'improved',
            sha: 'abc123',
        };
        const { ui } = createUiWithExpanded('g1', [record], 0.35);
        const row = ui.createResearchRow(goal);

        expect(row.classList.contains('theia-mod-expanded')).to.be.true;
        expect(row.querySelector('.theia-mobile-hub-research-chevron')).to.not.equal(null);

        const description = row.querySelector('.theia-mobile-hub-research-detail-description');
        expect(description?.textContent).to.equal(goal.description);
        expect(description?.textContent).to.not.include('…');

        const round = ui.createResearchRoundDetails(record);
        const fieldValues = [...round.querySelectorAll('.theia-mobile-hub-research-detail-field-value')]
            .map(el => el.textContent);
        expect(fieldValues.some(value => value === longHypothesis)).to.be.true;
        expect(fieldValues.every(value => !value?.includes('…'))).to.be.true;

        const configValue = round.querySelector('.theia-mobile-hub-research-detail-field-value.theia-mod-pre');
        expect(configValue?.textContent).to.include('"learning_rate"');
        expect(configValue?.textContent).to.include('0.001');
    });

    it('shows no rounds yet when expanded with empty ledger', () => {
        const goal = normalizeResearchGoal({
            id: 'g2',
            cwd: '/tmp/my-repo',
            description: 'Explore batch size',
            metrics: [baseMetric],
            createdAt: 1000,
            startedAt: 1000,
            status: 'running',
        });
        const { ui } = createUiWithExpanded('g2', []);
        const row = ui.createResearchRow(goal);
        const empty = row.querySelector('.theia-mobile-hub-research-detail-empty');
        expect(empty?.textContent).to.match(/No rounds yet/i);
    });

    it('filters preflight records from round accordion', () => {
        const preflight: ResearchExperimentRecord = {
            id: 'r0',
            goalId: 'g1',
            round: 0,
            startedAt: 0,
            hypothesis: 'Preflight probe',
            declaredConfig: {},
            declaredConfigFingerprint: 'fp',
            realChangeFingerprint: 'rfp',
            phase: 'done',
            metrics: [],
            preflight: true,
        };
        const experiment: ResearchExperimentRecord = {
            id: 'r1',
            goalId: 'g1',
            round: 1,
            startedAt: 1,
            hypothesis: longHypothesis,
            declaredConfig: {},
            declaredConfigFingerprint: 'fp2',
            realChangeFingerprint: 'rfp2',
            phase: 'done',
            metrics: [{ name: 'loss', value: 0.5, direction: 'min' }],
            verdict: 'improved',
        };
        const { ui } = createUiWithExpanded('g1', [preflight, experiment]);
        const rounds = ui.experimentRecordsForDisplay([preflight, experiment]);
        expect(rounds).to.have.length(1);
        expect(rounds[0].round).to.equal(1);
    });
});
