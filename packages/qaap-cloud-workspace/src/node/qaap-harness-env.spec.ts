// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Request, Response } from '@theia/core/shared/express';
import type { KeyStoreService } from '@theia/core/lib/common/key-store';
import { checkQaapHarnessEnvName } from '@theia/qaap-shared-core/lib/common/qaap-harness-launch-settings';
import type { QaapAgentTask } from '../common/qaap-agent-task';
import { QaapAgentTaskEndpoint } from './qaap-agent-task-endpoint';
import type { QaapAgentTaskRunnerContext } from './qaap-agent-task-runner-context';
import { spawnProcessExtracted } from './qaap-agent-task-runner-timeline2';
import { QaapHarnessEnvSecretStore } from './qaap-harness-env-secret-store';
import { applyQaapHarnessUserEnv, resolveQaapHarnessLaunchPlan } from './qaap-harness-launch-overrides';

const SECRET = 'sk-test-7f3c1d9e-never-printed';
const SETTINGS_PREF = 'ai-features.harness.settings';

/** In-memory OS credential store; `broken` makes every call fail as an unloadable keytar would. */
class FakeKeyStore implements KeyStoreService {
    readonly entries = new Map<string, string>();
    broken = false;
    protected check(): void {
        if (this.broken) {
            throw new Error('keytar unavailable');
        }
    }
    async setPassword(service: string, account: string, password: string): Promise<void> { this.check(); this.entries.set(`${service}|${account}`, password); }
    async getPassword(service: string, account: string): Promise<string | undefined> { this.check(); return this.entries.get(`${service}|${account}`); }
    async deletePassword(service: string, account: string): Promise<boolean> { this.check(); return this.entries.delete(`${service}|${account}`); }
    async findPassword(): Promise<string | undefined> { this.check(); return undefined; }
    async findCredentials(): Promise<Array<{ account: string, password: string }>> { this.check(); return []; }
    async keys(service: string): Promise<string[]> {
        this.check();
        return [...this.entries.keys()].filter(key => key.startsWith(`${service}|`)).map(key => key.slice(service.length + 1));
    }
}

function storeWith(keyStore: KeyStoreService | undefined, filePath: string): QaapHarnessEnvSecretStore {
    const store = new QaapHarnessEnvSecretStore();
    Object.assign(store, { keyStore, filePath });
    return store;
}

/** Captures every console line written while `work` runs. */
async function captureConsole(work: () => Promise<void>): Promise<string> {
    const lines: string[] = [];
    const methods = ['log', 'info', 'warn', 'error', 'debug'] as const;
    const saved = methods.map(method => console[method]);
    for (const method of methods) {
        console[method] = (...args: unknown[]) => { lines.push(args.map(arg => arg instanceof Error ? `${arg.message} ${arg.stack}` : String(arg)).join(' ')); };
    }
    try {
        await work();
    } finally {
        methods.forEach((method, index) => { console[method] = saved[index]; });
    }
    return lines.join('\n');
}

function withEnv(values: Record<string, string | undefined>): () => void {
    const saved = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
    for (const [key, value] of Object.entries(values)) {
        if (value === undefined) {
            delete process.env[key];
        } else {
            process.env[key] = value;
        }
    }
    return () => {
        for (const [key, value] of Object.entries(saved)) {
            if (value === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = value;
            }
        }
    };
}

