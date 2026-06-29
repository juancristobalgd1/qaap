// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * LobeHub-style inline tool-call renderer for the QAAQ transcript.
 *
 * Re-implements the visual language of LobeHub's
 * `Messages/AssistantGroup/Tool/Inspector` (StatusIndicator + ToolTitle +
 * ExecutionTime) and `WorkflowCollapse` (expand/collapse + shiny streaming
 * headline) on top of QAAQ's existing `ToolCallChatResponseContent` model,
 * reusing the upstream confirmation / args / result logic — no parallel
 * state, no new events, no duplicated protocol.
 *
 * Priority 11 wins over the upstream generic `ToolCallPartRenderer` (10) for
 * plain `ToolCallChatResponseContent`, and yields to the QAIQ renderers (13)
 * which handle the `ClaudeCodeToolCallChatResponseContent` subclass.
 */

import { ChatResponsePartRenderer } from '@theia/ai-chat-ui/lib/browser/chat-response-part-renderer';
import {
    createConfirmationHandlers,
    ToolConfirmation,
    useToolConfirmationState
} from '@theia/ai-chat-ui/lib/browser/chat-response-renderer/tool-confirmation';
import { MarkdownRender } from '@theia/ai-chat-ui/lib/browser/chat-response-renderer/markdown-part-renderer';
import {
    condenseArguments,
    formatArgsForTooltip
} from '@theia/ai-chat-ui/lib/browser/chat-response-renderer/toolcall-utils';
import { ChatResponseContent, ToolCallChatResponseContent } from '@theia/ai-chat/lib/common';
import { ToolConfirmationMode } from '@theia/ai-chat/lib/common/chat-tool-preferences';
import { ToolConfirmationManager } from '@theia/ai-chat/lib/browser/chat-tool-preference-bindings';
import { ToolCallResult, ToolInvocationRegistry, ToolRequest } from '@theia/ai-core';
import { ClaudeCodeToolCallChatResponseContent } from '@theia/ai-claude-code/lib/browser/claude-code-tool-call-content';
import { codicon, ContextMenuRenderer, HoverService, OpenerService } from '@theia/core/lib/browser';
import { nls } from '@theia/core/lib/common/nls';
import { inject, injectable } from '@theia/core/shared/inversify';
import * as React from '@theia/core/shared/react';
import { ReactNode } from '@theia/core/shared/react';
import { ResponseNode } from '@theia/ai-chat-ui/lib/browser/chat-tree-view';

@injectable()
export class QaapLobehubToolRenderer implements ChatResponsePartRenderer<ToolCallChatResponseContent> {

    @inject(ToolConfirmationManager)
    protected toolConfirmationManager: ToolConfirmationManager;

    @inject(OpenerService)
    protected openerService: OpenerService;

    @inject(ToolInvocationRegistry)
    protected toolInvocationRegistry: ToolInvocationRegistry;

    @inject(HoverService)
    protected hoverService: HoverService;

    @inject(ContextMenuRenderer)
    protected contextMenuRenderer: ContextMenuRenderer;

    canHandle(response: ChatResponseContent): number {
        // Only claim plain tool calls — let QAIQ renderers keep Claude Code tools.
        if (!ToolCallChatResponseContent.is(response) || ClaudeCodeToolCallChatResponseContent.is(response)) {
            return -1;
        }
        return 11;
    }

    render(response: ToolCallChatResponseContent, parentNode: ResponseNode): ReactNode {
        const chatId = parentNode.sessionId;
        const toolRequest = response.name ? this.toolInvocationRegistry.getFunction(response.name) : undefined;
        const confirmationMode = response.name
            ? this.getToolConfirmationSettings(response.name, chatId, toolRequest)
            : ToolConfirmationMode.DISABLED;
        return <LobehubToolCallContent
            response={response}
            confirmationMode={confirmationMode}
            toolConfirmationManager={this.toolConfirmationManager}
            toolRequest={toolRequest}
            chatId={chatId}
            getArgumentsLabel={this.getArgumentsLabel}
            showArgsTooltip={this.showArgsTooltip}
            responseRenderer={this.renderResult}
            requestCanceled={parentNode.response.isCanceled}
            contextMenuRenderer={this.contextMenuRenderer}
            openerService={this.openerService} />;
    }

