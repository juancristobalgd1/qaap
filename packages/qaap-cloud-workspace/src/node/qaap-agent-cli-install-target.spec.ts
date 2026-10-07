// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import { QaapAgentCliUpdateService, type QaapAgentCliInstallTarget } from './qaap-agent-cli-update-service';
import { resolveAgentCliPrefixForEnv } from './qaap-agent-cli-prefix';
import { QaapAgentTaskRunner } from './qaap-agent-task-runner';
import { QaapTenantSpawnService } from './qaap-tenant-spawn-service';

/**
 * Environment of the production tenant container (image 4841f5ae6baa) where Settings > Harness >
 * Update failed: no `QAAP_TENANT_BACKEND_MODE`/`QAAP_TENANT_CONFIG_ROOT`, HOME on the `/tmp` tmpfs and
 * the agent home on the read-only rootfs.
 */
const PRODUCTION_TENANT_ENV: Readonly<Record<string, string>> = {
    HOME: '/tmp/qaap-home',
    USER: 'qaap-tenant',
    LOGNAME: 'qaap-tenant',
    NODE_ENV: 'production',
    QAAP_DEFAULT_AGENT: 'qaiq',
    QAAP_SYSTEM_SKILLS_DIR: '/opt/qaap/system-skills',
    QAAP_AGENT_HOME: '/home/qaap-agent',
    QAAP_AGENT_UID: '1001',
    QAAP_AGENT_GID: '1001',
    QAAP_TENANT_CONTAINER_UID: '1000',
    QAAP_TENANT_CONTAINER_GID: '1000',
    QAAP_HEADLESS_CHROMIUM: '/usr/bin/chromium',
    QAAP_BUILD_SHA: '4841f5ae6baa',
};

const UNSET_IN_PRODUCTION_TENANT = [
    'QAAP_TENANT_BACKEND_MODE',
    'QAAP_TENANT_CONFIG_ROOT',
    'QAAP_TENANT_AGENT_STORAGE_ROOT',
    'QAAP_CLOUD_MODE',
    'QAAP_TENANT_CONTAINER_ISOLATION',
    'QAAP_AGENT_CLI_UPDATE_CHECK',
    'QAAP_AGENT_UID_PER_USER',
];

const READ_ONLY_AGENT_HOME = '/home/qaap-agent';

interface CapturedProcess {
    readonly file: string;
    readonly args: readonly string[];
}

/** Runs no process: the prefix probe answers like the read-only rootfs, npm like the old raw failure. */
class ReadOnlyRootfsProbe extends QaapAgentCliUpdateService {
    readonly processes: CapturedProcess[] = [];

    constructor(protected readonly fakeBackendUid: number) {
        super();
    }

    get npmInstalls(): CapturedProcess[] {
        return this.processes.filter(process => process.args.includes('install'));
    }

    protected override backendUid(): number | undefined {
        return this.fakeBackendUid;
    }

    protected override resolveSetprivExecutable(): string | undefined {
        return '/usr/bin/setpriv';
    }

    protected override async runBoundedProcess(
        file: string,
        args: readonly string[],
    ): Promise<{ status: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string }> {
        this.processes.push({ file, args });
        if (args.includes('qaap-agent-cli-prefix-prepare')) {
            return { status: 1, signal: null, stdout: '', stderr: `mkdir: cannot create directory '${READ_ONLY_AGENT_HOME}/.qaap': Read-only file system\n` };
        }
        return {
            status: 254,
            signal: null,
            stdout: '',
            stderr: `npm error code ENOENT\nnpm error syscall mkdir\nnpm error path ${READ_ONLY_AGENT_HOME}/.qaap\n`,
        };
    }
}

/** These specs use POSIX paths and uids. */
const posixIt = process.platform === 'win32' ? it.skip : it;

