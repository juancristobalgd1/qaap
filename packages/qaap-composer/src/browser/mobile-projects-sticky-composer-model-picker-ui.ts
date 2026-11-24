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
import { resolvePiLoginProvider } from '@theia/qaap-shared-core/lib/common/qaap-pi-login-providers';
import { QaapAgentEffort, type QaapAgentEffortLevel } from '@theia/qaap-shared-core/lib/common/qaap-agent-effort';
import { QAAP_AGENT_SIGNED_IN_EVENT, type QaapAgentSignedInDetail } from '@theia/qaap-shared-core/lib/common/qaap-harness-sign-out';
import {
    writeStoredAgentApprovalPolicy,
    type QaapAgentApprovalPolicyId,
} from '@theia/qaap-shared-core/lib/common/qaap-sticky-composer-approval-policy';
import { QaapComposerModelPickerModel, type QaapPickerModel, type QaapPickerState } from '../common/qaap-composer-model-picker-model';
import { adoptPendingComposerEffort, resolveComposerEffortLevel, writeComposerEffortLevel } from '../common/qaap-composer-effort';
import { detachSheetListEdgeFades } from './mobile-projects-sticky-composer-sheet-edge-fades';
import type { MobileProjectsStickyComposerSheetsUiContext } from './mobile-projects-sticky-composer-sheets-ui-context';
import type { ComposerAgentPickerChrome } from './mobile-projects-sticky-composer-sheets-ui';
import { disposeQaapComposerModelPicker, renderQaapComposerModelPicker } from './qaap-composer-model-picker';
import { placePickerAbove } from './qaap-composer-picker-placement';

/** How long a model picked before its harness sign-in waits for that sign-in to be confirmed. */
const SELECT_AFTER_SIGN_IN_WINDOW_MS = 15 * 60_000;

/** UI state of an open picker sheet, kept across its re-renders; dropped with the sheet. */
const openPickerUiState = new WeakMap<HTMLElement, { readonly railSelection: 'favorites' | string; readonly query: string }>();

/** Same model ids in the same order: an answer that brings nothing new must not rebuild the open list. */
function sameModelIds(left: readonly QaapQaiqModelOption[] | undefined, right: readonly QaapQaiqModelOption[]): boolean {
    if (!left || left.length !== right.length) {
        return false;
    }
    return left.every((model, index) => model.modelId === right[index].modelId && model.label === right[index].label);
}

/** The one pending «select this model once signed in»; a newer pick replaces it. */
let pendingSelectAfterSignIn: (() => void) | undefined;

/**
 * Runs `select` once the Connect dialog confirms the sign-in of `agentId` ({@link QAAP_AGENT_SIGNED_IN_EVENT}), so the
 * model the user picked is the one the composer ends up with. Dropped after a while or when another model is picked.
 */
function selectModelAfterSignIn(agentId: string, select: () => void): void {
    pendingSelectAfterSignIn?.();
    const expected = agentId.trim().toLowerCase();
    const dispose = (): void => {
        window.removeEventListener(QAAP_AGENT_SIGNED_IN_EVENT, onSignedIn);
        window.clearTimeout(timer);
        if (pendingSelectAfterSignIn === dispose) {
            pendingSelectAfterSignIn = undefined;
        }
    };
    const onSignedIn = (event: Event): void => {
        const signedIn = (event as CustomEvent<QaapAgentSignedInDetail | undefined>).detail?.agentId?.trim().toLowerCase();
        if (signedIn !== expected) {
            return;
        }
        dispose();
        select();
    };
    const timer = window.setTimeout(dispose, SELECT_AFTER_SIGN_IN_WINDOW_MS);
    window.addEventListener(QAAP_AGENT_SIGNED_IN_EVENT, onSignedIn);
    pendingSelectAfterSignIn = dispose;
}

