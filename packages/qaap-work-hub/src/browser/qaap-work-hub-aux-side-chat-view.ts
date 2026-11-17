// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { Disposable } from '@theia/core/lib/common/disposable';
import { nls } from '@theia/core/lib/common/nls';
import type { AIVariableResolutionRequest } from '@theia/ai-core';
import type { MobileComposerAttachHandlers } from '@theia/qaap-composer/lib/browser/qaap-mobile-composer-device-attach';
import { createStickyComposerSendIcon } from '@theia/qaap-composer/lib/browser/mobile-projects-sticky-composer-send-icon';
import { disposeQaapComposerModelPicker, renderQaapComposerModelPicker, type QaapComposerModelPickerProps } from '@theia/qaap-composer/lib/browser/qaap-composer-model-picker';
import { placePickerAbove } from '@theia/qaap-composer/lib/browser/qaap-composer-picker-placement';
import { markStickyComposerPopoverAnchor, wireStickyComposerPopoverDismiss } from '@theia/qaap-transcript/lib/browser/qaap-sticky-composer-popover';
import { QaapComposerModelPickerModel, type QaapPickerModel, type QaapPickerState } from '@theia/qaap-composer/lib/common/qaap-composer-model-picker-model';
import { populateAgentToolbarButton } from '@theia/qaap-agents-ui/lib/browser/qaap-agent-ui';
import { buildSideChatContextPreamble, sideChatVisibleTitle, stripSideChatPreamble } from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-side-chat';
import {
    createConversation,
    deleteConversation,
    getConversation,
    postConversationMessage,
    type QaapAgentConversationDTO,
    type QaapAgentMessageDTO,
    type QaapCreateConversationBody,
    type QaapPostConversationMessageOptions,
} from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';
import type { QaapCreateAgentTaskQaiqModel } from '@theia/qaap-shared-core/lib/common/qaap-agent-task-client';
import { describeAgentTurnFailure } from '@theia/qaap-shared-core/lib/common/qaap-agent-failure-message';
import type { QaapLiveFeedFrame } from '@theia/qaap-shared-core/lib/common/qaap-live-feed-cursor';
import {
    QaapHarnessModelAvailability,
    type QaapHarnessSession,
    type QaapModelTier,
} from '@theia/qaap-shared-core/lib/common/qaap-harness-model-availability';
import { applySyncChatMarkdownHost } from '@theia/qaap-transcript/lib/common/qaap-chat-markdown-worker-bridge';
import { sideChatTitleFromMessage, sideChatToolCallCount } from './qaap-work-hub-aux-side-chat-model';

/** Trailing delay before a live frame re-reads the side chat, so a burst of frames costs one read. */
export const QAAP_WORK_HUB_SIDE_CHAT_REFRESH_MS = 200;

/** Within this distance of the bottom the transcript keeps following the newest text. */
const FOLLOW_THRESHOLD_PX = 48;

/** The input's one-line height, as the main composer's input measures. */
const INPUT_MIN_HEIGHT_PX = 26;

/** The input grows with its text up to this height, as the main composer does. */
const INPUT_MAX_HEIGHT_PX = 160;

/** A side chat quotes the root of a chain of side chats, at most this many hops up. */
export const QAAP_WORK_HUB_SIDE_CHAT_MAX_DEPTH = 3;

/** The conversation calls the side chat needs, injectable for specs. Defaults to the shared client. */
export interface QaapWorkHubAuxSideChatApi {
    create(body: QaapCreateConversationBody): Promise<QaapAgentConversationDTO>;
    post(id: string, content: string, options: QaapPostConversationMessageOptions): Promise<unknown>;
    get(id: string): Promise<QaapAgentConversationDTO>;
    remove(id: string): Promise<void>;
}

const DEFAULT_API: QaapWorkHubAuxSideChatApi = {
    create: body => createConversation(body),
    post: (id, content, options) => postConversationMessage(id, content, options),
    get: id => getConversation(id),
    remove: id => deleteConversation(id),
};

/** The conversation a side chat opens from: the one in the main area. */
export interface QaapWorkHubSideChatParent {
    readonly id: string;
    readonly title: string;
    readonly cwd: string;
    readonly agentId: string;
}

/** One entry of the model picker. `agentModel` is what the side chat sends with its turn. */
export interface QaapWorkHubSideChatModelOption {
    readonly agentId: string;
    readonly agentLabel: string;
    readonly modelLabel: string;
    readonly agentModel?: QaapCreateAgentTaskQaiqModel;
    readonly tier: QaapModelTier;
    readonly session: QaapHarnessSession;
}

/** One chip of the side chat draft: a context attachment from the attach menu, or one still uploading (no request yet). */
export interface QaapWorkHubSideChatAttachment {
    readonly id: string;
    label: string;
    pending: boolean;
    request?: AIVariableResolutionRequest;
}

/** The harness and model the main composer shows now. The selector starts from them when it can. */
export interface QaapWorkHubSideChatComposerSelection {
    readonly agentId: string;
    readonly agentModel?: QaapCreateAgentTaskQaiqModel;
}

/** What the side chat needs from the Work Hub around it. Implemented by the owner of the right panel. */
export interface QaapWorkHubAuxSideChatHost {
    /** The conversation the main area shows, or `undefined` when no task is open. */
    resolveParent(): QaapWorkHubSideChatParent | undefined;
    /** The harness and model the main composer shows, or `undefined` when none is pinned (the parent's apply then). */
    resolveComposerSelection(): QaapWorkHubSideChatComposerSelection | undefined;
    /** Models the selector offers, for every harness the composer offers (Settings → Harness applies). */
    listModels(): Promise<readonly QaapWorkHubSideChatModelOption[]>;
    /** Opens the composer's own attach menu for the side chat's «+»; the picks come back, the main composer is not touched. */
    pickAttachments(anchor: HTMLElement, handlers: MobileComposerAttachHandlers): Promise<readonly AIVariableResolutionRequest[]>;
    /** The outbound prompt for a side chat send: skills expanded and attachments applied, as the main composer's submit does. */
    prepareOutbound(draft: string, variables: readonly AIVariableResolutionRequest[]): Promise<string>;
    /** Opens the harness sign-in of `agentId`. */
    startSignIn(agentId: string): void;
    /** Opens a conversation in the main area with the same call the sidebar uses. */
    openInMainArea(conversationId: string): Promise<void>;
    /** Listens to the live conversation feed; the view filters the frames by its own conversation id. */
    subscribeLive(onFrame: (frame: QaapLiveFeedFrame) => void): Disposable;
}

