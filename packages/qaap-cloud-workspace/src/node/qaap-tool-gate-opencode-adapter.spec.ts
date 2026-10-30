// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import { pathToFileURL } from 'url';
import { QAAP_OPENCODE_GATE_PROBE } from './qaap-tool-gate-opencode-probe';
import { resolveQaapHarnessCapabilities } from '@theia/qaap-shared-core/lib/common/qaap-harness-capabilities';
import {
    applyOpencodeGateEnv,
    buildOpencodeGateConfigContent,
    opencodeGatePluginSeeded,
    resolveOpencodeArmTimeoutMs,
    resolveQaapToolGateOpencodePluginPath,
    splitOpencodeAskPermissions,
    startOpencodeArmWatch,
    usesOpencodeGatePlugin,
} from './qaap-tool-gate-opencode-adapter';

const pluginUrl = (): string => pathToFileURL(resolveQaapToolGateOpencodePluginPath()).toString();
const gateEnv = (extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({ QAAP_GATE_URL: 'http://127.0.0.1:3000/g', QAAP_GATE_TOKEN: 't', ...extra });

describe('qaap-tool-gate-opencode-adapter', () => {

    it('ships the plugin file next to the compiled package', () => {
        expect(fs.existsSync(resolveQaapToolGateOpencodePluginPath())).to.equal(true);
    });

    describe('registry entry', () => {
        it('gates OpenCode through the plugin transport and can ask', () => {
            const caps = resolveQaapHarnessCapabilities('opencode');
            expect(caps).to.include({ gate: 'plugin', canAsk: true, costSource: 'price-table', usage: 'opencode' });
            expect(caps.askTtlSec).to.be.greaterThan(0);
        });

        it('turns off project config, external skills and Claude Code compat for untrusted folders', () => {
            expect(resolveQaapHarnessCapabilities('opencode').untrustedFolderEnv).to.deep.equal({
                OPENCODE_DISABLE_PROJECT_CONFIG: '1',
                OPENCODE_DISABLE_EXTERNAL_SKILLS: '1',
                OPENCODE_DISABLE_CLAUDE_CODE: '1',
            });
        });

        it('only the opencode id uses the plugin wiring', () => {
            expect(usesOpencodeGatePlugin('opencode')).to.equal(true);
            expect(usesOpencodeGatePlugin('Pi')).to.equal(false);
            expect(usesOpencodeGatePlugin('claude')).to.equal(false);
            expect(usesOpencodeGatePlugin(undefined)).to.equal(false);
        });
    });

    describe('applyOpencodeGateEnv', () => {
        it('references the plugin through OPENCODE_CONFIG_CONTENT', () => {
            const env = gateEnv();
            applyOpencodeGateEnv(env, true, true);
            expect(JSON.parse(env.OPENCODE_CONFIG_CONTENT as string)).to.deep.equal({ plugin: [pluginUrl()] });
        });

        it('does not touch an env without gate credentials', () => {
            const env: NodeJS.ProcessEnv = { OPENCODE_PERMISSION: '{"bash":"ask"}' };
            applyOpencodeGateEnv(env, false, true);
            expect(env).to.deep.equal({ OPENCODE_PERMISSION: '{"bash":"ask"}' });
        });

        it('trusted folder keeps project config on', () => {
            const env = gateEnv();
            applyOpencodeGateEnv(env, true, true);
            expect(env.OPENCODE_DISABLE_PROJECT_CONFIG).to.equal(undefined);
        });

        it('untrusted folder switches project config off', () => {
            const env = gateEnv();
            applyOpencodeGateEnv(env, false, true);
            expect(env.OPENCODE_DISABLE_PROJECT_CONFIG).to.equal('1');
            expect(env.OPENCODE_DISABLE_EXTERNAL_SKILLS).to.equal('1');
            expect(env.OPENCODE_DISABLE_CLAUDE_CODE).to.equal('1');
        });

        it('moves ask rules into the inline config (fail-closed baseline) and keeps other rules in the env', () => {
            const env = gateEnv({ OPENCODE_PERMISSION: '{"edit":"ask","bash":"ask","webfetch":"ask","lsp":"deny"}' });
            applyOpencodeGateEnv(env, true, true);
            expect(JSON.parse(env.OPENCODE_CONFIG_CONTENT as string).permission).to.deep.equal({ edit: 'ask', bash: 'ask', webfetch: 'ask' });
            expect(JSON.parse(env.OPENCODE_PERMISSION as string)).to.deep.equal({ lsp: 'deny' });
            const onlyAsk = gateEnv({ OPENCODE_PERMISSION: '{"bash":"ask"}' });
            applyOpencodeGateEnv(onlyAsk, true, true);
            expect(onlyAsk.OPENCODE_PERMISSION).to.equal(undefined);
        });

        it('probe failed or missing: wires nothing and keeps the ask rules that refuse gated tools', () => {
            for (const probeOk of [false, undefined]) {
                const env = gateEnv({ OPENCODE_PERMISSION: '{"edit":"ask","bash":"ask"}' });
                const before = { ...env };
                QAAP_OPENCODE_GATE_PROBE.record(undefined);
                if (probeOk === undefined) {
                    applyOpencodeGateEnv(env, false);
                } else {
                    applyOpencodeGateEnv(env, false, probeOk);
                }
                expect(env).to.deep.equal(before);
                expect(opencodeGatePluginSeeded(env)).to.equal(false);
            }
        });

        it('uses the recorded probe verdict by default', () => {
            QAAP_OPENCODE_GATE_PROBE.record({ ok: true, reason: 'ok', key: 'k' });
            const env = gateEnv({ OPENCODE_PERMISSION: '{"bash":"ask"}' });
            applyOpencodeGateEnv(env, true);
            expect(opencodeGatePluginSeeded(env)).to.equal(true);
            QAAP_OPENCODE_GATE_PROBE.record(undefined);
        });
    });

    describe('arm watch', () => {
        it('cancels a run whose plugin never armed', async () => {
            let cancelled = 0;
            startOpencodeArmWatch({ isArmed: () => false, isRunning: () => true, onTimeout: () => { cancelled++; }, timeoutMs: 20 });
            await new Promise(resolve => setTimeout(resolve, 60));
            expect(cancelled).to.equal(1);
        });

        it('leaves an armed, finished or stopped run alone', async () => {
            let cancelled = 0;
            const onTimeout = (): void => { cancelled++; };
            startOpencodeArmWatch({ isArmed: () => true, isRunning: () => true, onTimeout, timeoutMs: 20 });
            startOpencodeArmWatch({ isArmed: () => false, isRunning: () => false, onTimeout, timeoutMs: 20 });
            startOpencodeArmWatch({ isArmed: () => false, isRunning: () => true, onTimeout, timeoutMs: 20 })();
            await new Promise(resolve => setTimeout(resolve, 60));
            expect(cancelled).to.equal(0);
        });

        it('reads the timeout from QAAP_GATE_ARM_TIMEOUT_SEC with a 20 s default', () => {
            expect(resolveOpencodeArmTimeoutMs({})).to.equal(20_000);
            expect(resolveOpencodeArmTimeoutMs({ QAAP_GATE_ARM_TIMEOUT_SEC: '5' })).to.equal(5000);
            expect(resolveOpencodeArmTimeoutMs({ QAAP_GATE_ARM_TIMEOUT_SEC: 'x' })).to.equal(20_000);
        });
    });

    describe('buildOpencodeGateConfigContent', () => {
        it('keeps inherited inline config and puts the plugin first without duplicating it', () => {
            const inherited = JSON.stringify({ model: 'a/b', plugin: ['file:///other.js', pluginUrl()] });
            expect(JSON.parse(buildOpencodeGateConfigContent(inherited))).to.deep.equal({ model: 'a/b', plugin: [pluginUrl(), 'file:///other.js'] });
        });

        it('drops unparseable inherited content', () => {
            expect(JSON.parse(buildOpencodeGateConfigContent('{nope'))).to.deep.equal({ plugin: [pluginUrl()] });
            expect(JSON.parse(buildOpencodeGateConfigContent('[1]'))).to.deep.equal({ plugin: [pluginUrl()] });
        });
    });

    describe('splitOpencodeAskPermissions', () => {
        it('returns nothing for empty permissions and keeps unparseable ones untouched', () => {
            expect(splitOpencodeAskPermissions(undefined)).to.deep.equal({ ask: {}, rest: undefined });
            expect(splitOpencodeAskPermissions('{"edit":"ask"}')).to.deep.equal({ ask: { edit: 'ask' }, rest: undefined });
            expect(splitOpencodeAskPermissions('nope').rest).to.equal('nope');
        });
    });
});
