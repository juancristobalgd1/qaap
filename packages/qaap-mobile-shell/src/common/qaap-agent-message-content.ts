// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapAgentMessageDTO } from './qaap-agent-conversation-client';
import { QAAP_PRIMARY_AGENT_ID } from './qaap-agent-task-client';
import { parseAgentLogForTranscript } from './qaap-cli-transcript-stream';
import { resolveAgentMessageSegments } from './qaap-transcript-trace-model';
import {
    extractComposerAttachmentImagePaths,
    extractComposerAttachmentPreviewFeedbackSections,
    hasComposerAttachmentPreamble,
    stripComposerAttachmentPreamble,
} from './qaap-composer-attachment-prompt';
import { parsePreviewFeedbackContextBody, type PreviewFeedbackAnnotationDetail } from './qaap-preview-feedback-transcript';
import { parseComposerSkillDisplayMarker, type ComposerSkillDisplayMetadata } from './qaap-composer-skill-display';
import { parseComposerGitActionDisplayMarker, type ComposerGitActionDisplayMetadata } from './qaap-composer-git-action-display';
import { isQaiqStreamMetadataEnvelope } from './qaap-qaiq-stream';
import type { QaapTranscriptUserImagePreview } from './qaap-transcript-user-image-preview';
import { QAAP_PREVIEW_FEEDBACK_VARIABLE_NAME } from './qaap-preview-feedback-context';

interface AgentContentBlock {
    readonly type?: string;
    readonly text?: unknown;
    readonly content?: unknown;
}

interface AgentMessageLike {
    readonly role?: string;
    readonly type?: string;
    readonly content?: unknown;
    readonly message?: {
        readonly content?: unknown;
    };
}

/**
 * Some CLIs persist OpenAI/Responses-style message JSON in stdout. The chat UI should render the
 * human text, while still leaving arbitrary JSON visible when it is genuinely the user's content.
 */
export function normalizeAgentMessageContentForDisplay(raw: string | undefined | null): string {
    const text = raw ?? '';
    const trimmed = text.trim();
    let display: string;
    if (looksLikeQaiqProcessLog(trimmed)) {
        display = parseAgentLogForTranscript(QAAP_PRIMARY_AGENT_ID, trimmed).content.trim();
    } else if (!looksLikeJson(trimmed)) {
        display = text;
    } else {
        const extracted = extractDisplayTextFromJsonString(trimmed);
        if (extracted !== undefined) {
            display = extracted;
        } else if (isQaiqStreamMetadataJson(trimmed)) {
            display = '';
        } else {
            display = text;
        }
    }
    return stripQaapControlMarkersForDisplay(display);
}

/**
 * Machine sentinels agents emit for the conversation store (`@@QAAP:BLOCKED@@`,
 * `@@QAAP:VERDICT@@`, …). Never show them raw in the transcript or sidebar preview.
 * Keep any human need/reason that follows the marker on the same line.
 */
const QAAP_CONTROL_MARKER_LINE = /^@@QAAP:[A-Z0-9_]+@@(?:\s+(.*))?$/;
const QAAP_CONTROL_MARKER_INLINE = /@@QAAP:[A-Z0-9_]+@@/g;

