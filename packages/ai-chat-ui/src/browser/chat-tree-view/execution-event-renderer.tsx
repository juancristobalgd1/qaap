// *****************************************************************************
// Copyright (C) 2026 EclipseSource GmbH.
//
// This program and the accompanying materials are made available under the
// terms of the Eclipse Public License v. 2.0 which is available at
// http://www.eclipse.org/legal/epl-2.0.
//
// This Source Code may also be made available under the following Secondary
// Licenses when the conditions for such availability set forth in the Eclipse
// Public License v. 2.0 are satisfied: GNU General Public License, version 2
// with the GNU Classpath Exception which is available at
// https://www.gnu.org/software/classpath/license.html.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { ChatResponseContent, ToolCallChatResponseContent } from '@theia/ai-chat';
import * as React from '@theia/core/shared/react';
import { ExecutionEvent, ExecutionEventKind, ExecutionTool, formatEventSummary, formatToolLabel, getFileIconClass } from './execution-event-model';

// ─── AgentExecution ──────────────────────────────────────────────────────────
// Top-level container for the entire agent response.
//
// The process (events, tools, thinking) lives inside a single collapsible
// ProcessAccordion — the Codex-style "Processed in Xm Ys" header.
// Outside the accordion: the agent's final answer (closing narrative) and
// the diff summary. This matches the Codex mental model:
//   1. While working → accordion expanded, steps stream inside.
//   2. On completion → accordion collapses, only the answer + diff remain.
//   3. On error → accordion stays expanded so the user can inspect the failure.
//   4. User manual toggle is always respected until a new turn starts.

export interface AgentExecutionProps {
    events: ExecutionEvent[];
    renderToolContent: (content: ToolCallChatResponseContent) => React.ReactNode;
    /**
     * Optional renderer for narrative content. When provided and an event has
     * narrativeContents, this is called for each content object instead of
     * rendering plain text. This preserves markdown and other rich formatting
     * in agent narrative.
     */
    renderNarrativeContent?: (content: ChatResponseContent) => React.ReactNode;
    closingNarrative?: React.ReactNode;
    diffSummary?: React.ReactNode;
    /** Whether the agent is currently working (streaming/incomplete). */
    isWorking?: boolean;
    /** Whether the agent ended in an error state. */
    isError?: boolean;
    /** Elapsed execution time in milliseconds. */
    elapsedMs?: number;
}

export const AgentExecution: React.FC<AgentExecutionProps> = ({
    events, renderToolContent, renderNarrativeContent, closingNarrative, diffSummary,
    isWorking = false, isError = false, elapsedMs,
}) => {
    const hasEvents = events.length > 0;
    return (
        <div className='theia-AgentExecution'>
            {hasEvents && (
                <ProcessAccordion isWorking={isWorking} isError={isError} elapsedMs={elapsedMs}>
                    {events.map(event =>
                        <ExecutionEventView
                            key={event.id}
                            event={event}
                            renderToolContent={renderToolContent}
                            renderNarrativeContent={renderNarrativeContent}
                        />
                    )}
                </ProcessAccordion>
            )}
            {closingNarrative && <div className='theia-AgentExecution-ClosingNarrative'>{closingNarrative}</div>}
            {diffSummary && <div className='theia-AgentExecution-DiffSummary'>{diffSummary}</div>}
        </div>
    );
};

// ─── ProcessAccordion ─────────────────────────────────────────────────────────
// The single collapsible container for all agent process steps.
// Auto-expands while working, auto-collapses on success, stays open on error.
// User manual toggle is respected until the agent status changes.

export interface ProcessAccordionProps {
    isWorking: boolean;
    isError: boolean;
    elapsedMs?: number;
    children: React.ReactNode;
}

