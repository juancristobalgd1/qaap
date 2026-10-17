// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import * as fs from 'fs';
import * as path from 'path';
import { inject, injectable, optional } from '@theia/core/shared/inversify';
import {
    resolveQaapParallelRoot,
    resolveQaapReposRoot,
    resolveQaapWorktreesRoot,
    resolveRepositoryWorkspacePath,
    resolveUserReposRoot,
} from '@theia/qaap-adapters/lib/common/qaap-user-isolation';
import { QaapHostedWorktreeRegistry } from './qaap-hosted-worktree-registry';

/** The GitHub project a hosted push goes to, and the verified real objects directory of its clone. */
export interface QaapHostedProject {
    readonly owner: string;
    readonly repo: string;
    readonly objectsDirectory: string;
}

/** Read-only git in `cwd`; resolves stdout, rejects on a non-zero exit. */
export type QaapHostedProjectGit = (cwd: string, args: string[]) => Promise<string>;

/** Where a login's canonical clones live; defaults to the operator-configured repos root. */
export interface QaapHostedProjectLayout {
    /** `{reposRoot}/users/{login}`. */
    readonly userRoot: string;
    /** The canonical clone of `owner/repo` for the login. */
    repositoryPath(owner: string, repo: string): string | undefined;
    /** The project the backend recorded for a worktree it created for the login. */
    lookupWorktree(login: string, checkout: string): { readonly owner: string; readonly repo: string } | undefined;
}

/** GitHub owner and repository names as they appear in a project's clone path. */
export const QAAP_GITHUB_OWNER_SEGMENT = /^[A-Za-z0-9-]+$/;
export const QAAP_GITHUB_REPO_SEGMENT = /^[A-Za-z0-9_.-]+$/;

/**
 * Resolves which GitHub project a checkout belongs to from backend-held state only, so a hosted push
 * (git review, task pull requests) can never be pointed elsewhere by anything the agent writes.
 *
 * Agents write `.git/config`, the `.git` file of a worktree and every directory under the user's repos
 * tree. The destination therefore comes from the checkout path itself when it is the canonical clone
 * `{reposRoot}/users/{login}/{owner}/{repo}` (lexically), or from the project the backend recorded when
 * it created the worktree ({@link QaapHostedWorktreeRegistry}). Then:
 * - every component from the repos root down to `{owner}/{repo}/.git/objects` (and from the worktrees
 *   root down to a worktree) is a real directory, checked with `lstat`, and the real path equals the
 *   lexical path under the real root, so no symlink anywhere;
 * - the clone's `.git` is a directory, not a gitfile;
 * - git's common dir is that `.git`, and its git dir is that `.git` (clone) or one of its
 *   `worktrees/*` entries (worktree), compared as real paths.
 */
@injectable()
export class QaapHostedProjectResolver {

    /** Without it a worktree has no recorded project, so it resolves to `undefined`. */
    @inject(QaapHostedWorktreeRegistry) @optional()
    protected readonly worktreeRegistry: QaapHostedWorktreeRegistry | undefined;

