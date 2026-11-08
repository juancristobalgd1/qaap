// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import type { MobileProjectEntry } from '@theia/qaap-shared-core/lib/browser/mobile-projects-types';
import {
    listQaapComposerPickerAgents,
    type QaapAgentTaskAgentOption,
    type QaapQaiqModelOption,
} from '@theia/qaap-shared-core/lib/common/qaap-agent-task-client';
import { readStoredAgentModel } from '@theia/qaap-shared-core/lib/common/qaap-agent-model-selection';
import { agentNeedsSettingsApiKeyPath } from '@theia/qaap-shared-core/lib/common/qaap-agent-auth-login';
import { QaapAgentEffort, type QaapAgentEffortLevel } from '@theia/qaap-shared-core/lib/common/qaap-agent-effort';
import {
    writeStoredAgentApprovalPolicy,
    type QaapAgentApprovalPolicyId,
} from '@theia/qaap-shared-core/lib/common/qaap-sticky-composer-approval-policy';
import { QaapComposerModelPickerModel, type QaapPickerModel, type QaapPickerState } from '../common/qaap-composer-model-picker-model';
import { adoptPendingComposerEffort, resolveComposerEffortLevel, writeComposerEffortLevel } from '../common/qaap-composer-effort';
import type { MobileProjectsStickyComposerSheetsUiContext } from './mobile-projects-sticky-composer-sheets-ui-context';
import type { ComposerAgentPickerChrome } from './mobile-projects-sticky-composer-sheets-ui';
import { disposeQaapComposerModelPicker, renderQaapComposerModelPicker } from './qaap-composer-model-picker';
import { positionStickyComposerPopover } from '@theia/qaap-transcript/lib/browser/qaap-sticky-composer-popover';

/**
 * Desktop: the popover opens above the pill with its right edge on the pill. Its height is fixed by
 * the CSS so switching the rail does not move it; the list scrolls inside.
 */
function placePickerAbove(popover: HTMLElement, anchor: HTMLElement | undefined): void {
    if (!anchor || !popover.classList.contains('qaap-sticky-composer-sheet-popover')) {
        return;
    }
    // The shared popover positioning reads this flag on every resize and scroll too.
    popover.dataset.placement = 'above-start';
    positionStickyComposerPopover(popover, anchor, 'start', 560);
}

/** Sign-in or API key guidance for a harness that cannot run yet; `undefined` when it can. */
function connectionStripFor(
    agent: QaapAgentTaskAgentOption,
    hasAvailableModels: boolean,
    options: StickyComposerModelPickerOptions,
): { message: string; actionLabel: string; onAction: () => void } | undefined {
    if ((agent.connectionState === 'disconnected' || agent.accessState === 'none') && options.onProactiveLogin) {
        return {
            message: nls.localize('qaap/composer/picker/connectNeeded', '{0} needs a sign-in before it can run.', agent.label),
            actionLabel: nls.localize('qaap/composer/picker/signIn', 'Sign in'),
            onAction: () => options.onProactiveLogin?.(agent.id),
        };
    }
    if (!hasAvailableModels && agentNeedsSettingsApiKeyPath(agent.id) && options.onOpenAiFeaturesSettings) {
        return {
            message: nls.localize('qaap/composer/picker/apiKeyNeeded', 'Add an API key in AI settings to use {0}.', agent.label),
            actionLabel: nls.localize('qaap/composer/picker/openAiSettings', 'Open AI settings'),
            onAction: () => options.onOpenAiFeaturesSettings?.(),
        };
    }
    return undefined;
}

export interface StickyComposerModelPickerOptions {
    readonly cwd: string | undefined;
    readonly agents: readonly QaapAgentTaskAgentOption[];
    readonly selectedAgentId: string | undefined;
    readonly project?: MobileProjectEntry;
    readonly onSelectAgent: (agentId: string, model?: QaapQaiqModelOption) => void;
    readonly isMobile: boolean;
    /** The pill the picker opens from: the desktop popover sits above it, right-aligned. */
    readonly anchor?: HTMLElement;
    /** Approval preset the composer currently submits with. */
    readonly approval: QaapAgentApprovalPolicyId;
    readonly onSelectApproval: (policyId: QaapAgentApprovalPolicyId) => void;
    /** Repaints the composer once the picker is removed, whatever closed it (selection, Escape, ✕, outside click). */
    readonly onRefresh: () => void;
    /** Same handlers the previous agent sheet used for its sign-in and AI settings rows. */
    readonly onProactiveLogin?: (agentId: string) => void;
    readonly onOpenAiFeaturesSettings?: () => void;
    /** Keeps catalog labels so the model pill shows «GPT-5.6 Sol», not the slug, after a reload. */
    readonly rememberModelLabels?: (models: readonly QaapQaiqModelOption[]) => void;
}

/** Converts a catalog model to the picker row; a row without `available` is selectable. */
function toPickerModel(agentId: string, model: QaapQaiqModelOption): QaapPickerModel {
    const unavailable = model.available === false;
    return {
        agentId,
        modelId: model.modelId,
        label: model.label || model.modelId,
        available: !unavailable,
        unavailableReason: unavailable ? unavailableText(model.unavailableReason) : undefined,
    };
}

function unavailableText(reason: QaapQaiqModelOption['unavailableReason']): string {
    switch (reason) {
        case 'plan':
            return nls.localize('qaap/composer/picker/unavailablePlan', 'Requires a paid plan');
        case 'not-connected':
            return nls.localize('qaap/composer/picker/unavailableNotConnected', 'Sign in to use this model');
        default:
            return nls.localize('qaap/composer/picker/unavailableUnknown', 'Not available right now');
    }
}

