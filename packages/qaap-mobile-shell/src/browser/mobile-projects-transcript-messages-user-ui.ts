// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import { ConfirmDialog } from '@theia/core/lib/browser';
import { conversationToSummary, rewindConversationToMessage, type QaapAgentConversationDTO, type QaapAgentMessageDTO } from '../common/qaap-agent-conversation-client';
import { resolveTranscriptUserMessageView } from '../common/qaap-agent-message-content';
import { isComposerGitActionOnlyMessage } from '../common/qaap-composer-git-action-display';
import { isSvgImagePreviewFileName, type QaapTranscriptUserImagePreview } from '../common/qaap-transcript-user-image-preview';
import { resolveTranscriptImagePreviewSrc } from './qaap-transcript-user-attachment-preview-ui';
import { MobileSnackbar } from './mobile-snackbar';
import type { MobileProjectsTranscriptMessagesContentUi } from './mobile-projects-transcript-messages-content-ui';
import type { MobileProjectsTranscriptMessagesHost } from './mobile-projects-transcript-messages-ui';
import type { MobileProjectsTranscriptMessagesToolUi } from './mobile-projects-transcript-messages-tool-ui';
import { createTranscriptGitActionCard } from './qaap-transcript-git-action-ui';

export class MobileProjectsTranscriptMessagesUserUi {
    constructor(
        protected readonly host: MobileProjectsTranscriptMessagesHost,
        protected readonly contentUi: MobileProjectsTranscriptMessagesContentUi,
        protected readonly toolUi: MobileProjectsTranscriptMessagesToolUi,
        protected readonly renderMessages: (host: HTMLElement, conv: QaapAgentConversationDTO) => void,
    ) { }

    createTranscriptUserMessageRow(
        msg: QaapAgentMessageDTO,
        conv: QaapAgentConversationDTO,
        options?: { readonly deferHeavyContent?: boolean },
    ): HTMLElement {
        const wrap = document.createElement('div');
        wrap.className = 'theia-mobile-agent-transcript-user-wrap';
        wrap.dataset.messageId = msg.id;
        if (msg.id) {
            wrap.id = this.transcriptUserMessageElementId(msg.id);
            wrap.setAttribute('data-transcript-message-id', msg.id);
        }
        const defer = !!options?.deferHeavyContent;
        if (defer) {
            wrap.setAttribute('data-transcript-row-deferred', '1');
        }

        const row = document.createElement('div');
        row.className = 'theia-mobile-agent-transcript-msg theia-mod-user';
        const messageView = resolveTranscriptUserMessageView(msg);
        const imagePreviews = messageView.imagePreviews;
        const gitActionOnly = !!messageView.gitActionInvocation && isComposerGitActionOnlyMessage(msg.content);
        if (gitActionOnly) {
            wrap.classList.add('theia-mod-git-action-record');
            row.classList.add('theia-mod-git-action');
        }
        if (imagePreviews.length) {
            wrap.append(this.createTranscriptUserImagePreviews(imagePreviews));
            void this.hydrateTranscriptUserImagePreviews(wrap, imagePreviews);
        }
        const contentEl = document.createElement('div');
        contentEl.className = 'theia-mobile-agent-transcript-content';
        const displayContent = messageView.displayText;
        if (messageView.gitActionInvocation) {
            contentEl.classList.add('theia-mod-user-git-action');
            contentEl.append(createTranscriptGitActionCard(messageView.gitActionInvocation));
            row.append(contentEl);
        } else if (displayContent.trim()) {
            if (messageView.skillInvocation) {
                this.renderTranscriptUserSkillInvocation(contentEl, messageView.skillInvocation);
            } else {
                this.toolUi.renderTranscriptRichContent(contentEl, displayContent, { defer, sync: !defer });
            }
            row.append(contentEl);
        } else if (!imagePreviews.length) {
            const fallback = resolveTranscriptUserMessageView(msg).displayText;
            if (fallback.trim()) {
                this.toolUi.renderTranscriptRichContent(contentEl, fallback, { defer, sync: !defer });
                row.append(contentEl);
            }
        }
        wrap.append(row);

        const plainText = this.contentUi.cleanTranscriptDisplayText(displayContent).trim();
        const summary = this.host.transcriptComposerSummary;
        const isTheiaChat = summary?.source === 'theia-chat';
        const actionsEnabled = conv.status !== 'streaming' && !msg.id.startsWith('pending-user-') && !gitActionOnly;

        wrap.append(this.createTranscriptUserMessageActions({
            plainText,
            canEdit: actionsEnabled,
            canUndo: actionsEnabled && !isTheiaChat,
            onEdit: () => { void this.editTranscriptUserMessage(msg, conv); },
            onCopy: () => { void this.copyTranscriptUserMessage(plainText); },
            onCopyLink: () => { void this.copyTranscriptUserMessageLink(msg.id); },
            onUndo: () => { void this.undoTranscriptUserMessage(msg, conv); },
        }));
        return wrap;
    }

