// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import * as markdownit from '@theia/core/shared/markdown-it';
import { ClipboardService } from '@theia/core/lib/browser/clipboard-service';
import { MessageService } from '@theia/core/lib/common/message-service';
import { Disposable } from '@theia/core/lib/common/disposable';
import {
    type QaapAgentConversationDTO,
    type QaapAgentConversationSummaryDTO,
    type QaapAgentMessageDTO,
    type QaapAgentMessageSegmentDTO,
} from '../common/qaap-agent-conversation-client';
import { MobileProjectsTranscriptUi } from './mobile-projects-transcript-ui';
import type { MobileProjectEntry } from './mobile-projects-types';
import type { MobileProjectsConversations } from './mobile-projects-conversations';
import type { MobileProjectsService } from './mobile-projects-service';
import { MobileProjectsTranscriptMessagesArtifactsUi, type TranscriptActivityTimelineOptions } from './mobile-projects-transcript-messages-artifacts-ui';
import { MobileProjectsTranscriptMessagesContentUi } from './mobile-projects-transcript-messages-content-ui';
import { MobileProjectsTranscriptMessagesRenderUi } from './mobile-projects-transcript-messages-render-ui';
import { MobileProjectsTranscriptMessagesResolversUi } from './mobile-projects-transcript-messages-resolvers-ui';
import { MobileProjectsTranscriptMessagesToolUi } from './mobile-projects-transcript-messages-tool-ui';
import { MobileProjectsTranscriptMessagesUserUi } from './mobile-projects-transcript-messages-user-ui';
import { resolveAgentMessageSegments } from '../common/qaap-transcript-trace-model';
import { WORKING_DETAIL_TRANSCRIPT_CLASS } from './qaap-sticky-composer-working-detail-transcript';
import type { MobileProjectsTranscriptHeaderUi } from './mobile-projects-transcript-header-ui';
import type { MobileProjectsTranscriptLiveUi } from './mobile-projects-transcript-live-ui';
import type { MobileProjectsTranscriptStickyComposerUi } from './mobile-projects-transcript-sticky-composer-ui';
import type { MobileProjectsExecutionSurfaceTabsUi } from './mobile-projects-execution-surface-tabs-ui';
import type { WorkHubTranscriptBridge } from './work-hub-transcript-bridge';

/** Panel surface consumed by transcript message rendering (keeps deps narrow vs. the full panel). */
export interface MobileProjectsTranscriptMessagesHost {
    transcriptUi: MobileProjectsTranscriptUi;
    transcriptUserScrollPinDispose: Disposable;
    transcriptLastConv: QaapAgentConversationDTO | undefined;
    transcriptLastRenderedConversationId: string | undefined;
    transcriptLastRenderedMessageId: string | undefined;
    transcriptLastFingerprint: string | undefined;
    transcriptLastStreamProgressAt: number | undefined;
    transcriptLastSemanticProgressKey: string | undefined;
    transcriptLastTransportEventAt: number | undefined;
    transcriptChatHost: HTMLElement | undefined;
    transcriptComposerDraft: string;
    transcriptComposerHost: HTMLElement | undefined;
    transcriptComposerProject: MobileProjectEntry | undefined;
    transcriptComposerSummary: QaapAgentConversationSummaryDTO | undefined;
    transcriptOpenProject: MobileProjectEntry | undefined;
    transcriptOpenSummary: QaapAgentConversationSummaryDTO | undefined;
    transcriptOpenSummaryId: string | undefined;
    transcriptPreviewRequestPending: boolean;
    transcriptPreviewRequestRunning: boolean;
    transcriptMarkdownIt: ReturnType<typeof markdownit>;
    openTranscriptFile?: (filePath: string) => void | Promise<void>;
    openTranscriptReviewFile?: (filePath: string) => void | Promise<void>;
    messageService?: MessageService;
    previewClipboard?: ClipboardService;
    conversations?: MobileProjectsConversations;
    projectsService: MobileProjectsService;
    projects: MobileProjectEntry[];
    projectBootstrap?: import('./qaap-project-bootstrap-service').QaapProjectBootstrapService;
    resolveAttachmentPreview?: (
        item: import('@theia/ai-core').AIVariableResolutionRequest,
    ) => Promise<string | undefined>;

