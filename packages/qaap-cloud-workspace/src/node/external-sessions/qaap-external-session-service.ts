// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable } from '@theia/core/shared/inversify';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DatabaseSync } from 'node:sqlite';
import type { QaapExternalSessionSource } from '@theia/qaap-shared-core/lib/common/qaap-external-session-protocol';
import { QaapUsageRoots } from '../usage/qaap-usage-roots';
import { QaapUsageParsing } from '../usage/qaap-usage-parsing';
import { QaapExternalClaudeSessionParser } from './qaap-external-claude-session-parser';
import { QaapExternalCodexSessionParser } from './qaap-external-codex-session-parser';
import { QaapExternalPiSessionParser } from './qaap-external-pi-session-parser';
import {
    QaapExternalOpenCodeSessionParser,
    type QaapExternalOpenCodeMessageRow,
    type QaapExternalOpenCodePartRow,
    type QaapExternalOpenCodeSessionRow,
} from './qaap-external-opencode-session-parser';
import type { QaapExternalJsonlParseOptions } from './qaap-external-session-parse-options';
import type { QaapExternalSessionHeader, QaapExternalSessionTranscript } from './qaap-external-session-transcript';

/** A session found for a project, with the location it is read from on import. */
export interface QaapExternalSessionFound {
    readonly source: QaapExternalSessionSource;
    readonly header: QaapExternalSessionHeader;
}

type JsonlParser = (lines: readonly string[], options: QaapExternalJsonlParseOptions) => QaapExternalSessionTranscript | undefined;

/** Bytes read from the start and the end of a log to build its listing header. */
const HEAD_BYTES = 256 * 1024;
const TAIL_BYTES = 64 * 1024;
/** Largest log imported in full; bigger ones are read from their tail. */
const MAX_IMPORT_BYTES = 64 * 1024 * 1024;
/** Codex keeps every session of every project in one tree: only the most recent rollouts are inspected. */
const MAX_CODEX_ROLLOUTS = 1500;
/** Bytes read from a Codex rollout to find its `session_meta` line (base instructions make it long). */
const CODEX_META_BYTES = 128 * 1024;
const MAX_LISTED_SESSIONS = 200;

/**
 * Finds and reads the conversations other agent CLIs logged for one project, from the backend's own home
 * directory only (`QaapUsageRoots`). Never writes those logs. See `doc/qaap-external-session-import.md`.
 */
@injectable()
export class QaapExternalSessionService {

    protected roots: QaapUsageRoots = QaapUsageRoots.resolve(process.env, os.homedir());

    /** Importable sessions whose own cwd is exactly `cwd`, newest first. Sessions Qaap started are left out. */
    async list(cwd: string): Promise<QaapExternalSessionFound[]> {
        const target = path.resolve(cwd);
        const groups = await Promise.all([
            this.listClaude(target).catch(() => []),
            this.listCodex(target).catch(() => []),
            this.listPi(target).catch(() => []),
            Promise.resolve().then(() => this.listOpenCode(target)).catch(() => []),
        ]);
        return groups.flat()
            .filter(found => !found.header.startedByQaap && found.header.firstUserMessage.length > 0)
            .sort((a, b) => b.header.updatedAt - a.header.updatedAt)
            .slice(0, MAX_LISTED_SESSIONS);
    }

    /** The full transcript of one session of `cwd`, or `undefined` when it is not a session of that project. */
    async load(source: QaapExternalSessionSource, sessionId: string, cwd: string): Promise<QaapExternalSessionTranscript | undefined> {
        if (!/^[A-Za-z0-9_.-]{1,128}$/.test(sessionId)) {
            return undefined;
        }
        const target = path.resolve(cwd);
        const transcript = source === 'opencode'
            ? this.loadOpenCode(sessionId)
            : await this.loadJsonl(source, sessionId, target);
        return transcript && this.sameDirectory(transcript.header.cwd, target) ? transcript : undefined;
    }

    // ─── Claude Code ─────────────────────────────────────────────────────────

    /** Claude Code names a project folder after its cwd with every non-alphanumeric character replaced by `-`. */
    protected claudeProjectDirectory(cwd: string): string {
        return path.join(this.roots.claudeProjects, cwd.replace(/[^A-Za-z0-9]/g, '-'));
    }

    protected async listClaude(cwd: string): Promise<QaapExternalSessionFound[]> {
        const files = await this.listJsonl(this.claudeProjectDirectory(cwd));
        return this.headers('claude', files, QaapExternalClaudeSessionParser.parse, cwd);
    }

    // ─── Codex ───────────────────────────────────────────────────────────────