/** The host of a panel without a Work Hub around it (no project open): the side chat has no parent. */
export const QAAP_WORK_HUB_NO_SIDE_CHAT_HOST: QaapWorkHubAuxSideChatHost = {
    resolveParent: () => undefined,
    resolveComposerSelection: () => undefined,
    listModels: () => Promise.resolve([]),
    pickAttachments: () => Promise.resolve([]),
    prepareOutbound: draft => Promise.resolve(draft),
    startSignIn: () => undefined,
    openInMainArea: () => Promise.resolve(),
    subscribeLive: () => Disposable.NULL,
};

export interface QaapWorkHubAuxSideChatViewOptions {
    readonly host: QaapWorkHubAuxSideChatHost;
    readonly api?: QaapWorkHubAuxSideChatApi;
    /** The tab title: the first message, or `undefined` before the first send. */
    readonly onTitle: (title: string | undefined) => void;
    /** Closes the side chat tab. Bring back and the close button call it; deletion does too. */
    readonly onClose: () => void;
    readonly refreshMs?: number;
}

interface SideChatSelection {
    readonly agentId: string;
    readonly agentModel?: QaapCreateAgentTaskQaiqModel;
    readonly label: string;
}

interface SideChatRow {
    readonly element: HTMLElement;
    readonly body: HTMLElement;
    readonly meta: HTMLElement;
    readonly errorLine: HTMLElement;
    readonly role: 'user' | 'agent';
    /** The last rendered state of the row: a row is patched only when this changes. */
    signature: string;
    /** The last markdown rendered into `body`, so unchanged text is not re-rendered. */
    markdown: string;
}

const PENDING_ROW_KEY = 'pending';

/**
 * The side chat of the desktop Work Hub right panel: a small conversation opened beside the task, with its
 * own composer and model picker. The first send creates the conversation (`origin: 'side-chat'`, the
 * parent's project and cwd, the parent context in the first prompt only). Later sends post to it. Replies
 * arrive on the live feed, filtered by this conversation's id; each row is patched in place when its text,
 * error or tool count changes. The main composer and the main transcript are never touched.
 *
 * The composer uses the main composer's classes so it looks the same, and the picker is the shared
 * `renderQaapComposerModelPicker`, fed from this side chat's own selection.
 */
export class QaapWorkHubAuxSideChatView implements Disposable {
    readonly element: HTMLElement;

    protected readonly host: QaapWorkHubAuxSideChatHost;
    protected readonly api: QaapWorkHubAuxSideChatApi;
    protected readonly onTitle: (title: string | undefined) => void;
    protected readonly onClose: () => void;
    protected readonly refreshMs: number;

    protected readonly titleText: HTMLElement;
    protected readonly bringBackButton: HTMLButtonElement;
    protected readonly deleteButton: HTMLButtonElement;
    protected readonly closeButton: HTMLButtonElement;
    protected readonly confirmBar: HTMLElement;
    protected readonly contextLine: HTMLElement;
    protected readonly scroll: HTMLElement;
    protected readonly list: HTMLElement;
    protected readonly emptyHint: HTMLElement;
    protected readonly status: HTMLElement;
    protected readonly input: HTMLTextAreaElement;
    protected readonly modelButton: HTMLButtonElement;
    protected readonly pickerPanel: HTMLElement;
    protected readonly pickerHost: HTMLElement;
    protected readonly sendButton: HTMLButtonElement;
    protected readonly chipsRow: HTMLElement;

    /** The side chat's conversation, created by the first send. */
    protected conversationId: string | undefined;
    protected title: string | undefined;
    protected parent: QaapWorkHubSideChatParent | undefined;
    protected selection: SideChatSelection | undefined;
    /** Models as the host listed them; loaded once per shown side chat. */
    protected models: readonly QaapWorkHubSideChatModelOption[] | undefined;
    protected modelsLoading = false;
    /** The picker's own search text and rail, kept while the picker is open. */
    protected pickerQuery = '';
    protected pickerRail: string | undefined;
    protected sending = false;
    protected visible = false;
    protected live: Disposable | undefined;
    protected refreshTimer: number | undefined;
    protected readonly rows = new Map<string, SideChatRow>();
    protected pendingText: string | undefined;
    /** The chips above the input: attachments picked from the attach menu, sent with the next turn. */
    protected attachments: QaapWorkHubSideChatAttachment[] = [];
    /** The words the user typed, by the outbound prompt the server stores (it carries the attachments and skills). */
    protected readonly sentWords = new Map<string, string>();
    /** Closes the picker on Escape while it is open, whatever holds the focus (the shared picker only sees keys inside it). */
    protected pickerEscape: ((event: KeyboardEvent) => void) | undefined;
    /** Removes the open picker's dismiss, placement and resize listeners; set while the picker is mounted. */
    protected pickerDetach: (() => void) | undefined;