    // Arrow-function class properties so the references passed to the React
    // component are stable across renders (no .bind() per call). This makes
    // React.useMemo / useCallback dependencies in the child actually effective
    // during streaming — without this, every token tick would invalidate the
    // memo and recompute the result node.
    protected renderResult = (response: ToolCallChatResponseContent): ReactNode => {
        const result = this.tryParse(response.result);
        if (!result) {
            return undefined;
        }
        // eslint-disable-next-line no-null/no-null
        if (typeof result !== 'object' || result === null) {
            return <pre>{String(result)}</pre>;
        }
        if ('content' in result) {
            return <div className='theia-toolCall-response-content'>
                {result.content.map((content, idx) => {
                    switch (content.type) {
                        case 'image': {
                            return <div key={`content-${idx}-${content.type}`} className='theia-toolCall-image-result'>
                                <img src={`data:${content.mimeType};base64,${content.base64data}`} />
                            </div>;
                        }
                        case 'text': {
                            return <div key={`content-${idx}-${content.type}`} className='theia-toolCall-text-result'>
                                <MarkdownRender text={content.text} openerService={this.openerService} />
                            </div>;
                        }
                        case 'error': {
                            return <div key={`content-${idx}-${content.type}`} className='theia-toolCall-error-result'><pre>{content.data}</pre></div>;
                        }
                        case 'audio':
                        default: {
                            return <div key={`content-${idx}-${content.type}`} className='theia-toolCall-default-result'><pre>{JSON.stringify(response, undefined, 2)}</pre></div>;
                        }
                    }
                })}
            </div>;
        }
        return <pre>{JSON.stringify(result, undefined, 2)}</pre>;
    };

    protected tryParse = (result: ToolCallResult): ToolCallResult => {
        if (!result) {
            return undefined;
        }
        try {
            return typeof result === 'string' ? JSON.parse(result) : result;
        } catch (error) {
            return result;
        }
    };

    protected getToolConfirmationSettings(responseId: string, chatId: string, toolRequest?: ToolRequest): ToolConfirmationMode {
        return this.toolConfirmationManager.getConfirmationMode(responseId, chatId, toolRequest);
    }

    protected getArgumentsLabel = (toolName: string | undefined, args: string | undefined): string => {
        if (!args || !args.trim() || args.trim() === '{}') {
            return '';
        }
        try {
            const toolRequest = toolName ? this.toolInvocationRegistry.getFunction(toolName) : undefined;
            if (toolRequest?.getArgumentsShortLabel) {
                const result = toolRequest.getArgumentsShortLabel(args);
                if (result) {
                    return result.hasMore ? `${result.label} \u2026` : result.label;
                }
            }
        } catch {
            // tool not found in registry, fall through to generic condensed rendering
        }
        return condenseArguments(args) ?? '\u2026';
    };

    protected showArgsTooltip = (response: ToolCallChatResponseContent, target: HTMLElement | undefined): void => {
        if (!target || !response.arguments || !response.arguments.trim() || response.arguments.trim() === '{}') {
            return;
        }
        const markdownString = formatArgsForTooltip(response.arguments);
        this.hoverService.requestHover({
            content: markdownString,
            target,
            position: 'right',
            interactive: true,
            cssClasses: ['toolcall-args-hover']
        });
    };
}

interface LobehubToolCallContentProps {
    response: ToolCallChatResponseContent;
    confirmationMode: ToolConfirmationMode;
    toolConfirmationManager: ToolConfirmationManager;
    toolRequest?: ToolRequest;
    chatId: string;
    getArgumentsLabel: (toolName: string | undefined, args: string | undefined) => string;
    showArgsTooltip: (response: ToolCallChatResponseContent, target: HTMLElement | undefined) => void;
    responseRenderer: (response: ToolCallChatResponseContent) => ReactNode | undefined;
    requestCanceled: boolean;
    contextMenuRenderer: ContextMenuRenderer;
    openerService: OpenerService;
}

