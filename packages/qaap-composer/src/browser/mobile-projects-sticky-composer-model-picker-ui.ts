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
import { QaapAgentEffort, type QaapAgentEffortLevel } from '@theia/qaap-shared-core/lib/common/qaap-agent-effort';
import {
    writeStoredAgentApprovalPolicy,
    type QaapAgentApprovalPolicyId,
} from '@theia/qaap-shared-core/lib/common/qaap-sticky-composer-approval-policy';
import { QaapComposerModelPickerModel, type QaapPickerModel, type QaapPickerState } from '../common/qaap-composer-model-picker-model';
import { resolveComposerEffortLevel, writeComposerEffortLevel } from '../common/qaap-composer-effort';
import type { MobileProjectsStickyComposerSheetsUiContext } from './mobile-projects-sticky-composer-sheets-ui-context';
import type { ComposerAgentPickerChrome } from './mobile-projects-sticky-composer-sheets-ui';
import { renderQaapComposerModelPicker } from './qaap-composer-model-picker';

export interface StickyComposerModelPickerOptions {
    readonly cwd: string | undefined;
    readonly agents: readonly QaapAgentTaskAgentOption[];
    readonly selectedAgentId: string | undefined;
    readonly project?: MobileProjectEntry;
    readonly onSelectAgent: (agentId: string, model?: QaapQaiqModelOption) => void;
    readonly isMobile: boolean;
    /** Approval preset the composer currently submits with. */
    readonly approval: QaapAgentApprovalPolicyId;
    readonly onSelectApproval: (policyId: QaapAgentApprovalPolicyId) => void;
    /** Repaints the composer once the picker closes, so the model pill shows the new effort. */
    readonly onRefresh: () => void;
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
    chrome.title.textContent = nls.localize('qaap/composer/picker/title', 'Model');
    chrome.intro.hidden = true;
    const searchRow = chrome.searchInput.parentElement;
    if (searchRow) {
        searchRow.hidden = true;
    }
    chrome.backBtn.hidden = true;
    const host = document.createElement('div');
    host.className = 'qaap-composer-model-picker-host';
    chrome.list.replaceChildren(host);

    const agents = listQaapComposerPickerAgents(options.agents);
    const harnesses = agents.map(agent => ({ id: agent.id, label: agent.label }));
    const pinned = options.selectedAgentId ?? harnesses[0]?.id ?? '';
    const currentModel = readStoredAgentModel(options.cwd, pinned);

    // Models of every harness, fetched once per open; the list reads them from the chrome cache.
    const loaded = await Promise.all(agents.map(async agent => {
        const cached = chrome.modelsByAgent.get(agent.id);
        if (cached !== undefined) {
            return { agentId: agent.id, models: cached };
        }
        const resolved = await ctx.resolveModelsForAgentPickerSafe(agent.id);
        chrome.modelsByAgent.set(agent.id, resolved.models);
        return { agentId: agent.id, models: resolved.models };
    }));
    if (!chrome.sheet.isConnected) {
        return;
    }
    const models: QaapPickerModel[] = loaded.flatMap(entry => entry.models.map(model => toPickerModel(entry.agentId, model)));
    const catalog = new Map<string, QaapQaiqModelOption>();
    for (const entry of loaded) {
        for (const model of entry.models) {
            catalog.set(QaapComposerModelPickerModel.favoriteKey(entry.agentId, model.modelId), model);
        }
    }

    let query = '';
    let railSelection: 'favorites' | string = pinned;
    let favorites = QaapComposerModelPickerModel.readFavorites(window.localStorage);
    let approvalCurrent: QaapAgentApprovalPolicyId = options.approval;
    const close = (): void => {
        chrome.onClose();
        options.onRefresh();
    };

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
        const effortAgentId = pinned;
        const effortModelId = currentModel?.modelId;
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
                options.onSelectAgent(agentId, model);
            },
            onSelectEffort: (level: QaapAgentEffortLevel) => {
                writeComposerEffortLevel(options.cwd, pinned, currentModel?.modelId, level);
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
        });
    };
    repaint();
}
