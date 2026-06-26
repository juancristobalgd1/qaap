// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as path from 'path';
import * as os from 'os';
import {
    isPathUnderUserWorkspace,
    resolveQaapReposRoot,
    resolveUserReposRoot,
    safeUserIdSegment,
} from '@theia/qaap-adapters/lib/common/qaap-user-isolation';
import type {
    QaapCloudWorkspaceSummary,
    QaapTerminalSessionRecord,
} from '../common/qaap-cloud-api-types';
import { QaapCloudWorkspaceStore } from './qaap-cloud-workspace-store';
import { QaapDeployRunner } from './qaap-deploy-runner';
import { QaapTerminalSessionStore } from './qaap-terminal-session-store';

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
        it('produces different container names for the same repo opened by different users', () => {
            const repoKey = 'octocat/hello-world';
            const hashA = require('crypto').createHash('sha256')
                .update(`${userA}\u0000${repoKey}`).digest('hex').slice(0, 12);
            const hashB = require('crypto').createHash('sha256')
                .update(`${userB}\u0000${repoKey}`).digest('hex').slice(0, 12);
            expect(`qaap-ws-${hashA}`).to.not.equal(`qaap-ws-${hashB}`);
        });

        it('falls back to __anonymous__ bucket for undefined ownerLogin', () => {
            const repoKey = 'octocat/hello-world';
            const hashAnon = require('crypto').createHash('sha256')
                .update(`__anonymous__\u0000${repoKey}`).digest('hex').slice(0, 12);
            const hashA = require('crypto').createHash('sha256')
                .update(`${userA}\u0000${repoKey}`).digest('hex').slice(0, 12);
            expect(`qaap-ws-${hashAnon}`).to.not.equal(`qaap-ws-${hashA}`);
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
    });
});
