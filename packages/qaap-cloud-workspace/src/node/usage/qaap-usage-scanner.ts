// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable } from '@theia/core/shared/inversify';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as zlib from 'zlib';
import { DatabaseSync } from 'node:sqlite';
import { QaapUsageClaudeReader } from './qaap-usage-claude-reader';
import { QaapUsageCodexReader } from './qaap-usage-codex-reader';
import { QaapUsageCopilotReader } from './qaap-usage-copilot-reader';
import { QaapUsageGrokReader } from './qaap-usage-grok-reader';
import { QaapUsageLedger, type QaapUsageFileState } from './qaap-usage-ledger';
import { QaapUsageOpenCodeReader } from './qaap-usage-opencode-reader';
import { QaapUsagePiReader } from './qaap-usage-pi-reader';
import { QaapUsageRoots } from './qaap-usage-roots';
import type { QaapUsageLineContext, QaapUsageParseResult } from './qaap-usage-record';
import { QaapUsageParsing } from './qaap-usage-parsing';

/** Logs older than this are ignored and dropped from memory. */
export const QAAP_USAGE_LOG_RETENTION_DAYS = 92;
/** Files read in parallel. */
const READ_CONCURRENCY = 4;
/** Bytes read per chunk while streaming a log. */
const READ_CHUNK_BYTES = 256 * 1024;
/** Minimum delay between two background refreshes. */
const REFRESH_INTERVAL_MS = 30_000;

const DAY_MS = 86_400_000;

interface QaapUsageDiscovered {
    file: string;
    kind: 'claude' | 'codex' | 'pi' | 'opencode-part' | 'grok' | 'copilot';
}

/**
 * Reads the local agent CLI logs into a per-file ledger. The first scan runs in the background; later scans
 * re-read only the bytes that were appended since the previous one.
 */
@injectable()
export class QaapUsageScanner {

    protected roots: QaapUsageRoots = QaapUsageRoots.resolve(process.env, os.homedir());
    protected readonly ledger = new QaapUsageLedger();
    protected readonly messageMetaCache = new Map<string, QaapUsageOpenCodeReader.MessageMeta>();
    protected scanPromise: Promise<void> | undefined;
    protected completedScans = 0;
    protected lastFinishedAt = 0;

    /** Current time in epoch milliseconds; overridable in tests. */
    protected now(): number {
        return Date.now();
    }

    /** Whether the first scan has finished. Until then summaries are partial. */
    hasCompletedScan(): boolean {
        return this.completedScans > 0;
    }

    isScanning(): boolean {
        return this.scanPromise !== undefined;
    }

    getLedger(): QaapUsageLedger {
        return this.ledger;
    }

    /** Starts a scan unless one is already running, and resolves when it finishes. */
    scan(): Promise<void> {
        if (!this.scanPromise) {
            this.scanPromise = this.runScan().finally(() => {
                this.scanPromise = undefined;
                this.lastFinishedAt = this.now();
            });
        }
        return this.scanPromise;
    }

    /** Starts a scan in the background when none is running and the last one is older than the refresh interval. */
    refreshInBackground(): void {
        if (this.scanPromise || this.now() - this.lastFinishedAt < REFRESH_INTERVAL_MS) {
            return;
        }
        this.scan().catch(() => undefined);
    }

    protected async runScan(): Promise<void> {
        const cutoffMs = this.now() - QAAP_USAGE_LOG_RETENTION_DAYS * DAY_MS;
        const discovered = await this.discover();
        const seen = new Set<string>();
        const work: { item: QaapUsageDiscovered; mtimeMs: number; size: number }[] = [];
        for (const item of discovered) {
            seen.add(item.file);
            const stat = await this.statOrUndefined(item.file);
            if (!stat) {
                this.ledger.retain(file => file !== item.file);
                continue;
            }
            if (stat.mtimeMs < cutoffMs) {
                this.ledger.retain(file => file !== item.file);
                continue;
            }
            work.push({ item, mtimeMs: stat.mtimeMs, size: stat.size });
        }
        this.ledger.retain(file => seen.has(file));
        await this.runPool(work, entry => this.scanFile(entry.item, entry.size, entry.mtimeMs));
        this.completedScans++;
    }

