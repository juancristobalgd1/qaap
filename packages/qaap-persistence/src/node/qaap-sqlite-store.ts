// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { DatabaseSync } from 'node:sqlite';
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface QaapSqliteStoreOptions {
    readonly databasePath: string;
    readonly namespace: string;
    readonly legacyPath?: string;
}

export type QaapSqliteEntry<T> = readonly [key: string, value: T];

/**
 * Ordered schema migrations; `PRAGMA user_version` records how many have been applied.
 * Append new steps, never edit or reorder existing ones. v1 uses `IF NOT EXISTS`, so databases
 * created before versioning (user_version 0, tables already present) adopt it without data changes.
 */
export const QAAP_SQLITE_SCHEMA_MIGRATIONS: ReadonlyArray<(database: DatabaseSync) => void> = [
    database => database.exec(`
        CREATE TABLE IF NOT EXISTS qaap_kv (
            namespace TEXT NOT NULL,
            key TEXT NOT NULL,
            value TEXT NOT NULL,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (namespace, key)
        ) WITHOUT ROWID;
        CREATE INDEX IF NOT EXISTS qaap_kv_namespace_updated
            ON qaap_kv (namespace, updated_at DESC);
        CREATE TABLE IF NOT EXISTS qaap_migration (
            namespace TEXT PRIMARY KEY,
            source_path TEXT NOT NULL,
            migrated_at INTEGER NOT NULL
        ) WITHOUT ROWID;
    `),
];

export const QAAP_SQLITE_SCHEMA_VERSION = QAAP_SQLITE_SCHEMA_MIGRATIONS.length;

/**
 * Small SQLite-backed JSON value store for Node-owned Qaap state.
 *
 * Values remain JSON encoded at the edge so existing store contracts and
 * forward-compatible payloads do not need to change. Keys are indexed and
 * mutations are transactional, which avoids rewriting an entire JSON file for
 * every update. Each database enables WAL and FULL synchronous mode before it
 * is used; the latter is intentional because these stores include credentials
 * and restart/recovery checkpoints.
 *
 * A connection is opened per operation (or per outermost transaction) on purpose: on Windows an
 * open SQLite file cannot be deleted, and many callers and specs remove their state directories.
 * The schema is migrated once per instance, so each later open only applies the PRAGMAs.
 */
export class QaapSqliteStore {

    protected readonly databasePath: string;
    protected readonly namespace: string;
    /** Connection of the outermost running transaction; nested work reuses it. */
    protected activeDatabase: DatabaseSync | undefined;
    protected transactionDepth = 0;
    protected schemaReady = false;

    constructor(options: QaapSqliteStoreOptions) {
        this.databasePath = options.databasePath;
        this.namespace = options.namespace;
        this.ensureDirectory(options.databasePath);
        this.withDatabase(() => undefined);
        this.tightenPermissions(options.databasePath);
        if (options.legacyPath) {
            this.legacyPath = options.legacyPath;
        }
    }

    protected legacyPath: string | undefined;

    get<T>(key: string): T | undefined {
        return this.withDatabase(database => {
            const row = database.prepare(
                'SELECT value FROM qaap_kv WHERE namespace = ? AND key = ?',
            ).get(this.namespace, key) as { value?: string } | undefined;
            if (!row?.value) {
                return undefined;
            }
            return JSON.parse(row.value) as T;
        });
    }

    list<T>(): QaapSqliteEntry<T>[] {
        return this.withDatabase(database => {
            const rows = database.prepare(
                'SELECT key, value FROM qaap_kv WHERE namespace = ? ORDER BY key',
            ).all(this.namespace) as Array<{ key: string; value: string }>;
            return rows.map(row => [row.key, JSON.parse(row.value) as T]);
        });
    }

