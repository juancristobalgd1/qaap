// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable } from '@theia/core/shared/inversify';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { QaapSqliteStore, resolveQaapSqlitePath } from '@theia/qaap-persistence/lib/node/qaap-sqlite-store';
import { resolveQaapReposRoot, resolveUserReposRoot } from '@theia/qaap-adapters/lib/common/qaap-user-isolation';
import type { QaapHostedWorktreeRegistry } from '@theia/qaap-shared-core/lib/node/qaap-hosted-worktree-registry';

/** One user's "Do you trust the files in this folder?" answer for one project folder. */
export interface QaapProjectFolderTrustRecord {
    readonly ownerLogin: string;
    /** Canonical absolute folder path (see {@link canonicalProjectFolder}). */
    readonly projectRoot: string;
    readonly trusted: boolean;
    readonly decidedAt: string;
}

/**
 * Canonical form of a project folder path: absolute, symlinks resolved when the folder exists, no trailing
 * separator. Keys the trust record so the same folder always maps to the same decision.
 */
export function canonicalProjectFolder(cwd: string): string {
    const resolved = path.resolve(cwd);
    try {
        return fs.realpathSync.native(resolved);
    } catch {
        return resolved;
    }
}

/**
 * Folder whose trust decision applies to a task running in `cwd`. A task worktree that the backend created
 * (recorded in the hosted worktree registry) maps to its project's clone, so the user's "Trust folder" on the
 * project covers its parallel tasks. Anything else keeps its own path. The registry is the only input that
 * can change the folder: the worktree's `.git` file is agent-writable and is never read here. A lookup
 * error returns `undefined`, which the caller treats as untrusted.
 */
export function resolveProjectFolderTrustRoot(
    registry: QaapHostedWorktreeRegistry | undefined,
    ownerLogin: string | undefined,
    cwd: string,
): string | undefined {
    try {
        const login = ownerLogin?.trim();
        const worktree = login && registry ? registry.lookup(login, cwd) : undefined;
        if (!login || !worktree) {
            return canonicalProjectFolder(cwd);
        }
        return canonicalProjectFolder(path.join(resolveUserReposRoot(resolveQaapReposRoot(), login), worktree.owner, worktree.repo));
    } catch {
        return undefined;
    }
}

/**
 * Persists per-user project folder trust decisions. Records are keyed by owner login + canonical folder,
 * so one user's decision never applies to another user. A missing record means "not decided", which the
 * runner treats as untrusted.
 */
@injectable()
export class QaapProjectFolderTrustStore {

    protected sqliteStore: QaapSqliteStore | undefined;

    get(ownerLogin: string | undefined, cwd: string): QaapProjectFolderTrustRecord | undefined {
        try {
            return this.getSqliteStore().get<QaapProjectFolderTrustRecord>(this.key(ownerLogin, cwd));
        } catch (error) {
            console.warn('[qaap-project-trust] store read failed:', error instanceof Error ? error.message : String(error));
            return undefined;
        }
    }

    /** True only for an explicit "Trust folder" decision. Undecided or unreadable folders are not trusted. */
    isTrusted(ownerLogin: string | undefined, cwd: string): boolean {
        return this.get(ownerLogin, cwd)?.trusted === true;
    }

    record(ownerLogin: string | undefined, cwd: string, trusted: boolean): QaapProjectFolderTrustRecord {
        const record: QaapProjectFolderTrustRecord = {
            ownerLogin: ownerLogin ?? '',
            projectRoot: canonicalProjectFolder(cwd),
            trusted,
            decidedAt: new Date().toISOString(),
        };
        this.getSqliteStore().set(this.key(ownerLogin, cwd), record);
        return record;
    }

    protected key(ownerLogin: string | undefined, cwd: string): string {
        return crypto.createHash('sha256').update(`${ownerLogin ?? ''}\u0000${canonicalProjectFolder(cwd)}`, 'utf8').digest('hex');
    }

    protected resolveDatabasePath(): string {
        return resolveQaapSqlitePath(path.join(os.homedir(), '.qaap', 'project-folder-trust.json'));
    }

    protected getSqliteStore(): QaapSqliteStore {
        return this.sqliteStore ??= new QaapSqliteStore({
            databasePath: this.resolveDatabasePath(),
            namespace: 'project-folder-trust',
        });
    }
}
