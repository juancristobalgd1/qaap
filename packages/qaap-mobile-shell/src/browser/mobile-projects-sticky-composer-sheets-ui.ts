// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************
// @ts-nocheck

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
import { appendAgentModelPickerListExtracted, createAgentPickerNoResultsHintExtracted, createProactiveLoginRowExtracted, createProactiveSettingsApiKeyRowExtracted } from './mobile-projects-sticky-composer-sheets-ui-activity2';
import { assignAgentPickerPopoverExtracted, closeStickyComposerSheetsExtracted, mountModeSheetPresentationExtracted, openExternalAgentPickerForSubmitExtracted, openStickyComposerAgentSheetExtracted, openStickyComposerContextUsageSheetExtracted, openStickyComposerModelCapabilityPopoverExtracted, shouldElevateComposerSheetsExtracted, syncAgentPickerPopoverPositionExtracted, teardownAgentPickerPopoverExtracted, teardownCapabilityPresentationExtracted, teardownContextUsagePresentationExtracted, teardownModeSheetPopoverExtracted } from './mobile-projects-sticky-composer-sheets-ui-render2';
import { createAgentSheetOptionExtracted, createModeSheetOptionExtracted, mountApprovalPolicySheetPresentationExtracted, openApprovalPolicySheetExtracted, openComposerModeSheetExtracted, openStickyComposerApprovalPolicySheetExtracted, openStickyComposerModeSheetExtracted, resolveModelsForAgentPickerExtracted, resolveModelsForAgentPickerSafeExtracted, syncApprovalPolicyPopoverPositionExtracted, teardownApprovalPolicySheetPopoverExtracted } from './mobile-projects-sticky-composer-sheets-ui-streaming2';
import { createComposerAgentPickerChromeExtracted, renderComposerAgentPickerExtracted } from './mobile-projects-sticky-composer-sheets-ui-timeline2';

export type ComposerAgentPickerView = 'agents' | 'models';

export interface ComposerAgentPickerChrome {
    readonly sheet: HTMLElement;
    readonly header: HTMLElement;
    readonly title: HTMLElement;
    readonly backBtn: HTMLButtonElement;
    readonly intro: HTMLElement;
    readonly searchInput: HTMLInputElement;
    readonly list: HTMLElement;
    readonly modelsByAgent: Map<string, readonly QaapQaiqModelOption[]>;
    readonly modelLoadFailedByAgent: Map<string, boolean>;
    readonly onClose: () => void;
    readonly popoverCleanup?: () => void;
}

export interface MobileProjectsStickyComposerSheetsHost {
    stickyComposerAgentSheet: HTMLElement | undefined;
    stickyComposerModeSheet: HTMLElement | undefined;
    stickyComposerApprovalSheet: HTMLElement | undefined;
    stickyComposerWorkspaceSheet: HTMLElement | undefined;
    stickyComposerContextUsageSheet: HTMLElement | undefined;
    stickyComposerCapabilitySheet: HTMLElement | undefined;
    stickyComposerSurface: QaapComposerSurface;
    stickyComposerPinnedAgentId: string | undefined;
    stickyComposerModeId: string | undefined;
    stickyComposerApprovalPolicyId: QaapAgentApprovalPolicyId | undefined;
    stickyComposerToolApprovalRules: QaapAgentToolApprovalRules | undefined;
    preparedCwdByProjectId: Map<string, string>;
    projectsService: MobileProjectsService;
    chatAgentService?: import('@theia/ai-chat/lib/common/chat-agent-service').ChatAgentService;
    activeTasks?: import('./mobile-projects-active-tasks').MobileProjectsActiveTasks;
    readPreference?: (key: string) => unknown;
    getRegisteredLanguageModels?: () => Promise<ReadonlyArray<{ readonly id: string; readonly name?: string }>>;
    stickyComposerQaiqModels: QaapQaiqModelOption[];
    stickyComposerRenderUi: import('./mobile-projects-sticky-composer-render-ui').MobileProjectsStickyComposerRenderUi;
    stickyComposerAgentsUi: import('./mobile-projects-sticky-composer-agents-ui').MobileProjectsStickyComposerAgentsUi;
    stickyComposerWorkspaceUi: import('./mobile-projects-sticky-composer-workspace-ui').MobileProjectsStickyComposerWorkspaceUi;
    closeTranscriptComposerSheets(): void;
    openAgentSignInTerminal?(agentId?: string): void | Promise<void>;
    openPreferencesSheet?(query?: string): Promise<void>;
    agentsHubShellActive?: boolean;
    submitExternalComposerPrompt?(
        draft: string,
        options?: {
            readonly agentId?: string;
            readonly agentModel?: import('../common/qaap-agent-task-client').QaapCreateAgentTaskQaiqModel;
        },
    ): Promise<boolean>;
}

