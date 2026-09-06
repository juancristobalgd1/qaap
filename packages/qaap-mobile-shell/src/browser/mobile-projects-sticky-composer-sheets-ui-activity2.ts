// @ts-nocheck
// Extracted from mobile-projects-sticky-composer-sheets-ui.ts

import { nls } from '@theia/core/lib/common/nls';
import { ChatMode } from '@theia/ai-chat';
import { agentHasCliOAuthLogin } from '../common/qaap-agent-auth-login';
import {
    agentSupportsModelPicker,
    agentUsesSettingsModelCatalog,
    fetchAgentModelsForAgent,
    isSameAgentModel,
    isStickyComposerAgentSelected,
    readStoredAgentModel,
    writeStoredAgent,
    writeStoredAgentModel,
    type QaapAgentTaskAgentOption,
    type QaapQaiqModelOption,
} from '../common/qaap-agent-task-client';
import {
    reconcileComposerModeId,
    resolveStickyComposerModes,
    writeStoredComposerMode,
} from '../common/qaap-sticky-composer-mode';
import {
    QAAP_AGENT_APPROVAL_POLICIES,
    reconcileAgentApprovalPolicyId,
    writeStoredAgentApprovalPolicy,
    type QaapAgentApprovalPolicyId,
} from '../common/qaap-sticky-composer-approval-policy';
import {
    reconcileAgentToolApprovalRules,
    writeStoredAgentToolApprovalRules,
    type QaapAgentToolApprovalRules,
} from '../common/qaap-agent-tool-approval-rules';
import {
    createAgentBrandChip,
    createAgentSheetOptionButton,
    createApprovalPolicySheetOptionButton,
    createModeSheetOptionButton,
    createPickerSheetOptionButton,
    createToolApprovalRuleToggle,
} from './qaap-agent-ui';
import { appendLlmProviderIcon } from '../common/qaap-llm-provider-branding';
import {
    canonicalModelStatsKey,
    formatTurnDuration,
    MODEL_TURN_STATS_SLOW_THRESHOLD_MS,
    resolveModelTurnStats,
} from '../common/qaap-model-latency-stats';
import { qaiqModelSupportsToolCalls } from '../common/qaap-agent-tool-support';
import { formatQaiqModelProviderLabel } from '../common/qaap-qaiq-byok-provider-registry';
import {
    formatQaiqModelSelectionLabel,
    filterQaiqModelsWithConfiguredCredentials,
    groupQaiqModelsByProvider,
    listQaiqModelsFromPreferences,
    listQaiqModelsFromRegisteredLanguageModels,
    mergeQaiqModelOptions,
} from '../common/qaap-qaiq-model-catalog';
import { THEIA_CODER_AGENT_ID } from '../common/qaap-agent-task-client';
import {
    reconcileModelCapabilityLevel,
    writeStoredModelCapabilityLevel,
    type ModelCapabilityLevelValue,
} from '../common/qaap-sticky-composer-model-capability';
import { renderModelCapabilityPopoverPanel } from './model-capability-popover';
import {
    renderContextUsagePopover,
    renderContextUsageSheet,
    wireContextUsagePopoverDismiss,
    type ContextUsageBreakdownView,
} from './qaap-chat-context-usage-panel';
import {
    isStickyComposerAnnotationPopoverAnchor,
    markStickyComposerPopoverAnchor,
    mountStickyComposerBottomSheet,
    mountStickyComposerSheetPopover,
    scheduleStickyComposerPopoverPosition,
    shouldUseStickyComposerDesktopPopover,
    shouldUseStickyComposerPopover,
    type StickyComposerPopoverAlign,
} from './qaap-sticky-composer-popover';
import type { MobileProjectEntry } from './mobile-projects-types';
import type { MobileProjectsService } from './mobile-projects-service';
import type { QaapComposerSurface } from '../common/qaap-composer-surface';
import {
    activateAgentPickerEntry,
    buildAgentPickerSearchResults,
    createAgentPickerInlineModelButton,
    modelMatchesAgentPickerQuery,
    type QaapAgentPickerSearchEntry,
} from './qaap-agent-picker-search';
import { renderAgentPickerSkeleton, replaceAgentPickerLoading } from './qaap-agent-picker-loading';

