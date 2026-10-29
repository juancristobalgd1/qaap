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
        expect(overlay.codexHome).to.equal(path.join(fs.realpathSync(root), 'task-1', 'codex-home'));
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
        expect(fs.existsSync(path.join(root, 'task-1'))).to.equal(false);
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
            readonly chowns: Array<{ target: string; uid: number; gid: number }> = [];
            probedAs: unknown = 'not-called';
            constructor() {
                super(async (_home, _cwd, _env, identity) => {
                    this.probedAs = identity;
                    return 'trusted';
                });
            }
            protected override chown(target: string, uid: number, gid: number): void {
                this.chowns.push({ target, uid, gid });
            }
        }

        it('hands the overlay to the agent uid/gid and probes trust as that same identity', async () => {
            const builder = new RecordingBuilder();
            const overlay = await builder.create(options({ agentIdentity: { uid: agentUid, gid: 7 }, overlayRoot: undefined }));
            expect(overlay.codexHome).to.contain(`qaap-codex-gate-${agentUid}`);
            const owned = builder.chowns.map(entry => entry.target);
            for (const target of [path.dirname(path.dirname(overlay.codexHome)), overlay.codexHome,
                path.join(overlay.codexHome, 'auth.json'), path.join(overlay.codexHome, 'hooks.json'), path.join(overlay.codexHome, 'config.toml')]) {
                expect(owned, target).to.include(target);
            }
            expect(builder.chowns.every(entry => entry.uid === agentUid && entry.gid === 7)).to.equal(true);
            expect(builder.probedAs).to.deep.equal({ uid: agentUid, gid: 7 });
            overlay.dispose();
            fs.rmSync(path.dirname(path.dirname(overlay.codexHome)), { recursive: true, force: true });
        });

        it('keeps the current behaviour without a drop (same uid or no identity)', async () => {
            for (const agentIdentity of [undefined, {}, { uid: process.getuid?.() }]) {
                const builder = new RecordingBuilder();
                const overlay = await builder.create(options({ agentIdentity }));
                expect(builder.chowns, JSON.stringify(agentIdentity)).to.deep.equal([]);
                expect(builder.probedAs).to.equal(undefined);
                overlay.dispose();
            }
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
            expect(fs.existsSync(path.join(root, 'task-1')), status).to.equal(false);
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
