// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import {
    AIVariableContext,
    AIVariableResolutionRequest,
    AIVariableService,
    ResolvedAIContextVariable,
} from '@theia/ai-core';
import { ImageContextVariable } from '@theia/ai-chat/lib/common/image-context-variable';

const ATTACHMENT_PREAMBLE_HEADER = 'The user attached the following context with this message. Use it to answer; do not claim nothing was provided.';
const ATTACHMENT_SECTION_SEPARATOR = '\n\n---\n\n';

const IMAGE_CONTEXT_HEADER_PATTERN = /^### imageContext:\s*(.+)$/gm;
const WORKSPACE_IMAGE_ATTACHED_PATTERN = /^Workspace image attached:\s*([^\s(]+)/gm;
const PREVIEW_FEEDBACK_HEADER_PATTERN = /^### previewFeedback:\s*(.+)$/gm;

export function extractComposerAttachmentImagePaths(content: string): string[] {
    const paths = new Set<string>();
    for (const match of content.matchAll(IMAGE_CONTEXT_HEADER_PATTERN)) {
        const path = match[1]?.trim();
        if (path) {
            paths.add(path);
        }
    }
    for (const match of content.matchAll(WORKSPACE_IMAGE_ATTACHED_PATTERN)) {
        const path = match[1]?.trim();
        if (path) {
            paths.add(path);
        }
    }
    return [...paths];
}

/** Returns only the typed user draft, omitting composer attachment preamble blocks. */
export function stripComposerAttachmentPreamble(content: string): string {
    if (!content.includes(ATTACHMENT_PREAMBLE_HEADER)
        && extractComposerAttachmentImagePaths(content).length === 0
        && extractComposerAttachmentPreviewFeedbackTitles(content).length === 0) {
        return content;
    }
    const separatorIndex = content.lastIndexOf(ATTACHMENT_SECTION_SEPARATOR);
    if (separatorIndex >= 0) {
        return content.slice(separatorIndex + ATTACHMENT_SECTION_SEPARATOR.length).trim();
    }
    if (content.includes(ATTACHMENT_PREAMBLE_HEADER)
        || extractComposerAttachmentImagePaths(content).length > 0
        || extractComposerAttachmentPreviewFeedbackTitles(content).length > 0) {
        return '';
    }
    return content;
}

/** Titles from `### previewFeedback:` attachment headers (for transcript chips). */
export function extractComposerAttachmentPreviewFeedbackTitles(content: string): string[] {
    const titles: string[] = [];
    for (const match of content.matchAll(PREVIEW_FEEDBACK_HEADER_PATTERN)) {
        const title = match[1]?.trim();
        if (title) {
            titles.push(title);
        }
    }
    return titles;
}

export interface ComposerAttachmentPreviewFeedbackSection {
    readonly title: string;
    /** Fenced body under the header — the full formatted annotation context, without the fences. */
    readonly body: string;
}

/**
 * Full `### previewFeedback:` sections (title + fenced body) so the transcript can render every
 * annotation detail, not just the chip title. Headers without a fenced body yield an empty body.
 */
export function extractComposerAttachmentPreviewFeedbackSections(content: string): ComposerAttachmentPreviewFeedbackSection[] {
    const sections: ComposerAttachmentPreviewFeedbackSection[] = [];
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
        const header = /^### previewFeedback:\s*(.+)$/.exec(lines[i]!);
        const title = header?.[1]?.trim();
        if (!title) {
            continue;
        }
        let body = '';
        if (lines[i + 1]?.trim() === '```') {
            const bodyLines: string[] = [];
            let j = i + 2;
            for (; j < lines.length && lines[j]!.trim() !== '```'; j++) {
                bodyLines.push(lines[j]!);
            }
            body = bodyLines.join('\n');
            i = j;
        }
        sections.push({ title, body });
    }
    return sections;
}

