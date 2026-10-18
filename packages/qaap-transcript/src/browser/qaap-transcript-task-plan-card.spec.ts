// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import type { QaapAgentConversationDTO } from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';
import type { QaapTaskPlan, QaapTaskPlanEditRequest } from '@theia/qaap-shared-core/lib/common/qaap-task-plan';
import {
    buildTaskPlanEditRequest,
    formatTaskPlanAutoRunCountdown,
    resolveTaskPlanAutoRunSeconds,
    syncTranscriptTaskPlanCard,
    TRANSCRIPT_TASK_PLAN_CARD_CLASS,
    type TranscriptTaskPlanCardApi,
    type TranscriptTaskPlanCardDeps,
} from './qaap-transcript-task-plan-card';

const NOW = 1_000_000;

function plan(overrides: Partial<QaapTaskPlan> = {}): QaapTaskPlan {
    return {
        id: 'plan-1',
        state: 'awaiting-approval',
        summary: 'Split into API and UI.',
        subtasks: [
            { id: 's1', title: 'API', prompt: 'Add the route', state: 'pending' },
            { id: 's2', title: 'UI', prompt: 'Add the card', state: 'pending' },
        ],
        autoRun: true,
        autoRunAt: NOW + 40_000,
        createdAt: 1,
        updatedAt: 1,
        ...overrides,
    };
}

function conversation(taskPlan: QaapTaskPlan): QaapAgentConversationDTO {
    return { id: 'parent', cwd: '/repo', agentId: 'qaiq', title: 'Task', status: 'idle', createdAt: 1, updatedAt: 2, messages: [], taskPlan };
}

interface RecordingApi extends TranscriptTaskPlanCardApi {
    readonly calls: Array<{ readonly action: string; readonly body?: QaapTaskPlanEditRequest }>;
}

function recordingApi(result: (action: string) => QaapTaskPlan = () => plan()): RecordingApi {
    const calls: Array<{ action: string; body?: QaapTaskPlanEditRequest }> = [];
    return {
        calls,
        edit: async (_id, body) => { calls.push({ action: 'edit', body }); return conversation(result('edit')); },
        run: async () => { calls.push({ action: 'run' }); return conversation(result('run')); },
        runSingle: async () => { calls.push({ action: 'runSingle' }); return conversation(result('runSingle')); },
        cancel: async () => { calls.push({ action: 'cancel' }); return conversation(result('cancel')); },
    };
}

const settle = (ms = 10): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

