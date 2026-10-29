// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { spawnSync, type ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resolveQaapReposRoot, resolveTenantHome } from '@theia/qaap-adapters/lib/common/qaap-user-isolation';
import { QaapTenantAgentStorageEnv } from './qaap-tenant-agent-storage-env';
import { QaapTenantSpawnService } from './qaap-tenant-spawn-service';
import { resolveTrustedSystemExecutable } from './qaap-trusted-executable';

interface LaunchCall { file: string; args: string[]; options: { uid?: number; gid?: number; env?: NodeJS.ProcessEnv; shell?: boolean } }

/**
 * Test double: captures the argv/options that would reach `child_process.spawn` without executing,
 * and lets each test pin the resolved identity + whether `setpriv` is "available".
 */
class TestTenantSpawnService extends QaapTenantSpawnService {
    readonly launches: LaunchCall[] = [];
    identity: { uid?: number; gid?: number } = {};
    setpriv = true;
    setprivPath = '/usr/bin/setpriv';
    prepared: string[] = [];
    container = false;
    linuxResourceLimits = false;
    systemdRun = false;
    /** Pinned so results do not depend on whether the test runner itself runs as root. */
    backendRoot = false;

    /** Storage roots the service tried to create (never touches the real filesystem in tests). */
    storagePrepared: string[] = [];

    override isContainerIsolationEnabled(): boolean {
        return this.container;
    }

    protected override ensureTenantAgentStorage(root: string): void {
        this.storagePrepared.push(root);
        this.preparedAgentStorageRoots.add(root);
    }

    /** Persistent HOME links the service requested (never touches the real filesystem in tests). */
    linkedHomes: Array<{ home: string; persistentHome: string; owner?: { uid: number; gid: number } }> = [];

    protected override linkPersistentTenantHome(home: string, persistentHome: string, owner?: { uid: number; gid: number }): void {
        this.linkedHomes.push({ home, persistentHome, ...(owner ? { owner } : {}) });
    }

    protected override isBackendRoot(): boolean {
        return this.backendRoot;
    }

    override resolveSpawnIdentity(cwd: string): { uid?: number; gid?: number } {
        // Exercise the production backend-mode guard instead of the pinned test identity for the
        // dedicated worker case below.
        if (/^(1|true)$/i.test(process.env.QAAP_TENANT_BACKEND_MODE?.trim() ?? '')) {
            return super.resolveSpawnIdentity(cwd);
        }
        return this.identity;
    }
    protected override isSetprivAvailable(): boolean {
        return this.setpriv;
    }
    protected override resolveSetprivExecutable(): string | undefined {
        return this.setpriv ? this.setprivPath : undefined;
    }
    protected override isLinuxResourceLimitPlatform(): boolean {
        return this.linuxResourceLimits;
    }
    protected override isSystemdRunAvailable(): boolean {
        return this.systemdRun;
    }
    override prepareTenantIsolation(cwd: string): void {
        this.prepared.push(cwd);
    }
    override enforceIsolationPolicy(): void {
        // exercised separately via evaluateAgentIsolationPolicy; keep the spawn tests hermetic
    }
    protected override launchProcess(file: string, args: string[], options: object): ChildProcess {
        this.launches.push({ file, args, options: options as LaunchCall['options'] });
        return {} as ChildProcess;
    }
}

class TestOwnershipRepairService extends QaapTenantSpawnService {
    readonly repairs: Array<{ cwd: string; uid: number; gid: number }> = [];
    repairSucceeds = true;

    protected override isBackendRoot(): boolean { return true; }
    override resolveSpawnIdentity(): { uid: number; gid: number } { return { uid: 20005, gid: 20006 }; }
    protected override assertTenantCwdInProduction(): void { /* test seam */ }
    protected override ensureTenantRootIsolated(): void { /* test seam */ }
    protected override ensureTenantIdentityProvisioned(): void { /* test seam */ }
    protected override applyTenantWorkingTreeOwnership(cwd: string, uid: number, gid: number): boolean {
        this.repairs.push({ cwd, uid, gid });
        return this.repairSucceeds;
    }
}

class TenantBackendAclTestService extends QaapTenantSpawnService {
    readonly commands: Array<{ file: string; args: readonly string[] }> = [];

    protected override isBackendRoot(): boolean { return true; }
    protected override runTenantAccessCommand(file: string, args: readonly string[]): { ok: boolean; reason?: string } {
        this.commands.push({ file, args });
        return { ok: true };
    }
}

/** Fails the `find` sweeps with a concrete cause, as a live harness that deletes files mid-sweep does. */
class FailingStorageSweepService extends TenantBackendAclTestService {
    /** When set, only `find` sweeps rooted at this directory fail; the others succeed. */
    failingSweepDir?: string;

    protected override runTenantAccessCommand(file: string, args: readonly string[]): { ok: boolean; reason?: string } {
        this.commands.push({ file, args });
        const failed = file === 'find' && (this.failingSweepDir === undefined || args[0] === this.failingSweepDir);
        return failed
            ? { ok: false, reason: 'find exit status 1: setfacl: /home/theia/.qaap/.qaap-agent-storage/cache/x.db: No such file or directory' }
            : { ok: true };
    }

    prepare(root: string): void {
        this.ensureTenantAgentStorage(root);
    }

    isPrepared(root: string): boolean {
        return this.preparedAgentStorageRoots.has(root);
    }
}

const reposRoot = resolveQaapReposRoot();
const tenantCwd = path.join(reposRoot, 'users', 'alice', 'octocat', 'hello');

describe('Qaap command output capture', () => {
    it('captures output and a failing exit status from a real shell command', async () => {
        class LocalSpawn extends QaapTenantSpawnService {
            override resolveSpawnIdentity(): {} { return {}; }
            protected override isSetprivAvailable(): boolean { return false; }
        }
        const service = new LocalSpawn();
        const child = service.spawn(`"${process.execPath}" -e "console.log('qaap-capture');process.exit(7)"`, {
            cwd: process.cwd(), env: process.env, stdio: ['ignore', 'pipe', 'pipe']
        });
        let output = '';
        child.stdout?.on('data', chunk => { output += chunk; });
        const code = await new Promise<number | null>((resolve, reject) => {
            child.once('error', reject);
            child.once('close', resolve);
        });
        expect(output).to.contain('qaap-capture');
        expect(code).to.equal(7);
    });
});

