// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import type { URI } from '@theia/core/lib/common/uri';
import { AIVariableResolutionRequest } from '@theia/ai-core';
import {
    applyStickyComposerToken,
    buildStickyComposerMentionOptions,
    buildStickyComposerSkillOptions,
    buildStickyComposerVariableOptions,
    type StickyComposerTokenOption,
} from '../common/qaap-sticky-composer-mention';
import { buildStickyComposerSlashSections, type StickyComposerSlashSection } from '../common/qaap-sticky-composer-slash-menu';
import { isAgentsHubIdleConversationSummary } from '../common/qaap-agents-hub-landing';
import type { QaapAgentConversationSummaryDTO } from '../common/qaap-agent-conversation-client';
import {
    applyComposerContextEntryPreview,
    resolveStickyComposerContextChip,
    resolveStickyComposerContextEntry,
    type StickyComposerContextChipView,
} from './qaap-sticky-composer-context-ui';
import {
    createComposerContextEntry,
    hasPendingComposerContextEntries,
    revokeComposerContextPreview,
    type StickyComposerContextEntry,
} from '../common/qaap-composer-context-entry';
import { createQuotedTextRequest } from '../common/qaap-quoted-text-context';
import { type QaapAgentTaskAgentOption } from '../common/qaap-agent-task-client';
import type { MobileComposerAttachHandlers } from './qaap-mobile-composer-device-attach';
import type { MobileProjectEntry } from './mobile-projects-types';
import { MobileSnackbar } from './mobile-snackbar';
import type { MobileProjectsTranscriptStickyComposerUi } from './mobile-projects-transcript-sticky-composer-ui';

/**
 * Surfaces a failed device attachment. Logs the real error (there is no console on mobile) and shows
 * the concrete reason in the snackbar when the upload rejected with one, instead of the opaque generic
 * message that hid the root cause.
 */
function showDeviceAttachFailed(error?: unknown): void {
    const detail = error instanceof Error ? error.message.trim() : typeof error === 'string' ? error.trim() : '';
    if (error !== undefined) {
        console.error('[qaap] device attachment failed', error);
    }
    const message = detail
        ? nls.localize(
            'qaap/mobileProjects/stickyComposerAttachDeviceFailedDetail',
            'Could not attach files from this device: {0}',
            detail,
        )
        : nls.localize(
            'qaap/mobileProjects/stickyComposerAttachDeviceFailed',
            'Could not attach files from this device.',
        );
    MobileSnackbar.show(message, { kind: 'warning', duration: detail ? 5000 : 2800 });
}

export interface MobileProjectsStickyComposerContextHost {
    stickyComposerContext: StickyComposerContextEntry[];
    transcriptComposerContext: StickyComposerContextEntry[];
    stickyComposerDraft: string;
    transcriptComposerDraft: string;
    pickContextVariable?: (anchor: HTMLElement, handlers: MobileComposerAttachHandlers) => Promise<AIVariableResolutionRequest[]>;
    dropComposerFiles?: (files: File[], handlers: MobileComposerAttachHandlers) => void;
    formatContextChip?: (item: AIVariableResolutionRequest) => StickyComposerContextChipView | undefined;
    getComposerVariables?: () => readonly import('@theia/ai-core').AIVariable[];
    getComposerSkills?: () => readonly { readonly name: string; readonly description?: string }[];
    openAiConfigurationSheet?: (tabId?: string) => Promise<void>;
    transcriptOpenSummary?: QaapAgentConversationSummaryDTO;
    transcriptComposerSummary?: QaapAgentConversationSummaryDTO;
    transcriptStickyComposerUi: MobileProjectsTranscriptStickyComposerUi;
    stickyComposerRenderUi: import('./mobile-projects-sticky-composer-render-ui').MobileProjectsStickyComposerRenderUi;
    stickyComposerAgentsUi: import('./mobile-projects-sticky-composer-agents-ui').MobileProjectsStickyComposerAgentsUi;
}

export class MobileProjectsStickyComposerContextUi {
    constructor(protected readonly host: MobileProjectsStickyComposerContextHost) { }

