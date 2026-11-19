// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    applyQaapHarnessBinaryOverride,
    checkQaapHarnessBinaryPath,
    checkQaapHarnessHomeDir,
    isQaapHarnessLaunchOverrideRuntime,
    QaapHarnessLaunchOverrideError,
    resolveQaapHarnessInstanceRoute,
    resolveQaapHarnessLaunchPlan,
} from './qaap-harness-launch-overrides';
import { withQaapHarnessInstanceDescriptors } from './qaap-harness-instance-descriptors';
import { quoteShellArg } from './qaap-agent-task-runner-utils';

const DESKTOP_ENV: NodeJS.ProcessEnv = { QAAP_DESKTOP: '1' };

function prefs(values: Record<string, unknown>): (key: string) => unknown {
    return key => values[key];
}

const OVERRIDES = prefs({
    'ai-features.harness.settings': {
        codex: { binaryPath: '/opt/codex/bin/codex', homeDir: '/Users/me/.codex-work' },
        'codex#2': { label: 'Codex (work)', homeDir: '/Users/me/.codex-two' },
        opencode: { homeDir: '/Users/me/.opencode' },
    },
    'ai-features.harness.instances': [{ id: 'codex#2', baseId: 'codex' }],
    'ai-features.harness.disabledAgents': ['codex'],
});
const PATHS_OK = { checkBinary: () => undefined, checkHome: () => undefined };

