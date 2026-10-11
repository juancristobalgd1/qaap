// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapProjectSessionSummary } from '@theia/qaap-adapters/lib/common/qaap-github-api-types';

type QaapProjectSessionActivityFields = Pick<QaapProjectSessionSummary, 'agentState' | 'lastTask' | 'tokens' | 'cost'>;

/**
 * Whether a project session write is new activity (a new task, an agent run, spent usage) and may
 * therefore move the project up the Work Hub list. Opening, previewing or bootstrapping a project only
 * touches branch / preview / bootstrap fields and must keep its `lastActiveAt`, so the list does not
 * reorder under the user's pointer.
 */
export function isQaapProjectSessionActivity(
    existing: QaapProjectSessionActivityFields | undefined,
    patch: QaapProjectSessionActivityFields,
): boolean {
    if (!existing) {
        return true;
    }
    return (patch.agentState !== undefined && patch.agentState !== existing.agentState)
        || (patch.lastTask !== undefined && patch.lastTask !== existing.lastTask)
        || (patch.tokens !== undefined && patch.tokens !== existing.tokens)
        || (patch.cost !== undefined && patch.cost !== existing.cost);
}
