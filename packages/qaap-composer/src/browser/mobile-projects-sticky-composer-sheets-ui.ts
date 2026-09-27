// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { ChatMode } from '@theia/ai-chat';
import {
    readStoredAgentModel,
    type QaapAgentTaskAgentOption,
    type QaapQaiqModelOption,
} from '@theia/qaap-shared-core/lib/common/qaap-agent-task-client';
import {
    type QaapAgentApprovalPolicyId,
} from '@theia/qaap-shared-core/lib/common/qaap-sticky-composer-approval-policy';
import {
    type QaapAgentToolApprovalRules,
} from '@theia/qaap-shared-core/lib/common/qaap-agent-tool-approval-rules';
import {
    type ModelCapabilityLevelValue,
} from '../common/qaap-sticky-composer-model-capability';
import {
    type ContextUsageBreakdownView,
} from '@theia/qaap-transcript/lib/browser/qaap-chat-context-usage-panel';
import {
    shouldUseStickyComposerPopover,
    type StickyComposerPopoverAlign,
} from '@theia/qaap-transcript/lib/browser/qaap-sticky-composer-popover';
import type { MobileProjectEntry } from '@theia/qaap-shared-core/lib/browser/mobile-projects-types';
import type { MobileProjectsService } from '@theia/qaap-shared-core/lib/browser/mobile-projects-service';
import type { QaapComposerSurface } from '../common/qaap-composer-surface';
import { appendAgentModelPickerListExtracted, createAgentPickerNoResultsHintExtracted } from './mobile-projects-sticky-composer-sheets-ui-activity';
import { assignAgentPickerPopoverExtracted, closeStickyComposerSheetsExtracted, mountModeSheetPresentationExtracted, openExternalAgentPickerForSubmitExtracted, openStickyComposerAgentSheetExtracted, openStickyComposerContextUsageSheetExtracted, openStickyComposerModelCapabilityPopoverExtracted, shouldElevateComposerSheetsExtracted, syncAgentPickerPopoverPositionExtracted, teardownAgentPickerPopoverExtracted, teardownCapabilityPresentationExtracted, teardownContextUsagePresentationExtracted, teardownModeSheetPopoverExtracted } from './mobile-projects-sticky-composer-sheets-ui-render';
import { createModeSheetOptionExtracted, mountApprovalPolicySheetPresentationExtracted, openApprovalPolicySheetExtracted, openComposerModeSheetExtracted, openStickyComposerApprovalPolicySheetExtracted, openStickyComposerModeSheetExtracted, resolveModelsForAgentPickerExtracted, resolveModelsForAgentPickerSafeExtracted, syncApprovalPolicyPopoverPositionExtracted, teardownApprovalPolicySheetPopoverExtracted } from './mobile-projects-sticky-composer-sheets-ui-streaming';
import { createComposerAgentPickerChromeExtracted, renderComposerAgentPickerExtracted } from './mobile-projects-sticky-composer-sheets-ui-timeline';

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
    activeTasks?: import('@theia/qaap-shared-core/lib/browser/mobile-projects-active-tasks').MobileProjectsActiveTasks;
    readPreference?: (key: string) => unknown;
    getRegisteredLanguageModels?: () => Promise<ReadonlyArray<{ readonly id: string; readonly name?: string }>>;
    stickyComposerQaiqModels: QaapQaiqModelOption[];
    stickyComposerRenderUi: import('./mobile-projects-sticky-composer-render-ui').MobileProjectsStickyComposerRenderUi;
    stickyComposerAgentsUi: import('./mobile-projects-sticky-composer-agents-ui').MobileProjectsStickyComposerAgentsUi;
    stickyComposerWorkspaceUi: import('./mobile-projects-sticky-composer-workspace-ui').MobileProjectsStickyComposerWorkspaceUi;
    closeTranscriptComposerSheets(): void;
    openAgentSignInTerminal?(agentId?: string, project?: MobileProjectEntry): void | Promise<void>;
    openPreferencesSheet?(query?: string): Promise<void>;
    agentsHubShellActive?: boolean;
    submitExternalComposerPrompt?(
        draft: string,
        options?: {
            readonly agentId?: string;
            readonly agentModel?: import('@theia/qaap-shared-core/lib/common/qaap-agent-task-client').QaapCreateAgentTaskQaiqModel;
        },
    ): Promise<boolean>;
}

export class MobileProjectsStickyComposerSheetsUi {
    /** @internal Used by the extracted mobile-projects-sticky-composer-sheets-ui-* modules. */
    public contextUsageAnchor: HTMLElement | undefined;
    /** @internal Used by the extracted mobile-projects-sticky-composer-sheets-ui-* modules. */
    public contextUsagePopoverCleanup: (() => void) | undefined;
    /** @internal Used by the extracted mobile-projects-sticky-composer-sheets-ui-* modules. */
    public agentSheetAnchor: HTMLElement | undefined;
    /** @internal Used by the extracted mobile-projects-sticky-composer-sheets-ui-* modules. */
    public agentPopoverCleanup: (() => void) | undefined;
    /** @internal Used by the extracted mobile-projects-sticky-composer-sheets-ui-* modules. */
    public agentPopoverAlign: StickyComposerPopoverAlign = 'end';
    /** @internal Used by the extracted mobile-projects-sticky-composer-sheets-ui-* modules. */
    public modeSheetAnchor: HTMLElement | undefined;
    /** @internal Used by the extracted mobile-projects-sticky-composer-sheets-ui-* modules. */
    public modePopoverCleanup: (() => void) | undefined;
    /** @internal Used by the extracted mobile-projects-sticky-composer-sheets-ui-* modules. */
    public modePopoverAlign: StickyComposerPopoverAlign = 'start';
    /** @internal Used by the extracted mobile-projects-sticky-composer-sheets-ui-* modules. */
    public approvalPolicySheetAnchor: HTMLElement | undefined;
    /** @internal Used by the extracted mobile-projects-sticky-composer-sheets-ui-* modules. */
    public approvalPolicyPopoverCleanup: (() => void) | undefined;
    /** @internal Used by the extracted mobile-projects-sticky-composer-sheets-ui-* modules. */
    public approvalPolicyPopoverAlign: StickyComposerPopoverAlign = 'start';
    /** @internal Used by the extracted mobile-projects-sticky-composer-sheets-ui-* modules. */
    public capabilitySheetAnchor: HTMLElement | undefined;
    /** @internal Used by the extracted mobile-projects-sticky-composer-sheets-ui-* modules. */
    public capabilityPopoverCleanup: (() => void) | undefined;
    /** @internal Used by the extracted mobile-projects-sticky-composer-sheets-ui-* modules. */
    public capabilityPopoverAlign: StickyComposerPopoverAlign = 'end';

