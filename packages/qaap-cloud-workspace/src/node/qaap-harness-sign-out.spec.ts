// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Request, Response } from '@theia/core/shared/express';
import {
    QAAP_BUILTIN_AGENT_DEFINITIONS,
    resolveQaapBuiltinAgentSignOut,
} from '@theia/qaap-shared-core/lib/common/qaap-builtin-agents';
import {
    doesQaapHarnessSignOutRemoveAllProviders,
    isQaapHarnessSignOutSupported,
    isSafeRelativeCredentialPath,
} from '@theia/qaap-shared-core/lib/common/qaap-harness-sign-out';
import {
    QaapHarnessCredentialPathError,
    removeHarnessCredentialFiles,
    resolveAllowedCredentialFile,
    stripHarnessJsonCredentialKeys,
} from './qaap-harness-credential-remover';
import {
    QaapHarnessSignOutService,
    type QaapHarnessCliLogoutOutcome,
} from './qaap-harness-sign-out-service';
import type { QaapAgentTaskRunner, QaapHarnessCliInvocation } from './qaap-agent-task-runner';
import { QaapAgentTaskEndpoint } from './qaap-agent-task-endpoint';
import type { QaapGithubAuthContext } from '@theia/qaap-shared-core/lib/node/qaap-github-auth-guard';

class TestHarnessSignOutService extends QaapHarnessSignOutService {
    public readonly cliCalls: QaapHarnessCliInvocation[] = [];
    public cliOutcome: QaapHarnessCliLogoutOutcome = { ok: true, exitCode: 0 };
    public useRealCli = false;
    public realTimeoutMs = 2_000;

    constructor(runner: QaapAgentTaskRunner) {
        super();
        (this as unknown as { runner: QaapAgentTaskRunner }).runner = runner;
    }

    protected override runCliLogout(invocation: QaapHarnessCliInvocation): Promise<QaapHarnessCliLogoutOutcome> {
        this.cliCalls.push(invocation);
        if (this.useRealCli) {
            return super.runCliLogout(invocation, this.realTimeoutMs);
        }
        return Promise.resolve(this.cliOutcome);
    }
}

describe('harness sign-out declarations', () => {

    for (const definition of QAAP_BUILTIN_AGENT_DEFINITIONS) {
        it(`${definition.id} declares a valid signOut strategy`, () => {
            expect(definition.signOut, `${definition.id} must declare signOut`).to.not.equal(undefined);
            switch (definition.signOut.kind) {
                case 'cli':
                    expect(definition.signOut.args.length).to.be.greaterThan(0);
                    break;
                case 'files':
                    expect(definition.signOut.paths.length).to.be.greaterThan(0);
                    for (const spec of definition.signOut.paths) {
                        expect(isSafeRelativeCredentialPath(spec.relative)).to.equal(true);
                        if (typeof spec.root === 'object') {
                            expect(isSafeRelativeCredentialPath(spec.root.fallback)).to.equal(true);
                        }
                    }
                    break;
                case 'json-keys':
                    expect(isSafeRelativeCredentialPath(definition.signOut.path.relative)).to.equal(true);
                    if (typeof definition.signOut.path.root === 'object') {
                        expect(isSafeRelativeCredentialPath(definition.signOut.path.root.fallback)).to.equal(true);
                    }
                    expect(definition.signOut.keys.length).to.be.greaterThan(0);
                    break;
                case 'none':
                    expect(definition.signOut.reason.trim().length).to.be.greaterThan(0);
                    break;
                default:
                    expect.fail(`${definition.id} has an unrecognized signOut strategy`);
            }
        });
    }

    it('declares the expected strategy for every built-in harness', () => {
        expect(resolveQaapBuiltinAgentSignOut('codex')).to.deep.equal({ kind: 'cli', args: ['logout'] });
        expect(resolveQaapBuiltinAgentSignOut('claude')).to.deep.equal({ kind: 'cli', args: ['auth', 'logout'] });
        expect(resolveQaapBuiltinAgentSignOut('opencode')).to.deep.equal({
            kind: 'files',
            removesAllProviders: true,
            paths: [{ root: { env: 'XDG_DATA_HOME', fallback: '.local/share' }, relative: 'opencode/auth.json' }],
        });
        expect(resolveQaapBuiltinAgentSignOut('pi')).to.deep.equal({
            kind: 'files',
            removesAllProviders: true,
            paths: [{ root: { env: 'PI_CODING_AGENT_DIR', fallback: '.pi/agent' }, relative: 'auth.json' }],
        });
        expect(resolveQaapBuiltinAgentSignOut('cursor')).to.deep.equal({
            kind: 'cli',
            args: ['logout'],
            env: { NO_OPEN_BROWSER: '1' },
        });
        expect(resolveQaapBuiltinAgentSignOut('antigravity')?.kind).to.equal('none');
        expect(resolveQaapBuiltinAgentSignOut('copilot')).to.deep.equal({
            kind: 'json-keys',
            path: { root: 'home', relative: '.copilot/config.json' },
            keys: ['loggedInUsers', 'lastLoggedInUser', 'copilot_tokens'],
        });
        expect(resolveQaapBuiltinAgentSignOut('grok')).to.deep.equal({ kind: 'cli', args: ['logout'] });

        expect(isQaapHarnessSignOutSupported(resolveQaapBuiltinAgentSignOut('antigravity'))).to.equal(false);
        expect(isQaapHarnessSignOutSupported(resolveQaapBuiltinAgentSignOut('unknown'))).to.equal(false);
        expect(isQaapHarnessSignOutSupported(resolveQaapBuiltinAgentSignOut('codex'))).to.equal(true);
        expect(doesQaapHarnessSignOutRemoveAllProviders(resolveQaapBuiltinAgentSignOut('opencode'))).to.equal(true);
        expect(doesQaapHarnessSignOutRemoveAllProviders(resolveQaapBuiltinAgentSignOut('pi'))).to.equal(true);
        expect(doesQaapHarnessSignOutRemoveAllProviders(resolveQaapBuiltinAgentSignOut('codex'))).to.equal(false);
    });
});

