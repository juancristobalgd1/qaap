// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Conversations held by other agent CLIs (their native logs on the backend's home directory) that the
 * Work Hub can import into a Qaap conversation. See `doc/qaap-external-session-import.md`.
 */
export const QAAP_EXTERNAL_SESSIONS_PATH = '/qaap/api/external-sessions';
export const QAAP_EXTERNAL_SESSIONS_IMPORT_PATH = `${QAAP_EXTERNAL_SESSIONS_PATH}/import`;

/** Agent CLIs whose sessions can be imported. Each id is also the Qaap harness id that resumes it. */
export type QaapExternalSessionSource = 'claude' | 'codex' | 'opencode' | 'pi';

export const QAAP_EXTERNAL_SESSION_SOURCES: readonly QaapExternalSessionSource[] = ['claude', 'codex', 'opencode', 'pi'];

/** Harnesses that can resume their own session natively (`claude --resume`, `codex exec resume`). */
export const QAAP_EXTERNAL_SESSION_NATIVE_RESUME_SOURCES: ReadonlySet<QaapExternalSessionSource> = new Set(['claude', 'codex']);

export function isQaapExternalSessionSource(value: unknown): value is QaapExternalSessionSource {
    return typeof value === 'string' && (QAAP_EXTERNAL_SESSION_SOURCES as readonly string[]).includes(value);
}

/** One importable session, as listed for a project. */
export interface QaapExternalSessionSummaryDTO {
    readonly source: QaapExternalSessionSource;
    readonly sessionId: string;
    readonly cwd: string;
    /** The CLI's own title when it keeps one, else empty. */
    readonly title: string;
    /** First real user message (trimmed, at most 280 chars). */
    readonly firstUserMessage: string;
    readonly startedAt: number;
    readonly updatedAt: number;
    /** Client that drove the CLI when the log says so (e.g. `T3 Code`). */
    readonly originator?: string;
    /** Set when this session was already imported: open that conversation instead of importing again. */
    readonly importedConversationId?: string;
}

export interface QaapExternalSessionListResponse {
    readonly sessions: readonly QaapExternalSessionSummaryDTO[];
}

export interface QaapExternalSessionImportRequest {
    readonly cwd: string;
    readonly source: QaapExternalSessionSource;
    readonly sessionId: string;
}

/** Stored on an imported conversation: where it came from and how much of it the CLI session holds. */
export interface QaapExternalSessionOrigin {
    readonly source: QaapExternalSessionSource;
    readonly sessionId: string;
    readonly importedAt: number;
    /** Messages copied at import; turns after this index were posted from Qaap. */
    readonly importedMessageCount: number;
    readonly originator?: string;
}
