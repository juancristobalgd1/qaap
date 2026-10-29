// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { QaapAgentTaskRunner } from './qaap-agent-task-runner';
import { probeAgentConnectionState } from './qaap-agent-task-runner-utils3';
import { runGitAsync } from './qaap-agent-conversation-store-git';
import { QaapBackendEnvironmentUtils } from './qaap-backend-env-utils';
import { QaapTenantSpawnService } from './qaap-tenant-spawn-service';
import { childProcessEnv, isQaapBackendOnlyEnvKey, qaapGitReadEnv } from './qaap-child-process-env';

const FAKE_SECRETS: Record<string, string> = {
    QAAP_TENANT_BACKEND_SECRET: 'fake-tenant-secret',
    QAAP_TENANT_BACKEND_MASTER_SECRET: 'fake-master-secret',
    QAAP_SECRETS_KEYS: 'k1:ZmFrZQ==',
    QAAP_GITHUB_CLIENT_SECRET: 'fake-client-secret',
    QAAP_VAPID_PRIVATE_KEY: 'fake-vapid',
};

/** Node program that prints the env keys it received as JSON on stdout. */
const DUMP_KEYS = 'process.stdout.write(JSON.stringify(Object.keys(process.env)))';

describe('backend-only secrets never reach child process envs', () => {

    const saved: Record<string, string | undefined> = {};

    beforeEach(() => {
        for (const [key, value] of Object.entries(FAKE_SECRETS)) {
            saved[key] = process.env[key];
            process.env[key] = value;
        }
    });

    afterEach(() => {
        for (const key of Object.keys(FAKE_SECRETS)) {
            if (saved[key] === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = saved[key];
            }
        }
    });

    function expectNoSecrets(keys: readonly string[]): void {
        for (const key of Object.keys(FAKE_SECRETS)) {
            expect(keys, key).not.to.include(key);
        }
    }

    it('classifies every known backend secret as backend-only', () => {
        for (const key of Object.keys(FAKE_SECRETS)) {
            expect(isQaapBackendOnlyEnvKey(key), key).to.equal(true);
        }
        expect(isQaapBackendOnlyEnvKey('QAAP_TASK_TOKEN')).to.equal(false);
        expect(isQaapBackendOnlyEnvKey('PATH')).to.equal(false);
    });

    it('qaapGitReadEnv strips secrets, ignores system git config and keeps overrides', () => {
        const env = qaapGitReadEnv(process.env, { GIT_ASKPASS: '/bin/true' });
        expectNoSecrets(Object.keys(env));
        expect(env.GIT_CONFIG_NOSYSTEM).to.equal('1');
        expect(env.GIT_ASKPASS).to.equal('/bin/true');
        expect(childProcessEnv()).not.to.have.property('QAAP_SECRETS_KEYS');
    });

    it('the auth probe child gets no secrets even when the caller env carries them', async () => {
        const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-probe-')), 'env.json');
        await probeAgentConnectionState('codex', process.execPath, {
            file: process.execPath,
            args: ['-e', `require('fs').writeFileSync(${JSON.stringify(out)}, ${DUMP_KEYS.replace('process.stdout.write', 'String')})`],
            env: { ...process.env },
        });
        expectNoSecrets(JSON.parse(fs.readFileSync(out, 'utf8')));
        fs.rmSync(path.dirname(out), { recursive: true, force: true });
    });

    it('the auth probe child gets no secrets when the caller passes no env', async () => {
        const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-probe-')), 'env.json');
        await probeAgentConnectionState('codex', process.execPath, {
            file: process.execPath,
            args: ['-e', `require('fs').writeFileSync(${JSON.stringify(out)}, ${DUMP_KEYS.replace('process.stdout.write', 'String')})`],
        });
        expectNoSecrets(JSON.parse(fs.readFileSync(out, 'utf8')));
        fs.rmSync(path.dirname(out), { recursive: true, force: true });
    });

    it('the native model discovery spawner always returns an explicit stripped env', () => {
        const noOwner = QaapAgentTaskRunner.prototype.nativeModelDiscoverySpawner.call({}, undefined);
        const spawnNoOwner = noOwner('opencode', ['models']);
        expect(spawnNoOwner?.env, 'no-owner env must be explicit').to.not.equal(undefined);
        expectNoSecrets(Object.keys(spawnNoOwner!.env!));

        const fake = {
            tenantSpawn: {
                tenantHomeEnvOverlay: () => ({ HOME: '/tmp/tenant-home' }),
                wrapArgvForTenant: (_cwd: string, file: string, args: string[]) => ({ file, args }),
            },
            resolveAgentCliPrefix: () => '/tmp/qaap-cli-prefix',
            isTenantPrivilegeDropActive: () => false,
        };
        const owned = QaapAgentTaskRunner.prototype.nativeModelDiscoverySpawner.call(fake, 'alice')('pi', ['--list-models']);
        expect(owned?.env?.HOME).to.equal('/tmp/tenant-home');
        expectNoSecrets(Object.keys(owned!.env!));
    });

    it('runner git reads run with a stripped env', () => {
        const fake = {
            tenantSpawn: { wrapGitForTenant: () => ({ file: process.execPath, args: ['-e', DUMP_KEYS] }) },
        };
        const result = (QaapAgentTaskRunner.prototype as unknown as {
            readGitSync(this: unknown, cwd: string, args: string[]): { stdout: string };
        }).readGitSync.call(fake, process.cwd(), []);
        const keys = JSON.parse(result.stdout) as string[];
        expectNoSecrets(keys);
    });

    it('runGitAsync without an env, and with a full process.env, strips secrets', async () => {
        for (const env of [undefined, { ...process.env }]) {
            const result = await runGitAsync(process.execPath, ['-e', DUMP_KEYS], { cwd: process.cwd(), env, timeoutMs: 10_000 });
            expectNoSecrets(JSON.parse(result.stdout));
        }
    });

    it('the terminal environment merge drops backend-only secrets', () => {
        const merged = new QaapBackendEnvironmentUtils().mergeProcessEnv({ FOO: 'bar', QAAP_SECRETS_KEYS: 'explicit' });
        expectNoSecrets(Object.keys(merged));
        expect(merged.FOO).to.equal('bar');
        expect(merged.PATH).to.equal(process.env.PATH);
    });

    it('QaapTenantSpawnService.launchProcess strips secrets whatever env the caller passes', async () => {
        const launch = (QaapTenantSpawnService.prototype as unknown as {
            launchProcess(this: unknown, file: string, args: string[], options: object): import('child_process').ChildProcess;
        }).launchProcess;
        const fake = { resolveLaunchFile: (file: string) => file };
        for (const options of [{ stdio: 'pipe' }, { stdio: 'pipe', env: { ...process.env } }]) {
            const child = launch.call(fake, process.execPath, ['-e', DUMP_KEYS], options);
            let stdout = '';
            child.stdout!.on('data', (chunk: Buffer) => { stdout += String(chunk); });
            await new Promise<void>(resolve => child.on('close', () => resolve()));
            expectNoSecrets(JSON.parse(stdout));
        }
    });
});
