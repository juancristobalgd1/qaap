// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

// All fixtures are synthetic and written to a temporary directory.

import { expect } from 'chai';
import { type ChildProcess, spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { QaapUsageAgentFileAccess, type QaapUsageFileAccess } from './qaap-usage-file-access';
import { QaapUsageRoots } from './qaap-usage-roots';
import { QaapUsageScanner } from './qaap-usage-scanner';
import { QaapUsageScannerRegistry } from './qaap-usage-scanner-registry';
import { QaapUsageScanTarget, QaapUsageScanTargetResolver } from './qaap-usage-scan-target';

/** The tenant agent HOME overlay `QaapTenantSpawnService.tenantHomeEnvOverlay` returns inside a tenant backend. */
const TENANT_OVERLAY = {
    HOME: '/tmp/qaap-home',
    USER: 'qaap-agent',
    LOGNAME: 'qaap-agent',
    XDG_CACHE_HOME: '/home/theia/.qaap/.qaap-agent-storage/cache',
    XDG_DATA_HOME: '/home/theia/.qaap/.qaap-agent-storage/data',
};

/** Runs the helper as this user: the spec cannot switch uid, the protocol is what is under test. */
class SameUserAgentFileAccess extends QaapUsageAgentFileAccess {
    spawned = 0;
    protected override spawnHelper(): ChildProcess {
        this.spawned++;
        return spawn(process.execPath, ['-e', QaapUsageAgentFileAccess.HELPER_SCRIPT], { cwd: '/', stdio: ['pipe', 'pipe', 'ignore'] });
    }
}

describe('QaapUsageScanTarget', () => {

    describe('roots for the agent spawn env', () => {

        it('uses the tenant agent HOME and its persistent XDG data dir instead of the backend home', () => {
            const roots = QaapUsageRoots.resolveForSpawnEnv({ HOME: '/home/theia' }, TENANT_OVERLAY, '/home/theia');
            expect(roots.claudeProjects).to.equal(path.join('/tmp/qaap-home', '.claude', 'projects'));
            expect(roots.codexSessions).to.equal(path.join('/tmp/qaap-home', '.codex', 'sessions'));
            expect(roots.piSessions).to.equal(path.join('/tmp/qaap-home', '.pi', 'agent', 'sessions'));
            expect(roots.opencodeParts).to.equal(path.join('/home/theia/.qaap/.qaap-agent-storage/data', 'opencode', 'storage', 'part'));
            expect(roots.grokSessions).to.equal(path.join('/tmp/qaap-home', '.grok', 'sessions'));
            expect(roots.copilotDatabase).to.equal(path.join('/tmp/qaap-home', '.copilot', 'session-store.db'));
        });

        it('keeps the backend home when the agents get no overlay (desktop, no uid drop)', () => {
            expect(QaapUsageRoots.resolveForSpawnEnv({}, {}, '/Users/dev')).to.deep.equal(QaapUsageRoots.resolve({}, '/Users/dev'));
        });

        it('still honours explicit CLI overrides the agents inherit', () => {
            const roots = QaapUsageRoots.resolveForSpawnEnv({ CODEX_HOME: '/custom/codex' }, TENANT_OVERLAY, '/home/theia');
            expect(roots.codexSessions).to.equal(path.join('/custom/codex', 'sessions'));
        });
    });

    describe('agent identity', () => {

        it('reads as the agent uid only when it differs from this process', () => {
            const base = { env: {}, backendHome: '/home/theia', homeOverlay: TENANT_OVERLAY };
            expect(QaapUsageScanTarget.fromSpawnEnv({ ...base, spawnIdentity: { uid: 1001 }, currentUid: 0 }).identity).to.deep.equal({ uid: 1001, gid: 1001 });
            expect(QaapUsageScanTarget.fromSpawnEnv({ ...base, spawnIdentity: { uid: 1001, gid: 2000 }, currentUid: 0 }).identity).to.deep.equal({ uid: 1001, gid: 2000 });
            expect(QaapUsageScanTarget.fromSpawnEnv({ ...base, spawnIdentity: { uid: 1001 }, currentUid: 1001 }).identity).to.equal(undefined);
            expect(QaapUsageScanTarget.fromSpawnEnv({ ...base, spawnIdentity: {}, currentUid: 0 }).identity).to.equal(undefined);
            expect(QaapUsageScanTarget.fromSpawnEnv({ ...base, spawnIdentity: { uid: 0 }, currentUid: 1000 }).identity).to.equal(undefined);
        });

        it('gives different homes or identities different keys', () => {
            const a = QaapUsageScanTarget.fromSpawnEnv({ env: {}, backendHome: '/h', homeOverlay: { HOME: '/homes/a' }, spawnIdentity: { uid: 2001 }, currentUid: 0 });
            const b = QaapUsageScanTarget.fromSpawnEnv({ env: {}, backendHome: '/h', homeOverlay: { HOME: '/homes/b' }, spawnIdentity: { uid: 2002 }, currentUid: 0 });
            const a2 = QaapUsageScanTarget.fromSpawnEnv({ env: {}, backendHome: '/h', homeOverlay: { HOME: '/homes/a' }, spawnIdentity: { uid: 2001 }, currentUid: 0 });
            expect(a.key).to.not.equal(b.key);
            expect(a.key).to.equal(a2.key);
        });
    });

    describe('QaapUsageScanTargetResolver', () => {

        interface StubSpawn {
            cwds: string[];
            overlay: Record<string, string>;
            identity: { uid?: number; gid?: number };
            containerIsolation: boolean;
            fail: boolean;
        }

        function resolverWith(env: NodeJS.ProcessEnv, spawnStub: StubSpawn | undefined, currentUid = 0): QaapUsageScanTargetResolver {
            const resolver = new QaapUsageScanTargetResolver();
            Object.assign(resolver, {
                env: () => env,
                backendHome: () => '/home/theia',
                currentUid: () => currentUid,
                ownerCwd: (login: string | undefined) => `/repos/users/${login ?? ''}`,
                tenantSpawn: spawnStub && {
                    isContainerIsolationEnabled: () => spawnStub.containerIsolation,
                    tenantHomeEnvOverlay: (cwd: string) => {
                        spawnStub.cwds.push(cwd);
                        if (spawnStub.fail) {
                            throw new Error('no agent uid');
                        }
                        return spawnStub.overlay;
                    },
                    resolveSpawnIdentity: () => spawnStub.identity,
                },
            });
            return resolver;
        }

        function stub(overrides: Partial<StubSpawn> = {}): StubSpawn {
            return { cwds: [], overlay: TENANT_OVERLAY, identity: { uid: 1001 }, containerIsolation: false, fail: false, ...overrides };
        }

        it('keeps the desktop user home and reads it directly', () => {
            const spawnStub = stub();
            const target = resolverWith({ QAAP_DESKTOP: '1' }, spawnStub).resolve('dev');
            expect(target.roots).to.deep.equal(QaapUsageRoots.resolve({ QAAP_DESKTOP: '1' }, '/home/theia'));
            expect(target.identity).to.equal(undefined);
            expect(spawnStub.cwds).to.deep.equal([]);
        });

        it('reads the tenant agent home as the agent uid on a per-tenant backend', () => {
            const spawnStub = stub();
            const target = resolverWith({ QAAP_TENANT_BACKEND_MODE: '1' }, spawnStub).resolve('alice');
            expect(spawnStub.cwds).to.deep.equal(['/repos/users/alice']);
            expect(target.roots.claudeProjects).to.equal(path.join('/tmp/qaap-home', '.claude', 'projects'));
            expect(target.roots.opencodeParts).to.equal(path.join(TENANT_OVERLAY.XDG_DATA_HOME, 'opencode', 'storage', 'part'));
            expect(target.identity).to.deep.equal({ uid: 1001, gid: 1001 });
        });

        it('resolves each owner to their own home in uid-per-user mode', () => {
            const spawnStub = stub();
            const resolver = resolverWith({}, spawnStub);
            Object.assign(spawnStub, { overlay: { HOME: '/var/lib/qaap/homes/alice' }, identity: { uid: 20001, gid: 20001 } });
            const alice = resolver.resolve('alice');
            Object.assign(spawnStub, { overlay: { HOME: '/var/lib/qaap/homes/bob' }, identity: { uid: 20002, gid: 20002 } });
            const bob = resolver.resolve('bob');
            expect(alice.roots.claudeProjects).to.equal(path.join('/var/lib/qaap/homes/alice', '.claude', 'projects'));
            expect(bob.roots.claudeProjects).to.equal(path.join('/var/lib/qaap/homes/bob', '.claude', 'projects'));
            expect(alice.key).to.not.equal(bob.key);
        });

        it('keeps the backend home for container-routed workers and when the spawn env cannot be resolved', () => {
            const own = QaapUsageRoots.resolve({}, '/home/theia');
            expect(resolverWith({}, stub({ containerIsolation: true })).resolve('alice').roots).to.deep.equal(own);
            expect(resolverWith({}, stub({ fail: true })).resolve('alice').roots).to.deep.equal(own);
            expect(resolverWith({}, undefined).resolve('alice').roots).to.deep.equal(own);
        });
    });

    describe('QaapUsageScannerRegistry', () => {

        it('shares a scanner between owners of one home and separates different homes', () => {
            const registry = new QaapUsageScannerRegistry();
            const homes: Record<string, string> = { alice: '/homes/a', bob: '/homes/b', carol: '/homes/a' };
            Object.assign(registry, {
                targets: {
                    resolve: (login: string) => QaapUsageScanTarget.fromSpawnEnv({
                        env: {}, backendHome: '/h', homeOverlay: { HOME: homes[login] }, spawnIdentity: {}, currentUid: 0,
                    }),
                },
            });
            const alice = registry.forOwner('alice');
            expect(registry.forOwner('carol').scanner).to.equal(alice.scanner);
            expect(registry.forOwner('bob').scanner).to.not.equal(alice.scanner);
            expect(alice.scanner.getRoots().claudeProjects).to.equal(path.join('/homes/a', '.claude', 'projects'));
        });
    });

    describe('reading as the agent user', () => {

        let root: string;

        beforeEach(() => {
            root = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-usage-agent-'));
        });

        afterEach(() => {
            fs.rmSync(root, { recursive: true, force: true });
        });

        it('lists, stats and reads files through one helper process', async () => {
            const file = path.join(root, 'a', 'b', 'session.jsonl');
            fs.mkdirSync(path.dirname(file), { recursive: true });
            fs.writeFileSync(file, 'line one\nline two\n');
            fs.writeFileSync(path.join(root, 'a', 'ignored.txt'), 'x');
            const access = new SameUserAgentFileAccess({ uid: 1001, gid: 1001 });
            try {
                const listed = await access.listFiles(root, /\.jsonl$/);
                expect(listed.map(entry => entry.file)).to.deep.equal([file]);
                expect(listed[0].size).to.equal(18);
                expect((await access.stat(file))?.size).to.equal(18);
                expect(await access.stat(path.join(root, 'missing'))).to.equal(undefined);
                expect((await access.readRange(file, 5, 8)).toString()).to.equal('one');
                expect((await access.readRange(file, 9, 1000)).toString()).to.equal('line two\n');
                expect((await access.readFile(file)).toString()).to.equal('line one\nline two\n');
                expect(await access.listFiles(path.join(root, 'missing'), /./)).to.deep.equal([]);
                expect(access.spawned).to.equal(1);
            } finally {
                access.release();
            }
        });

        it('lets the scanner read Claude logs through the agent helper', async () => {
            const roots = QaapUsageRoots.resolve({}, root);
            const file = path.join(roots.claudeProjects, 'project', 'session.jsonl');
            fs.mkdirSync(path.dirname(file), { recursive: true });
            fs.writeFileSync(file, JSON.stringify({
                type: 'assistant',
                sessionId: 'claude-session',
                requestId: 'req-1',
                timestamp: new Date().toISOString(),
                message: { id: 'm1', model: 'claude-haiku-4-5', usage: { input_tokens: 7, output_tokens: 1 } },
            }) + '\n');
            const accesses: SameUserAgentFileAccess[] = [];
            class AgentScanner extends QaapUsageScanner {
                protected override createFileAccess(): QaapUsageFileAccess {
                    const access = new SameUserAgentFileAccess(this.identity!);
                    accesses.push(access);
                    return access;
                }
            }
            const scanner = new AgentScanner().useTarget({ key: 'k', roots, identity: { uid: 1001, gid: 1001 } });
            await scanner.scan();
            expect([...scanner.getLedger().allEntries()].map(entry => entry.tokens.input)).to.deep.equal([7]);
            expect(accesses).to.have.length(1);
            expect(accesses[0].spawned).to.equal(1);
        });
    });
});
