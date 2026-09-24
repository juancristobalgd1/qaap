// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapAgentConversationDTO, QaapAgentMessageSegmentDTO } from './qaap-agent-conversation-client';
import { buildQaapDevPreviewUrl, parseQaapDevPreviewPort, resolveDevPreviewPublicOrigin } from './qaap-dev-preview';
import { isQaapStaticBootstrapCommand } from './qaap-project-bootstrap-static';
import { resolveQaapTranscriptTrace, resolveAgentMessageSegments } from './qaap-transcript-trace-model';

const DEV_SERVER_COMMAND_RE = /\b(?:pnpm|npm|yarn|bun)\s+(?:run\s+)?(?:dev|start|serve|preview)\b|\b(?:vite|next\s+dev|nuxt\s+dev|astro\s+dev|remix\s+dev)\b|\bnpx\s+vite\b|\bnpx\s+next\b/i;
const DEV_URL_IN_TEXT_RE = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[?::1\]?):(\d{2,5})(?:\/[^\s`*)\]]*)?/i;
// Tolerates the punctuation agents actually emit: "port 5173", "port (5173)", "puerto: 5173",
// "port #5173". A bare `\s+` missed "port (5173)" and silently dropped the only preview signal.
const PORT_HINT_RE = /\b(?:ports?|puertos?)\s*[:#(]?\s*(\d{2,5})\b/i;
/** Common dev ports (Vite/Next) plus Qaap static bootstrap (8080). */
const DEFAULT_VITE_PROBE_PORTS = [5173, 5174, 5175, 5176, 3000, 3001, 4173, 8080];

const DEV_PREVIEW_INTENT_RE = /\b(?:dev\s+server|live\s+preview|in-ide\s+preview|run\s+(?:the\s+)?(?:app|project)|build\s+and\s+run|run\s+locally|start\s+(?:the\s+)?(?:dev|app|server)|launch\s+(?:the\s+)?(?:app|project|server)|preview\s+(?:the\s+)?(?:app|project|page)|show\s+(?:me\s+)?(?:the\s+)?(?:app|preview)|boot(?:s|ed)\s+cleanly|figure\s+out\s+how\s+to\s+build|open\s+(?:the\s+)?preview|lanza(?:r)?(?:\s+autom[aá]ticamente)?\s+(?:el\s+)?servidor|abre(?:r)?\s+(?:la\s+)?(?:preview|vista\s+previa)|mu[eé]str(?:ame|ar)\s+(?:la\s+)?(?:preview|vista\s+previa)|verifica(?:r)?\s+que\s+(?:la\s+)?p[aá]gina|levanta(?:r)?\s+(?:la\s+)?(?:app|aplicaci[oó]n|servidor|proyecto)|inicia(?:r)?\s+(?:la\s+)?(?:app|aplicaci[oó]n|servidor|proyecto)|arranca(?:r)?\s+(?:la\s+)?(?:app|aplicaci[oó]n|servidor|proyecto)|ejecuta(?:r)?\s+(?:la\s+)?(?:app|aplicaci[oó]n|proyecto)|corre(?:r)?\s+(?:la\s+)?(?:app|aplicaci[oó]n|proyecto)|muestra(?:r)?\s+(?:la\s+)?(?:app|aplicaci[oó]n|preview|vista\s+previa)|vista\s+previa|servidor\s+de\s+desarrollo|abre(?:r)?\s+(?:la\s+)?(?:app|aplicaci[oó]n|preview))\b/i;

/** True when an HTML page title plausibly belongs to the named hub project. */
export function previewPageTitleMatchesProjectName(title: string | undefined, projectName: string): boolean {
    const normalizedName = projectName.trim().toLowerCase();
    if (!normalizedName) {
        return true;
    }
    const normalizedTitle = title?.trim().toLowerCase();
    if (!normalizedTitle) {
        return false;
    }
    return normalizedTitle.includes(normalizedName);
}

/** True when user text asks to run or preview the app locally. */
export function messageRequestsDevPreview(text: string | undefined): boolean {
    return !!text?.trim() && DEV_PREVIEW_INTENT_RE.test(text);
}

/** True when any user turn in the conversation asked to run or preview the app. */
export function conversationEverRequestedDevPreview(conv: QaapAgentConversationDTO): boolean {
    return (conv.messages ?? []).some(message => message.role === 'user' && messageRequestsDevPreview(message.content));
}

/** Whether this conversation should drive dev-preview bootstrap (any turn may have asked). */
export function conversationRequestsDevPreview(conv: QaapAgentConversationDTO): boolean {
    return conversationEverRequestedDevPreview(conv);
}

/** Parses localhost URLs or explicit port hints from agent / tool text. */
export function extractDevPreviewUrlFromAgentText(text: string | undefined, origin?: string): string | undefined {
    if (!text?.trim()) {
        return undefined;
    }
    const direct = text.match(DEV_URL_IN_TEXT_RE);
    const portRaw = direct?.[1] ?? text.match(PORT_HINT_RE)?.[1];
    if (!portRaw) {
        return undefined;
    }
    const port = parseQaapDevPreviewPort(portRaw);
    if (port === undefined) {
        return undefined;
    }
    return buildQaapDevPreviewUrl(resolveDevPreviewPublicOrigin(origin), port);
}

function segmentText(segment: QaapAgentMessageSegmentDTO): string {
    if (segment.type === 'tool') {
        return `${segment.args}\n${segment.result ?? ''}`;
    }
    return segment.content;
}

/** Scans the conversation for a dev preview URL or port hint from the agent. */
export function findTranscriptPreviewUrlFromConversation(
    conv: QaapAgentConversationDTO,
    origin?: string,
): string | undefined {
    for (const message of [...conv.messages].reverse()) {
        const fromContent = extractDevPreviewUrlFromAgentText(message.content, origin);
        if (fromContent) {
            return fromContent;
        }
        for (const segment of [...resolveAgentMessageSegments(message)].reverse()) {
            const fromSegment = extractDevPreviewUrlFromAgentText(segmentText(segment), origin);
            if (fromSegment) {
                return fromSegment;
            }
        }
    }
    return undefined;
}

export function findTranscriptPreviewPortHint(conv: QaapAgentConversationDTO): number | undefined {
    const fromUrl = findTranscriptPreviewUrlFromConversation(conv);
    if (fromUrl) {
        const match = /\/qaap-dev\/(\d+)\//.exec(fromUrl);
        const port = parseQaapDevPreviewPort(match?.[1]);
        if (port !== undefined) {
            return port;
        }
    }
    for (const message of [...conv.messages].reverse()) {
        const texts = [message.content, ...resolveAgentMessageSegments(message).map(segmentText)];
        for (const text of texts) {
            const direct = text?.match(DEV_URL_IN_TEXT_RE);
            const portRaw = direct?.[1] ?? text?.match(PORT_HINT_RE)?.[1];
            const port = parseQaapDevPreviewPort(portRaw);
            if (port !== undefined) {
                return port;
            }
        }
    }
    return undefined;
}

export function isLikelyDevServerShellCommand(command: string | undefined): boolean {
    const text = command?.trim();
    if (!text) {
        return false;
    }
    return DEV_SERVER_COMMAND_RE.test(text) || isQaapStaticBootstrapCommand(text);
}

export function isShellToolName(name: string | undefined): boolean {
    const normalized = name?.trim().toLowerCase() ?? '';
    if (!normalized) {
        return false;
    }
    return normalized.includes('bash')
        || normalized.includes('shell')
        || normalized.includes('terminal')
        || normalized.startsWith('run_');
}

function extractBashCommand(args: string | undefined): string | undefined {
    if (!args?.trim()) {
        return undefined;
    }
    try {
        const parsed = JSON.parse(args) as { command?: unknown };
        return typeof parsed.command === 'string' ? parsed.command : undefined;
    } catch {
        return undefined;
    }
}

/** Segments for the latest agent turn, preferring settled traceEvents when present. */
function latestAgentTraceSegments(conv: QaapAgentConversationDTO): readonly QaapAgentMessageSegmentDTO[] {
    const agentMessage = [...conv.messages].reverse().find(message => message.role === 'agent');
    if (!agentMessage) {
        return [];
    }
    return resolveQaapTranscriptTrace(agentMessage).segments;
}

/** True when the latest agent turn is running a long-lived dev-server shell command. */
export function conversationHasActiveDevServerRun(conv: QaapAgentConversationDTO): boolean {
    if (conv.status !== 'streaming') {
        return false;
    }
    const segments = latestAgentTraceSegments(conv);
    if (!segments.length) {
        return false;
    }
    for (const segment of [...segments].reverse()) {
        if (segment.type !== 'tool' || segment.finished) {
            continue;
        }
        if (!isShellToolName(segment.name)) {
            continue;
        }
        const command = extractBashCommand(segment.args);
        if (isLikelyDevServerShellCommand(command)) {
            return true;
        }
        const combined = segmentText(segment);
        if (isLikelyDevServerShellCommand(combined) || DEV_URL_IN_TEXT_RE.test(combined)) {
            return true;
        }
    }
    return false;
}

/** True when the latest agent turn still has an unfinished shell / terminal tool. */
export function conversationHasActiveShellRun(conv: QaapAgentConversationDTO): boolean {
    if (conv.status !== 'streaming') {
        return false;
    }
    const segments = latestAgentTraceSegments(conv);
    if (!segments.length) {
        return false;
    }
    return segments.some(segment =>
        segment.type === 'tool'
        && !segment.finished
        && isShellToolName(segment.name),
    );
}

/** Whether we should keep polling the dev-preview probe for this conversation. */
export function conversationAwaitingDevPreview(conv: QaapAgentConversationDTO): boolean {
    if (conv.status !== 'streaming') {
        return false;
    }
    return conversationHasActiveDevServerRun(conv)
        || conversationHasActiveShellRun(conv)
        || findTranscriptPreviewPortHint(conv) !== undefined;
}

/** Whether the transcript UI should probe ports and/or open Preview for this conversation. */
export function conversationShouldWatchDevPreview(
    conv: QaapAgentConversationDTO,
    origin?: string,
): boolean {
    return conversationAwaitingDevPreview(conv)
        || conversationRequestsDevPreview(conv)
        || findTranscriptPreviewUrlFromConversation(conv, origin) !== undefined;
}

export interface TranscriptPreviewPortProbeResult {
    readonly ready: boolean;
    readonly previewUrl: string;
}

/** Probes candidate ports until one responds as a live dev preview. */
export async function resolveReadyTranscriptPreviewUrlFromProbe(
    conv: QaapAgentConversationDTO,
    probePort: (port: number) => Promise<TranscriptPreviewPortProbeResult>,
    origin?: string,
): Promise<string | undefined> {
    if (!conversationShouldWatchDevPreview(conv, origin)) {
        return undefined;
    }
    for (const port of transcriptPreviewProbePorts(conv)) {
        const probe = await probePort(port);
        if (probe.ready) {
            return probe.previewUrl;
        }
    }
    return undefined;
}

function conversationAgentFinishedTool(conv: QaapAgentConversationDTO): boolean {
    return latestAgentTraceSegments(conv).some(segment => segment.type === 'tool' && segment.finished);
}

/** True when default dev ports may be probed (avoids opening a stale server mid-turn). */
export function conversationShouldProbeDefaultDevPreviewPorts(conv: QaapAgentConversationDTO): boolean {
    if (conversationEverRequestedDevPreview(conv)) {
        return true;
    }
    if (findTranscriptPreviewPortHint(conv) !== undefined) {
        return true;
    }
    if (conv.status !== 'streaming') {
        return true;
    }
    if (conversationHasActiveDevServerRun(conv) || conversationHasActiveShellRun(conv)) {
        return true;
    }
    return conversationAgentFinishedTool(conv);
}

/** True when bootstrap may start install/dev for this conversation turn. */
export function conversationShouldKickoffDevPreviewBootstrap(conv: QaapAgentConversationDTO): boolean {
    return conversationShouldProbeDefaultDevPreviewPorts(conv);
}

/**
 * True when the UI may auto-switch to Preview / Browser without a second tap.
 *
 * Only when a user turn asked to run or preview the app. A URL that merely appears in agent
 * prose still stages the "Open preview" pill instead of yanking the transcript.
 */
export function conversationMayAutoOpenTranscriptPreview(conv: QaapAgentConversationDTO | undefined): boolean {
    return !!conv && conversationEverRequestedDevPreview(conv);
}

/** Ports to probe while waiting for a dev server to bind. */
export function transcriptPreviewProbePorts(conv: QaapAgentConversationDTO): readonly number[] {
    const hinted = findTranscriptPreviewPortHint(conv);
    const ports: number[] = [];
    if (hinted !== undefined) {
        ports.push(hinted);
    }
    if (conversationShouldProbeDefaultDevPreviewPorts(conv)) {
        for (const port of DEFAULT_VITE_PROBE_PORTS) {
            if (!ports.includes(port)) {
                ports.push(port);
            }
        }
    }
    return ports;
}
