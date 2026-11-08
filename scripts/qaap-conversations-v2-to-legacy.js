#!/usr/bin/env node
// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************
// @ts-check
'use strict';

/*
 * Rollback helper for the row-per-conversation store (doc/qaap-sqlite-persistence.md).
 *
 * Builds before the rows layout read one aggregate row, `agent-conversations`/`conversations`, which
 * newer builds never write. Started on such a build, a database would show the aggregate as it was at
 * the migration and hide everything newer. This script rebuilds that row from `agent-conversations.v2`.
 *
 * It overwrites the aggregate row, so it is careful:
 * - Without `--yes` it only reports what it would do (dry run).
 * - It refuses to run while anything else has the database open: stop the backend first. It takes
 *   an exclusive lock, which fails while a backend keeps its connection.
 * - Before writing it saves a consistent copy of the whole database next to it
 *   (`index.sqlite.pre-rollback-<time>`, made with VACUUM INTO) and checks the copy.
 * - Conversations that only the aggregate holds (none in v2) are lost by a rebuild; it lists them,
 *   and `--import-missing` keeps them in the new aggregate instead.
 *
 * It leaves the v2 rows and the migration mark alone, so going forward again merges by `updatedAt`.
 *
 * Usage:
 *   node scripts/qaap-conversations-v2-to-legacy.js [--yes] [--import-missing] <db>...
 * In a container, without the repo inside it (backend stopped):
 *   docker compose run --rm --no-deps -T -u root --entrypoint node theia - --yes /home/theia/.qaap/agent-conversations/index.sqlite < scripts/qaap-conversations-v2-to-legacy.js
 *
 * Exit codes: 0 done (or dry run); 1 a database failed; 2 bad usage; 3 a database does not fit an
 * earlier build; 4 the database is in use.
 */

const fs = require('node:fs');
const path = require('node:path');

const LEGACY_NAMESPACE = 'agent-conversations';
const ROWS_NAMESPACE = 'agent-conversations.v2';
const LEGACY_CONVERSATIONS_KEY = 'conversations';
const HIGH_WATER_KEY = 'worktreeOrdinalHighWater';
const HIGH_WATER_ROW_KEY = `meta:${HIGH_WATER_KEY}`;
/** Earlier builds read and write the aggregate as one V8 string; the hard limit is 0x1fffffe8 characters. */
const MAX_AGGREGATE_CHARS = 512 * 1024 * 1024;
const FREE_SPACE_MARGIN_BYTES = 64 * 1024 * 1024;

/** A database that cannot be represented for an earlier build. */
class QaapAggregateTooLargeError extends Error { }

/** The database is open somewhere else, usually by a running backend. */
class QaapDatabaseInUseError extends Error { }

/**
 * @param {string[]} argv
 * @returns {{ databases: string[], yes: boolean, importMissing: boolean }}
 */
function parseArguments(argv) {
    const options = { databases: [], yes: false, importMissing: false };
    for (const argument of argv) {
        if (argument === '--yes') {
            options.yes = true;
        } else if (argument === '--import-missing') {
            options.importMissing = true;
        } else if (argument.startsWith('-')) {
            throw new RangeError(`Unknown option: ${argument}`);
        } else {
            options.databases.push(argument);
        }
    }
    if (options.databases.length === 0) {
        throw new RangeError('Give at least one database.');
    }
    return options;
}

/**
 * Measures the aggregate the rebuild would write.
 *
 * @param {import('node:sqlite').DatabaseSync} database
 * @param {boolean} importMissing
 * @param {string} databasePath
 * @returns {{ total: number, chars: number, missing: string[] }}
 */