describe('qaap-harness-credential-remover', () => {
    let tmpRoot: string;
    let homeDir: string;
    let outsideDir: string;

    beforeEach(() => {
        tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-signout-cred-'));
        homeDir = path.join(tmpRoot, 'home');
        outsideDir = path.join(tmpRoot, 'outside');
        fs.mkdirSync(homeDir, { recursive: true });
        fs.mkdirSync(outsideDir, { recursive: true });
    });

    afterEach(() => {
        fs.rmSync(tmpRoot, { recursive: true, force: true });
    });

    it('removes allowlisted OpenCode and Pi auth files via env root and fallback', () => {
        const xdgData = path.join(tmpRoot, 'xdg-data');
        const opencodeAuth = path.join(xdgData, 'opencode', 'auth.json');
        fs.mkdirSync(path.dirname(opencodeAuth), { recursive: true });
        fs.writeFileSync(opencodeAuth, '{"openai":"tok"}', 'utf8');

        const removed = removeHarnessCredentialFiles(
            [{ root: { env: 'XDG_DATA_HOME', fallback: '.local/share' }, relative: 'opencode/auth.json' }],
            { home: homeDir, env: { XDG_DATA_HOME: xdgData } },
        );
        expect(removed).to.equal(1);
        expect(fs.existsSync(opencodeAuth)).to.equal(false);

        const piAuth = path.join(homeDir, '.pi', 'agent', 'auth.json');
        fs.mkdirSync(path.dirname(piAuth), { recursive: true });
        fs.writeFileSync(piAuth, '{"anthropic":"tok"}', 'utf8');
        const removedPi = removeHarnessCredentialFiles(
            [{ root: { env: 'PI_CODING_AGENT_DIR', fallback: '.pi/agent' }, relative: 'auth.json' }],
            { home: homeDir, env: {} },
        );
        expect(removedPi).to.equal(1);
        expect(fs.existsSync(piAuth)).to.equal(false);
        // Idempotent when already removed.
        expect(removeHarnessCredentialFiles(
            [{ root: { env: 'PI_CODING_AGENT_DIR', fallback: '.pi/agent' }, relative: 'auth.json' }],
            { home: homeDir, env: {} },
        )).to.equal(0);
    });

    it('rejects path traversal and absolute paths', () => {
        for (const badRelative of ['../outside/secret.json', 'opencode/../../etc/passwd', '/etc/passwd', 'a\0b', '.']) {
            expect(() => resolveAllowedCredentialFile(
                { root: 'home', relative: badRelative },
                { home: homeDir },
            )).to.throw(QaapHarnessCredentialPathError);
        }
    });

    it('rejects intermediate symlinks and target symlinks pointing outside allowed roots', function (): void {
        if (process.platform === 'win32') {
            this.skip();
        }
        const outsideSecret = path.join(outsideDir, 'config.json');
        fs.writeFileSync(outsideSecret, '{"loggedInUsers":["victim"]}', 'utf8');

        // 1. Intermediate directory symlink escaping home.
        fs.symlinkSync(outsideDir, path.join(homeDir, '.copilot'));
        expect(() => stripHarnessJsonCredentialKeys(
            { root: 'home', relative: '.copilot/config.json' },
            ['loggedInUsers'],
            { home: homeDir },
        )).to.throw(QaapHarnessCredentialPathError).with.property('code', 'symlink-escape');
        expect(fs.readFileSync(outsideSecret, 'utf8')).to.include('victim');

        // 2. Final file symlink escaping home.
        fs.unlinkSync(path.join(homeDir, '.copilot'));
        fs.mkdirSync(path.join(homeDir, '.copilot'), { recursive: true });
        fs.symlinkSync(outsideSecret, path.join(homeDir, '.copilot', 'config.json'));
        expect(() => removeHarnessCredentialFiles(
            [{ root: 'home', relative: '.copilot/config.json' }],
            { home: homeDir },
        )).to.throw(QaapHarnessCredentialPathError).with.property('code', 'symlink-escape');
        expect(fs.existsSync(outsideSecret)).to.equal(true);
    });

    it('allows intermediate symlinks into extraRoots (persistent tenant home layout)', function (): void {
        if (process.platform === 'win32') {
            this.skip();
        }
        const persistentHome = path.join(tmpRoot, 'persistent-home');
        const persistentCopilot = path.join(persistentHome, '.copilot');
        fs.mkdirSync(persistentCopilot, { recursive: true });
        const configPath = path.join(persistentCopilot, 'config.json');
        fs.writeFileSync(configPath, JSON.stringify({
            theme: 'dark',
            loggedInUsers: ['alice'],
            lastLoggedInUser: 'alice',
            copilot_tokens: { alice: 'secret' },
        }), 'utf8');
        fs.symlinkSync(persistentCopilot, path.join(homeDir, '.copilot'));

        const changed = stripHarnessJsonCredentialKeys(
            { root: 'home', relative: '.copilot/config.json' },
            ['loggedInUsers', 'lastLoggedInUser', 'copilot_tokens'],
            { home: homeDir, extraRoots: [persistentHome] },
        );
        expect(changed).to.equal(true);
        expect(JSON.parse(fs.readFileSync(configPath, 'utf8'))).to.deep.equal({ theme: 'dark' });
    });

    it('strips only allowlisted JSON keys in-place and preserves unrelated preferences', () => {
        const copilotDir = path.join(homeDir, '.copilot');
        fs.mkdirSync(copilotDir, { recursive: true });
        const configPath = path.join(copilotDir, 'config.json');
        fs.writeFileSync(configPath, JSON.stringify({
            banner: 'never',
            trusted_folders: ['/workspace/app'],
            loggedInUsers: [{ login: 'alice' }],
            lastLoggedInUser: { login: 'alice' },
            copilot_tokens: { github: 'ghu_secret' },
        }, undefined, 2), 'utf8');
        const inodeBefore = fs.statSync(configPath).ino;

        const originalOpenSync = fs.openSync;
        const observedFlags: number[] = [];
        const fsMutable = fs as unknown as { openSync: typeof fs.openSync };
        fsMutable.openSync = ((targetPath: fs.PathLike, flags: fs.OpenMode, mode?: fs.Mode): number => {
            if (typeof flags === 'number') {
                observedFlags.push(flags);
            }
            return originalOpenSync(targetPath, flags, mode);
        }) as typeof fs.openSync;
        let changed: boolean;
        try {
            changed = stripHarnessJsonCredentialKeys(
                { root: 'home', relative: '.copilot/config.json' },
                ['loggedInUsers', 'lastLoggedInUser', 'copilot_tokens'],
                { home: homeDir },
            );
        } finally {
            fsMutable.openSync = originalOpenSync;
        }
        expect(changed).to.equal(true);
        expect(observedFlags.length).to.be.greaterThan(0);
        for (const flags of observedFlags) {
            const hasTruncWithoutCreat = (flags & fs.constants.O_TRUNC) !== 0 && (flags & fs.constants.O_CREAT) === 0;
            expect(hasTruncWithoutCreat, 'O_TRUNC without O_CREAT fails with EINVAL on Windows').to.equal(false);
        }
        const rewritten = fs.readFileSync(configPath, 'utf8');
        expect(rewritten.startsWith('{')).to.equal(true);
        const parsed = JSON.parse(rewritten) as Record<string, unknown>;
        expect(parsed).to.deep.equal({
            banner: 'never',
            trusted_folders: ['/workspace/app'],
        });
        expect(fs.statSync(configPath).ino).to.equal(inodeBefore);
        // Second call is a no-op when no allowlisted keys remain.
        expect(stripHarnessJsonCredentialKeys(
            { root: 'home', relative: '.copilot/config.json' },
            ['loggedInUsers', 'lastLoggedInUser', 'copilot_tokens'],
            { home: homeDir },
        )).to.equal(false);
    });
});

