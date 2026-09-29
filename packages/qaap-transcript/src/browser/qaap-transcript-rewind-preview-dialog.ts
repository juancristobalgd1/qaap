// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { AbstractDialog } from '@theia/core/lib/browser/dialogs';
import { nls } from '@theia/core/lib/common/nls';
import { fetchConversationRewindPreview } from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';
import type {
    QaapRewindFileAction,
    QaapRewindPreviewDTO,
    QaapRewindPreviewFileDTO,
    QaapRewindRestoreOptions,
    QaapRewindUnsafeReason,
} from '@theia/qaap-shared-core/lib/common/qaap-conversation-rewind-preview';

/** Scroll host of the file list; registered in the mobile touch-scroll fallback. */
export const QAAP_REWIND_PREVIEW_LIST_CLASS = 'qaap-rewind-preview-list';

export interface QaapTranscriptRewindPreviewDialogProps {
    readonly title: string;
    readonly intro: string;
    /** Label of the single confirm button when every file is safe (e.g. "Restore", "Undo"). */
    readonly confirmLabel: string;
    readonly preview: QaapRewindPreviewDTO;
}

export function rewindActionLabel(action: QaapRewindFileAction): string {
    switch (action) {
        case 'delete': return nls.localizeByDefault('Delete');
        case 'recreate': return nls.localize('qaap/transcriptRewind/actionRecreate', 'Recreate');
        default: return nls.localizeByDefault('Revert');
    }
}

export function rewindReasonLabel(reason: QaapRewindUnsafeReason): string {
    switch (reason) {
        case 'modified-externally':
            return nls.localize('qaap/transcriptRewind/reasonModified', 'Edited after the agent finished');
        case 'created-externally':
            return nls.localize('qaap/transcriptRewind/reasonCreated', 'Created outside the agent');
        case 'deleted-externally':
            return nls.localize('qaap/transcriptRewind/reasonDeleted', 'Deleted after the agent finished');
        case 'ignored-content':
            return nls.localize('qaap/transcriptRewind/reasonIgnored', 'Ignored file on disk would be overwritten');
        case 'binary':
            return nls.localize('qaap/transcriptRewind/reasonBinary', 'Binary file');
        case 'large':
            return nls.localize('qaap/transcriptRewind/reasonLarge', 'Large file');
        case 'conflict':
            return nls.localize('qaap/transcriptRewind/reasonConflict', 'Has unresolved merge conflicts');
        default:
            return nls.localize('qaap/transcriptRewind/reasonUnknownBaseline', 'Cannot tell who changed it');
    }
}

/**
 * Rewind preview: files the restore would touch grouped "Needs attention" / "Safe", with
 * "Restore safe files only", "Restore all" (behind an explicit checkbox when unsafe files exist)
 * and "Cancel". Resolves to the restore options, or `undefined` when cancelled.
 */
export class QaapTranscriptRewindPreviewDialog extends AbstractDialog<QaapRewindRestoreOptions | undefined> {

    protected choice: QaapRewindRestoreOptions | undefined;

    constructor(protected readonly previewProps: QaapTranscriptRewindPreviewDialogProps) {
        super({ title: previewProps.title, maxWidth: 560 });
        this.node.classList.add('qaap-rewind-preview-dialog');
        const { preview } = previewProps;
        this.contentNode.appendChild(this.createIntro());
        const unsafe = preview.files.filter(file => file.safety === 'unsafe');
        const safe = preview.files.filter(file => file.safety === 'safe');
        if (preview.files.length) {
            const list = document.createElement('div');
            list.className = QAAP_REWIND_PREVIEW_LIST_CLASS;
            if (unsafe.length) {
                list.appendChild(this.createGroup(
                    nls.localize('qaap/transcriptRewind/groupUnsafe', 'Needs attention ({0})', preview.unsafeCount),
                    unsafe,
                    'unsafe',
                ));
            }
            if (safe.length) {
                list.appendChild(this.createGroup(
                    nls.localize('qaap/transcriptRewind/groupSafe', 'Safe — only agent changes ({0})', preview.safeCount),
                    safe,
                    'safe',
                ));
            }
            this.contentNode.appendChild(list);
            if (preview.truncated) {
                const more = document.createElement('p');
                more.className = 'qaap-rewind-preview-note';
                more.textContent = nls.localize(
                    'qaap/transcriptRewind/truncated',
                    'Showing {0} of {1} files.',
                    preview.files.length,
                    preview.safeCount + preview.unsafeCount,
                );
                this.contentNode.appendChild(more);
            }
        }
        this.appendCloseButton(nls.localizeByDefault('Cancel'));
        if (!preview.unsafeCount) {
            this.acceptButton = this.appendChoiceButton(previewProps.confirmLabel, true, { mode: 'all' });
            return;
        }
        const confirmAll = this.createConfirmAllCheckbox(preview.unsafeCount);
        this.contentNode.appendChild(confirmAll.label);
        const allButton = this.appendChoiceButton(
            nls.localize('qaap/transcriptRewind/restoreAll', 'Restore all'),
            false,
            { mode: 'all', confirmUnsafe: true, ...(preview.unsafeToken ? { unsafeToken: preview.unsafeToken } : {}) },
        );
        allButton.disabled = true;
        allButton.classList.add('qaap-rewind-preview-danger');
        confirmAll.input.addEventListener('change', () => {
            allButton.disabled = !confirmAll.input.checked;
        });
        const safeButton = this.appendChoiceButton(
            nls.localize('qaap/transcriptRewind/restoreSafe', 'Restore safe files only'),
            true,
            { mode: 'safe' },
        );
        safeButton.disabled = preview.safeCount === 0;
        this.acceptButton = safeButton;
    }