/** Tool title params — LobeHub ToolTitle shows up to 1 param, truncated. */
const MAX_PARAMS = 1;
const MAX_VALUE_LENGTH = 50;

const truncateValue = (value: string, maxLength: number): string =>
    value.length <= maxLength ? value : value.slice(0, maxLength) + '...';

const formatParamValue = (value: unknown): string => {
    if (typeof value === 'string') {
        return truncateValue(value, MAX_VALUE_LENGTH);
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
        return String(value);
    }
    if (Array.isArray(value) || (typeof value === 'object' && value !== null)) {
        return truncateValue(JSON.stringify(value), MAX_VALUE_LENGTH);
    }
    return String(value);
};

/**
 * Parse args JSON safely, returning undefined while still streaming (partial
 * JSON) or when empty. The raw string is shown verbatim inside the expandable
 * technical block, so we don't need a tolerant partial parse — we just wait
 * for the complete payload.
 */
const parseArgs = (args: string | undefined): Record<string, unknown> | undefined => {
    if (!args || !args.trim() || args.trim() === '{}') {
        return undefined;
    }
    try {
        return JSON.parse(args);
    } catch {
        // Arguments still streaming — partial JSON. Show raw string in the
        // detail block; params chip is omitted until args are complete.
        return undefined;
    }
};