export interface StickyComposerModelPickerOptions {
    readonly cwd: string | undefined;
    readonly agents: readonly QaapAgentTaskAgentOption[];
    /** Harness ids disabled in Settings → Harness; they never reach the picker. */
    readonly disabledHarnessIds?: readonly string[];
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
    /**
     * Whether a harness is not reported as signed out; on the Pi rail a Pi that is not signed out offers adding another
     * provider. A probe still pending after a restart must not hide the action.
     */
    readonly isAgentNotSignedOut?: (agentId: string) => boolean;
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
        // The picker lists the provider too (`anthropic/claude-haiku-4.5`) so same-named models from
        // different providers stay distinguishable; only the composer pill drops the provider path.
        label: (model.label?.trim() || model.modelId).replace(/(^|\/)~+/g, '$1'),
        available: !unavailable,
        unavailableReason: unavailable ? unavailableText(model.unavailableReason) : undefined,
        tier: model.tier,
        signInRequired: unavailable && model.unavailableReason === 'not-connected',
        vendor: model.vendor,
        providerLabel: agentId === 'pi' ? piProviderLabel(model.vendor) : undefined,
    };
}

/** Display name of a Pi provider (`groq` → `Groq`), falling back to the raw vendor id for an unknown one. */
function piProviderLabel(vendor: string | undefined): string | undefined {
    const id = vendor?.trim();
    if (!id) {
        return undefined;
    }
    const provider = resolvePiLoginProvider(id);
    return provider?.shortName ?? provider?.name ?? id;
}