describe('QaapTenantSpawnService.prepareTenantIsolation', () => {

    it('repairs the complete working tree once even when the root directory was already tenant-owned', () => {
        const svc = new TestOwnershipRepairService();
        svc.prepareTenantIsolation(tenantCwd);
        svc.prepareTenantIsolation(tenantCwd);
        expect(svc.repairs).to.deep.equal([{ cwd: tenantCwd, uid: 20005, gid: 20006 }]);
    });

    it('retries ownership repair after a failed chown', () => {
        const svc = new TestOwnershipRepairService();
        svc.repairSucceeds = false;
        svc.prepareTenantIsolation(tenantCwd);
        svc.repairSucceeds = true;
        svc.prepareTenantIsolation(tenantCwd);
        expect(svc.repairs).to.have.length(2);
    });
});

describe('QaapTenantSpawnService tenant backend workspace ACL', () => {

    const envKeys = [
        'QAAP_CLOUD_MODE', 'QAAP_TENANT_CONTAINER_ISOLATION', 'QAAP_TENANT_BACKEND_MODE',
        'QAAP_AGENT_UID', 'QAAP_AGENT_GID', 'QAAP_AGENT_UID_PER_USER', 'QAAP_REPOS_ROOT', 'QAAP_TENANT_CONFIG_ROOT',
    ] as const;
    const saved: Partial<Record<typeof envKeys[number], string | undefined>> = {};

    beforeEach(() => {
        for (const key of envKeys) {
            saved[key] = process.env[key];
        }
        process.env.QAAP_CLOUD_MODE = 'local';
        process.env.QAAP_TENANT_CONTAINER_ISOLATION = '0';
        process.env.QAAP_TENANT_BACKEND_MODE = '1';
        process.env.QAAP_AGENT_UID = '1001';
        process.env.QAAP_AGENT_GID = '1001';
        process.env.QAAP_AGENT_UID_PER_USER = '0';
    });

    afterEach(() => {
        for (const key of envKeys) {
            const value = saved[key];
            if (value === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = value;
            }
        }
    });

    it('grants the non-root agent ACLs only inside its mounted login tree', () => {
        const reposRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-tenant-agent-acl-'));
        const tenantRoot = path.join(reposRoot, 'users', 'alice');
        const cwd = path.join(tenantRoot, 'octocat', 'hello');
        fs.mkdirSync(cwd, { recursive: true });
        process.env.QAAP_REPOS_ROOT = reposRoot;
        try {
            const service = new TenantBackendAclTestService();
            service.prepareTenantIsolation(cwd);
            service.prepareTenantIsolation(cwd);

            expect(service.commands).to.have.length(3);
            expect(service.commands[0]).to.deep.equal({
                file: 'setfacl',
                args: ['-m', 'u:1001:rwx,d:u:1001:rwx', tenantRoot],
            });
            expect(service.commands[1]?.args).to.include.members(['-uid', '0', '-type', 'd']);
            expect(service.commands[2]?.args).to.include.members(['-uid', '0', '-type', 'f']);
            expect(service.commands.flatMap(command => command.args).join(' ')).not.to.include(path.join(reposRoot, 'users', 'bob'));
        } finally {
            fs.rmSync(reposRoot, { recursive: true, force: true });
        }
    });

    it('re-grants the dropped agent uid on harness state written while agents ran as root', () => {
        class StorageAclTestService extends TenantBackendAclTestService {
            grant(configRoot: string, root: string, uid: number): void {
                this.grantTenantAgentStorageAccess(configRoot, root, uid);
            }
        }
        const service = new StorageAclTestService();
        const root = '/home/theia/.qaap/.qaap-agent-storage';
        service.grant('/home/theia/.qaap', root, 1001);

        const finds = service.commands.filter(command => command.file === 'find');
        // Existing root-owned dirs and files (opencode.db, opencode.log) under cache and data, and the
        // root-owned CLI state (.codex, .claude, ...) under home that the sign-in links point to.
        expect(finds).to.have.length(6);
        for (const dir of [`${root}/cache`, `${root}/data`, QaapTenantAgentStorageEnv.homeDir(root)]) {
            const forDir = finds.filter(command => command.args[0] === dir);
            expect(forDir.map(command => command.args[command.args.indexOf('-type') + 1])).to.deep.equal(['d', 'f']);
            expect(forDir[0]?.args).to.include.members(['-uid', '0', 'u:1001:rwx,d:u:1001:rwx']);
            expect(forDir[1]?.args).to.include.members(['-uid', '0', 'u:1001:rwX']);
        }
    });

    it('attempts the agent storage grant once per root and logs its concrete cause once per directory', () => {
        const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-agent-storage-'));
        process.env.QAAP_AGENT_UID = '1001';
        process.env.QAAP_TENANT_CONFIG_ROOT = storageRoot;
        const savedWarn = console.warn;
        const warnings: string[] = [];
        console.warn = (...args: unknown[]) => { warnings.push(args.map(String).join(' ')); };
        try {
            const service = new FailingStorageSweepService();
            for (let attempt = 0; attempt < 5; attempt++) {
                service.prepare(storageRoot);
            }
            // One failing dirs sweep per cache, data and home; the files sweep is skipped after a failure.
            expect(service.commands.filter(command => command.file === 'find')).to.have.length(3);
            expect(warnings).to.have.length(3);
            expect(warnings[0]).to.include('may not reach existing harness state').and.to.include('No such file or directory');
        } finally {
            console.warn = savedWarn;
            fs.rmSync(storageRoot, { recursive: true, force: true });
        }
    });

    it('keeps sweeping the home directory when the cache sweep fails', () => {
        const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-agent-storage-'));
        process.env.QAAP_AGENT_UID = '1001';
        process.env.QAAP_TENANT_CONFIG_ROOT = storageRoot;
        const savedWarn = console.warn;
        const warnings: string[] = [];
        console.warn = (...args: unknown[]) => { warnings.push(args.map(String).join(' ')); };
        try {
            const service = new FailingStorageSweepService();
            service.failingSweepDir = QaapTenantAgentStorageEnv.cacheDir(storageRoot);
            service.prepare(storageRoot);
            const finds = service.commands.filter(command => command.file === 'find');
            const homeDir = QaapTenantAgentStorageEnv.homeDir(storageRoot);
            // The cache failure skips only its own file sweep; data and home are still repaired.
            expect(finds.filter(command => command.args[0] === homeDir).map(command => command.args[command.args.indexOf('-type') + 1]))
                .to.deep.equal(['d', 'f']);
            expect(finds.filter(command => command.args[0] === QaapTenantAgentStorageEnv.dataDir(storageRoot))).to.have.length(2);
            expect(warnings).to.have.length(1);
            expect(warnings[0]).to.include(QaapTenantAgentStorageEnv.cacheDir(storageRoot));
            expect(service.isPrepared(storageRoot)).to.equal(true);
        } finally {
            console.warn = savedWarn;
            fs.rmSync(storageRoot, { recursive: true, force: true });
        }
    });

    it('prepares the storage root even when the harness-state sweep fails, so sign-in links are still created', () => {
        const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-agent-storage-'));
        process.env.QAAP_AGENT_UID = '1001';
        process.env.QAAP_TENANT_CONFIG_ROOT = storageRoot;
        const savedWarn = console.warn;
        console.warn = () => undefined;
        try {
            const service = new FailingStorageSweepService();
            service.prepare(storageRoot);
            expect(service.isPrepared(storageRoot)).to.equal(true);
            // The fail-closed ACLs on the root, the config dir and the storage children still ran.
            expect(service.commands.filter(command => command.file === 'setfacl')).to.have.length(3);
        } finally {
            console.warn = savedWarn;
            fs.rmSync(storageRoot, { recursive: true, force: true });
        }
    });

    it('grants the agent uid an ACL on a HOME entry it cannot chown, with a default ACL on directories', () => {
        class HomeGrantService extends TenantBackendAclTestService {
            grant(entry: string, uid: number, directory: boolean): void {
                this.grantTenantEntryAccess(entry, uid, directory);
            }
        }
        const service = new HomeGrantService();
        service.grant('/tmp/qaap-home/.codex', 1001, true);
        service.grant('/tmp/qaap-home/.claude.json', 1001, false);

        expect(service.commands).to.deep.equal([
            { file: 'setfacl', args: ['-m', 'u:1001:rwx,d:u:1001:rwx', '/tmp/qaap-home/.codex'] },
            { file: 'setfacl', args: ['-m', 'u:1001:rw', '/tmp/qaap-home/.claude.json'] },
        ]);
    });

    it('fails the HOME grant with the setfacl reason so the link reports it', () => {
        class RefusingAclService extends TenantBackendAclTestService {
            protected override runTenantAccessCommand(file: string, args: readonly string[]): { ok: boolean; reason?: string } {
                this.commands.push({ file, args });
                return { ok: false, reason: 'setfacl: Operation not supported' };
            }

            grant(entry: string): void {
                this.grantTenantEntryAccess(entry, 1001, true);
            }
        }
        const service = new RefusingAclService();
        expect(() => service.grant('/tmp/qaap-home/.codex'))
            .to.throw('Could not grant agent uid 1001 access to /tmp/qaap-home/.codex (setfacl: Operation not supported).');
    });

    it('reports the exit status and first stderr line of a failed access command', () => {
        class RawRunService extends QaapTenantSpawnService {
            run(file: string, args: readonly string[]): { ok: boolean; reason?: string } {
                return this.runTenantAccessCommand(file, args);
            }
        }
        const result = new RawRunService().run(process.execPath, ['-e', 'process.stderr.write("setfacl: boom\\n"); process.exit(3)']);
        expect(result.ok).to.equal(false);
        expect(result.reason).to.include('exit status 3').and.to.include('setfacl: boom');
    });

    it('refuses tenant agent execution when the image has no non-root uid configured', () => {
        delete process.env.QAAP_AGENT_UID;
        const service = new TenantBackendAclTestService();
        expect(() => service.resolveSpawnIdentity(tenantCwd)).to.throw(/non-root QAAP_AGENT_UID/);
    });
});

