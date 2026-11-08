// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    isQaapRunscConfigured,
    qaapRunscDaemonProblem,
    qaapTenantCgroupParent,
    resolveQaapTenantRuntime,
    validateQaapTenantRuntimeEnv,
    type QaapDockerRuntimeInfo,
} from './qaap-tenant-runtime';

describe('qaap-tenant-runtime', () => {

    describe('resolveQaapTenantRuntime', () => {
        it('defaults to runc', () => {
            expect(resolveQaapTenantRuntime('alice', {})).to.equal('runc');
            expect(resolveQaapTenantRuntime('alice', { QAAP_TENANT_RUNTIME: ' ' })).to.equal('runc');
        });

        it('applies the global runtime to every tenant', () => {
            expect(resolveQaapTenantRuntime('alice', { QAAP_TENANT_RUNTIME: 'runsc' })).to.equal('runsc');
            expect(resolveQaapTenantRuntime(undefined, { QAAP_TENANT_RUNTIME: 'runsc' })).to.equal('runsc');
        });

        it('moves only the listed logins, ignoring case and spaces', () => {
            const env = { QAAP_TENANT_RUNSC_LOGINS: ' Alice , bob,' };
            expect(resolveQaapTenantRuntime('alice', env)).to.equal('runsc');
            expect(resolveQaapTenantRuntime('BOB', env)).to.equal('runsc');
            expect(resolveQaapTenantRuntime('carol', env)).to.equal('runc');
        });

        it('never matches an anonymous tenant through an empty list entry', () => {
            expect(resolveQaapTenantRuntime(undefined, { QAAP_TENANT_RUNSC_LOGINS: ',' })).to.equal('runc');
            expect(resolveQaapTenantRuntime('', { QAAP_TENANT_RUNSC_LOGINS: 'alice' })).to.equal('runc');
        });

        it('refuses an unknown runtime instead of falling back to runc', () => {
            expect(() => resolveQaapTenantRuntime('alice', { QAAP_TENANT_RUNTIME: 'gvisor' })).to.throw('Unsupported QAAP_TENANT_RUNTIME');
        });
    });

    describe('qaapTenantCgroupParent', () => {
        it('gives each tenant one stable slice, ignoring case', () => {
            expect(qaapTenantCgroupParent('Alice')).to.equal(qaapTenantCgroupParent(' alice '));
            expect(qaapTenantCgroupParent('alice')).not.to.equal(qaapTenantCgroupParent('bob'));
        });

        it('nests directly under qaap.slice whatever the login contains', () => {
            for (const login of ['alice', 'my-org-user', '../../evil', undefined]) {
                expect(qaapTenantCgroupParent(login)).to.match(/^qaap-[0-9a-f]{16}\.slice$/);
            }
        });
    });

    describe('validateQaapTenantRuntimeEnv', () => {
        const proxy = { QAAP_TENANT_EGRESS_PROXY_IMAGE: 'qaap-tenant-egress:current' };

        it('accepts runc without an egress proxy', () => {
            expect(() => validateQaapTenantRuntimeEnv({})).not.to.throw();
            expect(isQaapRunscConfigured({})).to.equal(false);
        });

        it('requires the egress proxy for global and canary gVisor', () => {
            expect(() => validateQaapTenantRuntimeEnv({ QAAP_TENANT_RUNTIME: 'runsc' })).to.throw('QAAP_TENANT_EGRESS_PROXY_IMAGE');
            expect(() => validateQaapTenantRuntimeEnv({ QAAP_TENANT_RUNSC_LOGINS: 'alice' })).to.throw('QAAP_TENANT_EGRESS_PROXY_IMAGE');
            expect(() => validateQaapTenantRuntimeEnv({ QAAP_TENANT_RUNSC_LOGINS: 'alice', ...proxy })).not.to.throw();
        });

        it('refuses an unknown runtime at startup', () => {
            expect(() => validateQaapTenantRuntimeEnv({ QAAP_TENANT_RUNTIME: 'kata', ...proxy })).to.throw('Unsupported QAAP_TENANT_RUNTIME');
        });
    });

    describe('qaapRunscDaemonProblem', () => {
        const good = ['--platform=systrap', '--directfs=false', '--systemd-cgroup'];
        const installed = '/usr/local/lib/qaap-gvisor/qaap-20261102.0-1/runsc';
        const info = (runtimeArgs: readonly string[], rootless: boolean = true, path: string = installed): QaapDockerRuntimeInfo => ({
            SecurityOptions: rootless ? ['name=seccomp,profile=builtin', 'name=rootless'] : ['name=seccomp,profile=builtin'],
            Runtimes: { runc: { path: 'runc' }, runsc: { path, runtimeArgs } },
        });

        it('accepts a rootless daemon with the exact flags and the installed binary', () => {
            expect(qaapRunscDaemonProblem(info(good), true)).to.equal(undefined);
        });

        it('requires rootless and the installed binary only in hosted deployments', () => {
            expect(qaapRunscDaemonProblem(info(good, false), true)).to.contain('not rootless');
            expect(qaapRunscDaemonProblem(info(good, false, '/tmp/runsc'), false)).to.equal(undefined);
        });

        for (const path of ['/tmp/runsc', '/home/ubuntu/bin/runsc', '/usr/local/lib/qaap-gvisor/../../../tmp/runsc', '/usr/local/lib/qaap-gvisor/runsc', '/usr/local/lib/qaap-gvisor/a/b/runsc']) {
            it(`refuses the binary ${path}`, () => {
                expect(qaapRunscDaemonProblem(info(good, true, path), true)).to.contain('is not the installed one');
            });
        }

        it('refuses a daemon without the runtime', () => {
            expect(qaapRunscDaemonProblem({ SecurityOptions: ['name=rootless'], Runtimes: { runc: {} } }, true)).to.contain('no runsc runtime');
            expect(qaapRunscDaemonProblem({ SecurityOptions: ['name=rootless'] }, true)).to.contain('no runsc runtime');
        });

        const unexpected: ReadonlyArray<readonly string[]> = [
            [],
            ['--platform=systrap', '--systemd-cgroup'],
            ['--systemd-cgroup', '--directfs=false', '--platform=systrap'],
            ['--platform=kvm', '--directfs=false', '--systemd-cgroup'],
            ['--platform=systrap', '--directfs=true', '--systemd-cgroup'],
            [...good, '--ignore-cgroups'],
            [...good, '-ignore-cgroups'],
            [...good, '--network', 'host'],
            [...good, '--network=host'],
            [...good, '--platform=ptrace'],
            [...good, '--systemd-cgroup=false'],
            [...good, '--allow-flag-override'],
            [...good, '--allow-suid'],
            [...good, '--debug'],
        ];
        for (const args of unexpected) {
            it(`refuses the flags [${args.join(' ')}]`, () => {
                expect(qaapRunscDaemonProblem(info(args), true)).to.contain('expected [');
            });
        }
    });
});
