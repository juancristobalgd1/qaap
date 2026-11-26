// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapAgentConversationDTO, QaapAgentMessageSegmentDTO } from './qaap-agent-conversation-client';
import { buildQaapDevPreviewUrl, parseQaapDevPreviewPort, resolveDevPreviewPublicOrigin } from './qaap-dev-preview';
import { isQaapStaticBootstrapCommand } from './qaap-project-bootstrap-static';
import { resolveThreadPreviewRoot } from './qaap-thread-preview-root';
import { resolveQaapTranscriptTrace, resolveAgentMessageSegments } from './qaap-transcript-trace-model';
import { normalizeWorktreeCwd } from './qaap-worktree-label';
import { foldQaapPrivatePathAlias } from './qaap-preview-identity';

const DEV_SERVER_COMMAND_RE = /\b(?:pnpm|npm|yarn|bun)\s+(?:run\s+)?(?:dev|start|serve|preview)\b|\b(?:vite|next\s+dev|nuxt\s+dev|astro\s+dev|remix\s+dev)\b|\bnpx\s+vite\b|\bnpx\s+next\b/i;
const DEV_URL_IN_TEXT_RE = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[?::1\]?):(\d{2,5})(?:\/[^\s`*)"'<>\]}]*)?/i;
// Tolerates the punctuation agents actually emit: "port 5173", "port (5173)", "puerto: 5173",
// "port #5173". A bare `\s+` missed "port (5173)" and silently dropped the only preview signal.
const PORT_HINT_RE = /\b(?:ports?|puertos?)\s*[:#(]?\s*(\d{2,5})\b/i;
/** Common dev ports (Vite/Next) plus Qaap static bootstrap (8080). */
const DEFAULT_VITE_PROBE_PORTS = [5173, 5174, 5175, 5176, 3000, 3001, 4173, 8080];

const DEV_PREVIEW_INTENT_RE = /\b(?:dev\s+server|live\s+preview|in-ide\s+preview|run\s+(?:the\s+)?(?:app|project)|build\s+and\s+run|run\s+locally|start\s+(?:the\s+)?(?:dev|app|server)|launch\s+(?:the\s+)?(?:app|project|server)|preview\s+(?:the\s+)?(?:app|project|page)|show\s+(?:me\s+)?(?:the\s+)?(?:app|preview)|boot(?:s|ed)\s+cleanly|figure\s+out\s+how\s+to\s+build|open\s+(?:the\s+)?preview|lanza(?:r)?(?:\s+autom[aá]ticamente)?\s+(?:el\s+)?servidor|abre(?:r)?\s+(?:la\s+)?(?:preview|vista\s+previa)|mu[eé]str(?:ame|ar)\s+(?:la\s+)?(?:preview|vista\s+previa)|verifica(?:r)?\s+que\s+(?:la\s+)?p[aá]gina|(?:lev[aá]nta(?:r|me|lo|la)?|inici[aá](?:r|me|lo|la)?|arr[aá]nca(?:r|me|lo|la)?|lanza(?:r|me)?|pon(?:er|me)?\s+en\s+marcha)\s+(?:(?:el|la|mi|los|las|de\s+nuevo)\s+)?(?:app|aplicaci[oó]n|servidor|server|proyecto|web|frontend|dev)|ejecuta(?:r)?\s+(?:la\s+)?(?:app|aplicaci[oó]n|proyecto)|corre(?:r)?\s+(?:la\s+)?(?:app|aplicaci[oó]n|proyecto)|muestra(?:r)?\s+(?:la\s+)?(?:app|aplicaci[oó]n|preview|vista\s+previa)|vista\s+previa|servidor\s+de\s+desarrollo|abre(?:r)?\s+(?:la\s+)?(?:app|aplicaci[oó]n|preview))\b/i;

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

/** Whether the latest user turn requests a preview (older requests must not trigger later sweeps). */
export function latestUserTurnRequestsDevPreview(conv: QaapAgentConversationDTO): boolean {
    const latestUserMessage = [...(conv.messages ?? [])].reverse().find(message => message.role === 'user');
    return !!latestUserMessage && messageRequestsDevPreview(latestUserMessage.content);
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

/**
 * How long a port the conversation named must stay dead and unclaimed, after the turn ended, before
 * it stops counting as this conversation's preview hint.
 */
export const TRANSCRIPT_PREVIEW_DEAD_HINT_GRACE_MS = 30_000;
/** Conversations whose hint state is remembered (oldest forgotten first). */
const TRANSCRIPT_PREVIEW_HINT_STATE_LIMIT = 200;

/**
 * Per conversation: port -> index of the newest message whose mentions of that port are retired.
 * A port the agent merely mentioned (an ad-hoc `PORT=3002 node server.js` check, a failure log
 * quoting "running on http://localhost:3002") otherwise stays the conversation's preview hint
 * forever: it is probed first on every tick, keeps the preview watch alive after the turn ended and
 * outranks the saved URL, long after the live preview moved to another port. A mention in a newer
 * message revives the hint.
 */
const retiredTranscriptPreviewHints = new Map<string, Map<number, number>>();
/** Per conversation: port -> first time its hint probed dead and unclaimed (cleared when it answers). */
const deadTranscriptPreviewHints = new Map<string, Map<number, number>>();

function transcriptPreviewHintState(store: Map<string, Map<number, number>>, conversationId: string): Map<number, number> {
    let state = store.get(conversationId);
    if (!state) {
        state = new Map();
        store.set(conversationId, state);
        const oldest = store.size > TRANSCRIPT_PREVIEW_HINT_STATE_LIMIT ? store.keys().next().value : undefined;
        if (oldest !== undefined) {
            store.delete(oldest);
        }
    }
    return state;
}

function transcriptPreviewHintRetired(conv: QaapAgentConversationDTO, port: number, messageIndex: number): boolean {
    const retiredThrough = retiredTranscriptPreviewHints.get(conv.id)?.get(port);
    return retiredThrough !== undefined && messageIndex <= retiredThrough;
}

/**
 * Stops treating `port` as this conversation's preview hint for every message so far: the live
 * preview of the conversation is known to be elsewhere, or the port stayed dead and unclaimed.
 */
export function retireTranscriptPreviewPortHint(conv: QaapAgentConversationDTO, port: number): void {
    transcriptPreviewHintState(retiredTranscriptPreviewHints, conv.id).set(port, conv.messages.length - 1);
    deadTranscriptPreviewHints.get(conv.id)?.delete(port);
}

/**
 * Records a probe of the conversation's hinted port. A port that answers, or that Qaap holds a
 * claim on, is live. One that stays dead and unclaimed for {@link TRANSCRIPT_PREVIEW_DEAD_HINT_GRACE_MS}
 * after the turn ended is retired; while the turn streams it is still "server not up yet".
 * @returns true when the probe found the port dead and unclaimed.
 */
export function noteTranscriptPreviewHintProbe(
    conv: QaapAgentConversationDTO,
    port: number,
    probe: Pick<TranscriptPreviewPortProbeResult, 'ready' | 'previewId'>,
    now: number = Date.now(),
): boolean {
    if (probe.ready || probe.previewId) {
        deadTranscriptPreviewHints.get(conv.id)?.delete(port);
        return false;
    }
    const dead = transcriptPreviewHintState(deadTranscriptPreviewHints, conv.id);
    const since = dead.get(port);
    if (since === undefined) {
        dead.set(port, now);
    } else if (conv.status !== 'streaming' && now - since >= TRANSCRIPT_PREVIEW_DEAD_HINT_GRACE_MS) {
        retireTranscriptPreviewPortHint(conv, port);
    }
    return true;
}

/** @internal Test hook: forgets every retired / dead hint. */
export function resetTranscriptPreviewHintStateForTests(): void {
    retiredTranscriptPreviewHints.clear();
    deadTranscriptPreviewHints.clear();
}

function portOfQaapDevPreviewUrl(url: string): number | undefined {
    return parseQaapDevPreviewPort(/\/qaap-dev\/(\d+)\//.exec(url)?.[1]);
}

/** Scans the conversation for a dev preview URL or port hint from the agent (retired hints skipped). */
export function findTranscriptPreviewUrlFromConversation(
    conv: QaapAgentConversationDTO,
    origin?: string,
): string | undefined {
    const usable = (url: string | undefined, messageIndex: number): string | undefined => {
        if (!url) {
            return undefined;
        }
        const port = portOfQaapDevPreviewUrl(url);
        return port !== undefined && transcriptPreviewHintRetired(conv, port, messageIndex) ? undefined : url;
    };
    for (let index = conv.messages.length - 1; index >= 0; index--) {
        const message = conv.messages[index];
        const fromContent = usable(extractDevPreviewUrlFromAgentText(message.content, origin), index);
        if (fromContent) {
            return fromContent;
        }
        for (const segment of [...resolveAgentMessageSegments(message)].reverse()) {
            const fromSegment = usable(extractDevPreviewUrlFromAgentText(segmentText(segment), origin), index);
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
        const port = portOfQaapDevPreviewUrl(fromUrl);
        if (port !== undefined) {
            return port;
        }
    }
    for (let index = conv.messages.length - 1; index >= 0; index--) {
        const message = conv.messages[index];
        const texts = [message.content, ...resolveAgentMessageSegments(message).map(segmentText)];
        for (const text of texts) {
            const direct = text?.match(DEV_URL_IN_TEXT_RE);
            const portRaw = direct?.[1] ?? text?.match(PORT_HINT_RE)?.[1];
            const port = parseQaapDevPreviewPort(portRaw);
            if (port !== undefined && !transcriptPreviewHintRetired(conv, port, index)) {
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
    /** Set when Qaap holds a claim on the port (see `/qaap-dev/api/probe/:port`). */
    readonly previewId?: string;
    /** Section that owns the claim, when the claim was made for one. */
    readonly conversationId?: string;
    /** Canonical workspace root of the claim. */
    readonly root?: string;
}

/** The thread on whose behalf a bare dev port is probed. */
export interface TranscriptPreviewProbeScope {
    readonly conversationId?: string;
    /** Root the thread previews from (see {@link resolveThreadPreviewRoot}). */
    readonly root?: string;
}

function previewRootKey(root: string): string {
    // The claim root is the realpath (`/private/var/…` on macOS), the thread root may not be.
    const normalized = foldQaapPrivatePathAlias(normalizeWorktreeCwd(root));
    // Windows paths are case-insensitive; the claim root is the realpath, the thread root is not.
    return /^[a-z]:/i.test(normalized) ? normalized.toLowerCase() : normalized;
}

/**
 * Whether a probed port may be adopted as this thread's preview. A port Qaap never claimed (an
 * external server started outside Qaap) stays adoptable; a claimed port by the section that
 * claimed it, or by any thread previewing the same root: a project has one shared dev server, so
 * a sibling thread of the same root reuses it. Claims of another root are never mounted.
 */
export function transcriptPreviewProbeBelongsToScope(
    probe: Pick<TranscriptPreviewPortProbeResult, 'previewId' | 'conversationId' | 'root'>,
    scope: TranscriptPreviewProbeScope,
): boolean {
    if (!probe.previewId) {
        return true;
    }
    if (probe.conversationId && scope.conversationId) {
        return probe.conversationId === scope.conversationId
            || (!!probe.root && !!scope.root && previewRootKey(probe.root) === previewRootKey(scope.root));
    }
    return !probe.root || !scope.root || previewRootKey(probe.root) === previewRootKey(scope.root);
}

/** Probes candidate ports until one responds as a live dev preview owned by this conversation. */
export async function resolveReadyTranscriptPreviewUrlFromProbe(
    conv: QaapAgentConversationDTO,
    probePort: (port: number) => Promise<TranscriptPreviewPortProbeResult>,
    origin?: string,
): Promise<string | undefined> {
    if (!conversationShouldWatchDevPreview(conv, origin)) {
        return undefined;
    }
    const scope: TranscriptPreviewProbeScope = { conversationId: conv.id, root: resolveThreadPreviewRoot(conv) };
    const hintedPort = findTranscriptPreviewPortHint(conv);
    let hintedPortDead = false;
    for (const port of transcriptPreviewProbePorts(conv)) {
        const probe = await probePort(port);
        if (port === hintedPort) {
            hintedPortDead = noteTranscriptPreviewHintProbe(conv, port, probe);
        }
        if (!probe.ready || !transcriptPreviewProbeBelongsToScope(probe, scope)) {
            continue;
        }
        // A server Qaap holds no claim for has no project identity. On a machine running several
        // projects a swept default port (3000, 5173…) is as likely another app as this one — it
        // adopted a sibling project's server as this project's preview and never started its own.
        // Adopt an unclaimed server only on the port this conversation named.
        if (!probe.previewId && port !== hintedPort) {
            continue;
        }
        if (hintedPortDead && hintedPort !== undefined && port !== hintedPort) {
            // The named port is dead and unclaimed while this conversation's claimed preview serves
            // on another port: the hint is stale, stop probing it first on every tick.
            retireTranscriptPreviewPortHint(conv, hintedPort);
        }
        return probe.previewUrl;
    }
    return undefined;
}

function conversationAgentFinishedTool(conv: QaapAgentConversationDTO): boolean {
    return latestAgentTraceSegments(conv).some(segment => segment.type === 'tool' && segment.finished);
}

/**
 * True when the default dev ports may be swept. Requires a positive signal: the user asked to
 * run/preview the app, or the current turn is running a dev server / shell or just finished a
 * tool. An idle conversation without such a signal never sweeps (it used to probe 8 ports on
 * every tick); when the agent named a port, only that hinted port is probed
 * (see {@link transcriptPreviewProbePorts}).
 */
export function conversationShouldProbeDefaultDevPreviewPorts(conv: QaapAgentConversationDTO): boolean {
    if (latestUserTurnRequestsDevPreview(conv)) {
        return true;
    }
    if (conv.status !== 'streaming') {
        return false;
    }
    if (conversationHasActiveDevServerRun(conv) || conversationHasActiveShellRun(conv)) {
        return true;
    }
    const latestMessage = conv.messages.at(-1);
    return latestMessage?.role === 'agent' && conversationAgentFinishedTool(conv);
}

/** Exponential delay after consecutive transcript preview probe misses, capped at 30 seconds. */
export function transcriptPreviewProbeBackoffMs(
    consecutiveMisses: number,
    baseDelayMs = 900,
    maxDelayMs = 30_000,
): number {
    const exponent = Math.max(0, Math.floor(consecutiveMisses));
    return Math.min(baseDelayMs * 2 ** exponent, maxDelayMs);
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