export function stripQaapControlMarkersForDisplay(text: string): string {
    if (!text || !text.includes('@@QAAP:')) {
        return text;
    }
    const lines = text.split('\n');
    const kept: string[] = [];
    for (const line of lines) {
        const trimmed = line.trim();
        const match = QAAP_CONTROL_MARKER_LINE.exec(trimmed);
        if (match) {
            const need = (match[1] ?? '').trim();
            if (need && isMeaningfulBlockedNeed(need)) {
                kept.push(need);
            }
            continue;
        }
        kept.push(line.replace(QAAP_CONTROL_MARKER_INLINE, '').replace(/[ \t]{2,}/g, ' ').trimEnd());
    }
    return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Drop accidental/garbage needs like "knj" after a blocked sentinel. */
function isMeaningfulBlockedNeed(need: string): boolean {
    if (need.length >= 12) {
        return true;
    }
    if (/\s/.test(need)) {
        return true;
    }
    // Single token shorter than 12 chars is almost never a real question.
    return need.length >= 8 && /[?¿]/.test(need);
}

type MessagePreviewLike = {
    readonly content?: string | null;
    readonly segments?: ReadonlyArray<{
        readonly type: string;
        readonly content?: string;
    }>;
    readonly traceEvents?: ReadonlyArray<{ readonly type: string }>;
    readonly role?: string;
};


export interface TranscriptUserContextChip {
    readonly title: string;
    readonly kind: string;
    readonly iconClasses: string;
    /** Structured preview-feedback annotations; present when the chip can render as a rich card. */
    readonly annotations?: readonly PreviewFeedbackAnnotationDetail[];
}

export interface TranscriptUserMessageView {
    readonly displayText: string;
    readonly imagePreviews: readonly QaapTranscriptUserImagePreview[];
    readonly contextChips: readonly TranscriptUserContextChip[];
    readonly skillInvocation?: ComposerSkillDisplayMetadata;
    readonly gitActionInvocation?: ComposerGitActionDisplayMetadata;
}

function basenameFromWorkspacePath(path: string): string {
    const normalized = path.trim();
    const slash = normalized.lastIndexOf('/');
    return slash >= 0 ? normalized.slice(slash + 1) : normalized;
}

/**
 * Resolves transcript user-row copy, image previews, and context chips. Optimistic pending rows
 * keep client previews; persisted rows parse attachment preamble metadata out of {@link content}.
 *
 * Preview-feedback / file attachment preambles are stripped from display text so the user bubble
 * shows a readable chip + typed prompt (agent still receives the full outbound content).
 */
export function resolveTranscriptUserMessageView(
    message: MessagePreviewLike & {
        readonly id?: string;
        readonly optimisticImagePreviews?: readonly QaapTranscriptUserImagePreview[];
    } | undefined,
): TranscriptUserMessageView {
    const raw = resolveMessagePreviewText(message);
    const feedbackSections = extractComposerAttachmentPreviewFeedbackSections(raw);
    const contextChips: TranscriptUserContextChip[] = feedbackSections.map(section => {
        const annotations = parsePreviewFeedbackContextBody(section.body);
        return {
            title: section.title,
            kind: QAAP_PREVIEW_FEEDBACK_VARIABLE_NAME,
            iconClasses: 'codicon codicon-comment',
            ...(annotations.length ? { annotations } : {}),
        };
    });
    if (message?.optimisticImagePreviews?.length) {
        const display = resolveTranscriptUserDisplay(stripComposerAttachmentPreamble(raw));
        return {
            displayText: display.displayText,
            imagePreviews: message.optimisticImagePreviews,
            contextChips,
            ...(display.skillInvocation ? { skillInvocation: display.skillInvocation } : {}),
            ...(display.gitActionInvocation ? { gitActionInvocation: display.gitActionInvocation } : {}),
        };
    }
    const imagePaths = extractComposerAttachmentImagePaths(raw);
    if (imagePaths.length === 0 && contextChips.length === 0 && !hasComposerAttachmentPreamble(raw)) {
        return {
            ...resolveTranscriptUserDisplay(raw),
            imagePreviews: [],
            contextChips: [],
        };
    }
    const display = resolveTranscriptUserDisplay(stripComposerAttachmentPreamble(raw));
    return {
        displayText: display.displayText,
        ...(display.skillInvocation ? { skillInvocation: display.skillInvocation } : {}),
        ...(display.gitActionInvocation ? { gitActionInvocation: display.gitActionInvocation } : {}),
        imagePreviews: imagePaths.map(path => ({
            src: '',
            fileName: basenameFromWorkspacePath(path),
            wsRelativePath: path,
        })),
        contextChips,
    };
}

function resolveTranscriptUserDisplay(text: string): Pick<TranscriptUserMessageView, 'displayText' | 'skillInvocation' | 'gitActionInvocation'> {
    const gitActionInvocation = parseComposerGitActionDisplayMarker(text);
    if (gitActionInvocation) {
        return {
            displayText: gitActionInvocation.label,
            gitActionInvocation,
        };
    }
    const skillInvocation = parseComposerSkillDisplayMarker(text);
    if (!skillInvocation) {
        return { displayText: text };
    }
    const displayParts = [
        skillInvocation.prefix,
        `/${skillInvocation.skillName}`,
        skillInvocation.userText,
    ].map(part => part?.trim()).filter((part): part is string => !!part);
    return {
        displayText: displayParts.join(' '),
        skillInvocation,
    };
}

/**
 * Pending-user rows may carry the resolved attachment preamble in {@link content}; show only the
 * typed draft when optimistic image previews are painted separately.
 * @deprecated Prefer {@link resolveTranscriptUserMessageView}.
 */
export function resolveOptimisticPendingUserDisplayText(
    message: MessagePreviewLike & { readonly id?: string; readonly optimisticImagePreviews?: readonly QaapTranscriptUserImagePreview[] } | undefined,
): string {
    return resolveTranscriptUserMessageView(message).displayText;
}

/** Plain preview text for list rows — never throws when {@link content} is missing. */
export function resolveMessagePreviewText(message: MessagePreviewLike | undefined): string {
    if (!message) {
        return '';
    }
    const normalized = normalizeAgentMessageContentForDisplay(message.content);
    const trimmed = normalized.trim();
    if (trimmed && trimmed !== '…') {
        return trimmed;
    }
    for (const segment of [...resolveAgentMessageSegments(message as QaapAgentMessageDTO)].reverse()) {
        if (segment.type === 'text' && segment.content?.trim()) {
            const cleaned = stripQaapControlMarkersForDisplay(segment.content).trim();
            if (cleaned) {
                return cleaned;
            }
        }
    }
    return trimmed;
}

function looksLikeQaiqProcessLog(text: string): boolean {
    return /\{"type":"(?:stream_event|system|result)"/.test(text);
}

function isQaiqStreamMetadataJson(text: string): boolean {
    try {
        return isQaiqStreamMetadataEnvelope(JSON.parse(text));
    } catch {
        return false;
    }
}

function looksLikeJson(text: string): boolean {
    return (text.startsWith('{') && text.endsWith('}'))
        || (text.startsWith('[') && text.endsWith(']'))
        || (text.startsWith('"') && text.endsWith('"'));
}

function extractDisplayTextFromJsonString(text: string): string | undefined {
    try {
        return extractDisplayText(JSON.parse(text), 0);
    } catch {
        return undefined;
    }
}

function extractDisplayText(value: unknown, depth: number): string | undefined {
    if (depth > 3) {
        return undefined;
    }
    if (typeof value === 'string') {
        return looksLikeJson(value.trim()) ? extractDisplayTextFromJsonString(value.trim()) : value;
    }
    if (Array.isArray(value)) {
        return joinExtracted(value.map(item => extractDisplayText(item, depth + 1)));
    }
    if (!isRecord(value)) {
        return undefined;
    }
    const block = value as AgentContentBlock;
    if (typeof block.text === 'string' && isTextBlockType(block.type)) {
        return block.text;
    }
    if (typeof block.content === 'string' && isTextBlockType(block.type)) {
        return block.content;
    }
    const message = value as AgentMessageLike;
    const content = message.message?.content ?? message.content;
    if (content !== undefined && isMessageLike(message)) {
        return extractDisplayText(content, depth + 1);
    }
    return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function isTextBlockType(type: string | undefined): boolean {
    return !type || type === 'text' || type === 'input_text' || type === 'output_text';
}

function isMessageLike(value: AgentMessageLike): boolean {
    return typeof value.role === 'string'
        || value.type === 'message'
        || value.type === 'assistant'
        || value.type === 'user'
        || !!value.message;
}

function joinExtracted(parts: Array<string | undefined>): string | undefined {
    const text = parts
        .map(part => part?.trim())
        .filter((part): part is string => !!part)
        .join('\n\n');
    return text || undefined;
}
