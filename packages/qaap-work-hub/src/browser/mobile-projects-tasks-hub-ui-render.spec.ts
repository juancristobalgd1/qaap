// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

// Modules below may touch the DOM while loading; it is removed again after the imports
// so no suite depends on another spec file leaving jsdom behind.
const disableImportJSDOM = enableJSDOM();

import { expect } from 'chai';
import type { MobileProjectsTasksHubUiContext } from './mobile-projects-tasks-hub-ui-context';
import { applyComposerQuickActionPromptExtracted, createAgentsHubQuickActionsBlockExtracted } from './mobile-projects-tasks-hub-ui-render';
import { useSuiteJSDOM } from '@theia/qaap-mobile-shell/lib/browser/test/qaap-jsdom-suite';
import { MobileSnackbar } from '@theia/qaap-mobile-shell/lib/browser/mobile-snackbar';
import { QAAP_AGENTS_HUB_QUICK_ACTIONS } from '@theia/qaap-shared-core/lib/common/qaap-agents-hub-landing';

disableImportJSDOM();

describe('mobile-projects-tasks-hub-ui-render', () => {

    useSuiteJSDOM();

    it('turns Run app into a busy colored action immediately when pressed', () => {
        let launched = false;
        const block = createAgentsHubQuickActionsBlockExtracted({
            host: {
                transcriptPreviewRequestRunning: false,
                transcriptPreviewRequestPending: false,
                transcriptOpenProject: { id: 'project' },
                transcriptComposerProject: undefined,
                transcriptOpenSummary: { id: 'summary' },
                transcriptComposerSummary: undefined,
                transcriptStickyComposerUi: {
                    launchComposerDevPreview: () => { launched = true; },
                },
            },
            applyComposerQuickActionPrompt: () => undefined,
        } as unknown as MobileProjectsTasksHubUiContext);
        const runApp = Array.from(block.querySelectorAll<HTMLButtonElement>('button')).find(button =>
            button.textContent?.trim() === 'Run app');

        expect(runApp).to.not.equal(undefined);
        runApp?.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));

        expect(launched).to.equal(true);
        expect(runApp?.textContent).to.include('Starting preview…');
        expect(runApp?.disabled).to.equal(true);
        expect(runApp?.classList.contains('theia-mod-preview-starting')).to.equal(true);
        expect(runApp?.getAttribute('aria-busy')).to.equal('true');
        expect(runApp?.querySelector('.codicon-loading')).to.not.equal(null);
        expect(runApp?.querySelector('.qaap-border-beam-bloom')).to.not.equal(null);
    });

    it('runs from the empty project landing without a task summary, then releases the busy action', async () => {
        let launched = false;
        const block = createAgentsHubQuickActionsBlockExtracted({
            host: {
                transcriptPreviewRequestRunning: false,
                transcriptPreviewRequestPending: false,
                transcriptOpenProject: { id: 'project' },
                transcriptComposerProject: undefined,
                transcriptOpenSummary: undefined,
                transcriptComposerSummary: undefined,
                transcriptStickyComposerUi: {
                    launchComposerDevPreview: (_project: unknown, summary: unknown) => {
                        launched = true;
                        expect(summary).to.equal(undefined);
                        return Promise.resolve();
                    },
                },
            },
            applyComposerQuickActionPrompt: () => undefined,
        } as unknown as MobileProjectsTasksHubUiContext);
        const runApp = Array.from(block.querySelectorAll<HTMLButtonElement>('button')).find(button =>
            button.textContent?.trim() === 'Run app');

        document.body.append(block);
        runApp?.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
        await Promise.resolve();

        expect(launched).to.equal(true);
        expect(runApp?.disabled).to.equal(false);
        expect(runApp?.textContent).to.include('Run app');
        expect(runApp?.classList.contains('theia-mod-preview-starting')).to.equal(false);
        block.remove();
    });

    it('renders Run app as a busy action while preview startup is pending', () => {
        const block = createAgentsHubQuickActionsBlockExtracted({
            host: {
                transcriptPreviewRequestRunning: true,
                transcriptPreviewRequestPending: false,
                transcriptOpenProject: undefined,
                transcriptComposerProject: undefined,
            },
            applyComposerQuickActionPrompt: () => undefined,
        } as unknown as MobileProjectsTasksHubUiContext);
        const runApp = Array.from(block.querySelectorAll('button')).find(button =>
            button.textContent?.includes('Starting preview…'));

        expect(runApp).to.not.equal(undefined);
        expect(runApp?.disabled).to.equal(true);
        expect(runApp?.classList.contains('theia-mod-preview-starting')).to.equal(true);
        expect(runApp?.getAttribute('aria-busy')).to.equal('true');
        expect(runApp?.querySelector('.codicon-loading')).to.not.equal(null);
        expect(runApp?.querySelector('.qaap-border-beam-bloom')).to.not.equal(null);
    });
    it('inserts a quick-action prompt like typing: input event, caret at end, scroll at the start', () => {
        const host = document.createElement('div');
        host.className = 'theia-mobile-projects-sticky-composer';
        const input = document.createElement('textarea');
        input.className = 'theia-mobile-projects-sticky-composer-input';
        host.append(input);
        document.body.append(host);
        const previousRaf = window.requestAnimationFrame;
        window.requestAnimationFrame = (callback: FrameRequestCallback): number => {
            callback(0);
            return 0;
        };
        const inputEvents: string[] = [];
        input.addEventListener('input', () => inputEvents.push(input.value));
        const stickyComposerHost = host;
        const context = {
            host: {
                transcriptComposerHost: undefined,
                stickyComposerHost,
                stickyComposerDraft: '',
                stickyComposerRenderUi: {
                    renderStickyComposer: () => {
                        input.value = context.host.stickyComposerDraft;
                    },
                },
            },
        } as unknown as MobileProjectsTasksHubUiContext;
        const prompt = 'Find and fix a bug in this project.';

        try {
            applyComposerQuickActionPromptExtracted(context, `  ${prompt}  `);

            expect(context.host.stickyComposerDraft).to.equal(prompt);
            expect(input.value).to.equal(prompt);
            expect(inputEvents).to.deep.equal([prompt]);
            expect(input.selectionStart).to.equal(prompt.length);
            expect(input.selectionEnd).to.equal(prompt.length);
            expect(input.scrollTop).to.equal(0);
        } finally {
            window.requestAnimationFrame = previousRaf;
            host.remove();
        }
    });

    describe('quick-action prompt replacement', () => {

        type ShowCall = { message: string; options: MobileSnackbar.ShowOptions };

        /**
         * Mounted sticky composer. Like the real one, its input listener persists the draft to a store, and a
         * re-render reads that store before the in-memory draft, so a stale persisted draft would win.
         */
        function mountStickyComposer(): { host: HTMLElement; input: HTMLTextAreaElement; context: MobileProjectsTasksHubUiContext } {
            const host = document.createElement('div');
            host.className = 'theia-mobile-projects-sticky-composer';
            const input = document.createElement('textarea');
            input.className = 'theia-mobile-projects-sticky-composer-input';
            host.append(input);
            document.body.append(host);
            const persisted = { draft: '' };
            const context = {
                host: {
                    transcriptComposerHost: undefined,
                    stickyComposerHost: host,
                    stickyComposerDraft: '',
                    stickyComposerRenderUi: {
                        renderStickyComposer: () => {
                            input.value = persisted.draft || context.host.stickyComposerDraft;
                        },
                    },
                },
            } as unknown as MobileProjectsTasksHubUiContext;
            input.addEventListener('input', () => {
                context.host.stickyComposerDraft = input.value;
                persisted.draft = input.value;
            });
            return { host, input, context };
        }

        /** Captures snackbar calls without rendering them. */
        function captureSnackbar(run: (shown: ShowCall[]) => void): void {
            const api = MobileSnackbar as { show: typeof MobileSnackbar.show };
            const originalShow = api.show;
            const shown: ShowCall[] = [];
            api.show = (message: string, options: MobileSnackbar.ShowOptions = {}): void => {
                shown.push({ message, options });
            };
            try {
                run(shown);
            } finally {
                api.show = originalShow;
            }
        }

        const [firstAction, secondAction] = QAAP_AGENTS_HUB_QUICK_ACTIONS;

        it('replaces the prompt of a previously inserted chip with the next chip prompt', () => {
            const { host, input, context } = mountStickyComposer();
            try {
                captureSnackbar(shown => {
                    applyComposerQuickActionPromptExtracted(context, firstAction.promptDefault);
                    expect(input.value).to.equal(firstAction.promptDefault);

                    applyComposerQuickActionPromptExtracted(context, secondAction.promptDefault);

                    expect(input.value).to.equal(secondAction.promptDefault);
                    expect(context.host.stickyComposerDraft).to.equal(secondAction.promptDefault);
                    expect(shown).to.deep.equal([]);
                });
            } finally {
                host.remove();
            }
        });

        it('inserts into an empty composer without a snackbar', () => {
            const { host, input, context } = mountStickyComposer();
            try {
                captureSnackbar(shown => {
                    applyComposerQuickActionPromptExtracted(context, secondAction.promptDefault);

                    expect(input.value).to.equal(secondAction.promptDefault);
                    expect(shown).to.deep.equal([]);
                });
            } finally {
                host.remove();
            }
        });

        it('replaces user-edited text, offers Undo, and restores the previous text on Undo', () => {
            const { host, input, context } = mountStickyComposer();
            const typed = 'My own notes, not a suggestion';
            input.value = typed;
            input.dispatchEvent(new window.Event('input', { bubbles: true }));
            try {
                captureSnackbar(shown => {
                    applyComposerQuickActionPromptExtracted(context, firstAction.promptDefault);

                    expect(input.value).to.equal(firstAction.promptDefault);
                    expect(shown).to.have.length(1);
                    expect(shown[0].options.actionLabel).to.equal('Undo');
                    expect(shown[0].message).to.equal('Prompt replaced');

                    shown[0].options.onAction?.();

                    expect(input.value).to.equal(typed);
                    expect(context.host.stickyComposerDraft).to.equal(typed);
                });
            } finally {
                host.remove();
            }
        });
    });
});