/**
 * Paints the unified model picker into the agent picker chrome (popover on desktop, bottom sheet on
 * mobile). Harnesses and models come from the same sources as the previous agent sheet; a selection
 * goes through the same `onSelectAgent` path, so the stored agent and model stay identical.
 */
export async function renderStickyComposerModelPicker(
    ctx: Pick<MobileProjectsStickyComposerSheetsUiContext, 'resolveModelsForAgentPickerSafe'>,
    chrome: ComposerAgentPickerChrome,
    options: StickyComposerModelPickerOptions,
): Promise<void> {
    // The picker brings its own search and close gestures: hide the old header and search row.
    chrome.sheet.classList.add('theia-mod-model-picker');
    chrome.header.style.display = 'none';
    chrome.intro.style.display = 'none';
    const searchRow = chrome.searchInput.parentElement;
    if (searchRow) {
        searchRow.style.display = 'none';
    }
    const host = document.createElement('div');
    host.className = 'qaap-composer-model-picker-host';
    chrome.list.replaceChildren(host);

    const agents = listQaapComposerPickerAgents(options.agents);
    const harnesses = agents.map(agent => ({ id: agent.id, label: agent.label }));
    const pinned = options.selectedAgentId ?? harnesses[0]?.id ?? '';
    const currentModel = readStoredAgentModel(options.cwd, pinned);

    // Paint at once from the models seen so far; the background refresh below repaints as each harness answers.
    const modelsByAgent = new Map<string, readonly QaapQaiqModelOption[]>();
    for (const agent of agents) {
        const cached = chrome.modelsByAgent.get(agent.id);
        if (cached) {
            modelsByAgent.set(agent.id, cached);
        }
    }
    let models: QaapPickerModel[] = [];
    let catalog = new Map<string, QaapQaiqModelOption>();
    const rebuildModels = (): void => {
        models = [];
        catalog = new Map();
        for (const [agentId, list] of modelsByAgent) {
            for (const model of list) {
                models.push(toPickerModel(agentId, model));
                catalog.set(QaapComposerModelPickerModel.favoriteKey(agentId, model.modelId), model);
            }
            options.rememberModelLabels?.(list);
        }
    };
    rebuildModels();

    let query = '';
    let railSelection: 'favorites' | string = pinned;
    let favorites = QaapComposerModelPickerModel.readFavorites(window.localStorage);
    let approvalCurrent: QaapAgentApprovalPolicyId = options.approval;
    const close = (): void => { chrome.onClose(); };
    // Every close path removes the sheet: one observer turns that into the refresh and drops the content.
    const observer = new MutationObserver(() => {
        if (chrome.sheet.isConnected) {
            return;
        }
        observer.disconnect();
        disposeQaapComposerModelPicker(host);
        chrome.list.replaceChildren();
        options.onRefresh();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    placePickerAbove(chrome.sheet, options.anchor);

    const repaint = (): void => {
        const state: QaapPickerState = {
            harnesses,
            models,
            favorites,
            railSelection,
            query,
            currentAgentId: pinned,
            currentModelId: currentModel?.modelId,
        };
        // The effort column follows the harness highlighted on the rail, not only the pinned one.
        const effortAgentId = railSelection !== 'favorites' ? railSelection : pinned;
        const effortModelId = effortAgentId === pinned
            ? currentModel?.modelId
            : readStoredAgentModel(options.cwd, effortAgentId)?.modelId;
        const railAgent = agents.find(agent => agent.id === railSelection);
        const railHasModels = models.some(model => model.agentId === railSelection && model.available);
        const connect = railAgent ? connectionStripFor(railAgent, railHasModels, options) : undefined;
        renderQaapComposerModelPicker(host, {
            state,
            effort: {
                support: QaapAgentEffort.support(effortAgentId, effortModelId),
                current: resolveComposerEffortLevel(options.cwd, effortAgentId, effortModelId),
            },
            approval: { current: approvalCurrent },
            isMobile: options.isMobile,
            onSelectModel: (agentId, modelId) => {
                const model = catalog.get(QaapComposerModelPickerModel.favoriteKey(agentId, modelId));
                if (!model) {
                    return;
                }
                adoptPendingComposerEffort(options.cwd, agentId, modelId);
                options.onSelectAgent(agentId, model);
            },
            onSelectEffort: (level: QaapAgentEffortLevel) => {
                writeComposerEffortLevel(options.cwd, effortAgentId, effortModelId, level);
                repaint();
            },
            onSelectApproval: (policyId: QaapAgentApprovalPolicyId) => {
                writeStoredAgentApprovalPolicy(options.cwd, policyId);
                approvalCurrent = policyId;
                options.onSelectApproval(policyId);
                repaint();
            },
            onToggleFavorite: key => {
                favorites = QaapComposerModelPickerModel.toggleFavorite(favorites, key);
                QaapComposerModelPickerModel.writeFavorites(window.localStorage, favorites);
                repaint();
            },
            onQuery: value => {
                query = value;
                repaint();
            },
            onRail: selection => {
                railSelection = selection;
                repaint();
            },
            onClose: close,
            connect,
        });
    };
    repaint();
    // Background refresh of every harness: each answer repaints, so the list never waits for the slowest one.
    for (const agent of agents) {
        void ctx.resolveModelsForAgentPickerSafe(agent.id).then(resolved => {
            if (!chrome.sheet.isConnected) {
                return;
            }
            chrome.modelsByAgent.set(agent.id, resolved.models);
            modelsByAgent.set(agent.id, resolved.models);
            rebuildModels();
            repaint();
        });
    }
}
