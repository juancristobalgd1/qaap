// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable } from '@theia/core/shared/inversify';
import * as path from 'path';
import { QaapSqliteStore, resolveQaapSqlitePath } from '@theia/qaap-persistence/lib/node/qaap-sqlite-store';
import { resolveQaapReposRoot, resolveUserReposRoot, safeUserIdSegment } from '@theia/qaap-adapters/lib/common/qaap-user-isolation';
import { resolveQaapAuthStorePath } from './qaap-github-session-store';

/** The project a backend-created worktree belongs to, recorded when the backend created it. */
export interface QaapHostedWorktreeProject {
    /** {@link safeUserIdSegment} of the login that owns the worktree. */
    readonly login: string;
    readonly owner: string;
    readonly repo: string;
}

/**
 * Backend-held map from a conversation / parallel-run worktree path to the GitHub project it was cut
 * from. A hosted push from a worktree takes its destination `owner/repo` from here, never from the
 * worktree's `.git` file or the directory layout, which the agent writes (round-3 R3-1).
 *
 * Stored in the auth SQLite database, outside every tenant tree. A worktree that is not here (created
 * by an agent, or recorded before this registry existed) gets no hosted push.
 */
@injectable()
export class QaapHostedWorktreeRegistry {

    protected sqliteStore: QaapSqliteStore | undefined;

    /**
     * Records `worktreePath` as a worktree of the project whose checkout is `baseCwd`. `baseCwd` must
     * be the login's canonical clone `{reposRoot}/users/{login}/{owner}/{repo}` (lexically) or itself
     * a recorded worktree. Returns the recorded project, or `undefined` when `baseCwd` is neither.
     */
    register(login: string, baseCwd: string, worktreePath: string): QaapHostedWorktreeProject | undefined {
        const project = this.projectOf(login, baseCwd);
        if (project) {
            this.getStore().set(this.keyFor(worktreePath), project);
        }
        return project;
    }

    unregister(worktreePath: string): void {
        this.getStore().delete(this.keyFor(worktreePath));
    }

    /** The project recorded for `worktreePath` and `login`, if the backend created that worktree for them. */
    lookup(login: string, worktreePath: string): QaapHostedWorktreeProject | undefined {
        const project = this.getStore().get<QaapHostedWorktreeProject>(this.keyFor(worktreePath));
        return project && project.login === safeUserIdSegment(login) ? project : undefined;
    }

    /** `owner/repo` of a canonical clone path (lexical, `{userRoot}/{owner}/{repo}`) or of a recorded worktree. */
    projectOf(login: string, checkout: string): QaapHostedWorktreeProject | undefined {
        const userRoot = resolveUserReposRoot(this.reposRoot(), login);
        const relative = path.relative(userRoot, path.resolve(checkout));
        const segments = relative.split(path.sep);
        if (!path.isAbsolute(relative) && segments.length === 2 && segments.every(segment => segment && segment !== '.' && segment !== '..')) {
            return { login: safeUserIdSegment(login), owner: segments[0], repo: segments[1] };
        }
        return this.lookup(login, checkout);
    }

    /** Closes the database connection (Windows cannot delete an open SQLite file); the next call reopens it. */
    close(): void {
        this.sqliteStore?.close();
    }

    protected reposRoot(): string {
        return resolveQaapReposRoot();
    }

    protected keyFor(worktreePath: string): string {
        return path.resolve(worktreePath);
    }

    protected databasePath(): string {
        return resolveQaapSqlitePath(resolveQaapAuthStorePath());
    }

    protected getStore(): QaapSqliteStore {
        return this.sqliteStore ??= new QaapSqliteStore({
            databasePath: this.databasePath(),
            namespace: 'hosted-worktrees',
        });
    }
}
