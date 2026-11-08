// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

// Row-per-conversation persistence for the agent conversation store.
//
// Layout: namespace `agent-conversations.v2` holds one row per conversation (`conv:<id>`) plus the
// worktree ordinal high-water mark (`meta:worktreeOrdinalHighWater`). The legacy namespace
// `agent-conversations` keeps the single aggregate row that earlier builds read and write. This code
// never writes it. Once the v2 migration is recorded, v2 is the source of truth, and the legacy row
// is only read again if its stamp (`updated_at` + byte length) differs from the one recorded at the
// last sync (`meta:legacyObserved`), which means an earlier build ran
// (rollback) or `scripts/qaap-conversations-v2-to-legacy.js` rebuilt it: see
// {@link syncConversationRowsWithLegacy} and doc/qaap-sqlite-persistence.md.

import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { QaapSqliteRawEntry, QaapSqliteRowStamp, QaapSqliteStore } from '@theia/qaap-persistence/lib/node/qaap-sqlite-store';
import type { QaapAgentConversation, QaapAgentMessage } from '../common/qaap-agent-conversation';
import type { QaapAgentConversationStoreContext } from './qaap-agent-conversation-store-context';
import type { QaapPersistWriteStats } from './qaap-agent-conversation-persist-policy';
import { forEachLegacyAggregateElement } from './qaap-conversation-legacy-aggregate';
import { QAAP_WORKTREE_ORDINAL_HIGH_WATER_KEY } from './qaap-worktree-ordinal-allocator';

/** Namespace of the legacy one-row-per-file aggregate. Never written by this code. */
export const QAAP_CONVERSATION_LEGACY_NAMESPACE = 'agent-conversations';
/** Namespace of the row-per-conversation layout. */
export const QAAP_CONVERSATION_ROWS_NAMESPACE = 'agent-conversations.v2';
/** Key of the high-water mark in the v2 namespace. */
export const QAAP_CONVERSATION_HIGH_WATER_ROW_KEY = `meta:${QAAP_WORKTREE_ORDINAL_HIGH_WATER_KEY}`;
/**
 * Key of the v2 row that records the legacy row as it was last read (`updated_at` and byte length).
 * A different stamp means another build wrote the legacy row; comparing stamps instead of clocks
 * also catches a writer whose clock is behind.
 */
export const QAAP_CONVERSATION_LEGACY_OBSERVED_ROW_KEY = 'meta:legacyObserved';
/** Default interval of the sweep that looks for rows changed without `set`. */
export const QAAP_CONVERSATION_FULL_SWEEP_MS = 10 * 60 * 1000;
/** Default limit of serialized characters one sweep run looks at; the next run continues from there. */
export const QAAP_CONVERSATION_SWEEP_MAX_CHARS = 64 * 1024 * 1024;
/** Serialized characters per transaction and between yields to the event loop. */
export const QAAP_CONVERSATION_ROW_BATCH_CHARS = 8 * 1024 * 1024;
/** Limit of characters one persist serializes to compare rows that were read since the last one. */
export const QAAP_CONVERSATION_READ_CHECK_MAX_CHARS = 16 * 1024 * 1024;
/**
 * Time the shutdown flush may take. The backend gives all `onStop` hooks 5 s together
 * (`SHUTDOWN_TIMEOUT_MS` in `backend-application.ts`) and they run on one thread.
 */
export const QAAP_CONVERSATION_STOP_BUDGET_MS = 3000;
/** Free space kept on top of the data during the migration. */
const MIGRATION_FREE_SPACE_MARGIN_BYTES = 64 * 1024 * 1024;
/** Rows per read while loading. */
const LOAD_PAGE_ROWS = 100;

const LEGACY_CONVERSATIONS_KEY = 'conversations';
const CONVERSATION_ROW_PREFIX = 'conv:';

/** The migration was refused or failed; conversations stay unavailable until this is fixed. */
export class QaapConversationMigrationError extends Error { }

/** Test seam and progress hook of {@link syncConversationRowsWithLegacy}. */
export interface QaapConversationLegacySyncOptions {
    /** Free bytes on the volume of the database; defaults to `fs.statfsSync`. */
    readonly freeBytes?: () => number;
    /** Called inside the transaction after each conversation of the legacy row. */
    readonly onConversation?: (index: number) => void;
    /** Characters per read of the legacy row. */
    readonly chunkChars?: number;
}