    constructor(options: QaapWorkHubAuxSideChatViewOptions) {
        this.host = options.host;
        this.api = options.api ?? DEFAULT_API;
        this.onTitle = options.onTitle;
        this.onClose = options.onClose;
        this.refreshMs = options.refreshMs ?? QAAP_WORK_HUB_SIDE_CHAT_REFRESH_MS;

        this.element = document.createElement('section');
        this.element.className = 'qaap-work-hub-aux-side-chat';
        this.element.setAttribute('aria-label', nls.localize('qaap/workHubAuxPanel/sideChat', 'Side chat'));
        this.element.hidden = true;

        const header = document.createElement('header');
        header.className = 'qaap-work-hub-aux-side-chat-header';
        this.titleText = document.createElement('h3');
        this.titleText.className = 'qaap-work-hub-aux-side-chat-title';
        this.bringBackButton = this.headerButton('qaap-work-hub-aux-side-chat-bring-back', 'codicon-reply',
            nls.localize('qaap/workHubAuxPanel/sideChatBringBack', 'Bring back'), () => this.bringBack(),
            nls.localize('qaap/workHubAuxPanel/sideChatBringBackTitle', 'Open this conversation in the main area'));
        this.deleteButton = this.headerButton('qaap-work-hub-aux-side-chat-delete', 'codicon-trash',
            nls.localize('qaap/workHubAuxPanel/sideChatDelete', 'Delete side chat'), () => this.setConfirming(this.confirmBar.hidden));
        this.closeButton = this.headerButton('qaap-work-hub-aux-side-chat-close', 'codicon-close',
            nls.localize('qaap/workHubAuxPanel/sideChatClose', 'Close side chat'), () => this.onClose());
        const actions = document.createElement('div');
        actions.className = 'qaap-work-hub-aux-side-chat-actions';
        actions.append(this.bringBackButton, this.deleteButton, this.closeButton);
        header.append(this.titleText, actions);

        this.confirmBar = document.createElement('div');
        this.confirmBar.className = 'qaap-work-hub-aux-side-chat-confirm';
        this.confirmBar.hidden = true;
        const confirmText = document.createElement('span');
        confirmText.textContent = nls.localize('qaap/workHubAuxPanel/sideChatDeleteConfirm', 'Delete this side chat? Its messages are removed.');
        const confirmDelete = this.textButton('qaap-work-hub-aux-side-chat-confirm-delete',
            nls.localizeByDefault('Delete'), () => this.deleteConversation());
        const confirmCancel = this.textButton('qaap-work-hub-aux-side-chat-confirm-cancel',
            nls.localizeByDefault('Cancel'), () => this.setConfirming(false));
        this.confirmBar.append(confirmText, confirmDelete, confirmCancel);

        this.contextLine = document.createElement('p');
        this.contextLine.className = 'qaap-work-hub-aux-side-chat-context';
        this.contextLine.hidden = true;

        this.scroll = document.createElement('div');
        this.scroll.className = 'qaap-work-hub-aux-side-chat-transcript';
        this.list = document.createElement('div');
        this.list.className = 'qaap-work-hub-aux-side-chat-messages';
        this.emptyHint = document.createElement('p');
        this.emptyHint.className = 'qaap-work-hub-aux-side-chat-empty';
        this.emptyHint.textContent = nls.localize('qaap/workHubAuxPanel/sideChatEmpty', 'Ask a quick question. The answer stays in this side chat.');
        this.scroll.append(this.list, this.emptyHint);

        this.status = document.createElement('div');
        this.status.className = 'qaap-work-hub-aux-side-chat-status';
        this.status.setAttribute('role', 'status');

        // The composer mirrors the main composer's markup and classes, so the shared styles apply unchanged:
        // the same wrapper (`-inner`) around the card, and the card > stage > input panel nesting.
        const composer = document.createElement('div');
        composer.className = 'theia-mobile-projects-sticky-composer-inner qaap-work-hub-aux-side-chat-composer';
        const card = document.createElement('div');
        card.className = 'theia-mobile-projects-sticky-composer-card theia-mod-codex qaap-work-hub-aux-side-chat-card';
        const stage = document.createElement('div');
        stage.className = 'theia-mobile-projects-sticky-composer-stage';
        const inputPanel = document.createElement('div');
        inputPanel.className = 'theia-mobile-projects-sticky-composer-input-wrap theia-mobile-projects-sticky-composer-input-panel theia-mod-codex';
        const inputBody = document.createElement('div');
        inputBody.className = 'theia-mobile-projects-sticky-composer-input-body';
        this.input = document.createElement('textarea');
        this.input.className = 'theia-mobile-projects-sticky-composer-input qaap-work-hub-aux-side-chat-input';
        this.input.rows = 1;
        this.input.placeholder = nls.localize('qaap/workHubAuxPanel/sideChatInput', 'Ask anything…');
        this.input.setAttribute('aria-label', this.input.placeholder);
        this.input.addEventListener('keydown', event => {
            if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
                event.preventDefault();
                this.send();
            }
        });
        this.input.addEventListener('input', () => {
            this.growInput();
            this.updateSendState();
        });
        const inputEditor = document.createElement('div');
        inputEditor.className = 'theia-mobile-projects-sticky-composer-input-editor';
        inputEditor.append(this.input);
        inputBody.append(inputEditor);

        const controlsRow = document.createElement('div');
        controlsRow.className = 'theia-mobile-projects-sticky-composer-controls-row';
        const controlsLeft = document.createElement('div');
        controlsLeft.className = 'theia-mobile-projects-sticky-composer-controls-left';
        const attach = document.createElement('button');
        attach.type = 'button';
        attach.className = 'theia-mobile-projects-sticky-composer-attach qaap-work-hub-aux-side-chat-attach';
        // Looks and sizes like the main composer's attach button and opens the same menu; the picks stay in this side chat.
        attach.title = nls.localize('qaap/workHubAuxPanel/sideChatAttach', 'Attach files, skills or context');
        attach.setAttribute('aria-label', attach.title);
        attach.addEventListener('click', () => { this.openAttachMenu(attach); });
        const attachGlyph = document.createElement('span');
        attachGlyph.className = 'codicon codicon-add';
        attachGlyph.setAttribute('aria-hidden', 'true');
        attach.append(attachGlyph);
        this.modelButton = document.createElement('button');
        this.modelButton.type = 'button';
        this.modelButton.className = 'theia-mobile-projects-sticky-composer-agent qaap-work-hub-aux-side-chat-model';
        this.modelButton.setAttribute('aria-haspopup', 'dialog');
        this.modelButton.addEventListener('click', () => this.togglePicker());
        controlsLeft.append(attach, this.modelButton);