describe('QaapHarnessSignOutService', () => {
    let tmpRoot: string;

    beforeEach(() => {
        tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-signout-svc-'));
    });

    afterEach(() => {
        fs.rmSync(tmpRoot, { recursive: true, force: true });
    });

    function createStubRunner(overrides: Partial<QaapAgentTaskRunner> = {}): {
        runner: QaapAgentTaskRunner;
        forgotten: Array<{ agentId: string; ownerLogin?: string }>;
        refreshed: Array<{ agentId: string; ownerLogin?: string }>;
        invocations: Array<{ harnessKey: string; args: readonly string[]; ownerLogin?: string; extraEnv?: Readonly<Record<string, string>> }>;
    } {
        const forgotten: Array<{ agentId: string; ownerLogin?: string }> = [];
        const refreshed: Array<{ agentId: string; ownerLogin?: string }> = [];
        const invocations: Array<{ harnessKey: string; args: readonly string[]; ownerLogin?: string; extraEnv?: Readonly<Record<string, string>> }> = [];
        const runner = {
            resolveHarnessCliInvocation: async (harnessKey: string, args: readonly string[], options?: { ownerLogin?: string; extraEnv?: Readonly<Record<string, string>> }) => {
                invocations.push({ harnessKey, args, ownerLogin: options?.ownerLogin, extraEnv: options?.extraEnv });
                return { file: harnessKey, args, env: { ...(options?.extraEnv ?? {}) } };
            },
            resolveHarnessCredentialRoots: () => ({ home: tmpRoot, extraRoots: [], env: {} }),
            forgetAgentSession: (agentId: string, ownerLogin?: string) => {
                forgotten.push({ agentId, ownerLogin });
            },
            agentConnectionStateFresh: async (agentId: string, ownerLogin?: string) => {
                refreshed.push({ agentId, ownerLogin });
                return 'disconnected' as const;
            },
            ...overrides,
        } as unknown as QaapAgentTaskRunner;
        return { runner, forgotten, refreshed, invocations };
    }

    it('fails closed on antigravity (none) and unknown harnesses', async () => {
        const { runner, forgotten } = createStubRunner();
        const service = new TestHarnessSignOutService(runner);

        const agy = await service.signOut('antigravity', 'alice');
        expect(agy.ok).to.equal(false);
        expect(agy.reason).to.equal('unsupported');

        const unknown = await service.signOut('../codex', 'alice');
        expect(unknown.ok).to.equal(false);
        expect(unknown.reason).to.equal('unsupported');

        const instance = await service.signOut('opencode#2', 'alice');
        expect(instance.ok).to.equal(false);
        expect(instance.reason).to.equal('unsupported');

        expect(forgotten).to.deep.equal([]);
    });

    it('runs CLI logout with expected args/env and forgets + refreshes session', async () => {
        const { runner, forgotten, refreshed, invocations } = createStubRunner();
        const service = new TestHarnessSignOutService(runner);

        const result = await service.signOut('cursor', 'alice');
        expect(result).to.deep.equal({ ok: true, harnessId: 'cursor', connectionState: 'disconnected' });
        expect(invocations).to.deep.equal([{
            harnessKey: 'cursor',
            args: ['logout'],
            ownerLogin: 'alice',
            extraEnv: { NO_OPEN_BROWSER: '1' },
        }]);
        expect(forgotten).to.deep.equal([{ agentId: 'cursor', ownerLogin: 'alice' }]);
        expect(refreshed).to.deep.equal([{ agentId: 'cursor', ownerLogin: 'alice' }]);
    });

    it('executes real non-interactive subprocess with closed stdin and timeout handling', async () => {
        const { runner, forgotten } = createStubRunner({
            resolveHarnessCliInvocation: async () => ({
                file: process.execPath,
                args: ['-e', 'let data = ""; process.stdin.on("data", c => data += c); process.stdin.on("end", () => process.exit(0));'],
                env: process.env,
            }),
        });
        const service = new TestHarnessSignOutService(runner);
        service.useRealCli = true;

        const okResult = await service.signOut('codex', 'alice');
        expect(okResult.ok).to.equal(true);
        expect(forgotten).to.have.length(1);

        // Timed-out command fails cleanly without forgetting session.
        const { runner: slowRunner, forgotten: slowForgotten } = createStubRunner({
            resolveHarnessCliInvocation: async () => ({
                file: process.execPath,
                args: ['-e', 'setTimeout(() => {}, 60000);'],
                env: process.env,
            }),
        });
        const slowService = new TestHarnessSignOutService(slowRunner);
        slowService.useRealCli = true;
        slowService.realTimeoutMs = 150;

        const timedOut = await slowService.signOut('codex', 'alice');
        expect(timedOut.ok).to.equal(false);
        expect(timedOut.reason).to.equal('failed');
        expect(slowForgotten).to.deep.equal([]);
    });

    it('removes files for opencode and strips JSON keys for copilot without touching Settings keys', async () => {
        const authPath = path.join(tmpRoot, '.local', 'share', 'opencode', 'auth.json');
        fs.mkdirSync(path.dirname(authPath), { recursive: true });
        fs.writeFileSync(authPath, '{"provider":"tok"}', 'utf8');
        const settingsFile = path.join(tmpRoot, 'settings.json');
        fs.writeFileSync(settingsFile, '{"apiKey":"keep-me"}', 'utf8');

        const { runner, forgotten } = createStubRunner();
        const service = new TestHarnessSignOutService(runner);

        const opencodeResult = await service.signOut('opencode', 'alice');
        expect(opencodeResult.ok).to.equal(true);
        expect(fs.existsSync(authPath)).to.equal(false);
        expect(fs.readFileSync(settingsFile, 'utf8')).to.include('keep-me');
        expect(forgotten).to.deep.equal([{ agentId: 'opencode', ownerLogin: 'alice' }]);

        const copilotConfig = path.join(tmpRoot, '.copilot', 'config.json');
        fs.mkdirSync(path.dirname(copilotConfig), { recursive: true });
        fs.writeFileSync(copilotConfig, JSON.stringify({
            theme: 'light',
            loggedInUsers: ['alice'],
            copilot_tokens: { a: 'b' },
        }), 'utf8');

        const copilotResult = await service.signOut('copilot', 'alice');
        expect(copilotResult.ok).to.equal(true);
        expect(JSON.parse(fs.readFileSync(copilotConfig, 'utf8'))).to.deep.equal({ theme: 'light' });
    });
});