describe('QaapTenantSpawnService.spawnArgvPrepared', () => {

    const originalMemoryLimit = process.env.QAAP_AGENT_MEMORY_LIMIT;
    const originalCpuLimit = process.env.QAAP_AGENT_CPU_LIMIT;
    const originalNodeEnv = process.env.NODE_ENV;
    const originalTenantBackendMode = process.env.QAAP_TENANT_BACKEND_MODE;
    const originalAgentUid = process.env.QAAP_AGENT_UID;
    const originalAgentGid = process.env.QAAP_AGENT_GID;
    const originalReposRoot = process.env.QAAP_REPOS_ROOT;
    const originalStorageRoot = process.env.QAAP_TENANT_AGENT_STORAGE_ROOT;
    const originalConfigRoot = process.env.QAAP_TENANT_CONFIG_ROOT;
    afterEach(() => {
        for (const [key, value] of [
            ['QAAP_TENANT_AGENT_STORAGE_ROOT', originalStorageRoot],
            ['QAAP_TENANT_CONFIG_ROOT', originalConfigRoot],
        ] as const) {
            if (value === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = value;
            }
        }
        if (originalMemoryLimit === undefined) {
            delete process.env.QAAP_AGENT_MEMORY_LIMIT;
        } else {
            process.env.QAAP_AGENT_MEMORY_LIMIT = originalMemoryLimit;
        }
        if (originalCpuLimit === undefined) {
            delete process.env.QAAP_AGENT_CPU_LIMIT;
        } else {
            process.env.QAAP_AGENT_CPU_LIMIT = originalCpuLimit;
        }
        if (originalNodeEnv === undefined) {
            delete process.env.NODE_ENV;
        } else {
            process.env.NODE_ENV = originalNodeEnv;
        }
        if (originalTenantBackendMode === undefined) {
            delete process.env.QAAP_TENANT_BACKEND_MODE;
        } else {
            process.env.QAAP_TENANT_BACKEND_MODE = originalTenantBackendMode;
        }
        for (const [key, value] of [['QAAP_AGENT_UID', originalAgentUid], ['QAAP_AGENT_GID', originalAgentGid], ['QAAP_REPOS_ROOT', originalReposRoot]] as const) {
            if (value === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = value;
            }
        }
    });

    it('wraps argv in a systemd cgroup with memory and CPU limits on Linux', () => {
        process.env.QAAP_AGENT_MEMORY_LIMIT = '512MiB';
        process.env.QAAP_AGENT_CPU_LIMIT = '1.5';
        const svc = new TestTenantSpawnService();
        svc.linuxResourceLimits = true;
        svc.systemdRun = true;
        svc.spawnArgvPrepared('npm', ['run', 'dev'], { cwd: tenantCwd, env: {} });
        expect(svc.launches[0].file).to.equal('systemd-run');
        expect(svc.launches[0].args).to.include.members([
            '--user', '--scope', '--property=MemoryMax=536870912', '--property=CPUQuota=150%',
        ]);
        expect(svc.launches[0].args.slice(-4)).to.deep.equal(['--', 'npm', 'run', 'dev']);
        expect(svc.launches[0].options.shell).to.equal(false);
    });

    it('uses the system systemd manager when the backend runs as root', () => {
        const svc = new TestTenantSpawnService();
        svc.backendRoot = true;
        svc.linuxResourceLimits = true;
        svc.systemdRun = true;
        svc.spawnArgvPrepared('npm', ['run', 'dev'], { cwd: tenantCwd, env: {} });
        // A root backend launches the absolute, root-owned systemd-run so a tenant PATH cannot shadow it.
        expect(svc.launches[0].file).to.equal(resolveTrustedSystemExecutable('systemd-run') ?? 'systemd-run');
        expect(svc.launches[0].args).to.include('--system');
        expect(svc.launches[0].args).not.to.include('--user');
    });

    it('applies inherited rlimits on a non-systemd development Linux host', () => {
        const svc = new TestTenantSpawnService();
        svc.linuxResourceLimits = true;
        svc.systemdRun = false;
        svc.spawnArgvPrepared('node', ['-e', 'process.exit(0)'], { cwd: tenantCwd, env: {} });
        expect(svc.launches[0].file).to.equal('/bin/sh');
        expect(svc.launches[0].args[0]).to.equal('-c');
        expect(svc.launches[0].args[1]).to.contain('ulimit -v');
        expect(svc.launches[0].args.slice(-3)).to.deep.equal(['node', '-e', 'process.exit(0)']);
    });

    it('rlimit fallback execs the wrapped executable itself, not its first argument', function (): void {
        // The fallback is Linux-only in production (isLinuxResourceLimitPlatform); it runs the
        // real /bin/sh ulimit script, whose -v/-t flags are not portable to macOS or Windows.
        if (process.platform !== 'linux') {
            this.skip();
        }
        const svc = new TestTenantSpawnService();
        svc.linuxResourceLimits = true;
        svc.systemdRun = false;
        svc.spawnArgvPrepared('/bin/echo', ['qaap-wrapped-ok'], { cwd: tenantCwd, env: {} });
        const launch = svc.launches[0];
        const result = spawnSync(launch.file, launch.args, { encoding: 'utf8' });
        expect(result.status).to.equal(0);
        expect(result.stdout.trim()).to.equal('qaap-wrapped-ok');
    });

    it('drops agent tasks to the configured non-root uid inside a backend-per-tenant container', () => {
        process.env.QAAP_TENANT_BACKEND_MODE = '1';
        process.env.QAAP_AGENT_UID = '1001';
        process.env.QAAP_AGENT_GID = '1001';
        const svc = new TestTenantSpawnService();
        svc.backendRoot = true;
        svc.linuxResourceLimits = true;
        svc.systemdRun = false;
        svc.spawnArgvPrepared('npm', ['run', 'dev'], { cwd: tenantCwd, env: {} });
        // Only the OOM-preference shell wraps it (no host rlimit/systemd wrapper), and a root backend
        // launches the trusted absolute setpriv, never a PATH-resolved one.
        expect(svc.launches[0].file).to.equal('/bin/sh');
        expect(svc.launches[0].args[1]).to.contain('/proc/self/oom_score_adj');
        expect(svc.launches[0].args.slice(2)).to.deep.equal([
            'qaap-oom-preferred', svc.setprivPath, '--reuid', '1001', '--regid', '1001', '--clear-groups', '--', 'npm', 'run', 'dev',
        ]);
    });

    it('passes a shell command to the OOM-preference wrapper as one argument inside a tenant backend', () => {
        process.env.QAAP_TENANT_BACKEND_MODE = '1';
        const svc = new TestTenantSpawnService();
        svc.backendRoot = false;
        svc.linuxResourceLimits = true;
        svc.spawn('npm run dev -- --port 5173', { cwd: tenantCwd, env: {}, stdio: ['pipe', 'pipe', 'pipe'] });
        expect(svc.launches[0].file).to.equal('/bin/sh');
        expect(svc.launches[0].args[1]).to.match(/oom_score_adj; } 2>\/dev\/null; exec \/bin\/sh -c "\$1"$/);
        expect(svc.launches[0].args.slice(2)).to.deep.equal(['qaap-oom-preferred', 'npm run dev -- --port 5173']);
    });

    it('OOM-preference wrapper raises oom_score_adj and execs the wrapped executable itself', function (): void {
        // Real /bin/sh and /proc: Linux only (same reason as the rlimit fallback spec above).
        if (process.platform !== 'linux') {
            this.skip();
        }
        process.env.QAAP_TENANT_BACKEND_MODE = '1';
        const svc = new TestTenantSpawnService();
        svc.backendRoot = false;
        svc.linuxResourceLimits = true;
        svc.spawnArgvPrepared('/bin/cat', ['/proc/self/oom_score_adj'], { cwd: tenantCwd, env: {} });
        const launch = svc.launches[0];
        const result = spawnSync(launch.file, launch.args, { encoding: 'utf8' });
        expect(result.status).to.equal(0);
        expect(result.stdout.trim()).to.equal('500');
    });

    it('keeps an already non-root tenant backend agent under the backend uid', () => {
        process.env.QAAP_TENANT_BACKEND_MODE = '1';
        process.env.QAAP_AGENT_UID = '1001';
        process.env.QAAP_AGENT_GID = '1001';
        const svc = new TestTenantSpawnService();
        svc.backendRoot = false;
        svc.spawnArgvPrepared('npm', ['run', 'dev'], { cwd: tenantCwd, env: {} });
        expect(svc.launches[0].file).to.equal('npm');
        expect(svc.launches[0].args).to.deep.equal(['run', 'dev']);
    });

    it('refuses a non-root tenant backend when QAAP_TENANT_BACKEND_REQUIRE_AGENT_DROP is set', () => {
        process.env.QAAP_TENANT_BACKEND_MODE = '1';
        process.env.QAAP_TENANT_BACKEND_REQUIRE_AGENT_DROP = '1';
        try {
            const svc = new TestTenantSpawnService();
            svc.backendRoot = false;
            expect(() => svc.resolveSpawnIdentity(tenantCwd)).to.throw(/own uid.*QAAP_TENANT_CONTAINER_UID=0/);
        } finally {
            delete process.env.QAAP_TENANT_BACKEND_REQUIRE_AGENT_DROP;
        }
    });

    it('keeps the inherited identity for a non-root tenant backend without the agent-drop flag', () => {
        process.env.QAAP_TENANT_BACKEND_MODE = '1';
        delete process.env.QAAP_TENANT_BACKEND_REQUIRE_AGENT_DROP;
        const svc = new TestTenantSpawnService();
        svc.backendRoot = false;
        expect(svc.resolveSpawnIdentity(tenantCwd)).to.deep.equal({});
    });

    it('drops to the agent uid for a root tenant backend with the agent-drop flag', () => {
        process.env.QAAP_TENANT_BACKEND_MODE = '1';
        process.env.QAAP_TENANT_BACKEND_REQUIRE_AGENT_DROP = '1';
        process.env.QAAP_AGENT_UID = '1001';
        process.env.QAAP_AGENT_GID = '1001';
        try {
            const svc = new TestTenantSpawnService();
            svc.backendRoot = true;
            expect(svc.resolveSpawnIdentity(tenantCwd)).to.deep.equal({ uid: 1001, gid: 1001 });
        } finally {
            delete process.env.QAAP_TENANT_BACKEND_REQUIRE_AGENT_DROP;
        }
    });

    it('fails closed instead of spawning without limits in production host mode', () => {
        process.env.NODE_ENV = 'production';
        const svc = new TestTenantSpawnService();
        svc.linuxResourceLimits = true;
        svc.systemdRun = false;
        expect(() => svc.spawnArgvPrepared('node', [], { cwd: tenantCwd, env: {} }))
            .to.throw(/systemd-run with cgroups/);
        expect(svc.launches).to.have.length(0);
    });

    it('wraps the agent shell command itself in the same systemd cgroup', () => {
        const svc = new TestTenantSpawnService();
        svc.linuxResourceLimits = true;
        svc.systemdRun = true;
        svc.spawn('node -e "process.exit(0)"', { cwd: tenantCwd, env: {}, stdio: ['ignore', 'pipe', 'pipe'] });
        expect(svc.launches[0].file).to.equal('systemd-run');
        expect(svc.launches[0].args.slice(-3)).to.deep.equal(['/bin/sh', '-c', 'node -e "process.exit(0)"']);
        expect(svc.launches[0].options.shell).to.equal(false);
    });

    it('wraps the dev command in setpriv --clear-groups when a uid drop applies', () => {
        const svc = new TestTenantSpawnService();
        svc.identity = { uid: 20005, gid: 20005 };
        svc.spawnArgvPrepared('npm', ['run', 'dev'], { cwd: tenantCwd, env: {} });
        expect(svc.launches).to.have.length(1);
        expect(svc.launches[0].file).to.equal('setpriv');
        expect(svc.launches[0].args).to.deep.equal(
            ['--reuid', '20005', '--regid', '20005', '--clear-groups', '--', 'npm', 'run', 'dev']);
        // No Node-level uid/gid when setpriv does the drop.
        expect(svc.launches[0].options.uid).to.equal(undefined);
    });

    it('prepares the tenant tree (provision + chown) before spawning', () => {
        const svc = new TestTenantSpawnService();
        svc.identity = { uid: 20005, gid: 20005 };
        svc.spawnArgvPrepared('npm', ['run', 'dev'], { cwd: tenantCwd, env: {} });
        expect(svc.prepared).to.deep.equal([tenantCwd]);
    });

    it('THROWS (fail-closed) when a drop is required but setpriv is unavailable — never an incomplete drop', () => {
        const svc = new TestTenantSpawnService();
        svc.identity = { uid: 20005, gid: 20005 };
        svc.setpriv = false;
        expect(() => svc.spawnArgvPrepared('npm', ['run', 'dev'], { cwd: tenantCwd, env: {} })).to.throw(/setpriv/);
        expect(svc.launches).to.have.length(0);
    });

    it('spawns the command directly (no wrapper, no drop) when no uid applies (local dev)', () => {
        const svc = new TestTenantSpawnService();
        svc.identity = {};
        svc.spawnArgvPrepared('npm', ['run', 'dev'], { cwd: tenantCwd, env: {} });
        expect(svc.launches[0].file).to.equal('npm');
        expect(svc.launches[0].args).to.deep.equal(['run', 'dev']);
        expect(svc.launches[0].options.uid).to.equal(undefined);
    });

    it('defaults the regid to the uid when no gid resolved', () => {
        const svc = new TestTenantSpawnService();
        svc.identity = { uid: 20005 };
        svc.spawnArgvPrepared('pnpm', ['start'], { cwd: tenantCwd, env: {} });
        expect(svc.launches[0].args.slice(0, 4)).to.deep.equal(['--reuid', '20005', '--regid', '20005']);
    });
});