export const ProcessAccordion: React.FC<ProcessAccordionProps> = ({ isWorking, isError, elapsedMs, children }) => {
    const detailsRef = React.useRef<HTMLDetailsElement | undefined>(undefined);
    // Track whether the user has manually toggled the accordion.
    // When true, auto-expand/collapse logic is suppressed until a new
    // execution starts. A new turn creates a new component instance (keyed
    // by response node id), so the ref is naturally fresh — no reset needed.
    const userToggledRef = React.useRef(false);
    // Track open state in React so we can do lazy rendering (skip children
    // when collapsed) without relying on native details DOM queries.
    const [isOpen, setIsOpen] = React.useState(isWorking || isError);

    // Auto-expand/collapse based on agent status, unless the user toggled.
    // Runs only when the agent status (isWorking/isError) changes — not on
    // every render. The userToggledRef is checked at effect-run time.
    React.useEffect(() => {
        if (userToggledRef.current) {
            return;
        }
        // Working or error → expanded. Completed successfully → collapsed.
        const shouldOpen = isWorking || isError;
        setIsOpen(prev => prev === shouldOpen ? prev : shouldOpen);
    }, [isWorking, isError]);

    // Sync the native <details> open attribute with React state.
    React.useEffect(() => {
        const details = detailsRef.current;
        if (details && details.open !== isOpen) {
            details.open = isOpen;
        }
    }, [isOpen]);

    const handleSummaryClick = React.useCallback(() => {
        // The native <details> toggles on summary click. We read the new state
        // from the DOM after the browser processes the click, then sync React.
        // Mark user intent so auto-expand/collapse is suppressed.
        userToggledRef.current = true;
        const details = detailsRef.current;
        if (details) {
            // The browser toggles open on summary click; read it in the next tick.
            requestAnimationFrame(() => setIsOpen(details.open));
        }
        // Don't preventDefault — let <details> do its native toggle.
    }, []);

    const label = formatProcessLabel(elapsedMs, isWorking);

    return (
        <details
            className={`theia-ProcessAccordion ${isWorking ? 'theia-mod-working' : ''} ${isError ? 'theia-mod-error' : ''} ${!isWorking && !isError ? 'theia-mod-complete' : ''}`}
            ref={detailsRef as React.RefObject<HTMLDetailsElement>}
            open={isOpen}
        >
            <summary className='theia-ProcessAccordion-Header' onClick={handleSummaryClick}>
                <span className='theia-ProcessAccordion-Label'>{label}</span>
                <span className='codicon codicon-chevron-down theia-ProcessAccordion-Chevron'></span>
            </summary>
            {isOpen && (
                <div className='theia-ProcessAccordion-Content'>
                    {children}
                </div>
            )}
        </details>
    );
};

function formatProcessLabel(elapsedMs: number | undefined, isWorking: boolean): string {
    if (elapsedMs === undefined) {
        return isWorking ? 'Processing…' : 'Processed';
    }
    const formatted = formatElapsed(elapsedMs);
    return isWorking ? `Processing… ${formatted}` : `Processed in ${formatted}`;
}

function formatElapsed(ms: number): string {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    if (totalSeconds < 60) {
        return `${totalSeconds}s`;
    }
    const totalMinutes = Math.floor(totalSeconds / 60);
    if (totalMinutes < 60) {
        return `${totalMinutes}m ${totalSeconds % 60}s`;
    }
    return `${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m`;
}

// ─── ExecutionEventView ──────────────────────────────────────────────────────
// One event: narrative text followed by a collapsed tool group.
// This is the atomic unit of the timeline. The narrative is the headline;
// the tools are details hidden underneath.

export interface ExecutionEventViewProps {
    event: ExecutionEvent;
    renderToolContent: (content: ToolCallChatResponseContent) => React.ReactNode;
    /**
     * Optional renderer for narrative content. When provided and the event has
     * narrativeContents, this is called for each content object instead of
     * rendering plain text.
     */
    renderNarrativeContent?: (content: ChatResponseContent) => React.ReactNode;
}

export const ExecutionEventView: React.FC<ExecutionEventViewProps> = ({ event, renderToolContent, renderNarrativeContent }) => (
    <div className={`theia-ExecutionEvent theia-mod-${event.kind} ${event.hasError ? 'theia-mod-error' : ''} ${event.hasPending ? 'theia-mod-running' : 'theia-mod-complete'}`}>
        <Narrative
            text={event.narrative}
            source={event.narrativeSource}
            contents={event.narrativeContents}
            renderContent={renderNarrativeContent}
        />
        <ToolGroup event={event} renderToolContent={renderToolContent} />
    </div>
);

