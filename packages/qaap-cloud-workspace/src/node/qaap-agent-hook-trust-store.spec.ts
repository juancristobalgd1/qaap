// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { Container } from '@theia/core/shared/inversify';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { QaapSqliteConnectionRegistry } from '@theia/qaap-persistence/lib/node/qaap-sqlite-store';
import type { QaapAgentHookProcessResult } from '../common/qaap-agent-hooks';
import { QaapAgentHookConfigLoader } from './qaap-agent-hook-config-loader';
import { QaapAgentHookProcessRunner, type QaapAgentHookProcessOptions } from './qaap-agent-hook-process-runner';
import { QaapAgentHookService } from './qaap-agent-hook-service';
import { QaapAgentHookTrustStore, computeQaapAgentHookDigest } from './qaap-agent-hook-trust-store';

class TestTrustStore extends QaapAgentHookTrustStore {
    constructor(protected readonly dbPath: string) {
        super();
    }
    protected override resolveDatabasePath(): string {
        return this.dbPath;
    }
}

class TestConfigLoader extends QaapAgentHookConfigLoader {
    userSettings: Record<string, unknown> = {};
    protected override readUserSettings(): Record<string, unknown> {
        return this.userSettings;
    }
    homeHooksFile: string | undefined;
    protected override userHooksFilePath(): string | undefined {
        return this.homeHooksFile;
    }
}

class RecordingProcessRunner extends QaapAgentHookProcessRunner {
    readonly calls: Array<{ command: string; options: QaapAgentHookProcessOptions }> = [];
    results = new Map<string, QaapAgentHookProcessResult>();
    override async run(command: string, options: QaapAgentHookProcessOptions): Promise<QaapAgentHookProcessResult> {
        this.calls.push({ command, options });
        return this.results.get(command) ?? { exitCode: 0, stdout: '', stderr: '', timedOut: false };
    }
}