describe('syncTranscriptTaskPlanCard', () => {

    let disableJSDOM: (() => void) | undefined;
    let chatHost: HTMLElement;
    let opened: string[];
    let api: RecordingApi;

    before(() => {
        disableJSDOM = enableJSDOM();
    });

    after(() => {
        disableJSDOM?.();
        disableJSDOM = undefined;
    });

    beforeEach(() => {
        chatHost = document.createElement('div');
        chatHost.className = 'theia-mobile-agent-transcript-real-chat';
        const list = document.createElement('div');
        list.className = 'theia-mobile-agent-transcript';
        chatHost.append(list);
        document.body.append(chatHost);
        opened = [];
        api = recordingApi();
    });

    afterEach(() => {
        // Disposes the card's timers (countdown, debounce).
        syncTranscriptTaskPlanCard(chatHost, undefined, deps());
        chatHost.remove();
    });

    function deps(): TranscriptTaskPlanCardDeps {
        return { openConversation: id => opened.push(id), api, now: () => NOW, editDebounceMs: 1 };
    }

    function card(): HTMLElement | null {
        return chatHost.querySelector(`:scope > .${TRANSCRIPT_TASK_PLAN_CARD_CLASS}`);
    }

    function button(selector: string): HTMLButtonElement {
        const element = card()?.querySelector<HTMLButtonElement>(selector);
        expect(element, selector).to.not.equal(null);
        return element!;
    }

    it('mounts after the message list and shows the drafting status', () => {
        syncTranscriptTaskPlanCard(chatHost, { id: 'parent', taskPlan: plan({ state: 'drafting' }) }, deps());
        expect(chatHost.lastElementChild).to.equal(card());
        expect(card()?.textContent).to.contain('Planning subtasks…');
    });

    it('renders editable rows, the countdown and the three actions while awaiting approval', () => {
        syncTranscriptTaskPlanCard(chatHost, { id: 'parent', taskPlan: plan() }, deps());
        const titles = Array.from(card()!.querySelectorAll<HTMLInputElement>('input')).map(input => input.value);
        expect(titles).to.deep.equal(['API', 'UI']);
        expect(card()!.querySelectorAll('textarea').length).to.equal(2);
        expect(card()!.textContent).to.contain('Split into API and UI.');
        expect(card()!.textContent).to.contain('Runs automatically in 40s');
        expect(button('.theia-mod-primary').textContent).to.equal('Run');
        expect(button('.theia-mod-secondary').textContent).to.equal('Run as one task');
        expect(button('.theia-mod-tertiary').textContent).to.equal('Cancel');
    });

    it('disarms auto-run at once on the first edit, then sends the full list as one debounced PATCH', async () => {
        syncTranscriptTaskPlanCard(chatHost, { id: 'parent', taskPlan: plan() }, deps());
        const title = card()!.querySelector<HTMLInputElement>('input')!;
        title.value = 'API routes';
        title.dispatchEvent(new window.Event('input'));
        // Sent without waiting for the debounce, so the server timer cannot start the unedited plan.
        expect(api.calls).to.deep.equal([{
            action: 'edit',
            body: { subtasks: [{ id: 's1', title: 'API routes', prompt: 'Add the route' }, { id: 's2', title: 'UI', prompt: 'Add the card' }], autoRun: false },
        }]);
        title.value = 'API routes v2';
        title.dispatchEvent(new window.Event('input'));
        await settle();
        expect(api.calls.slice(1)).to.deep.equal([{
            action: 'edit',
            body: { subtasks: [{ id: 's1', title: 'API routes v2', prompt: 'Add the route' }, { id: 's2', title: 'UI', prompt: 'Add the card' }] },
        }]);
    });

    it('adds and removes rows within the limits and PATCHes the remaining ones', async () => {
        syncTranscriptTaskPlanCard(chatHost, { id: 'parent', taskPlan: plan() }, deps());
        button('.theia-mod-add').click();
        expect(card()!.querySelectorAll('li').length).to.equal(3);
        const removes = card()!.querySelectorAll<HTMLButtonElement>(`.${TRANSCRIPT_TASK_PLAN_CARD_CLASS}-remove`);
        removes[0].click();
        await settle();
        // The blank new row is left out of the body.
        expect(api.calls.at(-1)).to.deep.equal({ action: 'edit', body: { subtasks: [{ id: 's2', title: 'UI', prompt: 'Add the card' }] } });
    });

    it("turns auto-run off with the current list from Don't auto-run", async () => {
        syncTranscriptTaskPlanCard(chatHost, { id: 'parent', taskPlan: plan() }, deps());
        button('.theia-mod-link').click();
        await settle();
        expect(api.calls[0].body).to.deep.equal({
            subtasks: [{ id: 's1', title: 'API', prompt: 'Add the route' }, { id: 's2', title: 'UI', prompt: 'Add the card' }],
            autoRun: false,
        });
    });

    it('saves a pending edit before Run', async () => {
        api = recordingApi(action => action === 'run' ? plan({ state: 'running', autoRun: false }) : plan());
        syncTranscriptTaskPlanCard(chatHost, { id: 'parent', taskPlan: plan() }, { ...deps(), editDebounceMs: 10_000 });
        const prompt = card()!.querySelector<HTMLTextAreaElement>('textarea')!;
        prompt.value = 'Add the route and its test';
        prompt.dispatchEvent(new window.Event('input'));
        button('.theia-mod-primary').click();
        await settle();
        // The immediate auto-run disarm, the pending content edit, then Run.
        expect(api.calls.map(call => call.action)).to.deep.equal(['edit', 'edit', 'run']);
        expect(api.calls[0].body?.autoRun).to.equal(false);
        expect(card()?.dataset.taskPlanState).to.equal('running');
    });

    it('keeps the field being edited when a new summary arrives', () => {
        syncTranscriptTaskPlanCard(chatHost, { id: 'parent', taskPlan: plan() }, deps());
        const title = card()!.querySelector<HTMLInputElement>('input')!;
        title.focus();
        title.value = 'Typing';
        title.dispatchEvent(new window.Event('input'));
        syncTranscriptTaskPlanCard(chatHost, { id: 'parent', taskPlan: plan({ subtasks: [{ id: 's1', title: 'Server', prompt: 'x', state: 'pending' }] }) }, deps());
        expect(card()!.querySelector('input')).to.equal(title);
        expect(title.value).to.equal('Typing');
    });

    it('shows an inline error when a request fails', async () => {
        api = { ...recordingApi(), run: async () => { throw new Error('Plan is not awaiting approval'); } };
        syncTranscriptTaskPlanCard(chatHost, { id: 'parent', taskPlan: plan() }, deps());
        button('.theia-mod-primary').click();
        await settle();
        const error = card()!.querySelector<HTMLElement>(`.${TRANSCRIPT_TASK_PLAN_CARD_CLASS}-error`)!;
        expect(error.hidden).to.equal(false);
        expect(error.textContent).to.equal('Plan is not awaiting approval');
        expect(button('.theia-mod-primary').disabled).to.equal(false);
    });

    it('lists running subtasks with state chips and opens a child conversation on tap', () => {
        syncTranscriptTaskPlanCard(chatHost, {
            id: 'parent',
            taskPlan: plan({
                state: 'running',
                subtasks: [
                    { id: 's1', title: 'API', prompt: 'p', state: 'done', conversationId: 'child-1' },
                    { id: 's2', title: 'UI', prompt: 'p', state: 'running', conversationId: 'child-2', conflict: true },
                    { id: 's3', title: 'Docs', prompt: 'p', state: 'pending' },
                ],
            }),
        }, deps());
        expect(card()!.textContent).to.contain('Subtasks 1/3');
        const rows = card()!.querySelectorAll<HTMLElement>(`.${TRANSCRIPT_TASK_PLAN_CARD_CLASS}-row-main`);
        expect(rows[1].querySelector('.theia-mod-conflict')?.textContent).to.equal('Conflict');
        expect(rows[1].querySelector('.theia-mod-running')?.textContent).to.equal('Running');
        expect(rows[2].tagName).to.equal('DIV');
        (rows[1] as HTMLButtonElement).click();
        expect(opened).to.deep.equal(['child-2']);
        expect(button('.theia-mod-tertiary').textContent).to.equal('Cancel');
    });

    it('shows integrating, then a compact terminal line, and removes the card for single', () => {
        syncTranscriptTaskPlanCard(chatHost, { id: 'parent', taskPlan: plan({ state: 'integrating' }) }, deps());
        expect(card()!.textContent).to.contain('Integrating results…');
        syncTranscriptTaskPlanCard(chatHost, { id: 'parent', taskPlan: plan({ state: 'failed', error: 'Merge failed' }) }, deps());
        expect(card()!.textContent).to.equal('Plan failed: Merge failed');
        syncTranscriptTaskPlanCard(chatHost, { id: 'parent', taskPlan: plan({ state: 'single' }) }, deps());
        expect(card()).to.equal(null);
    });
});

describe('task plan card helpers', () => {

    it('counts the auto-run down in whole seconds and never below zero', () => {
        expect(resolveTaskPlanAutoRunSeconds({ autoRun: true, autoRunAt: NOW + 39_001 }, NOW)).to.equal(40);
        expect(resolveTaskPlanAutoRunSeconds({ autoRun: true, autoRunAt: NOW - 5 }, NOW)).to.equal(0);
        expect(resolveTaskPlanAutoRunSeconds({ autoRun: false, autoRunAt: NOW + 1000 }, NOW)).to.equal(undefined);
        expect(formatTaskPlanAutoRunCountdown(12)).to.equal('Runs automatically in 12s');
    });

    it('builds the PATCH body from trimmed rows, keeping ids', () => {
        expect(buildTaskPlanEditRequest([
            { id: 's1', title: ' A ', prompt: 'do a' },
            { title: '', prompt: '  ' },
            { title: 'B', prompt: '' },
        ], { autoRun: false })).to.deep.equal({ subtasks: [{ id: 's1', title: 'A', prompt: 'do a' }, { title: 'B', prompt: '' }], autoRun: false });
    });
});