    get value(): QaapRewindRestoreOptions | undefined {
        return this.choice;
    }

    /** Enter must never pick a restore mode implicitly. */
    protected override handleEnter(): boolean | void {
        return false;
    }

    protected appendChoiceButton(text: string, primary: boolean, options: QaapRewindRestoreOptions): HTMLButtonElement {
        const button = this.appendButton(text, primary);
        button.addEventListener('click', () => {
            if (button.disabled) {
                return;
            }
            this.choice = options;
            void this.accept();
        });
        return button;
    }

    protected createIntro(): HTMLElement {
        const { preview } = this.previewProps;
        const intro = document.createElement('div');
        intro.className = 'qaap-rewind-preview-intro';
        const text = document.createElement('p');
        text.textContent = this.previewProps.intro;
        intro.appendChild(text);
        const summary = document.createElement('p');
        summary.className = 'qaap-rewind-preview-summary';
        summary.textContent = preview.files.length
            ? nls.localize(
                'qaap/transcriptRewind/summary',
                '{0} file(s) will change: {1} safe, {2} need attention.',
                preview.safeCount + preview.unsafeCount,
                preview.safeCount,
                preview.unsafeCount,
            )
            : nls.localize('qaap/transcriptRewind/noFiles', 'No file changes to restore.');
        intro.appendChild(summary);
        return intro;
    }

    protected createGroup(title: string, files: readonly QaapRewindPreviewFileDTO[], kind: 'safe' | 'unsafe'): HTMLElement {
        const section = document.createElement('section');
        section.className = `qaap-rewind-preview-group qaap-mod-${kind}`;
        const heading = document.createElement('h4');
        heading.className = 'qaap-rewind-preview-group-title';
        heading.textContent = title;
        section.appendChild(heading);
        const list = document.createElement('ul');
        list.className = 'qaap-rewind-preview-files';
        for (const file of files) {
            list.appendChild(this.createFileRow(file));
        }
        section.appendChild(list);
        return section;
    }

    protected createFileRow(file: QaapRewindPreviewFileDTO): HTMLElement {
        const row = document.createElement('li');
        row.className = 'qaap-rewind-preview-file';
        const top = document.createElement('div');
        top.className = 'qaap-rewind-preview-file-top';
        const action = document.createElement('span');
        action.className = `qaap-rewind-preview-action qaap-mod-${file.action}`;
        action.textContent = rewindActionLabel(file.action);
        const filePath = document.createElement('span');
        filePath.className = 'qaap-rewind-preview-path';
        filePath.textContent = file.path;
        filePath.title = file.path;
        top.append(action, filePath);
        if (file.added !== undefined || file.removed !== undefined) {
            const stats = document.createElement('span');
            stats.className = 'qaap-rewind-preview-stats';
            const added = document.createElement('span');
            added.className = 'qaap-rewind-preview-added';
            added.textContent = `+${file.added ?? 0}`;
            const removed = document.createElement('span');
            removed.className = 'qaap-rewind-preview-removed';
            removed.textContent = `-${file.removed ?? 0}`;
            stats.append(added, removed);
            top.appendChild(stats);
        }
        row.appendChild(top);
        if (file.reasons.length) {
            const reasons = document.createElement('div');
            reasons.className = 'qaap-rewind-preview-reasons';
            reasons.textContent = file.reasons.map(rewindReasonLabel).join(' · ');
            row.appendChild(reasons);
        }
        return row;
    }

    protected createConfirmAllCheckbox(unsafeCount: number): { label: HTMLLabelElement; input: HTMLInputElement } {
        const label = document.createElement('label');
        label.className = 'qaap-rewind-preview-confirm';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.className = 'theia-input';
        const text = document.createElement('span');
        text.textContent = nls.localize(
            'qaap/transcriptRewind/confirmUnsafe',
            'I understand "Restore all" discards changes in {0} file(s) that the agent did not make.',
            unsafeCount,
        );
        label.append(input, text);
        return { label, input };
    }
}

export type QaapTranscriptRewindDecision =
    | { readonly kind: 'restore'; readonly options: QaapRewindRestoreOptions }
    | { readonly kind: 'cancel' }
    /** Preview unavailable (older backend, error) or nothing to restore: keep the legacy flow. */
    | { readonly kind: 'fallback' };

export interface QaapTranscriptRewindPromptOptions {
    readonly conversationId: string;
    readonly target: { readonly checkpointId?: string; readonly messageId?: string };
    readonly title: string;
    readonly intro: string;
    readonly confirmLabel: string;
    /** Skip the dialog (restore everything) when no file needs attention. */
    readonly skipWhenAllSafe?: boolean;
}

/** Fetch the dry-run preview and ask the user how to restore. */
export async function promptTranscriptRewindPreview(options: QaapTranscriptRewindPromptOptions): Promise<QaapTranscriptRewindDecision> {
    let preview: QaapRewindPreviewDTO;
    try {
        preview = await fetchConversationRewindPreview(options.conversationId, options.target);
    } catch (error) {
        console.warn('[qaap] rewind preview unavailable', error);
        return { kind: 'fallback' };
    }
    if (!preview.hasRestore) {
        return options.skipWhenAllSafe ? { kind: 'restore', options: { mode: 'safe' } } : { kind: 'fallback' };
    }
    if (options.skipWhenAllSafe && !preview.unsafeCount) {
        return { kind: 'restore', options: { mode: 'safe' } };
    }
    const choice = await new QaapTranscriptRewindPreviewDialog({
        title: options.title,
        intro: options.intro,
        confirmLabel: options.confirmLabel,
        preview,
    }).open();
    return choice ? { kind: 'restore', options: choice } : { kind: 'cancel' };
}
