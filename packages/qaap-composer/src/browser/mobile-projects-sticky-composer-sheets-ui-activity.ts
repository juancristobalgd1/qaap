import type { MobileProjectsStickyComposerSheetsUiContext } from './mobile-projects-sticky-composer-sheets-ui-context';
// Extracted from mobile-projects-sticky-composer-sheets-ui.ts

import { nls } from '@theia/core/lib/common/nls';
import {
    agentUsesSettingsModelCatalog,
    isSameAgentModel,
    OPENCODE_AGENT_ID,
    PI_AGENT_ID,
    readStoredAgentModel,
    type QaapQaiqModelOption,
} from '@theia/qaap-shared-core/lib/common/qaap-agent-task-client';
import { isOpenCodeFreeModelId } from '@theia/qaap-shared-core/lib/common/qaap-opencode-model-catalog';
import {
    createPickerSheetOptionButton,
    resolveUnavailableModelTitle,
} from '@theia/qaap-agents-ui/lib/browser/qaap-agent-ui';
import { appendLlmProviderIcon } from '@theia/qaap-shared-core/lib/common/qaap-llm-provider-branding';
import { appendAgentBrandIcon } from '@theia/qaap-shared-core/lib/common/qaap-agent-branding';
import {
    canonicalModelStatsKey,
    formatTurnDuration,
    MODEL_TURN_STATS_SLOW_THRESHOLD_MS,
    resolveModelTurnStats,
} from '@theia/qaap-shared-core/lib/common/qaap-model-latency-stats';
import { qaiqModelSupportsToolCalls } from '@theia/qaap-shared-core/lib/common/qaap-agent-tool-support';
import { formatQaiqModelProviderLabel } from '@theia/qaap-shared-core/lib/common/qaap-qaiq-byok-provider-registry';
import {
    groupQaiqModelsByProvider,
} from '@theia/qaap-shared-core/lib/common/qaap-qaiq-model-catalog';

export function createAgentPickerNoResultsHintExtracted(ctx: MobileProjectsStickyComposerSheetsUiContext): HTMLElement {
        const hint = document.createElement('p');
        hint.className = 'theia-qaap-agent-sheet-empty-models theia-qaap-agent-sheet-no-results';
        hint.setAttribute('role', 'status');
        hint.setAttribute('aria-live', 'polite');
        hint.textContent = nls.localize(
            'qaap/mobileProjects/stickyComposerNoAgentsModelsFound',
            'No agents or models found',
        );
        return hint;
}

