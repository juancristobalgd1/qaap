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

// ─── Execution Event Tree Model ──────────────────────────────────────────────
//
// The mental model is OpenAI Codex's Execution Timeline:
//
//   AgentExecution
//     ExecutionEvent  (narrative + tool group)
//       Narrative     "I'm inspecting the project structure."
//       ToolGroup     (collapsed by default)
//         ToolSummary "3 searches ▶"
//         ToolDetails (hidden until expanded)
//     ExecutionEvent
//       Narrative     "I found the rendering pipeline."
//       ToolGroup     ...
//     ...
//     DiffSummary     (the natural closing of the story)
//
// Tools are CHILDREN of events, never siblings.
// The narrative is the primary element; tools are secondary.
// ─────────────────────────────────────────────────────────────────────────────

export type ExecutionEventKind = 'explore' | 'read' | 'write' | 'edit' | 'delete' | 'run' | 'verification' | 'other';

export interface ExecutionEvent {
    id: string;
    narrative: string;
    narrativeSource: 'agent' | 'synthetic';
    /**
     * The original ChatResponseContent objects for the narrative, when the
     * narrative came from agent output. Renderers can use these to render
     * rich content (markdown, images, etc.) instead of plain text. Undefined
     * for synthetic narratives. May contain multiple entries when the agent
     * emitted several text segments before the tool group.
     */
    narrativeContents?: ChatResponseContent[];
    kind: ExecutionEventKind;
    icon: string;
    verb: string;
    tools: ExecutionTool[];
    hasPending: boolean;
    hasError: boolean;
}

export interface ExecutionTool {
    id: string;
    content: ToolCallChatResponseContent;
    name: string;
    label: string;
    detail: string;
    finished: boolean;
    isError: boolean;
    isTerminal: boolean;
    isVerification: boolean;
}

export interface ExecutionEventTimeline {
    events: ExecutionEvent[];
    /** Agent text that appears after all tools — the closing narrative. */
    closingNarrative?: string;
    /**
     * The original ChatResponseContent objects for the closing narrative.
     * May contain multiple entries when the agent emitted several text
     * segments after the last tool group.
     */
    closingNarrativeContents?: ChatResponseContent[];
}

// ─── Builder ─────────────────────────────────────────────────────────────────

export function buildExecutionEventTimeline(contents: ChatResponseContent[]): ExecutionEventTimeline {
    const events: ExecutionEvent[] = [];
    // Accumulate consecutive non-tool content segments so that none are
    // silently dropped. Each entry becomes part of the narrative for the
    // next event (or the closing narrative if no more tools follow).
    let pendingNarrative: { text: string; content: ChatResponseContent }[] = [];
    let closingNarrative: { text: string; content: ChatResponseContent }[] = [];
    let eventIndex = 0;
    let toolIndex = 0;

    for (let i = 0; i < contents.length; i++) {
        const content = contents[i];

        if (!ToolCallChatResponseContent.is(content)) {
            const text = extractText(content);
            const trimmed = text?.trim();
            if (!trimmed) {
                // Content with no textual representation (e.g.
                // ErrorChatResponseContent, whose asString() returns undefined,
                // or InformationalChatResponseContent, whose renderer returns
                // null) must still be preserved so it can be rendered by the
                // appropriate part renderer via narrativeContents. Skipping it
                // here would silently drop error messages shown to the user.
                // Use a placeholder text so the entry is non-empty; the
                // narrativeContents array drives rich rendering.
                pendingNarrative.push({ text: '', content });
                continue;
            }
            pendingNarrative.push({ text: trimmed, content });
            continue;
        }

        // We have a tool call. If there's a pending narrative, it becomes
        // the narrative for a new event. Otherwise, generate synthetic.
        const descriptor = describeTool(content);
        const lastEvent = events[events.length - 1];

        // Try to merge into the last event if:
        // 1. No new narrative was emitted since
        // 2. Same event kind
        if (lastEvent && pendingNarrative.length === 0 && lastEvent.kind === descriptor.kind) {
            lastEvent.tools.push(toExecutionTool(content, descriptor, toolIndex++));
            updateEventState(lastEvent);
            continue;
        }

        // Start a new event
        let narrative: string;
        let narrativeSource: 'agent' | 'synthetic';
        let narrativeContents: ChatResponseContent[] | undefined;
        if (pendingNarrative.length > 0) {
            // Join non-empty texts for the plain-text fallback. Entries with
            // empty text (e.g. ErrorChatResponseContent) are still included in
            // narrativeContents so they get rich-rendered by the part renderer.
            const nonEmptyTexts = pendingNarrative.map(n => n.text).filter(t => t.length > 0);
            narrative = nonEmptyTexts.length > 0
                ? nonEmptyTexts.join('\n\n')
                : descriptor.narrative;
            narrativeSource = 'agent';
            narrativeContents = pendingNarrative.map(n => n.content);
            pendingNarrative = [];
        } else {
            narrative = descriptor.narrative;
            narrativeSource = 'synthetic';
        }

        const event: ExecutionEvent = {
            id: `event-${eventIndex++}`,
            narrative,
            narrativeSource,
            narrativeContents,
            kind: descriptor.kind,
            icon: descriptor.icon,
            verb: descriptor.verb,
            tools: [toExecutionTool(content, descriptor, toolIndex++)],
            hasPending: !content.finished,
            hasError: ToolCallChatResponseContent.isErrorResult(content.result),
        };
        events.push(event);
    }

    // Any remaining pending narrative after all tools is the closing narrative
    if (pendingNarrative.length > 0) {
        closingNarrative = pendingNarrative;
    }

    // For the plain-text closing narrative, join only non-empty texts. When all
    // entries have empty text (e.g. only ErrorChatResponseContent), the text
    // is undefined so the renderer falls back to closingNarrativeContents.
    const closingNonEmptyTexts = closingNarrative.map(n => n.text).filter(t => t.length > 0);
    return {
        events,
        closingNarrative: closingNonEmptyTexts.length > 0 ? closingNonEmptyTexts.join('\n\n') : undefined,
        closingNarrativeContents: closingNarrative.length > 0 ? closingNarrative.map(n => n.content) : undefined,
    };
}

