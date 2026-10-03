// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
    buildQaapNpmInstallInvocation,
    isInPlaceCliUpdateAllowed,
    QaapAgentCliUpdateService,
    QAAP_ALLOW_IN_PLACE_CLI_UPDATE,
    TRACKED_AGENT_CLIS,
} from './qaap-agent-cli-update-service';

class NpmUpdateResultProbe extends QaapAgentCliUpdateService {
    result: {
        readonly status: number | null;
        readonly signal: NodeJS.Signals | null;
        readonly stdout: string;
        readonly stderr: string;
        readonly error?: Error;
    } = { status: null, signal: 'SIGTERM', stdout: '', stderr: '' };

    override isUpdateCheckEnabled(): boolean {
        return true;
    }

    override isInPlaceCliUpdateAllowed(): boolean {
        return true;
    }

    protected override runNpmInstall(): NpmUpdateResultProbe['result'] {
        return this.result;
    }

    protected override isInstallPrefixWritableAsTarget(): boolean {
        return true;
    }

    protected override isSetprivAvailable(): boolean {
        return true;
    }
}

class ReadOnlyNpmUpdateProbe extends NpmUpdateResultProbe {
    protected override isInstallPrefixWritableAsTarget(): boolean {
        return false;
    }
}

describe('QaapAgentCliUpdateService', () => {
    // A non-root backend may only install for its own uid; a root backend drops to 1001 via setpriv.
    const agentUid = typeof process.getuid === 'function' && process.getuid() !== 0 ? process.getuid() : 1001;
    const originalCheck = process.env.QAAP_AGENT_CLI_UPDATE_CHECK;
    const originalNodeEnv = process.env.NODE_ENV;
    const originalCloudMode = process.env.QAAP_CLOUD_MODE;
    const originalAllow = process.env[QAAP_ALLOW_IN_PLACE_CLI_UPDATE];
    const originalAgentUid = process.env.QAAP_AGENT_UID;
    const originalAgentGid = process.env.QAAP_AGENT_GID;

    afterEach(() => {
        if (originalCheck === undefined) {
            delete process.env.QAAP_AGENT_CLI_UPDATE_CHECK;
        } else {
            process.env.QAAP_AGENT_CLI_UPDATE_CHECK = originalCheck;
        }
        if (originalNodeEnv === undefined) {
            delete process.env.NODE_ENV;
        } else {
            process.env.NODE_ENV = originalNodeEnv;
        }
        if (originalCloudMode === undefined) {
            delete process.env.QAAP_CLOUD_MODE;
        } else {
            process.env.QAAP_CLOUD_MODE = originalCloudMode;
        }
        if (originalAllow === undefined) {
            delete process.env[QAAP_ALLOW_IN_PLACE_CLI_UPDATE];
        } else {
            process.env[QAAP_ALLOW_IN_PLACE_CLI_UPDATE] = originalAllow;
        }
        if (originalAgentUid === undefined) {
            delete process.env.QAAP_AGENT_UID;
        } else {
            process.env.QAAP_AGENT_UID = originalAgentUid;
        }
        if (originalAgentGid === undefined) {
            delete process.env.QAAP_AGENT_GID;
        } else {
            process.env.QAAP_AGENT_GID = originalAgentGid;
        }
    });

    it('disables the update check via QAAP_AGENT_CLI_UPDATE_CHECK', async () => {
        process.env.QAAP_AGENT_CLI_UPDATE_CHECK = '0';
        const service = new QaapAgentCliUpdateService();
        expect(service.isUpdateCheckEnabled()).to.equal(false);
        expect(await service.listOutdated()).to.deep.equal({ updates: [] });
    });

    it('rejects in-place update for QAIQ (Docker-layer only)', async () => {
        delete process.env.NODE_ENV;
        delete process.env.QAAP_CLOUD_MODE;
        const service = new QaapAgentCliUpdateService();
        const result = await service.installUpdate('qaiq');
        expect(result.ok).to.equal(false);
        expect(result.id).to.equal('qaiq');
        expect(result.message).to.match(/not updated in-place|Rebuild/i);
    });

    it('rejects unknown agent ids without shelling out', async () => {
        delete process.env.NODE_ENV;
        delete process.env.QAAP_CLOUD_MODE;
        const service = new QaapAgentCliUpdateService();
        const result = await service.installUpdate('not-a-real-agent');
        expect(result.ok).to.equal(false);
        expect(result.message).to.match(/Unknown agent CLI/i);
    });

    it('refuses production installs without a configured non-root agent uid', async () => {
        process.env.NODE_ENV = 'production';
        delete process.env.QAAP_CLOUD_MODE;
        process.env.QAAP_AGENT_CLI_UPDATE_CHECK = '1';
        delete process.env.QAAP_AGENT_UID;
        delete process.env[QAAP_ALLOW_IN_PLACE_CLI_UPDATE];
        expect(isInPlaceCliUpdateAllowed()).to.equal(false);
        const service = new QaapAgentCliUpdateService();
        const result = await service.installUpdate('codex');
        expect(result.ok).to.equal(false);
        expect(result.message).to.match(/configured tenant user/i);
        expect(result.message).not.to.match(/in-place|rebuild/i);
    });

    it('still denies in-place updates in production when the legacy override is set', () => {
        process.env.NODE_ENV = 'production';
        delete process.env.QAAP_AGENT_UID;
        process.env[QAAP_ALLOW_IN_PLACE_CLI_UPDATE] = '1';
        expect(isInPlaceCliUpdateAllowed()).to.equal(false);
    });

    it('rejects install when update checks are disabled', async () => {
        delete process.env.NODE_ENV;
        delete process.env.QAAP_CLOUD_MODE;
        process.env.QAAP_AGENT_CLI_UPDATE_CHECK = '0';
        const service = new QaapAgentCliUpdateService();
        const result = await service.installUpdate('codex', {
            home: '/home/qaap-tenants/alice',
            uid: 1001,
            gid: 1001,
        });
        expect(result.ok).to.equal(false);
        expect(result.message).to.match(/UPDATE_CHECK/i);
    });

    it('treats a signaled npm install as failure and preserves an actionable reason', async () => {
        const service = new NpmUpdateResultProbe();
        const target = { home: '/home/qaap-tenants/alice', uid: agentUid, gid: agentUid };
        const result = await service.installUpdate('codex', target);
        expect(result.ok).to.equal(false);
        expect(result.message).to.match(/SIGTERM/);

        service.result = { status: 1, signal: null, stdout: '', stderr: 'EACCES: permission denied' };
        const permissionFailure = await service.installUpdate('codex', target);
        expect(permissionFailure.ok).to.equal(false);
        expect(permissionFailure.message).to.contain('EACCES: permission denied');
    });

    it('runs lifecycle-enabled npm installs through setpriv into the tenant prefix', () => {
        const invocation = buildQaapNpmInstallInvocation(
            '@openai/codex',
            { prefix: '/home/qaap-tenants/alice/.qaap/cli', uid: 1001, gid: 1001 },
            { backendUid: 0, platform: 'linux' },
        );
        expect(invocation).to.deep.equal({
            file: 'setpriv',
            args: [
                '--reuid', '1001',
                '--regid', '1001',
                '--clear-groups',
                '--',
                'npm',
                'install',
                '-g',
                '--prefix',
                '/home/qaap-tenants/alice/.qaap/cli',
                '--ignore-scripts=false',
                '@openai/codex@latest',
            ],
            shell: false,
        });
    });

    it('refuses root-owned and read-only homes before running npm', async () => {
        const target = { home: '/root/tenant', uid: agentUid, gid: agentUid };
        const service = new NpmUpdateResultProbe();
        const rootPathResult = await service.installUpdate('codex', target);
        expect(rootPathResult.ok).to.equal(false);
        expect(rootPathResult.message).to.match(/not available|writable tenant home/i);

        process.env.NODE_ENV = 'production';
        process.env.QAAP_AGENT_UID = String(agentUid);
        const readOnlyService = new ReadOnlyNpmUpdateProbe();
        const readOnlyResult = await readOnlyService.installUpdate('codex', {
            home: '/home/qaap-tenants/alice',
            uid: agentUid,
            gid: agentUid,
        });
        expect(readOnlyResult.ok).to.equal(false);
        expect(readOnlyResult.message).to.match(/read-only/i);
    });

    it('reports harnesses without an installable package honestly instead of as unknown', async () => {
        process.env.QAAP_AGENT_CLI_UPDATE_CHECK = '1';
        const service = new NpmUpdateResultProbe();
        const result = await service.installUpdate('grok', { home: '/home/qaap-tenants/alice', uid: 1001, gid: 1001 });
        expect(result.ok).to.equal(false);
        expect(result.message).to.match(/no installable package/i);
        expect(result.message).not.to.match(/unknown agent cli/i);
        expect(service.hasInstallablePackage('grok')).to.equal(false);
        expect(service.hasInstallablePackage('codex')).to.equal(true);
    });

    it('refuses a non-persistent /tmp prefix in production even when HOME is a tmpfs', async () => {
        process.env.NODE_ENV = 'production';
        delete process.env.QAAP_CLOUD_MODE;
        process.env.QAAP_AGENT_CLI_UPDATE_CHECK = '1';
        process.env.QAAP_AGENT_UID = '1001';
        const service = new NpmUpdateResultProbe();
        service.result = { status: 0, signal: null, stdout: '', stderr: '' };
        const tmpPrefix = await service.installUpdate('codex', {
            home: '/tmp/qaap-home', prefix: '/tmp/qaap-home/.qaap/cli', uid: 1001, gid: 1001,
        });
        expect(tmpPrefix.ok).to.equal(false);
        expect(service.isAgentInstallSupported('codex', {
            home: '/tmp/qaap-home', prefix: '/tmp/qaap-home/.qaap/cli', uid: 1001, gid: 1001,
        })).to.equal(false);
    });
});

