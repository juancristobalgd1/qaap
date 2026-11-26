// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import type { QaapAgentConversationDTO, QaapAgentMessageSegmentDTO } from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';
import {
    parseQaapTranscriptPreviewToolOperation,
    type QaapAgentPreviewOperation,
    type QaapAgentPreviewState,
} from '@theia/qaap-shared-core/lib/common/qaap-agent-preview-protocol';
import { resolveAgentMessageSegments } from '@theia/qaap-shared-core/lib/common/qaap-transcript-trace-model';

export const MOBILE_PREVIEW_TOOL_CARD_CLASS = 'theia-mobile-preview-tool-card';

export interface MobilePreviewToolResultMatch {
    readonly toolUseId: string;
    readonly operation: QaapAgentPreviewOperation;
    readonly state: QaapAgentPreviewState;
}

function isPreviewStateObject(value: unknown): value is QaapAgentPreviewState {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }
    const status = (value as { status?: unknown }).status;
    return status === 'starting' || status === 'ready' || status === 'failed'
        || status === 'exited' || status === 'stopped' || status === 'none';
}

/** Parses the JSON state returned by `preview_start` / `preview_restart` / `preview_status` / `preview_stop` (or `qaaq-preview`). */
export function parseMobilePreviewToolResult(result: string | undefined): QaapAgentPreviewState | undefined {
    const text = result?.trim();
    if (!text) {
        return undefined;
    }
    const tryParse = (raw: string): QaapAgentPreviewState | undefined => {
        try {
            const parsed = JSON.parse(raw) as unknown;
            return isPreviewStateObject(parsed) ? parsed : undefined;
        } catch {
            return undefined;
        }
    };
    const direct = tryParse(text);
    if (direct) {
        return direct;
    }
    // Shell tool output around `qaaq-preview` can carry leading/trailing lines; extract the JSON object if present.
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) {
        return tryParse(text.slice(start, end + 1));
    }
    return undefined;
}

function resolveSegmentPreviewOperation(segment: Extract<QaapAgentMessageSegmentDTO, { type: 'tool' }>): QaapAgentPreviewOperation | undefined {
    const mcpOp = parseQaapTranscriptPreviewToolOperation(segment.name);
    if (mcpOp) {
        return mcpOp;
    }
    // CLI fallback (`qaaq-preview start|wait|status|restart|stop`) invoked through a shell tool.
    const args = segment.args ?? '';
    const match = /\bqaaq-preview\s+(start|restart|status|wait|stop)\b/.exec(args);
    if (!match) {
        return undefined;
    }
    return match[1] === 'wait' ? 'status' : match[1] as QaapAgentPreviewOperation;
}

/** Returns the latest finished preview lifecycle tool result (`start`/`restart`/`stop`) inside a turn's segments. */
export function findLatestPreviewToolResultInSegments(
    segments: readonly QaapAgentMessageSegmentDTO[],
): MobilePreviewToolResultMatch | undefined {
    for (let i = segments.length - 1; i >= 0; i--) {
        const segment = segments[i];
        if (segment.type !== 'tool' || !segment.finished) {
            continue;
        }
        const operation = resolveSegmentPreviewOperation(segment);
        if (operation !== 'start' && operation !== 'restart' && operation !== 'stop') {
            continue;
        }
        const state = parseMobilePreviewToolResult(segment.result);
        if (state) {
            return { toolUseId: segment.toolUseId, operation, state };
        }
    }
    return undefined;
}

/**
 * Finds the latest finished `ready` preview tool result (`preview_start`, `preview_restart`, `preview_status`
 * or `qaaq-preview`) in the conversation's newest agent turn so the frontend can adopt/open the Preview pane
 * directly from the tool result instead of scraping prose or sweeping ports.
 */
