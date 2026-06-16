// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import type { QaapAgentModelSelection } from '../common/qaap-agent-model-selection';
import { isComposerPromptImproveCancelled } from '../common/qaap-composer-prompt-improve';
import { animateComposerPromptReplace } from './qaap-composer-prompt-reveal';
import type { QaapComposerPromptImprover } from './qaap-composer-prompt-improver';
import {
    clearComposerImproveFeedback,
    showComposerImproveFeedback,
} from './qaap-composer-prompt-improve-feedback';
import { MobileSnackbar } from './mobile-snackbar';

export interface StickyComposerImprovePromptContext {
    readonly input: HTMLTextAreaElement;
    readonly improveBtn: HTMLButtonElement;
    readonly getPrompt: () => string;
    readonly setDraft: (value: string) => void;
    readonly refreshControls: () => void;
}

export interface StickyComposerImprovePromptOptions {
    readonly improver?: QaapComposerPromptImprover;
    readonly resolveAgentId: () => string;
    readonly resolveAgentModel: () => QaapAgentModelSelection | undefined;
    readonly resolveCwd?: () => string | undefined;
}

interface ActiveComposerImproveRun {
    readonly runId: number;
    readonly promptSnapshot: string;
    readonly animationAbort: AbortController;
}

function workHubSnackbarHidden(): boolean {
    return typeof document !== 'undefined'
        && (document.body.classList.contains('theia-mobile-mod-workhub-composer-header')
            || document.body.classList.contains('theia-mobile-mod-workhub-no-bottom-chrome')
            || document.body.classList.contains('theia-mobile-mod-landing'));
}

function notifyImproveFailure(anchor: HTMLElement, message: string): void {
    if (workHubSnackbarHidden()) {
        showComposerImproveFeedback(anchor, message, 'error');
        return;
    }
    MobileSnackbar.show(message, { duration: 2800, kind: 'warning' });
}

function resetImproveButton(context: StickyComposerImprovePromptContext): void {
    context.improveBtn.classList.remove('theia-mod-busy');
    context.input.classList.remove('qaap-composer-prompt-morphing');
}

function restoreComposerPromptAfterCancel(
    context: StickyComposerImprovePromptContext,
    promptSnapshot: string,
): void {
    context.input.value = promptSnapshot;
    context.setDraft(promptSnapshot);
}

export function createStickyComposerImprovePromptHandler(
    options: StickyComposerImprovePromptOptions,
): (context: StickyComposerImprovePromptContext) => void {
    let generation = 0;
    let activeRun: ActiveComposerImproveRun | undefined;

    const cancelActiveRun = (context: StickyComposerImprovePromptContext): void => {
        if (!activeRun) {
            return;
        }
        const { promptSnapshot, animationAbort } = activeRun;
        generation += 1;
        activeRun = undefined;
        animationAbort.abort();
        options.improver?.cancelActive();
        resetImproveButton(context);
        restoreComposerPromptAfterCancel(context, promptSnapshot);
        clearComposerImproveFeedback(context.improveBtn);
        context.refreshControls();
    };

    return context => {
        if (activeRun) {
            cancelActiveRun(context);
            return;
        }
        const runId = ++generation;
        void runStickyComposerImprovePrompt(
            options,
            context,
            runId,
            () => generation,
            run => {
                activeRun = run;
            },
            () => {
                if (activeRun?.runId === runId) {
                    activeRun = undefined;
                }
            },
        );
    };
}

async function runStickyComposerImprovePrompt(
    options: StickyComposerImprovePromptOptions,
    context: StickyComposerImprovePromptContext,
    runId: number,
    getLatestGeneration: () => number,
    setActiveRun: (run: ActiveComposerImproveRun) => void,
    clearActiveRun: () => void,
): Promise<void> {
    const prompt = context.getPrompt().trim();
    if (!prompt) {
        notifyImproveFailure(
            context.improveBtn,
            nls.localize('qaap/composer/improvePromptEmpty', 'Write a prompt before improving it.'),
        );
        return;
    }
    if (!options.improver) {
        notifyImproveFailure(
            context.improveBtn,
            nls.localize('qaap/composer/improvePromptUnavailable', 'Prompt improvement is unavailable.'),
        );
        return;
    }

    const promptSnapshot = context.getPrompt();
    const animationAbort = new AbortController();
    setActiveRun({ runId, promptSnapshot, animationAbort });

    clearComposerImproveFeedback(context.improveBtn);
    context.improveBtn.classList.add('theia-mod-busy');
    context.refreshControls();

    const isRunCancelled = (): boolean => runId !== getLatestGeneration();

    try {
        const improved = await options.improver.improve({
            prompt,
            agentId: options.resolveAgentId(),
            agentModel: options.resolveAgentModel(),
            cwd: options.resolveCwd?.(),
        });
        if (isRunCancelled()) {
            return;
        }
        clearComposerImproveFeedback(context.improveBtn);
        await animateComposerPromptReplace(context.input, improved, {
            signal: animationAbort.signal,
            onProgress: value => {
                if (isRunCancelled() || animationAbort.signal.aborted) {
                    return;
                }
                context.setDraft(value);
            },
        });
        if (isRunCancelled() || animationAbort.signal.aborted) {
            restoreComposerPromptAfterCancel(context, promptSnapshot);
            return;
        }
        context.setDraft(improved);
        context.refreshControls();
    } catch (error) {
        if (isComposerPromptImproveCancelled(error) || isRunCancelled() || animationAbort.signal.aborted) {
            restoreComposerPromptAfterCancel(context, promptSnapshot);
            return;
        }
        const message = error instanceof Error && error.message.trim()
            ? error.message.trim()
            : nls.localize('qaap/composer/improvePromptFailed', 'Could not improve the prompt. Try again.');
        notifyImproveFailure(context.improveBtn, message);
    } finally {
        resetImproveButton(context);
        clearActiveRun();
        if (runId === getLatestGeneration()) {
            context.refreshControls();
        }
    }
}