    protected async runPool<T>(items: readonly T[], worker: (item: T) => Promise<void>): Promise<void> {
        let cursor = 0;
        const lane = async (): Promise<void> => {
            while (cursor < items.length) {
                const item = items[cursor++];
                try {
                    await worker(item);
                } catch (error) {
                    console.error('[qaap-usage] scan failed for one log:', error instanceof Error ? error.message : error);
                }
                await new Promise<void>(resolve => setImmediate(resolve));
            }
        };
        await Promise.all(Array.from({ length: Math.min(READ_CONCURRENCY, items.length) }, () => lane()));
    }

    protected async scanFile(item: QaapUsageDiscovered, size: number, mtimeMs: number): Promise<void> {
        const previous = this.ledger.get(item.file);
        if (item.kind === 'copilot') {
            return this.scanCopilotDatabase(item.file, size, mtimeMs, previous);
        }
        if (item.kind === 'grok') {
            return this.replaceDocument(item.file, size, mtimeMs, previous, text => QaapUsageGrokReader.parseDocument(text, path.basename(path.dirname(item.file))));
        }
        if (item.kind === 'opencode-part') {
            return this.replaceDocument(item.file, size, mtimeMs, previous, async text => [await this.parseOpenCodePart(text, mtimeMs)]);
        }
        if (item.file.endsWith('.zst')) {
            return this.replaceCompressedLog(item, size, mtimeMs, previous);
        }
        return this.scanJsonl(item, size, mtimeMs, previous);
    }

    /** Reads only the bytes appended since the last scan, or the whole file when it was rewritten. */
    protected async scanJsonl(item: QaapUsageDiscovered, size: number, mtimeMs: number, previous: QaapUsageFileState | undefined): Promise<void> {
        if (previous && previous.size === size && previous.mtimeMs === mtimeMs) {
            return;
        }
        const appended = previous !== undefined && size > previous.size && size >= previous.offset;
        const state: QaapUsageFileState = appended
            ? previous
            : { size: 0, mtimeMs: 0, offset: 0, context: this.initialContext(item), entries: new Map(), skipped: 0 };
        const offset = await this.consumeLines(item.file, state.offset, size, line => {
            if (line.trim()) {
                this.apply(item, state, this.parseLine(item, line, state.context));
            }
        });
        state.offset = offset;
        state.size = size;
        state.mtimeMs = mtimeMs;
        this.ledger.set(item.file, state);
    }

    protected async replaceCompressedLog(item: QaapUsageDiscovered, size: number, mtimeMs: number, previous: QaapUsageFileState | undefined): Promise<void> {
        if (previous && previous.size === size && previous.mtimeMs === mtimeMs) {
            return;
        }
        const state: QaapUsageFileState = { size, mtimeMs, offset: 0, context: this.initialContext(item), entries: new Map(), skipped: 0 };
        const decompress = (zlib as unknown as { zstdDecompressSync?: (buffer: Buffer) => Buffer }).zstdDecompressSync;
        if (typeof decompress !== 'function') {
            // This Node build cannot read zstd; the file's usage is unknown and is reported as skipped.
            state.skipped = 1;
            this.ledger.set(item.file, state);
            return;
        }
        const text = decompress(await fs.promises.readFile(item.file)).toString('utf8');
        for (const line of text.split('\n')) {
            if (line.trim()) {
                this.apply(item, state, this.parseLine(item, line, state.context));
            }
        }
        this.ledger.set(item.file, state);
    }

