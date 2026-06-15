// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { ChatModel, ChatRequestModel, type ChatChangeEvent } from '@theia/ai-chat';
import {
    ChatViewTreeWidget,
    isEnterKey,
    isResponseNode,
    type RequestNode,
    type ResponseNode,
} from '@theia/ai-chat-ui/lib/browser/chat-tree-view/chat-view-tree-widget';
import { formatTokenCount } from '@theia/ai-chat-ui/lib/browser/chat-token-usage-indicator-util';
import { PromptVariantBadge } from '@theia/ai-chat-ui/lib/browser/chat-tree-view/prompt-variant-badge';
import { CompositeTreeNode } from '@theia/core/lib/browser';
import { MarkdownStringImpl } from '@theia/core/lib/common/markdown-rendering';
import { nls } from '@theia/core/lib/common/nls';
import { Disposable } from '@theia/core/lib/common/disposable';
import { injectable } from '@theia/core/shared/inversify';
import * as React from '@theia/core/shared/react';
import { QaapChatUiPerfCollector } from '../common/qaap-chat-ui-perf';
import { QaapChatViewStreamUpdateScheduler } from '../common/qaap-chat-view-stream-update-scheduler';
import {
    needsCoalescedTreePaintWithoutRecreate,
    shouldSkipChatModelTreeRecreate,
} from '../common/qaap-chat-view-tree-incremental';
import { resolveTranscriptStreamingCoalesceDelayMs } from '../common/qaap-transcript-streaming-coalesce';
import { QaapChatAgentProgressLabel } from './qaap-shimmering-text';

/**
 * Chat tree with RAF-coalesced streaming updates, skipped tree recreation on content-only
 * model changes, and opt-in UI perf metrics. Replaces upstream {@link ChatViewTreeWidget}
 * via product-layer rebind.
 */
@injectable()
export class QaapChatViewTreeWidget extends ChatViewTreeWidget {

    protected paintScheduler: QaapChatViewStreamUpdateScheduler | undefined;
    protected paintSchedulerTurnId: string | undefined;
    protected liveResponseTurnId: string | undefined;

    public override trackChatModel(chatModel: ChatModel): void {
        this.toDisposeOnChatModelChange.dispose();
        this.recreateModelTree(chatModel);

        chatModel.getRequests().forEach(request => {
            this.trackLiveResponse(request);
        });
        this.toDisposeOnChatModelChange.pushAll([
            Disposable.create(() => {
                this.chatInputs.forEach(widget => widget.dispose());
                this.chatInputs.clear();
                this.disposePaintScheduler();
            }),
            chatModel.onDidChange(event => {
                if (event.kind === 'enableEdit') {
                    this.scrollToRow = this.rows.get(event.request.id)?.index;
                    this.update();
                    return;
                } else if (event.kind === 'cancelEdit') {
                    this.disposeChatInputWidget(event.request);
                    this.scrollToRow = undefined;
                    this.update();
                    return;
                } else if (event.kind === 'changeHierarchyBranch') {
                    this.scrollToRow = undefined;
                }

                const skipRecreate = this.shouldSkipChatModelTreeRecreate(chatModel, event);
                if (!skipRecreate) {
                    this.recreateModelTree(chatModel);
                } else if (needsCoalescedTreePaintWithoutRecreate(event)) {
                    this.scheduleCoalescedTreePaint();
                }

                if (event.kind === 'addRequest' && !event.request.response.isComplete) {
                    this.trackLiveResponse(event.request);
                } else if (event.kind === 'submitEdit') {
                    event.branch.succeedingBranches().forEach(branch => {
                        this.disposeChatInputWidget(branch.get());
                    });
                    this.onDidSubmitEditEmitter.fire(
                        event.newRequest,
                    );
                }
            }),
        ]);
    }

    protected trackLiveResponse(request: ChatRequestModel): void {
        if (request.response.isComplete) {
            return;
        }
        this.disposeLiveResponseTracking();

        const turnId = request.id;
        this.liveResponseTurnId = turnId;
        this.paintSchedulerTurnId = turnId;
        QaapChatUiPerfCollector.get().beginTurn(turnId, this.chatModelId, 'chat-view');

        const disposable = request.response.onDidChange(() => {
            QaapChatUiPerfCollector.get().recordContentChange(turnId);
            this.scheduleCoalescedTreePaint(turnId);
            if (request.response.isComplete) {
                this.paintScheduler?.flushNow();
                QaapChatUiPerfCollector.get().finishTurn(turnId);
                this.disposeLiveResponseTracking();
                disposable.dispose();
            }
        });
        this.toDisposeOnChatModelChange.pushAll([
            Disposable.create(() => {
                this.paintScheduler?.flushNow();
                if (this.liveResponseTurnId === turnId) {
                    QaapChatUiPerfCollector.get().finishTurn(turnId);
                    this.disposeLiveResponseTracking();
                }
            }),
            disposable,
        ]);
    }

