// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    ComposerPromptImproveTimeoutError,
    isComposerPromptImproveTimeout,
} from '../common/qaap-composer-prompt-improve';
import { QaapComposerPromptImprover } from './qaap-composer-prompt-improver';
import { createStickyComposerImprovePromptHandler } from './qaap-composer-prompt-improve-handler';

describe('Qaap composer prompt improvement', () => {

    function createContext(prompt: string): {
        readonly context: Parameters<ReturnType<typeof createStickyComposerImprovePromptHandler>>[0];
        readonly input: HTMLTextAreaElement;
        readonly panel: HTMLElement;
    } {
        const panel = document.createElement('div');
        panel.className = 'theia-mobile-projects-sticky-composer-input-panel';
        const input = document.createElement('textarea');
        input.value = prompt;
        const improveBtn = document.createElement('button');
        panel.append(input, improveBtn);
        document.body.appendChild(panel);
        return {
            panel,
            input,
            context: {
                input,
                improveBtn,
                getPrompt: () => input.value,
                setDraft: value => { input.value = value; },
                refreshControls: () => undefined,
            },
        };
    }

    it('shows the before and after prompts for acceptance, then applies only an accepted result', async () => {
        const previousMatchMedia = window.matchMedia;
        window.matchMedia = () => ({ matches: true } as MediaQueryList);
        const { context, input } = createContext('write a test');
        let resolveConfirmation: (accepted: boolean) => void = () => undefined;
        let resolveCompared: () => void = () => undefined;
        let compared: [string, string] | undefined;
        const comparisonReady = new Promise<void>(resolve => { resolveCompared = resolve; });
        const handler = createStickyComposerImprovePromptHandler({
            improver: { improve: async () => 'write a focused test' } as unknown as QaapComposerPromptImprover,
            resolveAgentId: () => 'qaiq',
            resolveAgentModel: () => undefined,
            confirmImprovedPrompt: (before, after) => {
                compared = [before, after];
                resolveCompared();
                return new Promise(resolve => { resolveConfirmation = resolve; });
            },
        });

        try {
            handler(context);
            await comparisonReady;
            expect(compared).to.deep.equal(['write a test', 'write a focused test']);
            expect(input.value).to.equal('write a test');
            resolveConfirmation(true);
            await new Promise(resolve => window.setTimeout(resolve, 0));
            expect(input.value).to.equal('write a focused test');
        } finally {
            window.matchMedia = previousMatchMedia;
            context.input.closest('.theia-mobile-projects-sticky-composer-input-panel')?.remove();
        }
    });

    it('surfaces timeout errors and always clears the busy state', async () => {
        document.body.classList.add('theia-mobile-mod-workhub-no-bottom-chrome');
        const { context, panel } = createContext('write a test');
        const handler = createStickyComposerImprovePromptHandler({
            improver: { improve: async () => { throw new ComposerPromptImproveTimeoutError(); } } as unknown as QaapComposerPromptImprover,
            resolveAgentId: () => 'qaiq',
            resolveAgentModel: () => undefined,
        });

        try {
            handler(context);
            await new Promise(resolve => window.setTimeout(resolve, 0));
            const feedback = panel.querySelector<HTMLElement>('.qaap-composer-improve-feedback');
            expect(feedback?.textContent).to.contain('timed out');
            expect(context.improveBtn.classList.contains('theia-mod-busy')).to.equal(false);
        } finally {
            document.body.classList.remove('theia-mobile-mod-workhub-no-bottom-chrome');
            panel.remove();
        }
    });

    it('rejects a backend operation that does not respond before the client timeout', async () => {
        class NeverRespondsPromptImprover extends QaapComposerPromptImprover {
            protected override getTimeoutMs(): number {
                return 1;
            }

            protected override async tryImproveViaBackend(): Promise<string | undefined> {
                return new Promise(() => undefined);
            }
        }

        let failure: unknown;
        try {
            await new NeverRespondsPromptImprover().improve({ prompt: 'prompt', agentId: 'qaiq' });
        } catch (error) {
            failure = error;
        }
        expect(isComposerPromptImproveTimeout(failure)).to.equal(true);
    });
});
