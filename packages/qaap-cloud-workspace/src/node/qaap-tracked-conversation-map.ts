// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapAgentConversation } from '../common/qaap-agent-conversation';

/**
 * Row writes that are still waiting for the database. `upserts` carry the current object for each
 * dirty id; `deletes` lists ids removed from the map since the last acknowledged write.
 */
export interface QaapConversationPendingWrites {
    readonly upserts: ReadonlyArray<readonly [id: string, conversation: QaapAgentConversation]>;
    readonly deletes: readonly string[];
}

/**
 * The live `conversations` map of the agent conversation store.
 *
 * Every mutation through `set`, `delete` or `clear` records the affected id, so persistence writes
 * only the rows that changed: `pendingWrites()` lists them and `acknowledge()` forgets them once the
 * database accepted the batch. A failed write leaves them pending, so the next persist retries them.
 *
 * The map cannot see an in-place change of a conversation object, which is why the map also tracks
 * two things for it: the hash of each persisted row, and the ids handed out by `get` since the last
 * check. Code that changes an object must have got it from `get` or from iterating the map, so
 * comparing the hash of the recently read ids at each persist catches the first case within one
 * persist, and the bounded periodic sweep catches the second. Both log the id, because the
 * invariant is that conversations are immutable values and such a change is a bug to fix.
 *
 * `load` inserts without tracking and is meant for restoring rows that are already persisted.
 */
export class QaapTrackedConversationMap extends Map<string, QaapAgentConversation> {

    protected readonly dirtyIds = new Set<string>();
    protected readonly deletedIds = new Set<string>();
    protected readonly readIds = new Set<string>();
    protected readonly persistedHashes = new Map<string, string>();

    /**
     * Returns the conversation and remembers that a caller holds it.
     *
     * @param id conversation id.
     * @returns the conversation, if any.
     */
    override get(id: string): QaapAgentConversation | undefined {
        const conversation = super.get(id);
        if (conversation !== undefined) {
            this.readIds.add(id);
        }
        return conversation;
    }

    /**
     * Same as `get` for persistence code, which only reads and must not count as a caller.
     *
     * @param id conversation id.
     * @returns the conversation, if any.
     */
    peek(id: string): QaapAgentConversation | undefined {
        return super.get(id);
    }

    /**
     * Stores the conversation and marks its row dirty.
     *
     * @param id conversation id.
     * @param conversation the conversation value to store.
     * @returns this map, as `Map.prototype.set` does.
     */
    override set(id: string, conversation: QaapAgentConversation): this {
        super.set(id, conversation);
        this.dirtyIds.add(id);
        // The caller still holds `conversation`; an in-place change after the write is caught by the
        // next persist's read check instead of waiting for the full sweep.
        this.readIds.add(id);
        this.deletedIds.delete(id);
        return this;
    }

    /**
     * Removes the conversation and records its row for deletion.
     *
     * @param id conversation id.
     * @returns whether the id was present.
     */
    override delete(id: string): boolean {
        const existed = super.delete(id);
        this.dirtyIds.delete(id);
        this.readIds.delete(id);
        this.persistedHashes.delete(id);
        this.deletedIds.add(id);
        return existed;
    }

    /** Removes every conversation and records each of their rows for deletion. */
    override clear(): void {
        for (const id of this.keys()) {
            this.deletedIds.add(id);
        }
        this.dirtyIds.clear();
        this.readIds.clear();
        this.persistedHashes.clear();
        super.clear();
    }

    /**
     * Inserts a conversation that is already persisted, without marking its row dirty.
     *
     * @param id conversation id.
     * @param conversation the restored conversation value.
     * @param persistedHash hash of the stored row.
     */
    load(id: string, conversation: QaapAgentConversation, persistedHash: string): void {
        super.set(id, conversation);
        this.persistedHashes.set(id, persistedHash);
    }

    /**
     * Marks a conversation dirty after it was changed by a step that bypassed `set`.
     *
     * @param id conversation id; ignored when the id is not present.
     */
    markDirty(id: string): void {
        if (this.has(id)) {
            this.dirtyIds.add(id);
        }
    }

    /**
     * Lists the writes that have not been acknowledged yet. The returned arrays are snapshots.
     *
     * @returns the dirty conversations with their current values, and the ids to delete.
     */
    pendingWrites(): QaapConversationPendingWrites {
        const upserts: Array<readonly [string, QaapAgentConversation]> = [];
        for (const id of this.dirtyIds) {
            const conversation = super.get(id);
            if (conversation !== undefined) {
                upserts.push([id, conversation]);
            }
        }
        return { upserts, deletes: [...this.deletedIds] };
    }

    /**
     * Forgets writes that the database has accepted. Call it only after the write succeeded.
     *
     * @param writes the writes that were committed, as returned by {@link pendingWrites}.
     */
    acknowledge(writes: QaapConversationPendingWrites): void {
        for (const [id] of writes.upserts) {
            // `readIds` is kept: a caller may still hold the object it just wrote and change it in
            // place, so the next persist checks it once more (see `readSinceLastCheck`).
            this.dirtyIds.delete(id);
        }
        for (const id of writes.deletes) {
            this.deletedIds.delete(id);
        }
    }

    /**
     * Ids handed out by `get` since they were last checked, without the dirty ones, which are written
     * anyway. A snapshot; the ids stay listed until {@link forgetRead}.
     *
     * @returns the ids, oldest read first.
     */
    readSinceLastCheck(): string[] {
        return [...this.readIds].filter(id => !this.dirtyIds.has(id));
    }

    /**
     * Forgets a read id once its row was compared.
     *
     * @param id conversation id.
     */
    forgetRead(id: string): void {
        this.readIds.delete(id);
    }

    /**
     * The hash of the row as it was last persisted.
     *
     * @param id conversation id.
     * @returns the hash, or `undefined` when the row was never persisted.
     */
    persistedHash(id: string): string | undefined {
        return this.persistedHashes.get(id);
    }

    /**
     * Records the hash of a row that was just persisted or found unchanged.
     *
     * @param id conversation id.
     * @param hash the hash of the row.
     */
    recordPersistedHash(id: string, hash: string): void {
        if (this.has(id)) {
            this.persistedHashes.set(id, hash);
        }
    }

    /** Whether any row write is pending. */
    hasPendingWrites(): boolean {
        return this.dirtyIds.size > 0 || this.deletedIds.size > 0;
    }
}
