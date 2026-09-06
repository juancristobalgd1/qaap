// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { ChildProcess } from 'child_process';
import * as path from 'path';
import { resolveQaapReposRoot, resolveTenantHome } from '@theia/qaap-adapters/lib/common/qaap-user-isolation';
import { QaapTenantSpawnService } from './qaap-tenant-spawn-service';

interface LaunchCall { file: string; args: string[]; options: { uid?: number; gid?: number; env?: NodeJS.ProcessEnv } }

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

    override resolveSpawnIdentity(): { uid?: number; gid?: number } {
        return this.identity;
    }
    protected override isSetprivAvailable(): boolean {
        return this.setpriv;
    }
    protected override resolveSetprivExecutable(): string | undefined {
        return this.setpriv ? this.setprivPath : undefined;
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

describe('QaapTenantSpawnService.spawnArgvPrepared', () => {

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
    afterEach(() => {
        if (original === undefined) {
            delete process.env.QAAP_AGENT_UID_PER_USER;
        } else {
            process.env.QAAP_AGENT_UID_PER_USER = original;
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
});