    protected renderTranscriptUserSkillInvocation(
        contentEl: HTMLElement,
        skillInvocation: NonNullable<ReturnType<typeof resolveTranscriptUserMessageView>['skillInvocation']>,
    ): void {
        contentEl.classList.add('theia-mod-user-skill-invocation');
        const prefix = skillInvocation.prefix?.trim();
        if (prefix) {
            contentEl.append(document.createTextNode(`${prefix} `));
        }
        const pill = document.createElement('span');
        pill.className = 'theia-mobile-agent-transcript-skill-pill';
        pill.textContent = `/${skillInvocation.skillName}`;
        contentEl.append(pill);
        const userText = skillInvocation.userText?.trim();
        if (userText) {
            contentEl.append(document.createTextNode(` ${userText}`));
        }
    }

    createTranscriptUserImagePreviews(previews: readonly QaapTranscriptUserImagePreview[]): HTMLElement {
        const list = document.createElement('div');
        list.className = 'theia-mobile-agent-transcript-user-attachments';
        for (const preview of previews) {
            const card = document.createElement('div');
            card.className = 'theia-mobile-agent-transcript-user-attachment';

            const thumbHost = document.createElement('div');
            thumbHost.className = 'theia-mobile-agent-transcript-user-attachment-thumb';
            const img = document.createElement('img');
            img.className = 'theia-mobile-agent-transcript-user-attachment-image';
            img.alt = preview.fileName;
            img.loading = 'eager';
            img.decoding = 'async';
            if (preview.src) {
                img.src = preview.src;
            } else {
                thumbHost.classList.add('theia-mod-loading');
            }
            thumbHost.append(img);

            const body = document.createElement('div');
            body.className = 'theia-mobile-agent-transcript-user-attachment-body';
            const title = document.createElement('div');
            title.className = 'theia-mobile-agent-transcript-user-attachment-title';
            title.textContent = preview.fileName;
            const kind = document.createElement('div');
            kind.className = 'theia-mobile-agent-transcript-user-attachment-kind';
            kind.textContent = isSvgImagePreviewFileName(preview.fileName)
                ? nls.localizeByDefault('File')
                : nls.localize('qaap/mobileProjects/stickyComposerAttachmentImage', 'Image');
            body.append(title, kind);

            card.append(thumbHost, body);
            list.append(card);
        }
        return list;
    }

