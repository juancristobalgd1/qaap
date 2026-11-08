// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { hashString } from '@theia/qaap-shared-core/lib/common/qaap-agent-task-client';
import {
    QaapAgentEffort,
    type QaapAgentEffortLevel,
} from '@theia/qaap-shared-core/lib/common/qaap-agent-effort';

const COMPOSER_EFFORT_STORAGE_KEY = 'qaap.composer.effort';

/** Storage key of the effort picked for one project, harness and model. */
export function scopedComposerEffortStorageKey(cwd: string | undefined, agentId: string, modelId: string | undefined): string {
    return `${COMPOSER_EFFORT_STORAGE_KEY}.${hashString(`${cwd ?? ''}|${agentId}|${modelId ?? ''}`)}`;
}

/**
 * Effort the composer shows and sends: the stored pick when the harness and model still support it,
 * otherwise the harness default. `undefined` when the harness or model takes no effort setting.
 */
export function resolveComposerEffortLevel(
    cwd: string | undefined,
    agentId: string,
    modelId: string | undefined,
): QaapAgentEffortLevel | undefined {
    const support = QaapAgentEffort.support(agentId, modelId);
    if (!support) {
        return undefined;
    }
    let stored: string | undefined;
    try {
        stored = window.localStorage.getItem(scopedComposerEffortStorageKey(cwd, agentId, modelId)) ?? undefined;
    } catch {
        stored = undefined;
    }
    const level = stored ? QaapAgentEffort.normalize(agentId, modelId, stored) : undefined;
    return level ?? support.defaultLevel;
}

/** Remembers the effort picked for one project, harness and model (session-only if storage is blocked). */
export function writeComposerEffortLevel(
    cwd: string | undefined,
    agentId: string,
    modelId: string | undefined,
    level: QaapAgentEffortLevel,
): void {
    try {
        window.localStorage.setItem(scopedComposerEffortStorageKey(cwd, agentId, modelId), level);
    } catch {
        /* session-only */
    }
}
