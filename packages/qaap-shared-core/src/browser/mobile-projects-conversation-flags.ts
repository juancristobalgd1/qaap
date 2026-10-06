// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { Emitter, Event } from '@theia/core/lib/common/event';
import { injectable, postConstruct } from '@theia/core/shared/inversify';
import { fetchConversationReadMarks, putConversationReadMark } from '../common/qaap-conversation-read-marks';

const STORAGE_KEY = 'qaap.mobile.conversation-flags';
/** Pre-server read marks: browser-wide (shared by every user of the browser), imported once. */
const LEGACY_READ_STORAGE_KEY = 'qaap.mobile.conversation-read';

export interface ConversationFlags {
    readonly priority?: boolean;
    readonly paused?: boolean;
}

/**
 * Browser-local store for per-chat priority/pause overrides keyed by conversation id. Used for
 * Theia-chat sessions whose canonical state lives in the workspace metadata directory and doesn't
 * round-trip through the VPS conversation store — for qaap-agent conversations the server is the
 * source of truth, so callers should prefer the PATCH endpoint there.
 *
 * Read marks ("read up to", server-clock ms) are the signed-in user's and live on the backend, so a
 * task read on one device stays read on every other device and after a reload; this class keeps an
 * in-memory copy, saves new marks in the background and reloads them when the tab comes back.
 */
@injectable()
export class MobileProjectsConversationFlags {
    protected readonly cache = new Map<string, ConversationFlags>();
    protected readonly readCache = new Map<string, number>();
    protected loaded = false;
    /** Highest mark per conversation that is not saved yet, and the save in flight. */
    protected readonly pendingReadMarks = new Map<string, number>();
    protected readonly savingReadMarks = new Map<string, Promise<void>>();

    protected readonly onDidChangeEmitter = new Emitter<string>();
    /** Fires the conversation id whose flags changed. */
    readonly onDidChange: Event<string> = this.onDidChangeEmitter.event;

    get(id: string): ConversationFlags {
        this.ensureLoaded();
        return this.cache.get(id) ?? {};
    }

    set(id: string, patch: ConversationFlags): ConversationFlags {
        this.ensureLoaded();
        const current = this.cache.get(id) ?? {};
        const next: ConversationFlags = {
            priority: patch.priority !== undefined ? patch.priority || undefined : current.priority,
            paused: patch.paused !== undefined ? patch.paused || undefined : current.paused,
        };
        if (!next.priority && !next.paused) {
            this.cache.delete(id);
        } else {
            this.cache.set(id, next);
        }
        this.persist();
        this.onDidChangeEmitter.fire(id);
        return next;
    }

    @postConstruct()
    protected init(): void {
        void this.loadReadMarks();
        // Marks written on another device show up when this tab comes back to the foreground.
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') {
                void this.loadReadMarks();
            }
        });
    }

    /** Server time up to which the user has read the conversation; 0 if never read. */
    getLastSeen(id: string): number {
        return this.readCache.get(id) ?? 0;
    }

    /** Mark the conversation as read up to `readAt` (a server timestamp, typically `summary.updatedAt`). */
    markRead(id: string, readAt: number): void {
        if (!this.raiseReadMark(id, readAt)) {
            return;
        }
        this.pendingReadMarks.set(id, Math.max(this.pendingReadMarks.get(id) ?? 0, readAt));
        if (!this.savingReadMarks.has(id)) {
            this.savingReadMarks.set(id, this.saveReadMarks(id));
        }
        this.onDidChangeEmitter.fire(id);
    }

    /** Loads the signed-in user's read marks from the backend, imports the legacy browser marks once. */
    async loadReadMarks(): Promise<void> {
        let marks: Record<string, number>;
        try {
            marks = await fetchConversationReadMarks();
        } catch {
            return; // offline or signed out — keep what this page already knows
        }
        for (const [id, readAt] of Object.entries(marks)) {
            if (typeof readAt === 'number' && this.raiseReadMark(id, readAt)) {
                this.onDidChangeEmitter.fire(id);
            }
        }
        this.importLegacyReadMarks();
    }

    /** Resolves once every read mark recorded so far has been sent to the backend. */
    async flushReadMarks(): Promise<void> {
        while (this.savingReadMarks.size) {
            await Promise.all(this.savingReadMarks.values());
        }
    }

    protected raiseReadMark(id: string, readAt: number): boolean {
        if (!(readAt > (this.readCache.get(id) ?? 0))) {
            return false;
        }
        this.readCache.set(id, readAt);
        return true;
    }

    /** One request per conversation at a time; ticks that arrive meanwhile collapse into the next one. */
    protected async saveReadMarks(id: string): Promise<void> {
        try {
            let readAt = this.pendingReadMarks.get(id);
            while (readAt !== undefined) {
                this.pendingReadMarks.delete(id);
                try {
                    const saved = await putConversationReadMark(id, readAt);
                    if (this.raiseReadMark(id, saved)) {
                        this.onDidChangeEmitter.fire(id);
                    }
                } catch {
                    // Not a server conversation (e.g. a Theia chat session) or offline: the mark stays in memory.
                }
                readAt = this.pendingReadMarks.get(id);
            }
        } finally {
            this.savingReadMarks.delete(id);
        }
    }

    protected importLegacyReadMarks(): void {
        try {
            const raw = window.localStorage?.getItem(LEGACY_READ_STORAGE_KEY);
            if (raw === null || raw === undefined) {
                return;
            }
            window.localStorage.removeItem(LEGACY_READ_STORAGE_KEY);
            const parsed = JSON.parse(raw) as Record<string, number>;
            for (const [id, readAt] of Object.entries(parsed ?? {})) {
                if (typeof readAt === 'number' && readAt > 0) {
                    this.markRead(id, readAt);
                }
            }
        } catch {
            /* corrupted entry — nothing to import */
        }
    }

    protected ensureLoaded(): void {
        if (this.loaded) {
            return;
        }
        this.loaded = true;
        try {
            const raw = window.localStorage?.getItem(STORAGE_KEY);
            if (!raw) {
                return;
            }
            const parsed = JSON.parse(raw) as Record<string, ConversationFlags>;
            for (const [id, flags] of Object.entries(parsed ?? {})) {
                if (flags && (flags.priority || flags.paused)) {
                    this.cache.set(id, { priority: flags.priority || undefined, paused: flags.paused || undefined });
                }
            }
        } catch {
            /* corrupted entry — start fresh */
        }
    }

    protected persist(): void {
        try {
            const out: Record<string, ConversationFlags> = {};
            for (const [id, flags] of this.cache) {
                out[id] = flags;
            }
            window.localStorage?.setItem(STORAGE_KEY, JSON.stringify(out));
        } catch {
            /* persistence is best-effort — quota or private mode */
        }
    }
}