describe('QaapTenantSpawnService.wrapShellForTenant (interactive terminal)', () => {

    it('wraps the login shell in setpriv --clear-groups when a uid drop applies', () => {
        const svc = new TestTenantSpawnService();
        svc.identity = { uid: 20005, gid: 20005 };
        const wrapped = svc.wrapShellForTenant(tenantCwd, '/bin/bash', ['-l']);
        expect(wrapped.file).to.equal('/usr/bin/setpriv');
        expect(wrapped.args).to.deep.equal(
            ['--reuid', '20005', '--regid', '20005', '--clear-groups', '--', '/bin/bash', '-l']);
    });

    it('provisions the tenant tree before returning the wrapped shell', () => {
        const svc = new TestTenantSpawnService();
        svc.identity = { uid: 20005, gid: 20005 };
        svc.wrapShellForTenant(tenantCwd, '/bin/bash', []);
        expect(svc.prepared).to.deep.equal([tenantCwd]);
    });

    it('returns the shell unchanged when no uid drop applies (local dev)', () => {
        const svc = new TestTenantSpawnService();
        svc.identity = {};
        const wrapped = svc.wrapShellForTenant(tenantCwd, '/bin/zsh', ['-l']);
        expect(wrapped).to.deep.equal({ file: '/bin/zsh', args: ['-l'] });
    });

    it('THROWS rather than leak a root shell when a drop is required but setpriv is missing', () => {
        const svc = new TestTenantSpawnService();
        svc.identity = { uid: 20005, gid: 20005 };
        svc.setpriv = false;
        expect(() => svc.wrapShellForTenant(tenantCwd, '/bin/bash', ['-l'])).to.throw(/setpriv/);
    });
});

