// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { DatabaseSync, StatementSync } from 'node:sqlite';
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface QaapSqliteStoreOptions {
    readonly databasePath: string;
    readonly namespace: string;
    readonly legacyPath?: string;
    /** Connection registry; defaults to the process-wide `QaapSqliteConnectionRegistry.shared`. */
    readonly registry?: QaapSqliteConnectionRegistry;
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

const QAAP_SQLITE_UPSERT_SQL = `
    INSERT INTO qaap_kv (namespace, key, value, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(namespace, key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
`;

const QAAP_SQLITE_FILE_SUFFIXES = ['', '-wal', '-shm'];

/**
 * One long-lived connection to a SQLite file, shared by every store (namespace) that uses the same
 * path. PRAGMAs and schema migrations run once when it is opened; prepared statements are cached
 * per SQL string. Keeping it open avoids re-opening, re-preparing and, above all, the WAL
 * checkpoint + delete that SQLite performs whenever the last connection to a WAL database closes.
 */
export class QaapSqliteConnection {

    /** Depth of the running (possibly nested) transaction on this connection; 0 when idle. */
    transactionDepth = 0;
    protected readonly statements = new Map<string, StatementSync>();
    protected walPermissionsTightened = false;
    protected open = true;

    constructor(
        readonly databasePath: string,
        readonly database: DatabaseSync,
        protected readonly fileIdentity: string | undefined,
    ) { }

    get isOpen(): boolean {
        return this.open;
    }

    prepare(sql: string): StatementSync {
        let statement = this.statements.get(sql);
        if (!statement) {
            statement = this.database.prepare(sql);
            this.statements.set(sql, statement);
        }
        return statement;
    }

    /**
     * Whether the file on disk is still the one this connection opened. A caller that deletes or
     * replaces the database (possible on POSIX while it is open) must not keep writing to the
     * orphaned inode.
     */
    matchesFile(): boolean {
        return QaapSqliteConnection.identify(this.databasePath) === this.fileIdentity;
    }

    /** Restricts the WAL/SHM companions once, after the first write created them. */
    afterWrite(): void {
        if (!this.walPermissionsTightened) {
            this.walPermissionsTightened = true;
            QaapSqliteConnection.tightenPermissions(this.databasePath);
        }
    }

    close(): void {
        if (!this.open) {
            return;
        }
        if (this.transactionDepth > 0) {
            throw new Error(`Cannot close Qaap SQLite store ${this.databasePath} while a transaction is running.`);
        }
        this.open = false;
        this.statements.clear();
        this.database.close();
    }
}

export namespace QaapSqliteConnection {
    export function identify(databasePath: string): string | undefined {
        try {
            const stat = fs.statSync(databasePath, { bigint: true, throwIfNoEntry: false });
            return stat ? `${stat.dev}:${stat.ino}` : undefined;
        } catch {
            return undefined;
        }
    }

    export function tightenPermissions(databasePath: string): void {
        for (const suffix of QAAP_SQLITE_FILE_SUFFIXES) {
            try { fs.chmodSync(`${databasePath}${suffix}`, 0o600); } catch { /* best effort */ }
        }
    }
}

/**
 * Holds at most one open {@link QaapSqliteConnection} per absolute database path. Connections are
 * opened lazily and stay open until {@link close}, {@link closeUnder} or {@link closeAll} (also run
 * on process exit). On Windows an open SQLite file cannot be deleted, so code that removes a
 * database or its directory must close it first.
 */
export class QaapSqliteConnectionRegistry {

    /** Process-wide registry used by stores that are not given one explicitly. */
    static readonly shared = new QaapSqliteConnectionRegistry();

    protected readonly connections = new Map<string, QaapSqliteConnection>();
    protected exitHookInstalled = false;

    acquire(databasePath: string): QaapSqliteConnection {
        const key = this.key(databasePath);
        const existing = this.connections.get(key);
        if (existing?.isOpen && (existing.transactionDepth > 0 || existing.matchesFile())) {
            return existing;
        }
        if (existing) {
            this.connections.delete(key);
            try { existing.close(); } catch { /* the file is gone; drop the handle anyway */ }
        }
        const connection = this.openConnection(path.resolve(databasePath));
        this.connections.set(key, connection);
        this.installExitHook();
        return connection;
    }

    /** Whether a connection to `databasePath` is currently open. */
    isOpen(databasePath: string): boolean {
        return this.connections.get(this.key(databasePath))?.isOpen === true;
    }

    /** Closes the connection to `databasePath`, if any; the next store operation reopens it. */
    close(databasePath: string): void {
        const key = this.key(databasePath);
        const connection = this.connections.get(key);
        if (connection) {
            connection.close();
            this.connections.delete(key);
        }
    }

    /** Closes every connection whose database lives inside `directory` (e.g. before removing it). */
    closeUnder(directory: string): void {
        const prefix = this.key(directory).replace(/[\\/]+$/, '') + path.sep;
        for (const key of [...this.connections.keys()]) {
            if (key.startsWith(prefix)) {
                this.connections.get(key)!.close();
                this.connections.delete(key);
            }
        }
    }

    closeAll(): void {
        for (const [key, connection] of [...this.connections]) {
            try {
                connection.close();
            } finally {
                this.connections.delete(key);
            }
        }
    }

    protected key(databasePath: string): string {
        const resolved = path.resolve(databasePath);
        return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
    }

    protected openConnection(databasePath: string): QaapSqliteConnection {
        fs.mkdirSync(path.dirname(databasePath), { recursive: true, mode: 0o700 });
        const database = this.openDatabase(databasePath);
        try {
            database.exec(`
                PRAGMA journal_mode = WAL;
                PRAGMA synchronous = FULL;
                PRAGMA foreign_keys = ON;
                PRAGMA busy_timeout = 5000;
            `);
            this.migrateSchema(databasePath, database);
        } catch (error) {
            database.close();
            throw error;
        }
        QaapSqliteConnection.tightenPermissions(databasePath);
        return new QaapSqliteConnection(databasePath, database, QaapSqliteConnection.identify(databasePath));
    }

    protected openDatabase(databasePath: string): DatabaseSync {
        return new DatabaseSync(databasePath, { timeout: 5_000 });
    }

    /**
     * Applies pending QAAP_SQLITE_SCHEMA_MIGRATIONS in one IMMEDIATE transaction (re-reading the
     * version under the write lock, so concurrent processes cannot apply a step twice). A database
     * newer than this build is refused instead of being written with an older schema.
     */
    protected migrateSchema(databasePath: string, database: DatabaseSync): void {
        const readVersion = (): number =>
            Number((database.prepare('PRAGMA user_version').get() as { user_version?: number } | undefined)?.user_version ?? 0);
        const assertSupported = (version: number): void => {
            if (version > QAAP_SQLITE_SCHEMA_VERSION) {
                throw new Error(`Qaap SQLite store ${databasePath} has schema version ${version}, `
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

    protected installExitHook(): void {
        if (!this.exitHookInstalled) {
            this.exitHookInstalled = true;
            // Closing checkpoints the WAL back into the main file; best effort at shutdown.
            process.once('exit', () => {
                try { this.closeAll(); } catch { /* shutting down */ }
            });
        }
    }
}

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
 * All stores on the same file share one long-lived connection from a
 * {@link QaapSqliteConnectionRegistry}. On Windows an open SQLite file cannot be deleted, so
 * callers and specs that remove a store's database or directory must call {@link close} (or
 * `QaapSqliteConnectionRegistry.shared.closeUnder(directory)` / `closeAll()`) first; the next
 * operation transparently reopens the connection.
 */
export class QaapSqliteStore {

    protected readonly databasePath: string;
    protected readonly namespace: string;
    protected readonly registry: QaapSqliteConnectionRegistry;
    protected legacyPath: string | undefined;

    constructor(options: QaapSqliteStoreOptions) {
        this.databasePath = options.databasePath;
        this.namespace = options.namespace;
        this.registry = options.registry ?? QaapSqliteConnectionRegistry.shared;
        this.legacyPath = options.legacyPath;
        // Open eagerly so a missing directory, bad permissions or a too-new schema fail fast.
        this.registry.acquire(this.databasePath);
    }

    get<T>(key: string): T | undefined {
        return this.withConnection(connection => {
            const row = connection.prepare(
                'SELECT value FROM qaap_kv WHERE namespace = ? AND key = ?',
            ).get(this.namespace, key) as { value?: string } | undefined;
            if (!row?.value) {
                return undefined;
            }
            return JSON.parse(row.value) as T;
        });
    }

    list<T>(): QaapSqliteEntry<T>[] {
        return this.withConnection(connection => {
            const rows = connection.prepare(
                'SELECT key, value FROM qaap_kv WHERE namespace = ? ORDER BY key',
            ).all(this.namespace) as Array<{ key: string; value: string }>;
            return rows.map(row => [row.key, JSON.parse(row.value) as T]);
        });
    }

    set<T>(key: string, value: T): void {
        this.withConnection(connection => {
            connection.prepare(QAAP_SQLITE_UPSERT_SQL).run(this.namespace, key, JSON.stringify(value), Date.now());
            connection.afterWrite();
        });
    }

    delete(key: string): boolean {
        return this.withConnection(connection => {
            const result = connection.prepare(
                'DELETE FROM qaap_kv WHERE namespace = ? AND key = ?',
            ).run(this.namespace, key);
            connection.afterWrite();
            return result.changes > 0;
        });
    }

    replace<T>(entries: readonly QaapSqliteEntry<T>[]): void {
        this.withConnectionTransaction(connection => {
            connection.prepare('DELETE FROM qaap_kv WHERE namespace = ?').run(this.namespace);
            const statement = connection.prepare(QAAP_SQLITE_UPSERT_SQL);
            const now = Date.now();
            for (const [key, value] of entries) {
                statement.run(this.namespace, key, JSON.stringify(value), now);
            }
        });
    }

    /**
     * Runs `operation` atomically. Nested calls (from this or any other store on the same file)
     * share the connection and use a SAVEPOINT, so an inner failure rolls back only the inner work.
     * `operation` must be synchronous.
     */
    withTransaction<T>(operation: (database: DatabaseSync) => T): T {
        return this.withConnectionTransaction(connection => operation(connection.database));
    }

    /**
     * Closes the connection to this store's database file (shared with other stores on the same
     * path). Any later operation reopens it, so this is safe to call before deleting the file.
     */
    close(): void {
        this.registry.close(this.databasePath);
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
        const migrationSql = 'SELECT 1 FROM qaap_migration WHERE namespace = ?';
        const migrated = this.withConnection(connection => connection.prepare(migrationSql).get(this.namespace));
        if (migrated) {
            return;
        }
        const raw = fs.readFileSync(sourcePath, 'utf8');
        const entries = [...loader(raw)];
        this.withConnectionTransaction(connection => {
            if (connection.prepare(migrationSql).get(this.namespace)) {
                return;
            }
            const hasRows = connection.prepare(
                'SELECT 1 FROM qaap_kv WHERE namespace = ? LIMIT 1',
            ).get(this.namespace);
            if (!hasRows && entries.length > 0) {
                const statement = connection.prepare(QAAP_SQLITE_UPSERT_SQL);
                const now = Date.now();
                for (const [key, value] of entries) {
                    statement.run(this.namespace, key, JSON.stringify(value), now);
                }
            }
            connection.prepare(`
                INSERT INTO qaap_migration (namespace, source_path, migrated_at)
                VALUES (?, ?, ?)
            `).run(this.namespace, sourcePath, Date.now());
        });
    }

    protected withConnectionTransaction<T>(operation: (connection: QaapSqliteConnection) => T): T {
        return this.withConnection(connection => {
            if (connection.transactionDepth > 0) {
                return this.runInSavepoint(connection, operation);
            }
            connection.database.exec('BEGIN IMMEDIATE');
            connection.transactionDepth = 1;
            try {
                const result = operation(connection);
                connection.database.exec('COMMIT');
                connection.afterWrite();
                return result;
            } catch (error) {
                try {
                    connection.database.exec('ROLLBACK');
                } catch {
                    // Preserve the original operation error.
                }
                throw error;
            } finally {
                connection.transactionDepth = 0;
            }
        });
    }

    protected runInSavepoint<T>(connection: QaapSqliteConnection, operation: (connection: QaapSqliteConnection) => T): T {
        const savepoint = `qaap_sp_${connection.transactionDepth}`;
        connection.database.exec(`SAVEPOINT ${savepoint}`);
        connection.transactionDepth++;
        try {
            const result = operation(connection);
            connection.database.exec(`RELEASE ${savepoint}`);
            return result;
        } catch (error) {
            try {
                connection.database.exec(`ROLLBACK TO ${savepoint}`);
                connection.database.exec(`RELEASE ${savepoint}`);
            } catch {
                // Preserve the original operation error.
            }
            throw error;
        } finally {
            connection.transactionDepth--;
        }
    }

    protected withConnection<T>(operation: (connection: QaapSqliteConnection) => T): T {
        return operation(this.registry.acquire(this.databasePath));
    }

    /** Runs `operation` on the shared connection (kept for subclasses written against the old API). */
    protected withDatabase<T>(operation: (database: DatabaseSync) => T): T {
        return this.withConnection(connection => operation(connection.database));
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