const LobehubToolCallContent: React.FC<LobehubToolCallContentProps> = ({
    response,
    confirmationMode,
    toolConfirmationManager,
    toolRequest,
    chatId,
    responseRenderer,
    getArgumentsLabel,
    requestCanceled,
    showArgsTooltip,
    contextMenuRenderer,
    openerService
}) => {
    const { confirmationState, rejectionReason } = useToolConfirmationState(response, confirmationMode);
    const summaryRef = React.useRef<HTMLElement | undefined>(undefined);
    // Stable ref callback — without useCallback React would create a new
    // function every render, detaching/reattaching the ref on each token tick
    // during streaming (visible as a flicker on the hover-tooltip target).
    const setSummaryRef = React.useCallback((el: HTMLElement | null) => {
        summaryRef.current = el ?? undefined;
    }, []);
    // Stable hover handler — reads the live ref + current response so the
    // callback identity stays constant across token ticks (no re-attach of
    // the listener, no extra React reconciliation work).
    const onSummaryHover = React.useCallback(() => {
        showArgsTooltip(response, summaryRef.current);
    }, [showArgsTooltip, response]);

    const argsLabel = getArgumentsLabel(response.name, response.arguments);
    const args = parseArgs(response.arguments);
    const isArgumentsStreaming = !!response.arguments && !args && response.arguments.trim() !== '{}' && !response.finished;

    // Compute the result node on every render. The upstream
    // ToolCallChatResponseContentImpl is mutated in place during streaming
    // (merge() / complete() set _arguments / _finished / _result on the same
    // object instance), so the response reference is stable across token ticks
    // — a useMemo keyed on [response] would never recompute and the result
    // would never appear after completion. Calling responseRenderer inline
    // matches the upstream ToolCallPartRenderer; tryParse early-returns while
    // there is no result, so the cost during argument streaming is negligible.
    const resultNode = responseRenderer(response);

    const { handleAllow, handleDeny } = React.useMemo(
        () => createConfirmationHandlers(response.name, response, toolConfirmationManager, chatId, toolRequest),
        [response, toolConfirmationManager, chatId, toolRequest]
    );

    // Running elapsed timer — mirrors LobeHub's ExecutionTime component
    // (src/features/Conversation/Messages/AssistantGroup/Tool/Inspector/ExecutionTime.tsx):
    //   - format: <1000ms -> "Xms"; <60s -> "X.Xs"; >=60s -> "XminYs"
    //   - update interval: 100ms
    //   - shows from the start (no >=1s gate; LobeHub shows "0ms" immediately)
    const isRunning = (confirmationState === 'allowed' || confirmationState === 'pending') && !response.finished && !requestCanceled;
    const [elapsedMs, setElapsedMs] = React.useState(0);
    const startRef = React.useRef<number | undefined>(undefined);
    React.useEffect(() => {
        if (!isRunning) {
            startRef.current = undefined;
            setElapsedMs(0);
            return;
        }
        if (startRef.current === undefined) {
            startRef.current = Date.now();
        }
        const tick = () => {
            const start = startRef.current ?? Date.now();
            setElapsedMs(Math.max(0, Date.now() - start));
        };
        tick();
        const id = setInterval(tick, 100);
        return () => clearInterval(id);
    }, [isRunning]);

    const formatElapsedTime = (ms: number): string => {
        if (ms < 1000) { return `${ms}ms`; }
        const seconds = ms / 1000;
        if (seconds < 60) { return `${seconds.toFixed(1)}s`; }
        const totalSeconds = Math.floor(seconds);
        const minutes = Math.floor(totalSeconds / 60);
        const remainingSeconds = totalSeconds % 60;
        return `${minutes}min${remainingSeconds}s`;
    };
    const elapsedText = isRunning ? formatElapsedTime(elapsedMs) : undefined;

    // Status block state (mirrors LobeHub StatusIndicator).
    const isDenied = confirmationState === 'denied';
    const isRejected = confirmationState === 'rejected';
    const isWaiting = confirmationState === 'waiting';
    const isPending = confirmationState === 'pending';
    const isAllowed = confirmationState === 'allowed';
    const isCanceledMidRun = requestCanceled && !response.finished;
    const hasError = isDenied || isRejected || isCanceledMidRun
        || (response.finished && !!response.result && ToolCallChatResponseContent.isDenialResult(response.result));
    const isFinishedOk = response.finished && !hasError;

    const formatReason = (reason: unknown): string => {
        if (!reason) { return ''; }
        if (reason instanceof Error) { return reason.message; }
        if (typeof reason === 'string') { return reason; }
        try { return JSON.stringify(reason); } catch { return String(reason); }
    };
    // `rejectionReason` is only populated for the 'rejected' state (the
    // response.confirmed promise rejected). For the 'denied' state the
    // user-provided reason lives on response.result.reason when the result
    // is a DenialResult — mirror the upstream toolcall-part-renderer.
    const deniedReason = isDenied && response.finished && response.result
        && ToolCallChatResponseContent.isDenialResult(response.result)
        ? response.result.reason
        : undefined;
    const reasonText = formatReason(rejectionReason ?? deniedReason);

    let statusState: 'success' | 'error' | 'pending' | 'working' = 'working';
    let statusIcon: React.ReactNode = <span className='qaap-lh-dot' />;
    if (isRejected || isDenied || isCanceledMidRun) {
        // LobeHub StatusIndicator: X icon (colorError) for error / rejected / aborted.
        statusState = 'error';
        statusIcon = <span className={codicon('error')} />;
    } else if (isPending) {
        // LobeHub StatusIndicator: HandIcon (colorInfo) for pending intervention.
        statusIcon = <span className={codicon('info')} />;
        statusState = 'pending';
    } else if (isFinishedOk) {
        // LobeHub StatusIndicator: Check icon (colorSuccess) for completed.
        statusState = 'success';
        statusIcon = <span className={codicon('check')} />;
    } else if (isAllowed && !response.finished) {
        // LobeHub StatusIndicator: NeuralNetworkLoading for working state.
        // We use a pulsing dot (CSS .qaap-lh-dot) as a lightweight substitute
        // that avoids embedding an SVG neural network on every tool call.
        statusState = 'working';
        statusIcon = <span className='qaap-lh-dot' />;
    }

    // Terminal (non-expandable) states: denied / rejected / canceled.
    // The three are distinct: rejected = tool confirmation refused, denied =
    // tool disabled by policy, canceled = user stopped the whole agent
    // response while this tool was running or awaiting confirmation. Mirror
    // the upstream toolcall-part-renderer labels exactly.
    const isTerminal = isRejected || isDenied || isCanceledMidRun;
    const terminalLabel = isCanceledMidRun || isRejected
        ? nls.localize('theia/ai/chat-ui/toolcall-part-renderer/rejected', 'Execution canceled')
        : nls.localize('theia/ai/chat-ui/toolcall-part-renderer/denied', 'Execution denied');

    // Expandable when there is a result node or non-empty args to show. The
    // args block below filters out '{}' / whitespace, so the expandable check
    // must match that filter — otherwise a tool with args='{}' and no result
    // would render a detail panel containing only a divider.
    const hasArgs = !!response.arguments && response.arguments.trim() !== '' && response.arguments.trim() !== '{}';
    const hasExpandableContent = !!resultNode || hasArgs;
    const defaultOpen = isRunning || (isPending && !response.finished);

    const params = args ? Object.entries(args).slice(0, MAX_PARAMS) : [];
    const remainingCount = args ? Math.max(0, Object.keys(args).length - MAX_PARAMS) : 0;

    if (isTerminal) {
        return (
            <div className='qaap-lh-tool'>
                <div className='qaap-lh-tool-terminal'>
                    <span className='qaap-lh-statusBlock' data-state={statusState}>{statusIcon}</span>
                    <span className='qaap-lh-toolName'>{terminalLabel}: {response.name}</span>
                    {reasonText ? <span className='qaap-lh-tool-terminal-reason'> — {reasonText}</span> : undefined}
                </div>
            </div>
        );
    }

    const titleRow = (
        <span className='qaap-lh-tool-header'>
            <span className='qaap-lh-statusBlock' data-state={statusState}>{statusIcon}</span>
            <span className='qaap-lh-toolTitle'>
                <span className={`qaap-lh-toolName ${isRunning ? 'qaap-lh-shiny' : ''}`}>{response.name}</span>
                <span className={`qaap-lh-chevron ${codicon('chevron-right')}`} />
                <span className='qaap-lh-apiName'>{argsLabel || (isArgumentsStreaming ? '…' : '')}</span>
                {params.length > 0 && (
                    <span className='qaap-lh-params'>
                        {' ('}
                        {params.map(([key, value], index) => (
                            <React.Fragment key={key}>
                                <span className='qaap-lh-paramKey'>{key}:</span>
                                <span className='qaap-lh-paramValue'>{formatParamValue(value)}</span>
                                {index < params.length - 1 && <span className='qaap-lh-paramKey'>, </span>}
                            </React.Fragment>
                        ))}
                        {remainingCount > 0 && (
                            <span className='qaap-lh-paramKey'>
                                {' '}{nls.localize('qaap/lobehub/arguments/moreParams', '{0} params in total', remainingCount + params.length)}
                            </span>
                        )}
                        {')'}
                    </span>
                )}
            </span>
            {elapsedText && <span className='qaap-lh-execTime'>({elapsedText})</span>}
        </span>
    );

    return (
        <div className='qaap-lh-tool'>
            {hasExpandableContent ? (
                <details className='qaap-lh-tool-accordion' open={defaultOpen}>
                    <summary
                        ref={setSummaryRef}
                        onMouseEnter={onSummaryHover}
                    >
                        {titleRow}
                        <span className='qaap-lh-tool-toggle'><span className={codicon('chevron-down')} /></span>
                    </summary>
                    <div className='qaap-lh-tool-detail'>
                        {hasArgs && (
                            <div className='qaap-lh-tool-args'>{response.arguments}</div>
                        )}
                        <div className='qaap-lh-tool-result'>{resultNode}</div>
                        <hr className='qaap-lh-tool-divider' />
                    </div>
                </details>
            ) : (
                <div className='qaap-lh-tool-accordion'>{titleRow}</div>
            )}

            {isWaiting && !requestCanceled && !response.finished && (
                <ToolConfirmation
                    response={response}
                    toolRequest={toolRequest}
                    onAllow={handleAllow}
                    onDeny={handleDeny}
                    contextMenuRenderer={contextMenuRenderer}
                    openerService={openerService}
                />
            )}
        </div>
    );
};