    /** Re-reads a whole document when it changed, replacing its previous entries. */
    protected async replaceDocument(
        file: string,
        size: number,
        mtimeMs: number,
        previous: QaapUsageFileState | undefined,
        parse: (text: string) => QaapUsageParseResult[] | Promise<QaapUsageParseResult[]>,
    ): Promise<void> {
        if (previous && previous.size === size && previous.mtimeMs === mtimeMs) {
            return;
        }
        const text = await fs.promises.readFile(file, 'utf8');
        const item: QaapUsageDiscovered = { file, kind: 'grok' };
        const state: QaapUsageFileState = { size, mtimeMs, offset: 0, context: this.initialContext(item), entries: new Map(), skipped: 0 };
        for (const result of await parse(text)) {
            this.apply(item, state, result);
        }
        this.ledger.set(file, state);
    }

    /** The database and its write-ahead log change together, so their stats are combined into one version. */
    protected async scanCopilotDatabase(file: string, size: number, mtimeMs: number, previous: QaapUsageFileState | undefined): Promise<void> {
        const wal = await this.statOrUndefined(`${file}-wal`);
        const combinedSize = size + (wal?.size ?? 0);
        const combinedMtime = Math.max(mtimeMs, wal?.mtimeMs ?? 0);
        if (previous && previous.size === combinedSize && previous.mtimeMs === combinedMtime) {
            return;
        }
        const item: QaapUsageDiscovered = { file, kind: 'copilot' };
        const state: QaapUsageFileState = { size: combinedSize, mtimeMs: combinedMtime, offset: 0, context: this.initialContext(item), entries: new Map(), skipped: 0 };
        let database: DatabaseSync | undefined;
        try {
            database = new DatabaseSync(file, { readOnly: true });
            const rows = database.prepare(
                'SELECT id, session_id, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, reasoning_tokens, created_at FROM assistant_usage_events',
            ).all();
            for (const row of rows) {
                this.apply(item, state, QaapUsageCopilotReader.parseRow(row));
            }
        } catch (error) {
            // A locked or unreadable database keeps its previous usage until the next scan.
            console.error('[qaap-usage] copilot usage database unreadable:', error instanceof Error ? error.message : error);
            return;
        } finally {
            database?.close();
        }
        this.ledger.set(file, state);
    }

    protected async parseOpenCodePart(text: string, fallbackMs: number): Promise<QaapUsageParseResult> {
        const part = QaapUsageParsing.parseObject(text);
        if (!part || part.type !== 'step-finish') {
            return part ? {} : { skipped: true };
        }
        const sessionId = typeof part.sessionID === 'string' ? part.sessionID : '';
        const messageId = typeof part.messageID === 'string' ? part.messageID : '';
        const meta = sessionId && messageId ? await this.openCodeMessageMeta(sessionId, messageId) : undefined;
        return QaapUsageOpenCodeReader.parsePart(text, () => meta, fallbackMs) ?? {};
    }

    /** Model and time of an OpenCode message. Messages never change, so the result is cached for the process. */
    protected async openCodeMessageMeta(sessionId: string, messageId: string): Promise<QaapUsageOpenCodeReader.MessageMeta | undefined> {
        const cacheKey = `${sessionId}/${messageId}`;
        const cached = this.messageMetaCache.get(cacheKey);
        if (cached) {
            return cached;
        }
        const file = path.join(this.roots.opencodeMessages, sessionId, `${messageId}.json`);
        try {
            const parsed = QaapUsageOpenCodeReader.parseMessage(await fs.promises.readFile(file, 'utf8'));
            if (parsed) {
                this.messageMetaCache.set(cacheKey, parsed.meta);
                return parsed.meta;
            }
        } catch {
            // The message file is gone or unreadable; the part keeps an unknown model.
        }
        return undefined;
    }

    protected parseLine(item: QaapUsageDiscovered, line: string, context: QaapUsageLineContext): QaapUsageParseResult | undefined {
        switch (item.kind) {
            case 'claude': return QaapUsageClaudeReader.parseLine(line, context);
            case 'codex': return QaapUsageCodexReader.parseLine(line, context);
            case 'pi': return QaapUsagePiReader.parseLine(line, context);
            default: return undefined;
        }
    }

