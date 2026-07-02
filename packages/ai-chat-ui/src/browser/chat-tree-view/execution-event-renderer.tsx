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
import { ExecutionEvent, ExecutionTool, formatEventSummary, formatToolLabel } from './execution-event-model';

// ─── AgentExecution ──────────────────────────────────────────────────────────
// Top-level container for the entire agent response.
// Renders events as a vertical sequence with generous spacing between them.

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
}

export const AgentExecution: React.FC<AgentExecutionProps> = ({
    events, renderToolContent, renderNarrativeContent, closingNarrative, diffSummary,
}) => (
    <div className='theia-AgentExecution'>
        {events.map(event =>
            <ExecutionEventView
                key={event.id}
                event={event}
                renderToolContent={renderToolContent}
                renderNarrativeContent={renderNarrativeContent}
            />
        )}
        {closingNarrative && <div className='theia-AgentExecution-ClosingNarrative'>{closingNarrative}</div>}
        {diffSummary && <div className='theia-AgentExecution-DiffSummary'>{diffSummary}</div>}
    </div>
);

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
    if (tool.isError) {
        return (
            <div className='theia-ToolDetails theia-mod-error'>
                <span className='theia-ToolDetails-Label'>{formatToolLabel(event, index)}</span>
                <span className='theia-ToolDetails-Detail'>{tool.detail}</span>
                <span className='codicon codicon-error theia-ToolDetails-ErrorIcon'></span>
            </div>
        );
    }
    // Non-terminal, non-error: minimal text line, no card
    return (
        <div className='theia-ToolDetails theia-mod-text'>
            <span className='theia-ToolDetails-Label'>{formatToolLabel(event, index)}</span>
            <span className='theia-ToolDetails-Detail'>{tool.detail}</span>
        </div>
    );
};

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
