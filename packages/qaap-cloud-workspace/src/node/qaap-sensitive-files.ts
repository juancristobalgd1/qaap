// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Change detection for secrets files that git cannot see.
 *
 * The task safety net (edit detection → verification → adversarial review) is git-based, and
 * `.env`-style files are gitignored by design — so an agent that wholesale-overwrote a `.env`
 * looked like "no edits" and skipped review entirely. Observed live: a weak model replaced a
 * 31-line `.env` (every real credential) with a one-line placeholder and the task completed
 * clean. These helpers hash the sensitive files at task start and expose what changed, so the
 * runner can treat them as edits and force the high-risk review path.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

/** Absent file marker — distinguishes "deleted" from "hash of empty". */
const ABSENT = 'absent';

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
