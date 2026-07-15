// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import { ChatMode } from '@theia/ai-chat';
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
    renderContextUsagePopover,
    renderContextUsageSheet,
    wireContextUsagePopoverDismiss,
    type ContextUsageBreakdownView,
} from './qaap-chat-context-usage-panel';
import {
    markStickyComposerPopoverAnchor,
    mountStickyComposerBottomSheet,
    mountStickyComposerSheetPopover,
    scheduleStickyComposerPopoverPosition,
    shouldUseStickyComposerDesktopPopover,
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
    agentsHubShellActive?: boolean;
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

    constructor(protected readonly host: MobileProjectsStickyComposerSheetsHost) { }

    protected shouldElevateComposerSheets(): boolean {
        return this.host.agentsHubShellActive === true
            || document.body.classList.contains('theia-mobile-mod-workhub-composer-header')
            || document.body.classList.contains('theia-mobile-mod-workhub-no-bottom-chrome');
    }

    closeStickyComposerSheets(): void {
        this.teardownAgentPickerPopover();
        if (this.host.stickyComposerAgentSheet) {
            this.host.stickyComposerAgentSheet.remove();
            this.host.stickyComposerAgentSheet = undefined;
        }
        this.teardownModeSheetPopover();
        if (this.host.stickyComposerModeSheet) {
            this.host.stickyComposerModeSheet.remove();
            this.host.stickyComposerModeSheet = undefined;
        }
        this.teardownApprovalPolicySheetPopover();
        if (this.host.stickyComposerApprovalSheet) {
            this.host.stickyComposerApprovalSheet.remove();
            this.host.stickyComposerApprovalSheet = undefined;
        }
        this.host.stickyComposerWorkspaceUi.closeComposerWorkspaceSheet();
        this.teardownContextUsagePresentation();
    }

    protected teardownContextUsagePresentation(): void {
        this.contextUsagePopoverCleanup?.();
        this.contextUsagePopoverCleanup = undefined;
        if (this.contextUsageAnchor) {
            this.contextUsageAnchor.setAttribute('aria-expanded', 'false');
            this.contextUsageAnchor.classList.remove('theia-mod-active');
            this.contextUsageAnchor = undefined;
        }
        if (this.host.stickyComposerContextUsageSheet) {
            this.host.stickyComposerContextUsageSheet.remove();
            this.host.stickyComposerContextUsageSheet = undefined;
        }
    }

    closeAllComposerSheets(): void {
        this.closeStickyComposerSheets();
        this.host.closeTranscriptComposerSheets();
    }

    openStickyComposerContextUsageSheet(
        refreshBreakdown: () => ContextUsageBreakdownView,
        transcriptOverlay?: boolean,
        anchor?: HTMLElement,
    ): void {
        const usePopover = shouldUseStickyComposerDesktopPopover(anchor);
        if (usePopover
            && this.contextUsageAnchor === anchor
            && this.host.stickyComposerContextUsageSheet) {
            this.closeAllComposerSheets();
            return;
        }
        this.closeAllComposerSheets();
        const overlay = transcriptOverlay ?? this.shouldElevateComposerSheets();
        const onClose = (): void => { this.closeAllComposerSheets(); };
        const view = refreshBreakdown();
        if (usePopover && anchor) {
            const popover = renderContextUsagePopover(view, {
                transcriptOverlay: overlay,
                onClose,
            });
            document.body.append(popover);
            this.host.stickyComposerContextUsageSheet = popover;
            this.contextUsageAnchor = anchor;
            anchor.setAttribute('aria-expanded', 'true');
            anchor.classList.add('theia-mod-active');
            this.contextUsagePopoverCleanup = wireContextUsagePopoverDismiss(popover, anchor, onClose);
            return;
        }
        const sheet = renderContextUsageSheet(view, {
            transcriptOverlay: overlay,
            onClose,
        });
        document.body.append(sheet);
        this.host.stickyComposerContextUsageSheet = sheet;
    }

    teardownAgentPickerPopover(): void {
        this.agentPopoverCleanup?.();
        this.agentPopoverCleanup = undefined;
        if (this.agentSheetAnchor) {
            markStickyComposerPopoverAnchor(this.agentSheetAnchor, false);
            this.agentSheetAnchor = undefined;
        }
    }

    shouldUseAgentPickerPopover(anchor?: HTMLElement): anchor is HTMLElement {
        return shouldUseStickyComposerDesktopPopover(anchor);
    }

    isAgentPickerPopoverAnchoredTo(anchor?: HTMLElement): boolean {
        return anchor !== undefined && this.agentSheetAnchor === anchor;
    }

    syncAgentPickerPopoverPosition(root: HTMLElement | undefined): void {
        if (!root?.classList.contains('qaap-sticky-composer-sheet-popover') || !this.agentSheetAnchor) {
            return;
        }
        scheduleStickyComposerPopoverPosition(root, this.agentSheetAnchor, this.agentPopoverAlign);
    }

    assignAgentPickerPopover(anchor: HTMLElement, cleanup: (() => void) | undefined): void {
        this.agentSheetAnchor = anchor;
        this.agentPopoverAlign = 'end';
        this.agentPopoverCleanup = cleanup;
    }

    openStickyComposerAgentSheet(project: MobileProjectEntry, anchor?: HTMLElement): void {
        if (this.host.stickyComposerSurface === 'chat') {
            return;
        }
        const usePopover = this.shouldUseAgentPickerPopover(anchor);
        if (usePopover
            && this.agentSheetAnchor === anchor
            && this.host.stickyComposerAgentSheet) {
            this.closeAllComposerSheets();
            return;
        }
        this.closeAllComposerSheets();
        const cwd = this.host.projectsService.getProjectCwd(project) ?? this.host.preparedCwdByProjectId.get(project.id);
        const onClose = (): void => { this.closeAllComposerSheets(); };
        const chrome = this.createComposerAgentPickerChrome({
            closeTitle: nls.localize('qaap/mobileAgentComposer/close', 'Close'),
            onClose,
            anchor,
            transcriptOverlay: this.shouldElevateComposerSheets(),
        });
        document.body.append(chrome.sheet);
        this.host.stickyComposerAgentSheet = chrome.sheet;
        if (this.shouldUseAgentPickerPopover(anchor)) {
            this.assignAgentPickerPopover(anchor, chrome.popoverCleanup);
            scheduleStickyComposerPopoverPosition(chrome.sheet, anchor, this.agentPopoverAlign);
        }
        const loadAgentCatalog = (): void => {
            this.host.stickyComposerAgentsUi.showComposerAgentPickerLoading(chrome);
            this.syncAgentPickerPopoverPosition(chrome.sheet);
            void this.host.stickyComposerAgentsUi.ensureStickyComposerAgentsLoaded(project, { force: true }).then(agents => {
                if (this.host.stickyComposerAgentSheet !== chrome.sheet) {
                    return;
                }
                void this.renderComposerAgentPicker(chrome, {
                view: 'agents',
                cwd,
                agents,
                selectedAgentId: this.host.stickyComposerPinnedAgentId,
                includeCoder: true,
                onSelectAgent: (agentId, model) => {
                    this.host.stickyComposerPinnedAgentId = agentId;
                    if (cwd) {
                        writeStoredAgent(cwd, agentId);
                        if (model) {
                            writeStoredAgentModel(cwd, agentId, model);
                        }
                    }
                    const modes = resolveStickyComposerModes(agentId, this.host.chatAgentService);
                    this.host.stickyComposerModeId = reconcileComposerModeId(undefined, modes, cwd);
                    if (cwd && this.host.stickyComposerModeId) {
                        writeStoredComposerMode(cwd, this.host.stickyComposerModeId);
                    }
                    this.closeAllComposerSheets();
                    this.host.stickyComposerRenderUi.renderStickyComposer();
                },
                });
            }).catch(() => {
                if (this.host.stickyComposerAgentSheet === chrome.sheet) {
                    this.host.stickyComposerAgentsUi.showComposerAgentPickerError(chrome, loadAgentCatalog);
                }
            });
        };
        loadAgentCatalog();
    }
    teardownModeSheetPopover(): void {
        this.modePopoverCleanup?.();
        this.modePopoverCleanup = undefined;
        if (this.modeSheetAnchor) {
            markStickyComposerPopoverAnchor(this.modeSheetAnchor, false);
            this.modeSheetAnchor = undefined;
        }
    }

    isModeSheetPopoverAnchoredTo(anchor?: HTMLElement): boolean {
        return anchor !== undefined && this.modeSheetAnchor === anchor;
    }

    protected mountModeSheetPresentation(
        panel: HTMLElement,
        options: {
            readonly anchor?: HTMLElement;
            readonly transcriptOverlay: boolean;
            readonly onClose: () => void;
        },
    ): HTMLElement {
        this.modePopoverAlign = 'start';
        if (this.shouldUseAgentPickerPopover(options.anchor)) {
            const mounted = mountStickyComposerSheetPopover(panel, {
                anchor: options.anchor,
                onClose: options.onClose,
                align: this.modePopoverAlign,
                transcriptOverlay: options.transcriptOverlay,
                modifierClasses: ['theia-mod-mode-picker'],
            });
            this.modeSheetAnchor = options.anchor;
            this.modePopoverCleanup = mounted.cleanup;
            scheduleStickyComposerPopoverPosition(mounted.root, options.anchor, this.modePopoverAlign);
            return mounted.root;
        }
        return mountStickyComposerBottomSheet(panel, {
            sheetClassName: options.transcriptOverlay
                ? 'theia-mobile-sticky-composer-sheet theia-mod-mode theia-mod-transcript-overlay'
                : 'theia-mobile-sticky-composer-sheet theia-mod-mode',
            onClose: options.onClose,
        });
    }

    openComposerModeSheet(options: {
        readonly modes: readonly ChatMode[];
        readonly selectedModeId: string | undefined;
        readonly cwd: string | undefined;
        readonly anchor?: HTMLElement;
        readonly transcriptOverlay: boolean;
        readonly closeTitle: string;
        readonly onClose: () => void;
        readonly onSelect: (modeId: string) => void;
        readonly assignSheet: (sheet: HTMLElement) => void;
        readonly isOpen?: () => boolean;
    }): void {
        const usePopover = this.shouldUseAgentPickerPopover(options.anchor);
        if (usePopover
            && this.isModeSheetPopoverAnchoredTo(options.anchor)
            && options.isOpen?.()) {
            options.onClose();
            return;
        }
        options.onClose();

        const panel = document.createElement('section');
        panel.className = 'theia-mobile-sticky-composer-sheet-panel';

        const header = document.createElement('header');
        header.className = 'theia-mobile-sticky-composer-sheet-header';
        const title = document.createElement('h2');
        title.textContent = nls.localize('qaap/mobileProjects/stickyComposerPickMode', 'Choose mode');
        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'theia-mobile-sticky-composer-sheet-close codicon codicon-close';
        close.title = options.closeTitle;
        close.setAttribute('aria-label', options.closeTitle);
        close.addEventListener('click', options.onClose);
        header.append(title, close);

        const list = document.createElement('div');
        list.className = 'theia-mobile-sticky-composer-sheet-list';
        for (const mode of options.modes) {
            list.append(this.createModeSheetOption(
                mode.name,
                mode.id,
                options.selectedModeId,
                id => {
                    options.onSelect(id);
                },
            ));
        }

        panel.append(header, list);
        const root = this.mountModeSheetPresentation(panel, {
            anchor: options.anchor,
            transcriptOverlay: options.transcriptOverlay,
            onClose: options.onClose,
        });
        document.body.append(root);
        options.assignSheet(root);
    }

    openStickyComposerModeSheet(
        project: MobileProjectEntry,
        modes: readonly ChatMode[],
        anchor?: HTMLElement,
    ): void {
        const cwd = this.host.projectsService.getProjectCwd(project) ?? this.host.preparedCwdByProjectId.get(project.id);
        this.openComposerModeSheet({
            modes,
            selectedModeId: this.host.stickyComposerModeId,
            cwd,
            anchor,
            transcriptOverlay: this.shouldElevateComposerSheets(),
            closeTitle: nls.localize('qaap/mobileAgentComposer/close', 'Close'),
            onClose: () => this.closeAllComposerSheets(),
            isOpen: () => this.host.stickyComposerModeSheet !== undefined,
            assignSheet: sheet => { this.host.stickyComposerModeSheet = sheet; },
            onSelect: id => {
                this.host.stickyComposerModeId = id;
                if (cwd) {
                    writeStoredComposerMode(cwd, id);
                }
                this.closeAllComposerSheets();
                this.host.stickyComposerRenderUi.renderStickyComposer();
            },
        });
    }
    openStickyComposerApprovalPolicySheet(
        project: MobileProjectEntry,
        agentLabel: string,
        anchor?: HTMLElement,
    ): void {
        const cwd = this.host.projectsService.getProjectCwd(project) ?? this.host.preparedCwdByProjectId.get(project.id);
        this.openApprovalPolicySheet({
            agentLabel,
            cwd,
            anchor,
            transcriptOverlay: this.shouldElevateComposerSheets(),
            selectedId: reconcileAgentApprovalPolicyId(this.host.stickyComposerApprovalPolicyId, cwd),
            toolRules: reconcileAgentToolApprovalRules(
                reconcileAgentApprovalPolicyId(this.host.stickyComposerApprovalPolicyId, cwd),
                cwd,
                this.host.stickyComposerToolApprovalRules,
            ),
            isOpen: () => this.host.stickyComposerApprovalSheet !== undefined,
            onSelect: policyId => {
                this.host.stickyComposerApprovalPolicyId = policyId;
                this.host.stickyComposerToolApprovalRules = reconcileAgentToolApprovalRules(
                    policyId,
                    cwd,
                    this.host.stickyComposerToolApprovalRules,
                );
                if (cwd) {
                    writeStoredAgentApprovalPolicy(cwd, policyId);
                    writeStoredAgentToolApprovalRules(cwd, this.host.stickyComposerToolApprovalRules);
                }
                this.closeAllComposerSheets();
                this.host.stickyComposerRenderUi.renderStickyComposer();
            },
            onToolRulesChange: rules => {
                this.host.stickyComposerToolApprovalRules = rules;
                if (cwd) {
                    writeStoredAgentToolApprovalRules(cwd, rules);
                }
            },
            onClose: () => this.closeAllComposerSheets(),
            assignSheet: sheet => { this.host.stickyComposerApprovalSheet = sheet; },
        });
    }
    teardownApprovalPolicySheetPopover(): void {
        this.approvalPolicyPopoverCleanup?.();
        this.approvalPolicyPopoverCleanup = undefined;
        if (this.approvalPolicySheetAnchor) {
            markStickyComposerPopoverAnchor(this.approvalPolicySheetAnchor, false);
            this.approvalPolicySheetAnchor = undefined;
        }
    }

    isApprovalPolicyPopoverAnchoredTo(anchor?: HTMLElement): boolean {
        return anchor !== undefined && this.approvalPolicySheetAnchor === anchor;
    }

    syncApprovalPolicyPopoverPosition(root: HTMLElement | undefined): void {
        if (!root?.classList.contains('qaap-sticky-composer-sheet-popover') || !this.approvalPolicySheetAnchor) {
            return;
        }
        scheduleStickyComposerPopoverPosition(root, this.approvalPolicySheetAnchor, this.approvalPolicyPopoverAlign);
    }

    protected mountApprovalPolicySheetPresentation(
        panel: HTMLElement,
        options: {
            readonly anchor?: HTMLElement;
            readonly transcriptOverlay: boolean;
            readonly onClose: () => void;
        },
    ): HTMLElement {
        this.approvalPolicyPopoverAlign = 'start';
        if (this.shouldUseAgentPickerPopover(options.anchor)) {
            const mounted = mountStickyComposerSheetPopover(panel, {
                anchor: options.anchor,
                onClose: options.onClose,
                align: this.approvalPolicyPopoverAlign,
                transcriptOverlay: options.transcriptOverlay,
                modifierClasses: ['theia-mod-approval-policy-picker'],
            });
            this.approvalPolicySheetAnchor = options.anchor;
            this.approvalPolicyPopoverCleanup = mounted.cleanup;
            scheduleStickyComposerPopoverPosition(mounted.root, options.anchor, this.approvalPolicyPopoverAlign);
            return mounted.root;
        }
        return mountStickyComposerBottomSheet(panel, {
            sheetClassName: options.transcriptOverlay
                ? 'theia-mobile-sticky-composer-sheet theia-mod-approval-policy theia-mod-transcript-overlay'
                : 'theia-mobile-sticky-composer-sheet theia-mod-approval-policy',
            onClose: options.onClose,
        });
    }

    openApprovalPolicySheet(options: {
        readonly agentLabel: string;
        readonly cwd: string | undefined;
        readonly selectedId: QaapAgentApprovalPolicyId;
        readonly toolRules: QaapAgentToolApprovalRules;
        readonly anchor?: HTMLElement;
        /** Raise above the full-screen transcript overlay (z-index 2147483001). */
        readonly transcriptOverlay?: boolean;
        readonly onSelect: (policyId: QaapAgentApprovalPolicyId) => void;
        readonly onToolRulesChange?: (rules: QaapAgentToolApprovalRules) => void;
        readonly onClose: () => void;
        readonly assignSheet: (sheet: HTMLElement) => void;
        readonly isOpen?: () => boolean;
    }): void {
        const usePopover = this.shouldUseAgentPickerPopover(options.anchor);
        if (usePopover
            && this.isApprovalPolicyPopoverAnchoredTo(options.anchor)
            && options.isOpen?.()) {
            options.onClose();
            return;
        }
        options.onClose();

        const panel = document.createElement('section');
        panel.className = 'theia-mobile-sticky-composer-sheet-panel';

        const header = document.createElement('header');
        header.className = 'theia-mobile-sticky-composer-sheet-header';

        const title = document.createElement('h2');
        title.textContent = nls.localize(
            'qaap/mobileProjects/approvalPolicySheetTitle',
            'How should {0} actions be approved?',
            options.agentLabel,
        );

        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'theia-mobile-sticky-composer-sheet-close codicon codicon-close';
        close.title = nls.localize('qaap/mobileAgentComposer/close', 'Close');
        close.setAttribute('aria-label', close.title);
        close.addEventListener('click', () => options.onClose());

        header.append(title, close);

        const list = document.createElement('div');
        list.className = 'theia-mobile-sticky-composer-sheet-list theia-qaap-approval-policy-sheet-list';
        let selectedId = options.selectedId;
        let toolRules = { ...options.toolRules };
        const toolRulesSection = document.createElement('div');
        toolRulesSection.className = 'theia-mobile-sticky-composer-sheet-list theia-qaap-tool-approval-rules-list';
        let mountedRoot: HTMLElement | undefined;
        const syncPopover = (): void => {
            if (mountedRoot) {
                window.requestAnimationFrame(() => this.syncApprovalPolicyPopoverPosition(mountedRoot));
            }
        };
        const renderToolRules = (): void => {
            toolRulesSection.replaceChildren();
            if (selectedId !== 'approve-for-me' || !options.onToolRulesChange) {
                toolRulesSection.hidden = true;
                syncPopover();
                return;
            }
            toolRulesSection.hidden = false;
            const heading = document.createElement('div');
            heading.className = 'theia-qaap-tool-approval-rules-heading';
            heading.textContent = nls.localize(
                'qaap/mobileProjects/approvalToolRulesHeading',
                'Also auto-approve',
            );
            toolRulesSection.append(
                heading,
                createToolApprovalRuleToggle({
                    label: nls.localize('qaap/mobileProjects/approvalToolShell', 'Terminal commands'),
                    description: nls.localize(
                        'qaap/mobileProjects/approvalToolShellHint',
                        'Shell, git, package installs, and other command execution.',
                    ),
                    checked: toolRules.shell === true,
                    onChange: checked => {
                        toolRules = { ...toolRules, shell: checked };
                        options.onToolRulesChange?.(toolRules);
                        syncPopover();
                    },
                }),
                createToolApprovalRuleToggle({
                    label: nls.localize('qaap/mobileProjects/approvalToolNetwork', 'Network access'),
                    description: nls.localize(
                        'qaap/mobileProjects/approvalToolNetworkHint',
                        'Web fetch, external APIs, and other off-machine access.',
                    ),
                    checked: toolRules.network === true,
                    onChange: checked => {
                        toolRules = { ...toolRules, network: checked };
                        options.onToolRulesChange?.(toolRules);
                        syncPopover();
                    },
                }),
            );
            syncPopover();
        };
        const policyButtons: HTMLButtonElement[] = [];
        for (const policy of QAAP_AGENT_APPROVAL_POLICIES) {
            const button = createApprovalPolicySheetOptionButton({
                policy,
                selected: policy.id === selectedId,
                onSelect: () => {
                    selectedId = policy.id;
                    toolRules = reconcileAgentToolApprovalRules(selectedId, options.cwd, toolRules);
                    for (const entry of policyButtons) {
                        entry.classList.remove('theia-mod-selected');
                    }
                    button.classList.add('theia-mod-selected');
                    renderToolRules();
                    options.onSelect(selectedId);
                    if (selectedId === 'approve-for-me') {
                        options.onToolRulesChange?.(toolRules);
                    }
                },
            });
            policyButtons.push(button);
            list.append(button);
        }
        renderToolRules();

        panel.append(header, list, toolRulesSection);
        mountedRoot = this.mountApprovalPolicySheetPresentation(panel, {
            anchor: options.anchor,
            transcriptOverlay: options.transcriptOverlay === true,
            onClose: options.onClose,
        });
        document.body.append(mountedRoot);
        options.assignSheet(mountedRoot);
        syncPopover();
    }
    createModeSheetOption(
        label: string,
        modeId: string,
        selectedModeId: string | undefined,
        onSelect: (modeId: string) => void,
    ): HTMLElement {
        return createPickerSheetOptionButton({
            label,
            selected: selectedModeId === modeId,
            onSelect: () => {
                onSelect(modeId);
            },
        });
    }
    createAgentSheetOption(
        label: string,
        agentId: string,
        cwd: string | undefined,
        selectedAgentId: string | undefined,
        onSelect: (agentId: string) => void,
    ): HTMLElement {
        return createAgentSheetOptionButton({
            agentId,
            label,
            selected: isStickyComposerAgentSelected(agentId, selectedAgentId, cwd),
            onSelect: () => onSelect(agentId),
        });
    }
    async resolveModelsForAgentPicker(agentId: string): Promise<QaapQaiqModelOption[]> {
        if (agentUsesSettingsModelCatalog(agentId)) {
            const readPref = this.host.readPreference;
            const fromWorkspace = this.host.stickyComposerQaiqModels ?? [];
            const fromPreferences = readPref
                ? listQaiqModelsFromPreferences(readPref)
                : [];
            const registered = this.host.getRegisteredLanguageModels
                ? listQaiqModelsFromRegisteredLanguageModels(
                    await this.host.getRegisteredLanguageModels(),
                    readPref,
                )
                : [];
            const merged = mergeQaiqModelOptions(registered, fromWorkspace, fromPreferences);
            return readPref
                ? filterQaiqModelsWithConfiguredCredentials(merged, readPref)
                : merged;
        }
        try {
            return await fetchAgentModelsForAgent(agentId);
        } catch {
            throw new Error('agent-model-catalog-fetch-failed');
        }
    }
    protected async resolveModelsForAgentPickerSafe(
        agentId: string,
    ): Promise<{ readonly models: QaapQaiqModelOption[]; readonly loadFailed: boolean }> {
        try {
            const models = await this.resolveModelsForAgentPicker(agentId);
            return { models, loadFailed: false };
        } catch {
            return { models: [], loadFailed: true };
        }
    }
    createComposerAgentPickerChrome(options: {
        readonly closeTitle: string;
        readonly onClose: () => void;
        readonly anchor?: HTMLElement;
        readonly transcriptOverlay?: boolean;
    }): ComposerAgentPickerChrome {
        const panel = document.createElement('section');
        panel.className = 'theia-mobile-sticky-composer-sheet-panel';

        const header = document.createElement('header');
        header.className = 'theia-mobile-sticky-composer-sheet-header';

        const backBtn = document.createElement('button');
        backBtn.type = 'button';
        backBtn.className = 'theia-mobile-sticky-composer-sheet-back codicon codicon-arrow-left';
        backBtn.hidden = true;
        backBtn.title = nls.localize('qaap/mobileProjects/backToAgents', 'Back to agents');
        backBtn.setAttribute('aria-label', backBtn.title);

        const title = document.createElement('h2');
        title.textContent = nls.localize('qaap/mobileProjects/stickyComposerPickAgent', 'Choose agent');

        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'theia-mobile-sticky-composer-sheet-close codicon codicon-close';
        close.title = options.closeTitle;
        close.setAttribute('aria-label', options.closeTitle);
        close.addEventListener('click', options.onClose);

        header.append(backBtn, title, close);

        const intro = document.createElement('p');
        intro.className = 'theia-qaap-agent-sheet-default-hint';

        const search = document.createElement('div');
        search.className = 'theia-qaap-agent-sheet-search';
        const searchInput = document.createElement('input');
        searchInput.className = 'theia-qaap-agent-sheet-search-input';
        searchInput.type = 'search';
        searchInput.autocomplete = 'off';
        searchInput.spellcheck = false;
        searchInput.placeholder = nls.localize(
            'qaap/mobileProjects/stickyComposerSearchAgentsModels',
            'Search agents and models',
        );
        searchInput.setAttribute('aria-label', searchInput.placeholder);
        search.append(searchInput);

        const list = document.createElement('div');
        list.className = 'theia-mobile-sticky-composer-sheet-list';

        panel.append(header, intro, search, list);

        if (this.shouldUseAgentPickerPopover(options.anchor)) {
            const mounted = mountStickyComposerSheetPopover(panel, {
                anchor: options.anchor,
                onClose: options.onClose,
                align: 'end',
                transcriptOverlay: options.transcriptOverlay,
                modifierClasses: ['theia-mod-agent-picker'],
            });
            return {
                sheet: mounted.root,
                header,
                title,
                backBtn,
                intro,
                searchInput,
                list,
                modelsByAgent: new Map(),
                modelLoadFailedByAgent: new Map(),
                onClose: options.onClose,
                popoverCleanup: mounted.cleanup,
            };
        }

        const sheet = mountStickyComposerBottomSheet(panel, {
            sheetClassName: options.transcriptOverlay
                ? 'theia-mobile-sticky-composer-sheet theia-mod-agent theia-mod-transcript-overlay'
                : 'theia-mobile-sticky-composer-sheet theia-mod-agent',
            onClose: options.onClose,
        });

        return {
            sheet,
            header,
            title,
            backBtn,
            intro,
            searchInput,
            list,
            modelsByAgent: new Map(),
            modelLoadFailedByAgent: new Map(),
            onClose: options.onClose,
        };
    }
    async renderComposerAgentPicker(
        chrome: ComposerAgentPickerChrome,
        options: {
            readonly view: ComposerAgentPickerView;
            readonly modelPickerAgentId?: string;
            readonly cwd: string | undefined;
            readonly agents: readonly QaapAgentTaskAgentOption[];
            readonly selectedAgentId: string | undefined;
            readonly includeCoder: boolean;
            readonly onSelectAgent: (agentId: string, model?: QaapQaiqModelOption) => void;
        },
    ): Promise<void> {
        const renderGeneration = Number(chrome.sheet.dataset.agentPickerRenderGeneration ?? '0') + 1;
        chrome.sheet.dataset.agentPickerRenderGeneration = String(renderGeneration);
        const rerender = (): void => {
            void this.renderComposerAgentPicker(chrome, options);
        };
        const wireSearchKeyboard = (onlyResult?: HTMLElement): void => {
            chrome.searchInput.oninput = rerender;
            chrome.searchInput.onkeydown = event => {
                if (event.key === 'Escape') {
                    event.preventDefault();
                    event.stopPropagation();
                    if (chrome.searchInput.value) {
                        chrome.searchInput.value = '';
                        rerender();
                    } else {
                        chrome.onClose();
                    }
                } else if (event.key === 'Enter' && onlyResult) {
                    event.preventDefault();
                    onlyResult.click();
                }
            };
        };
        if (chrome.searchInput.dataset.initialFocusApplied !== 'true') {
            chrome.searchInput.dataset.initialFocusApplied = 'true';
            window.requestAnimationFrame(() => chrome.searchInput.focus({ preventScroll: true }));
        }
        if (options.view === 'models' && options.modelPickerAgentId) {
            const modelAgentId = options.modelPickerAgentId;
            let pickerModels = chrome.modelsByAgent.get(modelAgentId);
            const loadFailed = chrome.modelLoadFailedByAgent.get(modelAgentId) === true;
            if (pickerModels === undefined || (pickerModels.length === 0 && loadFailed)) {
                renderAgentPickerSkeleton(chrome.list, 5);
                const resolved = await this.resolveModelsForAgentPickerSafe(modelAgentId);
                if (chrome.sheet.dataset.agentPickerRenderGeneration !== String(renderGeneration)) {
                    return;
                }
                pickerModels = resolved.models;
                chrome.modelsByAgent.set(modelAgentId, pickerModels);
                if (resolved.loadFailed) {
                    chrome.modelLoadFailedByAgent.set(modelAgentId, true);
                } else {
                    chrome.modelLoadFailedByAgent.delete(modelAgentId);
                }
            }
            if (chrome.sheet.dataset.agentPickerRenderGeneration !== String(renderGeneration)) {
                return;
            }
            const storedModel = readStoredAgentModel(options.cwd, modelAgentId);
            chrome.header.classList.add('theia-mod-drilldown');
            chrome.backBtn.hidden = false;
            chrome.intro.hidden = true;
            const modelAgentLabel = options.agents.find(agent => agent.id === modelAgentId)?.label ?? modelAgentId;
            chrome.title.textContent = nls.localize(
                'qaap/mobileProjects/stickyComposerPickModelForAgent',
                'Choose model for {0}',
                modelAgentLabel,
            );
            chrome.backBtn.onclick = () => {
                void this.renderComposerAgentPicker(chrome, { ...options, view: 'agents', modelPickerAgentId: undefined });
            };
            const filteredModels = (pickerModels ?? []).filter(model => modelMatchesAgentPickerQuery(model, chrome.searchInput.value));
            const modelContent = document.createElement('div');
            this.appendAgentModelPickerList(
                modelContent,
                modelAgentId,
                filteredModels,
                storedModel,
                model => options.onSelectAgent(modelAgentId, model),
                chrome.modelLoadFailedByAgent.get(modelAgentId) === true,
                () => {
                    chrome.modelsByAgent.delete(modelAgentId);
                    chrome.modelLoadFailedByAgent.delete(modelAgentId);
                    rerender();
                },
            );
            if ((pickerModels?.length ?? 0) > 0 && filteredModels.length === 0) {
                replaceAgentPickerLoading(chrome.list, this.createAgentPickerNoResultsHint());
            } else {
                replaceAgentPickerLoading(chrome.list, ...Array.from(modelContent.childNodes));
            }
            const modelButtons = chrome.list.querySelectorAll<HTMLElement>('.theia-mobile-sticky-composer-sheet-option');
            wireSearchKeyboard(modelButtons.length === 1 ? modelButtons[0] : undefined);
            window.requestAnimationFrame(() => this.syncAgentPickerPopoverPosition(chrome.sheet));
            return;
        }

        chrome.header.classList.remove('theia-mod-drilldown');
        chrome.backBtn.hidden = true;
        chrome.backBtn.onclick = null;
        chrome.intro.hidden = false;
        chrome.title.textContent = nls.localize('qaap/mobileProjects/stickyComposerPickAgent', 'Choose agent');
        chrome.intro.textContent = nls.localize(
            'qaap/mobileProjects/stickyComposerAgentDefaultHint',
            'QAIQ is the default Qaap agent. Codex, Claude Code, and others are optional alternatives.',
        );

        const agentEntries: QaapAgentPickerSearchEntry[] = [];
        if (options.includeCoder) {
            const coder = this.host.stickyComposerAgentsUi.getOfferableCoderAgent();
            if (coder) {
                agentEntries.push({ id: THEIA_CODER_AGENT_ID, label: coder.name, models: [] });
            }
        }
        for (const agent of options.agents) {
            agentEntries.push({ id: agent.id, label: agent.label, models: [] });
        }
        if (agentEntries.some(entry => agentSupportsModelPicker(entry.id) && !chrome.modelsByAgent.has(entry.id))) {
            renderAgentPickerSkeleton(chrome.list);
        }
        await Promise.all(agentEntries.map(async entry => {
            let models = chrome.modelsByAgent.get(entry.id);
            if (models === undefined) {
                if (agentSupportsModelPicker(entry.id)) {
                    const resolved = await this.resolveModelsForAgentPickerSafe(entry.id);
                    models = resolved.models;
                    if (chrome.sheet.dataset.agentPickerRenderGeneration === String(renderGeneration)) {
                        if (resolved.loadFailed) {
                            chrome.modelLoadFailedByAgent.set(entry.id, true);
                        } else {
                            chrome.modelLoadFailedByAgent.delete(entry.id);
                        }
                    }
                } else {
                    models = [];
                }
            }
            if (chrome.sheet.dataset.agentPickerRenderGeneration === String(renderGeneration)) {
                chrome.modelsByAgent.set(entry.id, models);
            }
            (entry as { models: readonly QaapQaiqModelOption[] }).models = models;
        }));
        if (chrome.sheet.dataset.agentPickerRenderGeneration !== String(renderGeneration)) {
            return;
        }

        const searchResults = buildAgentPickerSearchResults(agentEntries, chrome.searchInput.value);
        const content = document.createDocumentFragment();
        const appendAgent = (entry: QaapAgentPickerSearchEntry): void => {
            const { id: agentId, label } = entry;
            const hasModels = agentSupportsModelPicker(agentId);
            const agentSelected = isStickyComposerAgentSelected(agentId, options.selectedAgentId, options.cwd);
            const storedModel = readStoredAgentModel(options.cwd, agentId);
            let displayLabel = label;
            if (storedModel?.modelId && agentSelected) {
                displayLabel = `${label} · ${formatQaiqModelSelectionLabel(storedModel)}`;
            }
            content.append(createAgentSheetOptionButton({
                agentId,
                label: displayLabel,
                selected: agentSelected,
                submenuChevron: hasModels ? 'forward' : undefined,
                onSelect: () => {
                    void activateAgentPickerEntry({
                        agentId,
                        supportsModels: hasModels,
                        cachedModels: chrome.modelsByAgent.get(agentId),
                        loadModels: async () => {
                            const resolved = await this.resolveModelsForAgentPickerSafe(agentId);
                            if (resolved.loadFailed) {
                                chrome.modelLoadFailedByAgent.set(agentId, true);
                            } else {
                                chrome.modelLoadFailedByAgent.delete(agentId);
                            }
                            return resolved.models;
                        },
                        onLoading: () => {
                            // Invalidate any in-flight agents-list render so it cannot replace
                            // this activation skeleton and race the drill-down navigation.
                            chrome.sheet.dataset.agentPickerRenderGeneration = String(
                                Number(chrome.sheet.dataset.agentPickerRenderGeneration ?? '0') + 1,
                            );
                            renderAgentPickerSkeleton(chrome.list, 5);
                        },
                        onModelsResolved: models => chrome.modelsByAgent.set(agentId, models),
                        onShowModels: () => {
                            if (chrome.searchInput.value
                                && !(chrome.modelsByAgent.get(agentId) ?? [])
                                    .some(model => modelMatchesAgentPickerQuery(model, chrome.searchInput.value))) {
                                chrome.searchInput.value = '';
                            }
                            void this.renderComposerAgentPicker(chrome, {
                                ...options,
                                view: 'models',
                                modelPickerAgentId: agentId,
                            });
                        },
                        onSelectDirect: () => options.onSelectAgent(agentId),
                    });
                },
            }));
        };

        for (const entry of searchResults.directAgents) {
            appendAgent(entry);
        }
        for (const [groupIndex, group] of searchResults.modelGroups.entries()) {
            const section = document.createElement('section');
            section.className = 'theia-qaap-agent-sheet-inline-model-group';
            section.dataset.agentId = group.agent.id;
            const heading = createAgentBrandChip({
                agentId: group.agent.id,
                label: group.agent.label,
            });
            heading.classList.add('theia-qaap-agent-sheet-inline-model-group-heading');
            heading.id = `qaap-agent-model-group-${renderGeneration}-${groupIndex}`;
            section.setAttribute('aria-labelledby', heading.id);
            section.append(heading);
            const storedModel = readStoredAgentModel(options.cwd, group.agent.id);
            const agentSelected = isStickyComposerAgentSelected(
                group.agent.id,
                options.selectedAgentId,
                options.cwd,
            );
            for (const model of group.models) {
                section.append(createAgentPickerInlineModelButton({
                    agentId: group.agent.id,
                    model,
                    selected: agentSelected && isSameAgentModel(storedModel, model),
                    onSelect: options.onSelectAgent,
                }));
            }
            content.append(section);
        }
        const resultCount = searchResults.directAgents.length
            + searchResults.modelGroups.reduce((count, group) => count + group.models.length, 0);
        if (agentEntries.length > 0 && resultCount === 0) {
            content.append(this.createAgentPickerNoResultsHint());
        } else if (agentEntries.length === 0) {
            const hint = document.createElement('p');
            hint.className = 'theia-qaap-agent-sheet-empty-models';
            const agentConfigured = this.host.activeTasks?.isAgentConfigured() ?? false;
            hint.textContent = agentConfigured
                ? nls.localize(
                    'qaap/mobileProjects/stickyComposerNoAgentsFiltered',
                    'Agents were detected on the server but none are selectable in this composer. Restart the backend after installing CLIs (qaiq, codex, claude, …).',
                )
                : nls.localize(
                    'qaap/mobileProjects/stickyComposerNoAgents',
                    'No agents are available. Install a VPS agent CLI on PATH (qaiq, codex, claude) or set QAAP_AGENT_COMMAND, then restart the backend.',
                );
            content.append(hint);
        }
        replaceAgentPickerLoading(chrome.list, content);
        const resultButtons = chrome.list.querySelectorAll<HTMLElement>(
            '.theia-qaap-agent-sheet-option, .theia-qaap-agent-sheet-inline-model',
        );
        wireSearchKeyboard(resultButtons.length === 1 ? resultButtons[0] : undefined);
        window.requestAnimationFrame(() => this.syncAgentPickerPopoverPosition(chrome.sheet));
    }
    protected createAgentPickerNoResultsHint(): HTMLElement {
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
    appendAgentModelPickerList(
        list: HTMLElement,
        agentId: string,
        models: readonly QaapQaiqModelOption[],
        storedModel: ReturnType<typeof readStoredAgentModel>,
        onSelect: (model: QaapQaiqModelOption) => void,
        loadFailed = false,
        onRetry?: () => void,
    ): void {
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
        if (models.length === 0) {
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
        for (const [vendor, providerModels] of groupQaiqModelsByProvider(models)) {
            const section = document.createElement('div');
            section.className = 'theia-qaap-agent-sheet-provider';
            const label = document.createElement('div');
            label.className = 'theia-qaap-agent-sheet-provider-label';
            appendLlmProviderIcon(label, vendor, providerModels[0]?.modelId, 'sm');
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
}