export class MobileProjectsStickyComposerSheetsUi {
    private contextUsageAnchor: HTMLElement | undefined;
    private contextUsagePopoverCleanup: (() => void) | undefined;
    private agentSheetAnchor: HTMLElement | undefined;
    private agentPopoverCleanup: (() => void) | undefined;
    private agentPopoverAlign: StickyComposerPopoverAlign = 'end';
    private modeSheetAnchor: HTMLElement | undefined;
    private modePopoverCleanup: (() => void) | undefined;
    private modePopoverAlign: StickyComposerPopoverAlign = 'start';
    private approvalPolicySheetAnchor: HTMLElement | undefined;
    private approvalPolicyPopoverCleanup: (() => void) | undefined;
    private approvalPolicyPopoverAlign: StickyComposerPopoverAlign = 'start';
    private capabilitySheetAnchor: HTMLElement | undefined;
    private capabilityPopoverCleanup: (() => void) | undefined;
    private capabilityPopoverAlign: StickyComposerPopoverAlign = 'end';

    constructor(protected readonly host: MobileProjectsStickyComposerSheetsHost) { }

    protected shouldElevateComposerSheets(): boolean {
        return shouldElevateComposerSheetsExtracted(this);
    }

    closeStickyComposerSheets(): void {
        closeStickyComposerSheetsExtracted(this);
    }

    protected teardownCapabilityPresentation(): void {
        teardownCapabilityPresentationExtracted(this);
    }

    protected teardownContextUsagePresentation(): void {
        teardownContextUsagePresentationExtracted(this);
    }

    closeAllComposerSheets(): void {
        this.closeStickyComposerSheets();
        this.host.closeTranscriptComposerSheets();
    }

    openStickyComposerContextUsageSheet(refreshBreakdown: () => ContextUsageBreakdownView, transcriptOverlay?: boolean, anchor?: HTMLElement,): void {
        openStickyComposerContextUsageSheetExtracted(this, refreshBreakdown, transcriptOverlay, anchor);
    }

    openStickyComposerModelCapabilityPopover(options: { readonly anchor: HTMLButtonElement; readonly cwd: string | undefined; readonly transcriptOverlay?: boolean; readonly resolveLevel: () => ModelCapabilityLevelValue; readonly assignLevel: (level: ModelCapabilityLevelValue) => void; readonly onCommit?: () => void; }): void {
        openStickyComposerModelCapabilityPopoverExtracted(this, options);
    }

    teardownAgentPickerPopover(): void {
        teardownAgentPickerPopoverExtracted(this);
    }

    shouldUseAgentPickerPopover(anchor?: HTMLElement): anchor is HTMLElement {
        return shouldUseStickyComposerPopover(anchor);
    }

    isAgentPickerPopoverAnchoredTo(anchor?: HTMLElement): boolean {
        return anchor !== undefined && this.agentSheetAnchor === anchor;
    }

    syncAgentPickerPopoverPosition(root: HTMLElement | undefined): void {
        syncAgentPickerPopoverPositionExtracted(this, root);
    }

    assignAgentPickerPopover(anchor: HTMLElement, cleanup: (() => void) | undefined): void {
        assignAgentPickerPopoverExtracted(this, anchor, cleanup);
    }

    openStickyComposerAgentSheet(project: MobileProjectEntry, anchor?: HTMLElement): void {
        openStickyComposerAgentSheetExtracted(this, project, anchor);
    }

    openExternalAgentPickerForSubmit(project: MobileProjectEntry, draft: string, options: { readonly title?: string; readonly intro?: string; readonly anchor?: HTMLElement; } = {},): void {
        openExternalAgentPickerForSubmitExtracted(this, project, draft, options);
    }
    teardownModeSheetPopover(): void {
        teardownModeSheetPopoverExtracted(this);
    }

    isModeSheetPopoverAnchoredTo(anchor?: HTMLElement): boolean {
        return anchor !== undefined && this.modeSheetAnchor === anchor;
    }

    protected mountModeSheetPresentation(panel: HTMLElement, options: { readonly anchor?: HTMLElement; readonly transcriptOverlay: boolean; readonly onClose: () => void; },): HTMLElement {
        return mountModeSheetPresentationExtracted(this, panel, options);
    }

    openComposerModeSheet(options: { readonly modes: readonly ChatMode[]; readonly selectedModeId: string | undefined; readonly cwd: string | undefined; readonly anchor?: HTMLElement; readonly transcriptOverlay: boolean; readonly closeTitle: string; readonly onClose: () => void; readonly onSelect: (modeId: string) => void; readonly assignSheet: (sheet: HTMLElement) => void; readonly isOpen?: () => boolean; }): void {
        openComposerModeSheetExtracted(this, options);
    }