export function createProactiveSettingsApiKeyRowExtracted(ctx: any, agentLabel: string, onSelect: () => void): HTMLButtonElement {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'theia-mobile-sticky-composer-sheet-option theia-qaap-agent-sheet-login-option';
        const content = document.createElement('span');
        content.className = 'theia-mobile-sticky-composer-sheet-option-content';
        const icon = document.createElement('span');
        icon.className = 'codicon codicon-key theia-qaap-agent-sheet-login-icon';
        icon.setAttribute('aria-hidden', 'true');
        content.append(icon);
        const labelEl = document.createElement('span');
        labelEl.className = 'theia-mobile-sticky-composer-sheet-option-label';
        labelEl.textContent = nls.localize(
            'qaap/mobileProjects/stickyComposerAddApiKeyForAgent',
            'Add API key for {0} in Settings',
            agentLabel,
        );
        content.append(labelEl);
        btn.append(content);
        btn.addEventListener('click', event => {
            event.stopPropagation();
            event.preventDefault();
            onSelect();
        });
        return btn;
}

export function createProactiveLoginRowExtracted(ctx: any, agentLabel: string, onSelect: () => void): HTMLButtonElement {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'theia-mobile-sticky-composer-sheet-option theia-qaap-agent-sheet-login-option';
        const content = document.createElement('span');
        content.className = 'theia-mobile-sticky-composer-sheet-option-content';
        const icon = document.createElement('span');
        icon.className = 'codicon codicon-sign-in theia-qaap-agent-sheet-login-icon';
        icon.setAttribute('aria-hidden', 'true');
        content.append(icon);
        const labelEl = document.createElement('span');
        labelEl.className = 'theia-mobile-sticky-composer-sheet-option-label';
        labelEl.textContent = nls.localize(
            'qaap/mobileProjects/stickyComposerSignInWithAgent',
            'Sign in with {0}',
            agentLabel,
        );
        content.append(labelEl);
        btn.append(content);
        btn.addEventListener('click', event => {
            event.stopPropagation();
            event.preventDefault();
            onSelect();
        });
        return btn;
}

export function createAgentPickerNoResultsHintExtracted(ctx: any): HTMLElement {
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

export function appendAgentModelPickerListExtracted(ctx: any, list: HTMLElement,
        agentId: string,
        models: readonly QaapQaiqModelOption[],
        storedModel: ReturnType<typeof readStoredAgentModel>,
        onSelect: (model: QaapQaiqModelOption) => void,
        loadFailed = false,
        onRetry?: () => void,): void {
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
            hint.textContent = agentUsesSettingsModelCatalog(agentId)
                ? nls.localize(
                    'qaap/mobileProjects/stickyComposerNoQaiqModels',
                    'Add an API key in Settings → AI Features to choose a model.',
                )
                : nls.localize(
                    'qaap/mobileProjects/stickyComposerNoAgentModels',
                    'No models are available for this agent on the workspace.',
                );
            list.append(hint);
            return;
        }
        for (const [vendor, providerModels] of groupQaiqModelsByProvider(agentCapableModels)) {
            const section = document.createElement('div');
            section.className = 'theia-qaap-agent-sheet-provider';
            const label = document.createElement('div');
            label.className = 'theia-qaap-agent-sheet-provider-label';
            // Section header: BYOK/gateway brand only (model rows use slug-aware icons).
            appendLlmProviderIcon(label, vendor, undefined, 'sm');
            const labelText = document.createElement('span');
            labelText.textContent = formatQaiqModelProviderLabel(vendor);
            label.append(labelText);
            section.append(label);
            for (const model of providerModels) {
                const stats = resolveModelTurnStats(canonicalModelStatsKey(model));
                section.append(createPickerSheetOptionButton({
                    label: model.label || model.modelId,
                    llmVendor: model.vendor,
                    llmModelId: model.modelId,
                    selected: isSameAgentModel(storedModel, model),
                    statsLabel: stats
                        ? nls.localize('qaap/mobileProjects/modelPickerLatency', '~{0}', formatTurnDuration(stats.median))
                        : undefined,
                    statsSlow: stats ? stats.median > MODEL_TURN_STATS_SLOW_THRESHOLD_MS : false,
                    onSelect: () => onSelect(model),
                }));
            }
            list.append(section);
        }
}