        const controlsRight = document.createElement('div');
        controlsRight.className = 'theia-mobile-projects-sticky-composer-controls-right';
        const inputActions = document.createElement('div');
        inputActions.className = 'theia-mobile-projects-sticky-composer-input-actions';
        this.sendButton = document.createElement('button');
        this.sendButton.type = 'button';
        this.sendButton.className = 'theia-mobile-projects-sticky-composer-send qaap-work-hub-aux-side-chat-send';
        this.sendButton.title = nls.localizeByDefault('Send');
        this.sendButton.setAttribute('aria-label', this.sendButton.title);
        this.sendButton.append(createStickyComposerSendIcon());
        this.sendButton.addEventListener('click', () => this.send());
        this.sendButton.disabled = true;
        inputActions.append(this.sendButton);
        controlsRight.append(inputActions);
        controlsRow.append(controlsLeft, controlsRight);

        this.chipsRow = document.createElement('div');
        this.chipsRow.className = 'qaap-work-hub-aux-side-chat-chips';
        this.chipsRow.hidden = true;
        const bloom = document.createElement('div');
        bloom.className = 'qaap-border-beam-bloom';
        bloom.setAttribute('aria-hidden', 'true');
        inputPanel.append(this.chipsRow, inputBody, controlsRow, bloom);
        stage.append(inputPanel);
        card.append(stage);

        // The picker is the main composer's popover: the same classes (so the same 560px width and height rules), mounted on
        // document.body while open (see mountPicker), so the side chat's panel never clips it.
        this.pickerPanel = document.createElement('div');
        this.pickerPanel.className = 'qaap-sticky-composer-sheet-popover qaap-work-hub-aux-side-chat-picker theia-mod-agent-picker theia-mod-model-picker';
        this.pickerPanel.setAttribute('role', 'dialog');
        this.pickerPanel.hidden = true;
        this.pickerHost = document.createElement('div');
        this.pickerHost.className = 'qaap-composer-model-picker-host';
        this.pickerPanel.append(this.pickerHost);
        composer.append(card);