    openStickyComposerModeSheet(project: MobileProjectEntry, modes: readonly ChatMode[], anchor?: HTMLElement,): void {
        openStickyComposerModeSheetExtracted(this, project, modes, anchor);
    }

    openStickyComposerApprovalPolicySheet(project: MobileProjectEntry, agentLabel: string, anchor?: HTMLElement,): void {
        openStickyComposerApprovalPolicySheetExtracted(this, project, agentLabel, anchor);
    }
    teardownApprovalPolicySheetPopover(): void {
        teardownApprovalPolicySheetPopoverExtracted(this);
    }

    isApprovalPolicyPopoverAnchoredTo(anchor?: HTMLElement): boolean {
        return anchor !== undefined && this.approvalPolicySheetAnchor === anchor;
    }

    syncApprovalPolicyPopoverPosition(root: HTMLElement | undefined): void {
        syncApprovalPolicyPopoverPositionExtracted(this, root);
    }

    protected mountApprovalPolicySheetPresentation(panel: HTMLElement, options: { readonly anchor?: HTMLElement; readonly transcriptOverlay: boolean; readonly onClose: () => void; },): HTMLElement {
        return mountApprovalPolicySheetPresentationExtracted(this, panel, options);
    }

    openApprovalPolicySheet(options: { readonly agentLabel: string; readonly cwd: string | undefined; readonly selectedId: QaapAgentApprovalPolicyId; readonly toolRules: QaapAgentToolApprovalRules; readonly anchor?: HTMLElement; readonly transcriptOverlay?: boolean; readonly onSelect: (policyId: QaapAgentApprovalPolicyId) => void; readonly onToolRulesChange?: (rules: QaapAgentToolApprovalRules) => void; readonly onClose: () => void; readonly assignSheet: (sheet: HTMLElement) => void; readonly isOpen?: () => boolean; }): void {
        openApprovalPolicySheetExtracted(this, options);
    }
    createModeSheetOption(label: string, modeId: string, selectedModeId: string | undefined, onSelect: (modeId: string) => void,): HTMLElement {
        return createModeSheetOptionExtracted(this, label, modeId, selectedModeId, onSelect);
    }
    createAgentSheetOption(label: string, agentId: string, cwd: string | undefined, selectedAgentId: string | undefined, onSelect: (agentId: string) => void,): HTMLElement {
        return createAgentSheetOptionExtracted(this, label, agentId, cwd, selectedAgentId, onSelect);
    }
    async resolveModelsForAgentPicker(agentId: string): Promise<QaapQaiqModelOption[]> {
        return resolveModelsForAgentPickerExtracted(this, agentId);
    }
    protected async resolveModelsForAgentPickerSafe(agentId: string,): Promise<{ readonly models: QaapQaiqModelOption[]; readonly loadFailed: boolean }> {
        return resolveModelsForAgentPickerSafeExtracted(this, agentId);
    }
    createComposerAgentPickerChrome(options: { readonly closeTitle: string; readonly onClose: () => void; readonly anchor?: HTMLElement; readonly transcriptOverlay?: boolean; readonly sheetModifierClass?: string; }): ComposerAgentPickerChrome {
        return createComposerAgentPickerChromeExtracted(this, options);
    }
    async renderComposerAgentPicker(chrome: ComposerAgentPickerChrome, options: { readonly view: ComposerAgentPickerView; readonly modelPickerAgentId?: string; readonly cwd: string | undefined; readonly agents: readonly QaapAgentTaskAgentOption[]; readonly selectedAgentId: string | undefined; readonly includeCoder: boolean; readonly agentsTitle?: string; readonly agentsIntro?: string; readonly onSelectAgent: (agentId: string, model?: QaapQaiqModelOption) => void; readonly onProactiveLogin?: (agentId: string) => void; readonly onOpenAiFeaturesSettings?: (agentId: string) => void; },): Promise<void> {
        return renderComposerAgentPickerExtracted(this, chrome, options);
    }
    protected createProactiveLoginRow(agentLabel: string, onSelect: () => void): HTMLButtonElement {
        return createProactiveLoginRowExtracted(this, agentLabel, onSelect);
    }
    protected createProactiveSettingsApiKeyRow(agentLabel: string, onSelect: () => void): HTMLButtonElement {
        return createProactiveSettingsApiKeyRowExtracted(this, agentLabel, onSelect);
    }
    protected createAgentPickerNoResultsHint(): HTMLElement {
        return createAgentPickerNoResultsHintExtracted(this);
    }
    appendAgentModelPickerList(list: HTMLElement, agentId: string, models: readonly QaapQaiqModelOption[], storedModel: ReturnType<typeof readStoredAgentModel>, onSelect: (model: QaapQaiqModelOption) => void, loadFailed = false, onRetry?: () => void,): void {
        appendAgentModelPickerListExtracted(this, list, agentId, models, storedModel, onSelect, loadFailed, onRetry);
    }
}

