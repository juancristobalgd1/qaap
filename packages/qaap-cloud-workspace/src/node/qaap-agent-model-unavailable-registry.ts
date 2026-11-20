// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/** How long a `model_unavailable` finding keeps a model marked in the picker. */
export const QAAP_AGENT_MODEL_UNAVAILABLE_TTL_MS = 6 * 60 * 60 * 1000;

/** Upper bound on remembered findings; the oldest finding is dropped first. */
export const QAAP_AGENT_MODEL_UNAVAILABLE_MAX_ENTRIES = 500;

/**
 * In-memory memory of models a provider rejected for an owner: the CLI can list a model that the
 * owner's account cannot run, and a failed turn is the only signal. Entries expire after the TTL and
 * the map is bounded, so a restart simply forgets them. Owner, agent and model are compared
 * trimmed and case-insensitively.
 */
export class QaapAgentModelUnavailableRegistry {

    /** Clock seam: tests replace it to exercise the TTL without waiting. */
    protected now: () => number = () => Date.now();

    /** Insertion order is recency order: a re-recorded key moves to the end. */
    protected readonly recordedAt = new Map<string, number>();

    /** Remember that `modelId` failed with `model_unavailable` for this owner and agent. */
    record(ownerLogin: string | undefined, agentId: string, modelId: string): void {
        const key = this.keyOf(ownerLogin, agentId, modelId);
        if (!key) {
            return;
        }
        this.recordedAt.delete(key);
        this.recordedAt.set(key, this.now());
        while (this.recordedAt.size > QAAP_AGENT_MODEL_UNAVAILABLE_MAX_ENTRIES) {
            const oldest = this.recordedAt.keys().next();
            if (oldest.done) {
                break;
            }
            this.recordedAt.delete(oldest.value);
        }
    }

    /** Forget every finding (tests and operator resets). */
    clear(): void {
        this.recordedAt.clear();
    }

    /** `true` while a non-expired finding exists for this owner, agent and model. */
    isUnavailable(ownerLogin: string | undefined, agentId: string, modelId: string): boolean {
        const key = this.keyOf(ownerLogin, agentId, modelId);
        if (!key) {
            return false;
        }
        const recordedAt = this.recordedAt.get(key);
        if (recordedAt === undefined) {
            return false;
        }
        if (this.now() - recordedAt >= QAAP_AGENT_MODEL_UNAVAILABLE_TTL_MS) {
            this.recordedAt.delete(key);
            return false;
        }
        return true;
    }

    protected keyOf(ownerLogin: string | undefined, agentId: string, modelId: string): string | undefined {
        const agent = agentId.trim().toLowerCase();
        const model = modelId.trim().toLowerCase();
        if (!agent || !model) {
            return undefined;
        }
        return [(ownerLogin ?? '').trim().toLowerCase(), agent, model].join('\u0000');
    }
}

/** Process-wide registry shared by the turn settle path (writes) and the model catalog (reads). */
export const sharedQaapAgentModelUnavailableRegistry = new QaapAgentModelUnavailableRegistry();
