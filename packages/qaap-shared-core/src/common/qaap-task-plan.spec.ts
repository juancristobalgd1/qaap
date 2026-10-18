// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QAAP_TASK_PLAN_MAX_SUBTASKS, QaapTaskPlan } from './qaap-task-plan';

describe('QaapTaskPlan', () => {

    describe('parse', () => {
        it('reads the last fenced qaap-plan block', () => {
            const text = [
                'Here is the plan.',
                '```qaap-plan',
                '{"summary": "old", "subtasks": [{"title": "Stale", "prompt": "x"}]}',
                '```',
                'Revised:',
                '```qaap-plan',
                '{"summary": "Add two modules", "subtasks": [{"title": "Module a", "prompt": "Create a.ts"}, {"title": "Module b", "description": "Create b.ts"}]}',
                '```',
            ].join('\n');
            expect(QaapTaskPlan.parse(text)).to.deep.equal({
                summary: 'Add two modules',
                subtasks: [{ title: 'Module a', prompt: 'Create a.ts' }, { title: 'Module b', prompt: 'Create b.ts' }],
            });
        });

        it('falls back to the numbered list of a Markdown plan', () => {
            const draft = QaapTaskPlan.parse('## Steps\n1. **API** — add the endpoint\n2. **UI**: render the list\nSome prose.');
            expect(draft?.subtasks).to.deep.equal([
                { title: 'API', prompt: 'add the endpoint' },
                { title: 'UI', prompt: 'render the list' },
            ]);
        });

        it('returns undefined without a plan and for broken JSON without a list', () => {
            expect(QaapTaskPlan.parse('Nothing to plan here.')).to.equal(undefined);
            expect(QaapTaskPlan.parse('```qaap-plan\n{not json\n```')).to.equal(undefined);
        });

        it('caps the number of subtasks and drops empty rows', () => {
            const subtasks = Array.from({ length: 9 }, (_, index) => ({ title: `T${index}`, prompt: `P${index}` }));
            const draft = QaapTaskPlan.parse('```qaap-plan\n' + JSON.stringify({ subtasks: [{ title: ' ', prompt: '' }, ...subtasks] }) + '\n```');
            expect(draft?.subtasks).to.have.length(QAAP_TASK_PLAN_MAX_SUBTASKS);
            expect(draft?.subtasks[0]).to.deep.equal({ title: 'T0', prompt: 'P0' });
        });
    });

    describe('isMultiStepCandidate', () => {
        it('needs at least three actionable list items', () => {
            expect(QaapTaskPlan.isMultiStepCandidate('Fix the login bug')).to.equal(false);
            expect(QaapTaskPlan.isMultiStepCandidate('- add a.ts\n- add b.ts')).to.equal(false);
            expect(QaapTaskPlan.isMultiStepCandidate('Do this:\n1. add a.ts\n2. add b.ts\n3. update the README')).to.equal(true);
            expect(QaapTaskPlan.isMultiStepCandidate('* one thing\n* two things\n* three things')).to.equal(true);
        });
    });

    describe('progress', () => {
        it('counts failed and cancelled subtasks as settled', () => {
            const plan: QaapTaskPlan = {
                id: 'p', state: 'running', autoRun: false, createdAt: 0, updatedAt: 0,
                subtasks: [
                    { id: 'a', title: 'a', prompt: 'a', state: 'done' },
                    { id: 'b', title: 'b', prompt: 'b', state: 'failed' },
                    { id: 'c', title: 'c', prompt: 'c', state: 'running' },
                    { id: 'd', title: 'd', prompt: 'd', state: 'cancelled' },
                ],
            };
            expect(QaapTaskPlan.progress(plan)).to.deep.equal({ total: 4, settled: 3, done: 1, failed: 2, running: 1 });
            expect(QaapTaskPlan.isActive(plan)).to.equal(true);
            expect(QaapTaskPlan.isActive({ ...plan, state: 'single' })).to.equal(false);
        });
    });
});