    set<T>(key: string, value: T): void {
        this.withDatabase(database => {
            database.prepare(`
                INSERT INTO qaap_kv (namespace, key, value, updated_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(namespace, key) DO UPDATE SET
                    value = excluded.value,
                    updated_at = excluded.updated_at
            `).run(this.namespace, key, JSON.stringify(value), Date.now());
        });
        this.tightenWalPermissions();
    }

    delete(key: string): boolean {
        const result = this.withDatabase(database => database.prepare(
            'DELETE FROM qaap_kv WHERE namespace = ? AND key = ?',
        ).run(this.namespace, key));
        return result.changes > 0;
    }

    replace<T>(entries: readonly QaapSqliteEntry<T>[]): void {
        this.withTransaction(database => {
            database.prepare('DELETE FROM qaap_kv WHERE namespace = ?').run(this.namespace);
            const statement = database.prepare(`
                INSERT INTO qaap_kv (namespace, key, value, updated_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(namespace, key) DO UPDATE SET
                    value = excluded.value,
                    updated_at = excluded.updated_at
            `);
            const now = Date.now();
            for (const [key, value] of entries) {
                statement.run(this.namespace, key, JSON.stringify(value), now);
            }
        });
    }

    /**
     * Runs `operation` atomically. Nested calls share the outer connection and use a SAVEPOINT, so
     * an inner failure rolls back only the inner work (a second connection would instead block on
     * the outer write lock until `busy_timeout`). `operation` must be synchronous.
     */
    withTransaction<T>(operation: (database: DatabaseSync) => T): T {
        return this.withDatabase(database => {
            if (this.transactionDepth > 0) {
                return this.runInSavepoint(database, operation);
            }
            database.exec('BEGIN IMMEDIATE');
            this.activeDatabase = database;
            this.transactionDepth = 1;
            try {
                const result = operation(database);
                database.exec('COMMIT');
                return result;
            } catch (error) {
                try {
                    database.exec('ROLLBACK');
                } catch {
                    // Preserve the original operation error.
                }
                throw error;
            } finally {
                this.activeDatabase = undefined;
                this.transactionDepth = 0;
            }
        });
    }

    protected runInSavepoint<T>(database: DatabaseSync, operation: (database: DatabaseSync) => T): T {
        const savepoint = `qaap_sp_${this.transactionDepth}`;
        database.exec(`SAVEPOINT ${savepoint}`);
        this.transactionDepth++;
        try {
            const result = operation(database);
            database.exec(`RELEASE ${savepoint}`);
            return result;
        } catch (error) {
            try {
                database.exec(`ROLLBACK TO ${savepoint}`);
                database.exec(`RELEASE ${savepoint}`);
            } catch {
                // Preserve the original operation error.
            }
            throw error;
        } finally {
            this.transactionDepth--;
        }
    }

    /**
     * Imports one legacy JSON file exactly once, without deleting it. Keeping
     * the source allows an operator to recover it manually if an old deployment
     * needs to be rolled back.
     */
    migrateLegacy<T>(loader: (raw: string) => Iterable<QaapSqliteEntry<T>>, sourcePath = this.legacyPath): void {
        if (!sourcePath || !fs.existsSync(sourcePath)) {
            return;
        }
        const migrated = this.withDatabase(database => database.prepare(
            'SELECT 1 FROM qaap_migration WHERE namespace = ?',
        ).get(this.namespace));
        if (migrated) {
            return;
        }
        const raw = fs.readFileSync(sourcePath, 'utf8');
        const entries = [...loader(raw)];
        this.withTransaction(database => {
            const alreadyMigrated = database.prepare(
                'SELECT 1 FROM qaap_migration WHERE namespace = ?',
            ).get(this.namespace);
            if (alreadyMigrated) {
                return;
            }
            const hasRows = database.prepare(
                'SELECT 1 FROM qaap_kv WHERE namespace = ? LIMIT 1',
            ).get(this.namespace);
            if (!hasRows && entries.length > 0) {
                const statement = database.prepare(`
                    INSERT INTO qaap_kv (namespace, key, value, updated_at)
                    VALUES (?, ?, ?, ?)
                    ON CONFLICT(namespace, key) DO UPDATE SET
                        value = excluded.value,
                        updated_at = excluded.updated_at
                `);
                const now = Date.now();
                for (const [key, value] of entries) {
                    statement.run(this.namespace, key, JSON.stringify(value), now);
                }
            }
            database.prepare(`
                INSERT INTO qaap_migration (namespace, source_path, migrated_at)
                VALUES (?, ?, ?)
            `).run(this.namespace, sourcePath, Date.now());
        });
    }

