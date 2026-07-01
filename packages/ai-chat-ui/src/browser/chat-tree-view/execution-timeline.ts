// *****************************************************************************
// Copyright (C) 2026 EclipseSource GmbH.
//
// This program and the accompanying materials are made available under the
// terms of the Eclipse Public License v. 2.0 which is available at
// http://www.eclipse.org/legal/epl-2.0.
//
// This Source Code may also be made available under the following Secondary
// Licenses when the conditions for such availability set forth in the
// Eclipse Public License v. 2.0 are satisfied: GNU General Public License,
// version 2 with the GNU Classpath Exception which is available at
// https://www.gnu.org/software/classpath/license.html.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { ChatResponseContent, ToolCallChatResponseContent } from '@theia/ai-chat';

export type ExecutionTimelineSegment = NarrativeTimelineSegment | ToolGroupTimelineSegment;

export interface ContentNarrativeTimelineSegment {
    kind: 'narrative';
    id: string;
    content: ChatResponseContent;
    text?: never;
    synthetic?: false;
}

export interface SyntheticNarrativeTimelineSegment {
    kind: 'narrative';
    id: string;
    text: string;
    content?: never;
    synthetic: true;
}

export type NarrativeTimelineSegment = ContentNarrativeTimelineSegment | SyntheticNarrativeTimelineSegment;

export interface ToolGroupTimelineSegment {
    kind: 'toolGroup';
    id: string;
    label: string;
    summary: string;
    icon: string;
    detailLabel: string;
    contents: ToolCallChatResponseContent[];
}

interface ToolGroupDescriptor {
    label: string;
    icon: string;
    detailLabel: string;
    narrative: string;
    summaryLabel: string;
}

export function buildExecutionTimeline(contents: ChatResponseContent[]): ExecutionTimelineSegment[] {
    const segments: ExecutionTimelineSegment[] = [];
    let index = 0;
    while (index < contents.length) {
        const content = contents[index];
        if (!ToolCallChatResponseContent.is(content)) {
            segments.push({
                kind: 'narrative',
                id: `narrative-${index}`,
                content
            });
            index++;
            continue;
        }

        const descriptor = describeToolCall(content);
        const groupStart = index;
        const group: ToolCallChatResponseContent[] = [];
        while (index < contents.length && ToolCallChatResponseContent.is(contents[index])) {
            const toolCall = contents[index] as ToolCallChatResponseContent;
            const nextDescriptor = describeToolCall(toolCall);
            if (nextDescriptor.label !== descriptor.label) {
                break;
            }
            group.push(toolCall);
            index++;
        }

        const previous = segments[segments.length - 1];
        if (!previous || previous.kind !== 'narrative') {
            segments.push({
                kind: 'narrative',
                id: `synthetic-narrative-${groupStart}`,
                text: descriptor.narrative,
                synthetic: true
            });
        }

        segments.push({
            kind: 'toolGroup',
            id: `tool-group-${groupStart}-${descriptor.label}`,
            label: descriptor.label,
            summary: formatToolGroupSummary(group.length, descriptor.summaryLabel),
            icon: descriptor.icon,
            detailLabel: descriptor.detailLabel,
            contents: group
        });
    }
    return segments;
}

export function formatToolDetailLabel(segment: ToolGroupTimelineSegment, index: number): string {
    return `${segment.detailLabel} ${index + 1}`;
}

function describeToolCall(content: ToolCallChatResponseContent): ToolGroupDescriptor {
    const name = content.name?.toLowerCase() ?? '';
    if (isVerificationToolCall(content, name)) {
        return {
            label: 'Verification',
            icon: 'codicon-checklist',
            detailLabel: 'Check',
            summaryLabel: 'check',
            narrative: "I'm validating the implementation."
        };
    }
    if (matchesToolName(name, ['bash', 'shell', 'terminal', 'command', 'exec', 'run', 'npm', 'yarn', 'pnpm', 'node'])) {
        return {
            label: 'Run',
            icon: 'codicon-terminal',
            detailLabel: 'Command',
            summaryLabel: 'command',
            narrative: "I'm validating the implementation."
        };
    }
    if (matchesToolName(name, ['grep', 'glob', 'search', 'find', 'ripgrep', 'rg'])) {
        return {
            label: 'Explore',
            icon: 'codicon-search',
            detailLabel: 'Search',
            summaryLabel: 'search',
            narrative: "I'm looking through the project structure."
        };
    }
    if (matchesToolName(name, ['read', 'open', 'fetch', 'list', 'ls'])) {
        return {
            label: 'Read',
            icon: 'codicon-file',
            detailLabel: 'File',
            summaryLabel: 'file',
            narrative: "I'm checking the relevant files."
        };
    }
    if (matchesToolName(name, ['write', 'create', 'new'])) {
        return {
            label: 'Write',
            icon: 'codicon-new-file',
            detailLabel: 'File',
            summaryLabel: 'file',
            narrative: "I'm writing the implementation."
        };
    }
    if (matchesToolName(name, ['edit', 'update', 'patch', 'replace', 'modify', 'multi'])) {
        return {
            label: 'Update',
            icon: 'codicon-edit',
            detailLabel: 'File',
            summaryLabel: 'file',
            narrative: "I'm updating the implementation."
        };
    }
    if (matchesToolName(name, ['delete', 'remove', 'rm'])) {
        return {
            label: 'Delete',
            icon: 'codicon-trash',
            detailLabel: 'File',
            summaryLabel: 'file',
            narrative: "I'm removing obsolete pieces."
        };
    }
    return {
        label: 'Use',
        icon: 'codicon-tools',
        detailLabel: 'Step',
        summaryLabel: 'step',
        narrative: "I'm applying the next step."
    };
}

function isVerificationToolCall(content: ToolCallChatResponseContent, name: string): boolean {
    if (matchesToolName(name, ['vitest', 'test', 'lint', 'typecheck', 'tsc'])) {
        return true;
    }
    if (!matchesToolName(name, ['bash', 'shell', 'terminal', 'command', 'exec', 'run', 'npm', 'yarn', 'pnpm', 'node'])) {
        return false;
    }
    return containsVerificationCommand(content.arguments);
}

function containsVerificationCommand(args: string | undefined): boolean {
    if (!args) {
        return false;
    }
    return /(^|[\s"'`:,{[])(npm|yarn|pnpm|npx|node)?\s*(run\s+)?(test|vitest|lint|typecheck|tsc)(:|\b)/i.test(args);
}

function matchesToolName(name: string, tokens: string[]): boolean {
    const normalized = name.split(/[^a-z0-9]+|_/).filter(Boolean);
    return tokens.some(token => normalized.includes(token));
}

function formatToolGroupSummary(count: number, label: string): string {
    if (count === 1) {
        return `1 ${label}`;
    }
    return `${count} ${pluralizeSummaryLabel(label)}`;
}

function pluralizeSummaryLabel(label: string): string {
    if (label.endsWith('ch') || label.endsWith('sh')) {
        return `${label}es`;
    }
    return `${label}s`;
}