function unavailableText(reason: QaapQaiqModelOption['unavailableReason']): string {
    switch (reason) {
        case 'plan':
            return nls.localize('qaap/composer/picker/unavailablePlan', 'Requires a paid plan');
        case 'not-connected':
            return nls.localize('qaap/composer/picker/unavailableNotConnected', 'Sign in to use this model');
        case 'checking':
            return nls.localize('qaap/mobileProjects/modelPickerChecking', 'Checking sign-in…');
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
    // The same open picker is rendered again when the background agent refresh answers: keep where the user
    // was (rail, search, scroll) instead of jumping back to the pinned harness at the top of the list.
    const preserved = openPickerUiState.get(chrome.sheet);
    const previousScrollTop = chrome.list.querySelector<HTMLElement>('[role="listbox"]')?.scrollTop ?? 0;
    const host = document.createElement('div');
    host.className = 'qaap-composer-model-picker-host';
    chrome.list.replaceChildren(host);
    // The picker scrolls its own rows and fades them; the list around it must not mask the footer.
    detachSheetListEdgeFades(chrome.list);

    const agents = listQaapComposerPickerAgents(options.agents, options.disabledHarnessIds ?? []);
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
    // Harnesses whose model list has not answered yet in this open (cached lists are not pending).
    const pendingAgentIds = new Set(agents.map(agent => agent.id).filter(agentId => !modelsByAgent.has(agentId)));
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

    let query = preserved?.query ?? '';
    let railSelection: 'favorites' | string = preserved && (preserved.railSelection === 'favorites'
        || harnesses.some(harness => harness.id === preserved.railSelection)) ? preserved.railSelection : pinned;
    const rememberUiState = (): void => {
        openPickerUiState.set(chrome.sheet, { railSelection, query });
    };
    rememberUiState();
    let favorites = QaapComposerModelPickerModel.readFavorites(window.localStorage);
    let approvalCurrent: QaapAgentApprovalPolicyId = options.approval;
    const close = (): void => { chrome.onClose(); };
    // Every close path removes the sheet: one observer turns that into the refresh and drops the content.
    const observer = new MutationObserver(() => {
        if (chrome.sheet.isConnected) {
            return;
        }
        observer.disconnect();
        openPickerUiState.delete(chrome.sheet);
        disposeQaapComposerModelPicker(host);
        window.removeEventListener('resize', onResize);
        chrome.list.replaceChildren();
        options.onRefresh();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    const onResize = (): void => placePickerAbove(chrome.sheet, options.anchor);
    window.addEventListener('resize', onResize);

    /**
     * The "Connect another provider" action of the Pi rail once Pi is connected. Pi's Connect dialog adds a provider
     * to the existing sign-in (`/login` in the same terminal), so the action reuses the sign-in path as it is.
     */
    const connectAnotherProviderAction = (selection: 'favorites' | string): { label: string; onAction: () => void } | undefined => {
        if (selection !== 'pi' || !options.onProactiveLogin || !options.isAgentNotSignedOut?.('pi')) {
            return undefined;
        }
        return {
            label: nls.localize('qaap/composer/modelPicker/connectAnotherPiProvider', 'Connect another provider'),
            onAction: () => {
                close();
                options.onProactiveLogin?.('pi');
            },
        };
    };

    const repaint = (): void => {
        // A repaint rebuilds the list: keep where the user had scrolled to.
        const scrolled = host.querySelector<HTMLElement>('[role="listbox"]');
        const scrollTop = scrolled?.scrollTop ?? 0;
        paint();
        const list = host.querySelector<HTMLElement>('[role="listbox"]');
        if (list && scrollTop > 0) {
            list.scrollTop = scrollTop;
        }
    };
    const paint = (): void => {
        const state: QaapPickerState = {
            harnesses,
            models,
            favorites,
            railSelection,
            query,
            currentAgentId: pinned,
            currentModelId: currentModel?.modelId,
            loading: railSelection === 'favorites' ? pendingAgentIds.size > 0 : pendingAgentIds.has(railSelection),
        };
        // The effort column follows the harness highlighted on the rail, not only the pinned one.
        const effortAgentId = railSelection !== 'favorites' ? railSelection : pinned;
        const effortModelId = effortAgentId === pinned
            ? currentModel?.modelId
            : readStoredAgentModel(options.cwd, effortAgentId)?.modelId;
        renderQaapComposerModelPicker(host, {
            state,
            effort: {
                support: QaapAgentEffort.support(effortAgentId, effortModelId),
                current: resolveComposerEffortLevel(options.cwd, effortAgentId, effortModelId),
            },
            approval: { current: approvalCurrent },
            connectAnother: connectAnotherProviderAction(railSelection),
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
                rememberUiState();
                repaint();
            },
            onRail: selection => {
                railSelection = selection;
                rememberUiState();
                repaint();
            },
            onClose: close,
            onSignIn: (agentId, modelId) => {
                const model = catalog.get(QaapComposerModelPickerModel.favoriteKey(agentId, modelId));
                close();
                if (model) {
                    selectModelAfterSignIn(agentId, () => {
                        adoptPendingComposerEffort(options.cwd, agentId, modelId);
                        options.onSelectAgent(agentId, model);
                    });
                }
                options.onProactiveLogin?.(agentId);
            },
        });
        placePickerAbove(chrome.sheet, options.anchor);
    };
    repaint();
    if (preserved && previousScrollTop > 0) {
        const list = host.querySelector<HTMLElement>('[role="listbox"]');
        if (list) {
            list.scrollTop = previousScrollTop;
        }
    }
    // Background refresh of every harness, so the list never waits for the slowest one. An answer repaints only
    // when it changes what is on screen: eight harnesses answering one by one each rebuilt the whole list
    // (scroll and hover reset), even when the list was the cached one or belonged to another rail entry.
    for (const agent of agents) {
        void ctx.resolveModelsForAgentPickerSafe(agent.id).then(resolved => {
            const endedLoading = pendingAgentIds.delete(agent.id);
            if (!chrome.sheet.isConnected) {
                return;
            }
            chrome.modelsByAgent.set(agent.id, resolved.models);
            const changed = !sameModelIds(modelsByAgent.get(agent.id), resolved.models);
            if (changed) {
                modelsByAgent.set(agent.id, resolved.models);
                rebuildModels();
            }
            const visible = railSelection === agent.id || railSelection === 'favorites' || query.trim().length > 0;
            if (visible && (changed || endedLoading)) {
                repaint();
            }
        });
    }
}