describe('QaapTenantSpawnService.assertTenantCwdInProduction (B: fail-closed on non-tenant cwd)', () => {

    class ProdRootService extends QaapTenantSpawnService {
        protected override isBackendRoot(): boolean { return true; }
        check(cwd: string): void {
            (this as unknown as { assertTenantCwdInProduction(cwd: string): void }).assertTenantCwdInProduction(cwd);
        }
    }

    const originalNodeEnv = process.env.NODE_ENV;
    const originalFlag = process.env.QAAP_AGENT_UID_PER_USER;
    afterEach(() => {
        process.env.NODE_ENV = originalNodeEnv;
        if (originalFlag === undefined) { delete process.env.QAAP_AGENT_UID_PER_USER; } else { process.env.QAAP_AGENT_UID_PER_USER = originalFlag; }
    });

    it('REFUSES a non-tenant cwd in production with uid-per-user on (would fall to shared uid 1001)', () => {
        process.env.NODE_ENV = 'production';
        process.env.QAAP_AGENT_UID_PER_USER = '1';
        const svc = new ProdRootService();
        expect(() => svc.check('/workspace/legacy/clone/outside/tenant-tree')).to.throw(/tenant tree/);
    });

    it('allows a real tenant cwd', () => {
        process.env.NODE_ENV = 'production';
        process.env.QAAP_AGENT_UID_PER_USER = '1';
        // resolveQaapReposRoot() returns /workspace/repos under NODE_ENV=production, so the cwd must
        // live under it for resolveTenantIsolationRoot to find the segment.
        const svc = new ProdRootService();
        expect(() => svc.check('/workspace/repos/users/alice/octocat/hello')).to.not.throw();
    });

    it('allows a Windows-mangled tenant cwd (FileUri.fsPath from a Windows browser)', () => {
        process.env.NODE_ENV = 'production';
        process.env.QAAP_AGENT_UID_PER_USER = '1';
        const svc = new ProdRootService();
        expect(() => svc.check('/\\workspace\\repos\\users\\alice\\octocat\\hello')).to.not.throw();
    });

    it('is a no-op outside production (local dev unaffected)', () => {
        process.env.NODE_ENV = 'development';
        process.env.QAAP_AGENT_UID_PER_USER = '1';
        const svc = new ProdRootService();
        expect(() => svc.check('/tmp/anything')).to.not.throw();
    });

    it('is a no-op when uid-per-user is off (shared-uid single-user box)', () => {
        process.env.NODE_ENV = 'production';
        delete process.env.QAAP_AGENT_UID_PER_USER;
        const svc = new ProdRootService();
        expect(() => svc.check('/tmp/anything')).to.not.throw();
    });
});

