// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Change detection and mechanical recovery for secrets files that git cannot see.
 *
 * The task safety net (edit detection → verification → adversarial review) is git-based, and
 * `.env`-style files are gitignored by design — so an agent that wholesale-overwrote a `.env`
 * looked like "no edits" and skipped review entirely. Observed live: a weak model replaced a
 * 31-line `.env` (every real credential) with a one-line placeholder and the task completed
 * clean. These helpers hash the sensitive files at task start (so the runner treats them as
 * edits), and snapshot their bytes privately so a failed review can restore them mechanically
 * — recovery must never depend on a model or on the agent having Read the file into its log.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

/** Absent file marker — distinguishes "deleted" from "hash of empty". */
const ABSENT = 'absent';

/** Skip pathological "secrets" files; real .env files are a few KB. */
const MAX_SNAPSHOT_BYTES = 1024 * 1024;

/** Root-level secrets files worth guarding. Deliberately tight: no deep scans, no node_modules. */
export function listSensitiveFileNames(cwd: string): string[] {
    let entries: string[];
    try {
        entries = fs.readdirSync(cwd);
    } catch {
        return [];
    }
    return entries
        .filter(name => name === '.env' || name.startsWith('.env.'))
        .filter(name => {
            try {
                return fs.statSync(path.join(cwd, name)).isFile();
            } catch {
                return false;
            }
        })
        .sort();
}

/**
 * Content hashes of every sensitive file at `cwd` root. Cheap (a handful of small files), safe on
 * unreadable files (skipped), and stable across runs.
 */
export function hashSensitiveFiles(cwd: string): Record<string, string> {
    const hashes: Record<string, string> = {};
    for (const name of listSensitiveFileNames(cwd)) {
        try {
            const content = fs.readFileSync(path.join(cwd, name));
            hashes[name] = crypto.createHash('sha256').update(content).digest('hex');
        } catch {
            // Unreadable now — treat as absent so a later successful read registers as a change.
        }
    }
    return hashes;
}

/**
 * Copy the sensitive files into a private per-task snapshot directory (0700/0600), so a destroyed
 * secrets file is restorable mechanically — recovery must never depend on the agent having
 * happened to Read the file into its log first. Returns the snapshotted names.
 */
export function snapshotSensitiveFiles(cwd: string, snapshotDir: string): string[] {
    const names = listSensitiveFileNames(cwd);
    if (names.length === 0) {
        return [];
    }
    fs.mkdirSync(snapshotDir, { recursive: true, mode: 0o700 });
    const saved: string[] = [];
    for (const name of names) {
        try {
            const source = path.join(cwd, name);
            if (fs.statSync(source).size > MAX_SNAPSHOT_BYTES) {
                continue;
            }
            fs.copyFileSync(source, path.join(snapshotDir, name));
            fs.chmodSync(path.join(snapshotDir, name), 0o600);
            saved.push(name);
        } catch {
            // Unreadable file — the hash side already treats it as absent.
        }
    }
    return saved;
}

/**
 * Restore the named files from a snapshot back into the workspace. Only used deliberately (a
 * recovery action), never automatically — the change may have been exactly what the user asked
 * for, and the reviewer, not this module, is who judges that.
 */
export function restoreSensitiveFiles(snapshotDir: string, cwd: string, names: readonly string[]): string[] {
    const restored: string[] = [];
    for (const name of names) {
        // Refuse anything that is not a plain root-level .env-style name.
        if (name !== path.basename(name) || !(name === '.env' || name.startsWith('.env.'))) {
            continue;
        }
        try {
            fs.copyFileSync(path.join(snapshotDir, name), path.join(cwd, name));
            restored.push(name);
        } catch {
            // Missing from the snapshot — nothing to restore.
        }
    }
    return restored;
}

/**
 * Sensitive files that changed between a baseline and now: modified, created, or deleted.
 * A missing baseline (tasks persisted before this field existed) reports no changes.
 */
export function diffSensitiveFiles(
    baseline: Readonly<Record<string, string>> | undefined,
    current: Readonly<Record<string, string>>,
): string[] {
    if (!baseline) {
        return [];
    }
    const names = new Set([...Object.keys(baseline), ...Object.keys(current)]);
    return [...names]
        .filter(name => (baseline[name] ?? ABSENT) !== (current[name] ?? ABSENT))
        .sort();
}