    protected ensureDirectory(databasePath: string): void {
        fs.mkdirSync(path.dirname(databasePath), { recursive: true, mode: 0o700 });
    }

    protected tightenPermissions(databasePath: string): void {
        try { fs.chmodSync(databasePath, 0o600); } catch { /* best effort */ }
        this.tightenWalPermissions();
    }

    protected tightenWalPermissions(): void {
        for (const suffix of ['', '-wal', '-shm']) {
            try { fs.chmodSync(`${this.databasePath}${suffix}`, 0o600); } catch { /* best effort */ }
        }
    }

    protected withDatabase<T>(operation: (database: DatabaseSync) => T): T {
        if (this.activeDatabase) {
            return operation(this.activeDatabase);
        }
        const database = new DatabaseSync(this.databasePath, { timeout: 5_000 });
        try {
            database.exec(`
                PRAGMA journal_mode = WAL;
                PRAGMA synchronous = FULL;
                PRAGMA foreign_keys = ON;
                PRAGMA busy_timeout = 5000;
            `);
            if (!this.schemaReady) {
                this.migrateSchema(database);
                this.schemaReady = true;
            }
            return operation(database);
        } finally {
            database.close();
        }
    }

    /**
     * Applies pending QAAP_SQLITE_SCHEMA_MIGRATIONS in one IMMEDIATE transaction (re-reading the
     * version under the write lock, so concurrent processes cannot apply a step twice). A database
     * newer than this build is refused instead of being written with an older schema.
     */
    protected migrateSchema(database: DatabaseSync): void {
        const readVersion = (): number =>
            Number((database.prepare('PRAGMA user_version').get() as { user_version?: number } | undefined)?.user_version ?? 0);
        const assertSupported = (version: number): void => {
            if (version > QAAP_SQLITE_SCHEMA_VERSION) {
                throw new Error(`Qaap SQLite store ${this.databasePath} has schema version ${version}, `
                    + `newer than this build supports (${QAAP_SQLITE_SCHEMA_VERSION}); refusing to open it. `
                    + 'Roll forward to a matching Qaap version instead of downgrading the database.');
            }
        };
        assertSupported(readVersion());
        if (readVersion() === QAAP_SQLITE_SCHEMA_VERSION) {
            return;
        }
        database.exec('BEGIN IMMEDIATE');
        try {
            const current = readVersion();
            assertSupported(current);
            for (let version = current; version < QAAP_SQLITE_SCHEMA_VERSION; version++) {
                QAAP_SQLITE_SCHEMA_MIGRATIONS[version](database);
                database.exec(`PRAGMA user_version = ${version + 1}`);
            }
            database.exec('COMMIT');
        } catch (error) {
            try {
                database.exec('ROLLBACK');
            } catch {
                // Preserve the original migration error.
            }
            throw error;
        }
    }
}

/** Resolve the SQLite sibling for a legacy JSON/JSONL path. */
export function resolveQaapSqlitePath(legacyPath: string): string {
    const configured = process.env.QAAP_SQLITE_STORE_PATH?.trim();
    if (configured) {
        return configured;
    }
    const extension = path.extname(legacyPath);
    return extension === '.json' || extension === '.jsonl'
        ? path.join(path.dirname(legacyPath), `${path.basename(legacyPath, extension)}.sqlite`)
        : `${legacyPath}.sqlite`;
}