// ─── Narrative ───────────────────────────────────────────────────────────────
// The story text that precedes each tool group.
// When source is 'agent', it's the real text the agent emitted — may consist
// of multiple content segments, each rendered with renderContent to preserve
// markdown and other rich formatting.
// When source is 'synthetic', it's a generated label — styled more subtly.

export interface NarrativeProps {
    text: string;
    source: 'agent' | 'synthetic';
    contents?: ChatResponseContent[];
    renderContent?: (content: ChatResponseContent) => React.ReactNode;
}

export const Narrative: React.FC<NarrativeProps> = ({ text, source, contents, renderContent }) => {
    const className = `theia-ExecutionEvent-Narrative ${source === 'synthetic' ? 'theia-mod-synthetic' : 'theia-mod-agent'}`;
    // When rich content objects are available and a renderer is provided,
    // render each segment with the renderer to preserve markdown formatting.
    if (contents && contents.length > 0 && renderContent) {
        return (
            <div className={className}>
                {contents.map((content, index) =>
                    <React.Fragment key={index}>{renderContent(content)}</React.Fragment>
                )}
            </div>
        );
    }
    return <p className={className}>{text}</p>;
};

// ─── ToolGroup ───────────────────────────────────────────────────────────────
// Collapsed by default. Shows only a one-line summary.
// Expands to reveal individual tool details.
// This replaces the old ToolCard/ToolRow/ToolContainer pattern.

export interface ToolGroupProps {
    event: ExecutionEvent;
    renderToolContent: (content: ToolCallChatResponseContent) => React.ReactNode;
}

export const ToolGroup: React.FC<ToolGroupProps> = ({ event, renderToolContent }) => (
    <details className={`theia-ToolGroup ${event.hasError ? 'failed' : ''} ${event.hasPending ? 'running' : 'finished'}`}>
        <summary className='theia-ToolGroup-Summary'>
            <span className={`codicon ${event.icon} theia-ToolGroup-Icon`}></span>
            <span className='theia-ToolGroup-Verb'>{event.verb}</span>
            <span className='theia-ToolGroup-Meta'>{formatEventSummary(event)}</span>
            <span className={`theia-ToolGroup-State ${event.hasError ? 'failed' : event.hasPending ? 'running' : 'complete'}`}>
                <span className={`codicon ${event.hasError ? 'codicon-error' : event.hasPending ? 'codicon-loading theia-animation-spin' : 'codicon-check'}`}></span>
            </span>
            <span className='codicon codicon-chevron-down theia-ToolGroup-Chevron'></span>
        </summary>
        <div className='theia-ToolGroup-Details'>
            {event.tools.map((tool, index) =>
                <ToolDetails
                    key={tool.id}
                    tool={tool}
                    event={event}
                    index={index}
                    renderToolContent={renderToolContent}
                />
            )}
        </div>
    </details>
);

// ─── ToolDetails ─────────────────────────────────────────────────────────────
// A single tool inside an expanded ToolGroup.
// For terminal/verification tools: renders a TerminalOutput card.
// For other tools: renders a minimal text line, NOT a card.
// Only Terminal, Error, Diff, Preview, Code get cards — everything else is text.

export interface ToolDetailsProps {
    tool: ExecutionTool;
    event: ExecutionEvent;
    index: number;
    renderToolContent: (content: ToolCallChatResponseContent) => React.ReactNode;
}

export const ToolDetails: React.FC<ToolDetailsProps> = ({ tool, event, index, renderToolContent }) => {
    if (tool.isTerminal) {
        return <TerminalOutput tool={tool} event={event} index={index} renderToolContent={renderToolContent} />;
    }
    const fileIcon = isFileDetailKind(event.kind) && tool.detail
        ? <span className={`codicon ${getFileIconClass(tool.detail)} theia-ToolDetails-FileIcon`} aria-hidden={true}></span>
        : undefined;
    if (tool.isError) {
        return (
            <div className='theia-ToolDetails theia-mod-error'>
                <span className='theia-ToolDetails-Label'>{formatToolLabel(event, index)}</span>
                {fileIcon}
                <span className='theia-ToolDetails-Detail'>{tool.detail}</span>
                <span className='codicon codicon-error theia-ToolDetails-ErrorIcon'></span>
            </div>
        );
    }
    // Non-terminal, non-error: minimal text line, no card
    return (
        <div className='theia-ToolDetails theia-mod-text'>
            <span className='theia-ToolDetails-Label'>{formatToolLabel(event, index)}</span>
            {fileIcon}
            <span className='theia-ToolDetails-Detail'>{tool.detail}</span>
        </div>
    );
};