/** What {@link syncConversationRowsWithLegacy} did. */
export interface QaapConversationLegacySyncResult {
    readonly kind: 'none' | 'imported' | 'merged';
    readonly conversations: number;
    readonly written: number;
    readonly durationMs: number;
    readonly walTruncated?: boolean;
}

/**
 * Resolves a positive integer setting from the environment.
 *
 * @param raw the raw environment value, if any.
 * @param fallback the value to use when `raw` is not a positive integer.
 * @returns the setting.
 */
export function resolveQaapConversationSetting(raw: string | undefined, fallback: number): number {
    const parsed = Number.parseInt(raw?.trim() ?? '', 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Key of the v2 row that holds one conversation.
 *
 * @param id conversation id.
 * @returns the row key.
 */
export function conversationRowKey(id: string): string {
    return `${CONVERSATION_ROW_PREFIX}${id}`;
}

/**
 * Hash of a serialized row, used only to detect a change.
 *
 * @param json the serialized row.
 * @returns the hash.
 */
export function hashConversationRow(json: string): string {
    return createHash('sha1').update(json).digest('base64');
}

/**
 * Brings the v2 namespace up to date with the legacy aggregate. It runs once for the first import,
 * and again only when the legacy row changed since the last sync: its `updated_at` and byte length
 * against {@link QAAP_CONVERSATION_LEGACY_OBSERVED_ROW_KEY}. Everything, stamp and mark included,
 * commits in one transaction, so a crash leaves the previous state and the next start repeats it.
 *
 * Merge rule per conversation: the one with the later `updatedAt` wins, and messages only the other
 * copy has are kept. A conversation missing from v2 is taken from legacy on the first import, when
 * the legacy row did not hold it at the previous sync, or when it changed after the mark; otherwise
 * v2 deleted it. A legacy conversation whose hash equals the one recorded at the previous sync is
 * skipped: an earlier build rewrites the whole aggregate, and only what it changed is merged. A conversation missing from legacy stays
 * in v2, so one deleted during a rollback comes back: deleting on a guess is worse.
 *
 * The legacy row is read in chunks and is never modified.
 *
 * @param legacy the store for the legacy namespace.
 * @param rows the store for the v2 namespace.
 * @param options test seams.
 * @returns what was done.
 * @throws QaapConversationMigrationError when the volume does not have room for the first import.
 */
export function syncConversationRowsWithLegacy(
    legacy: QaapSqliteStore,
    rows: QaapSqliteStore,
    options: QaapConversationLegacySyncOptions = {},
): QaapConversationLegacySyncResult {
    const startedAt = Date.now();
    const migration = rows.getMigration();
    const legacyStamp = legacy.getRowStamp(LEGACY_CONVERSATIONS_KEY);
    const legacyUpdatedAt = legacyStamp?.updatedAt;
    if (migration && (legacyStamp === undefined || isSameLegacyStamp(legacyStamp, rows.get<unknown>(QAAP_CONVERSATION_LEGACY_OBSERVED_ROW_KEY)))) {
        return { kind: 'none', conversations: 0, written: 0, durationMs: Date.now() - startedAt };
    }
    if (!migration && legacyStamp !== undefined) {
        assertRoomForConversationImport(rows, options);
    }
    let conversations = 0;
    let written = 0;
    rows.withTransaction(() => {
        const resurrectAfter = migration?.migratedAt;
        const knownHashes = readLegacyObservedHashes(rows.get<unknown>(QAAP_CONVERSATION_LEGACY_OBSERVED_ROW_KEY));
        const seenHashes: Record<string, string> = {};
        forEachLegacyAggregateElement(legacy, LEGACY_CONVERSATIONS_KEY, raw => {
            const incoming = parseLegacyConversation(raw);
            const hash = hashConversationRow(raw);
            seenHashes[incoming.id] = hash;
            // An earlier build rewrites the whole aggregate; only the conversations it changed count.
            // Merging an unchanged stale copy would bring back messages v2 removed (a retried turn).
            const unchanged = knownHashes?.get(incoming.id) === hash;
            const key = conversationRowKey(incoming.id);
            const merged = unchanged ? undefined : mergeLegacyConversation(raw, incoming, rows.getRaw(key), { resurrectAfter, knownIds: knownHashes });
            if (merged !== undefined) {
                rows.applyRawBatch([[key, merged]], []);
                written++;
            }
            options.onConversation?.(conversations++);
        }, options.chunkChars);
        const highWater = mergeHighWater(legacy.get<unknown>(QAAP_WORKTREE_ORDINAL_HIGH_WATER_KEY), rows.get<unknown>(QAAP_CONVERSATION_HIGH_WATER_ROW_KEY));
        if (highWater !== undefined) {
            rows.applyRawBatch([[QAAP_CONVERSATION_HIGH_WATER_ROW_KEY, JSON.stringify(highWater)]], []);
        }
        if (legacyStamp !== undefined) {
            const observed: QaapConversationLegacyObservation = { updatedAt: legacyStamp.updatedAt, bytes: legacyStamp.bytes, hashes: seenHashes };
            rows.applyRawBatch([[QAAP_CONVERSATION_LEGACY_OBSERVED_ROW_KEY, JSON.stringify(observed)]], []);
        }
        if (migration) {
            rows.touchMigration(Math.max(Date.now(), legacyUpdatedAt ?? 0));
        } else {
            rows.recordMigration(QAAP_CONVERSATION_LEGACY_NAMESPACE);
        }
    });
    // The import doubled the data in the WAL; do not leave a file that large behind.
    const walTruncated = written > 0 ? rows.checkpointAndTruncateWal() : undefined;
    return { kind: migration ? 'merged' : 'imported', conversations, written, durationMs: Date.now() - startedAt, walTruncated };
}

/**
 * Whether the legacy row is the one recorded at the last sync. A database migrated before the stamp
 * was recorded has none, so its legacy row counts as changed once; the merge is idempotent.
 */
function isSameLegacyStamp(current: QaapSqliteRowStamp, recorded: unknown): boolean {
    const stamp = recorded as Partial<QaapSqliteRowStamp> | undefined;
    return stamp?.updatedAt === current.updatedAt && stamp?.bytes === current.bytes;
}

function assertRoomForConversationImport(rows: QaapSqliteStore, options: QaapConversationLegacySyncOptions): void {
    // The rows are as large as the legacy row: first in the WAL, then in the database file as well
    // until the WAL is truncated. The legacy row stays. `usedBytes` is an upper bound of its size.
    const required = rows.usedBytes() * 2 + MIGRATION_FREE_SPACE_MARGIN_BYTES;
    const free = options.freeBytes?.() ?? readFreeBytes(rows);
    if (free < required) {
        throw new QaapConversationMigrationError(
            `Not enough free disk space to migrate the conversation store: ${Math.ceil(required / 1048576)} MiB needed, `
            + `${Math.floor(free / 1048576)} MiB free. Nothing was changed. Free up space and restart the backend.`,
        );
    }
}

function readFreeBytes(rows: QaapSqliteStore): number {
    const stats = fs.statfsSync(path.dirname(rows.path));
    return Number(stats.bavail) * Number(stats.bsize);
}

function parseLegacyConversation(raw: string): QaapAgentConversation {
    const conversation = JSON.parse(raw) as QaapAgentConversation;
    if (typeof conversation?.id !== 'string' || conversation.id.length === 0) {
        throw new QaapConversationMigrationError('The legacy conversation row holds an entry without an id.');
    }
    return conversation;
}

/** What {@link QAAP_CONVERSATION_LEGACY_OBSERVED_ROW_KEY} holds. */
interface QaapConversationLegacyObservation extends QaapSqliteRowStamp {
    /** Hash of each conversation the legacy row held at that sync, by id. */
    readonly hashes: Readonly<Record<string, string>>;
}

function readLegacyObservedHashes(recorded: unknown): ReadonlyMap<string, string> | undefined {
    const hashes = (recorded as Partial<QaapConversationLegacyObservation> | undefined)?.hashes;
    if (hashes === undefined || hashes === null || typeof hashes !== 'object') {
        return undefined;
    }
    return new Map(Object.entries(hashes).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
}

interface QaapConversationMergeContext {
    /** Mark of the previous sync; `undefined` on the first import. */
    readonly resurrectAfter: number | undefined;
    /** Conversations the legacy row held at the previous sync (id to hash), when recorded. */
    readonly knownIds: ReadonlyMap<string, string> | undefined;
}

function mergeLegacyConversation(raw: string, incoming: QaapAgentConversation, existingRaw: string | undefined, merge: QaapConversationMergeContext): string | undefined {
    if (existingRaw === undefined) {
        // Missing from v2: on the first import take it; afterwards take it when the legacy row did
        // not have it at the previous sync (created during the rollback, whatever its clock said),
        // or when it changed after the mark. Otherwise v2 deleted it.
        if (merge.resurrectAfter === undefined || (merge.knownIds !== undefined && !merge.knownIds.has(incoming.id))) {
            return raw;
        }
        return (incoming.updatedAt ?? 0) > merge.resurrectAfter ? raw : undefined;
    }
    const existing = JSON.parse(existingRaw) as QaapAgentConversation;
    const incomingWins = (incoming.updatedAt ?? 0) > (existing.updatedAt ?? 0);
    const winner = incomingWins ? incoming : existing;
    const loser = incomingWins ? existing : incoming;
    const known = new Set(winner.messages.map(message => message.id));
    const missing = loser.messages.filter(message => !known.has(message.id));
    if (missing.length === 0) {
        return incomingWins ? raw : undefined;
    }
    const messages: QaapAgentMessage[] = [...winner.messages, ...missing]
        .map((message, index) => ({ message, index }))
        .sort((a, b) => ((a.message.createdAt ?? 0) - (b.message.createdAt ?? 0)) || a.index - b.index)
        .map(({ message }) => message);
    return JSON.stringify({ ...winner, messages });
}

function mergeHighWater(legacy: unknown, current: unknown): Record<string, number> | undefined {
    if (legacy === undefined) {
        return undefined;
    }
    const merged: Record<string, number> = { ...(current as Record<string, number> | undefined) };
    for (const [key, value] of Object.entries(legacy as Record<string, number>)) {
        merged[key] = Math.max(value, merged[key] ?? 0);
    }
    return merged;
}

/** One stored conversation with the hash of its row. */
export interface QaapLoadedConversationRow {
    readonly conversation: QaapAgentConversation;
    readonly hash: string;
}

/**
 * Reads every conversation row, ordered by creation time so the in-memory map keeps the order the
 * legacy aggregate had.
 *
 * @param rows the store for the v2 namespace.
 * @returns the conversations, oldest first.
 */
export function loadConversationRows(rows: QaapSqliteStore): QaapLoadedConversationRow[] {
    const loaded: QaapLoadedConversationRow[] = [];
    let afterKey: string | undefined;
    for (;;) {
        const page = rows.listRawPage(CONVERSATION_ROW_PREFIX, afterKey, LOAD_PAGE_ROWS);
        for (const [, json] of page) {
            loaded.push({ conversation: JSON.parse(json) as QaapAgentConversation, hash: hashConversationRow(json) });
        }
        if (page.length < LOAD_PAGE_ROWS) {
            break;
        }
        afterKey = page[page.length - 1][0];
    }
    return loaded.sort((a, b) => (a.conversation.createdAt ?? a.conversation.updatedAt) - (b.conversation.createdAt ?? b.conversation.updatedAt));
}

/**
 * Writes the pending changes of the conversation map and of the high-water mark in one transaction,
 * after comparing the rows that were read since the last persist, up to a limit. It does nothing
 * when nothing changed. Pending state is acknowledged only after the write succeeded; on failure it
 * stays pending and the error propagates.
 *
 * @param ctx the conversation store context.
 */
export function writePendingConversationRows(ctx: QaapAgentConversationStoreContext): QaapPersistWriteStats | undefined {
    const startedAt = performance.now();
    const map = ctx.conversations;
    const writes = map.pendingWrites();
    const upserts: QaapSqliteRawEntry[] = [];
    const hashes: Array<readonly [string, string]> = [];
    let chars = 0;
    for (const [id, conversation] of writes.upserts) {
        const json = JSON.stringify(conversation);
        chars += json.length;
        const hash = hashConversationRow(json);
        hashes.push([id, hash]);
        if (hash !== map.persistedHash(id)) {
            upserts.push([conversationRowKey(id), json]);
        }
    }
    const checkedReads = collectChangedReads(ctx, upserts, hashes);
    const stringifyMs = performance.now() - startedAt;
    const highWater = ctx.worktreeOrdinalHighWater;
    const highWaterJson = highWater && highWater.size > 0 ? JSON.stringify(Object.fromEntries(highWater)) : undefined;
    const highWaterChanged = highWaterJson !== undefined && highWaterJson !== ctx.persistedHighWaterJson;
    if (highWaterChanged) {
        upserts.push([QAAP_CONVERSATION_HIGH_WATER_ROW_KEY, highWaterJson]);
    }
    if (upserts.length > 0 || writes.deletes.length > 0) {
        ctx.getSqliteStoreV2().applyRawBatch(upserts, writes.deletes.map(id => conversationRowKey(id)));
    }
    map.acknowledge(writes);
    hashes.forEach(([id, hash]) => map.recordPersistedHash(id, hash));
    checkedReads.forEach(id => map.forgetRead(id));
    if (highWaterChanged) {
        ctx.persistedHighWaterJson = highWaterJson;
    }
    if (upserts.length === 0 && writes.deletes.length === 0) {
        return undefined;
    }
    return {
        namespace: QAAP_CONVERSATION_ROWS_NAMESPACE,
        entries: upserts.length + writes.deletes.length,
        chars,
        stringifyMs,
        totalMs: performance.now() - startedAt,
    };
}

function collectChangedReads(
    ctx: QaapAgentConversationStoreContext,
    upserts: QaapSqliteRawEntry[],
    hashes: Array<readonly [string, string]>,
): string[] {
    const map = ctx.conversations;
    const checked: string[] = [];
    let chars = 0;
    for (const id of map.readSinceLastCheck()) {
        if (chars >= QAAP_CONVERSATION_READ_CHECK_MAX_CHARS) {
            break;
        }
        checked.push(id);
        const conversation = map.peek(id);
        if (conversation === undefined) {
            continue;
        }
        const json = JSON.stringify(conversation);
        chars += json.length;
        const hash = hashConversationRow(json);
        if (hash !== map.persistedHash(id)) {
            warnUnmarkedMutation('persist', [id]);
            upserts.push([conversationRowKey(id), json]);
            hashes.push([id, hash]);
        }
    }
    return checked;
}

/**
 * Looks for rows changed without `set`: serializes conversations round-robin up to a limit per run,
 * and writes only those whose hash changed. Pending changes are written first. It yields to the
 * event loop between batches, and a later run continues where this one stopped, so the cost per run
 * does not depend on the size of the store. Callers chain it on the persist queue.
 *
 * @param ctx the conversation store context.
 * @param maxChars limit of serialized characters of this run; at least one conversation is looked at.
 * @returns the number of rows that had to be written.
 */
export async function sweepConversationRows(ctx: QaapAgentConversationStoreContext, maxChars: number = QAAP_CONVERSATION_SWEEP_MAX_CHARS): Promise<number> {
    writePendingConversationRows(ctx);
    const map = ctx.conversations;
    if (ctx.conversationSweepQueue.length === 0) {
        ctx.conversationSweepQueue = [...map.keys()];
    }
    let total = 0;
    let rewritten = 0;
    while (ctx.conversationSweepQueue.length > 0 && total < maxChars) {
        const upserts: QaapSqliteRawEntry[] = [];
        const hashes: Array<readonly [string, string]> = [];
        const taken: string[] = [];
        let batchChars = 0;
        while (ctx.conversationSweepQueue.length > 0 && batchChars < QAAP_CONVERSATION_ROW_BATCH_CHARS && total + batchChars < maxChars) {
            const id = ctx.conversationSweepQueue.pop()!;
            taken.push(id);
            const conversation = map.peek(id);
            if (conversation !== undefined) {
                const json = JSON.stringify(conversation);
                batchChars += json.length;
                const hash = hashConversationRow(json);
                if (hash !== map.persistedHash(id)) {
                    upserts.push([conversationRowKey(id), json]);
                    hashes.push([id, hash]);
                }
            }
        }
        total += batchChars;
        if (upserts.length > 0) {
            try {
                ctx.getSqliteStoreV2().applyRawBatch(upserts, []);
            } catch (error) {
                // Look at this batch again on the next run instead of a whole cycle later.
                ctx.conversationSweepQueue.push(...taken.reverse());
                throw error;
            }
            hashes.forEach(([id, hash]) => map.recordPersistedHash(id, hash));
            // These rows are now current, whether they were pending or not.
            map.acknowledge({ upserts: hashes.map(([id]) => [id, map.peek(id)!] as const).filter(([, value]) => value !== undefined), deletes: [] });
            rewritten += upserts.length;
            warnUnmarkedMutation('sweep', hashes.map(([id]) => id));
        }
        await yieldToEventLoop();
    }
    return rewritten;
}

/**
 * Shutdown flush: writes only what is pending, most recently changed conversations first, in small
 * transactions, and stops at the time budget. Rows read since the last persist are compared within
 * the same budget. Skipped before restore finished, so nothing lands on an unmigrated database.
 *
 * @param ctx the conversation store context.
 * @param budgetMs time this flush may take.
 * @returns the number of rows that could not be written in time.
 */
export function flushConversationRowsSync(ctx: QaapAgentConversationStoreContext, budgetMs: number = QAAP_CONVERSATION_STOP_BUDGET_MS): number {
    if (!ctx.conversationRowsReady) {
        return 0;
    }
    const deadline = Date.now() + budgetMs;
    const map = ctx.conversations;
    const store = ctx.getSqliteStoreV2();
    const { upserts: pending, deletes } = map.pendingWrites();
    const queue = [...pending].sort(([, a], [, b]) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
    if (deletes.length > 0) {
        store.applyRawBatch([], deletes.map(id => conversationRowKey(id)));
        map.acknowledge({ upserts: [], deletes });
    }
    let index = 0;
    while (index < queue.length && Date.now() < deadline) {
        const batch: Array<readonly [string, QaapAgentConversation]> = [];
        const rows: QaapSqliteRawEntry[] = [];
        const hashes: Array<readonly [string, string]> = [];
        let chars = 0;
        while (index < queue.length && chars < QAAP_CONVERSATION_ROW_BATCH_CHARS) {
            const entry = queue[index++];
            const json = JSON.stringify(entry[1]);
            chars += json.length;
            const hash = hashConversationRow(json);
            batch.push(entry);
            hashes.push([entry[0], hash]);
            if (hash !== map.persistedHash(entry[0])) {
                rows.push([conversationRowKey(entry[0]), json]);
            }
        }
        if (rows.length > 0) {
            store.applyRawBatch(rows, []);
        }
        map.acknowledge({ upserts: batch, deletes: [] });
        hashes.forEach(([id, hash]) => map.recordPersistedHash(id, hash));
    }
    const unwritten = queue.length - index;
    if (unwritten === 0 && Date.now() < deadline) {
        // In-place changes of rows a caller still held: same check as a persist.
        writePendingConversationRows(ctx);
    } else if (unwritten > 0) {
        console.error(`[qaap-conversation-store] shutdown budget of ${budgetMs} ms ran out with ${unwritten} conversation row(s) unwritten; `
            + 'they keep the last persisted version.');
    }
    return unwritten;
}

/**
 * Starts the periodic sweep on the persist queue. The timer is unref'd, so it never keeps the
 * process alive. Calling it twice has no effect.
 *
 * @param ctx the conversation store context.
 */
export function startFullConversationSweep(ctx: QaapAgentConversationStoreContext): void {
    if (ctx.fullSweepTimer !== undefined) {
        return;
    }
    const intervalMs = resolveQaapConversationSetting(process.env.QAAP_CONVERSATION_FULL_SWEEP_MS, QAAP_CONVERSATION_FULL_SWEEP_MS);
    const maxChars = resolveQaapConversationSetting(process.env.QAAP_CONVERSATION_SWEEP_MAX_CHARS, QAAP_CONVERSATION_SWEEP_MAX_CHARS);
    ctx.fullSweepTimer = setInterval(() => {
        ctx.persistChain = (ctx.persistChain ?? Promise.resolve()).catch(() => undefined).then(async () => {
            if (!ctx.conversationRowsReady) {
                return;
            }
            try {
                await sweepConversationRows(ctx, maxChars);
                // The sweep writes the pending rows first, so a pass also clears an earlier failure.
                ctx.conversationWriteFailed = false;
            } catch (error) {
                ctx.conversationWriteFailed = true;
                console.warn('[qaap-conversation-store] conversation sweep failed:', error);
            }
        });
    }, intervalMs);
    ctx.fullSweepTimer.unref?.();
}

/**
 * Stops the periodic sweep. Safe to call when it is not running.
 *
 * @param ctx the conversation store context.
 */
export function stopFullConversationSweep(ctx: QaapAgentConversationStoreContext): void {
    if (ctx.fullSweepTimer !== undefined) {
        clearInterval(ctx.fullSweepTimer);
        ctx.fullSweepTimer = undefined;
    }
}

function warnUnmarkedMutation(source: string, ids: readonly string[]): void {
    console.warn(`[qaap-conversation-store] ${source} found ${ids.length} conversation row(s) changed without set(): ${ids.slice(0, 10).join(', ')}. `
        + 'The change is saved now; the code that made it should build a new object and call set().');
}

function yieldToEventLoop(): Promise<void> {
    return new Promise<void>(resolve => setImmediate(resolve));
}
