// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import * as fs from 'fs';
import * as path from 'path';
import { parse as parseJsonc, type ParseError } from 'jsonc-parser';
import {
    isSafeRelativeCredentialPath,
    type QaapHarnessCredentialPath,
} from '@theia/qaap-shared-core/lib/common/qaap-harness-sign-out';

export type QaapHarnessCredentialPathErrorCode =
    | 'invalid-path'
    | 'root-escape'
    | 'symlink-escape'
    | 'not-a-file'
    | 'invalid-json';

export class QaapHarnessCredentialPathError extends Error {
    constructor(readonly code: QaapHarnessCredentialPathErrorCode, message: string) {
        super(message);
        this.name = 'QaapHarnessCredentialPathError';
    }
}

export interface QaapHarnessCredentialRoots {
    /** Tenant or user HOME directory (must be an absolute path). */
    readonly home: string;
    /**
     * Additional roots that intermediate symlinks inside {@link home} may resolve into (e.g. the
     * tenant container's persistent disk storage `home` and `data` directories).
     */
    readonly extraRoots?: readonly string[];
    /** Effective environment used to resolve `XDG_DATA_HOME` / `PI_CODING_AGENT_DIR`. */
    readonly env?: NodeJS.ProcessEnv;
}

export interface ResolvedCredentialFileTarget {
    readonly exists: boolean;
    /** Canonical real path of the regular file (only present when {@link exists} is true). */
    readonly realPath?: string;
}

function tryRealpath(target: string): string {
    try {
        return fs.realpathSync(target);
    } catch {
        return path.resolve(target);
    }
}

function isWithinRoot(candidate: string, root: string): boolean {
    const relative = path.relative(root, candidate);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function isWithinAnyRoot(candidate: string, roots: readonly string[]): boolean {
    return roots.some(root => isWithinRoot(candidate, root));
}

function readLstatOrUndefined(target: string): fs.Stats | undefined {
    try {
        return fs.lstatSync(target);
    } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
            return undefined;
        }
        throw error;
    }
}

/**
 * Resolves one allowlisted {@link QaapHarnessCredentialPath} strictly within the tenant/user roots.
 * Rejects path traversal, intermediate symlinks escaping the allowed roots, symlink final targets,
 * and non-regular files (directories, FIFOs, devices).
 */
export function resolveAllowedCredentialFile(
    spec: QaapHarnessCredentialPath,
    roots: QaapHarnessCredentialRoots,
): ResolvedCredentialFileTarget {
    if (!roots.home || !path.isAbsolute(roots.home) || roots.home.includes('\0')) {
        throw new QaapHarnessCredentialPathError('invalid-path', 'Credential home root must be an absolute path.');
    }
    if (!isSafeRelativeCredentialPath(spec.relative)) {
        throw new QaapHarnessCredentialPathError('invalid-path', `Unsafe credential relative path: ${spec.relative}`);
    }

    const homeResolved = path.resolve(roots.home);
    const allowedRoots: string[] = [tryRealpath(homeResolved)];
    for (const extra of roots.extraRoots ?? []) {
        if (extra && path.isAbsolute(extra) && !extra.includes('\0')) {
            allowedRoots.push(tryRealpath(path.resolve(extra)));
        }
    }

    let baseDir: string;
    if (spec.root === 'home') {
        baseDir = homeResolved;
    } else {
        if (!isSafeRelativeCredentialPath(spec.root.fallback)) {
            throw new QaapHarnessCredentialPathError('invalid-path', `Unsafe credential fallback path: ${spec.root.fallback}`);
        }
        const envRaw = roots.env?.[spec.root.env]?.trim();
        if (envRaw) {
            if (!path.isAbsolute(envRaw) || envRaw.includes('\0')) {
                throw new QaapHarnessCredentialPathError('invalid-path', `Environment root ${spec.root.env} must be an absolute path.`);
            }
            baseDir = path.resolve(envRaw);
            allowedRoots.push(tryRealpath(baseDir));
        } else {
            baseDir = path.resolve(homeResolved, spec.root.fallback);
            if (!isWithinRoot(baseDir, homeResolved)) {
                throw new QaapHarnessCredentialPathError('root-escape', 'Credential fallback escaped home root.');
            }
        }
    }

    const candidate = path.resolve(baseDir, spec.relative);
    if (!isWithinRoot(candidate, baseDir)) {
        throw new QaapHarnessCredentialPathError('root-escape', 'Credential path escaped its allowed root.');
    }

    // Walk every segment from the base root (or home when using a fallback under home) so an
    // intermediate symlink cannot redirect us outside the allowed roots before we reach the file.
    const walkStart = spec.root === 'home' || !!roots.env?.[spec.root.env]?.trim()
        ? baseDir
        : homeResolved;
    const walkRel = path.relative(walkStart, candidate);
    const segments = walkRel.split(path.sep).filter(Boolean);
    if (segments.length === 0) {
        throw new QaapHarnessCredentialPathError('invalid-path', 'Credential path must name a file under the root.');
    }

    let current = walkStart;
    const rootStat = readLstatOrUndefined(current);
    if (!rootStat) {
        return { exists: false };
    }
    current = tryRealpath(current);
    if (!isWithinAnyRoot(current, allowedRoots)) {
        throw new QaapHarnessCredentialPathError('symlink-escape', 'Credential root symlink escapes allowed roots.');
    }

    for (let i = 0; i < segments.length; i++) {
        const segment = segments[i];
        const isLast = i === segments.length - 1;
        const nextPath = path.join(current, segment);
        const stat = readLstatOrUndefined(nextPath);
        if (!stat) {
            return { exists: false };
        }
        if (isLast) {
            if (stat.isSymbolicLink()) {
                throw new QaapHarnessCredentialPathError('symlink-escape', 'Refusing to modify a symlinked credential file.');
            }
            if (!stat.isFile()) {
                throw new QaapHarnessCredentialPathError('not-a-file', 'Credential target is not a regular file.');
            }
            const realTarget = fs.realpathSync(nextPath);
            if (!isWithinAnyRoot(realTarget, allowedRoots)) {
                throw new QaapHarnessCredentialPathError('symlink-escape', 'Credential file resolved outside allowed roots.');
            }
            return { exists: true, realPath: realTarget };
        }
        if (stat.isSymbolicLink()) {
            let resolvedDir: string;
            try {
                resolvedDir = fs.realpathSync(nextPath);
            } catch (error) {
                if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
                    return { exists: false };
                }
                throw error;
            }
            if (!isWithinAnyRoot(resolvedDir, allowedRoots)) {
                throw new QaapHarnessCredentialPathError('symlink-escape', 'Intermediate symlink escapes allowed credential roots.');
            }
            current = resolvedDir;
        } else if (stat.isDirectory()) {
            current = nextPath;
        } else {
            return { exists: false };
        }
    }

    return { exists: false };
}