export function appendAgentModelPickerListExtracted(ctx: MobileProjectsStickyComposerSheetsUiContext, list: HTMLElement,
        agentId: string,
        models: readonly QaapQaiqModelOption[],
        storedModel: ReturnType<typeof readStoredAgentModel>,
        onSelect: (model: QaapQaiqModelOption) => void,
        loadFailed = false,
        onRetry?: () => void,
        onOpenAiFeaturesSettings?: () => void,
        onSignIn?: () => void,): void {
        if (loadFailed) {
            const error = document.createElement('div');
            error.className = 'theia-qaap-agent-sheet-load-error';
            error.setAttribute('role', 'alert');
            const message = document.createElement('p');
            message.className = 'theia-qaap-agent-sheet-empty-models';
            message.textContent = nls.localize(
                'qaap/mobileProjects/stickyComposerAgentModelsLoadFailed',
                'Could not load models from the workspace. Check your connection and try again.',
            );
            error.append(message);
            if (onRetry) {
                const retry = document.createElement('button');
                retry.type = 'button';
                retry.className = 'theia-qaap-agent-sheet-retry';
                retry.textContent = nls.localize('qaap/mobileProjects/retry', 'Retry');
                retry.addEventListener('click', onRetry);
                error.append(retry);
            }
            list.append(error);
            return;
        }
        // Hide confirmed tool-less families from Agent mode — they accept `tools` but emit
        // arguments as plain text, so picking them only produces a dead turn.
        const agentCapableModels = models.filter(model => qaiqModelSupportsToolCalls(model.modelId) !== false);
        if (agentCapableModels.length === 0) {
            const hint = document.createElement('p');
            hint.className = 'theia-qaap-agent-sheet-empty-models';
            const usesSettingsCatalog = agentUsesSettingsModelCatalog(agentId);
            hint.textContent = usesSettingsCatalog
                ? nls.localize(
                    'qaap/mobileProjects/stickyComposerNoQaiqModels',
                    'Add an API key in Settings → AI Features to choose a model.',
                )
                : nls.localize(
                    'qaap/mobileProjects/stickyComposerNoAgentModels',
                    'No models are available for this agent on the workspace.',
                );
            list.append(hint);
            if (usesSettingsCatalog && onOpenAiFeaturesSettings) {
                const settingsButton = document.createElement('button');
                settingsButton.type = 'button';
                settingsButton.className = 'theia-qaap-agent-sheet-settings-cta';
                settingsButton.textContent = nls.localize(
                    'qaap/mobileProjects/openAiFeaturesSettings',
                    'Open AI Features settings',
                );
                settingsButton.addEventListener('click', event => {
                    event.preventDefault();
                    event.stopPropagation();
                    onOpenAiFeaturesSettings();
                });
                list.append(settingsButton);
            }
            return;
        }
        const isOpenCode = agentId.trim().toLowerCase() === OPENCODE_AGENT_ID;
        const sections: readonly AgentModelPickerSection[] = isOpenCode
            ? splitOpenCodeModelSections(agentCapableModels)
            : Array.from(groupQaiqModelsByProvider(agentCapableModels), ([vendor, providerModels]) => ({
                vendor,
                models: providerModels,
                paid: false,
            }));
        // Pi's `/login` can add providers at any time, so its first group always offers Sign in.
        const isPi = agentId.trim().toLowerCase() === PI_AGENT_ID;
        let piSignInShown = false;
        for (const pickerSection of sections) {
            const { vendor, models: providerModels, paid } = pickerSection;
            const section = document.createElement('div');
            section.className = 'theia-qaap-agent-sheet-provider';
            const label = document.createElement('div');
            label.className = 'theia-qaap-agent-sheet-provider-label';
            // Native harness catalogs use the harness identity as their vendor. Keep that
            // header consistent with the agent picker; only QAIQ/provider-backed groups use
            // the BYOK/gateway logo.
            if (vendor.trim().toLowerCase() === agentId.trim().toLowerCase()) {
                appendAgentBrandIcon(label, agentId, 'sm');
            } else {
                appendLlmProviderIcon(label, vendor, undefined, 'sm');
            }
            const labelText = document.createElement('span');
            labelText.textContent = paid
                ? nls.localize('qaap/agentPicker/paidModels', 'Paid')
                : formatQaiqModelProviderLabel(vendor);
            label.append(labelText);
            // One sign-in action per locked group, in its header; locked rows reuse it below.
            const showPiSignIn: boolean = isPi && !!onSignIn && !piSignInShown;
            piSignInShown = piSignInShown || showPiSignIn;
            if (onSignIn && (showPiSignIn || (paid && providerModels.some(model => model.available === false)))) {
                const signIn = document.createElement('button');
                signIn.type = 'button';
                signIn.className = 'theia-qaap-agent-sheet-connect';
                signIn.textContent = nls.localize('qaap/agentPicker/signIn', 'Sign in');
                signIn.addEventListener('click', event => {
                    event.preventDefault();
                    event.stopPropagation();
                    onSignIn?.();
                });
                label.append(signIn);
            }
            section.append(label);
            for (const model of providerModels) {
                const stats = resolveModelTurnStats(canonicalModelStatsKey(model));
                // A locked OpenCode paid row opens the same sign-in as the header action.
                const lockedSignIn = isOpenCode && model.available === false && model.unavailableReason === 'not-connected'
                    ? onSignIn
                    : undefined;
                section.append(createPickerSheetOptionButton({
                    label: model.label || model.modelId,
                    llmVendor: model.vendor,
                    llmModelId: model.modelId,
                    selected: isSameAgentModel(storedModel, model),
                    statsLabel: stats
                        ? nls.localize('qaap/mobileProjects/modelPickerLatency', '~{0}', formatTurnDuration(stats.median))
                        : undefined,
                    statsSlow: stats ? stats.median > MODEL_TURN_STATS_SLOW_THRESHOLD_MS : false,
                    available: model.available !== false,
                    unavailableTitle: model.available === false
                        ? resolveUnavailableModelTitle(agentId, model.unavailableReason)
                        : undefined,
                    badgeLabel: model.available === false
                        ? nls.localize('qaap/mobileProjects/modelPickerLocked', 'Locked')
                        : undefined,
                    badgeWarning: model.available === false,
                    onLockedSelect: lockedSignIn,
                    onSelect: () => onSelect(model),
                }));
            }
            list.append(section);
        }
}

/** One picker group; `paid` marks the locked OpenCode group that carries the sign-in header action. */
interface AgentModelPickerSection {
    readonly vendor: string;
    readonly models: readonly QaapQaiqModelOption[];
    readonly paid: boolean;
}

/** OpenCode free models first, then its paid models, so the paid group can be locked as one unit. */
function splitOpenCodeModelSections(models: readonly QaapQaiqModelOption[]): AgentModelPickerSection[] {
    const freeModels = models.filter(model => isOpenCodeFreeModelId(model.modelId));
    const paidModels = models.filter(model => !isOpenCodeFreeModelId(model.modelId));
    const sections: AgentModelPickerSection[] = [];
    if (freeModels.length > 0) {
        sections.push({ vendor: OPENCODE_AGENT_ID, models: freeModels, paid: false });
    }
    if (paidModels.length > 0) {
        sections.push({ vendor: OPENCODE_AGENT_ID, models: paidModels, paid: true });
    }
    return sections;
}

