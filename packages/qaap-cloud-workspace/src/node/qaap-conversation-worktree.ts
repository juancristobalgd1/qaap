// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { resolveQaapWorktreesRoot, safeUserIdSegment } from '@theia/qaap-adapters/lib/common/qaap-user-isolation';
import { QaapTenantSpawnService } from './qaap-tenant-spawn-service';

const execFileAsync = promisify(execFile);
const GIT_MAX_BUFFER = 16 * 1024 * 1024;

/** Result of provisioning an isolated worktree for a composer "New Worktree" task. */
export interface QaapConversationWorktree {
    /** Absolute path of the new worktree — used as the conversation's cwd. */
    readonly worktreePath: string;
    /** Branch backing the worktree (created off HEAD of the base repository). */
    readonly branch: string;
}

/** Keep / merge / discard an isolated Parallel worktree (delivery mode `'parallel'`). */
export type QaapConversationWorktreeApplyAction = 'keep-branch' | 'merge' | 'none';

export interface QaapConversationWorktreeApplyInput {
    readonly worktreePath: string;
    readonly branch: string;
    /** Base repository to merge into / unregister the worktree from. */
    readonly baseCwd: string;
    readonly action: QaapConversationWorktreeApplyAction;
}

export interface QaapConversationWorktreeApplyResult {
    readonly ok: boolean;
    readonly branch?: string;
    readonly error?: string;
}

/**
 * Provisions isolated git worktrees for single conversations started from the composer's
 * "New Worktree" destination. Mirrors the parallel-run layout: worktrees live under the OS
 * temp dir so they never pollute the repository's status, each on a fresh `qaap/worktree/*`
 * branch cut from HEAD.
 */
@injectable()
export class QaapConversationWorktreeService {

    @inject(QaapTenantSpawnService)
    protected readonly tenantSpawn: QaapTenantSpawnService;

    async create(baseCwd: string, ownerLogin?: string): Promise<QaapConversationWorktree> {
        const cwd = path.resolve(baseCwd ?? '');
        if (!path.isAbsolute(cwd) || !this.isDirectory(cwd)) {
            throw new Error('A valid absolute "cwd" directory is required.');
        }
        await this.assertGitRepo(cwd);
        const slug = randomUUID().slice(0, 8);
        const branch = `qaap/worktree/${slug}`;
        // Use the same tenant segment as the repos root (safeUserIdSegment) so the uid registry keys
        // and the tenant-root isolation line up between repos and worktrees (SEC-1).
        const tenant = ownerLogin?.trim() ? safeUserIdSegment(ownerLogin.trim()) : '__anonymous__';
        const worktreePath = path.join(resolveQaapWorktreesRoot(), tenant, slug);
        // SEC-1/C-3: run `git worktree add` (which checks out HEAD, applying tenant-controlled
        // clean/smudge filters) UNDER THE TENANT UID, so any filter/hook runs as the tenant, not root,
        // and the new worktree is tenant-owned. Provision the worktree parent tenant-owned first so the
        // dropped git can create the slug dir. No-op in dev / when uid-per-user is off (plain git).
        this.tenantSpawn.provisionTenantDir(cwd, path.dirname(worktreePath));
        await this.mutatingGit(cwd, ['worktree', 'add', '-b', branch, worktreePath, 'HEAD']);
        return { worktreePath, branch };
    }