        this.element.append(header, this.confirmBar, this.contextLine, this.scroll, this.status, composer);
        this.renderModelButton();
        this.renderTitle();
        this.updateSendState();
        // One line high from the start, as the main composer's input is before the first keystroke.
        this.growInput();
    }

    /** The tab is shown: subscribe to the live feed, read the parent, load the models and the reply once. */
    show(): void {
        if (this.visible) {
            return;
        }
        this.visible = true;
        this.live = this.host.subscribeLive(frame => this.onLiveFrame(frame));
        this.renderContext();
        this.loadModels();
        if (this.conversationId) {
            this.scheduleRefresh(0);
        }
    }

    /** The tab is hidden: nothing is subscribed or polled, and an open picker closes with the panel. */
    hide(): void {
        this.visible = false;
        this.closePicker();
        this.live?.dispose();
        this.live = undefined;
        this.clearRefreshTimer();
    }

    /** Forgets the side chat, e.g. when its tab closes. The conversation itself stays on the server. */
    reset(): void {
        this.hide();
        this.conversationId = undefined;
        this.title = undefined;
        this.parent = undefined;
        this.selection = undefined;
        this.pendingText = undefined;
        this.pickerQuery = '';
        this.pickerRail = undefined;
        this.rows.clear();
        this.list.replaceChildren();
        this.attachments = [];
        this.renderAttachments();
        this.input.value = '';
        this.growInput();
        this.updateSendState();
        this.setStatus('');
        this.setConfirming(false);
        this.closePicker();
        this.renderTitle();
        this.renderModelButton();
        this.renderEmpty();
        this.renderContext();
        this.onTitle(undefined);
    }

    /** The conversation this side chat holds, or `undefined` before its first send. */
    get conversation(): string | undefined {
        return this.conversationId;
    }

    /** The first message's title, or `undefined` before the first send. */
    get tabTitle(): string | undefined {
        return this.title;
    }

    dispose(): void {
        this.hide();
        this.closePicker();
    }

    /**
     * Sends the input. The first send creates the side chat conversation with the parent's project and cwd and
     * the parent context in its prompt; later sends post to that conversation. The bubble always shows the user's
     * own words.
     */
    async send(): Promise<void> {
        const text = this.input.value.trim();
        const ready = this.attachments.flatMap(item => item.request && !item.pending ? [item.request] : []);
        if ((!text && ready.length === 0) || this.sending) {
            return;
        }
        if (this.attachments.some(item => item.pending)) {
            this.setStatus(nls.localize('qaap/workHubAuxPanel/sideChatAttachUploading', 'Wait for the attachments to finish uploading.'));
            return;
        }
        const selection = this.currentSelection();
        const parent = this.parent ?? this.host.resolveParent();
        if (!this.conversationId && !parent) {
            this.setStatus(nls.localize('qaap/workHubAuxPanel/sideChatNoParent', 'Open a task to start a side chat.'));
            return;
        }
        this.sending = true;
        this.sendButton.disabled = true;
        // The outbound prompt carries the skills and attachments; the server stores that text, so the pending row matches it.
        let outbound: string;
        try {
            outbound = await this.host.prepareOutbound(text, ready);
        } catch (error) {
            this.sending = false;
            this.updateSendState();
            this.setStatus(this.errorMessage(error));
            return;
        }
        const shown = text || this.attachments.filter(item => !item.pending).map(item => item.label).join(', ');
        this.input.value = '';
        this.growInput();
        this.pendingText = outbound;
        if (outbound !== text) {
            this.sentWords.set(outbound, text);
        }
        this.setStatus('');
        this.appendPendingRow(shown);
        this.followBottom();
        try {
            if (this.conversationId) {
                await this.api.post(this.conversationId, outbound, {
                    ...(selection.agentId ? { agent: selection.agentId } : {}),
                    ...(selection.agentModel ? { agentModel: selection.agentModel } : {}),
                });
            } else if (parent) {
                const preamble = await this.loadPreamble(parent);
                const created = await this.api.create({
                    cwd: parent.cwd,
                    title: sideChatTitleFromMessage(text),
                    clientRequestId: `side-chat-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
                    ...(selection.agentId ? { agent: selection.agentId } : {}),
                    ...(selection.agentModel ? { agentModel: selection.agentModel } : {}),
                    message: outbound,
                    ...(preamble ? { contextPreamble: preamble } : {}),
                    origin: 'side-chat',
                    sideChatParentId: parent.id,
                });
                this.conversationId = created.id;
                this.parent = parent;
                this.title = sideChatTitleFromMessage(text);
                this.renderTitle();
                this.onTitle(this.title);
                this.renderContext();
            }
            this.attachments = [];
            this.renderAttachments();
            this.scheduleRefresh(0);
        } catch (error) {
            this.dropPendingRow();
            this.input.value = text;
            this.growInput();
            this.setStatus(this.errorMessage(error));
        } finally {
            this.sending = false;
            this.updateSendState();
        }
    }

    /** Opens the composer's attach menu; what is picked becomes a chip above this side chat's input only. */
    protected async openAttachMenu(anchor: HTMLElement): Promise<void> {
        const picked = await this.host.pickAttachments(anchor, this.attachHandlers());
        for (const request of picked) {
            this.attachments.push({ id: `side-chat-attach-${Date.now()}-${this.attachments.length}`, label: this.attachmentLabel(request), pending: false, request });
        }
        this.renderAttachments();
        this.input.focus();
    }

    /** The menu's handlers: uploads show as pending chips, a skill is typed into this side chat's input. */
    protected attachHandlers(): MobileComposerAttachHandlers {
        return {
            insertComposerSkill: skillName => this.insertSkill(skillName),
            appendOptimistic: entry => {
                this.attachments.push({ id: entry.id, label: entry.displayName ?? nls.localize('qaap/workHubAuxPanel/sideChatAttachUploadingLabel', 'Uploading…'), pending: true });
                this.renderAttachments();
            },
            finalizeOptimistic: (id, request) => {
                const item = this.attachments.find(candidate => candidate.id === id);
                if (!item) {
                    return;
                }
                item.request = request;
                item.pending = false;
                item.label = this.attachmentLabel(request);
                this.renderAttachments();
            },
            removeOptimistic: (id, error) => {
                this.attachments = this.attachments.filter(candidate => candidate.id !== id);
                this.renderAttachments();
                this.setStatus(error instanceof Error && error.message.trim()
                    ? error.message.trim()
                    : nls.localize('qaap/workHubAuxPanel/sideChatAttachFailed', 'Could not attach this file.'));
            },
        };
    }

    protected insertSkill(skillName: string): void {
        const draft = this.input.value;
        const separator = draft.length === 0 || /\s$/.test(draft) ? '' : ' ';
        this.input.value = `${draft}${separator}/${skillName} `;
        this.growInput();
        this.updateSendState();
        this.input.focus();
    }

    /** The chip's name: the file's base name for a file, else the variable's label. */
    protected attachmentLabel(request: AIVariableResolutionRequest): string {
        const arg = request.arg?.trim();
        if (arg) {
            return arg.split(/[\\/]/).pop() || arg;
        }
        return request.variable.label ?? request.variable.name;
    }

    protected renderAttachments(): void {
        this.chipsRow.replaceChildren(...this.attachments.map(item => this.attachmentChip(item)));
        this.chipsRow.hidden = this.attachments.length === 0;
        this.updateSendState();
    }

    protected attachmentChip(item: QaapWorkHubSideChatAttachment): HTMLElement {
        const chip = document.createElement('span');
        chip.className = item.pending ? 'qaap-work-hub-aux-side-chat-chip is-pending' : 'qaap-work-hub-aux-side-chat-chip';
        const name = document.createElement('span');
        name.className = 'qaap-work-hub-aux-side-chat-chip-label';
        name.textContent = item.label;
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'qaap-work-hub-aux-side-chat-chip-remove';
        remove.title = nls.localize('qaap/workHubAuxPanel/sideChatRemoveAttachment', 'Remove attachment');
        remove.setAttribute('aria-label', remove.title);
        const glyph = document.createElement('span');
        glyph.className = 'codicon codicon-close';
        glyph.setAttribute('aria-hidden', 'true');
        remove.append(glyph);
        remove.addEventListener('click', () => {
            this.attachments = this.attachments.filter(candidate => candidate !== item);
            this.renderAttachments();
        });
        chip.append(name, remove);
        return chip;
    }

    /** Opens the conversation in the main area, then closes the side chat tab. */
    async bringBack(): Promise<void> {
        const id = this.conversationId;
        if (!id) {
            return;
        }
        try {
            await this.host.openInMainArea(id);
        } catch (error) {
            this.setStatus(this.errorMessage(error));
            return;
        }
        this.onClose();
    }

    /** Deletes the side chat conversation after the user confirmed, then closes the tab. */
    async deleteConversation(): Promise<void> {
        const id = this.conversationId;
        if (id) {
            try {
                await this.api.remove(id);
            } catch (error) {
                this.setStatus(this.errorMessage(error));
                return;
            }
        }
        this.setConfirming(false);
        this.onClose();
    }

    /** Applies a freshly read conversation to the transcript, patching only the rows that changed. */
    apply(conversation: QaapAgentConversationDTO): void {
        const follow = this.isNearBottom();
        const seen = new Set<string>();
        for (const message of conversation.messages) {
            if (message.role === 'user') {
                const text = stripSideChatPreamble(message.content);
                if (this.pendingText !== undefined && text === this.pendingText) {
                    this.pendingText = undefined;
                    this.dropPendingRow();
                }
                seen.add(message.id);
                this.patchUserRow(message.id, this.sentWords.get(text) ?? text);
            } else {
                seen.add(message.id);
                this.patchAgentRow(message);
            }
        }
        for (const [key, row] of this.rows) {
            if (!seen.has(key) && key !== PENDING_ROW_KEY) {
                row.element.remove();
                this.rows.delete(key);
            }
        }
        const working = conversation.status === 'streaming'
            || conversation.messages.some(message => message.role === 'agent' && message.runActive === true);
        this.setStatus(working ? nls.localize('qaap/workHubAuxPanel/sideChatWorking', 'Working…') : '');
        this.renderEmpty();
        if (follow) {
            this.followBottom();
        }
    }

    /**
     * The background of the first message: the parent conversation, or the root of a chain of side chats (a side
     * chat opened from a side chat quotes the task it started from, at most {@link QAAP_WORK_HUB_SIDE_CHAT_MAX_DEPTH}
     * hops up). A side chat whose parent cannot be read is quoted itself.
     */
    protected async loadPreamble(parent: QaapWorkHubSideChatParent): Promise<string | undefined> {
        try {
            let source = await this.api.get(parent.id);
            for (let hops = 0; hops < QAAP_WORK_HUB_SIDE_CHAT_MAX_DEPTH && source.origin === 'side-chat' && source.sideChatParentId; hops++) {
                try {
                    source = await this.api.get(source.sideChatParentId);
                } catch {
                    break;
                }
            }
            // The parent is named as the panel names it ("Context from"); a quoted root is named by its own record.
            const firstUser = source.messages.find(message => message.role === 'user')?.content;
            const title = source.id === parent.id
                ? parent.title
                : sideChatVisibleTitle(source.title, firstUser) || source.title;
            return buildSideChatContextPreamble({
                title,
                messages: source.messages.map(message => ({ role: message.role, text: message.content })),
            });
        } catch {
            // The side chat still starts: the parent is only background.
            return undefined;
        }
    }

    protected onLiveFrame(frame: QaapLiveFeedFrame): void {
        const id = this.conversationId;
        if (!id) {
            return;
        }
        if (frame.conversationId === id || frame.conversation?.id === id) {
            this.scheduleRefresh(this.refreshMs);
        }
    }

    protected scheduleRefresh(delay: number): void {
        if (this.refreshTimer !== undefined || !this.conversationId || !this.visible) {
            return;
        }
        this.refreshTimer = this.view().setTimeout(() => {
            this.refreshTimer = undefined;
            this.refresh();
        }, delay);
    }

    protected async refresh(): Promise<void> {
        const id = this.conversationId;
        if (!id || !this.visible) {
            return;
        }
        try {
            const conversation = await this.api.get(id);
            if (id === this.conversationId && this.visible) {
                this.apply(conversation);
            }
        } catch {
            // Keep the last transcript; the next live frame tries again.
        }
    }

    protected clearRefreshTimer(): void {
        if (this.refreshTimer !== undefined) {
            this.view().clearTimeout(this.refreshTimer);
            this.refreshTimer = undefined;
        }
    }

    protected patchUserRow(key: string, text: string): void {
        const row = this.ensureRow(key, 'user');
        if (row.signature !== text) {
            row.body.textContent = text;
            row.signature = text;
        }
    }

    protected patchAgentRow(message: QaapAgentMessageDTO): void {
        const row = this.ensureRow(message.id, 'agent');
        const tools = sideChatToolCallCount(message.traceEvents);
        const failure = message.error
            ? describeAgentTurnFailure(message.error, { agentLabel: this.agentLabel(message.turnAgentId) })
            : undefined;
        const signature = `${message.content}\u0000${message.error ?? ''}\u0000${tools}\u0000${message.runActive === true}`;
        if (row.signature === signature) {
            return;
        }
        if (row.markdown !== message.content) {
            applySyncChatMarkdownHost(row.body, message.content);
            row.markdown = message.content;
        }
        row.meta.textContent = tools > 0
            ? (tools === 1
                ? nls.localize('qaap/workHubAuxPanel/sideChatToolsUsed', 'Used {0} tool', tools)
                : nls.localize('qaap/workHubAuxPanel/sideChatToolsUsedMany', 'Used {0} tools', tools))
            : '';
        row.errorLine.replaceChildren();
        if (failure) {
            const label = document.createElement('span');
            label.className = 'qaap-work-hub-aux-side-chat-error-label';
            label.textContent = failure.label;
            row.errorLine.append(label);
            if (failure.kind === 'sign_in') {
                const agentId = message.turnAgentId ?? this.parent?.agentId ?? '';
                row.errorLine.append(this.textButton('qaap-work-hub-aux-side-chat-sign-in',
                    nls.localizeByDefault('Sign in'), () => this.host.startSignIn(agentId)));
            }
        }
        row.signature = signature;
    }

    protected ensureRow(key: string, role: 'user' | 'agent'): SideChatRow {
        const existing = this.rows.get(key);
        if (existing) {
            return existing;
        }
        const element = document.createElement('div');
        element.className = `qaap-work-hub-aux-side-chat-message is-${role}`;
        element.dataset.messageId = key;
        const body = document.createElement('div');
        body.className = 'qaap-work-hub-aux-side-chat-message-body';
        const meta = document.createElement('div');
        meta.className = 'qaap-work-hub-aux-side-chat-message-meta';
        const errorLine = document.createElement('div');
        errorLine.className = 'qaap-work-hub-aux-side-chat-message-error';
        element.append(body, meta, errorLine);
        const row: SideChatRow = { element, body, meta, errorLine, role, signature: '', markdown: '' };
        this.rows.set(key, row);
        this.list.append(element);
        return row;
    }

    protected appendPendingRow(text: string): void {
        this.dropPendingRow();
        const row = this.ensureRow(PENDING_ROW_KEY, 'user');
        row.body.textContent = text;
        row.signature = text;
        this.renderEmpty();
    }

    protected dropPendingRow(): void {
        const row = this.rows.get(PENDING_ROW_KEY);
        if (row) {
            row.element.remove();
            this.rows.delete(PENDING_ROW_KEY);
        }
        this.renderEmpty();
    }

    protected agentLabel(turnAgentId: string | undefined): string | undefined {
        const agentId = turnAgentId ?? this.parent?.agentId;
        const option = this.models?.find(candidate => candidate.agentId === agentId);
        return option?.agentLabel ?? agentId;
    }

    protected loadModels(): void {
        if (this.models || this.modelsLoading) {
            return;
        }
        this.modelsLoading = true;
        this.host.listModels()
            .then(models => { this.models = models; })
            .catch(() => { this.models = []; })
            .finally(() => {
                this.modelsLoading = false;
                if (!this.selection || !this.selectionIsUsable(this.selection)) {
                    this.selection = this.defaultSelection();
                }
                this.renderModelButton();
                this.renderPicker();
            });
    }

    /**
     * The selector's start: the main composer's harness and model when the listed models include them, else the
     * parent's harness, else the first usable model. Re-evaluated until the user picks a model in this side chat.
     */
    protected defaultSelection(): SideChatSelection | undefined {
        const models = this.models ?? [];
        const composer = this.host.resolveComposerSelection();
        const parentAgent = this.parent?.agentId ?? this.host.resolveParent()?.agentId;
        const usable = models.filter(option => this.isSelectable(option));
        const fromComposer = composer
            ? usable.find(option => option.agentId === composer.agentId
                && (!composer.agentModel?.modelId || option.agentModel?.modelId === composer.agentModel.modelId))
            : undefined;
        const pick = fromComposer ?? usable.find(option => option.agentId === parentAgent) ?? usable[0];
        if (pick) {
            return { agentId: pick.agentId, agentModel: pick.agentModel, label: pick.modelLabel };
        }
        const agentId = composer?.agentId ?? parentAgent;
        return agentId ? { agentId, label: agentId } : undefined;
    }

    protected selectionIsUsable(selection: SideChatSelection): boolean {
        const option = this.models?.find(candidate => candidate.agentId === selection.agentId && candidate.modelLabel === selection.label);
        return option ? this.isSelectable(option) : false;
    }

    protected isSelectable(option: QaapWorkHubSideChatModelOption): boolean {
        return this.availability(option).selectable;
    }

    protected availability(option: QaapWorkHubSideChatModelOption): ReturnType<typeof QaapHarnessModelAvailability.availability> {
        return QaapHarnessModelAvailability.availability({
            harnessEnabled: true,
            session: option.session,
            tier: option.tier,
        });
    }

    protected currentSelection(): SideChatSelection {
        return this.selection ?? this.defaultSelection() ?? { agentId: this.parent?.agentId ?? '', label: '' };
    }

    /**
     * The model pill is the main composer's agent pill: the shared toolbar button paints the harness mark, the model
     * label and the chevron, so both composers read the same.
     */
    protected renderModelButton(): void {
        const selection = this.currentSelection();
        const label = selection.label || nls.localizeByDefault('Model');
        populateAgentToolbarButton(this.modelButton, {
            agentId: selection.agentId,
            label: this.agentLabel(selection.agentId) ?? selection.agentId,
            agentModel: selection.agentModel ? { ...selection.agentModel, label } : undefined,
        });
        this.modelButton.title = label;
        this.modelButton.setAttribute('aria-expanded', String(!this.pickerPanel.hidden));
    }

    protected togglePicker(): void {
        if (this.pickerPanel.hidden) {
            this.pickerPanel.hidden = false;
            this.mountPicker();
            this.renderPicker();
            this.listenPickerEscape();
        } else {
            this.closePicker();
        }
        this.renderModelButton();
    }

    protected listenPickerEscape(): void {
        if (this.pickerEscape) {
            return;
        }
        this.pickerEscape = event => {
            if (event.key === 'Escape' && !this.pickerPanel.hidden) {
                event.preventDefault();
                this.closePicker();
            }
        };
        // Capture on the window: the keybinding service stops Escape before it reaches the document's bubble phase.
        this.view().addEventListener('keydown', this.pickerEscape, true);
    }

    protected closePicker(): void {
        if (this.pickerEscape) {
            this.view().removeEventListener('keydown', this.pickerEscape, true);
            this.pickerEscape = undefined;
        }
        this.pickerDetach?.();
        this.pickerDetach = undefined;
        disposeQaapComposerModelPicker(this.pickerHost);
        this.pickerHost.replaceChildren();
        this.pickerPanel.hidden = true;
        this.pickerPanel.remove();
        markStickyComposerPopoverAnchor(this.modelButton, false);
        this.renderModelButton();
    }

    /**
     * Puts the open picker on the overlay layer, as the main composer does: a body-level fixed popover, dismissed by a
     * click outside or Escape, placed on the pill and kept in place on scroll, resize and layout changes.
     */
    protected mountPicker(): void {
        const doc = this.element.ownerDocument;
        doc.body.append(this.pickerPanel);
        markStickyComposerPopoverAnchor(this.modelButton, true);
        const dismiss = wireStickyComposerPopoverDismiss(this.pickerPanel, this.modelButton, () => this.closePicker(), 'start');
        const onResize = (): void => this.placePicker();
        const win = this.view();
        win.addEventListener('resize', onResize);
        // The panel's own size changes when the right panel is dragged; the picker follows its pill.
        const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(onResize) : undefined;
        observer?.observe(this.element);
        this.pickerDetach = (): void => {
            dismiss();
            win.removeEventListener('resize', onResize);
            observer?.disconnect();
        };
    }

    protected renderPicker(): void {
        if (this.pickerPanel.hidden) {
            return;
        }
        renderQaapComposerModelPicker(this.pickerHost, this.pickerProps());
        this.placePicker();
    }

    /** The main composer's placement: the height first, then the popover above its pill, clamped inside the viewport. */
    protected placePicker(): void {
        if (this.pickerPanel.hidden || !this.pickerPanel.isConnected) {
            return;
        }
        placePickerAbove(this.pickerPanel, this.modelButton);
    }

    /** The shared picker's props, from this side chat's own models and selection. Picking a model changes this side chat only. */
    protected pickerProps(): QaapComposerModelPickerProps {
        const models = this.models ?? [];
        const harnesses = new Map<string, string>();
        for (const option of models) {
            harnesses.set(option.agentId, option.agentLabel);
        }
        const selection = this.currentSelection();
        const state: QaapPickerState = {
            harnesses: Array.from(harnesses, ([id, label]) => ({ id, label })),
            models: models.map(option => this.toPickerModel(option)),
            favorites: QaapComposerModelPickerModel.readFavorites(this.storage()),
            railSelection: this.pickerRail ?? selection.agentId,
            query: this.pickerQuery,
            currentAgentId: selection.agentId,
            currentModelId: selection.agentModel?.modelId,
        };
        return {
            state,
            effort: {},
            // No approval policy in a side chat: the picker omits its access block.
            onSelectModel: (agentId, modelId) => this.chooseModel(agentId, modelId),
            onSignIn: agentId => this.host.startSignIn(agentId),
            onSelectEffort: () => undefined,
            onSelectApproval: () => undefined,
            onToggleFavorite: key => this.toggleFavorite(key),
            onQuery: query => { this.pickerQuery = query; this.renderPicker(); },
            onRail: rail => { this.pickerRail = rail; this.renderPicker(); },
            onClose: () => this.closePicker(),
        };
    }

    protected toPickerModel(option: QaapWorkHubSideChatModelOption): QaapPickerModel {
        const availability = this.availability(option);
        return {
            agentId: option.agentId,
            modelId: option.agentModel?.modelId ?? option.modelLabel,
            label: option.modelLabel,
            available: availability.selectable,
            unavailableReason: availability.selectable ? undefined : availability.reason,
            tier: option.tier,
            signInRequired: availability.reason === 'sign-in-required',
        };
    }

    protected chooseModel(agentId: string, modelId: string): void {
        const option = (this.models ?? []).find(candidate => candidate.agentId === agentId
            && (candidate.agentModel?.modelId ?? candidate.modelLabel) === modelId);
        if (!option || !this.isSelectable(option)) {
            return;
        }
        this.selection = { agentId: option.agentId, agentModel: option.agentModel, label: option.modelLabel };
        this.pickerQuery = '';
        this.pickerRail = undefined;
        this.closePicker();
    }

    protected toggleFavorite(key: string): void {
        const storage = this.storage();
        const next = QaapComposerModelPickerModel.toggleFavorite(QaapComposerModelPickerModel.readFavorites(storage), key);
        QaapComposerModelPickerModel.writeFavorites(storage, next);
        this.renderPicker();
    }

    protected storage(): Storage | undefined {
        try {
            return this.view().localStorage;
        } catch {
            return undefined;
        }
    }

    /** The send button follows the main composer: disabled while the input is empty or a send is running, ready with text. */
    protected updateSendState(): void {
        const has = this.input.value.trim().length > 0 || this.attachments.some(item => !item.pending);
        const uploading = this.attachments.some(item => item.pending);
        this.sendButton.disabled = this.sending || !has || uploading;
        this.sendButton.classList.toggle('theia-mod-ready', has && !this.sending && !uploading);
    }

    protected growInput(): void {
        this.input.style.height = 'auto';
        // Never shorter than the main composer's one-line input, so the two composers read the same height.
        this.input.style.height = `${Math.min(Math.max(this.input.scrollHeight, INPUT_MIN_HEIGHT_PX), INPUT_MAX_HEIGHT_PX)}px`;
    }

    protected renderTitle(): void {
        this.titleText.textContent = this.title ?? nls.localize('qaap/workHubAuxPanel/sideChat', 'Side chat');
        this.bringBackButton.disabled = !this.conversationId;
    }

    protected setConfirming(confirming: boolean): void {
        this.confirmBar.hidden = !confirming;
    }

    protected renderContext(): void {
        const parent = this.parent ?? (this.visible ? this.host.resolveParent() : undefined);
        if (!parent) {
            this.contextLine.hidden = true;
            this.contextLine.textContent = '';
            return;
        }
        const title = parent.title || nls.localize('qaap/workHubAuxPanel/sideChatUntitled', 'Untitled conversation');
        this.contextLine.textContent = nls.localize('qaap/workHubAuxPanel/sideChatContextFrom', 'Context from · {0}', title);
        this.contextLine.hidden = false;
    }

    protected renderEmpty(): void {
        this.emptyHint.hidden = this.rows.size > 0;
    }

    protected setStatus(text: string): void {
        this.status.textContent = text;
        this.status.hidden = text === '';
    }

    protected isNearBottom(): boolean {
        return this.scroll.scrollHeight - this.scroll.scrollTop - this.scroll.clientHeight < FOLLOW_THRESHOLD_PX;
    }

    protected followBottom(): void {
        this.scroll.scrollTop = this.scroll.scrollHeight;
    }

    protected errorMessage(error: unknown): string {
        return error instanceof Error && error.message
            ? error.message
            : nls.localize('qaap/workHubAuxPanel/sideChatFailed', 'The side chat could not send the message.');
    }

    protected headerButton(className: string, icon: string, label: string, onClick: () => void, title?: string): HTMLButtonElement {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = className;
        button.title = title ?? label;
        button.setAttribute('aria-label', label);
        const glyph = document.createElement('span');
        glyph.className = `codicon ${icon}`;
        glyph.setAttribute('aria-hidden', 'true');
        button.append(glyph);
        button.addEventListener('click', onClick);
        return button;
    }

    protected textButton(className: string, label: string, onClick: () => void): HTMLButtonElement {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = className;
        button.textContent = label;
        button.addEventListener('click', onClick);
        return button;
    }

    protected view(): Window {
        return this.element.ownerDocument.defaultView ?? window;
    }
}
