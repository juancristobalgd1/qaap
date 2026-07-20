// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import { ChatMode } from '@theia/ai-chat';
import type { QaapComposerSurface } from '../common/qaap-composer-surface';
import {
    attachStickyComposerMentionUi,
    type StickyComposerTokenOption,
} from '../common/qaap-sticky-composer-mention';
import type { StickyComposerSlashSection } from '../common/qaap-sticky-composer-slash-menu';
import { attachStickyComposerSyntaxHighlight } from '../common/qaap-sticky-composer-syntax-highlight';
import {
    resolveAgentApprovalPolicyOption,
    type QaapAgentApprovalPolicyId,
} from '../common/qaap-sticky-composer-approval-policy';
import { formatQaiqModelSelectionLabel } from '../common/qaap-qaiq-model-catalog';
import {
    populateAgentToolbarButton,
    populateApprovalPolicyToolbarButton,
} from './qaap-agent-ui';
import {
    renderStickyComposerContextStrip,
    type StickyComposerContextChipView,
} from './qaap-sticky-composer-context-ui';
import {
    createContextUsageIndicatorBadge,
} from './qaap-chat-context-usage-indicator';
import type { StickyComposerContextEntry } from '../common/qaap-composer-context-entry';
import type { AIVariableResolutionRequest } from '@theia/ai-core';
import type { MobileProjectEntry } from './mobile-projects-types';
import { bindStickyComposerControlClick } from '../common/qaap-sticky-composer-control-click';
import {
    handleStickyComposerPromptHistoryKeydown,
    recordStickyComposerPromptSubmission,
} from './qaap-sticky-composer-prompt-history';
import {
    estimateQaapAgentTask,
    formatQaapAgentTaskEstimate,
} from '../common/qaap-agent-task-estimate';

export interface MobileProjectsStickyComposerColumnHost {
stickyComposerAgentsUi: import('./mobile-projects-sticky-composer-agents-ui').MobileProjectsStickyComposerAgentsUi;
stickyComposerWorkspaceUi: import('./mobile-projects-sticky-composer-workspace-ui').MobileProjectsStickyComposerWorkspaceUi;
resolveAttachmentPreview?: (item: AIVariableResolutionRequest) => Promise<string | undefined>;
}

export class MobileProjectsStickyComposerColumnUi {
    constructor(protected readonly host: MobileProjectsStickyComposerColumnHost) { }