    protected async listCodex(cwd: string): Promise<QaapExternalSessionFound[]> {
        const files = (await this.listRecursive(this.roots.codexSessions, name => /^rollout-.*\.jsonl$/.test(name)))
            .sort()
            .reverse()
            .slice(0, MAX_CODEX_ROLLOUTS);
        const matching: string[] = [];
        for (const file of files) {
            if (this.sameDirectory(await this.readCodexCwd(file), cwd)) {
                matching.push(file);
            }
        }
        return this.headers('codex', matching, QaapExternalCodexSessionParser.parse, cwd);
    }

    protected async readCodexCwd(file: string): Promise<string | undefined> {
        const head = await this.readRange(file, 0, CODEX_META_BYTES);
        const newline = head.indexOf('\n');
        const first = QaapUsageParsing.parseObject(newline >= 0 ? head.slice(0, newline) : head);
        const payload = QaapUsageParsing.objectOf(first?.payload);
        return first?.type === 'session_meta' && typeof payload?.cwd === 'string' ? payload.cwd : undefined;
    }

    // ─── Pi ──────────────────────────────────────────────────────────────────

    /** Pi names a project folder `--<cwd without the leading slash, slashes as dashes>--`. */
    protected piProjectDirectory(cwd: string): string {
        return path.join(this.roots.piSessions, `--${cwd.replace(/^[/\\]+/, '').replace(/[/\\:]/g, '-')}--`);
    }

    protected async listPi(cwd: string): Promise<QaapExternalSessionFound[]> {
        const files = await this.listJsonl(this.piProjectDirectory(cwd));
        return this.headers('pi', files, QaapExternalPiSessionParser.parse, cwd);
    }

    // ─── OpenCode ────────────────────────────────────────────────────────────

    protected listOpenCode(cwd: string): QaapExternalSessionFound[] {
        return this.withOpenCodeDatabase(database => {
            const sessions = database.prepare(
                'SELECT id, directory, title, time_created AS timeCreated, time_updated AS timeUpdated, parent_id AS parentId '
                + 'FROM session WHERE directory = ? AND parent_id IS NULL ORDER BY time_updated DESC LIMIT ?',
            ).all(cwd, MAX_LISTED_SESSIONS) as unknown as QaapExternalOpenCodeSessionRow[];
            const firstUserText = database.prepare(
                'SELECT p.data AS data FROM message m JOIN part p ON p.message_id = m.id '
                + 'WHERE m.session_id = ? AND json_extract(m.data, \'$.role\') = \'user\' AND json_extract(p.data, \'$.type\') = \'text\' '
                + 'ORDER BY m.time_created, m.id, p.id LIMIT 1',
            );
            return sessions.map((session): QaapExternalSessionFound => {
                const row = firstUserText.get(session.id) as { data?: string } | undefined;
                const part = row?.data ? QaapUsageParsing.parseObject(row.data) : undefined;
                const text = typeof part?.text === 'string' ? part.text : '';
                return { source: 'opencode', header: QaapExternalOpenCodeSessionParser.header(session, text) };
            });
        }) ?? [];
    }

    protected loadOpenCode(sessionId: string): QaapExternalSessionTranscript | undefined {
        return this.withOpenCodeDatabase(database => {
            const session = database.prepare(
                'SELECT id, directory, title, time_created AS timeCreated, time_updated AS timeUpdated, parent_id AS parentId FROM session WHERE id = ?',
            ).get(sessionId) as unknown as QaapExternalOpenCodeSessionRow | undefined;
            if (!session) {
                return undefined;
            }
            const messages = database.prepare(
                'SELECT id, time_created AS timeCreated, data FROM message WHERE session_id = ? ORDER BY time_created, id',
            ).all(sessionId) as unknown as QaapExternalOpenCodeMessageRow[];
            const parts = database.prepare(
                'SELECT id, message_id AS messageId, time_created AS timeCreated, data FROM part WHERE session_id = ? ORDER BY message_id, id',
            ).all(sessionId) as unknown as QaapExternalOpenCodePartRow[];
            return QaapExternalOpenCodeSessionParser.parse(session, messages, parts);
        });
    }

    protected withOpenCodeDatabase<T>(read: (database: DatabaseSync) => T): T | undefined {
        if (!fs.existsSync(this.roots.opencodeDatabase)) {
            return undefined;
        }
        let database: DatabaseSync | undefined;
        try {
            database = new DatabaseSync(this.roots.opencodeDatabase, { readOnly: true });
            return read(database);
        } catch (error) {
            console.warn('[qaap-external-sessions] could not read the OpenCode database:', error instanceof Error ? error.message : error);
            return undefined;
        } finally {
            database?.close();
        }
    }

    // ─── JSONL logs ──────────────────────────────────────────────────────────

