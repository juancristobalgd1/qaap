// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable, optional } from '@theia/core/shared/inversify';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { resolveQaapWorktreesRoot, safeUserIdSegment } from '@theia/qaap-adapters/lib/common/qaap-user-isolation';
import { QaapTenantSpawnService } from './qaap-tenant-spawn-service';
import { QaapHostedWorktreeRegistry } from '@theia/qaap-shared-core/lib/node/qaap-hosted-worktree-registry';
import type { QaapApplyConversationWorktreeResponse } from '../common/qaap-agent-conversation';

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
    /** Tenant whose worktrees root hosts the temporary integration worktree of a merge. */
    readonly ownerLogin?: string;
}

export type QaapConversationWorktreeApplyResult = QaapApplyConversationWorktreeResponse;

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

    /** Records which project each worktree was cut from, so a hosted push from it cannot be redirected (R3-1). */
    @inject(QaapHostedWorktreeRegistry) @optional()
    protected readonly worktreeRegistry: QaapHostedWorktreeRegistry | undefined;

    async create(baseCwd: string, ownerLogin?: string): Promise<QaapConversationWorktree> {
        const cwd = path.resolve(baseCwd ?? '');
        if (!path.isAbsolute(cwd) || !this.isDirectory(cwd)) {
            throw new Error('A valid absolute "cwd" directory is required.');
        }
        await this.assertGitRepo(cwd);
        const slug = randomUUID().slice(0, 8);
        const branch = `qaap/worktree/${slug}`;
        const worktreePath = this.tenantWorktreePath(ownerLogin, slug);
        // SEC-1/C-3: run `git worktree add` (which checks out HEAD, applying tenant-controlled
        // clean/smudge filters) UNDER THE TENANT UID, so any filter/hook runs as the tenant, not root,
        // and the new worktree is tenant-owned. Provision the worktree parent tenant-owned first so the
        // dropped git can create the slug dir. No-op in dev / when uid-per-user is off (plain git).
        await this.ensureTenantContainerReady(cwd);
        this.tenantSpawn.provisionTenantDir(cwd, path.dirname(worktreePath));
        await this.mutatingGit(cwd, ['worktree', 'add', '-b', branch, worktreePath, 'HEAD']);
        if (ownerLogin?.trim()) {
            this.worktreeRegistry?.register(ownerLogin.trim(), cwd, worktreePath);
        }
        return { worktreePath, branch };
    }

    /**
     * `{worktreesRoot}/{tenant}/{name}`. Uses the same tenant segment as the repos root (safeUserIdSegment)
     * so the uid registry keys and the tenant-root isolation line up between repos and worktrees (SEC-1).
     */
    protected tenantWorktreePath(ownerLogin: string | undefined, name: string): string {
        const tenant = ownerLogin?.trim() ? safeUserIdSegment(ownerLogin.trim()) : '__anonymous__';
        return path.join(resolveQaapWorktreesRoot(), tenant, name);
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
            await this.ensureTenantContainerReady(baseCwd);
            await this.removeWorktree(baseCwd, worktreePath).catch(() => undefined);
            await this.deleteBranch(baseCwd, branch).catch(() => undefined);
            return { ok: true, branch };
        }

        // SEC-1: commit writes objects into the shared base-repo .git; merge checks out into
        // the base tree. Both must run as the tenant uid over a tenant-owned base repo.
        await this.ensureTenantContainerReady(baseCwd);
        if (this.isDirectory(worktreePath)) {
            await this.commitWorktree(worktreePath, `qaap: parallel fork ${branch}`);
        } else if (input.action === 'merge') {
            return { ok: false, error: 'The isolated worktree is no longer on disk.' };
        }

        if (input.action === 'merge') {
            const merged = await this.mergeBranchSafely(baseCwd, branch, input.ownerLogin);
            if (!merged.ok) {
                return merged;
            }
            await this.removeWorktree(baseCwd, worktreePath).catch(() => undefined);
            await this.deleteBranch(baseCwd, branch).catch(() => undefined);
            return { ok: true, branch };
        }

        await this.removeWorktree(baseCwd, worktreePath).catch(() => undefined);
        return { ok: true, branch };
    }

    /**
     * Merge `branch` into the branch checked out in `baseCwd` without ever leaving the base tree half-merged.
     * The `--no-ff` merge runs in a temporary integration worktree detached at the target tip T; only a clean
     * merge commit M is then landed from the base tree with `merge --ff-only M`, which refuses atomically
     * (no file touched) when the target moved past T or local changes would be overwritten. Any refusal
     * leaves the base tree, the target branch and `branch` untouched; the integration worktree is always removed.
     */
    async mergeBranchSafely(baseCwd: string, branch: string, ownerLogin?: string): Promise<QaapApplyConversationWorktreeResponse> {
        await this.ensureTenantContainerReady(baseCwd);
        const target = await this.currentBranch(baseCwd);
        if (!target) {
            return { ok: false, reason: 'detached', error: 'The repository is not on a branch (detached HEAD). Check out a branch, then merge again.' };
        }
        const tip = await this.headCommit(baseCwd);
        const integrationPath = this.tenantWorktreePath(ownerLogin, `integration-${randomUUID().slice(0, 8)}`);
        this.tenantSpawn.provisionTenantDir(baseCwd, path.dirname(integrationPath));
        try {
            await this.mutatingGit(baseCwd, ['worktree', 'add', '--detach', integrationPath, tip]);
            try {
                // --no-ff always creates a merge commit; identity must be set explicitly
                // (Windows CI runners often have no user.name / user.email configured).
                await this.mutatingGit(integrationPath, [
                    '-c', 'user.email=qaap@local', '-c', 'user.name=qaap',
                    'merge', '--no-ff', '--no-edit', branch,
                ]);
            } catch (error) {
                const conflicts = (await this.git(integrationPath, ['diff', '--name-only', '--diff-filter=U']).catch(() => ''))
                    .split('\n').map(line => line.trim()).filter(Boolean);
                await this.mutatingGit(integrationPath, ['merge', '--abort']).catch(() => undefined);
                return conflicts.length
                    ? { ok: false, reason: 'conflict', conflicts, error: `Merge conflicts in ${conflicts.join(', ')}. Nothing was changed.` }
                    : { ok: false, error: `Merge failed (nothing was changed): ${this.errorMessage(error)}` };
            }
            const merge = await this.headCommit(integrationPath);
            const moved = { ok: false, reason: 'target-moved', error: `"${target}" changed while merging. Nothing was changed; merge again.` } as const;
            if (await this.currentBranch(baseCwd) !== target || await this.headCommit(baseCwd) !== tip) {
                return moved;
            }
            try {
                await this.mutatingGit(baseCwd, ['merge', '--ff-only', merge]);
            } catch {
                // HEAD still at T: --ff-only refused because local changes would be overwritten (locale-independent check).
                return await this.headCommit(baseCwd) !== tip ? moved : {
                    ok: false,
                    reason: 'local-changes',
                    error: 'Your uncommitted changes would be overwritten by the merge. Commit or stash them, then merge again.',
                };
            }
            return { ok: true, branch };
        } finally {
            await this.removeWorktree(baseCwd, integrationPath).catch(() => undefined);
            await this.mutatingGit(baseCwd, ['worktree', 'prune']).catch(() => undefined);
        }
    }

    /** Branch checked out in `cwd`, or undefined when HEAD is detached. */
    protected async currentBranch(cwd: string): Promise<string | undefined> {
        return (await this.git(cwd, ['symbolic-ref', '--short', '-q', 'HEAD']).catch(() => '')).trim() || undefined;
    }

    protected async headCommit(cwd: string): Promise<string> {
        return (await this.git(cwd, ['rev-parse', 'HEAD'])).trim();
    }

    /**
     * Best-effort removal of the worktree + branch of a deleted conversation. Refuses (returns false)
     * unless `worktreePath` is exactly `{worktreesRoot}/{tenant}/{slug}` under the qaap worktrees root
     * (never a symlink, never the base checkout) and `branch` is a `qaap/worktree/*` branch.
     * Never throws: failures are logged.
     */
    async removeForDeletedConversation(input: { worktreePath: string; branch: string; baseCwd: string }): Promise<boolean> {
        try {
            const worktreePath = path.resolve(input.worktreePath ?? '');
            const baseCwd = path.resolve(input.baseCwd ?? '');
            const branch = (input.branch ?? '').trim();
            if (!this.isManagedWorktreePath(worktreePath) || !branch.startsWith('qaap/worktree/')
                || worktreePath === baseCwd || !this.isDirectory(baseCwd)) {
                return false;
            }
            await this.ensureTenantContainerReady(baseCwd);
            await this.removeWorktree(baseCwd, worktreePath).catch(error =>
                console.warn(`[qaap-worktree] could not remove ${worktreePath}: ${this.errorMessage(error)}`));
            await this.mutatingGit(baseCwd, ['worktree', 'prune']).catch(() => undefined);
            await this.deleteBranch(baseCwd, branch).catch(() => undefined);
            return true;
        } catch (error) {
            console.warn(`[qaap-worktree] cleanup failed: ${this.errorMessage(error)}`);
            return false;
        }
    }

    /** True only for `{root}/{tenant}/{slug}` below a qaap worktrees root, not a symlink. */
    protected isManagedWorktreePath(worktreePath: string): boolean {
        if (!path.isAbsolute(worktreePath)) {
            return false;
        }
        const relative = path.relative(path.resolve(resolveQaapWorktreesRoot()), worktreePath);
        const segments = relative.split(path.sep);
        const inside = relative !== '' && !path.isAbsolute(relative)
            && segments.length === 2 && segments.every(segment => segment !== '' && segment !== '..');
        if (!inside) {
            return false;
        }
        try {
            return !fs.lstatSync(worktreePath).isSymbolicLink();
        } catch {
            return true; // already gone: prune + branch delete are still harmless
        }
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
        this.worktreeRegistry?.unregister(worktreePath);
        await this.mutatingGit(cwd, ['worktree', 'remove', '--force', worktreePath]);
    }

    protected async deleteBranch(cwd: string, branch: string): Promise<void> {
        await this.mutatingGit(cwd, ['branch', '-D', branch]);
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

    protected async ensureTenantContainerReady(cwd: string): Promise<void> {
        const spawn = this.tenantSpawn as QaapTenantSpawnService & {
            prepareTenantIsolationAsync?: (target: string) => Promise<void>;
        };
        if (typeof spawn.prepareTenantIsolationAsync === 'function') {
            await spawn.prepareTenantIsolationAsync(cwd);
        } else {
            spawn.prepareTenantIsolation?.(cwd);
        }
    }

    protected async assertGitRepo(cwd: string): Promise<void> {
        try {
            await this.git(cwd, ['rev-parse', '--is-inside-work-tree']);
        } catch {
            throw new Error('Worktree tasks need the project to be a git repository.');
        }
    }

    protected async git(cwd: string, args: string[]): Promise<string> {
        // Read-only Git must use the same tenant boundary as worktree mutations. Git may still load
        // repository config, extensions, and filter metadata for a status/rev-parse query.
        await this.ensureTenantContainerReady(cwd);
        const wrapped = this.tenantSpawn.wrapGitForTenant(cwd, args);
        const { stdout } = await execFileAsync(wrapped.file, wrapped.args, { maxBuffer: GIT_MAX_BUFFER });
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
