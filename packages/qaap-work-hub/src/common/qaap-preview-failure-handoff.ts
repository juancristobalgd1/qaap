// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Preview failures the project itself causes, so the agent can fix them in code: a compile or CSS error, a broken
 * config, a dev command that exits. Host problems (port taken, out of memory, permissions, runtime, a stale Next lock)
 * and missing dependencies (Qaap installs those) are never handed to the agent.
 */
export const QAAP_AGENT_FIXABLE_PREVIEW_FAILURES: ReadonlySet<string> = new Set(['build-failed', 'configuration', 'process-exit', 'unknown']);

/** At most this many hand-offs per conversation inside {@link QAAP_PREVIEW_HANDOFF_WINDOW_MS}, so a fix loop stops. */
export const QAAP_PREVIEW_HANDOFF_MAX_PER_WINDOW = 2;
export const QAAP_PREVIEW_HANDOFF_WINDOW_MS = 15 * 60_000;

/** Lines of the dev output quoted to the agent. */
const REPORT_OUTPUT_LINES = 40;

/** The preview failure as the bootstrap service reports it. */
export interface QaapPreviewFailureState {
    readonly phase: string;
    readonly failureKind?: string;
    readonly error?: string;
    readonly previewLogTail?: string;
    readonly previewRunId?: string;
    readonly devCommand?: string;
    /** Filesystem path of the project the preview ran for. */
    readonly projectPath?: string;
}

/** The conversation open next to the preview. */
export interface QaapPreviewFailureConversation {
    readonly id: string;
    readonly cwd: string;
    readonly status: string;
    readonly source?: string;
    /** Source clone of a task worktree; a preview of the source belongs to its worktree chats too. */
    readonly parallelBaseCwd?: string;
}

/** What has already been handed off: run keys, and the hand-off times per conversation. */
export interface QaapPreviewHandoffHistory {
    readonly sentRunKeys: Set<string>;
    readonly sentAtByConversation: Map<string, number[]>;
}

export function createQaapPreviewHandoffHistory(): QaapPreviewHandoffHistory {
    return { sentRunKeys: new Set(), sentAtByConversation: new Map() };
}

const normalizePath = (value: string | undefined): string => (value ?? '').trim().replace(/\/+$/, '').toLowerCase();

/**
 * Decides whether a preview failure goes to the open conversation's agent so it can continue the task and fix the
 * app. Returns the run key to record, or `undefined` when nothing is sent.
 */
export function decideQaapPreviewFailureHandoff(
    state: QaapPreviewFailureState,
    conversation: QaapPreviewFailureConversation | undefined,
    history: QaapPreviewHandoffHistory,
    now: number,
): string | undefined {
    if (state.phase !== 'run-failed' || !QAAP_AGENT_FIXABLE_PREVIEW_FAILURES.has(state.failureKind ?? 'unknown')) {
        return undefined;
    }
    if (!conversation || conversation.source === 'theia-chat' || conversation.status === 'streaming') {
        return undefined;
    }
    const projectPath = normalizePath(state.projectPath);
    if (!projectPath || (normalizePath(conversation.cwd) !== projectPath && normalizePath(conversation.parallelBaseCwd) !== projectPath)) {
        return undefined;
    }
    if (!state.error?.trim() && !state.previewLogTail?.trim()) {
        return undefined;
    }
    const runKey = `${conversation.id}\u0000${state.previewRunId ?? state.error ?? ''}`;
    if (history.sentRunKeys.has(runKey)) {
        return undefined;
    }
    const recent = (history.sentAtByConversation.get(conversation.id) ?? []).filter(at => now - at < QAAP_PREVIEW_HANDOFF_WINDOW_MS);
    if (recent.length >= QAAP_PREVIEW_HANDOFF_MAX_PER_WINDOW) {
        return undefined;
    }
    return runKey;
}

/** Records a hand-off decided by {@link decideQaapPreviewFailureHandoff}. */
export function recordQaapPreviewFailureHandoff(history: QaapPreviewHandoffHistory, conversationId: string, runKey: string, now: number): void {
    history.sentRunKeys.add(runKey);
    const recent = (history.sentAtByConversation.get(conversationId) ?? []).filter(at => now - at < QAAP_PREVIEW_HANDOFF_WINDOW_MS);
    history.sentAtByConversation.set(conversationId, [...recent, now]);
}

/** The follow-up the agent receives: what failed, the dev output, and what to do. */
export function buildQaapPreviewFailureReport(
    state: QaapPreviewFailureState,
    options: { readonly agentDriven?: boolean } = {},
): string {
    const output = (state.previewLogTail ?? '').trimEnd().split('\n').slice(-REPORT_OUTPUT_LINES).join('\n').trim();
    const command = state.devCommand?.trim();
    const guidance = options.agentDriven
        ? 'Find the cause in the project, fix it, and call preview_start to verify the app answers HTTP 200.'
        : 'Find the cause in the project and fix it so the dev server starts and serves the app. '
            + 'You may run a build or type check to confirm the fix, but do not leave a dev server running: Qaap runs the preview.';
    return [
        'The app failed to start in the Qaap preview' + (command ? ` (\`${command}\`).` : '.'),
        '',
        state.error?.trim() ?? '',
        ...(output ? ['', 'Dev server output:', '```', output, '```'] : []),
        '',
        guidance,
    ].join('\n').replace(/\n{3,}/g, '\n\n');
}
