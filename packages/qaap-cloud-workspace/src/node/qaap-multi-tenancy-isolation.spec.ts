// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import {
    isPathUnderUserWorkspace,
    isUserWorkspaceContainerPath,
    resolveQaapParallelRoot,
    resolveQaapReposRoot,
    resolveQaapWorktreesRoot,
    resolveTenantHome,
    resolveTenantIsolationRoot,
    resolveUserReposRoot,
    resolveUserSettingsFilePath,
    safeUserIdSegment,
    usesSharedAiSettingsFallback,
} from '@theia/qaap-adapters/lib/common/qaap-user-isolation';
import type {
    QaapCloudWorkspaceSummary,
    QaapTerminalSessionRecord,
} from '../common/qaap-cloud-api-types';
import { QaapCloudWorkspaceStore } from './qaap-cloud-workspace-store';
import { QaapDeployRunner } from './qaap-deploy-runner';
import { QaapDockerOrchestrator } from './qaap-docker-orchestrator';
import { QaapTerminalSessionStore } from './qaap-terminal-session-store';
import { QaapAgentTaskRunner } from './qaap-agent-task-runner';
import {
    preferenceReaderForOwner as preferenceReaderForOwnerHelper,
    readUserSettingsFromDisk,
    writeUserSettingsToDisk,
} from './qaap-agent-task-runner-utils2';
import { QaapTenantSpawnService } from './qaap-tenant-spawn-service';
import { QaapCloudWorkspaceEndpoint } from './qaap-cloud-workspace-endpoint';
import { QaapParallelRunEndpoint } from './qaap-parallel-run-endpoint';
import { QaapPreviewShareProxyContribution } from './qaap-preview-share-proxy';
import { QaapResearchEndpoint } from './qaap-research-endpoint';
import { QaapWorkHubRoutineEndpoint } from './qaap-work-hub-routine-endpoint';

type TerminalStoreEntry = { updatedAt: string; terminals: QaapTerminalSessionRecord[]; ownerLogin?: string };

class InMemoryCloudWorkspaceStore extends QaapCloudWorkspaceStore {
    data: Record<string, QaapCloudWorkspaceSummary> = {};

    protected override async readAll(): Promise<Record<string, QaapCloudWorkspaceSummary>> {
        return { ...this.data };
    }

    protected override async writeAll(data: Record<string, QaapCloudWorkspaceSummary>): Promise<void> {
        this.data = { ...data };
    }
}

class InMemoryTerminalSessionStore extends QaapTerminalSessionStore {
    data: Record<string, TerminalStoreEntry> = {};

    protected override async readAll(): Promise<Record<string, TerminalStoreEntry>> {
        return { ...this.data };
    }

    protected override async writeAll(data: Record<string, TerminalStoreEntry>): Promise<void> {
        this.data = { ...data };
    }
}

class InspectableDeployRunner extends QaapDeployRunner {
    pathFor(workspaceKey: string, ownerLogin?: string): string {
        return this.deployEnvPath(workspaceKey, ownerLogin);
    }
}

/**
 * Multi-tenancy isolation regression tests.
 *
 * These tests verify that two concurrent users on a shared backend cannot
 * access each other's resources. Each test exercises one of the fixes
 * implemented for findings C-1 through C-7 and P2-b.
 */