describe('QaapAgentTaskEndpoint.handleHarnessSignOut', () => {
    interface CapturedResponse {
        statusCode: number;
        headers: Record<string, string>;
        body: unknown;
    }

    function createMockResponse(): { res: Response; captured: CapturedResponse } {
        const captured: CapturedResponse = { statusCode: 200, headers: {}, body: undefined };
        const res = {
            status(code: number): unknown {
                captured.statusCode = code;
                return this;
            },
            setHeader(name: string, value: string): unknown {
                captured.headers[name.toLowerCase()] = value;
                return this;
            },
            json(payload: unknown): unknown {
                captured.body = payload;
                return this;
            },
        } as unknown as Response;
        return { res, captured };
    }

    function createEndpoint(options: {
        authContext: QaapGithubAuthContext;
        ownerLogin?: string;
        signOut?: (harnessId: string, ownerLogin?: string) => Promise<{
            ok: boolean;
            harnessId: string;
            connectionState: 'disconnected' | 'unknown';
            reason?: 'unsupported' | 'unavailable' | 'failed';
            message?: string;
        }>;
    }): QaapAgentTaskEndpoint {
        const endpoint = new QaapAgentTaskEndpoint();
        (endpoint as unknown as { auth: unknown }).auth = {
            authenticate: () => options.authContext,
            resolveUserLogin: () => options.ownerLogin,
        };
        (endpoint as unknown as { harnessSignOut: unknown }).harnessSignOut = options.signOut
            ? { signOut: options.signOut }
            : undefined;
        return endpoint;
    }

    it('rejects cross-site requests and non-JSON fallback requests', async () => {
        const endpoint = createEndpoint({
            authContext: { kind: 'authenticated', user: { login: 'alice', id: 1 } } as unknown as QaapGithubAuthContext,
            ownerLogin: 'alice',
        });

        const cross = createMockResponse();
        await (endpoint as unknown as { handleHarnessSignOut(req: Request, res: Response): Promise<void> }).handleHarnessSignOut(
            { headers: { 'sec-fetch-site': 'cross-site' }, body: { harnessId: 'codex' } } as unknown as Request,
            cross.res,
        );
        expect(cross.captured.statusCode).to.equal(403);

        const nonJson = createMockResponse();
        await (endpoint as unknown as { handleHarnessSignOut(req: Request, res: Response): Promise<void> }).handleHarnessSignOut(
            { headers: { 'content-type': 'text/plain' }, body: { harnessId: 'codex' } } as unknown as Request,
            nonJson.res,
        );
        expect(nonJson.captured.statusCode).to.equal(415);
    });

    it('rejects unauthenticated requests with 401 and unknown harnesses with 400', async () => {
        const unauthEndpoint = createEndpoint({ authContext: { kind: 'unauthorized' } as QaapGithubAuthContext });
        const unauthRes = createMockResponse();
        await (unauthEndpoint as unknown as { handleHarnessSignOut(req: Request, res: Response): Promise<void> }).handleHarnessSignOut(
            { headers: { 'sec-fetch-site': 'same-origin' }, body: { harnessId: 'codex' } } as unknown as Request,
            unauthRes.res,
        );
        expect(unauthRes.captured.statusCode).to.equal(401);

        const authEndpoint = createEndpoint({
            authContext: { kind: 'authenticated', user: { login: 'alice', id: 1 } } as unknown as QaapGithubAuthContext,
            ownerLogin: 'alice',
        });
        const badHarness = createMockResponse();
        await (authEndpoint as unknown as { handleHarnessSignOut(req: Request, res: Response): Promise<void> }).handleHarnessSignOut(
            { headers: { 'sec-fetch-site': 'same-origin' }, body: { harnessId: '../etc' } } as unknown as Request,
            badHarness.res,
        );
        expect(badHarness.captured.statusCode).to.equal(400);
    });

    it('scopes sign-out strictly to the authenticated session owner and returns no-store', async () => {
        const calls: Array<{ harnessId: string; ownerLogin?: string }> = [];
        const endpoint = createEndpoint({
            authContext: { kind: 'authenticated', user: { login: 'alice', id: 1 } } as unknown as QaapGithubAuthContext,
            ownerLogin: 'alice',
            signOut: async (harnessId, ownerLogin) => {
                calls.push({ harnessId, ownerLogin });
                return { ok: true, harnessId, connectionState: 'disconnected' };
            },
        });
        const okRes = createMockResponse();
        await (endpoint as unknown as { handleHarnessSignOut(req: Request, res: Response): Promise<void> }).handleHarnessSignOut(
            {
                headers: { 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' },
                body: { harnessId: 'Codex', ownerLogin: 'bob' },
            } as unknown as Request,
            okRes.res,
        );
        expect(okRes.captured.statusCode).to.equal(200);
        expect(okRes.captured.headers['cache-control']).to.equal('no-store');
        expect(calls).to.deep.equal([{ harnessId: 'codex', ownerLogin: 'alice' }]);
    });
});