    /**
     * Apply Keep / Merge / Discard to one isolated Parallel worktree. Mirrors
     * {@link QaapParallelRunStore.choose} for a single fork (no sibling variants).
     */
    async apply(input: QaapConversationWorktreeApplyInput): Promise<QaapConversationWorktreeApplyResult> {
        const worktreePath = path.resolve(input.worktreePath ?? '');
        const baseCwd = path.resolve(input.baseCwd ?? '');
        const branch = input.branch.trim();
        if (!branch) {
            throw new Error('A worktree branch is required.');
        }
        if (!path.isAbsolute(baseCwd) || !this.isDirectory(baseCwd)) {
            throw new Error('A valid absolute base repository directory is required.');
        }
        await this.assertGitRepo(baseCwd);

        if (input.action === 'none') {
            await this.removeWorktree(baseCwd, worktreePath).catch(() => undefined);
            await this.deleteBranch(baseCwd, branch).catch(() => undefined);
            return { ok: true, branch };
        }

        // SEC-1: commit writes objects into the shared base-repo .git; merge checks out into
        // the base tree. Both must run as the tenant uid over a tenant-owned base repo.
        this.tenantSpawn.prepareTenantIsolation(baseCwd);
        if (this.isDirectory(worktreePath)) {
            await this.commitWorktree(worktreePath, `qaap: parallel fork ${branch}`);
        } else if (input.action === 'merge') {
            return { ok: false, error: 'The isolated worktree is no longer on disk.' };
        }

        if (input.action === 'merge') {
            try {
                // --no-ff always creates a merge commit; identity must be set explicitly
                // (Windows CI runners often have no user.name / user.email configured).
                await this.mutatingGit(baseCwd, [
                    '-c', 'user.email=qaap@local', '-c', 'user.name=qaap',
                    'merge', '--no-ff', '--no-edit', branch,
                ]);
            } catch (error) {
                await this.mutatingGit(baseCwd, ['merge', '--abort']).catch(() => undefined);
                return {
                    ok: false,
                    error: `Merge failed (your tree was left untouched): ${this.errorMessage(error)}`,
                };
            }
            await this.removeWorktree(baseCwd, worktreePath).catch(() => undefined);
            await this.deleteBranch(baseCwd, branch).catch(() => undefined);
            return { ok: true, branch };
        }

        await this.removeWorktree(baseCwd, worktreePath).catch(() => undefined);
        return { ok: true, branch };
    }

    protected async commitWorktree(worktreePath: string, message: string): Promise<void> {
        const status = await this.git(worktreePath, ['status', '--porcelain']);
        if (!status.trim()) {
            return;
        }
        await this.mutatingGit(worktreePath, ['add', '-A']);
        await this.mutatingGit(worktreePath, [
            '-c', 'user.email=qaap@local', '-c', 'user.name=qaap',
            'commit', '--no-verify', '-m', message,
        ]);
    }

    protected async removeWorktree(cwd: string, worktreePath: string): Promise<void> {
        await this.git(cwd, ['worktree', 'remove', '--force', worktreePath]);
    }

    protected async deleteBranch(cwd: string, branch: string): Promise<void> {
        await this.git(cwd, ['branch', '-D', branch]);
    }

    protected errorMessage(error: unknown): string {
        return error instanceof Error ? error.message : String(error);
    }

    /** Run a MUTATING git over the tenant repo under the tenant uid (setpriv). See QaapTenantSpawnService. */
    protected async mutatingGit(cwd: string, args: string[]): Promise<string> {
        const wrapped = this.tenantSpawn.wrapGitForTenant(cwd, args);
        const { stdout } = await execFileAsync(wrapped.file, wrapped.args, { maxBuffer: GIT_MAX_BUFFER });
        return stdout;
    }

    protected async assertGitRepo(cwd: string): Promise<void> {
        try {
            await this.git(cwd, ['rev-parse', '--is-inside-work-tree']);
        } catch {
            throw new Error('Worktree tasks need the project to be a git repository.');
        }
    }

    protected async git(cwd: string, args: string[]): Promise<string> {
        // SEC-1/C-3 hardening: `git worktree add` checks out HEAD into a new tree as the backend uid
        // (root in prod) over a repo the tenant controls. Disable hooks so a `.git/hooks/*` planted by
        // the tenant cannot execute as root on checkout. (Residual: a tenant-defined clean/smudge FILTER
        // in `.git/config` can still run during the checkout — the complete fix is to run this under the
        // tenant uid, which needs the worktree parent provisioned first; gated on the multi-tenant flip,
        // see SECURITY.md.)
        const { stdout } = await execFileAsync('git', ['-c', 'core.hooksPath=/dev/null', '-C', cwd, ...args], { maxBuffer: GIT_MAX_BUFFER });
        return stdout;
    }

    protected isDirectory(p: string): boolean {
        try {
            return fs.statSync(p).isDirectory();
        } catch {
            return false;
        }
    }
}