    async onStickyComposerAttach(
        project: MobileProjectEntry,
        anchor: HTMLElement,
    ): Promise<void> {
        if (!this.host.pickContextVariable) {
            return;
        }
        const variables = await this.host.pickContextVariable(anchor, this.createStickyComposerAttachHandlers(project.uri));
        if (variables.length === 0) {
            return;
        }
        for (const request of variables) {
            this.host.stickyComposerContext.push(createComposerContextEntry(request));
        }
        this.host.stickyComposerRenderUi.renderStickyComposer();
    }

    /**
     * Add dragged/pasted plain text as a quoted-text context chip. The text is
     * stored as a resolved context variable so the agent sees it as context
     * (not as part of the prompt draft).
     */
    dropQuotedText(text: string): void {
        const request = createQuotedTextRequest(text);
        const entry = createComposerContextEntry(request);
        // Store the full text on the entry so the agent receives the untruncated
        // version when the context is resolved at submit time.
        entry.displayName = nls.localize('qaap/mobileProjects/quotedText', 'Quoted text');
        this.host.stickyComposerContext.push(entry);
        this.host.stickyComposerRenderUi.renderStickyComposer();
    }
    createStickyComposerAttachHandlers(uploadTargetDir?: URI): MobileComposerAttachHandlers {
        return {
            uploadTargetDir,
            insertComposerSkill: skillName => {
                this.insertComposerSkillInDraft(
                    skillName,
                    () => this.host.stickyComposerDraft,
                    value => { this.host.stickyComposerDraft = value; },
                    () => { this.host.stickyComposerRenderUi.renderStickyComposer(); },
                );
            },
            appendOptimistic: entry => {
                this.host.stickyComposerContext.push(entry);
                this.host.stickyComposerRenderUi.renderStickyComposer();
            },
            finalizeOptimistic: (id, request) => {
                const entry = this.host.stickyComposerContext.find(item => item.id === id);
                if (!entry) {
                    return;
                }
                revokeComposerContextPreview(entry);
                entry.request = request;
                entry.pending = false;
                entry.localPreviewSrc = undefined;
                entry.displayName = undefined;
                this.host.stickyComposerRenderUi.renderStickyComposer();
            },
            removeOptimistic: (id, error) => {
                const index = this.host.stickyComposerContext.findIndex(item => item.id === id);
                if (index < 0) {
                    return;
                }
                revokeComposerContextPreview(this.host.stickyComposerContext[index]);
                this.host.stickyComposerContext.splice(index, 1);
                this.host.stickyComposerRenderUi.renderStickyComposer();
                showDeviceAttachFailed(error);
            },
        };
    }
    createTranscriptComposerAttachHandlers(uploadTargetDir?: URI): MobileComposerAttachHandlers {
        return {
            uploadTargetDir,
            insertComposerSkill: skillName => {
                this.insertComposerSkillInDraft(
                    skillName,
                    () => this.host.transcriptComposerDraft,
                    value => { this.host.transcriptComposerDraft = value; },
                    () => { this.host.transcriptStickyComposerUi.remountTranscriptStickyComposer(); },
                );
            },
            appendOptimistic: entry => {
                this.host.transcriptComposerContext.push(entry);
                this.host.transcriptStickyComposerUi.remountTranscriptStickyComposer();
            },
            finalizeOptimistic: (id, request) => {
                const entry = this.host.transcriptComposerContext.find(item => item.id === id);
                if (!entry) {
                    return;
                }
                revokeComposerContextPreview(entry);
                entry.request = request;
                entry.pending = false;
                entry.localPreviewSrc = undefined;
                entry.displayName = undefined;
                this.host.transcriptStickyComposerUi.remountTranscriptStickyComposer();
            },
            removeOptimistic: (id, error) => {
                const index = this.host.transcriptComposerContext.findIndex(item => item.id === id);
                if (index < 0) {
                    return;
                }
                revokeComposerContextPreview(this.host.transcriptComposerContext[index]);
                this.host.transcriptComposerContext.splice(index, 1);
                this.host.transcriptStickyComposerUi.remountTranscriptStickyComposer();
                showDeviceAttachFailed(error);
            },
        };
    }
    hasPendingComposerAttachments(): boolean {
        return hasPendingComposerContextEntries(this.host.stickyComposerContext)
            || hasPendingComposerContextEntries(this.host.transcriptComposerContext);
    }
    /**
     * Attaches files dragged onto the home/repos sticky composer. Creates the same optimistic
     * handlers as the attach picker so chips appear instantly and finalize/fail identically.
     */
    dropStickyComposerFiles(project: MobileProjectEntry, files: readonly File[], uploadTargetDir?: URI): void {
        console.log('[qaap-drop] dropStickyComposerFiles', {
            hasDropFn: !!this.host.dropComposerFiles,
            fileCount: files.length,
            uploadTargetDir: uploadTargetDir?.toString(),
            projectUri: project.uri?.toString(),
        });
        if (!this.host.dropComposerFiles || files.length === 0) {
            console.log('[qaap-drop] dropStickyComposerFiles BAILING', { hasDropFn: !!this.host.dropComposerFiles, fileCount: files.length });
            return;
        }
        try {
            this.host.dropComposerFiles(
                Array.from(files),
                this.createStickyComposerAttachHandlers(uploadTargetDir ?? project.uri),
            );
        } catch (error) {
            console.error('[qaap-drop] dropStickyComposerFiles ERROR', error);
            showDeviceAttachFailed(error);
        }
    }
    /** Attaches files dragged onto the transcript overlay composer. */
    dropTranscriptComposerFiles(project: MobileProjectEntry, files: readonly File[], uploadTargetDir?: URI): void {
        if (!this.host.dropComposerFiles || files.length === 0) {
            return;
        }
        try {
            this.host.dropComposerFiles(
                Array.from(files),
                this.createTranscriptComposerAttachHandlers(uploadTargetDir),
            );
        } catch (error) {
            showDeviceAttachFailed(error);
        }
    }
    notifyPendingComposerAttachments(): void {
        MobileSnackbar.show(
            nls.localize(
                'qaap/mobileProjects/stickyComposerAttachmentsPending',
                'Wait for attachments to finish preparing before sending.',
            ),
            { kind: 'warning', duration: 2600 },
        );
    }
    formatComposerContextEntry(entry: StickyComposerContextEntry): StickyComposerContextChipView {
        const fromProvider = this.host.formatContextChip?.(entry.request);
        if (!fromProvider) {
            return resolveStickyComposerContextEntry(entry);
        }
        // The host provider only sees `entry.request`, so a pending attachment's local blob preview,
        // pending flag and device file name are lost. Merge them back so the miniature renders.
        return applyComposerContextEntryPreview(fromProvider, entry);
    }
    formatComposerContextChip(item: AIVariableResolutionRequest): StickyComposerContextChipView {
        return this.host.formatContextChip?.(item) ?? resolveStickyComposerContextChip(item);
    }
    resolveComposerMentionOptions(
        backendAgents: readonly QaapAgentTaskAgentOption[],
        coderOnly = false,
    ): StickyComposerTokenOption[] {
        const coder = this.host.stickyComposerAgentsUi.getOfferableCoderAgent();
        return buildStickyComposerMentionOptions(
            coderOnly ? [] : backendAgents,
            coder ? { name: coder.name } : undefined,
        );
    }
    resolveComposerVariableOptions(): StickyComposerTokenOption[] {
        return buildStickyComposerVariableOptions(this.host.getComposerVariables?.() ?? []);
    }
    resolveComposerSkillOptions(): StickyComposerTokenOption[] {
        return buildStickyComposerSkillOptions(this.host.getComposerSkills?.() ?? []);
    }
    resolveComposerSlashMenuSections(): StickyComposerSlashSection[] {
        const summary = this.host.transcriptOpenSummary ?? this.host.transcriptComposerSummary;
        const canFork = !!summary && !isAgentsHubIdleConversationSummary(summary);
        return buildStickyComposerSlashSections({
            skills: this.host.getComposerSkills?.() ?? [],
            canFork,
            canManagePlugins: !!this.host.openAiConfigurationSheet,
        });
    }
    protected insertComposerSkillInDraft(
        skillName: string,
        getDraft: () => string,
        setDraft: (value: string) => void,
        rerender: () => void,
    ): void {
        const token = {
            id: skillName,
            label: skillName,
            trigger: '/' as const,
            insertBody: `${skillName} `,
        };
        const draft = getDraft();
        const applied = applyStickyComposerToken(draft, draft.length, token);
        setDraft(applied.value);
        rerender();
    }
}

