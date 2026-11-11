// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import { ConfirmDialog } from '@theia/core/lib/browser';
import type { QaapAgentModelSelection } from '@theia/qaap-shared-core/lib/common/qaap-agent-model-selection';
import {
    isComposerPromptImproveCancelled,
    isComposerPromptImproveTimeout,
} from '../common/qaap-composer-prompt-improve';
import { animateComposerPromptReplace, finalizeComposerPromptReplace } from './qaap-composer-prompt-reveal';
import type { QaapComposerPromptImprover } from './qaap-composer-prompt-improver';
import {
    clearComposerImproveFeedback,
    showComposerImproveFeedback,
} from './qaap-composer-prompt-improve-feedback';
import { MobileSnackbar } from '@theia/qaap-mobile-shell/lib/browser/mobile-snackbar';

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
    readonly confirmImprovedPrompt?: (before: string, after: string) => Promise<boolean>;
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
    endPromptImproving(context.input);
}

/**
 * The textarea keeps the user's text on screen while the request runs, with a sweep over it. It is read-only
 * meanwhile, so an edit cannot land between the request and the replacement.
 */
function beginPromptImproving(input: HTMLTextAreaElement): void {
    input.readOnly = true;
    input.setAttribute('aria-busy', 'true');
    input.classList.add('qaap-mod-improving-prompt');
}

function endPromptImproving(input: HTMLTextAreaElement): void {
    input.readOnly = false;
    input.removeAttribute('aria-busy');
    input.classList.remove('qaap-mod-improving-prompt');
}

/** A soft fade-in once the improved text is in place; the class is re-armed so every replacement fades. */
function playPromptCrossfadeIn(input: HTMLTextAreaElement): void {
    input.classList.remove('qaap-mod-prompt-crossfade-in');
    // Forces a reflow so the animation restarts when the class is added again.
    input.getBoundingClientRect();
    input.classList.add('qaap-mod-prompt-crossfade-in');
}

function promptChangedWhileImproving(context: StickyComposerImprovePromptContext, promptSnapshot: string): boolean {
    return context.getPrompt() !== promptSnapshot;
}

function notifyPromptChangedWhileImproving(anchor: HTMLElement): void {
    notifyImproveFailure(
        anchor,
        nls.localize(
            'qaap/composer/improvePromptChangedWhileRunning',
            'The prompt changed while it was being improved. Your text was kept.',
        ),
    );
}

function restoreComposerPromptAfterCancel(
    context: StickyComposerImprovePromptContext,
    promptSnapshot: string,
): void {
    finalizeComposerPromptReplace(context.input, promptSnapshot, context.setDraft);
}

async function confirmImprovedPrompt(before: string, after: string): Promise<boolean> {
    const comparison = document.createElement('div');
    for (const section of [
        {
            label: nls.localize('qaap/composer/improvePromptBefore', 'Before'),
            value: before,
        },
        {
            label: nls.localize('qaap/composer/improvePromptAfter', 'After'),
            value: after,
        },
    ]) {
        const block = document.createElement('section');
        const heading = document.createElement('strong');
        heading.textContent = section.label;
        const text = document.createElement('pre');
        text.textContent = section.value;
        text.style.whiteSpace = 'pre-wrap';
        text.style.overflowWrap = 'anywhere';
        block.append(heading, text);
        comparison.appendChild(block);
    }
    const accepted = await new ConfirmDialog({
        title: nls.localize('qaap/composer/improvePromptReviewTitle', 'Review improved prompt'),
        msg: comparison,
        ok: nls.localize('qaap/composer/improvePromptAccept', 'Use improved prompt'),
        cancel: nls.localize('qaap/composer/improvePromptKeepOriginal', 'Keep original'),
    }).open();
    return accepted === true;
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
    beginPromptImproving(context.input);
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
        // The user may have typed while the request ran: their text wins over the suggestion.
        if (promptChangedWhileImproving(context, promptSnapshot)) {
            notifyPromptChangedWhileImproving(context.improveBtn);
            return;
        }
        endPromptImproving(context.input);
        const accepted = await (options.confirmImprovedPrompt ?? confirmImprovedPrompt)(promptSnapshot, improved);
        if (!accepted || isRunCancelled()) {
            return;
        }
        if (promptChangedWhileImproving(context, promptSnapshot)) {
            notifyPromptChangedWhileImproving(context.improveBtn);
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
        playPromptCrossfadeIn(context.input);
        context.refreshControls();
    } catch (error) {
        if (isComposerPromptImproveCancelled(error) || isRunCancelled() || animationAbort.signal.aborted) {
            restoreComposerPromptAfterCancel(context, promptSnapshot);
            return;
        }
        const message = isComposerPromptImproveTimeout(error)
            ? nls.localize('qaap/composer/improvePromptTimeout', 'Prompt improvement timed out. Try again.')
            : error instanceof Error && error.message.trim()
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