    projectRowsUi: import('./mobile-projects-project-rows-ui').MobileProjectsProjectRowsUi;
    transcriptHeaderUi: MobileProjectsTranscriptHeaderUi;
    transcriptLiveUi: MobileProjectsTranscriptLiveUi;
    transcriptStickyComposerUi: MobileProjectsTranscriptStickyComposerUi;
    executionSurfaceTabsUi: MobileProjectsExecutionSurfaceTabsUi;
    maybeSyncTranscriptVisuallySettledChrome(conv: QaapAgentConversationDTO): void;
    cancelOpenTranscriptStream?(): void;
    retryOpenTranscriptStream?(): void | Promise<void>;
    retryOpenFailedConversationTask?(): void | Promise<void>;
    /**
     * Retries whichever conversation is currently open, resolving it the same
     * way {@link cancelOpenTranscriptStream} does: the transcript sheet's open
     * project/summary when a sheet is open, falling back to the Agents Hub
     * inline shell's conversation otherwise. Used by the closing error card's
     * "Retry" action, which must work regardless of which surface renders the
     * conversation.
     */
    retryOpenTranscriptConversation?(): void | Promise<void>;
    /**
     * Opens the transcript terminal and starts the agent CLI login flow
     * (device-auth / OAuth), so Work Hub chat can mirror the TUI sign-in URL.
     */
    openAgentSignInTerminal?(agentId?: string): void | Promise<void>;
}

/** Transcript message list rendering: rows, streaming patches, and rich segment UI. */
export class MobileProjectsTranscriptMessagesUi {

    protected readonly contentUi: MobileProjectsTranscriptMessagesContentUi;
    protected readonly resolversUi: MobileProjectsTranscriptMessagesResolversUi;
    protected readonly toolUi: MobileProjectsTranscriptMessagesToolUi;
    protected readonly artifactsUi: MobileProjectsTranscriptMessagesArtifactsUi;
    protected readonly userUi: MobileProjectsTranscriptMessagesUserUi;
    protected readonly renderUi: MobileProjectsTranscriptMessagesRenderUi;

    constructor(
        protected readonly host: MobileProjectsTranscriptMessagesHost,
        protected readonly workHub: WorkHubTranscriptBridge,
    ) {
        this.contentUi = new MobileProjectsTranscriptMessagesContentUi(host);
        this.resolversUi = new MobileProjectsTranscriptMessagesResolversUi(host, this.contentUi);
        this.toolUi = new MobileProjectsTranscriptMessagesToolUi(host, this.contentUi, this.resolversUi);
        this.artifactsUi = new MobileProjectsTranscriptMessagesArtifactsUi(
            host,
            this.contentUi,
            this.resolversUi,
            this.toolUi,
            conv => this.applyTranscriptConversationMutation(conv),
        );
        let renderUi!: MobileProjectsTranscriptMessagesRenderUi;
        this.userUi = new MobileProjectsTranscriptMessagesUserUi(host, this.contentUi, this.toolUi, (messageHost, conv) => {
            renderUi.renderTranscriptMessages(messageHost, conv);
        });
        renderUi = new MobileProjectsTranscriptMessagesRenderUi(host, workHub, this.contentUi, this.userUi, this.artifactsUi, this.toolUi);
        this.renderUi = renderUi;
    }

    resolveTranscriptMessageHost(host: HTMLElement): HTMLElement {
        return this.renderUi.resolveTranscriptMessageHost(host);
    }

    normalizeTranscriptPreviewLink(href: string): string | undefined {
        return this.contentUi.normalizeTranscriptPreviewLink(href);
    }

    async openTranscriptPreviewUrlFromLink(href: string): Promise<boolean> {
        return this.contentUi.openTranscriptPreviewUrlFromLink(href);
    }

    resolveTranscriptAgentSegments(
        conv: QaapAgentConversationDTO,
        msg: QaapAgentMessageDTO,
    ): QaapAgentMessageSegmentDTO[] | undefined {
        return this.renderUi.resolveTranscriptAgentSegments(conv, msg);
    }

