// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import { BackendApplicationContribution } from '@theia/core/lib/node';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fsp from 'fs/promises';
import * as path from 'path';
import { resolveQaapWorktreesRoot } from '@theia/qaap-adapters/lib/common/qaap-user-isolation';
import { QaapAgentTaskRunner } from './qaap-agent-task-runner';

const execFileAsync = promisify(execFile);

/** Sweep cadence once running (first sweep is delayed so it never slows boot). */
const SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000;
const FIRST_SWEEP_DELAY_MS = 5 * 60 * 1000;

/**
 * Garbage-collects abandoned per-conversation git worktrees under `{tmpdir}/qaap-worktrees`.
 *
 * Every "New Worktree" conversation and every auto-worktree (spawned when agents would collide
 * on the same tree) creates a worktree + a `qaap/worktree/*` branch that nothing ever removed —
 * they accumulate in the container tmpdir AND in the base repository's `git worktree list`
 * forever. A worktree is collected only when ALL of:
 *   - it is older than `QAAP_WORKTREE_GC_DAYS` (default 7; `0` disables the GC entirely), by
 *     BOTH its directory mtime and its last commit time — recent activity on either keeps it;
 *   - no running/queued agent task uses it as cwd;
 *   - `git status --porcelain` is EMPTY — a dirty tree may hold unmerged agent/user work, so it
 *     is skipped (and logged) rather than destroyed. Committed work survives regardless: the
 *     `qaap/worktree/*` branch stays in the base repository.
 *
 * After removing the directory, `git worktree prune` in the base repository drops the stale
 * registration.
 */
@injectable()
export class QaapWorktreeGcContribution implements BackendApplicationContribution {

    @inject(QaapAgentTaskRunner)
    protected readonly runner: QaapAgentTaskRunner;

    onStart(): void {
        if (this.maxAgeMs() <= 0) {
            return; // QAAP_WORKTREE_GC_DAYS=0 → disabled
        }
        const first = setTimeout(() => { void this.sweep(); }, FIRST_SWEEP_DELAY_MS);
        first.unref?.();
        const interval = setInterval(() => { void this.sweep(); }, SWEEP_INTERVAL_MS);
        interval.unref?.();
    }

    protected maxAgeMs(): number {
        const raw = process.env.QAAP_WORKTREE_GC_DAYS?.trim();
        const days = raw === undefined || raw === '' ? 7 : Number(raw);
        if (!Number.isFinite(days) || days <= 0) {
            return 0;
        }
        return days * 24 * 60 * 60 * 1000;
    }

    /** cwds of tasks that are running or queued — never collect under a live agent. */
    protected activeCwds(): Set<string> {
        const active = new Set<string>();
        for (const group of this.runner.listAllGroupedByCwd()) {
            if (group.tasks.some(task => task.state === 'running' || task.state === 'queued')) {
                active.add(path.resolve(group.cwd));
            }
        }
        return active;
    }

    /** Overridable in tests. */
    protected worktreesRoot(): string {
        return resolveQaapWorktreesRoot();
    }

    async sweep(): Promise<void> {
        const root = this.worktreesRoot();
        let tenants: string[];
        try {
            tenants = await fsp.readdir(root);
        } catch {
            return; // no worktrees root yet — nothing to do
        }
        const maxAge = this.maxAgeMs();
        const now = Date.now();
        let removed = 0;
        let skippedDirty = 0;
        for (const tenant of tenants) {
            const tenantDir = path.join(root, tenant);
            let slugs: string[] = [];
            try {
                slugs = (await fsp.stat(tenantDir)).isDirectory() ? await fsp.readdir(tenantDir) : [];
            } catch { /* raced away */ }
            for (const slug of slugs) {
                const dir = path.join(tenantDir, slug);
                try {
                    const stat = await fsp.stat(dir);
                    // Snapshot activity per-candidate, not once for the whole sweep: this loop has
                    // several awaits (lastCommitMs/isDirty) during which a task can be queued onto this
                    // very worktree. Checking here AND again immediately before collect() closes the
                    // TOCTOU where the GC would delete a tree that was just assigned to a live agent.
                    if (!stat.isDirectory() || this.activeCwds().has(path.resolve(dir))) {
                        continue;
                    }
                    if (now - stat.mtimeMs < maxAge || now - await this.lastCommitMs(dir) < maxAge) {
                        continue; // recent activity on either signal keeps it
                    }
                    if (await this.isDirty(dir)) {
                        skippedDirty++;
                        console.warn(`[qaap-worktree-gc] skipping ${dir}: uncommitted changes (commit or discard them to let GC collect it)`);
                        continue;
                    }
                    if (await this.collect(dir)) {
                        removed++;
                    }
                } catch (error) {
                    console.warn(`[qaap-worktree-gc] could not evaluate ${dir}: ${error instanceof Error ? error.message : String(error)}`);
                }
            }
        }
        if (removed || skippedDirty) {
            console.info(`[qaap-worktree-gc] removed ${removed} abandoned worktree(s), skipped ${skippedDirty} dirty`);
        }
    }

    protected async lastCommitMs(dir: string): Promise<number> {
        try {
            const { stdout } = await execFileAsync('git', ['-C', dir, 'log', '-1', '--format=%ct'], { timeout: 15_000 });
            const seconds = Number(stdout.trim());
            return Number.isFinite(seconds) ? seconds * 1000 : 0;
        } catch {
            return 0; // not a git dir / no commits — age by mtime alone
        }
    }

    protected async isDirty(dir: string): Promise<boolean> {
        try {
            const { stdout } = await execFileAsync('git', ['-C', dir, 'status', '--porcelain'], { timeout: 30_000 });
            return stdout.trim().length > 0;
        } catch {
            return true; // cannot tell — never destroy what we cannot inspect
        }
    }

    /**
     * Remove the worktree directory, then prune the stale registration in the base repository.
     * Returns false (without deleting) if the worktree became active during the git resolution below —
     * the FINAL activity check, as close to the destructive `rm` as possible, closes the TOCTOU where a
     * task is queued onto this cwd after the caller's check but before the delete. Overridable in tests.
     */
    protected async collect(dir: string): Promise<boolean> {
        let baseRepo: string | undefined;
        try {
            const { stdout } = await execFileAsync(
                'git', ['-C', dir, 'rev-parse', '--path-format=absolute', '--git-common-dir'],
                { timeout: 15_000 },
            );
            baseRepo = path.dirname(stdout.trim()); // <repo>/.git → <repo>
        } catch { /* base gone (repo deleted) — still remove the dir */ }
        // Last check before the irreversible delete — after every await in this sweep.
        if (this.activeCwds().has(path.resolve(dir))) {
            return false;
        }
        // Async rm so a large worktree deletion does not block the event loop (freezing HTTP/SSE/WS).
        await fsp.rm(dir, { recursive: true, force: true });
        if (baseRepo) {
            await execFileAsync('git', ['-C', baseRepo, 'worktree', 'prune'], { timeout: 30_000 }).catch(() => undefined);
        }
        return true;
    }
}
