// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import { pathToFileURL } from 'url';
import { resolveQaapHarnessCapabilities } from '@theia/qaap-shared-core/lib/common/qaap-harness-capabilities';
import {
    applyOpencodeGateEnv,
    buildOpencodeGateConfigContent,
    dropOpencodeAskPermissions,
    resolveQaapToolGateOpencodePluginPath,
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
            applyOpencodeGateEnv(env, true);
            expect(JSON.parse(env.OPENCODE_CONFIG_CONTENT as string)).to.deep.equal({ plugin: [pluginUrl()] });
        });

        it('does not touch an env without gate credentials', () => {
            const env: NodeJS.ProcessEnv = { OPENCODE_PERMISSION: '{"bash":"ask"}' };
            applyOpencodeGateEnv(env, false);
            expect(env).to.deep.equal({ OPENCODE_PERMISSION: '{"bash":"ask"}' });
        });

        it('trusted folder keeps project config on', () => {
            const env = gateEnv();
            applyOpencodeGateEnv(env, true);
            expect(env.OPENCODE_DISABLE_PROJECT_CONFIG).to.equal(undefined);
        });

        it('untrusted folder switches project config off', () => {
            const env = gateEnv();
            applyOpencodeGateEnv(env, false);
            expect(env.OPENCODE_DISABLE_PROJECT_CONFIG).to.equal('1');
            expect(env.OPENCODE_DISABLE_EXTERNAL_SKILLS).to.equal('1');
            expect(env.OPENCODE_DISABLE_CLAUDE_CODE).to.equal('1');
        });

        it('replaces ask rules (which reject headless) and keeps deny rules', () => {
            const ask = gateEnv({ OPENCODE_PERMISSION: '{"edit":"ask","bash":"ask","webfetch":"ask"}' });
            applyOpencodeGateEnv(ask, true);
            expect(ask.OPENCODE_PERMISSION).to.equal(undefined);
            const readOnly = gateEnv({ OPENCODE_PERMISSION: '{"*":"deny","read":"allow"}' });
            applyOpencodeGateEnv(readOnly, true);
            expect(JSON.parse(readOnly.OPENCODE_PERMISSION as string)).to.deep.equal({ '*': 'deny', read: 'allow' });
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

    describe('dropOpencodeAskPermissions', () => {
        it('returns undefined for empty or all-ask permissions', () => {
            expect(dropOpencodeAskPermissions(undefined)).to.equal(undefined);
            expect(dropOpencodeAskPermissions('{"edit":"ask"}')).to.equal(undefined);
        });
    });
});
