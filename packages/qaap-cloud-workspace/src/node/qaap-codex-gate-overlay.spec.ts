// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DEFAULT_QAAP_CODEX_GATE_OVERLAY_BUILDER, QaapCodexGateOverlayBuilder, usesCodexToolGateHook } from './qaap-codex-gate-overlay';

describe('QaapCodexGateOverlayBuilder', () => {

    // The builder checks POSIX mode bits and uids (0600/0711, root uid drop); these have no win32 equivalent and the builder fails closed there.
    before(function (): void {
        if (process.platform === 'win32') {
            this.skip();
        }
    });

    let tmp: string;
    let sourceHome: string;
    let root: string;
    const options = (extra: Record<string, unknown> = {}): any => ({
        taskId: 'task-1', cwd: '/work/app', folderTrusted: false, sourceCodexHome: sourceHome, askTtlSec: 600, overlayRoot: root,
        nodeBin: '/usr/bin/node', hookPath: '/opt/qaap/hook.mjs', ...extra,
    });

    beforeEach(() => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-codex-overlay-'));
        sourceHome = path.join(tmp, 'user-codex');
        root = path.join(tmp, 'overlays');
        fs.mkdirSync(sourceHome);
        fs.writeFileSync(path.join(sourceHome, 'auth.json'), '{"tokens":{"refresh_token":"r1"}}');
        fs.writeFileSync(path.join(sourceHome, 'config.toml'), [
            'model = "gpt-5"',
            'approval_policy = "on-request"',
            'sandbox_mode = "danger-full-access"',
            '',
            '[model_providers.acme]',
            'name = "acme"',
            '',
            '[projects."/work/app"]',
            'trust_level = "trusted"',
            '',
            '[hooks.state."/old/hooks.json:pre_tool_use:0:0"]',
            'trusted_hash = "sha256:old"',
            '',
            '[mcp_servers.docs]',
            'command = "docs"',
        ].join('\n'));
    });

    afterEach(() => {
        fs.rmSync(tmp, { recursive: true, force: true });
    });

    const trusted = new QaapCodexGateOverlayBuilder(async () => 'trusted');

    it('writes auth.json (0600), hooks.json with the gate hook and a config with the trusted hash', async () => {
        const overlay = await trusted.create(options());
        // Canonical path: Codex keys hook trust by it (macOS tmp is a symlink).
        expect(path.dirname(path.dirname(overlay.codexHome))).to.equal(fs.realpathSync(root));
        expect(path.basename(path.dirname(overlay.codexHome))).to.match(/^task-1-/);
        expect(fs.readFileSync(path.join(overlay.codexHome, 'auth.json'), 'utf8')).to.equal('{"tokens":{"refresh_token":"r1"}}');
        expect(fs.statSync(path.join(overlay.codexHome, 'auth.json')).mode & 0o777).to.equal(0o600);
        const hooks = JSON.parse(fs.readFileSync(path.join(overlay.codexHome, 'hooks.json'), 'utf8'));
        const handler = hooks.hooks.PreToolUse[0].hooks[0];
        expect(hooks.hooks.PreToolUse[0].matcher).to.equal('*');
        expect(handler.type).to.equal('command');
        expect(handler.command).to.equal("'/usr/bin/node' '/opt/qaap/hook.mjs' --dialect codex || exit 2");
        // The field is `timeout`: Codex silently ignores `timeoutSec`, and a hook timeout fails open.
        expect(handler.timeout).to.equal(660);
        expect(handler).to.not.have.property('timeoutSec');
        const config = fs.readFileSync(path.join(overlay.codexHome, 'config.toml'), 'utf8');
        expect(config).to.contain(`[hooks.state."${path.join(overlay.codexHome, 'hooks.json')}:pre_tool_use:0:0"]`);
        expect(config).to.contain(`trusted_hash = "${QaapCodexGateOverlayBuilder.hookHash(handler.command, 660)}"`);
        overlay.dispose();
    });

    it('computes the hash Codex 0.165 computes (sha256 of the key-sorted identity)', () => {
        // Value read from `hooks/list` of a real codex-cli 0.165 for this exact hook.
        const hash = QaapCodexGateOverlayBuilder.hookHash('/private/tmp/claude-501/spike/hook.sh', 300);
        expect(hash).to.equal('sha256:c6cd05e23b6156f07e0c8d811a1280a8ad5ee97e57a76eac12136f745b9b42b7');
    });

    it('marks an untrusted folder untrusted so codex exec cannot trust it and load project hooks', async () => {
        const overlay = await trusted.create(options({ folderTrusted: false }));
        const config = fs.readFileSync(path.join(overlay.codexHome, 'config.toml'), 'utf8');
        expect(config).to.contain('[projects."/work/app"]\ntrust_level = "untrusted"');
        expect(config).to.not.contain('trust_level = "trusted"');
        overlay.dispose();
    });

    it('writes no [projects] entry for a trusted folder', async () => {
        const overlay = await trusted.create(options({ folderTrusted: true }));
        const config = fs.readFileSync(path.join(overlay.codexHome, 'config.toml'), 'utf8');
        expect(config).to.not.contain('[projects');
        overlay.dispose();
    });

    it('owns approval and sandbox, keeps the owner provider settings and drops old trust and hook state', async () => {
        const overlay = await trusted.create(options());
        const config = fs.readFileSync(path.join(overlay.codexHome, 'config.toml'), 'utf8');
        expect(config).to.match(/^approval_policy = "never"$/m);
        expect(config).to.match(/^sandbox_mode = "workspace-write"$/m);
        expect(config).to.not.contain('on-request');
        expect(config).to.not.contain('danger-full-access');
        expect(config).to.contain('model = "gpt-5"');
        expect(config).to.contain('[model_providers.acme]');
        expect(config).to.contain('[mcp_servers.docs]');
        expect(config).to.not.contain('sha256:old');
        overlay.dispose();
    });

    it('never writes gate credentials into the overlay and never touches the source home', async () => {
        const before = fs.readdirSync(sourceHome).sort();
        const overlay = await trusted.create(options(), { QAAP_GATE_TOKEN: 'secret-token', QAAP_GATE_URL: 'http://x' });
        for (const file of fs.readdirSync(overlay.codexHome)) {
            expect(fs.readFileSync(path.join(overlay.codexHome, file), 'utf8'), file).to.not.contain('secret-token');
        }
        overlay.dispose();
        expect(fs.readdirSync(sourceHome).sort()).to.deep.equal(before);
        expect(fs.readFileSync(path.join(sourceHome, 'config.toml'), 'utf8')).to.contain('trust_level = "trusted"');
    });

    it('deletes the overlay on dispose (twice is fine) and keeps an unchanged login as is', async () => {
        const overlay = await trusted.create(options());
        overlay.dispose();
        overlay.dispose();
        expect(fs.readdirSync(root)).to.deep.equal([]);
        expect(fs.readFileSync(path.join(sourceHome, 'auth.json'), 'utf8')).to.equal('{"tokens":{"refresh_token":"r1"}}');
    });

    it('writes a refreshed login back before deleting (refresh tokens rotate)', async () => {
        const overlay = await trusted.create(options());
        fs.writeFileSync(path.join(overlay.codexHome, 'auth.json'), '{"tokens":{"refresh_token":"r2"}}');
        overlay.dispose();
        expect(fs.readFileSync(path.join(sourceHome, 'auth.json'), 'utf8')).to.equal('{"tokens":{"refresh_token":"r2"}}');
        expect(fs.statSync(path.join(sourceHome, 'auth.json')).mode & 0o777).to.equal(0o600);
    });

    it('does not overwrite a login that changed during the task (compare-and-swap)', async () => {
        const overlay = await trusted.create(options());
        fs.writeFileSync(path.join(overlay.codexHome, 'auth.json'), '{"tokens":{"refresh_token":"r2"}}');
        fs.writeFileSync(path.join(sourceHome, 'auth.json'), '{"tokens":{"refresh_token":"newer-login"}}');
        overlay.dispose();
        expect(fs.readFileSync(path.join(sourceHome, 'auth.json'), 'utf8')).to.equal('{"tokens":{"refresh_token":"newer-login"}}');
    });

    it('writes the [projects] key with the canonical cwd (symlinked tmp, /var -> /private/var)', async () => {
        const real = path.join(tmp, 'real-project');
        const link = path.join(tmp, 'link-project');
        fs.mkdirSync(real);
        fs.symlinkSync(real, link);
        const overlay = await trusted.create(options({ cwd: link, folderTrusted: false }));
        const config = fs.readFileSync(path.join(overlay.codexHome, 'config.toml'), 'utf8');
        expect(config).to.contain(`[projects.${JSON.stringify(fs.realpathSync(real))}]`);
        expect(config).to.not.contain(JSON.stringify(link));
        overlay.dispose();
    });

    describe('with a uid drop (root backend, Codex runs as the agent uid)', () => {
        const agentUid = (process.getuid?.() ?? 0) + 4242;

        class RecordingBuilder extends QaapCodexGateOverlayBuilder {
            readonly handedOver: Array<{ target: string; uid: number; gid: number }> = [];
            readonly ran: Array<{ owner: { uid: number; gid: number }; input: Record<string, any> }> = [];
            childOk = true;
            // Pretend the agent owns the trees (this test cannot chown): root must then go through the child.
            foreignOwner: { uid: number; gid: number } | undefined = { uid: agentUid, gid: 7 };
            probedAs: unknown = 'not-called';
            constructor(status: 'trusted' | 'untrusted' = 'trusted') {
                super(async (_home, _cwd, _env, identity) => {
                    this.probedAs = identity;
                    return status;
                });
            }
            protected override handOver(_fd: number, target: string, owner: { uid: number; gid?: number }): void {
                this.handedOver.push({ target, uid: owner.uid, gid: owner.gid ?? owner.uid });
            }
            protected override runAsOwner(owner: { uid: number; gid: number }, input: object): boolean {
                this.ran.push({ owner, input: input as Record<string, any> });
                return this.childOk;
            }
            protected override treeOwner(stat: fs.Stats): { uid: number; gid: number } {
                return this.foreignOwner ?? super.treeOwner(stat);
            }
            skipReachability = true;
            protected override assertReachable(base: string): void {
                // the test tmp dir is private to the developer
                if (!this.skipReachability) {
                    super.assertReachable(base);
                }
            }
        }

        it('hands over only the task dir, codex-home and the files root created, never the base', async () => {
            const builder = new RecordingBuilder();
            const overlay = await builder.create(options({ agentIdentity: { uid: agentUid, gid: 7 } }));
            const taskDir = path.dirname(overlay.codexHome);
            expect(builder.handedOver.map(entry => entry.target).sort()).to.deep.equal([
                taskDir, overlay.codexHome,
                path.join(overlay.codexHome, 'config.toml'), path.join(overlay.codexHome, 'hooks.json'),
                // no auth.json: the test's source login belongs to this uid, not to the simulated agent uid,
                // so the drop path refuses to copy it (covered by the readRegularFile owner test below)
            ].sort());
            expect(builder.handedOver.every(entry => entry.uid === agentUid && entry.gid === 7)).to.equal(true);
            expect(builder.probedAs).to.deep.equal({ uid: agentUid, gid: 7 });
            // The base stays private to the backend: 0711, never chowned.
            expect(fs.statSync(root).mode & 0o777).to.equal(0o711);
            overlay.dispose();
        });

        it('finishes as the agent uid: root neither writes the login back nor walks the overlay by path', async () => {
            const builder = new RecordingBuilder();
            const overlay = await builder.create(options({ agentIdentity: { uid: agentUid, gid: 7 } }));
            const taskDir = path.dirname(overlay.codexHome);
            overlay.dispose();
            expect(builder.ran).to.have.length(1);
            expect(builder.ran[0].owner).to.deep.equal({ uid: agentUid, gid: 7 });
            expect(builder.ran[0].input).to.include({ taskDir, overlayAuth: path.join(overlay.codexHome, 'auth.json') });
            // The mocked child did nothing, and root left the agent-owned tree alone.
            expect(fs.existsSync(path.join(overlay.codexHome, 'hooks.json'))).to.equal(true);
            expect(fs.readFileSync(path.join(sourceHome, 'auth.json'), 'utf8')).to.equal('{"tokens":{"refresh_token":"r1"}}');
        });

        it('does nothing as root when the child fails', async () => {
            const builder = new RecordingBuilder();
            builder.childOk = false;
            const overlay = await builder.create(options({ agentIdentity: { uid: agentUid, gid: 7 } }));
            overlay.dispose();
            expect(builder.ran).to.have.length(1);
            expect(fs.existsSync(path.join(overlay.codexHome, 'hooks.json'))).to.equal(true);
            expect(fs.readFileSync(path.join(sourceHome, 'auth.json'), 'utf8')).to.equal('{"tokens":{"refresh_token":"r1"}}');
        });

        it('cleans up a root-owned half-built overlay directly (no child)', async () => {
            const failing = new RecordingBuilder('untrusted');
            // The probe fails after the handover, but the dir is still root's: treeOwner reports root.
            failing.foreignOwner = undefined;
            let error: Error | undefined;
            try {
                await failing.create(options({ agentIdentity: { uid: agentUid } }));
            } catch (caught) {
                error = caught as Error;
            }
            expect(error).to.not.equal(undefined);
            expect(failing.ran).to.deep.equal([]);
            expect(fs.readdirSync(root)).to.deep.equal([]);
        });

        it('sweeps old agent-owned task dirs through a child, not by walking them as root', () => {
            fs.mkdirSync(root, { mode: 0o711 });
            const stale = path.join(root, 'old-task');
            fs.mkdirSync(path.join(stale, 'codex-home'), { recursive: true });
            const builder = new RecordingBuilder();
            (builder as any).removeBase(root);
            expect(builder.ran).to.have.length(1);
            expect(builder.ran[0].input).to.deep.equal({ taskDir: stale, initial: null });
            expect(fs.existsSync(path.join(stale, 'codex-home'))).to.equal(true);
        });

        it('the agent-side script writes the refreshed login back (CAS) and empties the task dir', () => {
            class Real extends QaapCodexGateOverlayBuilder {
                run(input: object): boolean {
                    return this.runAsOwner({ uid: process.getuid!(), gid: process.getgid!() }, input);
                }
            }
            const taskDir = path.join(tmp, 'agent-task');
            fs.mkdirSync(path.join(taskDir, 'codex-home'), { recursive: true });
            const overlayAuth = path.join(taskDir, 'codex-home', 'auth.json');
            const sourceAuth = path.join(sourceHome, 'auth.json');
            const initial = fs.readFileSync(sourceAuth, 'utf8');
            fs.writeFileSync(overlayAuth, '{"tokens":{"refresh_token":"r9"}}');
            expect(new Real(async () => 'trusted').run({ taskDir, overlayAuth, sourceAuth, initial })).to.equal(true);
            expect(fs.readFileSync(sourceAuth, 'utf8')).to.equal('{"tokens":{"refresh_token":"r9"}}');
            expect(fs.readdirSync(taskDir)).to.deep.equal([]);
            // CAS: the source changed, so the refreshed copy is dropped
            fs.mkdirSync(path.join(taskDir, 'codex-home'));
            fs.writeFileSync(overlayAuth, '{"tokens":{"refresh_token":"r10"}}');
            expect(new Real(async () => 'trusted').run({ taskDir, overlayAuth, sourceAuth, initial })).to.equal(true);
            expect(fs.readFileSync(sourceAuth, 'utf8')).to.equal('{"tokens":{"refresh_token":"r9"}}');
        });

        it('refuses a base that is a symlink planted by the agent and chowns nothing', async () => {
            const secretDir = path.join(tmp, 'backend-private');
            fs.mkdirSync(secretDir);
            const planted = path.join(tmp, 'planted');
            fs.symlinkSync(secretDir, planted);
            const builder = new RecordingBuilder();
            let error: Error | undefined;
            try {
                await builder.create(options({ agentIdentity: { uid: agentUid }, overlayRoot: planted }));
            } catch (caught) {
                error = caught as Error;
            }
            expect(error?.message).to.contain('not a real directory');
            expect(builder.handedOver).to.deep.equal([]);
            expect(fs.readdirSync(secretDir)).to.deep.equal([]);
        });

        it('fails with a clear error when an ancestor of the base is not searchable by the agent', async () => {
            const closed = path.join(tmp, 'closed');
            fs.mkdirSync(closed, { mode: 0o700 });
            fs.chmodSync(closed, 0o710);
            const strict = new RecordingBuilder();
            strict.skipReachability = false;
            let error: Error | undefined;
            try {
                await strict.create(options({ agentIdentity: { uid: agentUid }, overlayRoot: path.join(closed, 'overlays') }));
            } catch (caught) {
                error = caught as Error;
            }
            expect(error?.message).to.contain('not searchable by other users').and.to.contain('QAAP_CODEX_GATE_DIR');
        });

        describe('default base in the OS temp dir (read-only tenant rootfs)', () => {
            let savedTmp: string | undefined;
            let tmpRoot: string;
            beforeEach(() => {
                savedTmp = process.env.TMPDIR;
                tmpRoot = fs.realpathSync(fs.mkdtempSync(path.join(tmp, 'os-tmp-')));
                process.env.TMPDIR = tmpRoot;
            });
            afterEach(() => {
                if (savedTmp === undefined) {
                    delete process.env.TMPDIR;
                } else {
                    process.env.TMPDIR = savedTmp;
                }
            });
            const create = (builder: RecordingBuilder, taskId = 'task-1'): ReturnType<RecordingBuilder['create']> =>
                builder.create(options({ taskId, overlayRoot: undefined, agentIdentity: { uid: agentUid } }));

            it('creates a random 0711 base owned by this process and reuses it', async () => {
                const builder = new RecordingBuilder();
                const first = await create(builder, 'a');
                const base = path.dirname(path.dirname(first.codexHome));
                expect(path.dirname(base)).to.equal(tmpRoot);
                expect(path.basename(base)).to.match(/^qaap-codex-gate-[A-Za-z0-9]{6}$/);
                const stat = fs.lstatSync(base);
                expect(stat.mode & 0o777).to.equal(0o711);
                expect(stat.uid).to.equal(process.getuid?.());
                const second = await create(builder, 'b');
                expect(path.dirname(path.dirname(second.codexHome))).to.equal(base);
                expect(builder.handedOver.some(entry => entry.target === base)).to.equal(false);
                first.dispose();
                second.dispose();
                const other = await create(new RecordingBuilder(), 'c');
                expect(path.dirname(path.dirname(other.codexHome))).to.not.equal(base);
                other.dispose();
            });

            it('creates a new base when the old one was swapped for a link', async () => {
                const builder = new RecordingBuilder();
                const first = await create(builder, 'a');
                first.dispose();
                const base = path.dirname(path.dirname(first.codexHome));
                const victim = path.join(tmp, 'victim');
                fs.mkdirSync(victim);
                fs.rmSync(base, { recursive: true });
                fs.symlinkSync(victim, base);
                const second = await create(builder, 'b');
                const newBase = path.dirname(path.dirname(second.codexHome));
                expect(newBase).to.not.equal(base);
                expect(fs.readdirSync(victim)).to.deep.equal([]);
                second.dispose();
            });

            it('sweeps only old real directories of its own, never links or files', async () => {
                const old = new Date(Date.now() - 48 * 3600 * 1000);
                const staleDir = path.join(tmpRoot, 'qaap-codex-gate-STALE1');
                fs.mkdirSync(staleDir);
                fs.utimesSync(staleDir, old, old);
                const freshDir = path.join(tmpRoot, 'qaap-codex-gate-FRESH1');
                fs.mkdirSync(freshDir);
                const target = path.join(tmp, 'sweep-target');
                fs.mkdirSync(target);
                fs.writeFileSync(path.join(target, 'keep.txt'), 'x');
                fs.utimesSync(target, old, old);
                fs.symlinkSync(target, path.join(tmpRoot, 'qaap-codex-gate-LINK01'));
                fs.writeFileSync(path.join(tmpRoot, 'qaap-codex-gate-FILE01'), 'x');
                fs.writeFileSync(path.join(tmpRoot, 'unrelated'), 'x');
                (await create(new RecordingBuilder())).dispose();
                expect(fs.existsSync(staleDir)).to.equal(false);
                expect(fs.existsSync(freshDir)).to.equal(true);
                expect(fs.readFileSync(path.join(target, 'keep.txt'), 'utf8')).to.equal('x');
                expect(fs.lstatSync(path.join(tmpRoot, 'qaap-codex-gate-LINK01')).isSymbolicLink()).to.equal(true);
                expect(fs.existsSync(path.join(tmpRoot, 'qaap-codex-gate-FILE01'))).to.equal(true);
                expect(fs.existsSync(path.join(tmpRoot, 'unrelated'))).to.equal(true);
            });
        });

        it('refuses a base the agent could write to', async () => {
            fs.mkdirSync(root, { mode: 0o755 });
            fs.chmodSync(root, 0o777);
            let error: Error | undefined;
            try {
                await new RecordingBuilder().create(options({ agentIdentity: { uid: agentUid } }));
            } catch (caught) {
                error = caught as Error;
            }
            expect(error?.message).to.contain('its mode is 777');
        });

        it('keeps the current behaviour without a drop (same uid or no identity)', async () => {
            for (const agentIdentity of [undefined, {}, { uid: process.getuid?.() }]) {
                const builder = new RecordingBuilder();
                const overlay = await builder.create(options({ agentIdentity }));
                expect(builder.handedOver, JSON.stringify(agentIdentity)).to.deep.equal([]);
                expect(builder.probedAs).to.equal(undefined);
                overlay.dispose();
            }
        });
    });

    describe('write-back against a hostile overlay', () => {
        const secret = '{"legacy":"root-only-secret"}';

        it('does not read or copy a symlink swapped in for auth.json', async () => {
            const rootOnly = path.join(tmp, 'root-only.json');
            fs.writeFileSync(rootOnly, secret);
            const overlay = await trusted.create(options());
            fs.rmSync(path.join(overlay.codexHome, 'auth.json'));
            fs.symlinkSync(rootOnly, path.join(overlay.codexHome, 'auth.json'));
            overlay.dispose();
            expect(fs.readFileSync(path.join(sourceHome, 'auth.json'), 'utf8')).to.equal('{"tokens":{"refresh_token":"r1"}}');
        });

        it('does not copy a hardlinked auth.json', async () => {
            const rootOnly = path.join(tmp, 'root-only.json');
            fs.writeFileSync(rootOnly, secret);
            const overlay = await trusted.create(options());
            fs.rmSync(path.join(overlay.codexHome, 'auth.json'));
            fs.linkSync(rootOnly, path.join(overlay.codexHome, 'auth.json'));
            overlay.dispose();
            expect(fs.readFileSync(path.join(sourceHome, 'auth.json'), 'utf8')).to.equal('{"tokens":{"refresh_token":"r1"}}');
            expect(fs.readFileSync(rootOnly, 'utf8')).to.equal(secret);
        });

        it('does not write back when codex-home itself was swapped for a link', async () => {
            const elsewhere = path.join(tmp, 'elsewhere');
            fs.mkdirSync(elsewhere);
            fs.writeFileSync(path.join(elsewhere, 'auth.json'), '{"tokens":{"refresh_token":"evil"}}');
            const overlay = await trusted.create(options());
            fs.rmSync(overlay.codexHome, { recursive: true });
            fs.symlinkSync(elsewhere, overlay.codexHome);
            overlay.dispose();
            expect(fs.readFileSync(path.join(sourceHome, 'auth.json'), 'utf8')).to.equal('{"tokens":{"refresh_token":"r1"}}');
            expect(fs.readFileSync(path.join(elsewhere, 'auth.json'), 'utf8')).to.contain('evil');
        });

        it('refuses to copy an owner login that is a link to a file of another owner (drop)', () => {
            const rootOnly = path.join(tmp, 'root-only.json');
            fs.writeFileSync(rootOnly, secret);
            const link = path.join(tmp, 'link-auth.json');
            fs.symlinkSync(rootOnly, link);
            const otherUid = (process.getuid?.() ?? 0) + 1;
            expect(QaapCodexGateOverlayBuilder.readRegularFile(link, true, otherUid)).to.equal(undefined);
            expect(QaapCodexGateOverlayBuilder.readRegularFile(link, false, undefined)).to.equal(undefined);
            expect(QaapCodexGateOverlayBuilder.readRegularFile(link, true, process.getuid?.())?.text).to.equal(secret);
        });
    });

    it('works without a login or config in the source home (API key auth)', async () => {
        fs.rmSync(path.join(sourceHome, 'auth.json'));
        fs.rmSync(path.join(sourceHome, 'config.toml'));
        const overlay = await trusted.create(options());
        expect(fs.existsSync(path.join(overlay.codexHome, 'auth.json'))).to.equal(false);
        expect(fs.existsSync(path.join(overlay.codexHome, 'hooks.json'))).to.equal(true);
        overlay.dispose();
    });

    it('fails closed and cleans up when Codex does not trust the generated hook', async () => {
        for (const status of ['untrusted', 'missing'] as const) {
            const builder = new QaapCodexGateOverlayBuilder(async () => status);
            let error: Error | undefined;
            try {
                await builder.create(options());
            } catch (caught) {
                error = caught as Error;
            }
            expect(error?.message, status).to.contain('does not trust the Qaap safety hook');
            expect(fs.readdirSync(root), status).to.deep.equal([]);
        }
    });

    it('probes Codex once per version, not once per task', async () => {
        let probes = 0;
        const builder = new QaapCodexGateOverlayBuilder(async () => {
            probes++;
            return 'trusted';
        });
        (await builder.create(options({ taskId: 'a' }))).dispose();
        (await builder.create(options({ taskId: 'b' }))).dispose();
        expect(probes).to.equal(1);
    });

    it('sweeps overlays left by a crashed backend', async () => {
        fs.mkdirSync(root, { mode: 0o700 });
        const stale = path.join(root, 'old-task');
        fs.mkdirSync(path.join(stale, 'codex-home'), { recursive: true });
        const old = new Date(Date.now() - 48 * 3600 * 1000);
        fs.utimesSync(stale, old, old);
        (await trusted.create(options())).dispose();
        expect(fs.existsSync(stale)).to.equal(false);
    });

    it('applies the hook overlay only to Codex', () => {
        expect(usesCodexToolGateHook('codex')).to.equal(true);
        expect(usesCodexToolGateHook(' Codex ')).to.equal(true);
        for (const id of ['pi', 'qaiq', 'claude', undefined]) {
            expect(usesCodexToolGateHook(id), String(id)).to.equal(false);
        }
        expect(DEFAULT_QAAP_CODEX_GATE_OVERLAY_BUILDER).to.be.instanceOf(QaapCodexGateOverlayBuilder);
    });
});
