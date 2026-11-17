// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { QaapUserFacingErrors } from '@theia/qaap-adapters/lib/common/qaap-user-facing-error';
import type { QaapAgentConversationDTO } from './qaap-agent-conversation-client';
import {
    QAAP_EXTERNAL_SESSIONS_IMPORT_PATH,
    QAAP_EXTERNAL_SESSIONS_PATH,
    type QaapExternalSessionImportRequest,
    type QaapExternalSessionListResponse,
    type QaapExternalSessionSummaryDTO,
} from './qaap-external-session-protocol';

/** Work Hub side of `doc/qaap-external-session-import.md`: list a project's sessions in other CLIs and import one. */
export class QaapExternalSessionClient {

    async list(cwd: string): Promise<readonly QaapExternalSessionSummaryDTO[]> {
        const response = await fetch(`${QAAP_EXTERNAL_SESSIONS_PATH}?cwd=${encodeURIComponent(cwd)}`, { credentials: 'include' });
        if (!response.ok) {
            throw await QaapUserFacingErrors.fromResponse(response);
        }
        const body = await response.json() as Partial<QaapExternalSessionListResponse>;
        return Array.isArray(body.sessions) ? body.sessions : [];
    }

    /** Imports the session (or returns the conversation it was already imported into). */
    async import(request: QaapExternalSessionImportRequest): Promise<QaapAgentConversationDTO> {
        const response = await fetch(QAAP_EXTERNAL_SESSIONS_IMPORT_PATH, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(request),
        });
        if (!response.ok) {
            throw await QaapUserFacingErrors.fromResponse(response);
        }
        return await response.json() as QaapAgentConversationDTO;
    }
}
