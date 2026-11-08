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
    const level = readStoredEffort(cwd, agentId, modelId) ?? readStoredEffort(cwd, agentId, undefined);
    return level ?? support.defaultLevel;
}

function readStoredEffort(cwd: string | undefined, agentId: string, modelId: string | undefined): QaapAgentEffortLevel | undefined {
    let stored: string | undefined;
    try {
        stored = window.localStorage.getItem(scopedComposerEffortStorageKey(cwd, agentId, modelId)) ?? undefined;
    } catch {
        stored = undefined;
    }
    return stored ? QaapAgentEffort.normalize(agentId, modelId, stored) : undefined;
}

/**
 * Gives a model the effort picked for its harness before any model was chosen (the pending value),
 * unless the model already has its own. Called when the user picks a model of that harness.
 */
export function adoptPendingComposerEffort(cwd: string | undefined, agentId: string, modelId: string): void {
    if (readStoredEffort(cwd, agentId, modelId)) {
        return;
    }
    const pending = readStoredEffort(cwd, agentId, undefined);
    if (pending) {
        writeComposerEffortLevel(cwd, agentId, modelId, pending);
    }
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