/**
 * Returns true when the event kind operates on files, so the tool detail is a
 * filename that should be shown with a file-type icon.
 */
function isFileDetailKind(kind: ExecutionEventKind): boolean {
    return kind === 'read' || kind === 'write' || kind === 'edit' || kind === 'delete';
}

// ─── TerminalOutput ──────────────────────────────────────────────────────────
// Collapsed terminal output. Only this and Error/Diff get full cards.
// Shows "Command 1 ▶" by default, expands to show the actual output.

export interface TerminalOutputProps {
    tool: ExecutionTool;
    event: ExecutionEvent;
    index: number;
    renderToolContent: (content: ToolCallChatResponseContent) => React.ReactNode;
}

export const TerminalOutput: React.FC<TerminalOutputProps> = ({ tool, event, index, renderToolContent }) => {
    const stateIcon = tool.isError ? 'codicon-error' : tool.finished ? 'codicon-check' : 'codicon-loading theia-animation-spin';
    return (
    <details className={`theia-TerminalOutput ${tool.isError ? 'failed' : tool.finished ? 'complete' : 'running'}`}>
        <summary className='theia-TerminalOutput-Summary'>
            <span className='theia-TerminalOutput-Label'>{formatToolLabel(event, index)}</span>
            <span className='theia-TerminalOutput-Detail'>{tool.detail}</span>
            <span className={`codicon ${stateIcon} theia-TerminalOutput-State`}></span>
        </summary>
        <div className='theia-TerminalOutput-Content'>
            {renderToolContent(tool.content)}
        </div>
    </details>
    );
};

// ─── DiffSummary ─────────────────────────────────────────────────────────────
// The natural closing of the execution story.
// Not a separate card — it's the final element of the AgentExecution flow.

export interface DiffSummaryProps {
    fileCount: number;
    added: number;
    modified: number;
    deleted: number;
    files: { name: string; type?: string }[];
}

export const DiffSummary: React.FC<DiffSummaryProps> = ({ fileCount, added, modified, deleted, files }) => (
    <div className='theia-DiffSummary'>
        <div className='theia-DiffSummary-Header'>
            <span className='codicon codicon-diff theia-DiffSummary-Icon'></span>
            <span className='theia-DiffSummary-Title'>
                {fileCount === 1 ? '1 file changed' : `${fileCount} files changed`}
            </span>
            {added > 0 && <span className='theia-DiffSummary-Stat theia-mod-added'>+{added}</span>}
            {modified > 0 && <span className='theia-DiffSummary-Stat theia-mod-modified'>{modified} modified</span>}
            {deleted > 0 && <span className='theia-DiffSummary-Stat theia-mod-deleted'>-{deleted}</span>}
        </div>
        <div className='theia-DiffSummary-Files'>
            {files.slice(0, 6).map((file, i) =>
                <div className='theia-DiffSummary-File' key={`${file.name}-${i}`}>
                    <span className={`codicon ${getFileIconClass(file.name)} theia-DiffSummary-FileIcon`}></span>
                    <span className='theia-DiffSummary-FileName'>{file.name}</span>
                    {file.type && <span className={`theia-DiffSummary-FileType theia-mod-${file.type}`}>{formatChangeType(file.type)}</span>}
                </div>
            )}
            {files.length > 6 && <div className='theia-DiffSummary-More'>+{files.length - 6} more</div>}
        </div>
    </div>
);

function formatChangeType(type: string): string {
    if (type === 'add') { return 'added'; }
    if (type === 'delete') { return 'deleted'; }
    return 'modified';
}
