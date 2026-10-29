// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { QaapUserFacingErrors } from '@theia/qaap-adapters/lib/common/qaap-user-facing-error';

/**
 * `GET ?cwd=` reads the signed-in user's trust decision for one project folder; `PUT` with `{ cwd, trusted }`
 * records it. The server answers with {@link QaapProjectFolderTrustStatus}.
 */
export const QAAP_PROJECT_FOLDER_TRUST_API_PATH = '/qaap/api/project-trust';

/** Template variable filled per task from the project's trust decision (see {@link resolveAgentProjectTrustFlags}). */
export const QAAP_PROJECT_TRUST_FLAGS_TEMPLATE_VAR = 'trust_flags';

/** Trust decision for one project folder of the signed-in user. Missing decision = not trusted. */
export interface QaapProjectFolderTrustStatus {
    readonly cwd: string;
    /** False until the user answered the "Do you trust the files in this folder?" dialog. */
    readonly decided: boolean;
    readonly trusted: boolean;
    readonly decidedAt?: string;
}

/**
 * Per-harness CLI flags for the project-trust decision, filled into `{trust_flags}`.
 * Only Pi is mapped so far: its `--approve` makes it load the repository's own `.pi/` settings, MCP
 * servers and extensions without asking, so an untrusted folder gets `--no-approve`. Every other
 * harness returns `''` until its own trust switch is mapped here; add the case when it is verified.
 */
export function resolveAgentProjectTrustFlags(agentId: string | undefined, trusted: boolean): string {
    switch (agentId?.trim().toLowerCase()) {
        case 'pi':
            return trusted ? '--approve' : '--no-approve';
        default:
            return '';
    }
}

/**
 * Whether the "Do you trust the files in this folder?" dialog should open for a project. Asked only when the
 * status is known and undecided, and not already asked during this page session. A failed status read
 * (`undefined`) never opens the dialog.
 */
export function shouldAskProjectFolderTrust(status: Pick<QaapProjectFolderTrustStatus, 'decided'> | undefined, askedThisSession: boolean): boolean {
    return !!status && !status.decided && !askedThisSession;
}

/**
 * Browser-side view of the project trust decisions. Results are cached per folder; a failed read leaves
 * the cache empty so the caller treats the folder as untrusted.
 */
export class QaapProjectFolderTrustClient {

    protected readonly statuses = new Map<string, QaapProjectFolderTrustStatus>();

    /** Last known decision for `cwd`, when it was read or set during this page session. */
    cached(cwd: string): QaapProjectFolderTrustStatus | undefined {
        return this.statuses.get(cwd);
    }

    async load(cwd: string): Promise<QaapProjectFolderTrustStatus | undefined> {
        try {
            const response = await fetch(`${QAAP_PROJECT_FOLDER_TRUST_API_PATH}?cwd=${encodeURIComponent(cwd)}`, { credentials: 'include' });
            if (!response.ok) {
                return undefined;
            }
            const status = await response.json() as QaapProjectFolderTrustStatus;
            this.statuses.set(cwd, status);
            return status;
        } catch {
            return undefined;
        }
    }

    async setTrusted(cwd: string, trusted: boolean): Promise<QaapProjectFolderTrustStatus> {
        const response = await fetch(QAAP_PROJECT_FOLDER_TRUST_API_PATH, {
            method: 'PUT',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cwd, trusted }),
        });
        if (!response.ok) {
            throw await QaapUserFacingErrors.fromResponse(response);
        }
        const status = await response.json() as QaapProjectFolderTrustStatus;
        this.statuses.set(cwd, status);
        return status;
    }
}