function toExecutionTool(
    content: ToolCallChatResponseContent,
    descriptor: ToolDescriptor,
    index: number,
): ExecutionTool {
    return {
        id: content.id ?? `tool-${index}`,
        content,
        name: content.name ?? 'unknown',
        label: descriptor.verb,
        detail: extractToolDetail(content, descriptor.kind),
        finished: content.finished,
        isError: ToolCallChatResponseContent.isErrorResult(content.result),
        isTerminal: descriptor.kind === 'run' || descriptor.kind === 'verification',
        isVerification: descriptor.kind === 'verification',
    };
}

function updateEventState(event: ExecutionEvent): void {
    event.hasPending = event.tools.some(t => !t.finished);
    event.hasError = event.tools.some(t => t.isError);
}

// ─── Tool classification ─────────────────────────────────────────────────────

interface ToolDescriptor {
    kind: ExecutionEventKind;
    icon: string;
    verb: string;
    narrative: string;
}

function describeTool(content: ToolCallChatResponseContent): ToolDescriptor {
    const name = content.name?.toLowerCase() ?? '';

    if (isVerificationToolCall(content, name)) {
        return { kind: 'verification', icon: 'codicon-checklist', verb: 'Verification', narrative: "I'm validating the implementation." };
    }
    if (matchesToolName(name, ['bash', 'shell', 'terminal', 'command', 'exec', 'run', 'npm', 'yarn', 'pnpm', 'node'])) {
        return { kind: 'run', icon: 'codicon-terminal', verb: 'Run', narrative: "I'm running commands." };
    }
    if (matchesToolName(name, ['grep', 'glob', 'search', 'find', 'ripgrep', 'rg'])) {
        return { kind: 'explore', icon: 'codicon-search', verb: 'Explore', narrative: "I'm looking through the project structure." };
    }
    if (matchesToolName(name, ['read', 'open', 'fetch', 'list', 'ls'])) {
        return { kind: 'read', icon: 'codicon-file', verb: 'Read', narrative: "I'm checking the relevant files." };
    }
    if (matchesToolName(name, ['write', 'create', 'new'])) {
        return { kind: 'write', icon: 'codicon-new-file', verb: 'Write', narrative: "I'm writing the implementation." };
    }
    if (matchesToolName(name, ['edit', 'update', 'patch', 'replace', 'modify', 'multi'])) {
        return { kind: 'edit', icon: 'codicon-edit', verb: 'Update', narrative: "I'm updating the implementation." };
    }
    if (matchesToolName(name, ['delete', 'remove', 'rm'])) {
        return { kind: 'delete', icon: 'codicon-trash', verb: 'Delete', narrative: "I'm removing obsolete pieces." };
    }
    return { kind: 'other', icon: 'codicon-tools', verb: 'Use', narrative: "I'm applying the next step." };
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

function extractText(content: ChatResponseContent): string | undefined {
    // ChatResponseContent exposes text via asString() (the canonical interface
    // method). TextChatResponseContent stores its payload in `.content`, not
    // `.text`, so probing for `.text` silently discards all agent narrative.
    if (typeof content.asString === 'function') {
        return content.asString();
    }
    return undefined;
}

function extractToolDetail(content: ToolCallChatResponseContent, kind: ExecutionEventKind): string {
    if (kind === 'run' || kind === 'verification') {
        return extractCommand(content.arguments) ?? content.name ?? '';
    }
    const filePath = extractFilePath(content.arguments);
    if (filePath) {
        return filePath;
    }
    return content.name ?? '';
}

function extractCommand(args: string | undefined): string | undefined {
    if (!args) {
        return undefined;
    }
    try {
        const parsed = JSON.parse(args);
        if (typeof parsed === 'object' && !!parsed) {
            const command = parsed.command ?? parsed.cmd ?? parsed.input;
            if (typeof command === 'string') {
                return command.length > 80 ? command.slice(0, 77) + '...' : command;
            }
        }
    } catch {
        // Not JSON, return raw truncated
        return args.length > 80 ? args.slice(0, 77) + '...' : args;
    }
    return undefined;
}

function extractFilePath(args: string | undefined): string | undefined {
    if (!args) {
        return undefined;
    }
    try {
        const parsed = JSON.parse(args);
        if (typeof parsed === 'object' && !!parsed) {
            const path = parsed.file_path ?? parsed.path ?? parsed.filePath ?? parsed.filename;
            if (typeof path === 'string') {
                const base = path.split('/').pop() ?? path;
                return base;
            }
        }
    } catch {
        // Not JSON
    }
    return undefined;
}

// ─── Summary formatting ──────────────────────────────────────────────────────

export function formatEventSummary(event: ExecutionEvent): string {
    const count = event.tools.length;
    const noun = pluralize(count, toolNoun(event));
    return `${count} ${noun}`;
}

export function formatToolLabel(event: ExecutionEvent, index: number): string {
    return `${event.verb} ${index + 1}`;
}

function toolNoun(event: ExecutionEvent): string {
    switch (event.kind) {
        case 'explore': return 'search';
        case 'read': return 'file';
        case 'write': return 'file';
        case 'edit': return 'file';
        case 'delete': return 'file';
        case 'run': return 'command';
        case 'verification': return 'check';
        default: return 'step';
    }
}

function pluralize(count: number, noun: string): string {
    if (count === 1) {
        return noun;
    }
    if (noun.endsWith('ch') || noun.endsWith('sh')) {
        return `${noun}es`;
    }
    return `${noun}s`;
}

// ─── File icon helper ────────────────────────────────────────────────────────
// Maps a file path/name to a codicon class for display in tool details and
// diff summaries. Lightweight inline mapping — the comprehensive shared
// helper lives in qaap-mobile-shell, but ai-chat-ui cannot depend on that
// package, so we keep a minimal mapping here.

const FILE_EXTENSION_ICONS: Readonly<Record<string, string>> = {
    // Code
    js: 'codicon-file-code', jsx: 'codicon-file-code', mjs: 'codicon-file-code', cjs: 'codicon-file-code',
    ts: 'codicon-file-code', tsx: 'codicon-file-code',
    py: 'codicon-file-code', rb: 'codicon-file-code', go: 'codicon-file-code', rs: 'codicon-file-code',
    java: 'codicon-file-code', c: 'codicon-file-code', cpp: 'codicon-file-code', h: 'codicon-file-code',
    cs: 'codicon-file-code', php: 'codicon-file-code', sh: 'codicon-file-code',
    // Config / data
    json: 'codicon-json', jsonc: 'codicon-json',
    yaml: 'codicon-settings-gear', yml: 'codicon-settings-gear', toml: 'codicon-settings-gear',
    xml: 'codicon-settings-gear', ini: 'codicon-settings-gear', env: 'codicon-settings-gear',
    // Markdown / text
    md: 'codicon-markdown', mdx: 'codicon-markdown', markdown: 'codicon-markdown',
    txt: 'codicon-file-text', rst: 'codicon-file-text',
    // Styling / markup
    css: 'codicon-symbol-color', scss: 'codicon-symbol-color', less: 'codicon-symbol-color',
    html: 'codicon-symbol-color', svg: 'codicon-file-media',
    // Images / media
    png: 'codicon-file-media', jpg: 'codicon-file-media', jpeg: 'codicon-file-media',
    gif: 'codicon-file-media', webp: 'codicon-file-media', ico: 'codicon-file-media',
    // Documents
    pdf: 'codicon-file-pdf',
    // Archives
    zip: 'codicon-file-zip', tar: 'codicon-file-zip', gz: 'codicon-file-zip',
};

const SPECIAL_FILENAMES: Readonly<Record<string, string>> = {
    'package.json': 'codicon-json',
    'tsconfig.json': 'codicon-json',
    'readme.md': 'codicon-markdown',
    '.env': 'codicon-settings-gear',
    '.gitignore': 'codicon-settings-gear',
    'dockerfile': 'codicon-file-code',
    'makefile': 'codicon-file-code',
};

/**
 * Resolves a codicon class for a file path or name. Used by tool details and
 * diff summary rows to show a file-type icon next to the filename.
 */
export function getFileIconClass(pathOrName: string): string {
    if (!pathOrName) {
        return 'codicon-file';
    }
    const base = pathOrName.slice(pathOrName.lastIndexOf('/') + 1);
    const lowerBase = base.toLowerCase();
    const special = SPECIAL_FILENAMES[lowerBase];
    if (special) {
        return special;
    }
    const dotIndex = base.lastIndexOf('.');
    if (dotIndex <= 0) {
        return 'codicon-file';
    }
    const ext = base.slice(dotIndex + 1).toLowerCase();
    return FILE_EXTENSION_ICONS[ext] ?? 'codicon-file';
}