describe('qaap-harness-launch-overrides', () => {

    describe('runtime gate', () => {
        it('honours overrides only on the desktop app', () => {
            expect(isQaapHarnessLaunchOverrideRuntime(DESKTOP_ENV)).to.equal(true);
            expect(isQaapHarnessLaunchOverrideRuntime({})).to.equal(false);
            expect(isQaapHarnessLaunchOverrideRuntime({ QAAP_LOCAL_DEV: '1' })).to.equal(false);
            expect(isQaapHarnessLaunchOverrideRuntime({ QAAP_DESKTOP: '1', NODE_ENV: 'production' })).to.equal(false);
            expect(isQaapHarnessLaunchOverrideRuntime({ QAAP_DESKTOP: '1', QAAP_CLOUD_MODE: 'hosted' })).to.equal(false);
            expect(isQaapHarnessLaunchOverrideRuntime({ QAAP_DESKTOP: '1', QAAP_TENANT_BACKEND_MODE: '1' })).to.equal(false);
        });

        for (const [name, env] of Object.entries<NodeJS.ProcessEnv>({
            'web (no runtime flag)': {},
            'local web dev': { QAAP_LOCAL_DEV: '1' },
            'hosted VPS': { QAAP_CLOUD_MODE: 'hosted', NODE_ENV: 'production' },
            'tenant backend': { QAAP_TENANT_BACKEND_MODE: '1', QAAP_TENANT_LOGIN: 'someone' },
            'tenant backend claiming desktop': { QAAP_DESKTOP: '1', QAAP_TENANT_BACKEND_MODE: '1' },
        })) {
            it(`ignores binary path and configuration folder on ${name}, even when they are stored`, () => {
                let checked = false;
                const plan = resolveQaapHarnessLaunchPlan('codex', OVERRIDES, {
                    env,
                    checkBinary: () => { checked = true; return undefined; },
                    checkHome: () => { checked = true; return undefined; },
                });
                expect(plan).to.deep.equal({});
                expect(checked, 'paths are not even inspected').to.equal(false);
            });
        }
    });

    describe('desktop launch plan', () => {
        it('applies the binary path and the harness configuration variable', () => {
            expect(resolveQaapHarnessLaunchPlan('codex', OVERRIDES, { env: DESKTOP_ENV, ...PATHS_OK })).to.deep.equal({
                binaryPath: '/opt/codex/bin/codex',
                homeEnvVar: 'CODEX_HOME',
                homeDir: '/Users/me/.codex-work',
            });
        });

        it('uses the instance settings for an instance id', () => {
            expect(resolveQaapHarnessLaunchPlan('codex#2', OVERRIDES, { env: DESKTOP_ENV, ...PATHS_OK })).to.deep.equal({
                homeEnvVar: 'CODEX_HOME',
                homeDir: '/Users/me/.codex-two',
            });
        });

        it('drops a configuration folder for a harness without a configuration variable', () => {
            expect(resolveQaapHarnessLaunchPlan('opencode', OVERRIDES, { env: DESKTOP_ENV, ...PATHS_OK })).to.deep.equal({});
        });

        it('fails closed when a stored path does not validate', () => {
            expect(() => resolveQaapHarnessLaunchPlan('codex', OVERRIDES, { env: DESKTOP_ENV, ...PATHS_OK, checkBinary: () => 'not-executable' }))
                .to.throw(QaapHarnessLaunchOverrideError, /not executable/);
            expect(() => resolveQaapHarnessLaunchPlan('codex', OVERRIDES, { env: DESKTOP_ENV, ...PATHS_OK, checkHome: () => 'missing' }))
                .to.throw(QaapHarnessLaunchOverrideError, /configuration folder/);
        });
    });

    describe('path validation', () => {
        let dir: string;
        beforeEach(() => {
            dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-harness-paths-'));
        });
        afterEach(() => {
            fs.rmSync(dir, { recursive: true, force: true });
        });

        it('accepts an existing executable file and refuses everything else', () => {
            const bin = path.join(dir, 'codex');
            fs.writeFileSync(bin, '#!/bin/sh\nexit 0\n');
            fs.chmodSync(bin, 0o755);
            expect(checkQaapHarnessBinaryPath(bin)).to.equal(undefined);
            expect(checkQaapHarnessBinaryPath(path.join(dir, 'missing'))).to.equal('missing');
            expect(checkQaapHarnessBinaryPath(dir)).to.equal('not-a-file');
            expect(checkQaapHarnessBinaryPath('codex')).to.equal('not-absolute');
            expect(checkQaapHarnessBinaryPath(`${bin};id`)).to.equal('unsafe-characters');
            if (process.platform !== 'win32') {
                const plain = path.join(dir, 'plain');
                fs.writeFileSync(plain, 'x');
                fs.chmodSync(plain, 0o644);
                expect(checkQaapHarnessBinaryPath(plain)).to.equal('not-executable');
            }
        });

        it('accepts an existing folder as configuration folder', () => {
            expect(checkQaapHarnessHomeDir(dir)).to.equal(undefined);
            expect(checkQaapHarnessHomeDir(path.join(dir, 'missing'))).to.equal('missing');
            const file = path.join(dir, 'file');
            fs.writeFileSync(file, 'x');
            expect(checkQaapHarnessHomeDir(file)).to.equal('not-a-directory');
        });
    });

    describe('binary override', () => {
        it('replaces only the leading executable, quoted', () => {
            const command = 'codex exec --json -c check_for_update_on_startup=false -';
            const result = applyQaapHarnessBinaryOverride(command, 'codex', '/Users/me/My Tools/codex', quoteShellArg);
            expect(result).to.equal(`${quoteShellArg('/Users/me/My Tools/codex')} exec --json -c check_for_update_on_startup=false -`);
            expect(applyQaapHarnessBinaryOverride(command, 'codex', undefined, quoteShellArg)).to.equal(command);
        });

        it('fails closed when the command does not start with the harness executable', () => {
            expect(() => applyQaapHarnessBinaryOverride('codexx exec', 'codex', '/opt/codex', quoteShellArg)).to.throw(QaapHarnessLaunchOverrideError);
        });
    });

    describe('instances', () => {
        it('routes a configured instance to its base harness with its own switch', () => {
            expect(resolveQaapHarnessInstanceRoute('codex#2', OVERRIDES)).to.deep.equal({ instanceId: 'codex#2', baseId: 'codex', configured: true, enabled: true });
            expect(resolveQaapHarnessInstanceRoute('codex#3', OVERRIDES)).to.deep.include({ configured: false, enabled: false });
            expect(resolveQaapHarnessInstanceRoute('codex', OVERRIDES)).to.equal(undefined);
            const disabled = prefs({
                'ai-features.harness.instances': [{ id: 'codex#2', baseId: 'codex' }],
                'ai-features.harness.disabledAgents': ['codex#2'],
            });
            expect(resolveQaapHarnessInstanceRoute('codex#2', disabled)).to.deep.include({ configured: true, enabled: false });
        });

        it('lists an enabled instance after its base harness, even when the base is switched off', () => {
            const disabled = new Set(['codex']);
            const listed = withQaapHarnessInstanceDescriptors(
                [
                    { id: 'codex', label: 'Codex', available: true },
                    { id: 'claude', label: 'Claude Code', available: true },
                ],
                OVERRIDES,
                id => !disabled.has(id),
            );
            expect(listed.map(agent => [agent.id, agent.label])).to.deep.equal([
                ['codex#2', 'Codex (work)'],
                ['claude', 'Claude Code'],
            ]);
        });

        it('does not list an instance whose base harness is not installed', () => {
            const listed = withQaapHarnessInstanceDescriptors([{ id: 'claude', label: 'Claude Code', available: true }], OVERRIDES, () => true);
            expect(listed.map(agent => agent.id)).to.deep.equal(['claude']);
        });
    });
});