describe('QaapTenantSpawnService.wrapGitForTenant (mutating git over a tenant repo)', () => {

    it('wraps git in setpriv + disables hooks when a uid drop applies', () => {
        const svc = new TestTenantSpawnService();
        svc.identity = { uid: 20005, gid: 20005 };
        const wrapped = svc.wrapGitForTenant('/workspace/repos/users/alice/o/r', ['worktree', 'add', '-b', 'b', '/wt', 'HEAD']);
        expect(wrapped.file).to.equal('/usr/bin/setpriv');
        expect(wrapped.args).to.deep.equal([
            '--reuid', '20005', '--regid', '20005', '--clear-groups', '--',
            'git', '-c', 'core.hooksPath=/dev/null', '-C', path.resolve('/workspace/repos/users/alice/o/r'),
            'worktree', 'add', '-b', 'b', '/wt', 'HEAD',
        ]);
    });

    it('returns plain git (still hooks-disabled) when no uid drop applies (local dev)', () => {
        const svc = new TestTenantSpawnService();
        svc.identity = {};
        const wrapped = svc.wrapGitForTenant('/repo', ['merge', '--no-ff', 'x']);
        expect(wrapped.file).to.equal('git');
        expect(wrapped.args).to.deep.equal(['-c', 'core.hooksPath=/dev/null', '-C', path.resolve('/repo'), 'merge', '--no-ff', 'x']);
    });
});