function planAggregate(database, importMissing, databasePath) {
    const rows = /** @type {{ count: number, chars: number }} */ (database.prepare(`
        SELECT count(*) AS count, COALESCE(sum(length(value) + 1), 0) AS chars
        FROM qaap_kv WHERE namespace = ? AND key >= 'conv:' AND key < 'conv;'
    `).get(ROWS_NAMESPACE));
    // Conversations only the aggregate holds: a rebuild from v2 alone would drop them.
    const missing = /** @type {Array<{ id: string, chars: number }>} */ (database.prepare(`
        SELECT json_extract(element.value, '$.id') AS id, length(element.value) + 1 AS chars
        FROM qaap_kv AS legacy, json_each(legacy.value) AS element
        WHERE legacy.namespace = ? AND legacy.key = ?
          AND NOT EXISTS (SELECT 1 FROM qaap_kv AS row WHERE row.namespace = ? AND row.key = 'conv:' || json_extract(element.value, '$.id'))
    `).all(LEGACY_NAMESPACE, LEGACY_CONVERSATIONS_KEY, ROWS_NAMESPACE));
    const total = Number(rows.count) + (importMissing ? missing.length : 0);
    const chars = 2 + Number(rows.chars) + (importMissing ? missing.reduce((sum, row) => sum + Number(row.chars), 0) : 0);
    if (chars > MAX_AGGREGATE_CHARS) {
        throw new QaapAggregateTooLargeError(`${databasePath}: ${total} conversations take ${chars} characters, `
            + `more than an earlier build can hold (${MAX_AGGREGATE_CHARS}). Nothing was changed. `
            + 'Roll back to a build with the rows layout instead.');
    }
    return { total, chars, missing: missing.map(row => String(row.id)) };
}

/**
 * Takes an exclusive lock that holds until the connection closes, so no backend can open the
 * database meanwhile, and fails at once when one already has it open.
 *
 * @param {import('node:sqlite').DatabaseSync} database
 * @param {string} databasePath
 */
function lockExclusively(database, databasePath) {
    try {
        database.exec('PRAGMA locking_mode = EXCLUSIVE');
        database.exec('BEGIN EXCLUSIVE');
        database.prepare('SELECT count(*) FROM qaap_kv').get();
        database.exec('COMMIT');
    } catch (error) {
        throw new QaapDatabaseInUseError(`${databasePath}: the database is in use (${error.message}). `
            + 'Stop the backend and run again. Nothing was changed.');
    }
}

/**
 * Saves a consistent copy of the database and checks it, before anything is written.
 *
 * @param {import('node:sqlite').DatabaseSync} database
 * @param {string} databasePath
 * @returns {string} the path of the copy.
 */