    renderTranscriptMessages(host: HTMLElement, conv: QaapAgentConversationDTO): void {
        this.renderUi.renderTranscriptMessages(host, conv);
    }

    createTranscriptToolApprovalActions(
        conversationId: string,
        segment: Extract<QaapAgentMessageSegmentDTO, { type: 'tool' }>,
    ): HTMLElement {
        return this.artifactsUi.createTranscriptToolApprovalActions(conversationId, segment);
    }

    settleVisuallySettledAgentTranscript(messageHost: HTMLElement, conv: QaapAgentConversationDTO): void {
        this.renderUi.settleVisuallySettledAgentTranscript(messageHost, conv);
    }

    focusTranscriptComposerInput(): void {
        this.userUi.focusTranscriptComposerInput();
    }

    resolveTranscriptActivityItems(
        segments: QaapAgentMessageSegmentDTO[],
        includeThinkingSteps = true,
    ): import('../common/qaap-transcript-activity-navigation').TranscriptActivityNavigationItem[] {
        return this.resolversUi.resolveTranscriptActivityItems(segments, includeThinkingSteps);
    }

    resolveTranscriptStreamingActivity(
        conv: QaapAgentConversationDTO,
        options?: { readonly stalled?: boolean; readonly timedOut?: boolean },
    ): { kind: string; title: string; detail: string } {
        return this.artifactsUi.resolveTranscriptStreamingActivity(conv, options);
    }

    scrollTranscriptStreamingTraceIntoView(options?: { readonly expandTimeline?: boolean }): void {
        this.artifactsUi.scrollTranscriptStreamingTraceIntoView(options);
    }

    applyTranscriptConversationMutation(conv: QaapAgentConversationDTO): void {
        this.host.transcriptLastConv = conv;
        this.host.transcriptLastFingerprint = undefined;
        const messageHost = this.host.transcriptChatHost;
        if (messageHost) {
            this.renderTranscriptMessages(messageHost, conv);
        }
        this.host.transcriptStickyComposerUi.refreshComposerActivityStack();
    }

    createTranscriptActivityTimeline(
        segments: QaapAgentMessageSegmentDTO[],
        options?: TranscriptActivityTimelineOptions & { readonly includeThinkingSteps?: boolean },
    ): HTMLElement | undefined {
        return this.artifactsUi.createTranscriptActivityTimeline(segments, options);
    }

    cleanTranscriptDisplayText(content: string | undefined | null): string {
        return this.contentUi.cleanTranscriptDisplayText(content);
    }

    resolveComposerActivityFiles(
        conv: QaapAgentConversationDTO | undefined,
        summary?: QaapAgentConversationSummaryDTO,
        options?: { readonly allTurns?: boolean },
    ): {
        readonly files: Array<{ readonly path: string; readonly kind: 'edited' | 'created'; readonly added?: number; readonly removed?: number }>;
        readonly stats?: { readonly added: number; readonly removed: number };
    } {
        const segments = this.resolveComposerConversationSegments(conv, options);
        const files = this.resolversUi.resolveTranscriptChangedFiles(segments);
        let stats = this.resolversUi.resolveTranscriptDiffStats(segments);
        if (!stats && summary && ((summary.linesAdded ?? 0) > 0 || (summary.linesRemoved ?? 0) > 0)) {
            stats = { added: summary.linesAdded ?? 0, removed: summary.linesRemoved ?? 0 };
        }
        return {
            files: files.map(file => ({
                ...file,
                ...this.resolversUi.resolveTranscriptFileDiffStats(segments, file.path),
            })),
            stats,
        };
    }

    /**
     * True when the agent ran any file-change tool (Write/Edit/Patch/…) in this conversation.
     * Some agent CLIs (e.g. opencode) report these tool calls with empty args, so no file path or
     * diff stats can be extracted — the call itself is still proof the agent modified files here.
     */
    hasComposerFileChangeToolCalls(conv: QaapAgentConversationDTO | undefined): boolean {
        return this.resolveComposerConversationSegments(conv, { allTurns: true }).some(segment =>
            segment.type === 'tool'
            // 'todowrite' / 'todo_write' track the agent's task list, not workspace files.
            && !segment.name.toLowerCase().includes('todo')
            && !!this.resolversUi.resolveTranscriptFileChangeKind(segment.name));
    }