export function findLatestReadyPreviewToolUrl(
    conv: QaapAgentConversationDTO | undefined,
): { readonly url: string; readonly toolUseId: string; readonly httpStatus?: number } | undefined {
    if (!conv?.messages?.length) {
        return undefined;
    }
    const lastAgent = [...conv.messages].reverse().find(message => message.role === 'agent');
    if (!lastAgent) {
        return undefined;
    }
    const segments = resolveAgentMessageSegments(lastAgent);
    for (let i = segments.length - 1; i >= 0; i--) {
        const segment = segments[i];
        if (segment.type !== 'tool' || !segment.finished) {
            continue;
        }
        const operation = resolveSegmentPreviewOperation(segment);
        if (operation !== 'start' && operation !== 'restart' && operation !== 'status') {
            continue;
        }
        const state = parseMobilePreviewToolResult(segment.result);
        if (state?.status === 'ready' && state.url?.trim()) {
            return {
                url: state.url.trim(),
                toolUseId: segment.toolUseId,
                httpStatus: state.httpStatus,
            };
        }
    }
    return undefined;
}

/** Compact transcript card summarizing an agent preview tool result (status, Open preview, Show logs). */
export function createMobilePreviewToolCardElement(
    state: QaapAgentPreviewState,
    callbacks: { readonly onOpenPreview?: (url: string) => void } = {},
): HTMLElement {
    const card = document.createElement('div');
    card.className = `${MOBILE_PREVIEW_TOOL_CARD_CLASS} theia-mod-${state.status}`;

    const header = document.createElement('div');
    header.className = `${MOBILE_PREVIEW_TOOL_CARD_CLASS}-header`;

    const icon = document.createElement('span');
    const iconName = state.status === 'ready'
        ? 'codicon-pass'
        : state.status === 'starting'
            ? 'codicon-loading codicon-modifier-spin'
            : state.status === 'stopped'
                ? 'codicon-debug-stop'
                : 'codicon-warning';
    icon.className = `codicon ${iconName} ${MOBILE_PREVIEW_TOOL_CARD_CLASS}-icon`;
    icon.setAttribute('aria-hidden', 'true');

    const title = document.createElement('span');
    title.className = `${MOBILE_PREVIEW_TOOL_CARD_CLASS}-title`;
    if (state.status === 'ready') {
        title.textContent = state.httpStatus
            ? nls.localize('qaap/transcript/previewToolReadyHttp', 'Preview live (HTTP {0})', String(state.httpStatus))
            : nls.localize('qaap/transcript/previewToolReady', 'Preview live');
    } else if (state.status === 'starting') {
        title.textContent = nls.localize('qaap/transcript/previewToolStarting', 'Preview starting…');
    } else if (state.status === 'stopped') {
        title.textContent = nls.localize('qaap/transcript/previewToolStopped', 'Preview stopped');
    } else {
        title.textContent = state.failure?.message?.trim()
            || nls.localize('qaap/transcript/previewToolFailed', 'Preview failed to start');
    }
    header.append(icon, title);

    if (state.status === 'ready' && state.url && callbacks.onOpenPreview) {
        const previewUrl = state.url;
        const openBtn = document.createElement('button');
        openBtn.type = 'button';
        openBtn.className = `${MOBILE_PREVIEW_TOOL_CARD_CLASS}-open`;
        openBtn.textContent = nls.localize('qaap/transcript/previewToolOpen', 'Open preview');
        openBtn.addEventListener('click', () => callbacks.onOpenPreview?.(previewUrl));
        header.append(openBtn);
    }
    card.append(header);

    const logTail = Array.isArray(state.logTail)
        ? state.logTail.join('\n').trim()
        : (typeof state.logTail === 'string' ? (state.logTail as string).trim() : '');
    if (logTail && (state.status === 'failed' || state.status === 'exited' || state.status === 'starting')) {
        const logs = document.createElement('details');
        logs.className = `${MOBILE_PREVIEW_TOOL_CARD_CLASS}-logs`;
        const summary = document.createElement('summary');
        summary.className = `${MOBILE_PREVIEW_TOOL_CARD_CLASS}-logs-summary`;
        summary.textContent = nls.localize('qaap/transcript/previewToolShowLogs', 'Show logs');
        const pre = document.createElement('pre');
        pre.className = `${MOBILE_PREVIEW_TOOL_CARD_CLASS}-logs-body`;
        pre.textContent = logTail;
        logs.append(summary, pre);
        card.append(logs);
    }

    return card;
}
