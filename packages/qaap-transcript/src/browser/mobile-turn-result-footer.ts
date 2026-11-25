// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import type { TranscriptTurnResultState } from './qaap-transcript-host-contracts';

export const MOBILE_TURN_RESULT_CLASS = 'theia-mobile-turn-result';

/** The verification verdict a successful turn closed with (`done` or `warning`; blocked and failed turns have their own rows). */
export interface MobileTurnResultVerdict {
    readonly tone: 'done' | 'warning';
    readonly title: string;
    readonly details: readonly string[];
    /** True when the independent review rejected this turn's change: blocks the one-click Create PR button. */
    readonly reviewRejected?: boolean;
}

export interface MobileTurnResultFooterModel {
    readonly verdict?: MobileTurnResultVerdict;
    readonly state: TranscriptTurnResultState;
}

export interface MobileTurnResultFooterHandlers {
    readonly onOpenPreview: () => void;
    readonly onRunPreview: () => void;
    readonly onCreatePr: () => void;
    readonly onContinue: () => void;
}

/**
 * The compact result footer that closes the Files Changed card once a turn succeeded: the verification
 * verdict, the preview next step, and ONE primary next step ("Create PR" when git has changes to commit,
 * otherwise "Continue" back to the composer). Every action is a handler the composer already owns.
 */
export function createMobileTurnResultFooterElement(
    model: MobileTurnResultFooterModel,
    handlers: MobileTurnResultFooterHandlers,
    resolvePreviewState?: () => TranscriptTurnResultState['previewState'],
): HTMLElement {
    const footer = document.createElement('div');
    footer.className = MOBILE_TURN_RESULT_CLASS;
    if (model.verdict) {
        footer.append(createVerdictElement(model.verdict));
    }
    const actions = document.createElement('div');
    actions.className = `${MOBILE_TURN_RESULT_CLASS}-actions`;
    const preview = createPreviewButton(model.state.previewState, handlers);
    if (preview) {
        actions.append(preview);
    }
    if (resolvePreviewState) {
        livePreviewFooters.set(footer, { state: model.state.previewState, resolve: resolvePreviewState, handlers });
    }
    if (model.state.canCreatePr && model.verdict?.reviewRejected) {
        const blockedLabel = nls.localize('qaap/mobileProjects/turnResultCreatePr', 'Create PR');
        const blockedReason = nls.localize(
            'qaap/mobileProjects/turnResultCreatePrBlockedByReview',
            'Blocked — fix the issues flagged by the independent review before creating a pull request.',
        );
        const blocked = createActionButton('theia-mod-secondary theia-mod-blocked', 'codicon-git-pull-request', blockedLabel, () => undefined);
        blocked.disabled = true;
        blocked.title = blockedReason;
        blocked.setAttribute('aria-label', `${blockedLabel} (${blockedReason})`);
        blocked.setAttribute('data-pr-blocked', 'review-rejected');
        actions.append(
            blocked,
            createActionButton('theia-mod-primary', 'codicon-arrow-right', nls.localize('qaap/mobileProjects/turnResultContinue', 'Continue'), handlers.onContinue),
        );
    } else {
        actions.append(model.state.canCreatePr
            ? createActionButton('theia-mod-primary', 'codicon-git-pull-request', nls.localize('qaap/mobileProjects/turnResultCreatePr', 'Create PR'), handlers.onCreatePr)
            : createActionButton('theia-mod-primary', 'codicon-arrow-right', nls.localize('qaap/mobileProjects/turnResultContinue', 'Continue'), handlers.onContinue));
    }
    footer.append(actions);
    return footer;
}

/** Footers whose preview action follows the composer's preview state after they were painted. */
const livePreviewFooters = new WeakMap<HTMLElement, {
    state: TranscriptTurnResultState['previewState'];
    readonly resolve: () => TranscriptTurnResultState['previewState'];
    readonly handlers: MobileTurnResultFooterHandlers;
}>();

/**
 * A painted turn row is not re-rendered when only the preview changes (its message did not), so
 * its button stayed on "Starting preview…" after the preview came up. Re-resolve each footer's
 * preview state and swap just that button when it moved.
 */
export function refreshMobileTurnResultFooterPreviews(root: ParentNode): void {
    for (const footer of Array.from(root.querySelectorAll<HTMLElement>(`.${MOBILE_TURN_RESULT_CLASS}`))) {
        const live = livePreviewFooters.get(footer);
        if (!live) {
            continue;
        }
        const next = live.resolve();
        if (next === live.state) {
            continue;
        }
        live.state = next;
        const actions = footer.querySelector<HTMLElement>(`.${MOBILE_TURN_RESULT_CLASS}-actions`);
        actions?.querySelector(`[${PREVIEW_ACTION_ATTR}]`)?.remove();
        const button = createPreviewButton(next, live.handlers);
        if (actions && button) {
            actions.prepend(button);
        }
    }
}

function createVerdictElement(verdict: MobileTurnResultVerdict): HTMLElement {
    const row = document.createElement('div');
    row.className = `${MOBILE_TURN_RESULT_CLASS}-verdict theia-mod-${verdict.tone}`;
    const icon = document.createElement('span');
    icon.className = `codicon ${verdict.tone === 'warning' ? 'codicon-warning' : 'codicon-pass'} ${MOBILE_TURN_RESULT_CLASS}-verdict-icon`;
    icon.setAttribute('aria-hidden', 'true');
    const title = document.createElement('span');
    title.className = `${MOBILE_TURN_RESULT_CLASS}-verdict-title`;
    title.textContent = verdict.title;
    row.append(icon, title);
    if (verdict.details.length > 0) {
        const details = document.createElement('span');
        details.className = `${MOBILE_TURN_RESULT_CLASS}-verdict-details`;
        details.textContent = verdict.details.join(' · ');
        row.append(details);
    }
    return row;
}

const PREVIEW_ACTION_ATTR = 'data-turn-result-preview';

function createPreviewButton(state: TranscriptTurnResultState['previewState'], handlers: MobileTurnResultFooterHandlers): HTMLButtonElement | undefined {
    const button = createPreviewButtonForState(state, handlers);
    button?.setAttribute(PREVIEW_ACTION_ATTR, state);
    return button;
}

function createPreviewButtonForState(state: TranscriptTurnResultState['previewState'], handlers: MobileTurnResultFooterHandlers): HTMLButtonElement | undefined {
    switch (state) {
        case 'live':
            return createActionButton('theia-mod-secondary', 'codicon-globe', nls.localize('qaap/mobileProjects/turnResultOpenPreview', 'Open preview'), handlers.onOpenPreview);
        case 'runnable':
            return createActionButton('theia-mod-secondary', 'codicon-rocket', nls.localize('qaap/agentsHub/quickAction/runApp', 'Run app'), handlers.onRunPreview);
        case 'starting': {
            const button = createActionButton('theia-mod-secondary theia-mod-busy', 'codicon-loading',
                nls.localize('qaap/mobileProjects/previewStarting', 'Starting preview…'), () => undefined);
            button.disabled = true;
            return button;
        }
        default:
            return undefined;
    }
}

function createActionButton(modifier: string, iconClass: string, label: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `${MOBILE_TURN_RESULT_CLASS}-action ${modifier}`;
    const icon = document.createElement('span');
    icon.className = `codicon ${iconClass} ${MOBILE_TURN_RESULT_CLASS}-action-icon`;
    icon.setAttribute('aria-hidden', 'true');
    const text = document.createElement('span');
    text.textContent = label;
    button.append(icon, text);
    button.addEventListener('click', event => {
        event.stopPropagation();
        onClick();
    });
    return button;
}