    buildStickyComposerColumn(options: {
        project: MobileProjectEntry;
        surface?: QaapComposerSurface;
        agentLocked?: boolean;
        getContext: () => StickyComposerContextEntry[];
        clearContext: () => void;
        removeContextItem: (index: number) => void;
        formatContextChip: (item: StickyComposerContextEntry) => StickyComposerContextChipView;
        filesExpanded?: boolean;
        onFilesExpandedChange?: (expanded: boolean) => void;
        activityStack?: HTMLElement;
        changesPill?: HTMLElement;
        getDraft: () => string;
        setDraft: (value: string) => void;
        resolveAgentLabel: () => string;
        resolveAgentId: () => string;
        resolveAgentModel?: () => { readonly vendor: string; readonly modelId: string } | undefined;
        composerCwd?: string;
        modes?: readonly ChatMode[];
        resolveModeLabel?: () => string;
        onOpenModeSheet?: (anchor: HTMLButtonElement) => void;
        approvalPolicyId?: QaapAgentApprovalPolicyId;
        onOpenApprovalPolicySheet?: (anchor: HTMLButtonElement) => void;
        canSubmit: boolean;
        isAgentWorking?: () => boolean;
        isAgentBeamIdle?: () => boolean;
        onStop?: () => void;
        stopLabel?: string;
        onAttach: (anchor: HTMLElement) => void;
        onOpenAgentSheet: (anchor: HTMLButtonElement) => void;
        onSubmit: (draft: string) => void;
        onSubmitBlocked?: () => void;
        afterInputChange?: () => void;
        sendLabel?: string;
        onSendControlMounted?: (refresh: () => void) => void;
        onImprovePrompt?: (context: import('./qaap-composer-prompt-improve-handler').StickyComposerImprovePromptContext) => void;
        inputPlaceholder?: string;
        getMentionOptions?: () => readonly StickyComposerTokenOption[];
        getVariableOptions?: () => readonly StickyComposerTokenOption[];
        getSkillOptions?: () => readonly StickyComposerTokenOption[];
        getSlashMenuSections?: () => readonly StickyComposerSlashSection[];
        onSlashAction?: (actionId: import('../common/qaap-sticky-composer-slash-menu').StickyComposerSlashActionId, prompt: string) => void | Promise<void>;
        getInstalledMcpServerSlugs?: () => readonly string[];
        onInstallMcpPlugin?: (pluginId: string) => void | Promise<void>;
        onRemoveMcpServer?: (slug: string) => void | Promise<void>;
        onBrowseMcpMarketplace?: () => void | Promise<void>;
        getSkillNames?: () => readonly string[];
        onContextUsageBadgeMounted?: (badge: HTMLButtonElement) => void;
        onOpenContextUsageSheet?: (anchor: HTMLButtonElement) => void;
        transcriptOverlay?: boolean;
    }): HTMLElement {
        const column = document.createElement('div');
        column.className = 'theia-mobile-projects-sticky-composer-column';
        const contextItems = options.getContext();
        if (contextItems.length > 0) {
            column.classList.add('theia-mod-has-context');
        }

        if (options.surface) {
            column.classList.add(`theia-mod-surface-${options.surface}`);
        }

        const toolbar = document.createElement('div');
        toolbar.className = 'theia-mobile-projects-sticky-composer-toolbar';

        const wrap = document.createElement('div');
        wrap.className = 'theia-mobile-projects-sticky-composer-inner';

        const attachBtn = document.createElement('button');
        attachBtn.type = 'button';
        attachBtn.className = 'theia-mobile-projects-sticky-composer-attach';
        const attachLabel = nls.localize('theia/ai/chat-ui/attachToContext', 'Attach elements to context');
        attachBtn.title = attachLabel;
        attachBtn.setAttribute('aria-label', attachLabel);
        attachBtn.innerHTML = '<span class="codicon codicon-add" aria-hidden="true"></span>';
        attachBtn.setAttribute('aria-haspopup', 'menu');
        attachBtn.setAttribute('aria-expanded', 'false');
        if (contextItems.length > 0) {
            attachBtn.classList.add('theia-mod-has-context');
        }
        bindStickyComposerControlClick(attachBtn, ev => {
            ev.stopPropagation();
            options.onAttach(attachBtn);
        });

        let approvalBtn: HTMLButtonElement | undefined;
        let bindApprovalPolicyClick: (() => void) | undefined;
        if (options.approvalPolicyId && options.onOpenApprovalPolicySheet) {
            const approvalPolicy = resolveAgentApprovalPolicyOption(options.approvalPolicyId);
            approvalBtn = document.createElement('button');
            approvalBtn.type = 'button';
            approvalBtn.className = 'theia-mobile-projects-sticky-composer-approval-policy';
            approvalBtn.title = nls.localize(
                'qaap/mobileProjects/stickyComposerApprovalPolicy',
                'Approval policy: {0}',
                approvalPolicy.label,
            );
            approvalBtn.setAttribute('aria-label', approvalBtn.title);
            approvalBtn.setAttribute('aria-haspopup', 'dialog');
            populateApprovalPolicyToolbarButton(approvalBtn, approvalPolicy);
            const approvalButton = approvalBtn;
            bindApprovalPolicyClick = () => {
                bindStickyComposerControlClick(approvalButton, ev => {
                    this.openComposerControlSheet(ev, input, () => options.onOpenApprovalPolicySheet!(approvalButton));
                });
            };
        }

        const controlsLeftItems: HTMLElement[] = [];
        const agentBtn = document.createElement('button');
        agentBtn.type = 'button';
        agentBtn.className = 'theia-mobile-projects-sticky-composer-agent';
        const agentLabel = options.resolveAgentLabel();
        const agentId = options.resolveAgentId();
        const agentModel = options.resolveAgentModel?.()
            ?? this.host.stickyComposerAgentsUi.resolveStickyComposerAgentModel(
                agentId,
                options.project,
                options.composerCwd,
            );
        const modelLabel = agentModel ? formatQaiqModelSelectionLabel(agentModel) : undefined;
        agentBtn.title = modelLabel
            ? nls.localize('qaap/mobileProjects/stickyComposerAgentWithModel', 'Agent: {0}, model: {1}', agentLabel, modelLabel)
            : nls.localize('qaap/mobileProjects/stickyComposerAgent', 'Agent: {0}', agentLabel);
        agentBtn.setAttribute('aria-label', agentBtn.title);
        populateAgentToolbarButton(agentBtn, {
            agentId,
            label: agentLabel,
            agentModel,
        });
        if (options.agentLocked) {
            agentBtn.classList.add('theia-mod-locked');
            agentBtn.disabled = true;
        }
        controlsLeftItems.push(agentBtn);

        const modes = options.modes ?? [];
        let modeBtn: HTMLButtonElement | undefined;
        if (modes.length > 1 && options.onOpenModeSheet && options.resolveModeLabel) {
            modeBtn = document.createElement('button');
            modeBtn.type = 'button';
            modeBtn.className = 'theia-mobile-projects-sticky-composer-mode';
            const modeLabel = options.resolveModeLabel();
            modeBtn.title = nls.localize('qaap/mobileProjects/stickyComposerMode', 'Mode: {0}', modeLabel);
            modeBtn.setAttribute('aria-label', modeBtn.title);
            modeBtn.innerHTML = `<span class="theia-mobile-projects-sticky-composer-mode-label">${modeLabel}</span>`
                + '<span class="codicon codicon-chevron-down" aria-hidden="true"></span>';
            const modeButton = modeBtn;
            bindStickyComposerControlClick(modeBtn, ev => {
                this.openComposerControlSheet(ev, input, () => options.onOpenModeSheet!(modeButton));
            });
        }

        const toolbarItems: HTMLElement[] = [];
        if (modeBtn) {
            toolbarItems.push(modeBtn);
        }
        if (approvalBtn) {
            toolbarItems.push(approvalBtn);
        }

        toolbar.append(...toolbarItems);
        const usageBadge = createContextUsageIndicatorBadge();
        usageBadge.classList.add('theia-mobile-projects-sticky-composer-context-usage');
        const trayRight = document.createElement('div');
        trayRight.className = 'theia-mobile-projects-sticky-composer-tray-right';
        trayRight.append(usageBadge);
        toolbar.append(trayRight);

        const stage = document.createElement('div');
        stage.className = 'theia-mobile-projects-sticky-composer-stage';

        const inputPanel = document.createElement('div');
        inputPanel.className = 'theia-mobile-projects-sticky-composer-input-wrap theia-mobile-projects-sticky-composer-input-panel theia-mod-codex';

        const input = document.createElement('textarea');
        input.className = 'theia-mobile-projects-sticky-composer-input';
        input.rows = 2;
        input.setAttribute('rows', '2');
        const placeholderAgent = options.resolveAgentLabel();
        input.placeholder = options.inputPlaceholder ?? nls.localize(
            'qaap/mobileProjects/stickyComposerPlaceholder',
            'Message {0} on {1}',
            placeholderAgent,
            options.project.name,
        );
        input.value = options.getDraft();
        input.disabled = !options.canSubmit;
        bindApprovalPolicyClick?.();

        const sendBtn = document.createElement('button');
        sendBtn.type = 'button';
        sendBtn.className = 'theia-mobile-projects-sticky-composer-send';
        sendBtn.disabled = true;
        const sendLabel = options.sendLabel ?? nls.localize('qaap/mobileProjects/inlineStart', 'Start');
        const estimateBadge = document.createElement('span');
        estimateBadge.className = 'theia-mobile-projects-sticky-composer-cost-estimate';
        estimateBadge.hidden = true;
        sendBtn.title = sendLabel;
        sendBtn.setAttribute('aria-label', sendLabel);
        sendBtn.replaceChildren(createStickyComposerSendIcon());

        const improveBtn = document.createElement('button');
        improveBtn.type = 'button';
        improveBtn.className = 'qaap-composer-improve-btn';
        const improveLabel = nls.localize('qaap/composer/improvePrompt', 'Improve prompt');
        const cancelImproveLabel = nls.localize('qaap/composer/cancelImprovePrompt', 'Cancel prompt improvement');
        improveBtn.title = improveLabel;
        improveBtn.setAttribute('aria-label', improveLabel);
        const improveIcon = document.createElement('span');
        improveIcon.className = 'codicon codicon-sparkle';
        improveIcon.setAttribute('aria-hidden', 'true');
        const improveBloom = document.createElement('div');
        improveBloom.className = 'qaap-border-beam-bloom';
        improveBloom.setAttribute('aria-hidden', 'true');
        improveBtn.append(improveIcon, improveBloom);

        let lastSendIcon: 'send' | 'stop' | undefined;
        const updateSend = (): void => {
            const has = input.value.trim().length > 0;
            const improving = improveBtn.classList.contains('theia-mod-busy');
            const working = options.isAgentWorking?.() ?? false;
            const beamIdle = working && (options.isAgentBeamIdle?.() ?? false);
            inputPanel.classList.toggle('theia-mod-agent-working', working && !beamIdle);
            inputPanel.classList.toggle('theia-mod-agent-working-idle', beamIdle);
            const showStop = working && !has;
            const sendLabel = options.sendLabel ?? nls.localize('qaap/mobileProjects/inlineStart', 'Start');
            const stopLabel = options.stopLabel ?? nls.localize('qaap/mobileProjects/cancelTaskRun', 'Cancel run');
            sendBtn.classList.toggle('theia-mod-stop', showStop);
            sendBtn.classList.toggle('theia-mod-ready', !showStop && has && options.canSubmit);
            const nextIcon: 'send' | 'stop' = showStop ? 'stop' : 'send';
            if (showStop) {
                sendBtn.disabled = false;
                sendBtn.title = stopLabel;
                sendBtn.setAttribute('aria-label', stopLabel);
                if (lastSendIcon !== nextIcon) {
                    sendBtn.innerHTML = '<span class="codicon codicon-debug-stop" aria-hidden="true"></span>';
                    lastSendIcon = nextIcon;
                }
            } else {
                sendBtn.disabled = !has || !options.canSubmit;
                sendBtn.title = sendLabel;
                sendBtn.setAttribute('aria-label', sendLabel);
                if (lastSendIcon !== nextIcon) {
                    sendBtn.replaceChildren(createStickyComposerSendIcon());
                    lastSendIcon = nextIcon;
                }
            }
            improveBtn.disabled = !has && !improving;
            const estimate = estimateQaapAgentTask(input.value);
            estimateBadge.hidden = !has || !estimate.visible || working;
            estimateBadge.classList.toggle('theia-mod-large', estimate.size === 'large');
            estimateBadge.textContent = formatQaapAgentTaskEstimate(estimate);
            estimateBadge.title = nls.localize(
                'qaap/mobileProjects/taskEstimateDisclaimer',
                'Estimated range before submit. Actual usage depends on repository context, tools, model, and retries.',
            );
            improveBtn.classList.toggle('theia-mod-has-text', has);
            if (improving) {
                improveBtn.title = cancelImproveLabel;
                improveBtn.setAttribute('aria-label', cancelImproveLabel);
            } else {
                improveBtn.title = improveLabel;
                improveBtn.setAttribute('aria-label', improveLabel);
            }
        };
        input.addEventListener('input', () => {
            options.setDraft(input.value);
            options.afterInputChange?.();
            updateSend();
        });
        updateSend();
        options.onSendControlMounted?.(updateSend);

        bindStickyComposerControlClick(improveBtn, ev => {
            ev.preventDefault();
            ev.stopPropagation();
            if (!options.onImprovePrompt) {
                return;
            }
            const has = input.value.trim().length > 0;
            if (!has && !improveBtn.classList.contains('theia-mod-busy')) {
                return;
            }
            options.onImprovePrompt({
                input,
                improveBtn,
                getPrompt: () => input.value,
                setDraft: value => {
                    options.setDraft(value);
                },
                refreshControls: updateSend,
            });
        });

        const inputEditor = document.createElement('div');
        inputEditor.className = 'theia-mobile-projects-sticky-composer-input-editor';
        inputEditor.append(input);
        const syntaxHighlight = options.getSkillNames || options.getSlashMenuSections
            ? attachStickyComposerSyntaxHighlight({
                inputEditor,
                input,
                getSkillNames: options.getSkillNames,
                getSlashCommandNames: () => options.getSlashMenuSections?.()
                    .flatMap(section => section.entries.map(entry => entry.label)) ?? [],
            })
            : undefined;

        if (options.getMentionOptions || options.getVariableOptions || options.getSkillOptions || options.getSlashMenuSections) {
            attachStickyComposerMentionUi({
                inputWrap: inputPanel,
                input,
                getMentionOptions: options.getMentionOptions ?? (() => []),
                getVariableOptions: options.getVariableOptions,
                getSkillOptions: options.getSkillOptions,
                getSlashMenuSections: options.getSlashMenuSections,
                onSlashAction: options.onSlashAction,
                getInstalledMcpServerSlugs: options.getInstalledMcpServerSlugs,
                onInstallMcpPlugin: options.onInstallMcpPlugin,
                onRemoveMcpServer: options.onRemoveMcpServer,
                onBrowseMcpMarketplace: options.onBrowseMcpMarketplace,
                onDraftChange: value => {
                    options.setDraft(value);
                    syntaxHighlight?.refresh();
                    updateSend();
                },
                afterInputChange: options.afterInputChange,
                mentionButtonTitle: nls.localize('qaap/mobileProjects/stickyComposerMention', 'Mention agent (@)'),
                variableButtonTitle: nls.localize('qaap/mobileProjects/stickyComposerVariable', 'Insert variable (#)'),
            });
        }

        let submitInFlight = false;
        let lastSubmitAt = 0;
        let lastSubmitDraft = '';
        const submitCooldownMs = 600;
        const submit = (): void => {
            const draft = input.value.trim();
            const now = Date.now();
            if (!draft || !options.canSubmit) {
                if (!submitInFlight) {
                    options.onSubmitBlocked?.();
                }
                return;
            }
            if (submitInFlight || (draft === lastSubmitDraft && now - lastSubmitAt < submitCooldownMs)) {
                return;
            }
            submitInFlight = true;
            lastSubmitAt = now;
            lastSubmitDraft = draft;
            recordStickyComposerPromptSubmission(input, draft);
            input.value = '';
            options.setDraft('');
            updateSend();
            try {
                options.onSubmit(draft);
            } finally {
                window.setTimeout(() => {
                    submitInFlight = false;
                }, submitCooldownMs);
            }
        };
        input.addEventListener('keydown', ev => {
            if (handleStickyComposerPromptHistoryKeydown(input, ev, {
                setDraft: value => { options.setDraft(value); },
                afterInputChange: options.afterInputChange,
            })) {
                updateSend();
                return;
            }
            if (ev.key === 'Enter' && !ev.shiftKey && !ev.defaultPrevented) {
                ev.preventDefault();
                submit();
            }
        });
        bindStickyComposerControlClick(sendBtn, ev => {
            ev.preventDefault();
            ev.stopPropagation();
            const has = input.value.trim().length > 0;
            const working = options.isAgentWorking?.() ?? false;
            if (working && !has) {
                options.onStop?.();
                return;
            }
            submit();
        });

        const inputActions = document.createElement('div');
        inputActions.className = 'theia-mobile-projects-sticky-composer-input-actions';
        if (options.onImprovePrompt) {
            inputActions.append(improveBtn);
        }
        inputActions.append(sendBtn);

        const inputBody = document.createElement('div');
        inputBody.className = 'theia-mobile-projects-sticky-composer-input-body';

        const controlsRow = document.createElement('div');
        controlsRow.className = 'theia-mobile-projects-sticky-composer-controls-row';

        const controlsLeft = document.createElement('div');
        controlsLeft.className = 'theia-mobile-projects-sticky-composer-controls-left';

        const controlsRight = document.createElement('div');
        controlsRight.className = 'theia-mobile-projects-sticky-composer-controls-right';

        inputBody.append(inputEditor);
        controlsLeft.append(attachBtn);
        for (const item of controlsLeftItems) {
            controlsLeft.append(item);
        }
        if (!options.agentLocked) {
            bindStickyComposerControlClick(agentBtn, ev => {
                this.openComposerControlSheet(ev, input, () => options.onOpenAgentSheet(agentBtn));
            });
        }
        if (options.onOpenContextUsageSheet) {
            bindStickyComposerControlClick(usageBadge, ev => {
                this.openComposerControlSheet(ev, input, () => options.onOpenContextUsageSheet!(usageBadge));
            });
        }
        options.onContextUsageBadgeMounted?.(usageBadge);
        controlsRight.append(estimateBadge, inputActions);
        controlsRow.append(controlsLeft, controlsRight);
        const borderBeamBloom = document.createElement('div');
        borderBeamBloom.className = 'qaap-border-beam-bloom';
        borderBeamBloom.setAttribute('aria-hidden', 'true');
        inputPanel.append(inputBody, controlsRow, borderBeamBloom);
        stage.append(inputPanel, toolbar);

        const card = document.createElement('div');
        card.className = 'theia-mobile-projects-sticky-composer-card theia-mod-codex';
        if (options.changesPill) {
            wrap.append(options.changesPill);
        }
        if (contextItems.length > 0) {
            card.classList.add('theia-mod-has-context');
            card.append(renderStickyComposerContextStrip({
                items: contextItems,
                formatChip: options.formatContextChip,
                onRemoveItem: index => { options.removeContextItem(index); },
                onClearAll: () => { options.clearContext(); },
                filesExpanded: options.filesExpanded,
                onFilesExpandedChange: options.onFilesExpandedChange,
                resolveAttachmentPreview: this.host.resolveAttachmentPreview,
            }));
        }
        toolbar.classList.add('qaap-codex-context-tray');
        if (options.activityStack) {
            card.classList.add('theia-mod-has-activity');
            card.append(options.activityStack);
        }
        card.append(stage);
        this.installCodexComposerExpandBehavior(card, stage, inputBody, input);
        wrap.append(card);
        column.append(wrap);
        return column;
    }