    protected initialContext(item: QaapUsageDiscovered): QaapUsageLineContext {
        return { fallbackSessionId: path.basename(item.file).replace(/\.jsonl(\.zst)?$|\.json$/, '') };
    }

    protected apply(item: QaapUsageDiscovered, state: QaapUsageFileState, result: QaapUsageParseResult | undefined): void {
        if (!result) {
            return;
        }
        if (result.skipped) {
            state.skipped++;
        }
        if (result.rateLimits && (!state.rateLimits || result.rateLimits.observedAtMs >= state.rateLimits.observedAtMs)) {
            state.rateLimits = result.rateLimits;
        }
        if (result.record) {
            QaapUsageLedger.merge(state.entries, result.record);
        }
    }

    /**
     * Streams complete lines from `start` up to `size` and returns the offset just after the last complete line.
     * A trailing partial line is left for the next scan.
     */
    protected async consumeLines(file: string, start: number, size: number, onLine: (line: string) => void): Promise<number> {
        const handle = await fs.promises.open(file, 'r');
        try {
            const chunk = Buffer.alloc(READ_CHUNK_BYTES);
            let position = start;
            let consumed = start;
            let carry: Buffer = Buffer.alloc(0);
            while (position < size) {
                const { bytesRead } = await handle.read(chunk, 0, Math.min(READ_CHUNK_BYTES, size - position), position);
                if (bytesRead === 0) {
                    break;
                }
                position += bytesRead;
                const buffer = Buffer.concat([carry, chunk.subarray(0, bytesRead)]);
                let lineStart = 0;
                let newline = buffer.indexOf(0x0a, lineStart);
                while (newline !== -1) {
                    onLine(buffer.toString('utf8', lineStart, newline).replace(/\r$/, ''));
                    consumed += newline - lineStart + 1;
                    lineStart = newline + 1;
                    newline = buffer.indexOf(0x0a, lineStart);
                }
                carry = Buffer.from(buffer.subarray(lineStart));
                await new Promise<void>(resolve => setImmediate(resolve));
            }
            return consumed;
        } finally {
            await handle.close();
        }
    }

    protected async discover(): Promise<QaapUsageDiscovered[]> {
        const found: QaapUsageDiscovered[] = [];
        const add = (files: string[], kind: QaapUsageDiscovered['kind']): void => {
            for (const file of files) {
                found.push({ file, kind });
            }
        };
        add(await this.listFiles(this.roots.claudeProjects, name => name.endsWith('.jsonl')), 'claude');
        add(await this.listFiles(this.roots.codexSessions, name => /^rollout-.*\.jsonl(\.zst)?$/.test(name)), 'codex');
        add(await this.listFiles(this.roots.piSessions, name => name.endsWith('.jsonl')), 'pi');
        add(await this.listFiles(this.roots.opencodeParts, name => name.endsWith('.json')), 'opencode-part');
        add(await this.listFiles(this.roots.grokSessions, name => name === 'usage.json'), 'grok');
        if (await this.statOrUndefined(this.roots.copilotDatabase)) {
            add([this.roots.copilotDatabase], 'copilot');
        }
        return found;
    }

    /** Recursively lists files whose names match. Missing directories yield nothing. */
    protected async listFiles(directory: string, matches: (name: string) => boolean): Promise<string[]> {
        const result: string[] = [];
        const visit = async (current: string): Promise<void> => {
            let entries: fs.Dirent[];
            try {
                entries = await fs.promises.readdir(current, { withFileTypes: true });
            } catch {
                return;
            }
            for (const entry of entries) {
                const full = path.join(current, entry.name);
                if (entry.isDirectory()) {
                    await visit(full);
                } else if (entry.isFile() && matches(entry.name)) {
                    result.push(full);
                }
            }
        };
        await visit(directory);
        return result;
    }

    protected async statOrUndefined(file: string): Promise<fs.Stats | undefined> {
        try {
            return await fs.promises.stat(file);
        } catch {
            return undefined;
        }
    }
}