describe('Dockerfile tracked agent CLI coverage', () => {
    it('pins every npm-backed tracked harness into the runtime image and smoke checks Copilot', () => {
        const repositoryRoot = resolve(__dirname, '../../../..');
        const dockerfile = readFileSync(resolve(repositoryRoot, 'Dockerfile'), 'utf8');
        const runtimeSmoke = readFileSync(resolve(repositoryRoot, 'scripts/qaap-image-runtime-check.js'), 'utf8');
        const npmInstall = dockerfile.match(/&& npm install -g \\\r?\n([\s\S]*?)\\\r?\n\s*&& npm install -g bun/)?.[1];

        if (!npmInstall) {
            throw new Error('Dockerfile global agent npm install block was not found.');
        }
        for (const tracked of TRACKED_AGENT_CLIS.filter(cli => !!cli.npmPackage)) {
            expect(tracked.expectedVersionEnv).to.be.a('string');
            expect(npmInstall).to.include(`${tracked.npmPackage}@"\${${tracked.expectedVersionEnv}}"`);
            const versionArg = dockerfile.match(
                new RegExp(`^ARG ${tracked.expectedVersionEnv}=([0-9]+\\.[0-9]+\\.[0-9]+(?:-[A-Za-z0-9.-]+)?)$`, 'm'),
            );
            expect(versionArg, `${tracked.id} must have an exact Dockerfile version pin`).not.to.equal(null);
        }
        expect(TRACKED_AGENT_CLIS.find(cli => cli.id === 'copilot')?.bins).to.include('copilot');
        expect(dockerfile).to.include('&& copilot --version');
        expect(runtimeSmoke).to.include("'copilot'");
        expect(runtimeSmoke).to.include("spawnSync('copilot', ['--version']");
    });
});