    /** The project `checkout` of `login` belongs to, or `undefined` (fail closed). */
    async resolve(
        login: string | undefined,
        checkout: string,
        git: QaapHostedProjectGit,
        layout: QaapHostedProjectLayout | undefined = login ? this.defaultLayout(login) : undefined,
    ): Promise<QaapHostedProject | undefined> {
        if (!login || !layout) {
            return undefined;
        }
        const userRoot = layout.userRoot;
        const resolvedCheckout = path.resolve(checkout);
        const relative = path.relative(userRoot, resolvedCheckout);
        const segments = relative.split(path.sep);
        const isClone = !path.isAbsolute(relative) && segments.length === 2;
        const project = isClone ? { owner: segments[0], repo: segments[1] } : layout.lookupWorktree(login, resolvedCheckout);
        if (!project || !QAAP_GITHUB_OWNER_SEGMENT.test(project.owner) || !QAAP_GITHUB_REPO_SEGMENT.test(project.repo)
            || project.repo === '.' || project.repo === '..') {
            return undefined;
        }
        const projectPath = layout.repositoryPath(project.owner, project.repo);
        if (!projectPath || path.relative(path.join(userRoot, project.owner, project.repo), projectPath) !== '') {
            return undefined;
        }
        // `{reposRoot}/users/{login}`: the repos root is operator configuration, everything below it may be agent-owned.
        const reposRoot = path.dirname(path.dirname(userRoot));
        const realObjects = this.realDirectoryBelow(reposRoot, path.join(projectPath, '.git', 'objects'));
        if (!realObjects) {
            return undefined;
        }
        const realCommonDir = path.dirname(realObjects);
        if (!isClone) {
            const worktreeBase = this.worktreeRoots().find(base => path.relative(base, resolvedCheckout) !== ''
                && this.isPathInside(resolvedCheckout, base));
            if (!worktreeBase || !this.realDirectoryBelow(worktreeBase, resolvedCheckout) || !this.isRegularFile(path.join(resolvedCheckout, '.git'))) {
                return undefined;
            }
        }
        const gitCommonDir = this.realPathOrUndefined((await git(resolvedCheckout, ['rev-parse', '--path-format=absolute', '--git-common-dir'])).trim());
        const gitDir = this.realPathOrUndefined((await git(resolvedCheckout, ['rev-parse', '--absolute-git-dir'])).trim());
        if (!gitCommonDir || !gitDir || !this.samePath(gitCommonDir, realCommonDir)) {
            return undefined;
        }
        const ownGitDir = isClone ? this.samePath(gitDir, realCommonDir) : this.samePath(path.dirname(gitDir), path.join(realCommonDir, 'worktrees'));
        return ownGitDir ? { owner: project.owner, repo: project.repo, objectsDirectory: realObjects } : undefined;
    }

    protected defaultLayout(login: string): QaapHostedProjectLayout {
        const reposRoot = this.reposRoot();
        return {
            userRoot: resolveUserReposRoot(reposRoot, login),
            repositoryPath: (owner, repo) => resolveRepositoryWorkspacePath(reposRoot, login, owner, repo),
            lookupWorktree: (worktreeLogin, checkout) => this.worktreeRegistry?.lookup(worktreeLogin, checkout),
        };
    }

    protected reposRoot(): string {
        return resolveQaapReposRoot();
    }

    protected worktreeRoots(): string[] {
        return [resolveQaapWorktreesRoot(), resolveQaapParallelRoot()];
    }

    /**
     * Real path of directory `target` below `base`, or `undefined` unless every component after `base`
     * is a directory and not a symlink (or junction), checked with `lstat`, and the real path is the
     * lexical path under the real `base`.
     */
    protected realDirectoryBelow(base: string, target: string): string | undefined {
        const relative = path.relative(base, target);
        if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
            return undefined;
        }
        const realBase = this.realPathOrUndefined(base);
        if (!realBase) {
            return undefined;
        }
        let current = base;
        for (const segment of relative.split(path.sep)) {
            current = path.join(current, segment);
            const stat = this.lstatOrUndefined(current);
            if (!stat || stat.isSymbolicLink() || !stat.isDirectory()) {
                return undefined;
            }
        }
        const real = this.realPathOrUndefined(target);
        return real && this.samePath(real, path.join(realBase, relative)) ? real : undefined;
    }

    protected isRegularFile(target: string): boolean {
        const stat = this.lstatOrUndefined(target);
        return !!stat && stat.isFile();
    }

    protected lstatOrUndefined(target: string): fs.Stats | undefined {
        try {
            return fs.lstatSync(target);
        } catch {
            return undefined;
        }
    }

    /** Real paths are compared case-insensitively on Windows, where the file system is. */
    protected samePath(left: string, right: string): boolean {
        return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
    }

    protected realPathOrUndefined(target: string): string | undefined {
        try {
            return fs.realpathSync.native(target);
        } catch {
            return undefined;
        }
    }

    protected isPathInside(target: string, parent: string): boolean {
        const relative = path.relative(parent, target);
        return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
    }
}