describe('harness CLI install target in the production tenant environment', () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
        for (const key of UNSET_IN_PRODUCTION_TENANT) {
            delete process.env[key];
        }
        Object.assign(process.env, PRODUCTION_TENANT_ENV);
    });

    afterEach(() => {
        for (const key of Object.keys(process.env)) {
            if (!(key in originalEnv)) {
                delete process.env[key];
            }
        }
        Object.assign(process.env, originalEnv);
    });

    posixIt('refuses before npm with an actionable message when a root backend finds the agent home read-only', async () => {
        const prefix = resolveAgentCliPrefixForEnv(process.env, READ_ONLY_AGENT_HOME);
        // Without tenant-backend mode the prefix is the agent home, on the read-only rootfs.
        expect(prefix).to.equal(path.join(READ_ONLY_AGENT_HOME, '.qaap', 'cli'));

        const service = new ReadOnlyRootfsProbe(0);
        const result = await service.installUpdate('codex', { home: process.env.HOME!, prefix, uid: 1001, gid: 1001 });

        expect(result.ok).to.equal(false);
        expect(result.reason).to.equal('refused');
        expect(result.message).to.match(/^Codex was not installed: .*read-only filesystem/);
        expect(result.message).to.match(/administrator/);
        expect(result.message).not.to.match(/ENOENT|EROFS|mkdir|npm error/);
        expect(service.npmInstalls).to.deep.equal([]);
    });

    posixIt('refuses before npm when a non-root backend gets EROFS creating the prefix', async () => {
        const prefix = resolveAgentCliPrefixForEnv(process.env, READ_ONLY_AGENT_HOME);
        const promises = fs.promises as unknown as { mkdir: (directory: fs.PathLike, options?: fs.MakeDirectoryOptions) => Promise<string | undefined> };
        const originalMkdir = promises.mkdir;
        promises.mkdir = async (directory, options) => {
            if (String(directory).startsWith(`${READ_ONLY_AGENT_HOME}/`)) {
                throw Object.assign(new Error(`EROFS: read-only file system, mkdir '${READ_ONLY_AGENT_HOME}/.qaap'`), { code: 'EROFS' });
            }
            return originalMkdir.call(fs.promises, directory, options);
        };
        try {
            const service = new ReadOnlyRootfsProbe(1001);
            const result = await service.installUpdate('codex', { home: process.env.HOME!, prefix, uid: 1001, gid: 1001 });

            expect(result.reason).to.equal('refused');
            expect(result.message).to.match(/^Codex was not installed: .*read-only filesystem/);
            expect(service.npmInstalls).to.deep.equal([]);
        } finally {
            promises.mkdir = originalMkdir;
        }
    });

    posixIt('never installs from a backend whose agents run in tenant worker containers', async () => {
        process.env.QAAP_CLOUD_MODE = 'docker';
        process.env.QAAP_TENANT_CONTAINER_ISOLATION = '1';
        const runner = Object.create(QaapAgentTaskRunner.prototype) as QaapAgentTaskRunner;
        Object.assign(runner, {
            tenantSpawn: Object.create(QaapTenantSpawnService.prototype),
            resolveAgentCliHome: () => READ_ONLY_AGENT_HOME,
            resolveAgentSpawnIdentity: () => ({}),
        });

        const target: QaapAgentCliInstallTarget = runner.resolveAgentCliInstallTarget('alice');
        expect(target.unavailableReason).to.match(/^Harness updates are not available on this server: agents run in an isolated tenant container/);
        expect(target.uid).to.equal(undefined);

        const service = new ReadOnlyRootfsProbe(1000);
        expect(service.isAgentInstallSupported('codex', target)).to.equal(false);
        const result = await service.installUpdate('codex', target);
        expect(result).to.deep.equal({ ok: false, id: 'codex', reason: 'refused', message: target.unavailableReason });
        expect(service.processes).to.deep.equal([]);
    });

    posixIt('keeps the per-tenant backend prefix on its persistent, tenant-private agent storage', () => {
        process.env.QAAP_TENANT_BACKEND_MODE = '1';
        process.env.QAAP_TENANT_CONFIG_ROOT = '/home/theia/.qaap';
        process.env.QAAP_TENANT_AGENT_STORAGE_ROOT = '/home/theia/.qaap/.qaap-agent-storage';
        process.env.QAAP_CLOUD_MODE = 'local';
        const runner = Object.create(QaapAgentTaskRunner.prototype) as QaapAgentTaskRunner;
        Object.assign(runner, {
            tenantSpawn: Object.create(QaapTenantSpawnService.prototype),
            resolveAgentCliHome: () => READ_ONLY_AGENT_HOME,
            resolveAgentSpawnIdentity: () => ({ uid: 1001, gid: 1001 }),
            tenantHomeEnvOverlay: () => ({ HOME: '/tmp/qaap-home', USER: 'qaap-agent', LOGNAME: 'qaap-agent' }),
        });

        const target = runner.resolveAgentCliInstallTarget('alice');
        expect(target.unavailableReason).to.equal(undefined);
        expect(target.prefix).to.equal('/home/theia/.qaap/.qaap-agent-storage/data/qaap-cli');
        expect(target.uid).to.equal(1001);
    });
});