describe('QaapTenantSpawnService.resolveProcessEnv', () => {

    const original = process.env.QAAP_AGENT_UID_PER_USER;
    const originalContainerHome = process.env.QAAP_TENANT_CONTAINER_HOME;
    const originalTenantBackendMode = process.env.QAAP_TENANT_BACKEND_MODE;
    afterEach(() => {
        if (original === undefined) {
            delete process.env.QAAP_AGENT_UID_PER_USER;
        } else {
            process.env.QAAP_AGENT_UID_PER_USER = original;
        }
        if (originalContainerHome === undefined) {
            delete process.env.QAAP_TENANT_CONTAINER_HOME;
        } else {
            process.env.QAAP_TENANT_CONTAINER_HOME = originalContainerHome;
        }
        if (originalTenantBackendMode === undefined) {
            delete process.env.QAAP_TENANT_BACKEND_MODE;
        } else {
            process.env.QAAP_TENANT_BACKEND_MODE = originalTenantBackendMode;
        }
    });

    it('points HOME/USER at the tenant home when a uid drop applies', () => {
        process.env.QAAP_AGENT_UID_PER_USER = '1';
        const svc = new TestTenantSpawnService();
        svc.identity = { uid: 20005, gid: 20005 };
        const env = svc.resolveProcessEnv(tenantCwd, { PATH: '/usr/bin' });
        expect(env.HOME).to.equal(resolveTenantHome('alice'));
        expect(env.USER).to.equal('qaap-t-alice');
        expect(env.LOGNAME).to.equal('qaap-t-alice');
        expect(env.PATH).to.equal('/usr/bin'); // base preserved
    });

    it('is a no-op when no uid drop applies (env unchanged)', () => {
        const svc = new TestTenantSpawnService();
        svc.identity = {};
        const env = svc.resolveProcessEnv(tenantCwd, { PATH: '/usr/bin', HOME: '/root' });
        expect(env.HOME).to.equal('/root');
        expect(env.USER).to.equal(undefined);
    });

    it('keeps Docker worker commands on the worker-local HOME instead of the host tenant HOME', () => {
        process.env.QAAP_TENANT_CONTAINER_HOME = '/tmp/alice-home';
        const svc = new TestTenantSpawnService();
        svc.container = true;
        svc.identity = { uid: 20005, gid: 20005 };
        const env = svc.resolveProcessEnv(tenantCwd, { PATH: '/usr/bin', HOME: '/root' });
        expect(env.HOME).to.equal('/tmp/alice-home');
        expect(env.USER).to.equal('qaap-tenant');
        expect(env.LOGNAME).to.equal('qaap-tenant');
    });

    it('keeps a backend running inside a tenant worker on the worker-local HOME', () => {
        process.env.QAAP_TENANT_BACKEND_MODE = '1';
        const svc = new TestTenantSpawnService();
        const env = svc.resolveProcessEnv(tenantCwd, { PATH: '/usr/bin', HOME: '/home/theia' });
        expect(env.HOME).to.equal('/tmp/qaap-home');
        expect(env.USER).to.equal('theia');
        expect(env.LOGNAME).to.equal('theia');
    });

    it('uses the non-root agent identity after a rootless tenant backend drops uid', () => {
        process.env.QAAP_TENANT_BACKEND_MODE = '1';
        const svc = new TestTenantSpawnService();
        svc.backendRoot = true;
        const env = svc.resolveProcessEnv(tenantCwd, { PATH: '/usr/bin', HOME: '/home/theia' });
        expect(env.HOME).to.equal('/tmp/qaap-home');
        expect(env.USER).to.equal('qaap-agent');
        expect(env.LOGNAME).to.equal('qaap-agent');
    });

    it('moves package caches and agent data of a tenant backend to its disk-backed config mount', () => {
        process.env.QAAP_TENANT_BACKEND_MODE = '1';
        process.env.QAAP_TENANT_CONFIG_ROOT = '/home/theia/.qaap';
        delete process.env.QAAP_TENANT_AGENT_STORAGE_ROOT;
        const svc = new TestTenantSpawnService();
        const env = svc.resolveProcessEnv(tenantCwd, { PATH: '/usr/bin' });
        const root = '/home/theia/.qaap/.qaap-agent-storage';
        // Agent config stays on the tenant's writable tmpfs; caches and data use its disk mount.
        expect(env.HOME).to.equal('/tmp/qaap-home');
        expect(env.XDG_CACHE_HOME).to.equal(`${root}/cache`);
        expect(env.XDG_DATA_HOME).to.equal(`${root}/data`);
        expect(env.npm_config_cache).to.equal(`${root}/cache/npm`);
        expect(env.npm_config_store_dir).to.equal(`${root}/cache/pnpm-store`);
        expect(env.PNPM_STORE_DIR).to.equal(`${root}/cache/pnpm-store`);
        expect(env.BUN_INSTALL_CACHE_DIR).to.equal(`${root}/cache/bun`);
        expect(env.YARN_GLOBAL_FOLDER).to.equal(`${root}/data/yarn-berry`);
        expect(env).not.to.have.property('YARN_CACHE_FOLDER');
        expect(svc.storagePrepared).to.deep.equal([root]);
    });

    it('links the CLI sign-in state of the tmpfs HOME to the disk-backed storage once', () => {
        process.env.QAAP_TENANT_BACKEND_MODE = '1';
        process.env.QAAP_TENANT_CONFIG_ROOT = '/home/theia/.qaap';
        delete process.env.QAAP_TENANT_AGENT_STORAGE_ROOT;
        const originalAgentUid = process.env.QAAP_AGENT_UID;
        process.env.QAAP_AGENT_UID = '1001';
        try {
            const svc = new TestTenantSpawnService();
            svc.backendRoot = true;
            svc.resolveProcessEnv(tenantCwd, {});
            svc.resolveProcessEnv(tenantCwd, {});
            expect(svc.linkedHomes).to.deep.equal([{
                home: '/tmp/qaap-home',
                persistentHome: '/home/theia/.qaap/.qaap-agent-storage/home',
                owner: { uid: 1001, gid: 1001 },
            }]);

            process.env.QAAP_TENANT_AGENT_STORAGE_ROOT = 'off';
            const disabled = new TestTenantSpawnService();
            disabled.resolveProcessEnv(tenantCwd, {});
            expect(disabled.linkedHomes).to.deep.equal([]);
        } finally {
            if (originalAgentUid === undefined) {
                delete process.env.QAAP_AGENT_UID;
            } else {
                process.env.QAAP_AGENT_UID = originalAgentUid;
            }
        }
    });

    it('honours an explicit agent storage root and an explicit opt-out', () => {
        process.env.QAAP_TENANT_BACKEND_MODE = '1';
        process.env.QAAP_TENANT_AGENT_STORAGE_ROOT = '/srv/cache/';
        const svc = new TestTenantSpawnService();
        expect(svc.resolveProcessEnv(tenantCwd, {}).XDG_CACHE_HOME).to.equal('/srv/cache/cache');

        process.env.QAAP_TENANT_AGENT_STORAGE_ROOT = 'off';
        const disabled = svc.resolveProcessEnv(tenantCwd, {});
        expect(disabled.HOME).to.equal('/tmp/qaap-home');
        expect(disabled).not.to.have.property('XDG_CACHE_HOME');
        expect(disabled).not.to.have.property('npm_config_cache');

        // Relative paths would resolve against each child's cwd (the user's repo): ignore them.
        process.env.QAAP_TENANT_AGENT_STORAGE_ROOT = 'relative/cache';
        expect(svc.resolveProcessEnv(tenantCwd, {})).not.to.have.property('XDG_DATA_HOME');
    });

    it('does not relocate caches of host-routed worker commands without an in-container root', () => {
        delete process.env.QAAP_TENANT_AGENT_STORAGE_ROOT;
        const svc = new TestTenantSpawnService();
        svc.container = true;
        const env = svc.resolveProcessEnv(tenantCwd, {});
        expect(env.HOME).to.equal('/tmp/qaap-home');
        expect(env).not.to.have.property('XDG_CACHE_HOME');

        process.env.QAAP_TENANT_AGENT_STORAGE_ROOT = '/workspace/.qaap-agent-storage';
        const configured = svc.resolveProcessEnv(tenantCwd, {});
        expect(configured.npm_config_cache).to.equal('/workspace/.qaap-agent-storage/cache/npm');
        // The control plane cannot create in-container paths; the worker's tools create them.
        expect(svc.storagePrepared).to.deep.equal([]);
    });

    it('never adds cache relocation to host uid-drop processes (their HOME is already on disk)', () => {
        process.env.QAAP_AGENT_UID_PER_USER = '1';
        process.env.QAAP_TENANT_AGENT_STORAGE_ROOT = '/srv/cache';
        const svc = new TestTenantSpawnService();
        svc.identity = { uid: 20005, gid: 20005 };
        const env = svc.resolveProcessEnv(tenantCwd, { PATH: '/usr/bin' });
        expect(env.HOME).to.equal(resolveTenantHome('alice'));
        expect(env).not.to.have.property('XDG_CACHE_HOME');
    });
});

