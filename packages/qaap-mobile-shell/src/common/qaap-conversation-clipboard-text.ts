// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import type { QaapAgentConversationDTO, QaapAgentMessageDTO, QaapAgentMessageSegmentDTO } from './qaap-agent-conversation-client';
import { resolveTranscriptUserMessageView } from './qaap-agent-message-content';
import { resolveAgentMessageDisplayContent, resolveAgentMessageSegments } from './qaap-transcript-trace-model';

const MESSAGE_SEPARATOR = '\n\n---\n\n';

function stripAnsi(text: string): string {
    return text
        .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
        .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, '');
}

function cleanClipboardText(text: string): string {
    return stripAnsi(text).trim();
}

function formatSegmentForClipboard(segment: QaapAgentMessageSegmentDTO): string {
    if (segment.type === 'text' || segment.type === 'thinking') {
        return cleanClipboardText(segment.content);
    }
    const parts = [`[${segment.name}]`];
    const args = cleanClipboardText(segment.args);
    if (args) {
        parts.push(args);
    }
    const result = cleanClipboardText(segment.result ?? '');
    if (result) {
        parts.push(result);
    }
    return parts.join('\n');
}

export function formatAgentMessageForClipboard(message: QaapAgentMessageDTO): string {
    const parts: string[] = [];
    const segments = resolveAgentMessageSegments(message);
    if (segments.length > 0) {
        for (const segment of segments) {
            if (segment.type === 'thinking') {
                continue;
            }
            const formatted = formatSegmentForClipboard(segment);
            if (formatted) {
                parts.push(formatted);
            }
        }
    } else {
        const displayContent = cleanClipboardText(resolveAgentMessageDisplayContent(message));
        if (displayContent) {
            parts.push(displayContent);
        }
    }
    const error = cleanClipboardText(message.error ?? '');
    if (error) {
        parts.push(error);
    }
    return parts.join('\n\n');
}

export function formatUserMessageForClipboard(message: QaapAgentMessageDTO): string {
    return cleanClipboardText(resolveTranscriptUserMessageView(message).displayText);
}

export function formatConversationMessageForClipboard(message: QaapAgentMessageDTO): string {
    const body = message.role === 'user'
        ? formatUserMessageForClipboard(message)
        : formatAgentMessageForClipboard(message);
    if (!body) {
        return '';
    }
    const label = message.role === 'user'
        ? nls.localize('qaap/conversationClipboard/user', 'User')
        : nls.localize('qaap/conversationClipboard/agent', 'Assistant');
    return `${label}:\n${body}`;
}

/** Plain-text export of every turn in a conversation, suitable for clipboard paste. */
export function formatConversationForClipboard(conv: QaapAgentConversationDTO): string {
    return conv.messages
        .map(formatConversationMessageForClipboard)
        .filter(Boolean)
        .join(MESSAGE_SEPARATOR);
}