    protected async hydrateTranscriptUserImagePreviews(
        wrap: HTMLElement,
        previews: readonly QaapTranscriptUserImagePreview[],
    ): Promise<void> {
        const resolvePreview = this.host.resolveAttachmentPreview;
        if (!resolvePreview) {
            return;
        }
        const cards = [...wrap.querySelectorAll<HTMLElement>('.theia-mobile-agent-transcript-user-attachment')];
        await Promise.all(previews.map(async (preview, index) => {
            if (preview.src) {
                return;
            }
            const card = cards[index];
            if (!card?.isConnected) {
                return;
            }
            const thumbHost = card.querySelector<HTMLElement>('.theia-mobile-agent-transcript-user-attachment-thumb');
            const img = card.querySelector<HTMLImageElement>('.theia-mobile-agent-transcript-user-attachment-image');
            if (!thumbHost || !img) {
                return;
            }
            const src = await resolveTranscriptImagePreviewSrc(preview, resolvePreview);
            if (!card.isConnected) {
                return;
            }
            thumbHost.classList.remove('theia-mod-loading');
            if (src) {
                img.src = src;
            } else {
                thumbHost.classList.add('theia-mod-missing');
            }
        }));
    }

    createTranscriptUserMessageActions(options: {
        plainText: string;
        canEdit: boolean;
        canUndo: boolean;
        onEdit: () => void;
        onCopy: () => void;
        onCopyLink: () => void;
        onUndo: () => void;
    }): HTMLElement {
        const actions = document.createElement('div');
        actions.className = 'theia-mobile-agent-transcript-user-actions';

        const editLabel = nls.localize('qaap/mobileProjects/transcriptUserEdit', 'Edit');
        const copyLabel = nls.localize('qaap/mobileProjects/transcriptUserCopy', 'Copy');
        const linkLabel = nls.localize('qaap/mobileProjects/transcriptUserCopyLink', 'Copy link');
        const undoLabel = nls.localize('qaap/mobileProjects/transcriptUserUndo', 'Undo');

        const editBtn = this.createTranscriptUserActionButton('edit', editLabel, 'codicon-edit', options.onEdit);
        editBtn.disabled = !options.canEdit || !options.plainText;
        const copyBtn = this.createTranscriptUserActionButton('copy', copyLabel, 'codicon-copy', options.onCopy);
        copyBtn.disabled = !options.plainText;
        const linkBtn = this.createTranscriptUserActionButton('link', linkLabel, 'codicon-link', options.onCopyLink);
        const undoBtn = this.createTranscriptUserActionButton('undo', undoLabel, 'codicon-discard', options.onUndo);
        undoBtn.disabled = !options.canUndo;

        actions.append(editBtn, copyBtn, linkBtn, undoBtn);
        return actions;
    }

    createTranscriptUserActionButton(
        action: 'edit' | 'copy' | 'link' | 'undo',
        label: string,
        iconClass: string,
        onClick: () => void,
    ): HTMLButtonElement {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `theia-mobile-agent-transcript-user-action theia-mod-${action}`;
        button.title = label;
        button.setAttribute('aria-label', label);
        button.innerHTML = `<span class="codicon ${iconClass}" aria-hidden="true"></span><span class="theia-mobile-agent-transcript-user-action-label">${label}</span>`;
        button.addEventListener('click', event => {
            event.stopPropagation();
            event.preventDefault();
            onClick();
        });
        return button;
    }

    protected transcriptUserMessageElementId(messageId: string): string {
        return `qaap-transcript-message-${messageId}`;
    }

    protected transcriptUserMessageLink(messageId: string): string {
        const url = new URL(window.location.href);
        url.hash = this.transcriptUserMessageElementId(messageId);
        return url.toString();
    }

    async copyTranscriptUserMessageLink(messageId: string): Promise<void> {
        if (!messageId) {
            return;
        }
        try {
            const link = this.transcriptUserMessageLink(messageId);
            if (this.host.previewClipboard) {
                await this.host.previewClipboard.writeText(link);
            } else {
                await navigator.clipboard.writeText(link);
            }
            MobileSnackbar.show(nls.localize('qaap/mobileProjects/transcriptShellLinkCopied', 'Link copied'), { kind: 'success', duration: 1800 });
        } catch {
            MobileSnackbar.show(nls.localize('qaap/mobileProjects/transcriptShellCopyFailed', 'Could not copy'), { kind: 'warning' });
        }
    }