    constructor(
        /** @internal Used by the extracted mobile-projects-sticky-composer-sheets-ui-* modules. */
        public readonly host: MobileProjectsStickyComposerSheetsHost,
    ) { }

    /** @internal Used by the extracted mobile-projects-sticky-composer-sheets-ui-* modules. */
    public shouldElevateComposerSheets(): boolean {
        return shouldElevateComposerSheetsExtracted(this);
    }

    closeStickyComposerSheets(): void {
        closeStickyComposerSheetsExtracted(this);
    }

    /** @internal Used by the extracted mobile-projects-sticky-composer-sheets-ui-* modules. */
    public teardownCapabilityPresentation(): void {
        teardownCapabilityPresentationExtracted(this);
    }

    /** @internal Used by the extracted mobile-projects-sticky-composer-sheets-ui-* modules. */
    public teardownContextUsagePresentation(): void {
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

    /** @internal Used by the extracted mobile-projects-sticky-composer-sheets-ui-* modules. */
    public mountModeSheetPresentation(panel: HTMLElement, options: { readonly anchor?: HTMLElement; readonly transcriptOverlay: boolean; readonly onClose: () => void; },): HTMLElement {
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

    /** @internal Used by the extracted mobile-projects-sticky-composer-sheets-ui-* modules. */
    public mountApprovalPolicySheetPresentation(panel: HTMLElement, options: { readonly anchor?: HTMLElement; readonly transcriptOverlay: boolean; readonly onClose: () => void; },): HTMLElement {
        return mountApprovalPolicySheetPresentationExtracted(this, panel, options);
    }

    openApprovalPolicySheet(options: Parameters<typeof openApprovalPolicySheetExtracted>[1]): void {
        openApprovalPolicySheetExtracted(this, options);
    }
    createModeSheetOption(label: string, modeId: string, selectedModeId: string | undefined, onSelect: (modeId: string) => void,): HTMLElement {
        return createModeSheetOptionExtracted(this, label, modeId, selectedModeId, onSelect);
    }
    async resolveModelsForAgentPicker(agentId: string): Promise<QaapQaiqModelOption[]> {
        return resolveModelsForAgentPickerExtracted(this, agentId);
    }
    /** @internal Used by the extracted mobile-projects-sticky-composer-sheets-ui-* modules. */
    public async resolveModelsForAgentPickerSafe(agentId: string,): Promise<{ readonly models: QaapQaiqModelOption[]; readonly loadFailed: boolean }> {
        return resolveModelsForAgentPickerSafeExtracted(this, agentId);
    }
    createComposerAgentPickerChrome(options: { readonly closeTitle: string; readonly onClose: () => void; readonly anchor?: HTMLElement; readonly transcriptOverlay?: boolean; readonly sheetModifierClass?: string; }): ComposerAgentPickerChrome {
        return createComposerAgentPickerChromeExtracted(this, options);
    }
    async renderComposerAgentPicker(chrome: ComposerAgentPickerChrome, options: { readonly view: ComposerAgentPickerView; readonly modelPickerAgentId?: string; readonly cwd: string | undefined; readonly agents: readonly QaapAgentTaskAgentOption[]; readonly selectedAgentId: string | undefined; readonly includeCoder: boolean; readonly agentsTitle?: string; readonly agentsIntro?: string; readonly project?: MobileProjectEntry; readonly onSelectAgent: (agentId: string, model?: QaapQaiqModelOption) => void; readonly onProactiveLogin?: (agentId: string, project?: MobileProjectEntry) => void; readonly onOpenAiFeaturesSettings?: (agentId?: string) => void; },): Promise<void> {
        return renderComposerAgentPickerExtracted(this, chrome, options);
    }
    /** @internal Used by the extracted mobile-projects-sticky-composer-sheets-ui-* modules. */
    public createAgentPickerNoResultsHint(): HTMLElement {
        return createAgentPickerNoResultsHintExtracted(this);
    }
    appendAgentModelPickerList(list: HTMLElement, agentId: string, models: readonly QaapQaiqModelOption[], storedModel: ReturnType<typeof readStoredAgentModel>, onSelect: (model: QaapQaiqModelOption) => void, loadFailed = false, onRetry?: () => void, onOpenAiFeaturesSettings?: () => void,): void {
        appendAgentModelPickerListExtracted(this, list, agentId, models, storedModel, onSelect, loadFailed, onRetry, onOpenAiFeaturesSettings);
    }
}