describe('harness environment variables', () => {
    let dir: string;
    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-harness-env-'));
    });
    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    describe('names', () => {
        it('accepts plain upper-case names and refuses managed or malformed ones', () => {
            for (const name of ['ANTHROPIC_API_KEY', 'OPENAI_BASE_URL', '_X', 'CODEX_PROFILE']) {
                expect(checkQaapHarnessEnvName(name), name).to.equal(undefined);
            }
            for (const name of ['lower', '1ABC', 'A-B', '', 'A'.repeat(129), 'A B']) {
                expect(checkQaapHarnessEnvName(name), name).to.equal('invalid');
            }
            for (const name of ['PATH', 'HOME', 'NODE_OPTIONS', 'DYLD_INSERT_LIBRARIES', 'LD_PRELOAD', 'ELECTRON_RUN_AS_NODE',
                'GIT_SSH_COMMAND', 'SSH_AUTH_SOCK', 'GH_TOKEN', 'GITHUB_TOKEN', 'QAAP_GATE_TOKEN', 'THEIA_CONFIG_DIR', 'CODEX_HOME',
                'CLAUDE_CONFIG_DIR', 'CLAUDE_CODE_SHELL', 'HTTPS_PROXY', 'NO_PROXY', 'IS_SANDBOX', 'OPENCODE_PERMISSION', 'XDG_DATA_HOME', 'BASH_ENV']) {
                expect(checkQaapHarnessEnvName(name), name).to.equal('denied');
            }
        });
    });

    describe('secret store', () => {
        it('keeps values in the OS credential store, by harness', async () => {
            const keyStore = new FakeKeyStore();
            const filePath = path.join(dir, 'secrets', 'harness-environment.json');
            const store = storeWith(keyStore, filePath);
            await store.set('codex#2', 'OPENAI_API_KEY', SECRET);
            expect(await store.get('codex#2', 'OPENAI_API_KEY')).to.equal(SECRET);
            expect(await store.get('codex', 'OPENAI_API_KEY')).to.equal(undefined);
            expect(fs.existsSync(filePath), 'no file while the OS store works').to.equal(false);
        });

        it('falls back to a private 0600 file in a 0700 folder, and never logs the value', async () => {
            const keyStore = new FakeKeyStore();
            keyStore.broken = true;
            const filePath = path.join(dir, 'secrets', 'harness-environment.json');
            const store = storeWith(keyStore, filePath);
            const output = await captureConsole(async () => {
                await store.set('claude', 'ANTHROPIC_API_KEY', SECRET);
                expect(await store.get('claude', 'ANTHROPIC_API_KEY')).to.equal(SECRET);
            });
            expect(output).to.not.contain(SECRET);
            if (process.platform !== 'win32') {
                expect(fs.statSync(filePath).mode & 0o777).to.equal(0o600);
                expect(fs.statSync(path.dirname(filePath)).mode & 0o777).to.equal(0o700);
            }
        });

        it('deletes every value of a harness and nothing of another one', async () => {
            for (const broken of [false, true]) {
                const keyStore = new FakeKeyStore();
                keyStore.broken = broken;
                const store = storeWith(keyStore, path.join(dir, `store-${broken}.json`));
                await store.set('codex#2', 'A_KEY', SECRET);
                await store.set('codex#2', 'B_KEY', SECRET);
                await store.set('codex', 'A_KEY', 'keep');
                await store.deleteAll('codex#2');
                expect(await store.has('codex#2', 'A_KEY')).to.equal(false);
                expect(await store.has('codex#2', 'B_KEY')).to.equal(false);
                expect(await store.get('codex', 'A_KEY')).to.equal('keep');
            }
        });
    });

    describe('launch', () => {
        const readPref = (key: string): unknown => key === SETTINGS_PREF
            ? { claude: { envNames: ['ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL', 'PATH'] } }
            : undefined;

        it('ignores stored variables outside the desktop app', () => {
            for (const env of [{}, { QAAP_CLOUD_MODE: 'hosted' }, { QAAP_DESKTOP: '1', QAAP_TENANT_BACKEND_MODE: '1' }]) {
                expect(resolveQaapHarnessLaunchPlan('claude', readPref, { env })).to.deep.equal({});
            }
            // `PATH` was never a valid name: it does not survive the settings parser either.
            expect(resolveQaapHarnessLaunchPlan('claude', readPref, { env: { QAAP_DESKTOP: '1' } }))
                .to.deep.equal({ envNames: ['ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL'] });
        });

        it('lets the runner win over a user variable', () => {
            const childEnv: NodeJS.ProcessEnv = { RUNNER_SET: 'runner', INHERITED: 'backend' };
            const applied = applyQaapHarnessUserEnv(childEnv, { RUNNER_SET: 'user', INHERITED: 'user', NEW_KEY: 'user', PATH: '/evil' }, { INHERITED: 'backend' });
            expect(applied).to.deep.equal(['INHERITED', 'NEW_KEY']);
            expect(childEnv).to.deep.equal({ RUNNER_SET: 'runner', INHERITED: 'user', NEW_KEY: 'user' });
        });

        it('passes the variables to the harness process env only, never in the command line or a log', async () => {
            const restore = withEnv({ QAAP_DESKTOP: '1', NODE_ENV: undefined, QAAP_CLOUD_MODE: undefined, QAAP_TENANT_BACKEND_MODE: undefined, ANTHROPIC_BASE_URL: undefined });
            const keyStore = new FakeKeyStore();
            const store = storeWith(keyStore, path.join(dir, 'store.json'));
            await store.set('claude', 'ANTHROPIC_API_KEY', SECRET);
            await store.set('claude', 'ANTHROPIC_BASE_URL', 'https://user.example');
            const task = {
                id: 'task-env', cwd: dir, ownerLogin: undefined, agentId: 'claude', state: 'running', autoApprove: true,
                command: 'claude --print --output-format stream-json -p hello',
            } as unknown as QaapAgentTask;
            let spawned: { command: string; env: NodeJS.ProcessEnv } | undefined;
            const tasks = new Map([[task.id, task]]);
            const stub: Record<string, unknown> = {
                tasks,
                stdinPrompts: new Map(),
                promptTempDirs: new Map(),
                processes: new Map(),
                detectedAgents: new Map([['claude', { id: 'claude', bin: 'claude' }]]),
                harnessEnvSecrets: store,
                observability: undefined,
                acquireTaskSandbox: undefined,
                releaseTaskSandbox: undefined,
                agentSandboxFor: undefined,
                logPath: () => path.join(dir, 'task.log'),
                resolveTaskAgentId: () => 'claude',
                // The runner sets its own base URL: it must win over the stored one.
                buildChildEnv: () => ({ ...process.env, ANTHROPIC_BASE_URL: 'https://runner.example' }),
                preferenceReaderForOwner: () => (key: string) => key === SETTINGS_PREF
                    ? { claude: { envNames: ['ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL'] } }
                    : undefined,
                toolGateWired: () => false,
                resolveAgentSpawnIdentity: () => ({ uid: undefined }),
                spawnAgentCommand: (command: string, options: { env: NodeJS.ProcessEnv }) => {
                    spawned = { command, env: options.env };
                    throw new Error('stop after spawn');
                },
            };
            const ctx = new Proxy(stub, { get: (target, key) => key in target ? target[key as string] : () => undefined }) as unknown as QaapAgentTaskRunnerContext;
            try {
                const output = await captureConsole(() => spawnProcessExtracted(ctx, task));
                if (!spawned) {
                    throw new Error(`no spawn: ${output.split(SECRET).join('<secret>').slice(0, 2000)}`);
                }
                expect(spawned?.env.ANTHROPIC_API_KEY).to.equal(SECRET);
                expect(spawned?.env.ANTHROPIC_BASE_URL).to.equal('https://runner.example');
                expect(spawned?.command).to.equal(task.command);
                expect(spawned?.command).to.not.contain(SECRET);
                expect(output).to.not.contain(SECRET);
                expect(JSON.stringify(tasks.get(task.id))).to.not.contain(SECRET);
                await new Promise(resolve => setTimeout(resolve, 20));
                const logFile = path.join(dir, 'task.log');
                expect(fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : '').to.not.contain(SECRET);
            } finally {
                restore();
            }
        });
    });

    describe('routes', () => {
        class TestableEndpoint extends QaapAgentTaskEndpoint {
            list(req: Request, res: Response): Promise<void> { return this.handleListHarnessEnv(req, res); }
            set(req: Request, res: Response): Promise<void> { return this.handleSetHarnessEnv(req, res); }
            remove(req: Request, res: Response): Promise<void> { return this.handleDeleteHarnessEnv(req, res); }
        }

        function endpointWith(store: QaapHarnessEnvSecretStore, prefs: Record<string, unknown>): TestableEndpoint {
            const endpoint = Object.create(TestableEndpoint.prototype) as TestableEndpoint;
            Object.assign(endpoint, {
                requireAuth: () => ({ kind: 'authenticated', userLogin: 'alice' }),
                auth: { resolveUserLogin: () => 'alice' },
                runner: { preferenceReaderForOwner: () => (key: string) => prefs[key] },
                harnessEnvSecrets: store,
            });
            return endpoint;
        }

        function responseRecorder(): { res: Response; status: () => number; body: () => unknown } {
            let status = 200;
            let body: unknown;
            const res = {
                setHeader: () => undefined,
                status: (code: number) => { status = code; return res; },
                json: (payload: unknown) => { body = payload; return res; },
            };
            return { res: res as unknown as Response, status: () => status, body: () => body };
        }

        it('answers 404 outside the desktop app and stores nothing', async () => {
            const restore = withEnv({ QAAP_DESKTOP: undefined });
            try {
                const store = storeWith(new FakeKeyStore(), path.join(dir, 'store.json'));
                const recorder = responseRecorder();
                await endpointWith(store, {}).set({ body: { harnessId: 'claude', name: 'ANTHROPIC_API_KEY', value: SECRET } } as Request, recorder.res);
                expect(recorder.status()).to.equal(404);
                expect(await store.has('claude', 'ANTHROPIC_API_KEY')).to.equal(false);
            } finally {
                restore();
            }
        });

        it('refuses invalid and managed names, unknown harnesses and empty values', async () => {
            const restore = withEnv({ QAAP_DESKTOP: '1', NODE_ENV: undefined, QAAP_CLOUD_MODE: undefined, QAAP_TENANT_BACKEND_MODE: undefined });
            try {
                const store = storeWith(new FakeKeyStore(), path.join(dir, 'store.json'));
                const endpoint = endpointWith(store, {});
                for (const body of [
                    { harnessId: 'claude', name: 'PATH', value: SECRET },
                    { harnessId: 'claude', name: 'QAAP_GATE_TOKEN', value: SECRET },
                    { harnessId: 'claude', name: 'lower', value: SECRET },
                    { harnessId: 'hermes', name: 'A_KEY', value: SECRET },
                    { harnessId: 'claude', name: 'A_KEY', value: '' },
                ]) {
                    const recorder = responseRecorder();
                    await endpoint.set({ body } as Request, recorder.res);
                    expect(recorder.status(), JSON.stringify({ ...body, value: undefined })).to.equal(400);
                    expect(JSON.stringify(recorder.body())).to.not.contain(SECRET);
                }
                expect([...(store as unknown as { keyStore: FakeKeyStore }).keyStore.entries.keys()]).to.deep.equal([]);
            } finally {
                restore();
            }
        });

        it('stores a value without echoing it, and lists names with hasValue only', async () => {
            const restore = withEnv({ QAAP_DESKTOP: '1', NODE_ENV: undefined, QAAP_CLOUD_MODE: undefined, QAAP_TENANT_BACKEND_MODE: undefined });
            try {
                const store = storeWith(new FakeKeyStore(), path.join(dir, 'store.json'));
                const prefs: Record<string, unknown> = { [SETTINGS_PREF]: { 'codex#2': { envNames: ['OPENAI_API_KEY', 'OPENAI_BASE_URL'] } } };
                const endpoint = endpointWith(store, prefs);
                const setRecorder = responseRecorder();
                await endpoint.set({ body: { harnessId: 'codex#2', name: 'OPENAI_API_KEY', value: SECRET } } as Request, setRecorder.res);
                expect(setRecorder.status()).to.equal(200);
                expect(JSON.stringify(setRecorder.body())).to.not.contain(SECRET);
                expect(JSON.stringify(prefs)).to.not.contain(SECRET);

                const listRecorder = responseRecorder();
                await endpoint.list({ query: { harnessId: 'codex#2' } } as unknown as Request, listRecorder.res);
                expect(listRecorder.body()).to.deep.equal({ variables: [
                    { name: 'OPENAI_API_KEY', hasValue: true },
                    { name: 'OPENAI_BASE_URL', hasValue: false },
                ] });

                const deleteRecorder = responseRecorder();
                await endpoint.remove({ body: { harnessId: 'codex#2' } } as Request, deleteRecorder.res);
                expect(deleteRecorder.status()).to.equal(200);
                expect(await store.has('codex#2', 'OPENAI_API_KEY')).to.equal(false);
            } finally {
                restore();
            }
        });
    });
});