    async copyTranscriptUserMessage(text: string): Promise<void> {
        const trimmed = text.trim();
        if (!trimmed) {
            return;
        }
        try {
            if (this.host.previewClipboard) {
                await this.host.previewClipboard.writeText(trimmed);
            } else {
                await navigator.clipboard.writeText(trimmed);
            }
            MobileSnackbar.show(nls.localize('qaap/mobileProjects/transcriptShellCopied', 'Copied'), { kind: 'success', duration: 1800 });
        } catch {
            MobileSnackbar.show(nls.localize('qaap/mobileProjects/transcriptShellCopyFailed', 'Could not copy'), { kind: 'warning' });
        }
    }

    async editTranscriptUserMessage(
        msg: QaapAgentMessageDTO,
        conv: QaapAgentConversationDTO,
    ): Promise<void> {
        const summary = this.host.transcriptComposerSummary;
        if (!summary || this.host.transcriptOpenSummaryId !== conv.id) {
            return;
        }
        const plainText = this.contentUi.cleanTranscriptDisplayText(resolveTranscriptUserMessageView(msg).displayText).trim();
        if (!plainText) {
            return;
        }
        if (summary.source === 'theia-chat') {
            this.host.transcriptComposerDraft = plainText;
            this.host.transcriptStickyComposerUi.remountTranscriptStickyComposer();
            this.focusTranscriptComposerInput();
            return;
        }
        try {
            const updated = await rewindConversationToMessage(conv.id, msg.id);
            this.host.conversations?.recordSnapshot(conversationToSummary(updated));
            this.host.transcriptLastFingerprint = undefined;
            if (this.host.transcriptChatHost) {
                this.renderMessages(this.host.transcriptChatHost, updated);
            }
            this.host.transcriptComposerDraft = plainText;
            this.host.transcriptStickyComposerUi.remountTranscriptStickyComposer();
            this.focusTranscriptComposerInput();
        } catch (error) {
            MobileSnackbar.show(error instanceof Error ? error.message : String(error), { kind: 'warning' });
        }
    }

    async undoTranscriptUserMessage(
        msg: QaapAgentMessageDTO,
        conv: QaapAgentConversationDTO,
    ): Promise<void> {
        const summary = this.host.transcriptComposerSummary;
        if (!summary || this.host.transcriptOpenSummaryId !== conv.id || summary.source === 'theia-chat') {
            return;
        }
        const confirmed = await new ConfirmDialog({
            title: nls.localize('qaap/mobileProjects/transcriptUndoTitle', 'Undo message'),
            msg: nls.localize(
                'qaap/mobileProjects/transcriptUndoMsg',
                'Remove this message and everything after it? Tracked files may revert to the previous checkpoint.',
            ),
            ok: nls.localize('qaap/mobileProjects/transcriptUserUndo', 'Undo'),
            cancel: nls.localize('qaap/mobileProjects/parallelCancel', 'Back'),
        }).open();
        if (!confirmed) {
            return;
        }
        try {
            const updated = await rewindConversationToMessage(conv.id, msg.id);
            this.host.conversations?.recordSnapshot(conversationToSummary(updated));
            this.host.transcriptLastFingerprint = undefined;
            if (this.host.transcriptChatHost) {
                this.renderMessages(this.host.transcriptChatHost, updated);
            }
            MobileSnackbar.show(nls.localize('qaap/mobileProjects/transcriptUndoDone', 'Message undone'), { kind: 'success', duration: 2200 });
        } catch (error) {
            MobileSnackbar.show(error instanceof Error ? error.message : String(error), { kind: 'warning' });
        }
    }

    focusTranscriptComposerInput(): void {
        window.requestAnimationFrame(() => {
            const input = this.host.transcriptComposerHost?.querySelector<HTMLTextAreaElement>(
                '.theia-mobile-projects-sticky-composer-input',
            );
            if (!input) {
                return;
            }
            input.focus();
            const end = input.value.length;
            input.setSelectionRange(end, end);
        });
    }

    /** Plain DOM fallback when {@link ChatViewWidget} is unavailable. */
}
