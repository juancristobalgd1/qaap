// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import type {
    QaapWorkflowRunSummary,
    QaapWorkflowTemplateSummary,
} from '../common/qaap-workflow-run-client';
import {
    MobileProjectsHubWorkflowRunsUi,
    type MobileProjectsHubWorkflowRunsHost,
} from './mobile-projects-hub-workflow-runs-ui';
import type { MobileProjectEntry } from './mobile-projects-types';

const TEMPLATE: QaapWorkflowTemplateSummary = {
    id: 'qaap.implement-then-review',
    name: 'Implement, then adversarial review',
    description: 'x',
    requiredInputs: ['task'],
};

function summary(partial: Partial<QaapWorkflowRunSummary['run']>, updatedAt = 1): QaapWorkflowRunSummary {
    return {
        templateId: TEMPLATE.id,
        createdAt: 0,
        updatedAt,
        run: {
            id: partial.id ?? 'r1',
            defId: TEMPLATE.id,
            status: partial.status ?? 'running',
            active: partial.active ?? [],
            visits: partial.visits ?? {},
            bindings: partial.bindings ?? {},
        },
    };
}

/** Client seams stubbed; DOM real (jsdom). */
class TestUi extends MobileProjectsHubWorkflowRunsUi {
    started: { templateId: string; cwd: string; inputs: Record<string, string> }[] = [];
    continued: { runId: string; nodeId: string }[] = [];
    stubbedRuns: readonly QaapWorkflowRunSummary[] = [];

    protected override loadRuns(): Promise<readonly QaapWorkflowRunSummary[]> {
        return Promise.resolve(this.stubbedRuns);
    }
    protected override loadTemplates(): Promise<readonly QaapWorkflowTemplateSummary[]> {
        return Promise.resolve([TEMPLATE]);
    }
    protected override doStartRun(body: { templateId: string; cwd: string; inputs: Record<string, string> }): Promise<unknown> {
        this.started.push(body);
        return Promise.resolve({});
    }
    protected override doContinueRun(runId: string, nodeId: string): Promise<unknown> {
        this.continued.push({ runId, nodeId });
        return Promise.resolve({});
    }
}

describe('MobileProjectsHubWorkflowRunsUi', () => {
    let disableJSDOM: () => void;
    before(() => disableJSDOM = enableJSDOM());
    after(() => disableJSDOM());

    function createUi(runs: readonly QaapWorkflowRunSummary[] = []): { ui: TestUi; host: MobileProjectsHubWorkflowRunsHost; renders: () => number } {
        let renders = 0;
        const project = { id: 'p1', name: 'demo' } as MobileProjectEntry;
        const host: MobileProjectsHubWorkflowRunsHost = {
            query: '',
            scroll: document.createElement('div'),
            projects: [project],
            projectsService: { getProjectCwd: () => '/repo/demo', getCurrentWorkspaceCwd: () => '/repo/demo' },
            messageService: undefined,
            renderList: () => { renders++; },
        };
        const ui = new TestUi(host);
        ui.stubbedRuns = runs;
        return { ui, host, renders: () => renders };
    }

    /** Let the fire-and-forget refresh inside render settle. */
    const settle = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0));

    it('renders a run card with template name and outcome subtitle', async () => {
        const { ui } = createUi([summary({ status: 'succeeded', bindings: { 'review.passed': 'x' } })]);
        ui.renderWorkflowRunsSection();
        await settle();
        const section = ui.renderWorkflowRunsSection();
        expect(section.textContent).to.contain('Implement, then adversarial review');
        expect(section.textContent).to.contain('review passed');
        ui.dispose();
    });

    it('shows the active node while a run is executing', async () => {
        const { ui } = createUi([summary({ status: 'running', active: ['judge'] })]);
        ui.renderWorkflowRunsSection();
        await settle();
        const section = ui.renderWorkflowRunsSection();
        expect(section.textContent).to.contain('judge');
        ui.dispose();
    });

    it('starts a run with the selected project cwd and the typed task', async () => {
        const { ui, renders } = createUi();
        ui.renderWorkflowRunsSection();
        await settle();
        // Open the start form and submit through the DOM.
        const withCard = ui.renderWorkflowRunsSection();
        (withCard.querySelector('.theia-mobile-hub-workflow-start-card') as HTMLButtonElement).click();
        const withForm = ui.renderWorkflowRunsSection();
        (withForm.querySelector('textarea') as HTMLTextAreaElement).value = 'fix the login bug';
        (withForm.querySelector('.theia-button.main') as HTMLButtonElement).click();
        await settle();

        expect(ui.started).to.deep.equal([{
            templateId: 'qaap.implement-then-review',
            cwd: '/repo/demo',
            inputs: { task: 'fix the login bug' },
        }]);
        expect(renders()).to.be.greaterThan(0);
        ui.dispose();
    });

    it('does not start with an empty task', async () => {
        const { ui } = createUi();
        ui.renderWorkflowRunsSection();
        await settle();
        ui.renderWorkflowRunsSection();
        (ui.renderWorkflowRunsSection().querySelector('.theia-mobile-hub-workflow-start-card') as HTMLButtonElement).click();
        const withForm = ui.renderWorkflowRunsSection();
        (withForm.querySelector('.theia-button.main') as HTMLButtonElement).click();
        await settle();
        expect(ui.started).to.deep.equal([]);
        ui.dispose();
    });

    it('offers Continue only on runs parked at a human gate and posts the gate node', async () => {
        const { ui } = createUi([
            summary({ id: 'r-gate', status: 'awaiting-human', active: ['gate'] }),
            summary({ id: 'r-run', status: 'running', active: ['implement'] }, 2),
        ]);
        ui.renderWorkflowRunsSection();
        await settle();
        const section = ui.renderWorkflowRunsSection();
        const buttons = section.querySelectorAll('.theia-mobile-hub-workflow-continue');
        expect(buttons.length).to.equal(1);
        (buttons[0] as HTMLButtonElement).click();
        await settle();
        expect(ui.continued).to.deep.equal([{ runId: 'r-gate', nodeId: 'gate' }]);
        ui.dispose();
    });


    it('falls back to a prefilled cwd input when no project resolves a path', async () => {
        const { ui, host } = createUi();
        host.projectsService.getProjectCwd = () => undefined;
        ui.renderWorkflowRunsSection();
        await settle();
        (ui.renderWorkflowRunsSection().querySelector('.theia-mobile-hub-workflow-start-card') as HTMLButtonElement).click();
        const withForm = ui.renderWorkflowRunsSection();
        expect(withForm.querySelector('select')).to.equal(null);
        const cwd = withForm.querySelector('input') as HTMLInputElement;
        expect(cwd.value).to.equal('/repo/demo');
        (withForm.querySelector('textarea') as HTMLTextAreaElement).value = 'do it';
        (withForm.querySelector('.theia-button.main') as HTMLButtonElement).click();
        await settle();
        expect(ui.started[0]?.cwd).to.equal('/repo/demo');
        ui.dispose();
    });

    it('filters run cards by the hub query', async () => {
        const { ui, host } = createUi([
            summary({ id: 'a', status: 'succeeded', bindings: { 'review.passed': 'x' } }),
            summary({ id: 'b', status: 'failed', bindings: { 'review.failed': 'x' } }, 2),
        ]);
        ui.renderWorkflowRunsSection();
        await settle();
        host.query = 'failed';
        const section = ui.renderWorkflowRunsSection();
        expect(section.querySelectorAll('.theia-mobile-hub-workflow-run-card').length).to.equal(1);
        ui.dispose();
    });
});