function backUpDatabase(database, databasePath) {
    const { DatabaseSync } = require('node:sqlite');
    const backupPath = `${databasePath}.pre-rollback-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    if (fs.existsSync(backupPath)) {
        throw new Error(`${backupPath} already exists. Nothing was changed.`);
    }
    database.prepare('VACUUM INTO ?').run(backupPath);
    const count = (/** @type {import('node:sqlite').DatabaseSync} */ db) => Number(/** @type {{ count: number }} */ (
        db.prepare('SELECT count(*) AS count FROM qaap_kv').get()).count);
    const copy = new DatabaseSync(backupPath, { readOnly: true });
    try {
        const check = /** @type {{ quick_check: string }} */ (copy.prepare('PRAGMA quick_check').get());
        if (check.quick_check !== 'ok' || count(copy) !== count(database)) {
            throw new Error(`${databasePath}: the backup ${backupPath} does not match the database. Nothing was changed.`);
        }
    } finally {
        copy.close();
    }
    return backupPath;
}

/**
 * Rebuilds the aggregate row of one database.
 *
 * @param {string} databasePath
 * @param {{ yes: boolean, importMissing: boolean }} options
 * @returns {string} what happened.
 */
function convertDatabase(databasePath, options) {
    const { DatabaseSync } = require('node:sqlite');
    if (!fs.existsSync(databasePath)) {
        throw new Error(`${databasePath} does not exist.`);
    }
    const database = new DatabaseSync(databasePath, { timeout: 0 });
    try {
        lockExclusively(database, databasePath);
        database.exec('PRAGMA synchronous = FULL;');
        const migrated = database.prepare('SELECT migrated_at FROM qaap_migration WHERE namespace = ?').get(ROWS_NAMESPACE);
        if (!migrated) {
            return 'skipped: not migrated to rows, the aggregate is current';
        }
        const plan = planAggregate(database, options.importMissing, databasePath);
        const missingNote = plan.missing.length === 0 ? ''
            : options.importMissing ? `; kept ${plan.missing.length} only the aggregate had: ${plan.missing.join(', ')}`
                : `; ${plan.missing.length} only the aggregate has would be dropped (they stay in the backup; --import-missing keeps them): ${plan.missing.join(', ')}`;
        if (!options.yes) {
            return `dry run (add --yes to write): would back up the database and write ${plan.total} conversations, ${plan.chars} characters${missingNote}`;
        }
        const pageBytes = /** @type {{ bytes: number }} */ (database.prepare(
            'SELECT page_count * page_size AS bytes FROM pragma_page_count(), pragma_page_size()',
        ).get());
        const free = fs.statfsSync(path.dirname(databasePath));
        const required = Number(pageBytes.bytes) + plan.chars * 2 + FREE_SPACE_MARGIN_BYTES;
        if (Number(free.bavail) * Number(free.bsize) < required) {
            throw new Error(`${databasePath}: ${Math.ceil(required / 1048576)} MiB of free disk space needed for the backup and the rebuild. Nothing was changed.`);
        }
        const backupPath = backUpDatabase(database, databasePath);
        database.exec('BEGIN IMMEDIATE');
        try {
            // Built by SQLite, so the aggregate never has to exist as one JavaScript string here.
            database.prepare(`
                WITH chosen(value) AS (
                    SELECT value FROM qaap_kv WHERE namespace = ? AND key >= 'conv:' AND key < 'conv;'
                    UNION ALL
                    SELECT element.value FROM qaap_kv AS legacy, json_each(legacy.value) AS element
                    WHERE ? AND legacy.namespace = ? AND legacy.key = ?
                      AND NOT EXISTS (SELECT 1 FROM qaap_kv AS row WHERE row.namespace = ? AND row.key = 'conv:' || json_extract(element.value, '$.id'))
                )
                INSERT INTO qaap_kv (namespace, key, value, updated_at)
                SELECT ?, ?, '[' || COALESCE(group_concat(value, ',' ORDER BY COALESCE(json_extract(value, '$.createdAt'), json_extract(value, '$.updatedAt'))), '') || ']', ?
                FROM chosen
                WHERE true
                ON CONFLICT(namespace, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
            `).run(ROWS_NAMESPACE, options.importMissing ? 1 : 0, LEGACY_NAMESPACE, LEGACY_CONVERSATIONS_KEY, ROWS_NAMESPACE,
                LEGACY_NAMESPACE, LEGACY_CONVERSATIONS_KEY, Date.now());
            database.prepare(`
                INSERT INTO qaap_kv (namespace, key, value, updated_at)
                SELECT ?, ?, value, ? FROM qaap_kv WHERE namespace = ? AND key = ?
                ON CONFLICT(namespace, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
            `).run(LEGACY_NAMESPACE, HIGH_WATER_KEY, Date.now(), ROWS_NAMESPACE, HIGH_WATER_ROW_KEY);
            const check = /** @type {{ count: number }} */ (database.prepare(
                'SELECT json_array_length(value) AS count FROM qaap_kv WHERE namespace = ? AND key = ?',
            ).get(LEGACY_NAMESPACE, LEGACY_CONVERSATIONS_KEY));
            if (check.count !== plan.total) {
                throw new Error(`${databasePath}: wrote ${check.count} conversations, expected ${plan.total}.`);
            }
            database.exec('COMMIT');
        } catch (error) {
            database.exec('ROLLBACK');
            throw error;
        }
        database.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();
        return `backed up to ${backupPath}; wrote ${plan.total} conversations, ${plan.chars} characters${missingNote}`;
    } finally {
        database.close();
    }
}

function main() {
    let options;
    try {
        options = parseArguments(process.argv.slice(2));
    } catch (error) {
        console.error(`[conversations-v2-to-legacy] ${error.message}`);
        return 2;
    }
    let exitCode = 0;
    for (const databasePath of new Set(options.databases.map(file => path.resolve(file)))) {
        try {
            console.log(`[conversations-v2-to-legacy] ${databasePath}: ${convertDatabase(databasePath, options)}`);
        } catch (error) {
            console.error(`[conversations-v2-to-legacy] ${databasePath}: ${error.message}`);
            const code = error instanceof QaapAggregateTooLargeError ? 3 : error instanceof QaapDatabaseInUseError ? 4 : 1;
            exitCode = exitCode === 0 || code === 1 ? code : exitCode;
        }
    }
    return exitCode;
}

process.exitCode = main();
