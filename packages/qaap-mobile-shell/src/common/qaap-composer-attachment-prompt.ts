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
): Promise<ResolvedAIContextVariable[]> {
    if (!requests?.length) {
        return [];
    }
    const resolved = await Promise.all(
        requests.map(request => variableService.resolveVariable(request, context)),
    );
    return resolved.filter(ResolvedAIContextVariable.is);
}

/** Resolves composer context chips and prepends them to the outbound user prompt. */
export async function applyComposerAttachmentsToPrompt(
    draft: string,
    requests: readonly AIVariableResolutionRequest[] | undefined,
    variableService: AIVariableService,
    context?: AIVariableContext,
): Promise<string> {
    const resolved = await resolveComposerContextAttachments(requests, variableService, context);
    return applyResolvedAttachmentsToPrompt(draft, resolved);
}