describe('qaap agent hook trust', function (): void {
    this.timeout(10_000);

    let tempDir: string;
    let repo: string;
    let trustStore: TestTrustStore;
    let loader: TestConfigLoader;
    let runner: RecordingProcessRunner;
    let service: QaapAgentHookService;
    const savedSqlitePath = process.env.QAAP_SQLITE_STORE_PATH;

    const writeHooks = (value: unknown): void => {
        fs.mkdirSync(path.join(repo, '.qaap'), { recursive: true });
        fs.writeFileSync(path.join(repo, '.qaap', 'hooks.json'), typeof value === 'string' ? value : JSON.stringify(value, undefined, 2));
    };

    beforeEach(() => {
        delete process.env.QAAP_SQLITE_STORE_PATH;
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-hook-trust-'));
        repo = path.join(tempDir, 'repo');
        fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
        fs.mkdirSync(path.join(repo, 'src', 'deep'), { recursive: true });
        const container = new Container();
        trustStore = new TestTrustStore(path.join(tempDir, 'state', 'agent-hook-trust.sqlite'));
        loader = new TestConfigLoader();
        runner = new RecordingProcessRunner();
        container.bind(QaapAgentHookTrustStore).toConstantValue(trustStore);
        container.bind(QaapAgentHookConfigLoader).toConstantValue(loader);
        container.bind(QaapAgentHookProcessRunner).toConstantValue(runner);
        container.bind(QaapAgentHookService).toSelf().inSingletonScope();
        service = container.get(QaapAgentHookService);
    });

    afterEach(() => {
        if (savedSqlitePath === undefined) {
            delete process.env.QAAP_SQLITE_STORE_PATH;
        } else {
            process.env.QAAP_SQLITE_STORE_PATH = savedSqlitePath;
        }
        // Windows cannot delete a directory holding an open SQLite file.
        QaapSqliteConnectionRegistry.shared.closeUnder(tempDir);
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('binds the digest to the scripts the hooks run, not only to the command text', () => {
        fs.mkdirSync(path.join(repo, 'scripts'), { recursive: true });
        fs.writeFileSync(path.join(repo, 'scripts', 'check.sh'), 'echo v1\n');
        fs.writeFileSync(path.join(repo, 'unrelated.txt'), 'x');
        writeHooks({
            hooks: {
                Stop: [{ hooks: [{ command: 'bash ./scripts/check.sh' }, { command: 'bash "$CLAUDE_PROJECT_DIR"/.qaap/stop.sh' }] }],
            },
        });
        fs.writeFileSync(path.join(repo, '.qaap', 'stop.sh'), 'echo stop\n');
        const first = loader.loadWorkspace(repo);
        expect([...first?.coveredFiles ?? []].sort()).to.deep.equal(['.qaap/stop.sh', 'scripts/check.sh']);

        fs.writeFileSync(path.join(repo, 'unrelated.txt'), 'y');
        expect(loader.loadWorkspace(repo)?.digest, 'unrelated file').to.equal(first?.digest);

        fs.writeFileSync(path.join(repo, 'scripts', 'check.sh'), 'echo v2\n');
        const afterScriptEdit = loader.loadWorkspace(repo);
        expect(afterScriptEdit?.digest, 'named script').to.not.equal(first?.digest);

        fs.writeFileSync(path.join(repo, '.qaap', 'helper.py'), 'print(1)\n');
        expect(loader.loadWorkspace(repo)?.digest, 'new file under .qaap/').to.not.equal(afterScriptEdit?.digest);
    });

    it('a trusted workspace returns to pending when a covered script changes', () => {
        fs.mkdirSync(path.join(repo, 'scripts'), { recursive: true });
        fs.writeFileSync(path.join(repo, 'scripts', 'stop.sh'), 'echo ok\n');
        writeHooks({ hooks: { Stop: [{ hooks: [{ command: 'sh scripts/stop.sh' }] }] } });
        const digest = service.status(repo, 'alice').workspace.digest!;
        expect(service.trust(repo, 'alice', digest).ok).to.equal(true);
        expect(service.status(repo, 'alice').workspace.state).to.equal('trusted');
        fs.writeFileSync(path.join(repo, 'scripts', 'stop.sh'), 'echo changed\n');
        expect(service.status(repo, 'alice').workspace.state).to.equal('pending');
    });

    it('locates .qaap/hooks.json from a nested cwd and stops at the git root', () => {
        writeHooks({ hooks: { Stop: [{ hooks: [{ command: 'echo done' }] }] } });
        const loaded = loader.loadWorkspace(path.join(repo, 'src', 'deep'));
        expect(loaded?.root).to.equal(fs.realpathSync(repo));
        expect(loaded?.digest).to.match(/^[a-f0-9]{64}$/);
        // A hooks file above the git root never applies.
        fs.rmSync(path.join(repo, '.qaap'), { recursive: true });
        fs.mkdirSync(path.join(tempDir, '.qaap'));
        fs.writeFileSync(path.join(tempDir, '.qaap', 'hooks.json'), '{}');
        expect(loader.loadWorkspace(path.join(repo, 'src'))).to.equal(undefined);
    });

    it('reports invalid JSON without a digest', () => {
        writeHooks('{ nope');
        const loaded = loader.loadWorkspace(repo);
        expect(loaded?.digest).to.equal(undefined);
        expect(loaded?.errors[0]).to.contain('not valid JSON');
    });

    it('digest is stable across formatting and changes with content', () => {
        writeHooks({ hooks: { Stop: [{ hooks: [{ command: 'echo done' }] }] } });
        const first = loader.loadWorkspace(repo)!.digest;
        writeHooks('{"hooks":{"Stop":[{"hooks":[{"type":"command","command":"echo done"}]}]}}');
        expect(loader.loadWorkspace(repo)!.digest).to.equal(first);
        writeHooks({ hooks: { Stop: [{ hooks: [{ command: 'echo changed' }] }] } });
        expect(loader.loadWorkspace(repo)!.digest).to.not.equal(first);
        expect(first).to.equal(computeQaapAgentHookDigest({ Stop: [{ hooks: [{ type: 'command', command: 'echo done', timeoutSec: 60 }] }] }));
    });

    it('workspace hooks stay pending (and do not run) until trusted', async () => {
        writeHooks({ hooks: { Stop: [{ hooks: [{ command: 'ws-stop' }] }] } });
        const status = service.status(repo, 'alice');
        expect(status.workspace.state).to.equal('pending');
        expect(status.workspace.hooks.map(hook => hook.command)).to.deep.equal(['ws-stop']);

        const result = await service.run({ cwd: repo, ownerLogin: 'alice', sessionId: 's1' }, 'Stop', {});
        expect(result.ranCount).to.equal(0);
        expect(runner.calls).to.have.length(0);
        expect(service.status(repo, 'alice').warnings[0].message).to.contain('waiting for review');

        const trusted = service.trust(repo, 'alice', status.workspace.digest!);
        expect(trusted.ok).to.equal(true);
        expect(trusted.status?.state).to.equal('trusted');
        await service.run({ cwd: repo, ownerLogin: 'alice', sessionId: 's1' }, 'Stop', {});
        expect(runner.calls.map(call => call.command)).to.deep.equal(['ws-stop']);
        expect(runner.calls[0].options.env?.QAAP_HOOK_SOURCE).to.equal('workspace');
    });

    it('trust is per owner and survives a new store instance', () => {
        writeHooks({ hooks: { Stop: [{ hooks: [{ command: 'ws-stop' }] }] } });
        const digest = service.status(repo, 'alice').workspace.digest!;
        service.trust(repo, 'alice', digest);
        expect(service.status(repo, 'bob').workspace.state).to.equal('pending');
        const reopened = new TestTrustStore(path.join(tempDir, 'state', 'agent-hook-trust.sqlite'));
        expect(reopened.decisionFor('alice', fs.realpathSync(repo), digest)).to.equal('trusted');
    });

    it('any change to the declaration invalidates trust', () => {
        writeHooks({ hooks: { Stop: [{ hooks: [{ command: 'ws-stop' }] }] } });
        service.trust(repo, 'alice', service.status(repo, 'alice').workspace.digest!);
        writeHooks({ hooks: { Stop: [{ hooks: [{ command: 'ws-stop && curl evil' }] }] } });
        expect(service.status(repo, 'alice').workspace.state).to.equal('pending');
    });

    it('refuses a decision for a digest that no longer matches the file', () => {
        writeHooks({ hooks: { Stop: [{ hooks: [{ command: 'a' }] }] } });
        const stale = service.status(repo, 'alice').workspace.digest!;
        writeHooks({ hooks: { Stop: [{ hooks: [{ command: 'b' }] }] } });
        expect(service.trust(repo, 'alice', stale).ok).to.equal(false);
        expect(service.status(repo, 'alice').workspace.state).to.equal('pending');
    });

    it('ignore and revoke', () => {
        writeHooks({ hooks: { Stop: [{ hooks: [{ command: 'a' }] }] } });
        const digest = service.status(repo, 'alice').workspace.digest!;
        expect(service.ignore(repo, 'alice', digest).status?.state).to.equal('ignored');
        expect(service.revoke(repo, 'alice').status?.state).to.equal('pending');
    });

    it('user hooks run without review and aggregate decisions', async () => {
        loader.userSettings = {
            'qaap.agentHooks': {
                hooks: {
                    PreToolUse: [{ matcher: 'Bash', hooks: [{ command: 'allow-it' }, { command: 'deny-it' }] }],
                    UserPromptSubmit: [{ hooks: [{ command: 'ctx' }] }],
                },
            },
        };
        runner.results.set('allow-it', { exitCode: 0, stdout: '{"decision":"allow"}', stderr: '', timedOut: false });
        runner.results.set('deny-it', { exitCode: 2, stdout: '', stderr: 'rm is not allowed', timedOut: false });
        runner.results.set('ctx', { exitCode: 0, stdout: 'on branch main', stderr: '', timedOut: false });
        const context = { cwd: repo, ownerLogin: 'alice', sessionId: 'conv-1', taskId: 't1' };

        const decision = await service.evaluatePreToolUse(context, 'Bash', { command: 'rm -rf /' });
        expect(decision).to.deep.equal({ decision: 'deny', reason: 'rm is not allowed' });
        expect(await service.evaluatePreToolUse(context, 'Edit', {})).to.deep.equal({});

        const preTurn = await service.runPreTurn(context, 'fix the bug');
        expect(preTurn).to.deep.equal({ additionalContext: 'on branch main' });
        const promptCall = runner.calls.find(call => call.command === 'ctx')!;
        expect(promptCall.options.input).to.include({ session_id: 'conv-1', hook_event_name: 'UserPromptSubmit', prompt: 'fix the bug', qaap_task_id: 't1' });
    });

    it('merges ~/.qaap/hooks.json with the settings key', async () => {
        loader.userSettings = { 'qaap.agentHooks': { Stop: [{ hooks: [{ command: 'from-settings' }] }] } };
        loader.homeHooksFile = path.join(tempDir, 'home-hooks.json');
        fs.writeFileSync(loader.homeHooksFile, JSON.stringify({ hooks: { Stop: [{ hooks: [{ command: 'from-home' }] }] } }));
        await service.run({ cwd: repo, sessionId: 's' }, 'Stop', {});
        expect(runner.calls.map(call => call.command)).to.deep.equal(['from-settings', 'from-home']);
        expect(runner.calls[0].options.env?.QAAP_HOOK_SOURCE).to.equal('user');
    });

    it('a failing hook never blocks and is surfaced as a warning', async () => {
        loader.userSettings = { 'qaap.agentHooks': { UserPromptSubmit: [{ hooks: [{ command: 'broken' }] }] } };
        runner.results.set('broken', { exitCode: 1, stdout: '', stderr: 'crash', timedOut: false });
        const preTurn = await service.runPreTurn({ cwd: repo, sessionId: 's' }, 'hi');
        expect(preTurn).to.deep.equal({});
        expect(service.status(repo, undefined).warnings.map(warning => warning.message)).to.deep.equal(['crash']);
    });

    it('SessionStart fires once per session, before UserPromptSubmit', async () => {
        loader.userSettings = {
            'qaap.agentHooks': { SessionStart: [{ matcher: 'startup', hooks: [{ command: 'start' }] }], UserPromptSubmit: [{ hooks: [{ command: 'submit' }] }] },
        };
        await service.runPreTurn({ cwd: repo, sessionId: 'conv' }, 'one');
        await service.runPreTurn({ cwd: repo, sessionId: 'conv' }, 'two');
        expect(runner.calls.map(call => call.command)).to.deep.equal(['start', 'submit', 'submit']);
    });

    it('UserPromptSubmit exit 2 blocks the prompt', async () => {
        loader.userSettings = { 'qaap.agentHooks': { UserPromptSubmit: [{ hooks: [{ command: 'gate' }] }] } };
        runner.results.set('gate', { exitCode: 2, stdout: '', stderr: 'contains a secret', timedOut: false });
        expect(await service.runPreTurn({ cwd: repo, sessionId: 's' }, 'AKIA...')).to.deep.equal({ blockedReason: 'contains a secret' });
    });
});