export function hasComposerAttachmentPreamble(content: string): boolean {
    return content.includes(ATTACHMENT_PREAMBLE_HEADER)
        || extractComposerAttachmentImagePaths(content).length > 0
        || extractComposerAttachmentPreviewFeedbackTitles(content).length > 0;
}

/** Meta variables that summarize other context — never inline as attachments. */
const META_CONTEXT_VARIABLE_NAMES = new Set(['contextSummary', 'contextDetails']);

function formatAttachmentSection(variable: ResolvedAIContextVariable): string | undefined {
    const type = variable.variable.name;
    if (META_CONTEXT_VARIABLE_NAMES.has(type)) {
        return undefined;
    }

    const label = variable.value?.trim() || variable.arg?.trim() || type;
    const header = `### ${type}: ${label}`;

    if (type === 'imageContext') {
        const image = variable.arg ? ImageContextVariable.parseRequest(variable) : undefined;
        const path = image?.wsRelativePath ?? image?.name ?? label;
        const mimeType = image && ImageContextVariable.isResolved(image) ? image.mimeType : undefined;
        const mimeSuffix = mimeType ? ` (${mimeType})` : '';
        const body = [
            `Workspace image attached: ${path}${mimeSuffix}.`,
            'Read this file from the workspace if you need visual details.',
        ].join('\n');
        return `${header}\n${body}`;
    }

    const content = variable.contextValue?.trim();
    if (!content) {
        return undefined;
    }
    return `${header}\n\`\`\`\n${content}\n\`\`\``;
}

/** Builds a readable attachment block from already-resolved context variables. */
export function buildResolvedComposerAttachmentBlock(
    variables: readonly ResolvedAIContextVariable[],
): string | undefined {
    const sections = variables
        .map(formatAttachmentSection)
        .filter((section): section is string => !!section);
    if (sections.length === 0) {
        return undefined;
    }
    return [ATTACHMENT_PREAMBLE_HEADER, '', ...sections].join('\n');
}

/** Prepends resolved attachment context to the outbound user prompt. */
export function applyResolvedAttachmentsToPrompt(
    draft: string,
    variables: readonly ResolvedAIContextVariable[],
): string {
    const block = buildResolvedComposerAttachmentBlock(variables);
    const trimmedDraft = draft.trim();
    if (!block) {
        return draft;
    }
    if (!trimmedDraft) {
        return block;
    }
    return `${block}${ATTACHMENT_SECTION_SEPARATOR}${trimmedDraft}`;
}

export async function resolveComposerContextAttachments(
    requests: readonly AIVariableResolutionRequest[] | undefined,
    variableService: AIVariableService,
    context: AIVariableContext = {},
    options?: {
        resolvePinnedRequest?: (
            request: AIVariableResolutionRequest,
        ) => Promise<ResolvedAIContextVariable | undefined>;
    },
): Promise<ResolvedAIContextVariable[]> {
    if (!requests?.length) {
        return [];
    }
    const resolved: ResolvedAIContextVariable[] = [];
    for (const request of requests) {
        const pinned = await options?.resolvePinnedRequest?.(request);
        if (pinned) {
            resolved.push(pinned);
            continue;
        }
        const next = await variableService.resolveVariable(request, context);
        if (ResolvedAIContextVariable.is(next)) {
            resolved.push(next);
        }
    }
    return resolved;
}

/** Resolves composer context chips and prepends them to the outbound user prompt. */
export async function applyComposerAttachmentsToPrompt(
    draft: string,
    requests: readonly AIVariableResolutionRequest[] | undefined,
    variableService: AIVariableService,
    context?: AIVariableContext,
    options?: {
        resolvePinnedRequest?: (
            request: AIVariableResolutionRequest,
        ) => Promise<ResolvedAIContextVariable | undefined>;
    },
): Promise<string> {
    const resolved = await resolveComposerContextAttachments(requests, variableService, context, options);
    return applyResolvedAttachmentsToPrompt(draft, resolved);
}