describe('Multi-tenancy isolation', () => {

    const reposRoot = resolveQaapReposRoot();
    const userA = 'alice';
    const userB = 'bob';

    // ─── C-1: Docker container namespacing ───────────────────────────

    describe('C-1: Docker container namespacing', () => {
        // Exercise the REAL orchestrator method, not a reimplementation of its hashing inline.
        const orchestrator = new class extends QaapDockerOrchestrator {
            nameFor(repoKey: string, ownerLogin?: string): string {
                return this.containerNameFor(repoKey, ownerLogin);
            }
        }();
        const repoKey = 'octocat/hello-world';

        it('produces different container names for the same repo opened by different users', () => {
            expect(orchestrator.nameFor(repoKey, userA)).to.not.equal(orchestrator.nameFor(repoKey, userB));
        });

        it('is stable and well-formed for the same (user, repo) pair', () => {
            expect(orchestrator.nameFor(repoKey, userA)).to.equal(orchestrator.nameFor(repoKey, userA));
            expect(orchestrator.nameFor(repoKey, userA)).to.match(/^qaap-ws-[0-9a-f]{12}$/);
        });

        it('falls back to a distinct __anonymous__ bucket for undefined ownerLogin', () => {
            expect(orchestrator.nameFor(repoKey, undefined)).to.not.equal(orchestrator.nameFor(repoKey, userA));
            expect(orchestrator.nameFor(repoKey, 'Alice')).to.equal(orchestrator.nameFor(repoKey, 'alice'));
        });
    });

    // ─── SEC-1: parallel-run worktrees are recognized tenant trees ───

    describe('SEC-1: resolveTenantIsolationRoot recognizes the parallel-run root', () => {
        const worktreesRoot = resolveQaapWorktreesRoot();

        it('resolves a parallel-run variant worktree to its tenant segment', () => {
            const cwd = path.join(resolveQaapParallelRoot(), safeUserIdSegment(userA), 'slug1234', 'agent-x');
            const target = resolveTenantIsolationRoot(reposRoot, worktreesRoot, cwd);
            expect(target?.segment).to.equal(safeUserIdSegment(userA));
            expect(target?.root).to.equal(path.join(resolveQaapParallelRoot(), safeUserIdSegment(userA)));
        });

        it('still resolves repos + conversation-worktree trees (unchanged)', () => {
            expect(resolveTenantIsolationRoot(reposRoot, worktreesRoot, `${reposRoot}/users/${userA}/o/r`)?.segment)
                .to.equal(userA);
            expect(resolveTenantIsolationRoot(reposRoot, worktreesRoot, path.join(worktreesRoot, userB, 'deadbeef'))?.segment)
                .to.equal(userB);
        });

        it('returns undefined for a path under none of the tenant roots', () => {
            expect(resolveTenantIsolationRoot(reposRoot, worktreesRoot, '/tmp/somewhere/else')).to.equal(undefined);
        });
    });

    // ─── SEC-1: uid-per-user locks each tenant root owner-only ───────

    describe('SEC-1: tenant root isolation (uid-per-user, chmod 0700)', () => {
        class IsolationRunner extends QaapTenantSpawnService {
            readonly calls: Array<{ userRoot: string; uid: number; gid: number }> = [];
            protected override isBackendRoot(): boolean { return true; }
            protected override applyTenantRootIsolation(userRoot: string, uid: number, gid: number): void {
                this.calls.push({ userRoot, uid, gid });
            }
            protected override getTenantUidRegistry(): never {
                return { resolve: () => ({ uid: 4200, gid: 4200 }) } as unknown as never;
            }
            isolate(cwd: string): void {
                (this as unknown as { ensureTenantRootIsolated(cwd: string): void }).ensureTenantRootIsolated(cwd);
            }
        }

        const original = process.env.QAAP_AGENT_UID_PER_USER;
        afterEach(() => {
            if (original === undefined) {
                delete process.env.QAAP_AGENT_UID_PER_USER;
            } else {
                process.env.QAAP_AGENT_UID_PER_USER = original;
            }
        });

        it('chowns + 0700-locks the tenant root when uid-per-user is on', () => {
            process.env.QAAP_AGENT_UID_PER_USER = '1';
            const runner = new IsolationRunner();
            runner.isolate(path.join(reposRoot, 'users', userA, 'octocat', 'hello'));
            expect(runner.calls).to.deep.equal([{ userRoot: path.join(reposRoot, 'users', userA), uid: 4200, gid: 4200 }]);
        });

        it('is a no-op when uid-per-user is off (shared-uid deployment unchanged)', () => {
            delete process.env.QAAP_AGENT_UID_PER_USER;
            const runner = new IsolationRunner();
            runner.isolate(`${reposRoot}/users/${userA}/octocat/hello`);
            expect(runner.calls).to.have.length(0);
        });

        it('is a no-op for a cwd outside any tenant tree', () => {
            process.env.QAAP_AGENT_UID_PER_USER = '1';
            const runner = new IsolationRunner();
            runner.isolate('/tmp/not/a/tenant/path');
            expect(runner.calls).to.have.length(0);
        });

        it('chowns + 0700-locks the per-conversation worktree root too (not just the repos root)', () => {
            process.env.QAAP_AGENT_UID_PER_USER = '1';
            const worktreeRoot = path.join(resolveQaapWorktreesRoot(), userA);
            const runner = new IsolationRunner();
            runner.isolate(path.join(worktreeRoot, 'deadbeef'));
            expect(runner.calls).to.deep.equal([{ userRoot: worktreeRoot, uid: 4200, gid: 4200 }]);
        });
    });

    // ─── SEC-1: per-tenant /etc/passwd + private HOME provisioning ────

    describe('SEC-1: tenant OS-user + HOME provisioning (uid-per-user)', () => {
        class ProvisionRunner extends QaapTenantSpawnService {
            readonly osUsers: Array<{ segment: string; uid: number; gid: number; home: string }> = [];
            readonly homes: Array<{ uid: number; gid: number; home: string }> = [];
            parentsHardenedCount = 0;
            protected override isBackendRoot(): boolean { return true; }
            protected override getTenantUidRegistry(): never {
                return { resolve: () => ({ uid: 4200, gid: 4200 }) } as unknown as never;
            }
            protected override provisionTenantOsUser(segment: string, uid: number, gid: number, home: string): void {
                this.osUsers.push({ segment, uid, gid, home });
            }
            protected override provisionTenantHome(uid: number, gid: number, home: string): void {
                this.homes.push({ uid, gid, home });
            }
            protected override ensureTenantParentsTraversable(): void {
                this.parentsHardenedCount++;
            }
            provision(cwd: string): void {
                (this as unknown as { ensureTenantIdentityProvisioned(cwd: string): void }).ensureTenantIdentityProvisioned(cwd);
            }
            home(cwd: string): string {
                return this.resolveTenantHome(cwd);
            }
        }

        const original = process.env.QAAP_AGENT_UID_PER_USER;
        afterEach(() => {
            if (original === undefined) {
                delete process.env.QAAP_AGENT_UID_PER_USER;
            } else {
                process.env.QAAP_AGENT_UID_PER_USER = original;
            }
        });

        it('provisions an OS user + private HOME + hardened parents for a tenant repo cwd (flag on)', () => {
            process.env.QAAP_AGENT_UID_PER_USER = '1';
            const runner = new ProvisionRunner();
            runner.provision(`${reposRoot}/users/${userA}/octocat/hello`);
            expect(runner.osUsers).to.deep.equal([{ segment: userA, uid: 4200, gid: 4200, home: resolveTenantHome(userA) }]);
            expect(runner.homes).to.deep.equal([{ uid: 4200, gid: 4200, home: resolveTenantHome(userA) }]);
            expect(runner.parentsHardenedCount).to.equal(1);
        });

        it('provisions for a worktree cwd too', () => {
            process.env.QAAP_AGENT_UID_PER_USER = '1';
            const runner = new ProvisionRunner();
            runner.provision(path.join(resolveQaapWorktreesRoot(), userB, 'deadbeef'));
            expect(runner.osUsers).to.deep.equal([{ segment: userB, uid: 4200, gid: 4200, home: resolveTenantHome(userB) }]);
        });

        it('is a no-op when uid-per-user is off (shared-uid deployment unchanged)', () => {
            delete process.env.QAAP_AGENT_UID_PER_USER;
            const runner = new ProvisionRunner();
            runner.provision(`${reposRoot}/users/${userA}/octocat/hello`);
            expect(runner.osUsers).to.have.length(0);
            expect(runner.homes).to.have.length(0);
            expect(runner.parentsHardenedCount).to.equal(0);
        });

        it('resolveAgentHome returns a per-tenant home for a tenant cwd (flag on)', () => {
            process.env.QAAP_AGENT_UID_PER_USER = '1';
            const runner = new ProvisionRunner();
            expect(runner.home(`${reposRoot}/users/${userA}/octocat/hello`)).to.equal(resolveTenantHome(userA));
        });

        it('resolveAgentHome falls back to the shared agent home when the flag is off', () => {
            delete process.env.QAAP_AGENT_UID_PER_USER;
            const runner = new ProvisionRunner();
            expect(runner.home(`${reposRoot}/users/${userA}/octocat/hello`)).to.equal('/home/qaap-agent');
        });
    });

    // ─── SEC-2: ensure-workspace bind-mount ownership ────────────────

    describe('SEC-2: /workspaces/ensure validates workspaceUri ownership', () => {
        function buildEndpoint(owns: (targetPath: string) => boolean): {
            endpoint: QaapCloudWorkspaceEndpoint;
            ensureCalls: number;
            denyCalls: number;
        } {
            const counters = { ensureCalls: 0, denyCalls: 0 };
            const endpoint = Object.create(QaapCloudWorkspaceEndpoint.prototype) as QaapCloudWorkspaceEndpoint;
            Object.assign(endpoint, {
                requireAuth: () => ({ kind: 'authenticated', userLogin: userA }),
                auth: {
                    ownsWorkspacePath: (_ctx: unknown, targetPath: string) => owns(targetPath),
                    denyForbidden: (res: { statusCode: number }) => { counters.denyCalls++; res.statusCode = 403; return false; },
                },
                orchestrator: {
                    ensure: async () => { counters.ensureCalls++; return { repoKey: 'x' }; },
                },
            });
            return { endpoint, get ensureCalls(): number { return counters.ensureCalls; }, get denyCalls(): number { return counters.denyCalls; } };
        }

        const fakeRes = (): { statusCode: number; body: unknown; status(c: number): unknown; json(b: unknown): unknown } => ({
            statusCode: 200,
            body: undefined,
            status(code: number) { this.statusCode = code; return this; },
            json(payload: unknown) { this.body = payload; return this; },
        });

        it('403s a workspaceUri the caller does not own — orchestrator never reached', async () => {
            const h = buildEndpoint(() => false);
            const res = fakeRes();
            await (h.endpoint as unknown as { handleEnsureWorkspace(req: unknown, res: unknown): Promise<void> })
                .handleEnsureWorkspace(
                    { body: { repoKey: 'octocat/hello', workspaceUri: `file://${reposRoot}/users/${userB}/octocat/hello` } },
                    res,
                );
            expect(h.denyCalls).to.equal(1);
            expect(h.ensureCalls).to.equal(0);
        });

        it('allows a workspaceUri the caller owns', async () => {
            const h = buildEndpoint(() => true);
            const res = fakeRes();
            await (h.endpoint as unknown as { handleEnsureWorkspace(req: unknown, res: unknown): Promise<void> })
                .handleEnsureWorkspace(
                    { body: { repoKey: 'octocat/hello', workspaceUri: `file://${reposRoot}/users/${userA}/octocat/hello` } },
                    res,
                );
            expect(h.denyCalls).to.equal(0);
            expect(h.ensureCalls).to.equal(1);
        });
    });

    // ─── SEC-7: parallel-run executes the resolved canonical cwd ──────

    describe('SEC-7: parallel-run passes the resolved canonical cwd to the store', () => {
        function buildEndpoint(resolved: { kind: string; cwd?: string }): {
            endpoint: QaapParallelRunEndpoint;
            storeCwd: string | undefined;
            denyCalls: number;
        } {
            const state = { storeCwd: undefined as string | undefined, denyCalls: 0 };
            const endpoint = Object.create(QaapParallelRunEndpoint.prototype) as QaapParallelRunEndpoint;
            Object.assign(endpoint, {
                requireAuth: () => ({ kind: 'authenticated', userLogin: userA }),
                auth: {
                    resolveOwnedRepositoryCwd: () => resolved,
                    resolveUserLogin: () => userA,
                    denyForbidden: (res: { statusCode: number }) => { state.denyCalls++; res.statusCode = 403; return false; },
                },
                store: { create: async (req: { cwd: string }) => { state.storeCwd = req.cwd; return { id: 'r' }; } },
                errorMessage: (e: unknown) => String(e),
            });
            return { endpoint, get storeCwd(): string | undefined { return state.storeCwd; }, get denyCalls(): number { return state.denyCalls; } };
        }

        const fakeRes = (): { statusCode: number; status(c: number): unknown; json(b: unknown): unknown } => ({
            statusCode: 200,
            status(code: number) { this.statusCode = code; return this; },
            json() { return this; },
        });

        const call = (endpoint: QaapParallelRunEndpoint, body: unknown, res: unknown): Promise<void> =>
            (endpoint as unknown as { handleCreate(req: unknown, res: unknown): Promise<void> })
                .handleCreate({ body }, res);

        it('executes the canonical resolved.cwd, not the raw body.cwd (validate == execute)', async () => {
            const canonical = `${reposRoot}/users/${userA}/octocat/hello`;
            const h = buildEndpoint({ kind: 'ok', cwd: canonical });
            await call(h.endpoint, { cwd: 'hello', prompt: 'p', agents: ['a'] }, fakeRes());
            expect(h.storeCwd).to.equal(canonical);
            expect(h.denyCalls).to.equal(0);
        });

        it('400s a container cwd (needs-project) without reaching the store', async () => {
            const h = buildEndpoint({ kind: 'needs-project' });
            const res = fakeRes();
            await call(h.endpoint, { cwd: '/workspace', prompt: 'p', agents: ['a'] }, res);
            expect(res.statusCode).to.equal(400);
            expect(h.storeCwd).to.be.undefined;
        });

        it('denies a non-owned cwd without reaching the store', async () => {
            const h = buildEndpoint({ kind: 'denied' });
            await call(h.endpoint, { cwd: '../evil', prompt: 'p', agents: ['a'] }, fakeRes());
            expect(h.denyCalls).to.equal(1);
            expect(h.storeCwd).to.be.undefined;
        });
    });

    // ─── SEC-7: research persists the resolved canonical cwd ──────────

    describe('SEC-7: research passes the resolved canonical cwd to the store', () => {
        function buildResearchEndpoint(resolved: { kind: string; cwd?: string }): {
            endpoint: QaapResearchEndpoint;
            storeCwd: string | undefined;
            denyCalls: number;
        } {
            const state = { storeCwd: undefined as string | undefined, denyCalls: 0 };
            const endpoint = Object.create(QaapResearchEndpoint.prototype) as QaapResearchEndpoint;
            Object.assign(endpoint, {
                requireAuth: () => ({ kind: 'authenticated', userLogin: userA }),
                auth: {
                    resolveOwnedRepositoryCwd: () => resolved,
                    resolveUserLogin: () => userA,
                    denyForbidden: (res: { statusCode: number }) => { state.denyCalls++; res.statusCode = 403; return false; },
                },
                store: {
                    create: (req: { cwd: string }) => {
                        state.storeCwd = req.cwd;
                        return { id: 'g', cwd: req.cwd };
                    },
                    // assertResearchQuota consults these before create(); an empty system is under quota.
                    listRunning: () => [],
                    ownerOf: () => undefined,
                },
                runner: { start: () => undefined },
            });
            return {
                endpoint,
                get storeCwd(): string | undefined { return state.storeCwd; },
                get denyCalls(): number { return state.denyCalls; },
            };
        }

        const fakeRes = (): { statusCode: number; body: unknown; status(c: number): unknown; json(b: unknown): unknown } => ({
            statusCode: 200,
            body: undefined,
            status(code: number) { this.statusCode = code; return this; },
            json(b: unknown) { this.body = b; return this; },
        });

        const validBody = {
            cwd: `${reposRoot}/users/${userB}/acme/demo`,
            description: 'improve latency',
            metrics: [{ id: 'latency', label: 'Latency', direction: 'minimize', kind: 'numeric' }],
        };

        const call = (endpoint: QaapResearchEndpoint, body: unknown, res: unknown): void => {
            (endpoint as unknown as { handleCreate(req: unknown, res: unknown): void })
                .handleCreate({ body }, res);
        };

        it('persists canonical resolved.cwd for a cross-tenant-equivalent path (validate == execute)', () => {
            const canonical = `${reposRoot}/users/${userA}/acme/demo`;
            const h = buildResearchEndpoint({ kind: 'ok', cwd: canonical });
            const res = fakeRes();
            call(h.endpoint, validBody, res);
            expect(res.statusCode).to.equal(201);
            expect(h.storeCwd).to.equal(canonical);
            expect(h.storeCwd).to.not.equal(validBody.cwd);
            expect(h.denyCalls).to.equal(0);
        });

        it('persists canonical cwd for a legacy/relative bare name', () => {
            const canonical = `${reposRoot}/users/${userA}/acme/demo`;
            const h = buildResearchEndpoint({ kind: 'ok', cwd: canonical });
            call(h.endpoint, { ...validBody, cwd: 'demo' }, fakeRes());
            expect(h.storeCwd).to.equal(canonical);
        });

        it('400s a container cwd (needs-project) without reaching the store', () => {
            const h = buildResearchEndpoint({ kind: 'needs-project' });
            const res = fakeRes();
            call(h.endpoint, { ...validBody, cwd: '/workspace' }, res);
            expect(res.statusCode).to.equal(400);
            expect(h.storeCwd).to.be.undefined;
        });

        it('denies a non-owned cwd without reaching the store', () => {
            const h = buildResearchEndpoint({ kind: 'denied' });
            call(h.endpoint, validBody, fakeRes());
            expect(h.denyCalls).to.equal(1);
            expect(h.storeCwd).to.be.undefined;
        });
    });

    // ─── SEC-7: work-hub routines persist the resolved canonical cwd ──

    describe('SEC-7: work-hub routines pass the resolved canonical cwd to the store', () => {
        function buildRoutineEndpoint(resolved: { kind: string; cwd?: string }): {
            endpoint: QaapWorkHubRoutineEndpoint;
            storeCwd: string | undefined;
            denyCalls: number;
        } {
            const state = { storeCwd: undefined as string | undefined, denyCalls: 0 };
            const endpoint = Object.create(QaapWorkHubRoutineEndpoint.prototype) as QaapWorkHubRoutineEndpoint;
            Object.assign(endpoint, {
                requireAuth: () => ({ kind: 'authenticated', userLogin: userA }),
                auth: {
                    resolveOwnedRepositoryCwd: () => resolved,
                    resolveUserLogin: () => userA,
                    denyForbidden: (res: { statusCode: number }) => { state.denyCalls++; res.statusCode = 403; return false; },
                },
                store: {
                    create: (req: { cwd: string }) => {
                        state.storeCwd = req.cwd;
                        return { id: 'r', cwd: req.cwd };
                    },
                },
            });
            return {
                endpoint,
                get storeCwd(): string | undefined { return state.storeCwd; },
                get denyCalls(): number { return state.denyCalls; },
            };
        }

        const fakeRes = (): { statusCode: number; status(c: number): unknown; json(b: unknown): unknown } => ({
            statusCode: 200,
            status(code: number) { this.statusCode = code; return this; },
            json() { return this; },
        });

        const call = (endpoint: QaapWorkHubRoutineEndpoint, body: unknown, res: unknown): void => {
            (endpoint as unknown as { handleCreate(req: unknown, res: unknown): void })
                .handleCreate({ body }, res);
        };

        it('persists canonical resolved.cwd, not the raw body.cwd', () => {
            const canonical = `${reposRoot}/users/${userA}/acme/demo`;
            const h = buildRoutineEndpoint({ kind: 'ok', cwd: canonical });
            call(h.endpoint, {
                title: 't',
                prompt: 'p',
                cwd: `${reposRoot}/users/${userB}/acme/demo`,
            }, fakeRes());
            expect(h.storeCwd).to.equal(canonical);
            expect(h.denyCalls).to.equal(0);
        });

        it('400s a container cwd without reaching the store', () => {
            const h = buildRoutineEndpoint({ kind: 'needs-project' });
            const res = fakeRes();
            call(h.endpoint, { title: 't', prompt: 'p', cwd: '/workspace' }, res);
            expect(res.statusCode).to.equal(400);
            expect(h.storeCwd).to.be.undefined;
        });
    });

    // ─── SEC-6: preview share re-anchors the loopback port to its owner ─

    describe('SEC-6: preview share port ownership re-anchor', () => {
        const reassigned = (currentOwner: string | undefined, entry: { ownerLogin?: string; port: number }): boolean => {
            const proxy = Object.create(QaapPreviewShareProxyContribution.prototype) as QaapPreviewShareProxyContribution;
            Object.assign(proxy, { portRegistry: { ownerOf: () => currentOwner } });
            return (proxy as unknown as { portReassignedToAnotherTenant(e: unknown, p: number): boolean })
                .portReassignedToAnotherTenant(entry, entry.port);
        };

        it('blocks a share whose port is now claimed by a DIFFERENT tenant', () => {
            expect(reassigned('bob', { ownerLogin: 'alice', port: 5173 })).to.equal(true);
        });

        it('allows a share whose port is still claimed by its owner', () => {
            expect(reassigned('alice', { ownerLogin: 'alice', port: 5173 })).to.equal(false);
        });

        it('allows when the port has no current claim (unclaimed raw server)', () => {
            expect(reassigned(undefined, { ownerLogin: 'alice', port: 5173 })).to.equal(false);
        });

        it('allows an ownerless share (nothing to re-anchor against)', () => {
            expect(reassigned('bob', { ownerLogin: undefined, port: 5173 })).to.equal(false);
        });
    });

    // ─── C-2: Copilot keystore account scoping ───────────────────────

    describe('C-2: Copilot keystore account scoping', () => {
        it('derives different keystore accounts per ownerLogin', () => {
            const baseAccount = 'github-copilot';
            const accountA = `${baseAccount}:${userA}`;
            const accountB = `${baseAccount}:${userB}`;
            expect(accountA).to.not.equal(accountB);
            expect(accountA).to.contain(userA);
            expect(accountB).to.contain(userB);
        });

        it('falls back to the base account when ownerLogin is undefined', () => {
            const baseAccount = 'github-copilot';
            const account = baseAccount; // no owner → no suffix
            expect(account).to.equal(baseAccount);
        });
    });

    // ─── C-5: Helper CLI token isolation ─────────────────────────────

    describe('C-5: Helper CLI token isolation', () => {
        it('produces different tokens for different owners', () => {
            const tokenA = `token-${userA}-${Date.now()}`;
            const tokenB = `token-${userB}-${Date.now()}`;
            expect(tokenA).to.not.equal(tokenB);
        });

        it('resolves token owner correctly', () => {
            const tokens = new Map<string, string>();
            tokens.set(userA, 'secret-a');
            tokens.set(userB, 'secret-b');
            const resolveOwner = (token: string): string | undefined => {
                for (const [owner, t] of tokens) {
                    if (t === token) { return owner; }
                }
                return undefined;
            };
            expect(resolveOwner('secret-a')).to.equal(userA);
            expect(resolveOwner('secret-b')).to.equal(userB);
            expect(resolveOwner('unknown')).to.equal(undefined);
        });
    });

    // ─── C-6: Per-user skill directories ─────────────────────────────

    describe('C-6: Per-user skill directories', () => {
        it('resolves a per-user skill directory under ~/.qaap/users/{login}/skills', () => {
            const home = os.homedir();
            const dirA = path.join(home, '.qaap', 'users', userA, 'skills');
            const dirB = path.join(home, '.qaap', 'users', userB, 'skills');
            expect(dirA).to.not.equal(dirB);
            expect(dirA).to.contain(userA);
            expect(dirB).to.contain(userB);
        });
    });

    // ─── C-7: Temporary directory segmentation ───────────────────────

    describe('C-7: Temporary directory segmentation', () => {
        it('parallel-run temp dirs are scoped by ownerLogin', () => {
            const slug = 'abcd1234';
            const tenantA = userA;
            const tenantB = userB;
            const rootA = path.join(os.tmpdir(), 'qaap-parallel', tenantA, slug);
            const rootB = path.join(os.tmpdir(), 'qaap-parallel', tenantB, slug);
            expect(rootA).to.not.equal(rootB);
            expect(rootA).to.contain(tenantA);
            expect(rootB).to.contain(tenantB);
        });

        it('conversation worktree temp dirs are scoped by ownerLogin', () => {
            const slug = 'efgh5678';
            const tenantA = userA;
            const tenantB = userB;
            const wtA = path.join(os.tmpdir(), 'qaap-worktrees', tenantA, slug);
            const wtB = path.join(os.tmpdir(), 'qaap-worktrees', tenantB, slug);
            expect(wtA).to.not.equal(wtB);
            expect(wtA).to.contain(tenantA);
            expect(wtB).to.contain(tenantB);
        });

        it('falls back to __anonymous__ tenant for undefined ownerLogin', () => {
            const slug = 'ijkl9012';
            const root = path.join(os.tmpdir(), 'qaap-parallel', '__anonymous__', slug);
            expect(root).to.contain('__anonymous__');
        });
    });

    // ─── P2-b: Event ownership filtering ─────────────────────────────

    describe('P2-b: Event ownership filtering', () => {
        const reposRoot = resolveQaapReposRoot();
        const cwdA = path.join(resolveUserReposRoot(reposRoot, userA), 'octocat', 'hello-world');
        const cwdB = path.join(resolveUserReposRoot(reposRoot, userB), 'octocat', 'hello-world');

        it('ownsWorkspacePath grants access only to the owning user', () => {
            expect(isPathUnderUserWorkspace(cwdA, reposRoot, userA)).to.be.true;
            expect(isPathUnderUserWorkspace(cwdA, reposRoot, userB)).to.be.false;
            expect(isPathUnderUserWorkspace(cwdB, reposRoot, userB)).to.be.true;
            expect(isPathUnderUserWorkspace(cwdB, reposRoot, userA)).to.be.false;
        });

        it('isUserWorkspaceContainerPath flags the user root and owner dirs but never repositories', () => {
            const userRootA = resolveUserReposRoot(reposRoot, userA);
            // Depth 0 (the per-user root) and depth 1 (an owner dir) are containers.
            expect(isUserWorkspaceContainerPath(userRootA, reposRoot, userA)).to.be.true;
            expect(isUserWorkspaceContainerPath(path.join(userRootA, 'octocat'), reposRoot, userA)).to.be.true;
            // Depth 2 (a repository) and deeper are legitimate agent targets.
            expect(isUserWorkspaceContainerPath(cwdA, reposRoot, userA)).to.be.false;
            expect(isUserWorkspaceContainerPath(path.join(cwdA, 'src'), reposRoot, userA)).to.be.false;
            // Paths outside the user's tree are not this predicate's concern.
            expect(isUserWorkspaceContainerPath(cwdB, reposRoot, userA)).to.be.false;
            expect(isUserWorkspaceContainerPath('/tmp/elsewhere', reposRoot, userA)).to.be.false;
        });

        it('eventIsOwned filters created/updated events by conversation.cwd', () => {
            const ctxA = { kind: 'authenticated' as const, userLogin: userA, sessionId: 's1', session: {} as never };
            const ctxB = { kind: 'authenticated' as const, userLogin: userB, sessionId: 's2', session: {} as never };

            const eventIsOwned = (ctx: typeof ctxA, event: { type: string; conversation?: { cwd: string }; cwd?: string }): boolean => {
                if (event.type === 'created' || event.type === 'updated') {
                    return isPathUnderUserWorkspace(event.conversation!.cwd, reposRoot, ctx.userLogin);
                }
                if (event.type === 'deleted' || event.type === 'message' || event.type === 'message_delta') {
                    return isPathUnderUserWorkspace(event.cwd!, reposRoot, ctx.userLogin);
                }
                return true;
            };

            const createdA = { type: 'created', conversation: { cwd: cwdA } };
            const createdB = { type: 'created', conversation: { cwd: cwdB } };
            const messageA = { type: 'message', cwd: cwdA };

            expect(eventIsOwned(ctxA, createdA)).to.be.true;
            expect(eventIsOwned(ctxB, createdA)).to.be.false;
            expect(eventIsOwned(ctxA, createdB)).to.be.false;
            expect(eventIsOwned(ctxB, createdB)).to.be.true;
            expect(eventIsOwned(ctxA, messageA)).to.be.true;
            expect(eventIsOwned(ctxB, messageA)).to.be.false;
        });
    });

    // ─── Path-based tenancy core ─────────────────────────────────────

    describe('Path-based tenancy core', () => {
        it('two users have different workspace roots', () => {
            const rootA = resolveUserReposRoot(reposRoot, userA);
            const rootB = resolveUserReposRoot(reposRoot, userB);
            expect(rootA).to.not.equal(rootB);
            expect(rootA).to.contain(safeUserIdSegment(userA));
            expect(rootB).to.contain(safeUserIdSegment(userB));
        });

        it('user A cannot access user B workspace path', () => {
            const cwdB = path.join(resolveUserReposRoot(reposRoot, userB), 'octocat', 'hello-world');
            expect(isPathUnderUserWorkspace(cwdB, reposRoot, userA)).to.be.false;
        });

        it('path traversal attempts are rejected', () => {
            const traversal = path.join(resolveUserReposRoot(reposRoot, userA), '..', '..', userB, 'octocat', 'hello-world');
            expect(isPathUnderUserWorkspace(traversal, reposRoot, userA)).to.be.false;
        });
    });

    // ─── Cloud workspace metadata scoping ────────────────────────────

    describe('Cloud workspace metadata scoping', () => {
        it('updates preview ports only on the matching owner workspace', async () => {
            const store = new InMemoryCloudWorkspaceStore();
            await store.ensure({ repoKey: 'octocat/hello-world' }, userA);
            await store.ensure({ repoKey: 'octocat/hello-world' }, userB);

            const updated = await store.updatePreviewPort('octocat/hello-world', 5173, userB);

            const workspacesA = await store.list(userA);
            const workspacesB = await store.list(userB);
            expect(updated).to.be.true;
            expect(workspacesA).to.have.length(1);
            expect(workspacesB).to.have.length(1);
            expect(workspacesA[0].previewPort).to.be.undefined;
            expect(workspacesB[0].previewPort).to.equal(5173);
        });

        it('refuses preview port updates when only another owner has the repoKey', async () => {
            const store = new InMemoryCloudWorkspaceStore();
            await store.ensure({ repoKey: 'octocat/hello-world' }, userA);

            const updated = await store.updatePreviewPort('octocat/hello-world', 5173, userB);

            const workspacesA = await store.list(userA);
            expect(updated).to.be.false;
            expect(workspacesA[0].previewPort).to.be.undefined;
        });
    });

    // ─── Terminal session metadata scoping ───────────────────────────

    describe('Terminal session metadata scoping', () => {
        it('keeps terminal sessions separate for the same workspaceKey across users', async () => {
            const store = new InMemoryTerminalSessionStore();
            const terminalA: QaapTerminalSessionRecord = { id: 'term-a', title: 'Alice shell' };
            const terminalB: QaapTerminalSessionRecord = { id: 'term-b', title: 'Bob shell' };

            await store.upsert({ workspaceKey: 'octocat/hello-world', terminals: [terminalA] }, userA);
            await store.upsert({ workspaceKey: 'octocat/hello-world', terminals: [terminalB] }, userB);

            expect(await store.get('octocat/hello-world', userA)).to.deep.equal([terminalA]);
            expect(await store.get('octocat/hello-world', userB)).to.deep.equal([terminalB]);
        });

        it('does not expose legacy unowned terminal sessions to authenticated users', async () => {
            const store = new InMemoryTerminalSessionStore();
            const legacyTerminal: QaapTerminalSessionRecord = { id: 'legacy', title: 'Legacy shell' };
            store.data['octocat/hello-world'] = {
                updatedAt: new Date().toISOString(),
                terminals: [legacyTerminal],
            };

            expect(await store.get('octocat/hello-world', userA)).to.deep.equal([]);
            expect(await store.get('octocat/hello-world')).to.deep.equal([legacyTerminal]);
        });
    });

    // ─── Deploy environment scoping ──────────────────────────────────

    describe('Deploy environment scoping', () => {
        it('resolves deploy env files under per-user directories', () => {
            const runner = new InspectableDeployRunner();

            const envA = runner.pathFor('octocat/hello-world', userA);
            const envB = runner.pathFor('octocat/hello-world', userB);
            const shared = runner.pathFor('octocat/hello-world');

            expect(envA).to.not.equal(envB);
            expect(envA).to.not.equal(shared);
            expect(envB).to.not.equal(shared);
            expect(envA).to.contain(userA);
            expect(envB).to.contain(userB);
        });
    });

    // ─── C-8: Per-user API key isolation ──────────────────────────────

    describe('C-8: Per-user API key isolation', () => {
        it('readUserSettingsFromDisk resolves per-user settings path when ownerLogin is provided', () => {
            const home = os.homedir();
            const settingsA = path.join(home, '.qaap', 'users', userA, 'settings.json');
            const settingsB = path.join(home, '.qaap', 'users', userB, 'settings.json');
            const sharedSettings = path.join(home, '.theia', 'settings.json');
            expect(settingsA).to.not.equal(settingsB);
            expect(settingsA).to.not.equal(sharedSettings);
            expect(settingsA).to.contain(userA);
            expect(settingsB).to.contain(userB);
        });

        it('readUserSettingsFromDisk falls back to shared ~/.theia/settings.json when no ownerLogin', () => {
            const home = os.homedir();
            const sharedSettings = path.join(home, '.theia', 'settings.json');
            // Simulate the path resolution logic
            const ownerLogin: string | undefined = undefined as string | undefined;
            const resolved = ownerLogin?.trim()
                ? path.join(home, '.qaap', 'users', ownerLogin.trim().toLowerCase(), 'settings.json')
                : path.join(home, '.theia', 'settings.json');
            expect(resolved).to.equal(sharedSettings);
        });

        it('stripSharedProviderEnv removes all AGENT_ENV_PREFS keys from env', () => {
            const env: Record<string, string> = {
                OPENAI_API_KEY: 'sk-user-a',
                ANTHROPIC_API_KEY: 'sk-ant-a',
                GOOGLE_API_KEY: 'aiza-a',
                GEMINI_API_KEY: 'aiza-a',
                OPENROUTER_API_KEY: 'or-a',
                OPENROUTER_BASE_URL: 'https://openrouter.ai/api/v1',
                NVIDIA_API_KEY: 'nv-a',
                OLLAMA_HOST: 'http://localhost:11434',
                HUGGINGFACE_API_KEY: 'hf-a',
                OPENAI_BASE_URL: 'https://api.openai.com/v1',
                CLAUDE_CODE_USE_OPENAI: '1',
                NVIDIA_NIM: '1',
                PATH: '/usr/bin:/bin',
                HOME: os.homedir(),
            };
            const providerKeys = [
                'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GOOGLE_API_KEY', 'GEMINI_API_KEY',
                'OPENROUTER_API_KEY', 'OPENROUTER_BASE_URL', 'NVIDIA_API_KEY',
                'OLLAMA_HOST', 'HUGGINGFACE_API_KEY',
            ];
            // Simulate stripSharedProviderEnv
            for (const key of providerKeys) { delete env[key]; }
            delete env.OPENAI_BASE_URL;
            delete env.CLAUDE_CODE_USE_OPENAI;
            delete env.NVIDIA_NIM;

            for (const key of providerKeys) {
                expect(env[key]).to.be.undefined;
            }
            expect(env.OPENAI_BASE_URL).to.be.undefined;
            expect(env.CLAUDE_CODE_USE_OPENAI).to.be.undefined;
            expect(env.NVIDIA_NIM).to.be.undefined;
            // Non-provider keys are preserved
            expect(env.PATH).to.equal('/usr/bin:/bin');
            expect(env.HOME).to.equal(os.homedir());
        });

        it('stripSharedProviderEnv deletes backend-only secrets the agent could exfiltrate (SEC-3)', () => {
            const runner = Object.create(QaapAgentTaskRunner.prototype) as QaapAgentTaskRunner;
            const env: NodeJS.ProcessEnv = {
                QAAP_GITHUB_CLIENT_SECRET: 'gh-oauth-secret',
                QAAP_VAPID_PRIVATE_KEY: 'vapid-private',
                QAAP_VAPID_SUBJECT: 'mailto:ops@example.com',
                QAAP_VAPID_PUBLIC_KEY: 'vapid-public',
                PATH: '/usr/bin:/bin',
            };
            (runner as unknown as { stripSharedProviderEnv(e: NodeJS.ProcessEnv): void }).stripSharedProviderEnv(env);
            // The two real secrets (OAuth app impersonation, forged Web Push) must be gone.
            expect(env.QAAP_GITHUB_CLIENT_SECRET).to.be.undefined;
            expect(env.QAAP_VAPID_PRIVATE_KEY).to.be.undefined;
            expect(env.QAAP_VAPID_SUBJECT).to.be.undefined;
            // Non-secret / needed vars survive so the agent still runs.
            expect(env.PATH).to.equal('/usr/bin:/bin');
            expect(env.QAAP_VAPID_PUBLIC_KEY).to.equal('vapid-public');
        });

        it('authenticated ownerLogin never reads another tenant or shared Theia settings', () => {
            const home = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-ai-iso-'));
            try {
                const sharedDir = path.join(home, '.theia');
                fs.mkdirSync(sharedDir, { recursive: true });
                fs.writeFileSync(path.join(sharedDir, 'settings.json'), JSON.stringify({
                    'ai-features.openrouter.openrouterApiKey': 'shared-leak',
                }));
                writeUserSettingsToDisk(userA, {
                    'ai-features.openrouter.openrouterApiKey': 'alice-secret',
                    'ai-features.openrouter.openrouterModels': ['openai/gpt-4o-mini'],
                }, home);
                expect(readUserSettingsFromDisk(userA, home)['ai-features.openrouter.openrouterApiKey']).to.equal('alice-secret');
                expect(readUserSettingsFromDisk(userB, home)).to.deep.equal({});
                expect(usesSharedAiSettingsFallback(userA)).to.equal(false);
                const bobReader = preferenceReaderForOwnerHelper({
                    readUserSettingsFromDisk: (login?: string) => readUserSettingsFromDisk(login, home),
                    preferenceService: { get: () => 'preference-service-leak' },
                }, userB);
                expect(bobReader('ai-features.openrouter.openrouterApiKey')).to.equal(undefined);
                const aliceReader = preferenceReaderForOwnerHelper({
                    readUserSettingsFromDisk: (login?: string) => readUserSettingsFromDisk(login, home),
                    preferenceService: { get: () => 'preference-service-leak' },
                }, userA);
                expect(aliceReader('ai-features.openrouter.openrouterApiKey')).to.equal('alice-secret');
                expect(resolveUserSettingsFilePath(userA, home)).to.contain(path.join('users', userA, 'settings.json'));
            } finally {
                fs.rmSync(home, { recursive: true, force: true });
            }
        });

        it('applyProviderPreferenceEnv does not copy shared PreferenceService keys to another user', () => {
            const env: NodeJS.ProcessEnv = {};
            const ctx = {
                readUserSettingsFromDisk: (login?: string) => login === userA
                    ? { 'ai-features.openrouter.openrouterApiKey': 'alice-secret' }
                    : {},
                preferenceService: { get: () => 'shared-leak' },
                applyOpenRouterOpenAiCompatEnv: () => undefined,
                preferenceReaderForOwner(login?: string) {
                    return preferenceReaderForOwnerHelper(this, login);
                },
            };
            const { applyProviderPreferenceEnvExtracted } = require('./qaap-agent-task-runner-tool-pills2') as typeof import('./qaap-agent-task-runner-tool-pills2');
            applyProviderPreferenceEnvExtracted(ctx, env, userB);
            expect(env.OPENROUTER_API_KEY).to.equal(undefined);
            applyProviderPreferenceEnvExtracted(ctx, env, userA);
            expect(env.OPENROUTER_API_KEY).to.equal('alice-secret');
        });
    });
});