/**
 * Deletes every existing allowlisted credential file under the tenant/user roots. Missing files are
 * treated as already signed out. Returns the number of files deleted.
 */
export function removeHarnessCredentialFiles(
    paths: readonly QaapHarnessCredentialPath[],
    roots: QaapHarnessCredentialRoots,
): number {
    let removed = 0;
    for (const spec of paths) {
        const target = resolveAllowedCredentialFile(spec, roots);
        if (!target.exists || !target.realPath) {
            continue;
        }
        try {
            fs.unlinkSync(target.realPath);
            removed++;
        } catch (error) {
            if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
                throw error;
            }
        }
    }
    return removed;
}

const O_NOFOLLOW = fs.constants.O_NOFOLLOW ?? 0;

/**
 * Removes only the allowlisted top-level keys from a JSON credential file, preserving all other
 * preferences and writing in-place with `O_NOFOLLOW` so existing owner/gid/mode/ACLs remain intact
 * (required in rootless / no-CAP_CHOWN tenant containers).
 *
 * Avoids `O_WRONLY | O_TRUNC` without `O_CREAT`, which fails with `EINVAL` on Windows because
 * libuv maps `O_TRUNC` alone to `TRUNCATE_EXISTING` while `O_WRONLY` opens with
 * `FILE_GENERIC_WRITE` rather than `GENERIC_WRITE`.
 *
 * Returns true when the file was updated.
 */
export function stripHarnessJsonCredentialKeys(
    spec: QaapHarnessCredentialPath,
    keys: readonly string[],
    roots: QaapHarnessCredentialRoots,
): boolean {
    const target = resolveAllowedCredentialFile(spec, roots);
    if (!target.exists || !target.realPath) {
        return false;
    }

    const fd = fs.openSync(target.realPath, fs.constants.O_RDWR | O_NOFOLLOW);
    try {
        if (!fs.fstatSync(fd).isFile()) {
            throw new QaapHarnessCredentialPathError('not-a-file', 'Credential target is not a regular file.');
        }
        const raw = fs.readFileSync(fd, 'utf8');

        const errors: ParseError[] = [];
        const parsed: unknown = parseJsonc(raw, errors, { allowTrailingComma: true });
        if (errors.length > 0 || !parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new QaapHarnessCredentialPathError('invalid-json', 'Credential JSON file could not be parsed.');
        }

        const record = parsed as Record<string, unknown>;
        let changed = false;
        for (const key of keys) {
            if (Object.prototype.hasOwnProperty.call(record, key)) {
                delete record[key];
                changed = true;
            }
        }
        if (!changed) {
            return false;
        }

        const buf = Buffer.from(`${JSON.stringify(record, undefined, 2)}\n`, 'utf8');
        fs.ftruncateSync(fd, 0);
        let offset = 0;
        while (offset < buf.length) {
            offset += fs.writeSync(fd, buf, offset, buf.length - offset, offset);
        }
        return true;
    } finally {
        fs.closeSync(fd);
    }
}

function isNonEmptyCredentialValue(value: unknown): boolean {
    if (typeof value === 'string') {
        return value.trim().length > 0;
    }
    if (Array.isArray(value)) {
        return value.length > 0;
    }
    if (value !== null && typeof value === 'object') {
        return Object.keys(value as Record<string, unknown>).length > 0;
    }
    return false;
}

/**
 * Read-only positive credential check for JSON/JSONC config files (e.g. Copilot CLI's
 * `~/.copilot/config.json`). Returns true only when the allowlisted file exists within the
 * owner's allowed roots, parses cleanly as a JSON/JSONC object, and holds at least one non-empty
 * value under {@link keys}. Missing, malformed or empty files return false without throwing.
 */
export function hasHarnessJsonCredentialKeys(
    spec: QaapHarnessCredentialPath,
    keys: readonly string[],
    roots: QaapHarnessCredentialRoots,
): boolean {
    try {
        const target = resolveAllowedCredentialFile(spec, roots);
        if (!target.exists || !target.realPath) {
            return false;
        }
        const raw = fs.readFileSync(target.realPath, 'utf8');
        const errors: ParseError[] = [];
        const parsed: unknown = parseJsonc(raw, errors, { allowTrailingComma: true });
        if (errors.length > 0 || !parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return false;
        }
        const record = parsed as Record<string, unknown>;
        return keys.some(key => Object.prototype.hasOwnProperty.call(record, key) && isNonEmptyCredentialValue(record[key]));
    } catch {
        return false;
    }
}