    protected async loadJsonl(source: Exclude<QaapExternalSessionSource, 'opencode'>, sessionId: string, cwd: string): Promise<QaapExternalSessionTranscript | undefined> {
        const file = await this.findJsonl(source, sessionId, cwd);
        if (!file) {
            return undefined;
        }
        const stat = await fs.promises.stat(file);
        const start = Math.max(0, stat.size - MAX_IMPORT_BYTES);
        let text = await this.readRange(file, start, stat.size - start);
        if (start > 0) {
            // Started mid-file: drop the partial first line, and keep the header line the parsers need for cwd and id.
            text = `${await this.readFirstLine(file)}\n${text.slice(text.indexOf('\n') + 1)}`;
        }
        return this.parserFor(source)(text.split('\n'), { fallbackSessionId: path.basename(file, '.jsonl'), fallbackTimestampMs: stat.mtimeMs });
    }

    protected async findJsonl(source: Exclude<QaapExternalSessionSource, 'opencode'>, sessionId: string, cwd: string): Promise<string | undefined> {
        if (source === 'claude') {
            const file = path.join(this.claudeProjectDirectory(cwd), `${sessionId}.jsonl`);
            return fs.existsSync(file) ? file : undefined;
        }
        const files = source === 'codex'
            ? await this.listRecursive(this.roots.codexSessions, name => /^rollout-.*\.jsonl$/.test(name))
            : await this.listJsonl(this.piProjectDirectory(cwd));
        // Both CLIs end the file name with the session id (`rollout-<time>-<id>.jsonl`, `<time>_<id>.jsonl`).
        return files.find(file => path.basename(file, '.jsonl').endsWith(sessionId));
    }

    protected parserFor(source: Exclude<QaapExternalSessionSource, 'opencode'>): JsonlParser {
        switch (source) {
            case 'claude': return QaapExternalClaudeSessionParser.parse;
            case 'codex': return QaapExternalCodexSessionParser.parse;
            case 'pi': return QaapExternalPiSessionParser.parse;
        }
    }

    protected async headers(source: QaapExternalSessionSource, files: readonly string[], parse: JsonlParser, cwd: string): Promise<QaapExternalSessionFound[]> {
        const found: QaapExternalSessionFound[] = [];
        for (const file of files) {
            try {
                const stat = await fs.promises.stat(file);
                const lines = await this.readHeadAndTailLines(file, stat.size);
                const parsed = parse(lines, { fallbackSessionId: path.basename(file, '.jsonl'), fallbackTimestampMs: stat.mtimeMs, headerOnly: true });
                if (parsed && this.sameDirectory(parsed.header.cwd, cwd)) {
                    found.push({ source, header: { ...parsed.header, updatedAt: Math.max(parsed.header.updatedAt, stat.mtimeMs) } });
                }
            } catch {
                // A log that vanished or cannot be read is simply not listed.
            }
        }
        return found;
    }

    /** Complete lines from the first {@link HEAD_BYTES} and the last {@link TAIL_BYTES} of a file. */
    protected async readHeadAndTailLines(file: string, size: number): Promise<string[]> {
        if (size <= HEAD_BYTES + TAIL_BYTES) {
            return (await this.readRange(file, 0, size)).split('\n');
        }
        const head = await this.readRange(file, 0, HEAD_BYTES);
        const tail = await this.readRange(file, size - TAIL_BYTES, TAIL_BYTES);
        const headLines = head.slice(0, head.lastIndexOf('\n')).split('\n');
        const tailLines = tail.slice(tail.indexOf('\n') + 1).split('\n');
        return [...headLines, ...tailLines];
    }

    protected async readFirstLine(file: string): Promise<string> {
        const head = await this.readRange(file, 0, CODEX_META_BYTES);
        const newline = head.indexOf('\n');
        return newline >= 0 ? head.slice(0, newline) : head;
    }

    protected async readRange(file: string, start: number, length: number): Promise<string> {
        const handle = await fs.promises.open(file, 'r');
        try {
            const buffer = Buffer.alloc(Math.max(0, length));
            const { bytesRead } = await handle.read(buffer, 0, buffer.length, start);
            return buffer.subarray(0, bytesRead).toString('utf8');
        } finally {
            await handle.close();
        }
    }

    protected async listJsonl(directory: string): Promise<string[]> {
        try {
            const entries = await fs.promises.readdir(directory, { withFileTypes: true });
            return entries.filter(entry => entry.isFile() && entry.name.endsWith('.jsonl')).map(entry => path.join(directory, entry.name));
        } catch {
            return [];
        }
    }

    protected async listRecursive(directory: string, matches: (name: string) => boolean): Promise<string[]> {
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

    protected sameDirectory(a: string | undefined, b: string): boolean {
        return !!a && path.resolve(a).replace(/[/\\]+$/, '') === b.replace(/[/\\]+$/, '');
    }
}