    /**
     * Working DETAIL excerpt: same user/agent row DOM as the main transcript so expanding
     * a Working pill shows Qaap's transcript rendering (Cursor-style panel, Qaap content).
     */
    createWorkingDetailTranscriptExcerpt(options: {
        readonly document?: QaapAgentConversationDTO;
        readonly liveSegments?: readonly QaapAgentMessageSegmentDTO[];
        readonly taskLogSegments?: readonly QaapAgentMessageSegmentDTO[];
        readonly streaming?: boolean;
        readonly conversationId?: string;
        readonly agentId?: string;
        readonly title?: string;
    }): HTMLElement | undefined {
        const root = document.createElement('div');
        root.className = WORKING_DETAIL_TRANSCRIPT_CLASS;

        const conv = options.document;
        if (conv?.messages?.length) {
            for (let index = 0; index < conv.messages.length; index++) {
                const msg = conv.messages[index]!;
                const isTail = index === conv.messages.length - 1;
                if (msg.role === 'user') {
                    root.append(this.userUi.createTranscriptUserMessageRow(msg, conv, { readOnly: true }));
                    continue;
                }
                if (msg.role !== 'agent') {
                    continue;
                }
                let segments = this.resolveTranscriptAgentSegments(conv, msg) ?? [...resolveAgentMessageSegments(msg)];
                if (isTail && options.liveSegments && options.liveSegments.length > segments.length) {
                    segments = [...options.liveSegments];
                }
                const streaming = !!options.streaming
                    || (isTail && (conv.status === 'streaming' || conv.status === 'settled'));
                if (segments.length > 0) {
                    const row = this.artifactsUi.createTranscriptAgentSegmentsRow(segments, msg.error, conv, {
                        streaming,
                        message: msg,
                    });
                    if (msg.id) {
                        row.setAttribute('data-transcript-message-id', msg.id);
                    }
                    root.append(row);
                } else if (msg.error?.trim()) {
                    const row = this.artifactsUi.createTranscriptAgentSegmentsRow([], msg.error, conv, {
                        streaming: false,
                        message: msg,
                    });
                    root.append(row);
                }
            }
            return root.childElementCount > 0 ? root : undefined;
        }

        const fallbackSegments = (options.liveSegments && options.liveSegments.length > 0)
            ? options.liveSegments
            : (options.taskLogSegments ?? []);
        if (fallbackSegments.length === 0) {
            return undefined;
        }
        const now = Date.now();
        const synthetic: QaapAgentConversationDTO = {
            id: options.conversationId?.trim() || 'working-detail-excerpt',
            cwd: '',
            agentId: options.agentId?.trim() || 'agent',
            title: options.title?.trim() || '',
            status: options.streaming ? 'streaming' : 'idle',
            createdAt: now,
            updatedAt: now,
            messages: [{
                id: 'working-detail-agent',
                role: 'agent',
                content: '',
                createdAt: now,
                segments: [...fallbackSegments],
            }],
        };
        root.append(this.artifactsUi.createTranscriptAgentSegmentsRow(
            [...fallbackSegments],
            undefined,
            synthetic,
            { streaming: !!options.streaming, message: synthetic.messages[0] },
        ));
        return root;
    }

    /**
     * Agent segments for composer activity. While streaming, only the in-flight agent turn is
     * scanned so SSE refreshes stay O(turn) instead of O(conversation).
     */
    resolveComposerConversationSegments(
        conv: QaapAgentConversationDTO | undefined,
        options?: { readonly allTurns?: boolean },
    ): QaapAgentMessageSegmentDTO[] {
        if (!conv?.messages.length) {
            return [];
        }
        const turnOnly = !options?.allTurns && conv.status === 'streaming';
        if (turnOnly) {
            const last = conv.messages[conv.messages.length - 1];
            if (last?.role !== 'agent') {
                return [];
            }
            return [...resolveAgentMessageSegments(last)];
        }
        return conv.messages.flatMap(message => message.role === 'agent'
            ? [...resolveAgentMessageSegments(message)]
            : []);
    }
}
