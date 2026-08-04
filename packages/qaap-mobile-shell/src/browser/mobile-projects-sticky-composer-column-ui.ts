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
import type { ModelCapabilityLevelValue } from '../common/qaap-sticky-composer-model-capability';
import {
    populateAgentToolbarButton,
    populateApprovalPolicyToolbarButton,
    populateModeToolbarButton,
} from './qaap-agent-ui';
import { populateModelCapabilityToolbarButton } from './model-capability-popover';
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
    createStickyComposerSendIcon,
    playStickyComposerSendFly,
} from './mobile-projects-sticky-composer-send-icon';

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
        resolveModeId?: () => string | undefined;
        onOpenModeSheet?: (anchor: HTMLButtonElement) => void;
        approvalPolicyId?: QaapAgentApprovalPolicyId;
        onOpenApprovalPolicySheet?: (anchor: HTMLButtonElement) => void;
        canSubmit: boolean;
        isAgentWorking?: () => boolean;
        isAgentBeamIdle?: () => boolean;
        onStop?: () => void;
        stopLabel?: string;
        onAttach: (anchor: HTMLElement) => void;
        /** Drag-and-drop files onto the composer — attaches them with optimistic chips. */
        onDropFiles?: (files: File[], uploadTargetDir?: import('@theia/core').URI) => void;
        onOpenAgentSheet: (anchor: HTMLButtonElement) => void;
        onSubmit: (draft: string) => void;
        /** Shift+Enter submit — bypasses the queue and dispatches as a parallel run. */
        onSubmitParallel?: (draft: string) => void;
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
        resolveCapabilityLevel?: () => ModelCapabilityLevelValue;
        onOpenCapabilityPopover?: (anchor: HTMLButtonElement) => void;
        onCapabilityTriggerMounted?: (refresh: () => void) => void;
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
        if (modes.length > 1 && options.onOpenModeSheet && options.resolveModeLabel && options.resolveModeId) {
            modeBtn = document.createElement('button');
            modeBtn.type = 'button';
            modeBtn.className = 'theia-mobile-projects-sticky-composer-mode';
            const modeLabel = options.resolveModeLabel();
            const modeId = options.resolveModeId() ?? modes[0]?.id ?? 'agent';
            modeBtn.title = nls.localize('qaap/mobileProjects/stickyComposerMode', 'Mode: {0}', modeLabel);
            modeBtn.setAttribute('aria-label', modeBtn.title);
            populateModeToolbarButton(modeBtn, { modeId, label: modeLabel });
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

        let capabilityBtn: HTMLButtonElement | undefined;
        if (options.resolveCapabilityLevel && options.onOpenCapabilityPopover) {
            capabilityBtn = document.createElement('button');
            capabilityBtn.type = 'button';
            capabilityBtn.className = 'theia-mobile-projects-sticky-composer-model-capability';
            capabilityBtn.setAttribute('aria-haspopup', 'dialog');
            capabilityBtn.setAttribute('aria-expanded', 'false');
            const refreshCapabilityTrigger = (): void => {
                populateModelCapabilityToolbarButton(capabilityBtn!, {
                    level: options.resolveCapabilityLevel!(),
                });
            };
            refreshCapabilityTrigger();
            options.onCapabilityTriggerMounted?.(refreshCapabilityTrigger);
            const capabilityButton = capabilityBtn;
            bindStickyComposerControlClick(capabilityBtn, ev => {
                this.openComposerControlSheet(ev, input, () => options.onOpenCapabilityPopover!(capabilityButton));
            });
            trayRight.append(capabilityBtn);
        }

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
        const improveBloom = document.createElement('div');
        improveBloom.className = 'qaap-border-beam-bloom';
        improveBloom.setAttribute('aria-hidden', 'true');
        improveBtn.append(createStickyComposerImproveIcon(), improveBloom);

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
                    .flatMap(section => section.entries
                        .filter(entry => entry.kind !== 'skill')
                        .map(entry => entry.label)) ?? [],
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
            playStickyComposerSendFly(sendBtn);
            recordStickyComposerPromptSubmission(input, draft);
            if (syntaxHighlight) {
                syntaxHighlight.syncInputValue('');
            } else {
                input.value = '';
            }
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
            // Shift+Enter: bypass the queue and dispatch as a parallel run.
            if (ev.key === 'Enter' && ev.shiftKey && !ev.defaultPrevented && options.onSubmitParallel) {
                ev.preventDefault();
                const draft = input.value.trim();
                if (!draft || !options.canSubmit) {
                    if (!submitInFlight) {
                        options.onSubmitBlocked?.();
                    }
                    return;
                }
                if (submitInFlight || (draft === lastSubmitDraft && Date.now() - lastSubmitAt < submitCooldownMs)) {
                    return;
                }
                submitInFlight = true;
                lastSubmitAt = Date.now();
                lastSubmitDraft = draft;
                playStickyComposerSendFly(sendBtn);
                recordStickyComposerPromptSubmission(input, draft);
                if (syntaxHighlight) {
                    syntaxHighlight.syncInputValue('');
                } else {
                    input.value = '';
                }
                options.setDraft('');
                updateSend();
                try {
                    options.onSubmitParallel(draft);
                } finally {
                    window.setTimeout(() => {
                        submitInFlight = false;
                    }, submitCooldownMs);
                }
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
        controlsRight.append(inputActions);
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
        card.append(stage);
        // Bloom layer for the card-level border beam. CSS shows it via :has() when the card has
        // context and the input-panel inside it is in agent-working state.
        const cardBeamBloom = document.createElement('div');
        cardBeamBloom.className = 'qaap-border-beam-bloom qaap-card-beam-bloom';
        cardBeamBloom.setAttribute('aria-hidden', 'true');
        card.append(cardBeamBloom);
        this.installCodexComposerExpandBehavior(card, stage, inputBody, input);
        if (options.onDropFiles) {
            this.installComposerDropZone(card, inputPanel, input, options.onDropFiles);
        }
        // Queue popover mounts above the card — never fused into the codex lip.
        if (options.activityStack) {
            options.activityStack.classList.add('theia-mod-queue-popover');
            wrap.append(options.activityStack);
        }
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

    /**
     * Premium drag-and-drop on the entire composer card. When files are dragged over any
     * part of the card (context strip, input panel, toolbar), the card morphs: dashed
     * accent border, soft glow, background tint, and the textarea placeholder switches to
     * "Drop files to attach". On drop, a loading shimmer plays on the input panel while
     * the files are attached as optimistic chips — the composer "absorbs" the file.
     *
     * `dragenter`/`dragover`/`dragleave` are installed on `card` so the visual drag state
     * activates across the whole composer. The `drop` handler is installed on BOTH `card`
     * and `inputPanel` with a shared guard — the textarea's default drag-and-drop behavior
     * can swallow the drop event in real browsers, so the inputPanel handler is a fallback
     * for drops over the textarea area; the card handler covers drops over the context
     * strip, toolbar, and other non-input regions.
     */
    protected installComposerDropZone(
        card: HTMLElement,
        inputPanel: HTMLElement,
        input: HTMLTextAreaElement,
        onDropFiles: (files: File[], uploadTargetDir?: import('@theia/core').URI) => void,
    ): void {
        let dragCounter = 0;
        let dropHandled = false;
        const originalPlaceholder = input.placeholder;
        const dropPlaceholder = nls.localize(
            'qaap/mobileProjects/stickyComposerDropFiles',
            'Drop files to attach',
        );

        const hasFiles = (ev: DragEvent): boolean => {
            const types = ev.dataTransfer?.types;
            return !!types && Array.from(types).includes('Files');
        };

        const onDragEnter = (ev: DragEvent): void => {
            if (!hasFiles(ev)) {
                return;
            }
            ev.preventDefault();
            ev.stopPropagation();
            dragCounter++;
            card.classList.add('theia-mod-drag-over');
            input.placeholder = dropPlaceholder;
        };

        // preventDefault on dragover is mandatory — without it the browser will NOT
        // fire the drop event and will instead navigate to the dropped file.
        // stopPropagation is also mandatory: frontend-application.ts installs a
        // document-level dragover handler that sets dropEffect='none', which would
        // override our dropEffect='copy' and prevent the drop from firing.
        const onDragOver = (ev: DragEvent): void => {
            if (ev.dataTransfer) {
                ev.preventDefault();
                ev.stopPropagation();
                ev.dataTransfer.dropEffect = 'copy';
            }
        };

        const onDragLeave = (ev: DragEvent): void => {
            ev.preventDefault();
            ev.stopPropagation();
            dragCounter = Math.max(0, dragCounter - 1);
            if (dragCounter === 0) {
                card.classList.remove('theia-mod-drag-over');
                input.placeholder = originalPlaceholder;
            }
        };

        const onDrop = (ev: DragEvent): void => {
            ev.preventDefault();
            ev.stopPropagation();
            if (dropHandled) {
                return;
            }
            dropHandled = true;
            dragCounter = 0;
            card.classList.remove('theia-mod-drag-over');
            input.placeholder = originalPlaceholder;
            const files = ev.dataTransfer?.files ? Array.from(ev.dataTransfer.files) : [];
            if (files.length === 0) {
                dropHandled = false;
                return;
            }
            inputPanel.classList.add('theia-mod-drop-loading');
            onDropFiles(files);
            window.setTimeout(() => {
                inputPanel.classList.remove('theia-mod-drop-loading');
                dropHandled = false;
            }, 950);
        };

        // Card handles the visual drag-over state for the entire composer.
        card.addEventListener('dragenter', onDragEnter);
        card.addEventListener('dragover', onDragOver);
        card.addEventListener('dragleave', onDragLeave);
        card.addEventListener('drop', onDrop);

        // inputPanel also handles dragover + drop — the textarea's default behavior can
        // swallow dragover in real browsers, so we need preventDefault on the inputPanel
        // (an ancestor of the textarea) to ensure the browser allows the drop.
        inputPanel.addEventListener('dragover', onDragOver);
        inputPanel.addEventListener('drop', onDrop);

        // Neutralize the textarea's default drag-and-drop behavior (inserting text /
        // opening files). preventDefault + stopPropagation so the textarea doesn't
        // hijack the event; the inputPanel/card handlers process the drop.
        input.addEventListener('dragenter', ev => {
            if (hasFiles(ev)) {
                ev.preventDefault();
                ev.stopPropagation();
            }
        });
        input.addEventListener('dragover', ev => {
            if (ev.dataTransfer) {
                ev.preventDefault();
                ev.stopPropagation();
                ev.dataTransfer.dropEffect = 'copy';
            }
        });
        input.addEventListener('drop', ev => {
            ev.preventDefault();
            ev.stopPropagation();
        });
    }
}

/** Lucide `pencil-sparkles` — improve-prompt glyph (`currentColor`). */
function createStickyComposerImproveIcon(): HTMLElement {
    const host = document.createElement('span');
    host.className = 'theia-mobile-projects-sticky-composer-improve-icon';
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
    const paths = [
        'M10 3H8',
        'm15.007 5.008 3.987 3.986',
        'M20 15v4',
        'M21.174 6.813a2.82 2.82 0 0 0-3.986-3.987L3.842 16.175a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z',
        'M22 17h-4',
        'M4 5v4',
        'M6 7H2',
        'M9 2v2',
    ];
    for (const d of paths) {
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', d);
        svg.append(path);
    }
    host.append(svg);
    return host;
}

export type StickyComposerColumnOptions = Parameters<MobileProjectsStickyComposerColumnUi['buildStickyComposerColumn']>[0];