class LaunchFileProbeService extends QaapTenantSpawnService {
    backendRoot = true;

    protected override isBackendRoot(): boolean {
        return this.backendRoot;
    }

    launchFile(file: string, env: NodeJS.ProcessEnv, shell?: boolean): string {
        return this.resolveLaunchFile(file, { env, shell });
    }
}

describe('QaapTenantSpawnService root launch resolution', () => {
    /** Needs a directory root does not own, so it cannot run as root. */
    const posixNonRootIt = process.platform === 'win32' || process.getuid?.() === 0 ? it.skip : it;
    let sandbox: string;

    beforeEach(() => {
        sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-launch-file-'));
    });

    afterEach(() => {
        fs.rmSync(sandbox, { recursive: true, force: true });
    });

    posixNonRootIt('refuses to run as root a bare command found only in a tenant-writable PATH entry', () => {
        const tenantBin = path.join(sandbox, '.qaap', 'cli', 'bin');
        fs.mkdirSync(tenantBin, { recursive: true });
        const planted = path.join(tenantBin, 'qaap-planted-helper');
        fs.writeFileSync(planted, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
        const env = { PATH: [tenantBin, '/usr/bin', '/bin'].join(path.delimiter) };
        const svc = new LaunchFileProbeService();

        expect(() => svc.launchFile('qaap-planted-helper', env)).to.throw(/root does not own/);
        // A shadowed system tool resolves to the root-owned copy, not the planted one.
        fs.copyFileSync(planted, path.join(tenantBin, 'sh'));
        fs.chmodSync(path.join(tenantBin, 'sh'), 0o755);
        expect(svc.launchFile('sh', env)).to.match(/^\/(usr\/)?bin\/sh$/);
        // Unknown names keep spawn's own ENOENT; explicit paths, shells and non-root backends are untouched.
        expect(svc.launchFile('qaap-missing-helper', env)).to.equal('qaap-missing-helper');
        expect(svc.launchFile('/bin/sh', env)).to.equal('/bin/sh');
        expect(svc.launchFile('qaap-planted-helper -x', env, true)).to.equal('qaap-planted-helper -x');
        svc.backendRoot = false;
        expect(svc.launchFile('qaap-planted-helper', env)).to.equal('qaap-planted-helper');
    });
});