    /** Blur textarea before opening a bottom sheet so tray state and hit targets stay consistent. */
    protected openComposerControlSheet(ev: Event, input: HTMLTextAreaElement, open: () => void): void {
        ev.preventDefault();
        ev.stopPropagation();
        if (document.activeElement === input) {
            input.blur();
        }
        open();
    }

    /**
     * Codex lip: the input panel (textarea + controls) stays fixed. Only the context tray slides
     * behind the panel on focus; blur brings the tray back.
     */
    protected installCodexComposerExpandBehavior(
        card: HTMLElement,
        _stage: HTMLElement,
        inputBody: HTMLElement,
        input: HTMLTextAreaElement,
    ): void {
        const syncExpanded = (): void => {
            card.classList.toggle('theia-mod-input-expanded', document.activeElement === input);
        };

        const expandFromTextarea = (): void => {
            card.classList.add('theia-mod-input-expanded');
        };

        input.addEventListener('focus', expandFromTextarea);
        input.addEventListener('click', expandFromTextarea);
        input.addEventListener('blur', () => {
            window.requestAnimationFrame(syncExpanded);
        });
        inputBody.addEventListener('click', () => {
            if (document.activeElement !== input) {
                input.focus();
            }
            expandFromTextarea();
        });
    }
}

/** Lucide `send` — sticky composer submit glyph (`currentColor`). */
function createStickyComposerSendIcon(): HTMLElement {
    const host = document.createElement('span');
    host.className = 'theia-mobile-projects-sticky-composer-send-icon';
    host.setAttribute('aria-hidden', 'true');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '16');
    svg.setAttribute('height', '16');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('focusable', 'false');
    const body = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    body.setAttribute(
        'd',
        'M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z',
    );
    const seam = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    seam.setAttribute('d', 'm21.854 2.147-10.94 10.939');
    svg.append(body, seam);
    host.append(svg);
    return host;
}

export type StickyComposerColumnOptions = Parameters<MobileProjectsStickyComposerColumnUi['buildStickyComposerColumn']>[0];