    protected shouldSkipChatModelTreeRecreate(chatModel: ChatModel, event: ChatChangeEvent): boolean {
        const childIds = CompositeTreeNode.is(this.model.root)
            ? this.model.root.children?.map(node => node.id)
            : undefined;
        const branches = chatModel.getBranches();
        const requestIds = branches.map(branch => branch.get().id);
        const responseIds = branches.map(branch => branch.get().response.id);
        return shouldSkipChatModelTreeRecreate(event, childIds, requestIds, responseIds);
    }

    protected scheduleCoalescedTreePaint(turnId?: string): void {
        if (turnId) {
            this.paintSchedulerTurnId = turnId;
        }
        if (!this.paintScheduler) {
            this.paintScheduler = new QaapChatViewStreamUpdateScheduler(
                () => this.flushCoalescedTreePaint(),
                () => resolveTranscriptStreamingCoalesceDelayMs(this.isLiveResponseNearBottom()),
            );
        }
        this.paintScheduler.schedule();
    }

    protected flushCoalescedTreePaint(): void {
        const turnId = this.paintSchedulerTurnId;
        if (turnId) {
            QaapChatUiPerfCollector.get().recordPaint(turnId);
        }
        this.scheduleUpdateScrollToRow();
        this.update();
    }

    protected isLiveResponseNearBottom(): boolean {
        return this.shouldScrollToEnd && this.atBottom;
    }

    protected disposeLiveResponseTracking(): void {
        this.liveResponseTurnId = undefined;
        this.paintSchedulerTurnId = undefined;
    }

    protected disposePaintScheduler(): void {
        this.paintScheduler?.dispose();
        this.paintScheduler = undefined;
        this.disposeLiveResponseTracking();
    }

    protected override renderAgent(node: RequestNode | ResponseNode): React.ReactNode {
        const inProgress = isResponseNode(node) && !node.response.isComplete && !node.response.isCanceled && !node.response.isError;
        const waitingForInput = isResponseNode(node) && node.response.isWaitingForInput;
        const toolbarContributions = !inProgress
            ? this.chatNodeToolbarActionContributions.getContributions()
                .flatMap(c => c.getToolbarActions(node))
                .filter(action => this.commandRegistry.isEnabled(action.commandId, node))
                .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0))
            : [];
        const agentLabel = React.createRef<HTMLHeadingElement>();
        const agentDescription = this.getAgent(node)?.description;

        const promptVariantId = isResponseNode(node) ? node.response.promptVariantId : undefined;
        const isPromptVariantEdited = isResponseNode(node) ? !!node.response.isPromptVariantEdited : false;

        return <React.Fragment>
            <div className='theia-ChatNodeHeader'>
                <div className={`theia-AgentAvatar ${this.getAgentIconClassName(node)}`}></div>
                <h3 ref={agentLabel}
                    className='theia-AgentLabel'
                    onMouseEnter={() => {
                        const tokenUsage = isResponseNode(node) ? node.response.tokenUsage : undefined;
                        const hasTokenInfo = tokenUsage && (tokenUsage.inputTokens > 0 || tokenUsage.outputTokens > 0);
                        const tokenInfo = hasTokenInfo
                            ? `${nls.localize('theia/ai/chat-ui/tokenUsageLabel', 'Token Usage')}: ${nls.localizeByDefault(
                                'Input: {0}', formatTokenCount(tokenUsage.inputTokens))} | ${nls.localizeByDefault(
                                'Output: {0}', formatTokenCount(tokenUsage.outputTokens))}`
                            : undefined;
                        if (agentDescription || tokenInfo) {
                            const md = new MarkdownStringImpl();
                            if (agentDescription) {
                                md.appendMarkdown(agentDescription);
                            }
                            if (agentDescription && tokenInfo) {
                                md.appendMarkdown('\n\n---\n\n');
                            }
                            if (tokenInfo) {
                                md.appendMarkdown(tokenInfo);
                            }
                            this.hoverService.requestHover({
                                content: md,
                                target: agentLabel.current!,
                                position: 'right'
                            });
                        }
                    }}>
                    {this.getAgentLabel(node)}
                </h3>
                {promptVariantId && (
                    <PromptVariantBadge
                        variantId={promptVariantId}
                        isEdited={isPromptVariantEdited}
                        hoverService={this.hoverService}
                    />
                )}
                {inProgress &&
                    <QaapChatAgentProgressLabel
                        waitingForInput={!!waitingForInput}
                        waitingLabel={nls.localize('theia/ai/chat-ui/chat-view-tree-widget/waitingForInput', 'Waiting for input')}
                    />}
                <div className='theia-ChatNodeToolbar'>
                    {!inProgress &&
                        toolbarContributions.length > 0 &&
                        toolbarContributions.map(action =>
                            <span
                                key={action.commandId}
                                className={`theia-ChatNodeToolbarAction ${action.icon}`}
                                title={action.tooltip}
                                aria-label={action.tooltip}
                                tabIndex={0}
                                onClick={e => {
                                    e.stopPropagation();
                                    this.commandRegistry.executeCommand(action.commandId, node);
                                }}
                                onKeyDown={e => {
                                    if (isEnterKey(e)) {
                                        e.stopPropagation();
                                        this.commandRegistry.executeCommand(action.commandId, node);
                                    }
                                }}
                                role='button'
                            ></span>
                        )}
                </div>
            </div>
        </React.Fragment>;
    }
}
